import { isDeepStrictEqual } from 'node:util';

import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { parsePolicyJson } from './policy-json.js';
import { integer, object } from './automations-read-validation.js';
import {
  deriveMissionId, freezeMissionJson, isAdoptionKey, isMissionCancellation, isMissionSubmitInput, isMissionView,
  missionIdShape,
  type CovenMissionCancellation, type CovenMissionSubmitInput, type CovenMissionView,
} from './missions-view.js';

/** The producer's spec command-envelope action; mission commands use it like every other command. */
const ENVELOPE_ACTION = 'coven.automations.command.v1';

/** Mission commands the SDK sends through the command envelope. */
export type CovenMissionCommandName = 'mission.submit.v1' | 'mission.cancel.v1';

/** Largest mission command answer accepted: one view, its result and the command wrapper. */
export const MISSION_RESPONSE_MAX_BYTES = 65_536;

/** Who records the command, under which idempotency key. Authority comes from the transport. */
export interface CovenMissionCommandContext {
  readonly adoptionKey: string;
  readonly principalId: string;
  readonly correlationId?: string;
}

interface MissionEnvelopeBase {
  readonly schemaVersion: 'coven.automations.v1';
  readonly adoptionKey: string;
  readonly origin: {
    readonly principal: { readonly principalId: string };
    readonly channel: 'sdk';
    readonly correlationId?: string;
  };
  readonly intent: { readonly statement: string };
}

/** A mission command envelope, as sent on the control-action wire. */
export type CovenMissionCommandEnvelope =
  | (MissionEnvelopeBase & { readonly command: 'mission.submit.v1'; readonly payload: CovenMissionSubmitInput })
  | (MissionEnvelopeBase & {
    readonly command: 'mission.cancel.v1';
    readonly payload: { readonly missionId: string; readonly reason?: string };
  });

export interface CovenMissionCommandRequest {
  readonly action: typeof ENVELOPE_ACTION;
  readonly envelope: CovenMissionCommandEnvelope;
}

/** The daemon's typed refusal. Its message is not copied, only its typed fields. */
export interface CovenMissionRefusal {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  /** For `ADOPTION_REPLAY_MISMATCH`: what the key actually committed. */
  readonly conflictOutcome?: 'committed' | 'rejected';
  /** For `REVISION_CONFLICT`, as the daemon reports it. */
  readonly currentRevision?: number;
}

export type CovenMissionCommandAnswer =
  | {
    readonly outcome: 'committed' | 'replayed';
    readonly result: Readonly<Record<string, unknown>>;
    readonly replay?: { readonly firstCommittedAt: string };
  }
  | { readonly outcome: 'rejected'; readonly error: CovenMissionRefusal };

const PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const ERROR_CODES: Readonly<Record<string, number>> = {
  SCHEMA_VERSION_UNSUPPORTED: 400, VALIDATION_FAILED: 400, ADOPTION_REPLAY_MISMATCH: 409, REVISION_CONFLICT: 409,
  NOT_FOUND: 404, GONE_TOMBSTONED: 410, CAPABILITY_UNSUPPORTED: 422, ILLEGAL_TRANSITION: 422,
  AUTHORITY_REQUIRED: 403, APPROVAL_REQUIRED: 403, CANCEL_PENDING: 409, OVERLAP_FORBIDDEN: 409,
  RETRY_DISPOSITION_INVALID: 422, AMBIGUOUS_RETRY_FORBIDDEN: 422, CURSOR_EXPIRED: 410, STREAM_OUT_OF_ORDER: 409,
  PAYLOAD_TOO_LARGE: 413, DEADLINE_EXCEEDED: 504, CONCURRENCY_LIMIT: 429, INTERNAL: 500,
};

function invalidOptions(operation: string): never {
  throw new CovenClientError(normalizeCovenError({ code: 'invalid_options' }, operation));
}

function patterned(value: unknown, pattern: RegExp, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && pattern.test(value);
}

/** 1–`max` code points of well-formed, non-blank text. */
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.isWellFormed() && value.trim().length > 0 && Array.from(value).length <= max;
}

function only(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

/**
 * An owned JSON copy of `value`, or `undefined`: accessors, symbols, cycles
 * and non-JSON values are refused without being invoked.
 */
function ownedJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object') return undefined;
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      return undefined;
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as string];
    if (typeof key !== 'string' || descriptor === undefined || !Object.hasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true) return undefined;
    const entry = ownedJson(descriptor.value, depth + 1);
    if (entry === undefined) return undefined;
    copy[key] = entry;
  }
  return copy;
}

function validContext(context: unknown): context is CovenMissionCommandContext {
  return only(context, ['adoptionKey', 'principalId', 'correlationId']) && isAdoptionKey(context.adoptionKey) &&
    patterned(context.principalId, PRINCIPAL_ID, 1, 128) &&
    (!Object.hasOwn(context, 'correlationId') || patterned(context.correlationId, CORRELATION_ID, 1, 200));
}

function envelopeBase(context: CovenMissionCommandContext, intent: string): MissionEnvelopeBase {
  return {
    schemaVersion: 'coven.automations.v1',
    adoptionKey: context.adoptionKey,
    origin: {
      principal: { principalId: context.principalId },
      channel: 'sdk',
      ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    },
    intent: { statement: intent },
  };
}

/** A validated, deep-frozen `mission.submit.v1` request, or `invalid_options` before any I/O. */
export function missionSubmitRequest(input: unknown, context: unknown, operation: string): CovenMissionCommandRequest {
  const payload = ownedJson(input);
  if (!isMissionSubmitInput(payload) || !validContext(context)) return invalidOptions(operation);
  return freezeMissionJson({
    action: ENVELOPE_ACTION,
    // The task statement is the human intent the envelope records.
    envelope: { ...envelopeBase(context, payload.task.statement), command: 'mission.submit.v1', payload },
  });
}

/** A validated, deep-frozen `mission.cancel.v1` request, or `invalid_options` before any I/O. */
export function missionCancelRequest(
  missionId: unknown,
  reason: unknown,
  context: unknown,
  operation: string,
): CovenMissionCommandRequest {
  if (!missionIdShape(missionId) || !validContext(context) ||
    (reason !== undefined && !text(reason, 500))) return invalidOptions(operation);
  const id = missionId as string;
  const trimmed = reason === undefined ? undefined : (reason).trim();
  return freezeMissionJson({
    action: ENVELOPE_ACTION,
    envelope: {
      ...envelopeBase(context, trimmed ?? `Cancel ${id}.`),
      command: 'mission.cancel.v1',
      payload: { missionId: id, ...(trimmed === undefined ? {} : { reason: trimmed }) },
    },
  });
}

/** Whether `envelope` names a mission command, so the transports route it here. */
export function isMissionEnvelope(envelope: unknown): boolean {
  return object(envelope) && (envelope.command === 'mission.submit.v1' || envelope.command === 'mission.cancel.v1');
}

/**
 * Serializes a mission command for the built-in transports. The request is
 * rebuilt from its own data fields, so what is sent is what was validated,
 * and nothing but a mission submit or cancel can be carried.
 */
export function missionCommandBytes(request: unknown): Buffer {
  const operation = 'missions.command';
  const owned = ownedJson(request);
  if (!only(owned, ['action', 'envelope']) || owned.action !== ENVELOPE_ACTION) return invalidOptions(operation);
  const envelope = owned.envelope;
  if (!only(envelope, ['schemaVersion', 'command', 'adoptionKey', 'origin', 'intent', 'payload']) ||
    envelope.schemaVersion !== 'coven.automations.v1' ||
    !only(envelope.origin, ['principal', 'channel', 'correlationId']) || envelope.origin.channel !== 'sdk' ||
    !only(envelope.origin.principal, ['principalId']) || !only(envelope.intent, ['statement'])) {
    return invalidOptions(operation);
  }
  const context = {
    adoptionKey: envelope.adoptionKey,
    principalId: envelope.origin.principal.principalId,
    ...(Object.hasOwn(envelope.origin, 'correlationId') ? { correlationId: envelope.origin.correlationId } : {}),
  };
  let rebuilt: CovenMissionCommandRequest;
  if (envelope.command === 'mission.submit.v1') {
    rebuilt = missionSubmitRequest(envelope.payload, context, operation);
  } else if (envelope.command === 'mission.cancel.v1' && only(envelope.payload, ['missionId', 'reason'])) {
    rebuilt = missionCancelRequest(envelope.payload.missionId, envelope.payload.reason, context, operation);
  } else {
    return invalidOptions(operation);
  }
  if (!isDeepStrictEqual(rebuilt, owned)) return invalidOptions(operation);
  return Buffer.from(JSON.stringify(rebuilt));
}

function refusal(value: unknown, status: number, adoptionKey: string): CovenMissionRefusal | undefined {
  if (!object(value) || typeof value.code !== 'string' || !Object.hasOwn(ERROR_CODES, value.code) ||
    ERROR_CODES[value.code] !== status || value.httpStatus !== status || typeof value.retryable !== 'boolean') {
    return undefined;
  }
  const adoption = value.adoption;
  if (Object.hasOwn(value, 'adoption') && (!only(adoption, ['key', 'conflictOutcome']) || adoption.key !== adoptionKey ||
    (Object.hasOwn(adoption, 'conflictOutcome') && adoption.conflictOutcome !== 'committed' &&
      adoption.conflictOutcome !== 'rejected'))) return undefined;
  if (Object.hasOwn(value, 'currentRevision') && !integer(value.currentRevision, 1)) return undefined;
  return {
    code: value.code,
    retryable: value.retryable,
    httpStatus: status,
    ...(object(adoption) && Object.hasOwn(adoption, 'conflictOutcome')
      ? { conflictOutcome: adoption.conflictOutcome as 'committed' | 'rejected' }
      : {}),
    ...(Object.hasOwn(value, 'currentRevision') ? { currentRevision: value.currentRevision as number } : {}),
  };
}

/** The control-action wrapper of a refusal: nothing accepted or committed. */
function refused(value: Record<string, unknown>): boolean {
  return value.ok === false && value.accepted === false && value.status === 'rejected';
}

/**
 * Decodes the daemon's answer to a mission command. A response that does not
 * prove what happened yields `undefined`, which callers treat as an unknown
 * outcome.
 */
export function decodeMissionCommand(
  status: number,
  bytes: Uint8Array,
  request: CovenMissionCommandRequest,
): CovenMissionCommandAnswer | undefined {
  let value: unknown;
  try {
    value = parsePolicyJson(bytes, MISSION_RESPONSE_MAX_BYTES);
  } catch {
    return undefined;
  }
  const { command, adoptionKey } = request.envelope;
  if (!object(value) || value.action !== ENVELOPE_ACTION) return undefined;
  const response = value.result;
  if (response === undefined || response === null) {
    // Refused before the envelope was read, for example by the owner-only
    // transport gate: a typed refusal, and nothing was adopted.
    const error = refused(value) && status >= 400 ? refusal(value.error, status, adoptionKey) : undefined;
    return error === undefined ? undefined : { outcome: 'rejected', error };
  }
  if (!object(response) || response.schemaVersion !== 'coven.automations.v1' || response.command !== command ||
    response.adoptionKey !== adoptionKey) return undefined;
  if (response.outcome === 'rejected') {
    const error = refused(value) ? refusal(response.error, status, adoptionKey) : undefined;
    return error === undefined ? undefined : { outcome: 'rejected', error };
  }
  if ((response.outcome !== 'committed' && response.outcome !== 'replayed') || status !== 200 ||
    value.ok !== true || value.accepted !== true || value.status !== 'completed' ||
    Object.hasOwn(response, 'error') || !object(response.result)) return undefined;
  const replayed = response.outcome === 'replayed';
  const replay = response.replay;
  if (replayed !== Object.hasOwn(response, 'replay') ||
    (replayed && (!only(replay, ['firstCommittedAt']) || !patterned(replay.firstCommittedAt, TIMESTAMP, 20, 24)))) {
    return undefined;
  }
  return {
    outcome: response.outcome,
    result: response.result,
    ...(replayed ? { replay: { firstCommittedAt: (replay as { firstCommittedAt: string }).firstCommittedAt } } : {}),
  };
}

/** What a submit committed, checked against what was sent. */
export interface CovenMissionSubmitCommitted {
  readonly missionId: string;
  readonly occurrenceId: string;
  readonly mission: CovenMissionView;
}

/**
 * The committed submit, or `undefined` when the answer is not this submit's:
 * the id must be the one derived from the key, and the view must bind the
 * familiar revision, envelope, task and expiry that were sent.
 */
export function submitCommitted(
  result: Readonly<Record<string, unknown>>,
  request: CovenMissionCommandRequest & { readonly envelope: { readonly command: 'mission.submit.v1' } },
): CovenMissionSubmitCommitted | undefined {
  const sent = request.envelope.payload;
  const { mission } = result;
  if (!only(result, ['missionId', 'occurrenceId', 'mission']) || result.missionId !== deriveMissionId(request.envelope.adoptionKey) ||
    !isMissionView(mission) || mission.missionId !== result.missionId || mission.occurrenceId !== result.occurrenceId ||
    !isDeepStrictEqual(mission.familiar, sent.familiar) || !isDeepStrictEqual(mission.envelope, sent.envelope) ||
    mission.task.statement !== sent.task.statement || mission.validUntil !== sent.validUntil) return undefined;
  return { missionId: mission.missionId, occurrenceId: mission.occurrenceId, mission };
}

/** What a cancel committed, or `undefined` when the answer is not this cancel's. */
export function cancelCommitted(
  result: Readonly<Record<string, unknown>>,
  missionId: string,
): { readonly cancellation: CovenMissionCancellation; readonly mission: CovenMissionView } | undefined {
  const { cancellation, mission } = result;
  if (!only(result, ['cancellation', 'mission']) || !isMissionCancellation(cancellation) || !isMissionView(mission) ||
    mission.missionId !== missionId ||
    (mission.cancellation !== undefined && mission.cancellation.cancellationId !== cancellation.cancellationId)) {
    return undefined;
  }
  return { cancellation, mission };
}
