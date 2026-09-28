import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { parsePolicyJson } from './policy-json.js';
import { integer, object } from './automations-read-validation.js';

/** The producer's spec command-envelope action (OpenCoven/coven#1176). */
export const COMMAND_ENVELOPE_ACTION = 'coven.automations.command.v1';

/** Lifecycle commands this SDK sends. Create and revise need rich-definition persistence first. */
export type CovenAutomationLifecycleCommand =
  | 'definition.activate.v1'
  | 'definition.pause.v1'
  | 'definition.disable.v1'
  | 'definition.tombstone.v1';

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

/** A command the producer committed now or had already committed under this key. */
export interface CovenAutomationCommandCommitted {
  readonly outcome: 'committed' | 'replayed';
  readonly command: CovenAutomationLifecycleCommand;
  readonly adoptionKey: string;
  /** Definition revision after the command. */
  readonly revision: number;
  /** Command-specific committed result, as the producer projected it. */
  readonly result: Readonly<Record<string, unknown>>;
  /** Where the committed event landed, when the producer reports it. */
  readonly eventRef?: { readonly stream: string; readonly sequence: number };
  /** Present only on a replay. */
  readonly replay?: { readonly firstCommittedAt: string };
}

/**
 * A command the producer refused; nothing committed. The producer's message is
 * not copied, only its typed code.
 */
export interface CovenAutomationCommandRejected {
  readonly outcome: 'rejected';
  readonly command: CovenAutomationLifecycleCommand;
  readonly adoptionKey: string;
  readonly error: {
    /** A `coven.automations.v1` error code, e.g. `REVISION_CONFLICT` or `ILLEGAL_TRANSITION`. */
    readonly code: string;
    readonly retryable: boolean;
    /** The stored revision, when the producer reports it (for example on `REVISION_CONFLICT`). */
    readonly currentRevision?: number;
  };
}

export type CovenAutomationCommandResult = CovenAutomationCommandCommitted | CovenAutomationCommandRejected;

/** The envelope sent on the control-action wire. */
export interface CovenAutomationCommandRequest {
  readonly action: typeof COMMAND_ENVELOPE_ACTION;
  readonly envelope: {
    readonly schemaVersion: 'coven.automations.v1';
    readonly command: CovenAutomationLifecycleCommand;
    readonly adoptionKey: string;
    readonly expectedRevision: number;
    readonly origin: {
      readonly principal: { readonly principalId: string };
      readonly channel: 'sdk';
      readonly correlationId?: string;
    };
    readonly intent: { readonly statement: string };
    readonly payload: { readonly automationId: string; readonly reason?: string };
  };
}

const ADOPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const AUTOMATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function patterned(value: unknown, pattern: RegExp, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && pattern.test(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.isWellFormed();
}

function commandFailure(code: string, operation: string): never {
  throw new CovenClientError(normalizeCovenError({ code }, operation));
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

/**
 * Serializes a lifecycle command for the built-in transports. Anything other
 * than one of the four lifecycle envelopes is refused, so this hook cannot
 * carry another mutation.
 */
export function commandBytes(request: CovenAutomationCommandRequest): Buffer {
  const invalid = (): never => commandFailure('invalid_options', 'automations.command');
  let rebuilt: CovenAutomationCommandRequest;
  try {
    const envelope = object(request) && Reflect.ownKeys(request).length === 2 &&
      request.action === COMMAND_ENVELOPE_ACTION ? request.envelope : undefined;
    const only = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
      object(value) && Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
    if (!only(envelope, ['schemaVersion', 'command', 'adoptionKey', 'expectedRevision', 'origin', 'intent', 'payload']) ||
      envelope.schemaVersion !== 'coven.automations.v1' ||
      typeof envelope.command !== 'string' || !LIFECYCLE_COMMANDS.includes(envelope.command) ||
      !only(envelope.origin, ['principal', 'channel', 'correlationId']) || envelope.origin.channel !== 'sdk' ||
      !only(envelope.origin.principal, ['principalId']) || !only(envelope.intent, ['statement']) ||
      !only(envelope.payload, ['automationId', 'reason'])) return invalid();
    rebuilt = lifecycleRequest(
      envelope.command,
      envelope.payload.automationId,
      envelope.expectedRevision,
      {
        adoptionKey: envelope.adoptionKey,
        intent: envelope.intent.statement,
        principalId: envelope.origin.principal.principalId,
        ...(Object.hasOwn(envelope.origin, 'correlationId') ? { correlationId: envelope.origin.correlationId } : {}),
      },
      Object.hasOwn(envelope.payload, 'reason') ? { reason: envelope.payload.reason } : {},
      'automations.command',
    );
  } catch {
    return invalid();
  }
  // Serialize the rebuilt value, never the caller's object or its accessors.
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
    value = parsePolicyJson(bytes, 16_384);
  } catch {
    return undefined;
  }
  const { command, adoptionKey } = request.envelope;
  if (!object(value) || value.action !== COMMAND_ENVELOPE_ACTION) return undefined;
  const response = value.result;
  if (response === undefined || response === null) {
    // Refused before the envelope was read (for example by the transport
    // authority gate): a typed refusal, and nothing was adopted.
    const error = value.ok === false && status >= 400 ? typedError(value.error) : undefined;
    return error === undefined ? undefined : { outcome: 'rejected', command, adoptionKey, error };
  }
  if (!object(response) || response.schemaVersion !== 'coven.automations.v1' || response.command !== command ||
    response.adoptionKey !== adoptionKey) return undefined;
  if (response.outcome === 'rejected') {
    const error = typedError(response.error);
    if (error === undefined || value.ok !== false || status < 400 ||
      (object(response.error) && response.error.httpStatus !== status)) return undefined;
    return { outcome: 'rejected', command, adoptionKey, error };
  }
  if ((response.outcome !== 'committed' && response.outcome !== 'replayed') || status !== 200 ||
    value.ok !== true || Object.hasOwn(response, 'error') || !integer(response.revision, 1) ||
    !object(response.result)) return undefined;
  const replayed = response.outcome === 'replayed';
  const replay = response.replay;
  if (replayed !== Object.hasOwn(response, 'replay') ||
    (replayed && (!object(replay) || typeof replay.firstCommittedAt !== 'string'))) return undefined;
  const eventRef = response.eventRef;
  if (Object.hasOwn(response, 'eventRef') &&
    (!object(eventRef) || typeof eventRef.stream !== 'string' || !integer(eventRef.sequence, 0))) return undefined;
  return {
    outcome: response.outcome,
    command,
    adoptionKey,
    revision: response.revision,
    result: response.result,
    ...(Object.hasOwn(response, 'eventRef')
      ? { eventRef: { stream: (eventRef as { stream: string }).stream, sequence: (eventRef as { sequence: number }).sequence } }
      : {}),
    ...(replayed ? { replay: { firstCommittedAt: (replay as { firstCommittedAt: string }).firstCommittedAt } } : {}),
  };
}
