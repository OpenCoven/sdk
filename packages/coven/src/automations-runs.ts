import { historyPageCursor, newestFirst, type CovenAutomationHistoryCursor } from './automations-history.js';
import { integer, object } from './automations-read-validation.js';

export interface CovenAutomationRunsOptions {
  /** Newest-first history size, 1–100 (default 20). No pagination cursor is exposed by the producer. */
  readonly limit?: number;
}

export interface CovenAutomationAttempt {
  readonly id: string;
  readonly runId: string;
  readonly occurrenceId: string;
  readonly attemptNumber: number;
  readonly adoptionKey: string;
  readonly occurrenceFenceGeneration: number;
  readonly dispatchGeneration: number;
  readonly state: 'adopted' | 'dispatching' | 'started' | 'observing' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'ambiguous';
  readonly failureClass: 'transient_dispatch' | 'lease_expired' | 'runtime_unavailable' | 'launch_refused' | 'runtime_error' | 'timeout' | 'cancelled' | 'ambiguous_evidence' | 'runtime_authority_unsupported' | null;
  readonly priorAttemptNumber: number | null;
  readonly priorDisposition: 'failed' | 'timed_out' | 'cancelled' | 'ambiguous' | null;
  readonly retryClassification: 'initial' | 'automatic_retry' | 'operator_retry' | 'operator_recovery';
  readonly notBefore: string;
  readonly sessionId: string | null;
  readonly stateReason: string | null;
  readonly openedAt: string;
  readonly settledAt: string | null;
}

/** Diagnostic cancellation projection, not a cancellation command or authorization proof. */
export interface CovenAutomationRunCancellation {
  readonly scope: 'run';
  readonly requestedBy: { readonly principalId: string };
  readonly status: 'requested' | 'stopping' | 'cancelled' | 'recovery_required' | 'rejected';
  readonly requestedAt: string;
  readonly reason?: string;
  readonly acknowledgedAt?: string;
  readonly reconciledAt?: string;
}

/** Exact compatibility history projection; the producer does not serialize revision or digest here. */
export interface CovenAutomationRun {
  readonly id: string;
  readonly automationId: string;
  readonly occurrenceId: string | null;
  readonly sessionId: string | null;
  readonly familiarId: string | null;
  readonly runtime: string | null;
  readonly status: string;
  readonly exitCode: number | null;
  /** Opaque stored text, not parsed JSON. */
  readonly logJson: string | null;
  readonly outputCommit: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** A reference only; no receipt authentication is performed. */
  readonly receiptId: string | null;
  readonly attempts: readonly CovenAutomationAttempt[];
  readonly cancellation?: CovenAutomationRunCancellation;
}

export interface CovenAutomationRunsResult {
  readonly runs: readonly CovenAutomationRun[];
}

function member(value: unknown, choices: readonly string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

function nullableStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => value[key] === null || typeof value[key] === 'string');
}

function nonemptyStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string' && value[key].length > 0);
}

function cancellation(value: unknown): boolean {
  return object(value) && value.scope === 'run' &&
    object(value.requestedBy) && nonemptyStrings(value.requestedBy, ['principalId']) &&
    member(value.status, ['requested', 'stopping', 'cancelled', 'recovery_required', 'rejected']) &&
    typeof value.requestedAt === 'string' &&
    ['reason', 'acknowledgedAt', 'reconciledAt'].every((key) =>
      !Object.hasOwn(value, key) || typeof value[key] === 'string');
}

function attempt(value: unknown, run: Record<string, unknown>): value is CovenAutomationAttempt {
  if (!object(value) || !nonemptyStrings(value, ['id', 'runId', 'occurrenceId', 'adoptionKey']) ||
    value.runId !== run.id || value.occurrenceId !== run.occurrenceId ||
    !integer(value.attemptNumber, 1, 10) || !integer(value.occurrenceFenceGeneration, 1) ||
    !integer(value.dispatchGeneration, 0) ||
    !member(value.state, ['adopted', 'dispatching', 'started', 'observing', 'succeeded', 'failed', 'cancelled', 'timed_out', 'ambiguous']) ||
    (value.failureClass !== null && !member(value.failureClass, [
      'transient_dispatch', 'lease_expired', 'runtime_unavailable', 'launch_refused', 'runtime_error',
      'timeout', 'cancelled', 'ambiguous_evidence', 'runtime_authority_unsupported',
    ])) ||
    !member(value.retryClassification, ['initial', 'automatic_retry', 'operator_retry', 'operator_recovery']) ||
    !['notBefore', 'openedAt'].every((key) => typeof value[key] === 'string') ||
    !nullableStrings(value, ['sessionId', 'stateReason', 'settledAt'])) return false;
  return value.attemptNumber === 1
    ? value.priorAttemptNumber === null && value.priorDisposition === null
    : value.priorAttemptNumber === value.attemptNumber - 1 &&
      member(value.priorDisposition, ['failed', 'timed_out', 'cancelled', 'ambiguous']);
}

export function runsPayload(value: Record<string, unknown>, id: string, limit: number): CovenAutomationRunsResult | undefined {
  if (!Array.isArray(value.runs) || value.runs.length > limit) return undefined;
  const runIds = new Set<string>();
  const attemptIds = new Set<string>();
  const adoptionKeys = new Set<string>();
  for (const run of value.runs as unknown[]) {
    if (!object(run) || !nonemptyStrings(run, ['id', 'automationId']) || run.automationId !== id ||
      typeof run.status !== 'string' || typeof run.startedAt !== 'string' ||
      !nullableStrings(run, ['occurrenceId', 'sessionId', 'familiarId', 'runtime', 'logJson',
        'outputCommit', 'finishedAt', 'receiptId']) ||
      (run.exitCode !== null && !integer(run.exitCode, Number.MIN_SAFE_INTEGER)) ||
      !Array.isArray(run.attempts) || run.attempts.length > 10 ||
      (Object.hasOwn(run, 'cancellation') && !cancellation(run.cancellation))) return undefined;
    const runId = run.id as string;
    if (runIds.has(runId)) return undefined;
    runIds.add(runId);
    let previousNumber = 0;
    for (const entry of run.attempts as unknown[]) {
      if (!attempt(entry, run) || entry.attemptNumber <= previousNumber ||
        attemptIds.has(entry.id) || adoptionKeys.has(entry.adoptionKey)) return undefined;
      previousNumber = entry.attemptNumber;
      attemptIds.add(entry.id);
      adoptionKeys.add(entry.adoptionKey);
    }
  }
  return { runs: value.runs as CovenAutomationRun[] };
}

/** `run.history.v1` cursors are bounded tighter than sdk-core's 512 characters. */
export const RUN_HISTORY_CURSOR_MAX_LENGTH = 256;

export interface CovenAutomationRunHistoryOptions {
  /** 1–100, default 20. */
  readonly limit?: number;
  /** An opaque `cursor.next` from an earlier page of the same query. */
  readonly cursor?: string;
  /** Restricts the history to one occurrence's runs. */
  readonly occurrenceId?: string;
}

/**
 * One page of an automation's runs, newest first by start instant then
 * `id`, each with its attempts. Shaped as an sdk-core `Page`.
 */
export interface CovenAutomationRunHistoryPage {
  readonly automationId: string;
  readonly occurrenceId?: string;
  readonly data: readonly CovenAutomationRun[];
  readonly cursor: CovenAutomationHistoryCursor;
}

export function runHistoryPayload(
  value: Record<string, unknown>,
  automationId: string,
  occurrenceId: string | undefined,
  limit: number,
  cursor: string | undefined,
): CovenAutomationRunHistoryPage | undefined {
  if (value.automationId !== automationId ||
    (occurrenceId === undefined ? Object.hasOwn(value, 'occurrenceId') : value.occurrenceId !== occurrenceId)) {
    return undefined;
  }
  const page = runsPayload(value, automationId, limit);
  if (page === undefined) return undefined;
  const rows = page.runs;
  const position = historyPageCursor(value.cursor, cursor, rows.length, limit, RUN_HISTORY_CURSOR_MAX_LENGTH);
  if (position === undefined ||
    (occurrenceId !== undefined && !rows.every((run) => run.occurrenceId === occurrenceId)) ||
    !newestFirst(rows, (run) => run.startedAt, (run) => run.id)) return undefined;
  return { automationId, ...(occurrenceId === undefined ? {} : { occurrenceId }), data: rows, cursor: position };
}
