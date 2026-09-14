import { integer, object } from './automations-read-validation.js';
import { runsPayload, type CovenAutomationRun } from './automations-runs.js';

export type CovenAutomationOccurrenceView = 'due' | 'eligible' | 'claimed' | 'running' | 'recovery_required';

/** Global scheduler inspection, not per-automation history or cursor pagination. */
export interface CovenAutomationOccurrencesOptions {
  readonly view: CovenAutomationOccurrenceView;
  /** 1–100, default 20. */
  readonly limit?: number;
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

export interface CovenAutomationOccurrenceResult {
  readonly occurrence: CovenAutomationOccurrenceDetail | null;
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

export function occurrencesPayload(value: Record<string, unknown>, limit: number): CovenAutomationOccurrencesResult | undefined {
  if (!Array.isArray(value.occurrences) || value.occurrences.length > limit ||
    !value.occurrences.every(occurrence) ||
    new Set(value.occurrences.map((entry) => entry.id)).size !== value.occurrences.length) return undefined;
  return { occurrences: value.occurrences };
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
      record.definitionDigest !== detail.definitionDigest ||
      !['authorityProfile', 'timeoutAt'].every((key) => record[key] === null || typeof record[key] === 'string') ||
      Object.hasOwn(record, 'cancellation')) return undefined;
  }
  return { occurrence: detail as unknown as CovenAutomationOccurrenceDetail };
}
