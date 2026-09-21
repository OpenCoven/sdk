import { integer, object } from './automations-read-validation.js';
import type { CovenAutomationReceiptDigest } from './automations-receipts.js';

interface Principal { readonly principalId: string; readonly displayName?: string }
interface Retention { readonly classification: 'ephemeral' | 'standard' | 'extended'; readonly deleteAfter?: string }

/** Complete v1 wire document, distinct from the legacy get() projection. No authority is implied. */
export interface CovenAutomationDefinitionDocument {
  readonly schemaVersion: 'coven.automations.v1';
  readonly automationId: string;
  readonly revision: number;
  readonly integrity: CovenAutomationReceiptDigest;
  readonly lifecycleState: 'draft' | 'paused' | 'active' | 'disabled' | 'invalid';
  readonly deletion?: { readonly tombstoned: true; readonly requestedAt: string; readonly requestedBy?: Principal; readonly reason?: string };
  readonly display: { readonly name: string; readonly description?: string; readonly tags?: readonly string[] };
  readonly trigger: { readonly variant: 'schedule'; readonly version: 1; readonly schedule: { readonly rrule: string; readonly timezone: string } };
  readonly conditions?: readonly never[];
  readonly action: { readonly variant: 'familiarInvocation'; readonly version: 1; readonly prompt: string; readonly cwd?: string };
  readonly binding: {
    readonly familiarBindingPolicy: 'exact';
    /** Required for active, paused and disabled documents by the structural validator. */
    readonly familiarId?: string;
    readonly authority: { readonly approvalPolicyRef: string; readonly approvalRecordRef?: string };
  };
  readonly runtimeRequirements?: { readonly runtimeId: string; readonly capabilities: readonly string[]; readonly model?: string };
  readonly policies: {
    readonly timeout: { readonly perRunMinutes: number };
    readonly retry: {
      readonly maxAttempts: number;
      readonly backoffPolicy: 'none' | 'fixed' | 'exponential';
      readonly backoffSeconds?: number;
      readonly retryableClasses?: readonly ('transient_dispatch' | 'lease_expired' | 'runtime_unavailable')[];
    };
    readonly concurrency: { readonly overlap: 'forbid' };
    readonly misfire: { readonly disposition: 'latest' };
    /** Reserved wire shape; hashing does not advertise delivery capability. */
    readonly delivery?: { readonly outputTarget?: string; readonly mode?: 'atomic' };
    readonly retention: { readonly occurrenceHistory: Retention; readonly runLogs?: Retention; readonly receipts?: Retention };
  };
  readonly provenance?: {
    readonly createdBy: Principal; readonly createdAt?: string; readonly updatedBy?: Principal;
    readonly updatedAt?: string; readonly importedFrom?: string;
  };
  readonly activation?: { readonly effectiveFrom?: string; readonly effectiveUntil?: string };
  readonly extensions?: Readonly<Record<string, unknown>>;
}

type Validator = (value: unknown) => boolean;
const oneOf = (...values: readonly string[]): Validator => (value) => typeof value === 'string' && values.includes(value);
const text = (min: number, max: number): Validator => (value) => typeof value === 'string' && value.isWellFormed() &&
  [...value].length >= min && [...value].length <= max;
const count = (min: number, max = Number.MAX_SAFE_INTEGER): Validator => (value) => integer(value, min, max);
const timestamp: Validator = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
const unique = (valid: Validator, max = 4_096): Validator => (value) => Array.isArray(value) && value.length <= max &&
  value.every(valid) && new Set(value).size === value.length;
function shape(required: Record<string, Validator>, optional: Record<string, Validator> = {}): Validator {
  return (value) => object(value) &&
    Object.keys(value).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)) &&
    Object.entries(required).every(([key, valid]) => Object.hasOwn(value, key) && valid(value[key])) &&
    Object.entries(optional).every(([key, valid]) => !Object.hasOwn(value, key) || valid(value[key]));
}
const principal = shape({ principalId: (value) => text(1, 128)(value) && typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value) }, { displayName: text(0, 160) });
const retention = shape({ classification: oneOf('ephemeral', 'standard', 'extended') }, { deleteAfter: timestamp });
const digest = shape({ algorithm: oneOf('sha256'), canonicalization: oneOf('jcs-rfc8785'), value: (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) });
const validDocument = shape({
  schemaVersion: oneOf('coven.automations.v1'),
  automationId: (value) => text(1, 96)(value) && typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value),
  revision: count(1), integrity: digest, lifecycleState: oneOf('draft', 'paused', 'active', 'disabled', 'invalid'),
  display: shape({ name: text(1, 160) }, { description: text(0, 2_000), tags: unique(text(1, 64), 64) }),
  trigger: shape({ variant: oneOf('schedule'), version: (value) => value === 1, schedule: shape({
    rrule: text(1, 512), timezone: (value) => text(1, 64)(value) && value !== 'local',
  }) }),
  action: shape({ variant: oneOf('familiarInvocation'), version: (value) => value === 1, prompt: text(1, 100_000) }, { cwd: text(0, 1_024) }),
  binding: shape({ familiarBindingPolicy: oneOf('exact'), authority: shape({ approvalPolicyRef: text(1, 200) }, { approvalRecordRef: text(0, 200) }) }, { familiarId: text(1, 64) }),
  policies: shape({
    timeout: shape({ perRunMinutes: count(1, 44_640) }),
    retry: shape({ maxAttempts: count(1, 10), backoffPolicy: oneOf('none', 'fixed', 'exponential') }, {
      backoffSeconds: count(1, 86_400), retryableClasses: unique(oneOf('transient_dispatch', 'lease_expired', 'runtime_unavailable')),
    }),
    concurrency: shape({ overlap: oneOf('forbid') }), misfire: shape({ disposition: oneOf('latest') }),
    retention: shape({ occurrenceHistory: retention }, { runLogs: retention, receipts: retention }),
  }, { delivery: shape({}, { outputTarget: text(0, 1_024), mode: oneOf('atomic') }) }),
}, {
  deletion: shape({ tombstoned: (value) => value === true, requestedAt: timestamp }, { requestedBy: principal, reason: text(0, 500) }),
  conditions: (value) => Array.isArray(value) && value.length === 0,
  runtimeRequirements: shape({ runtimeId: text(1, 64), capabilities: unique(text(1, 96)) }, { model: text(0, 128) }),
  provenance: shape({ createdBy: principal }, { createdAt: timestamp, updatedBy: principal, updatedAt: timestamp, importedFrom: text(0, 200) }),
  activation: shape({}, { effectiveFrom: timestamp, effectiveUntil: timestamp }),
  extensions: (value) => object(value) && Object.keys(value).every((key) => /^(x-[a-z0-9-]+|[a-z0-9.-]+\.[a-z0-9-]+\.[a-z0-9-]+)$/.test(key)),
});

/** Owned JSON only. Structural coverage excludes pinned TZ/scheduler/capability/authority semantics. */
export function isAutomationDefinitionDocument(value: unknown): value is CovenAutomationDefinitionDocument {
  if (!validDocument(value)) return false;
  const document = value as CovenAutomationDefinitionDocument;
  return (!['active', 'paused', 'disabled'].includes(document.lifecycleState) ||
    (document.runtimeRequirements !== undefined && document.binding.familiarId !== undefined)) &&
    (document.policies.retry.backoffPolicy !== 'fixed' || document.policies.retry.backoffSeconds !== undefined) &&
    (document.policies.delivery?.outputTarget === undefined || document.policies.delivery.mode !== undefined);
}
