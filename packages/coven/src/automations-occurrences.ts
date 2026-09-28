import { historyPageCursor, newestFirst, type CovenAutomationHistoryCursor } from './automations-history.js';
import { integer, object } from './automations-read-validation.js';
import { runsPayload, type CovenAutomationRun } from './automations-runs.js';

export type CovenAutomationOccurrenceView = 'due' | 'eligible' | 'claimed' | 'running' | 'recovery_required';

/** Scheduler inspection, optionally for one automation; not cursor pagination. */
export interface CovenAutomationOccurrencesOptions {
  readonly view: CovenAutomationOccurrenceView;
  /** 1–100, default 20. */
  readonly limit?: number;
  /**
   * Restricts the view to one automation. The producer applies it inside the
   * view's query, so `limit` bounds that automation's rows.
   */
  readonly automationId?: string;
}

/** Producer diagnostics; digests, leases and states do not establish authority. */
export interface CovenAutomationOccurrence {
  readonly id: string;
  readonly automationId: string;
  readonly automationRevision: number;
  readonly definitionDigest: string | null;
  readonly scheduledFor: string;
  readonly kind: string;
  readonly state: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly schedulerGeneration: number | null;
  readonly fenceGeneration: number;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CovenAutomationOccurrenceRun extends Omit<CovenAutomationRun, 'cancellation'> {
  readonly occurrenceId: string;
  readonly automationRevision: number;
  readonly definitionDigest: string | null;
  readonly authorityProfile: string | null;
  readonly timeoutAt: string | null;
}

export interface CovenAutomationOccurrenceDetail extends CovenAutomationOccurrence {
  /** At most 20 oldest runs. Truncation is explicit; no continuation cursor exists. */
  readonly runs: readonly CovenAutomationOccurrenceRun[];
  readonly runsTruncated: boolean;
}

export interface CovenAutomationOccurrencesResult {
  readonly occurrences: readonly CovenAutomationOccurrence[];
}

export interface CovenAutomationOccurrenceHistoryOptions {
  /** 1–100, default 20. */
  readonly limit?: number;
  /** An opaque `cursor.next` from an earlier page of the same automation. */
  readonly cursor?: string;
}

/**
 * One page of an automation's occurrences in every state, newest first by
 * `scheduledFor` then `id`. Shaped as an sdk-core `Page`.
 */
export interface CovenAutomationOccurrenceHistoryPage {
  readonly automationId: string;
  readonly data: readonly CovenAutomationOccurrence[];
  readonly cursor: CovenAutomationHistoryCursor;
}

export interface CovenAutomationOccurrenceResult {
  readonly occurrence: CovenAutomationOccurrenceDetail | null;
}

export interface CovenAutomationRunResult {
  /** The same projection as an occurrence detail's runs, or null when absent. */
  readonly run: CovenAutomationOccurrenceRun | null;
}

export function occurrenceView(value: unknown): value is CovenAutomationOccurrenceView {
  return typeof value === 'string' && ['due', 'eligible', 'claimed', 'running', 'recovery_required'].includes(value);
}

function occurrence(value: unknown): value is CovenAutomationOccurrence {
  return object(value) &&
    ['id', 'automationId'].every((key) => typeof value[key] === 'string' && value[key].length > 0) &&
    ['scheduledFor', 'kind', 'state', 'createdAt', 'updatedAt'].every((key) => typeof value[key] === 'string') &&
    ['definitionDigest', 'leaseOwner', 'leaseExpiresAt', 'failureReason'].every((key) =>
      value[key] === null || typeof value[key] === 'string') &&
    integer(value.automationRevision, 1) && integer(value.fenceGeneration, 0) &&
    (value.schedulerGeneration === null || integer(value.schedulerGeneration, 0));
}

export function occurrencesPayload(
  value: Record<string, unknown>,
  limit: number,
  automationId?: string,
): CovenAutomationOccurrencesResult | undefined {
  if (!Array.isArray(value.occurrences) || value.occurrences.length > limit ||
    !value.occurrences.every(occurrence) ||
    (automationId !== undefined && !value.occurrences.every((entry) => entry.automationId === automationId)) ||
    new Set(value.occurrences.map((entry) => entry.id)).size !== value.occurrences.length) return undefined;
  return { occurrences: value.occurrences };
}

export function occurrenceHistoryPayload(
  value: Record<string, unknown>,
  automationId: string,
  limit: number,
  cursor: string | undefined,
): CovenAutomationOccurrenceHistoryPage | undefined {
  const page = value.automationId === automationId ? occurrencesPayload(value, limit, automationId) : undefined;
  if (page === undefined) return undefined;
  const rows = page.occurrences;
  const position = historyPageCursor(value.cursor, cursor, rows.length, limit);
  if (position === undefined || !newestFirst(rows, (row) => row.scheduledFor, (row) => row.id)) return undefined;
  return { automationId, data: rows, cursor: position };
}

function occurrenceRunFields(record: Record<string, unknown>): boolean {
  return typeof record.occurrenceId === 'string' && record.occurrenceId.length > 0 &&
    integer(record.automationRevision, 1) &&
    (record.definitionDigest === null || typeof record.definitionDigest === 'string') &&
    ['authorityProfile', 'timeoutAt'].every((key) => record[key] === null || typeof record[key] === 'string') &&
    !Object.hasOwn(record, 'cancellation');
}

/** One run read by id, validated with the same rules as an occurrence detail's runs. */
export function runPayload(value: Record<string, unknown>, id: string): CovenAutomationRunResult | undefined {
  const run = value.run;
  if (run === null) return { run: null };
  if (!object(run) || run.id !== id || typeof run.automationId !== 'string' || run.automationId.length === 0) {
    return undefined;
  }
  const runs = runsPayload({ runs: [run] }, run.automationId, 1);
  if (runs === undefined || !occurrenceRunFields(run)) return undefined;
  return { run: run as unknown as CovenAutomationOccurrenceRun };
}

export function occurrencePayload(value: Record<string, unknown>, id: string): CovenAutomationOccurrenceResult | undefined {
  const detail = value.occurrence;
  if (detail === null) return { occurrence: null };
  if (!object(detail) || !occurrence(detail) || detail.id !== id ||
    typeof detail.runsTruncated !== 'boolean') return undefined;
  const runs = runsPayload(detail, detail.automationId, 20);
  if (runs === undefined || (detail.runsTruncated && runs.runs.length !== 20)) return undefined;
  for (const run of runs.runs) {
    const record = run as unknown as Record<string, unknown>;
    if (run.occurrenceId !== id || record.automationRevision !== detail.automationRevision ||
      record.definitionDigest !== detail.definitionDigest || !occurrenceRunFields(record)) return undefined;
  }
  return { occurrence: detail as unknown as CovenAutomationOccurrenceDetail };
}
