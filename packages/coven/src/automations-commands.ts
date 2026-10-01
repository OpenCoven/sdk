import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { parsePolicyJson } from './policy-json.js';
import { integer, object } from './automations-read-validation.js';
import { snapshotAutomationJson } from './automations-canonical-json.js';
import {
  isAutomationDefinitionDocument, type CovenAutomationDefinitionDocument,
} from './automations-definition-document.js';
import { AUTOMATION_EVENTS_MAX_BYTES } from './automations-events.js';
import { computeDefinitionDigest } from './automations-integrity.js';

/** The producer's spec command-envelope action (OpenCoven/coven#1176). */
export const COMMAND_ENVELOPE_ACTION = 'coven.automations.command.v1';

/** Lifecycle commands this SDK sends. */
export type CovenAutomationLifecycleCommand =
  | 'definition.activate.v1'
  | 'definition.pause.v1'
  | 'definition.disable.v1'
  | 'definition.tombstone.v1';

/** Commands that carry a rich definition body. */
export type CovenAutomationDefinitionCommand = 'definition.create.v1' | 'definition.revise.v1';

export type CovenAutomationCommandName = CovenAutomationLifecycleCommand | CovenAutomationDefinitionCommand;

/**
 * A new definition. The SDK sets `revision: 1`, `lifecycleState: "draft"` and
 * the JCS `integrity`; new definitions run nothing until activated.
 */
export type CovenAutomationDraftInput = Omit<CovenAutomationDefinitionDocument, 'revision' | 'integrity' | 'lifecycleState'>;

/**
 * The full next revision. The SDK sets `revision` and `integrity`;
 * `lifecycleState` must be the one a revise can write: `paused` for a draft,
 * invalid or paused definition, `active` for an active one.
 */
export type CovenAutomationRevisionInput = Omit<CovenAutomationDefinitionDocument, 'revision' | 'integrity'>;

const LIFECYCLE_COMMANDS: readonly string[] = [
  'definition.activate.v1',
  'definition.pause.v1',
  'definition.disable.v1',
  'definition.tombstone.v1',
];

/**
 * Who asks, why, and under which idempotency key. `principalId` is recorded
 * with the command; it is never an authority grant. Authority comes from the
 * transport: the built-in transports reach only the owner-only socket or pipe.
 */
export interface CovenAutomationCommandContext {
  /**
   * Stable idempotency key, 8–200 characters of `[A-Za-z0-9._:-]` starting
   * alphanumeric. Resend with the same key to reconcile an unknown outcome;
   * a new key could apply the command twice.
   */
  readonly adoptionKey: string;
  /** Human-authored intent, 1–1000 characters. */
  readonly intent: string;
  /** 1–128 characters of `[A-Za-z0-9._:@-]`, starting alphanumeric. */
  readonly principalId: string;
  /** Optional 1–200 character correlation id, recorded on the committed event. */
  readonly correlationId?: string;
}

export interface CovenAutomationLifecycleOptions {
  /** Optional 1–500 character reason. Not accepted by `tombstone`. */
  readonly reason?: string;
}

/** A command the producer committed now. */
export interface CovenAutomationCommandCommitted {
  readonly outcome: 'committed';
  readonly command: CovenAutomationCommandName;
  readonly adoptionKey: string;
  /** Definition revision after the command. */
  readonly revision: number;
  /** Command-specific committed result, as the producer projected it. */
  readonly result: Readonly<Record<string, unknown>>;
  /** Where the committed event landed, when the producer reports it. */
  readonly eventRef?: { readonly stream: string; readonly sequence: number };
}

/** A command already committed under this adoption key, returned unchanged. */
export interface CovenAutomationCommandReplayed extends Omit<CovenAutomationCommandCommitted, 'outcome'> {
  readonly outcome: 'replayed';
  /** When the key first committed. */
  readonly replay: { readonly firstCommittedAt: string };
}

/**
 * A command the producer refused; nothing committed. The producer's message is
 * not copied, only its typed code.
 */
export interface CovenAutomationCommandRejected {
  readonly outcome: 'rejected';
  readonly command: CovenAutomationCommandName;
  readonly adoptionKey: string;
  readonly error: {
    /** A `coven.automations.v1` error code, e.g. `REVISION_CONFLICT` or `ILLEGAL_TRANSITION`. */
    readonly code: string;
    readonly retryable: boolean;
    /** The stored revision, when the producer reports it (for example on `REVISION_CONFLICT`). */
    readonly currentRevision?: number;
  };
}

export type CovenAutomationCommandResult =
  | CovenAutomationCommandCommitted
  | CovenAutomationCommandReplayed
  | CovenAutomationCommandRejected;

interface CommandEnvelopeBase {
  readonly schemaVersion: 'coven.automations.v1';
  readonly adoptionKey: string;
  readonly origin: {
    readonly principal: { readonly principalId: string };
    readonly channel: 'sdk';
    readonly correlationId?: string;
  };
  readonly intent: { readonly statement: string };
}

/** The envelope sent on the control-action wire. */
export interface CovenAutomationCommandRequest {
  readonly action: typeof COMMAND_ENVELOPE_ACTION;
  readonly envelope:
    | (CommandEnvelopeBase & {
      readonly command: CovenAutomationLifecycleCommand;
      readonly expectedRevision: number;
      readonly payload: { readonly automationId: string; readonly reason?: string };
    })
    | (CommandEnvelopeBase & {
      readonly command: 'definition.create.v1';
      readonly payload: { readonly definition: CovenAutomationDefinitionDocument };
    })
    | (CommandEnvelopeBase & {
      readonly command: 'definition.revise.v1';
      readonly expectedRevision: number;
      readonly payload: { readonly definition: CovenAutomationDefinitionDocument };
    });
}

const ADOPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const AUTOMATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function patterned(value: unknown, pattern: RegExp, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && pattern.test(value);
}

/** Bounds count code points, as JSON Schema does, not UTF-16 code units. */
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.isWellFormed() && value.trim().length > 0 &&
    Array.from(value).length <= max;
}

function commandFailure(code: string, operation: string): never {
  throw new CovenClientError(normalizeCovenError({ code }, operation));
}

function validContext(context: unknown): context is CovenAutomationCommandContext {
  if (!object(context) || !Reflect.ownKeys(context).every((key) =>
    typeof key === 'string' && ['adoptionKey', 'intent', 'principalId', 'correlationId'].includes(key))) return false;
  return patterned(context.adoptionKey, ADOPTION_KEY, 8, 200) && text(context.intent, 1_000) &&
    patterned(context.principalId, PRINCIPAL_ID, 1, 128) &&
    (!Object.hasOwn(context, 'correlationId') || patterned(context.correlationId, CORRELATION_ID, 1, 200));
}

function envelopeBase(context: CovenAutomationCommandContext): CommandEnvelopeBase {
  return {
    schemaVersion: 'coven.automations.v1',
    adoptionKey: context.adoptionKey,
    origin: Object.freeze({
      principal: Object.freeze({ principalId: context.principalId }),
      channel: 'sdk',
      ...(Object.hasOwn(context, 'correlationId') ? { correlationId: context.correlationId as string } : {}),
    }),
    intent: Object.freeze({ statement: context.intent }),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/**
 * Largest definition sent, as serialized UTF-8. A committed answer carries
 * the definition up to four times (routine and rich form, in both the result
 * and the event), so this keeps every committed answer within the 1 MiB
 * response cap: a commit is never reported as `outcome_unknown`.
 */
export const DEFINITION_MAX_BYTES = 192 * 1024;

/** Deepest definition sent: it sits four levels down in an answer parsed to depth 16. */
const DEFINITION_MAX_DEPTH = 10;

function depth(value: unknown): number {
  return typeof value === 'object' && value !== null
    ? 1 + Math.max(0, ...Object.values(value).map(depth))
    : 0;
}

/** Whether a committed answer carrying `definition` is guaranteed to decode. */
function fitsCommittedAnswer(definition: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(definition)) <= DEFINITION_MAX_BYTES &&
    depth(definition) <= DEFINITION_MAX_DEPTH;
}

/**
 * A complete, digest-bearing definition for `command`, or `undefined` when
 * `input` cannot become one. The input is snapshotted first: accessor-backed
 * properties are refused without being invoked, so what is hashed is what is
 * sent.
 */
function completeDefinition(
  command: CovenAutomationDefinitionCommand,
  input: unknown,
  revision: number,
): CovenAutomationDefinitionDocument | undefined {
  const owned = snapshotAutomationJson(input, 'jcs');
  if (!object(owned) || Object.hasOwn(owned, 'revision') || Object.hasOwn(owned, 'integrity') ||
    (command === 'definition.create.v1') === Object.hasOwn(owned, 'lifecycleState')) return undefined;
  const document: Record<string, unknown> = {
    // The caller's schemaVersion is kept, so a missing or unknown version fails validation.
    ...owned,
    revision,
    ...(command === 'definition.create.v1' ? { lifecycleState: 'draft' } : {}),
    // Placeholder so the structural check passes; the digest excludes it.
    integrity: { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: '0'.repeat(64) },
  };
  const digest = computeDefinitionDigest(document);
  if (digest.status !== 'computed') return undefined;
  document.integrity = { ...digest.digest };
  return isAutomationDefinitionDocument(document) && fitsCommittedAnswer(document)
    ? deepFreeze(document as unknown as CovenAutomationDefinitionDocument)
    : undefined;
}

/** A validated create or revise request, or `invalid_options` before any I/O. */
export function definitionRequest(
  command: CovenAutomationDefinitionCommand,
  automationId: unknown,
  expectedRevision: unknown,
  input: unknown,
  context: unknown,
  operation: string,
): CovenAutomationCommandRequest {
  const invalid = (): never => commandFailure('invalid_options', operation);
  const revise = command === 'definition.revise.v1';
  if (!validContext(context) || (revise && !integer(expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1))) {
    return invalid();
  }
  const definition = completeDefinition(command, input, revise ? (expectedRevision as number) + 1 : 1);
  if (definition === undefined || (revise && definition.automationId !== automationId) ||
    (revise && definition.lifecycleState !== 'paused' && definition.lifecycleState !== 'active')) return invalid();
  const base = envelopeBase(context);
  return Object.freeze({
    action: COMMAND_ENVELOPE_ACTION,
    envelope: Object.freeze(revise
      ? { ...base, command, expectedRevision: expectedRevision as number, payload: Object.freeze({ definition }) }
      : { ...base, command, payload: Object.freeze({ definition }) }),
  } as CovenAutomationCommandRequest);
}

/** Builds a validated request, or fails with `invalid_options` before any I/O. */
export function lifecycleRequest(
  command: CovenAutomationLifecycleCommand,
  automationId: unknown,
  expectedRevision: unknown,
  context: unknown,
  options: unknown,
  operation: string,
): CovenAutomationCommandRequest {
  const invalid = (): never => commandFailure('invalid_options', operation);
  if (!patterned(automationId, AUTOMATION_ID, 1, 96) || !integer(expectedRevision, 1) ||
    !object(context) || !object(options)) return invalid();
  const own = (value: Record<string, unknown>, keys: readonly string[]) =>
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
  if (!own(context, ['adoptionKey', 'intent', 'principalId', 'correlationId']) ||
    !own(options, ['reason']) ||
    !patterned(context.adoptionKey, ADOPTION_KEY, 8, 200) || !text(context.intent, 1_000) ||
    !patterned(context.principalId, PRINCIPAL_ID, 1, 128) ||
    (Object.hasOwn(context, 'correlationId') && !patterned(context.correlationId, CORRELATION_ID, 1, 200)) ||
    (Object.hasOwn(options, 'reason') &&
      (command === 'definition.tombstone.v1' || !text(options.reason, 500)))) return invalid();
  const correlationId = Object.hasOwn(context, 'correlationId') ? { correlationId: context.correlationId as string } : {};
  const reason = Object.hasOwn(options, 'reason') ? { reason: (options.reason as string).trim() } : {};
  // Frozen throughout: a transport cannot rewrite what the decoder checks.
  return Object.freeze({
    action: COMMAND_ENVELOPE_ACTION,
    envelope: Object.freeze({
      schemaVersion: 'coven.automations.v1',
      command,
      adoptionKey: context.adoptionKey,
      expectedRevision,
      origin: Object.freeze({
        principal: Object.freeze({ principalId: context.principalId }),
        channel: 'sdk',
        ...correlationId,
      }),
      intent: Object.freeze({ statement: context.intent }),
      payload: Object.freeze({ automationId, ...reason }),
    }),
  } as const);
}

/** Largest command response accepted: definition answers can carry four copies of the definition. */
export function commandResponseLimit(command: string): number {
  return command === 'definition.create.v1' || command === 'definition.revise.v1' ? AUTOMATION_EVENTS_MAX_BYTES : 16_384;
}

/**
 * Own data properties of `options` limited to `allowed`, copied without
 * invoking accessors; `undefined` for anything else.
 */
export function commandOptions(options: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!object(options)) return undefined;
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(options)) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (typeof key !== 'string' || !allowed.includes(key) || descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value')) return undefined;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

/**
 * Serializes a command for the built-in transports: the four lifecycle
 * commands, or create/revise with a complete definition whose digest matches
 * its body. Anything else is refused, so this hook cannot carry another
 * mutation. Only a rebuilt value is serialized, never the caller's object.
 */
export function commandBytes(request: CovenAutomationCommandRequest): Buffer {
  const invalid = (): never => commandFailure('invalid_options', 'automations.command');
  let rebuilt: unknown;
  try {
    const envelope = object(request) && Reflect.ownKeys(request).length === 2 &&
      request.action === COMMAND_ENVELOPE_ACTION ? request.envelope : undefined;
    const only = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
      object(value) && Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
    if (!only(envelope, ['schemaVersion', 'command', 'adoptionKey', 'expectedRevision', 'origin', 'intent', 'payload']) ||
      envelope.schemaVersion !== 'coven.automations.v1' || typeof envelope.command !== 'string' ||
      !only(envelope.origin, ['principal', 'channel', 'correlationId']) || envelope.origin.channel !== 'sdk' ||
      !only(envelope.origin.principal, ['principalId']) || !only(envelope.intent, ['statement'])) return invalid();
    const context = {
      adoptionKey: envelope.adoptionKey,
      intent: envelope.intent.statement,
      principalId: envelope.origin.principal.principalId,
      ...(Object.hasOwn(envelope.origin, 'correlationId') ? { correlationId: envelope.origin.correlationId } : {}),
    };
    const payload: unknown = envelope.payload;
    if (LIFECYCLE_COMMANDS.includes(envelope.command)) {
      if (!only(payload, ['automationId', 'reason'])) return invalid();
      rebuilt = lifecycleRequest(
        envelope.command as CovenAutomationLifecycleCommand,
        payload.automationId,
        envelope.expectedRevision,
        context,
        Object.hasOwn(payload, 'reason') ? { reason: payload.reason } : {},
        'automations.command',
      );
    } else if (envelope.command === 'definition.create.v1' || envelope.command === 'definition.revise.v1') {
      const revise = envelope.command === 'definition.revise.v1';
      if (!only(envelope.payload, ['definition']) || !validContext(context) ||
        revise !== Object.hasOwn(envelope, 'expectedRevision') ||
        (revise && !integer(envelope.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1))) return invalid();
      const definition = snapshotAutomationJson(envelope.payload.definition, 'jcs');
      if (!isAutomationDefinitionDocument(definition)) return invalid();
      const digest = computeDefinitionDigest(definition);
      if (digest.status !== 'computed' || digest.digest.value !== definition.integrity.value ||
        !fitsCommittedAnswer(definition) ||
        definition.revision !== (revise ? Number(envelope.expectedRevision) + 1 : 1) ||
        (revise ? !['paused', 'active'].includes(definition.lifecycleState) : definition.lifecycleState !== 'draft')) {
        return invalid();
      }
      rebuilt = {
        action: COMMAND_ENVELOPE_ACTION,
        envelope: {
          ...envelopeBase(context),
          command: envelope.command,
          ...(revise ? { expectedRevision: envelope.expectedRevision } : {}),
          payload: { definition },
        },
      };
    } else {
      return invalid();
    }
  } catch {
    return invalid();
  }
  return Buffer.from(JSON.stringify(rebuilt));
}

const ERROR_CODES = [
  'SCHEMA_VERSION_UNSUPPORTED', 'VALIDATION_FAILED', 'ADOPTION_REPLAY_MISMATCH', 'REVISION_CONFLICT',
  'NOT_FOUND', 'GONE_TOMBSTONED', 'CAPABILITY_UNSUPPORTED', 'ILLEGAL_TRANSITION', 'AUTHORITY_REQUIRED',
  'APPROVAL_REQUIRED', 'CANCEL_PENDING', 'OVERLAP_FORBIDDEN', 'RETRY_DISPOSITION_INVALID',
  'AMBIGUOUS_RETRY_FORBIDDEN', 'CURSOR_EXPIRED', 'STREAM_OUT_OF_ORDER', 'PAYLOAD_TOO_LARGE',
  'DEADLINE_EXCEEDED', 'CONCURRENCY_LIMIT', 'INTERNAL',
];

function typedError(value: unknown): CovenAutomationCommandRejected['error'] | undefined {
  if (!object(value) || typeof value.code !== 'string' || !ERROR_CODES.includes(value.code) ||
    typeof value.retryable !== 'boolean' ||
    (Object.hasOwn(value, 'currentRevision') && !integer(value.currentRevision, 1))) return undefined;
  return {
    code: value.code,
    retryable: value.retryable,
    ...(Object.hasOwn(value, 'currentRevision') ? { currentRevision: value.currentRevision as number } : {}),
  };
}

/**
 * Decodes the producer's answer. A response that does not prove what happened
 * yields `undefined`: the caller treats that as an unknown outcome.
 */
export function decodeCommand(
  status: number,
  bytes: Uint8Array,
  request: CovenAutomationCommandRequest,
): CovenAutomationCommandResult | undefined {
  let value: unknown;
  try {
    value = parsePolicyJson(bytes, commandResponseLimit(request.envelope.command));
  } catch {
    return undefined;
  }
  const { command, adoptionKey } = request.envelope;
  if (!object(value) || value.action !== COMMAND_ENVELOPE_ACTION) return undefined;
  const response = value.result;
  if (response === undefined || response === null) {
    // Refused before the envelope was read (for example by the transport
    // authority gate): a typed refusal, and nothing was adopted.
    const error = refused(value) && status >= 400 ? typedError(value.error) : undefined;
    return error === undefined ? undefined : { outcome: 'rejected', command, adoptionKey, error };
  }
  if (!object(response) || response.schemaVersion !== 'coven.automations.v1' || response.command !== command ||
    response.adoptionKey !== adoptionKey) return undefined;
  if (response.outcome === 'rejected') {
    const error = typedError(response.error);
    if (error === undefined || !refused(value) || status < 400 ||
      (object(response.error) && response.error.httpStatus !== status)) return undefined;
    return { outcome: 'rejected', command, adoptionKey, error };
  }
  if ((response.outcome !== 'committed' && response.outcome !== 'replayed') || status !== 200 ||
    value.ok !== true || value.accepted !== true || value.status !== 'completed' ||
    Object.hasOwn(response, 'error') || !integer(response.revision, 1) ||
    !object(response.result)) return undefined;
  const replayed = response.outcome === 'replayed';
  const replay = response.replay;
  if (replayed !== Object.hasOwn(response, 'replay') ||
    (replayed && (!object(replay) || typeof replay.firstCommittedAt !== 'string'))) return undefined;
  const eventRef = response.eventRef;
  if (Object.hasOwn(response, 'eventRef') &&
    (!object(eventRef) || typeof eventRef.stream !== 'string' || !integer(eventRef.sequence, 0))) return undefined;
  const committed = {
    command,
    adoptionKey,
    revision: response.revision,
    result: response.result,
    ...(Object.hasOwn(response, 'eventRef')
      ? { eventRef: { stream: (eventRef as { stream: string }).stream, sequence: (eventRef as { sequence: number }).sequence } }
      : {}),
  };
  return replayed
    ? { outcome: 'replayed', ...committed, replay: { firstCommittedAt: (replay as { firstCommittedAt: string }).firstCommittedAt } }
    : { outcome: 'committed', ...committed };
}

/** The control-action wrapper of a refusal: nothing accepted or committed. */
function refused(value: Record<string, unknown>): boolean {
  return value.ok === false && value.accepted === false && value.status === 'rejected';
}
