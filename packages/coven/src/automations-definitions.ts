import { CovenClientError, normalizeCovenError } from './client-errors.js';
import { parsePolicyJson } from './policy-json.js';
import { integer, object } from './automations-read-validation.js';
import { decodeReceiptRead, receiptId, type CovenAutomationReceiptResult } from './automations-receipts.js';
import { runsPayload, type CovenAutomationRunsResult } from './automations-runs.js';
import {
  occurrencePayload, occurrencesPayload, occurrenceView,
  type CovenAutomationOccurrenceResult, type CovenAutomationOccurrencesResult, type CovenAutomationOccurrenceView,
} from './automations-occurrences.js';

/** Executable compatibility shape, not the normative rich AutomationDefinition. */
export interface CovenAutomationRoutine {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  readonly rrule: string;
  readonly timezone: string;
  readonly misfire: 'latest';
  readonly overlap: 'forbid';
  readonly timeoutMinutes: number;
  readonly runtime: string;
  readonly prompt: string;
  readonly familiarId?: string;
  readonly cwd?: string;
  readonly outputTarget?: string;
  readonly model?: string;
  readonly tags?: readonly string[];
  readonly retry?: {
    readonly maxAttempts: number;
    readonly backoffPolicy: 'none' | 'fixed' | 'exponential';
    readonly backoffSeconds?: number;
    readonly retryableClasses?: readonly ('transient_dispatch' | 'lease_expired' | 'runtime_unavailable')[];
  };
}

export interface CovenAutomationDefinitionList {
  readonly routines: readonly CovenAutomationRoutine[];
  readonly revisionById: Readonly<Record<string, number>>;
  readonly tombstonedAtById: Readonly<Record<string, string>>;
}

export type CovenAutomationDefinition =
  | { readonly routine: null }
  | {
    readonly routine: CovenAutomationRoutine;
    readonly revision: number;
    readonly tombstonedAt: string | null;
  };

export interface CovenAutomationListOptions {
  readonly includeTombstoned?: boolean;
}

export interface CovenAutomationHealth {
  readonly automationId: string;
  readonly nextDueAt: string | null;
  readonly lastPlannedAt: string | null;
  readonly lastStartedAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly consecutiveFailures: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly staleReason: string | null;
  readonly currentAttempt: number | null;
  readonly maxAttempts: number;
  readonly retryNotBefore: string | null;
  readonly consecutiveExhaustions: number;
  readonly quarantinedAt: string | null;
  readonly quarantineFailureClass: string | null;
  readonly quarantineReason: string | null;
}

export interface CovenAutomationHealthResult {
  readonly health: CovenAutomationHealth;
}

/** Read-only diagnostic actions permitted by the built-in transport. */
export type CovenAutomationDefinitionReadRequest =
  | { readonly action: 'coven.automations.definition.list.v1'; readonly includeTombstoned: boolean }
  | { readonly action: 'coven.automations.definition.get.v1'; readonly id: string }
  | { readonly action: 'coven.automations.health'; readonly id: string }
  | { readonly action: 'coven.automations.runs'; readonly id: string; readonly limit: number }
  | { readonly action: 'coven.automations.occurrence.list.v1'; readonly view: CovenAutomationOccurrenceView; readonly limit: number }
  | { readonly action: 'coven.automations.occurrence.get.v1'; readonly id: string }
  | { readonly action: 'coven.automations.receipt.get.v1'; readonly id: string };

export function definitionReadFailure(code: string, operation: string): never {
  throw new CovenClientError(normalizeCovenError({ code }, operation));
}

function routine(value: unknown): value is CovenAutomationRoutine {
  if (!object(value) || value.schemaVersion !== 1 ||
    typeof value.status !== 'string' || !['ACTIVE', 'PAUSED', 'DISABLED'].includes(value.status) ||
    value.misfire !== 'latest' || value.overlap !== 'forbid' ||
    !integer(value.timeoutMinutes, 1, 4_294_967_295) ||
    !['id', 'name', 'rrule', 'timezone', 'runtime', 'prompt'].every((key) =>
      typeof value[key] === 'string' && value[key].length > 0) ||
    !['familiarId', 'cwd', 'outputTarget', 'model'].every((key) =>
      !Object.hasOwn(value, key) || typeof value[key] === 'string') ||
    (Object.hasOwn(value, 'tags') && (!Array.isArray(value.tags) ||
      !value.tags.every((tag: unknown) => typeof tag === 'string')))) return false;
  if (!Object.hasOwn(value, 'retry')) return true;
  const retry = value.retry;
  return object(retry) && integer(retry.maxAttempts, 1, 255) &&
    typeof retry.backoffPolicy === 'string' && ['none', 'fixed', 'exponential'].includes(retry.backoffPolicy) &&
    (!Object.hasOwn(retry, 'backoffSeconds') || integer(retry.backoffSeconds, 0, 4_294_967_295)) &&
    (!Object.hasOwn(retry, 'retryableClasses') || (Array.isArray(retry.retryableClasses) &&
      retry.retryableClasses.every((entry: unknown) => typeof entry === 'string' &&
        ['transient_dispatch', 'lease_expired', 'runtime_unavailable'].includes(entry))));
}

export function definitionReadBytes(request: CovenAutomationDefinitionReadRequest): Buffer {
  const invalid = (): never => definitionReadFailure('invalid_options', 'automations.read');
  // Snapshot own data fields so an accessor cannot switch a read into a mutation.
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(request);
  } catch {
    return invalid();
  }
  const own = (key: string): unknown => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  const action = own('action');
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== (action === 'coven.automations.runs' || action === 'coven.automations.occurrence.list.v1' ? 3 : 2)) return invalid();
  if (action === 'coven.automations.occurrence.list.v1') {
    const view = own('view');
    const limit = own('limit');
    if (!occurrenceView(view) || !integer(limit, 1, 100)) return invalid();
    return Buffer.from(JSON.stringify({ action, view, limit }));
  }
  if (action === 'coven.automations.definition.list.v1' && typeof own('includeTombstoned') === 'boolean') {
    return Buffer.from(JSON.stringify({ action, includeTombstoned: own('includeTombstoned') }));
  }
  const id = own('id');
  if ((action !== 'coven.automations.definition.get.v1' && action !== 'coven.automations.health' &&
    action !== 'coven.automations.runs' && action !== 'coven.automations.occurrence.get.v1' &&
    action !== 'coven.automations.receipt.get.v1') || typeof id !== 'string' ||
    id.trim().length === 0 || Buffer.byteLength(id) > 4_096 || !id.isWellFormed()) return invalid();
  if (action === 'coven.automations.receipt.get.v1' && !receiptId(id.trim())) return invalid();
  if (action === 'coven.automations.runs') {
    const limit = own('limit');
    if (!integer(limit, 1, 100)) return invalid();
    return Buffer.from(JSON.stringify({ action, id: id.trim(), limit }));
  }
  return Buffer.from(JSON.stringify({ action, id: id.trim() }));
}

export function decodeDefinitionRead(
  status: number,
  bytes: Uint8Array,
  request: CovenAutomationDefinitionReadRequest,
  operation: string,
): CovenAutomationDefinitionList | CovenAutomationDefinition | CovenAutomationHealthResult | CovenAutomationRunsResult |
  CovenAutomationOccurrencesResult | CovenAutomationOccurrenceResult | CovenAutomationReceiptResult {
  const invalid = (): never => definitionReadFailure('invalid_response', operation);
  let value: unknown;
  try {
    value = parsePolicyJson(bytes, 16_384);
  } catch {
    return invalid();
  }
  if (!object(value) || value.action !== request.action) return invalid();
  if (request.action === 'coven.automations.receipt.get.v1') {
    return decodeReceiptRead(status, value, request.id.trim(), operation);
  }
  if (status === 400 && value.ok === false && value.accepted === false &&
    value.status === 'rejected' && typeof value.reason === 'string' &&
    !Object.hasOwn(value, 'event') && !Object.hasOwn(value, 'result')) {
    return definitionReadFailure('action_rejected', operation);
  }
  if (status !== 200 || value.ok !== true || value.accepted !== true || value.status !== 'completed' ||
    Object.hasOwn(value, 'error') || Object.hasOwn(value, 'reason') || Object.hasOwn(value, 'result') ||
    !object(value.event) || value.event.kind !== 'automations.changed' || value.event.action !== request.action ||
    !object(value.event.payload)) return invalid();
  const payload = value.event.payload;
  if (request.action === 'coven.automations.occurrence.list.v1') {
    return occurrencesPayload(payload, request.limit) ?? invalid();
  }
  if (request.action === 'coven.automations.occurrence.get.v1') {
    return occurrencePayload(payload, request.id.trim()) ?? invalid();
  }
  if (request.action === 'coven.automations.runs') {
    return runsPayload(payload, request.id.trim(), request.limit) ?? invalid();
  }
  if (request.action === 'coven.automations.health') {
    const health = payload.health;
    if (!object(health) || health.automationId !== request.id.trim() ||
      !integer(health.consecutiveFailures, 0) || !integer(health.consecutiveExhaustions, 0) ||
      !integer(health.maxAttempts, 1, 255) ||
      (health.currentAttempt !== null && !integer(health.currentAttempt, 1)) ||
      !['nextDueAt', 'lastPlannedAt', 'lastStartedAt', 'lastSuccessAt', 'leaseOwner',
        'leaseExpiresAt', 'staleReason', 'retryNotBefore', 'quarantinedAt',
        'quarantineFailureClass', 'quarantineReason'].every((key) =>
        health[key] === null || typeof health[key] === 'string')) return invalid();
    return { health: health as unknown as CovenAutomationHealth };
  }
  if (request.action === 'coven.automations.definition.get.v1') {
    if (payload.routine === null) {
      if (Object.hasOwn(payload, 'revision') || Object.hasOwn(payload, 'tombstonedAt')) return invalid();
      return { routine: null };
    }
    if (!routine(payload.routine) || payload.routine.id !== request.id.trim() || !integer(payload.revision, 1) ||
      (payload.tombstonedAt !== null && typeof payload.tombstonedAt !== 'string')) return invalid();
    return { routine: payload.routine, revision: payload.revision, tombstonedAt: payload.tombstonedAt };
  }
  if (!Array.isArray(payload.routines) || !payload.routines.every(routine) ||
    !object(payload.revisionById) || !object(payload.tombstonedAtById)) return invalid();
  const revisions = payload.revisionById;
  const tombstones = payload.tombstonedAtById;
  const ids = new Set(payload.routines.map((entry: CovenAutomationRoutine) => entry.id));
  if (ids.size !== payload.routines.length || Object.keys(revisions).length !== ids.size ||
    ![...ids].every((id) => Object.hasOwn(revisions, id) && integer(revisions[id], 1)) ||
    !Object.keys(tombstones).every((id) => ids.has(id) && typeof tombstones[id] === 'string') ||
    (!request.includeTombstoned && Object.keys(tombstones).length > 0)) return invalid();
  return {
    routines: payload.routines,
    revisionById: revisions as Record<string, number>,
    tombstonedAtById: tombstones as Record<string, string>,
  };
}
