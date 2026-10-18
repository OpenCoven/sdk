import { createHash } from 'node:crypto';

import { integer, object } from './automations-read-validation.js';
import type { CovenAutomationReceiptDigest } from './automations-receipts.js';

/**
 * The daemon's projection of a mission (OpenCoven/coven#1313). `submitted`
 * and `acknowledged` are client states and never appear here.
 */
export type CovenMissionState =
  | 'queued' | 'running' | 'needs_approval' | 'cancelling' | 'reconciling'
  | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'revoked' | 'unavailable';

export type CovenMissionReason =
  | 'timeout' | 'harness_failed' | 'familiar_revision_stale' | 'familiar_revision_revoked'
  | 'grant_revoked' | 'envelope_unsupported' | 'expired_before_dispatch'
  | 'authority_unavailable' | 'runtime_unavailable' | 'ambiguous_execution';

/** The exact familiar revision the caller showed the user. */
export interface CovenMissionFamiliarRef {
  /** `familiar:` followed by 32 lowercase hex digits. */
  readonly rootId: string;
  /** `familiar-revision:<32 hex>:<position>`. */
  readonly revisionId: string;
}

/** A runtime envelope the daemon advertises and enforces, such as `r0-read.1`. */
export interface CovenMissionEnvelopeRef {
  readonly id: string;
  readonly descriptorDigest: CovenAutomationReceiptDigest;
}

/** Everything a submit binds. The principal comes from the transport, never from here. */
export interface CovenMissionSubmitInput {
  readonly familiar: CovenMissionFamiliarRef;
  readonly envelope: CovenMissionEnvelopeRef;
  /** An absolute directory; the daemon canonicalizes it and refuses one inside `COVEN_HOME`. */
  readonly project: { readonly cwd: string };
  /** `statement`: 1–200 characters. `prompt`: 1 byte to 32 KiB of UTF-8, never echoed back. */
  readonly task: { readonly statement: string; readonly prompt: string };
  /** `timeoutMinutes`: 1–60. */
  readonly limits: { readonly timeoutMinutes: number };
  /** Dispatch must begin before this instant, at most 15 minutes after the request. */
  readonly validUntil: string;
}

export interface CovenMissionCancellation {
  readonly cancellationId: string;
  readonly requestedAt: string;
  /** `lost_to_completion` means the mission completed; the cancel did not stop it. */
  readonly outcome: 'cancelled' | 'pending' | 'lost_to_completion' | 'recovery_required';
}

export interface CovenMissionAttempt {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly state: 'adopted' | 'dispatching' | 'started' | 'observing' | 'succeeded' | 'failed' | 'cancelled' |
    'timed_out' | 'ambiguous';
  readonly failureClass?: string;
}

/** The owner-only report a mission produced. Its bytes are not part of the view. */
export interface CovenMissionArtifact {
  readonly kind: 'report';
  readonly ref: string;
  readonly mediaType: 'text/markdown';
  readonly bytes: number;
  readonly digest: CovenAutomationReceiptDigest;
}

/** Reported by the harness's result event, never estimated. */
export interface CovenMissionUsage {
  readonly source: 'harness_result_event';
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: number;
}

export interface CovenMissionResult {
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'rejected' | 'revoked' | 'unavailable';
  readonly settledAt: string;
  readonly resultDigest?: CovenAutomationReceiptDigest;
  readonly artifacts: readonly CovenMissionArtifact[];
  /** `null` when the harness reported no usage. */
  readonly usage: CovenMissionUsage | null;
  readonly observation: 'complete' | 'partial' | 'unknown';
}

/**
 * The daemon's authoritative mission view. The SDK checks its shape and its
 * internal consistency; it does not authenticate it or derive any state.
 */
export interface CovenMissionView {
  readonly missionId: string;
  readonly occurrenceId: string;
  /** Increases on every state change and stops at the terminal state. */
  readonly revision: number;
  readonly state: CovenMissionState;
  readonly terminal: boolean;
  readonly reason?: CovenMissionReason;
  readonly principal: { readonly principalId: string; readonly displayName?: string };
  readonly familiar: CovenMissionFamiliarRef;
  readonly envelope: CovenMissionEnvelopeRef;
  readonly project: { readonly cwd: string };
  /** The prompt is never echoed. */
  readonly task: { readonly statement: string };
  readonly submittedAt: string;
  readonly validUntil: string;
  readonly attempts: readonly CovenMissionAttempt[];
  readonly cancellation?: CovenMissionCancellation;
  /** Present exactly when the mission is terminal. */
  readonly result?: CovenMissionResult;
}

type Validator = (value: unknown) => boolean;

const oneOf = (...values: readonly string[]): Validator => (value) => typeof value === 'string' && values.includes(value);
/** Bounds count code points, as JSON Schema does. */
const text = (minimum: number, maximum: number): Validator => (value) => typeof value === 'string' &&
  value.isWellFormed() && [...value].length >= minimum && [...value].length <= maximum;
const patterned = (pattern: RegExp, minimum: number, maximum: number): Validator => (value) =>
  typeof value === 'string' && value.length >= minimum && value.length <= maximum && pattern.test(value);
const timestamp: Validator = (value) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value);
const count = (maximum: number): Validator => (value) => integer(value, 0, maximum);

function shape(required: Record<string, Validator>, optional: Record<string, Validator> = {}): Validator {
  return (value) => object(value) &&
    Object.keys(value).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)) &&
    Object.entries(required).every(([key, valid]) => Object.hasOwn(value, key) && valid(value[key])) &&
    Object.entries(optional).every(([key, valid]) => !Object.hasOwn(value, key) || valid(value[key]));
}

const ADOPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const MISSION_ID = /^mission-[0-9a-f]{32}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export const missionIdShape: Validator = patterned(MISSION_ID, 40, 40);
const digest = shape({
  algorithm: oneOf('sha256'), canonicalization: oneOf('jcs-rfc8785'),
  value: patterned(/^[0-9a-f]{64}$/u, 64, 64),
});
const familiar = shape({
  rootId: patterned(/^familiar:[0-9a-f]{32}$/u, 41, 41),
  revisionId: patterned(/^familiar-revision:[0-9a-f]{32}:(?:0|[1-9][0-9]{0,8})$/u, 52, 60),
});
const envelope = shape({
  id: patterned(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u, 1, 64),
  descriptorDigest: digest,
});
const project = shape({ cwd: (value) => text(1, 1_024)(value) && /^(?:\/|[A-Za-z]:[\\/])/u.test(value as string) });
const prompt: Validator = (value) => text(1, 32_768)(value) && Buffer.byteLength(value as string) <= 32_768;
const submitInput = shape({
  familiar, envelope, project,
  task: shape({ statement: text(1, 200), prompt }),
  limits: shape({ timeoutMinutes: (value) => integer(value, 1, 60) }),
  validUntil: timestamp,
});

const cancellation = shape({
  cancellationId: text(1, 160), requestedAt: timestamp,
  outcome: oneOf('cancelled', 'pending', 'lost_to_completion', 'recovery_required'),
});
const attempt = shape({
  attemptId: patterned(IDENTIFIER, 1, 160),
  attemptNumber: (value) => integer(value, 1, 10),
  state: oneOf('adopted', 'dispatching', 'started', 'observing', 'succeeded', 'failed', 'cancelled', 'timed_out', 'ambiguous'),
}, { failureClass: text(1, 64) });
const usage: Validator = (value) => value === null || shape({ source: oneOf('harness_result_event') }, {
  inputTokens: count(Number.MAX_SAFE_INTEGER), outputTokens: count(Number.MAX_SAFE_INTEGER),
  cacheReadTokens: count(Number.MAX_SAFE_INTEGER), cacheWriteTokens: count(Number.MAX_SAFE_INTEGER),
  costUsd: (entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0,
})(value);
const result = shape({
  outcome: oneOf('completed', 'failed', 'cancelled', 'rejected', 'revoked', 'unavailable'),
  settledAt: timestamp,
  artifacts: (value) => Array.isArray(value) && value.length <= 8 && value.every(shape({
    kind: oneOf('report'), ref: text(1, 200), mediaType: oneOf('text/markdown'), bytes: count(262_144), digest,
  })),
  usage,
  observation: oneOf('complete', 'partial', 'unknown'),
}, { resultDigest: digest });
const view = shape({
  missionId: missionIdShape,
  occurrenceId: patterned(IDENTIFIER, 1, 160),
  revision: (value) => integer(value, 1),
  state: oneOf('queued', 'running', 'needs_approval', 'cancelling', 'reconciling', 'completed', 'failed', 'cancelled',
    'rejected', 'revoked', 'unavailable'),
  terminal: (value) => typeof value === 'boolean',
  principal: shape({ principalId: patterned(/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u, 1, 128) }, { displayName: text(0, 160) }),
  familiar, envelope, project,
  task: shape({ statement: text(1, 200) }),
  submittedAt: timestamp,
  validUntil: timestamp,
  attempts: (value) => Array.isArray(value) && value.length <= 10 && value.every(attempt),
}, {
  reason: oneOf('timeout', 'harness_failed', 'familiar_revision_stale', 'familiar_revision_revoked', 'grant_revoked',
    'envelope_unsupported', 'expired_before_dispatch', 'authority_unavailable', 'runtime_unavailable',
    'ambiguous_execution'),
  cancellation,
  result,
});

/** States that never change once reached. `unavailable` is terminal only once its occurrence settles. */
const ALWAYS_TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled', 'rejected', 'revoked'];
const NEVER_TERMINAL: readonly string[] = ['queued', 'running', 'needs_approval', 'cancelling', 'reconciling'];
/** States that always carry a reason, and the only ones that may. */
const REASONED: readonly string[] = ['failed', 'rejected', 'revoked', 'unavailable', 'reconciling'];

/**
 * Whether `value` is a mission view the contract allows: its shape, and the
 * rules that tie its fields together. A view that breaks them proves nothing
 * about the mission, so callers treat it as an invalid response.
 */
export function isMissionView(value: unknown): value is CovenMissionView {
  if (!view(value)) return false;
  const candidate = value as CovenMissionView;
  const { state, terminal } = candidate;
  if ((ALWAYS_TERMINAL.includes(state) && !terminal) || (NEVER_TERMINAL.includes(state) && terminal)) return false;
  if (REASONED.includes(state) !== Object.hasOwn(candidate, 'reason')) return false;
  if (terminal !== Object.hasOwn(candidate, 'result')) return false;
  if (candidate.result !== undefined && candidate.result.outcome !== state) return false;
  // Attempts are immutable and numbered from one, in order.
  return candidate.attempts.every((entry, index) => entry.attemptNumber === index + 1) &&
    new Set(candidate.attempts.map((entry) => entry.attemptId)).size === candidate.attempts.length;
}

export function isMissionSubmitInput(value: unknown): value is CovenMissionSubmitInput {
  return submitInput(value);
}

export function isMissionCancellation(value: unknown): value is CovenMissionCancellation {
  return cancellation(value);
}

/** Whether `value` is an adoption key the contract accepts: 8–200 characters of `[A-Za-z0-9._:-]`. */
export function isAdoptionKey(value: unknown): value is string {
  return patterned(ADOPTION_KEY, 8, 200)(value);
}

/**
 * The mission id the daemon assigns to the submit with this adoption key:
 * `mission-` and the first 32 hex digits of SHA-256 over the key's UTF-8
 * bytes. Pure; `undefined` for a key the contract would refuse.
 */
export function deriveMissionId(adoptionKey: unknown): string | undefined {
  if (!isAdoptionKey(adoptionKey)) return undefined;
  return `mission-${createHash('sha256').update(adoptionKey, 'utf8').digest('hex').slice(0, 32)}`;
}

/** A deep-frozen copy, so a transport or caller cannot change what was validated. */
export function freezeMissionJson<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) freezeMissionJson(entry);
    Object.freeze(value);
  }
  return value;
}
