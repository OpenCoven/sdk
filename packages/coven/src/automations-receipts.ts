import { CovenClientError, normalizeCovenError } from './client.js';
import { integer, object } from './automations-read-validation.js';

/** Hand-authored read projection of Coven 4e35dd4c99013159fcee4c1ab2f183accdf7a5f8, not generated types. */
export interface CovenAutomationReceiptDigest {
  readonly algorithm: 'sha256';
  readonly canonicalization: 'jcs-rfc8785';
  readonly value: string;
}

/** Receipt data and references, not authenticated identity, authority or outcome evidence. */
export interface CovenAutomationReceipt {
  readonly schemaVersion: 'coven.automations.v1';
  readonly receiptId: string;
  readonly automationId: string;
  readonly automationRevision: number;
  readonly definitionDigest?: CovenAutomationReceiptDigest;
  readonly occurrenceId: string;
  readonly occurrenceFenceGeneration?: number;
  readonly runId: string;
  readonly attemptId: string;
  readonly attemptNumber?: number;
  readonly identity: { readonly familiarId: string };
  readonly authority?: {
    readonly principal: { readonly principalId: string; readonly displayName?: string };
    readonly approval?: { readonly approvalPolicyRef: string; readonly approvalRecordRef?: string };
  };
  readonly runtime?: {
    readonly runtimeId: string;
    readonly capabilities: readonly string[];
    readonly model?: string;
  };
  readonly deliveryDigest?: CovenAutomationReceiptDigest;
  readonly resultDigest?: CovenAutomationReceiptDigest;
  readonly exercisedCapabilities?: readonly string[];
  readonly sideEffectClass: 'none' | 'local_read' | 'local_write' | 'external_read' |
    'external_mutation' | 'irreversible_external_mutation';
  readonly outcome: {
    readonly disposition: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'ambiguous';
    readonly failureClass?: string;
    readonly detail?: string;
    readonly partialFailures?: readonly { readonly step: string; readonly reason: string; readonly recovered?: boolean }[];
    readonly recoveryDisposition?: 'not_required' | 'recovered_inline' | 'deferred_to_operator';
  };
  readonly producedAt: string;
  readonly producer: {
    readonly component: string;
    readonly instanceId: string;
    readonly implementationVersion?: string;
  };
  readonly integrity: CovenAutomationReceiptDigest & { readonly authentication?: 'none' | 'producer-hmac' | 'cosign' };
  readonly privacy: {
    readonly classification: 'public' | 'operational';
    readonly retention: { readonly classification: 'ephemeral' | 'standard' | 'extended'; readonly deleteAfter?: string };
    readonly notes?: string;
  };
}

/** Producer-reported diagnostics only. The SDK does not independently verify these claims. */
export interface CovenAutomationReceiptReadVerification {
  readonly status: 'unverifiable';
  readonly integrity: 'valid';
  readonly correlation: 'valid';
  readonly receiptAuthentication: { readonly status: 'unverified'; readonly evidence: 'unavailable' };
  readonly runtimeAuthority: { readonly status: 'unverified'; readonly evidence: 'unavailable' };
  readonly reasons: readonly ['PRODUCER_AUTHENTICATION_UNVERIFIED', 'RUNTIME_AUTHORITY_UNVERIFIED'];
}

export interface CovenAutomationReceiptResult {
  readonly receipt: CovenAutomationReceipt;
  readonly verification: CovenAutomationReceiptReadVerification;
}

type Validator = (value: unknown) => boolean;

function shape(required: Record<string, Validator>, optional: Record<string, Validator> = {}): Validator {
  return (value) => object(value) &&
    Object.keys(value).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)) &&
    Object.entries(required).every(([key, valid]) => Object.hasOwn(value, key) && valid(value[key])) &&
    Object.entries(optional).every(([key, valid]) => !Object.hasOwn(value, key) || valid(value[key]));
}

function text(minimum: number, maximum: number): Validator {
  return (value) => typeof value === 'string' && value.isWellFormed() &&
    [...value].length >= minimum && [...value].length <= maximum;
}

function oneOf(...values: readonly string[]): Validator {
  return (value) => typeof value === 'string' && values.includes(value);
}

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function receiptId(value: unknown): value is string {
  return identifier(value, 160);
}

const positive: Validator = (value) => integer(value, 1);
// Match the producer's lexical UTC timestamp grammar without inventing date normalization.
const timestamp: Validator = (value) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
const digestFields = {
  algorithm: oneOf('sha256'), canonicalization: oneOf('jcs-rfc8785'),
  value: (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
};
const digest = shape(digestFields);

function capabilities(maximum: number): Validator {
  return (value) => Array.isArray(value) && value.length <= maximum &&
    value.every(text(1, 96)) && new Set(value).size === value.length;
}

const validReceipt = shape({
  schemaVersion: oneOf('coven.automations.v1'),
  receiptId, automationId: (value) => identifier(value, 96), automationRevision: positive,
  occurrenceId: receiptId, runId: receiptId, attemptId: receiptId,
  identity: shape({ familiarId: text(1, 64) }),
  sideEffectClass: oneOf('none', 'local_read', 'local_write', 'external_read', 'external_mutation', 'irreversible_external_mutation'),
  outcome: shape({
    disposition: oneOf('succeeded', 'failed', 'cancelled', 'timed_out', 'ambiguous'),
  }, {
    failureClass: text(0, 96), detail: text(0, 2_000),
    partialFailures: (value) => Array.isArray(value) && value.length <= 128 && value.every(shape({
      step: text(1, 128), reason: text(1, 1_000),
    }, { recovered: (entry) => typeof entry === 'boolean' })),
    recoveryDisposition: oneOf('not_required', 'recovered_inline', 'deferred_to_operator'),
  }),
  producedAt: timestamp,
  producer: shape({ component: text(1, 96), instanceId: text(1, 128) }, { implementationVersion: text(0, 64) }),
  integrity: shape(digestFields, { authentication: oneOf('none', 'producer-hmac', 'cosign') }),
  privacy: shape({
    classification: oneOf('public', 'operational'),
    retention: shape({ classification: oneOf('ephemeral', 'standard', 'extended') }, { deleteAfter: timestamp }),
  }, { notes: text(0, 500) }),
}, {
  definitionDigest: digest, occurrenceFenceGeneration: positive, attemptNumber: positive,
  authority: shape({
    principal: shape({
      principalId: (value) => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value),
    }, { displayName: text(0, 160) }),
  }, { approval: shape({ approvalPolicyRef: text(1, 200) }, { approvalRecordRef: text(0, 200) }) }),
  runtime: shape({ runtimeId: text(1, 64), capabilities: capabilities(Number.MAX_SAFE_INTEGER) }, { model: text(0, 128) }),
  deliveryDigest: digest, resultDigest: digest, exercisedCapabilities: capabilities(128),
});

const unverified = shape({ status: oneOf('unverified'), evidence: oneOf('unavailable') });
const validResult = shape({
  receipt: validReceipt,
  verification: shape({
    status: oneOf('unverifiable'), integrity: oneOf('valid'), correlation: oneOf('valid'),
    receiptAuthentication: unverified, runtimeAuthority: unverified,
    reasons: (value) => Array.isArray(value) && value.length === 2 &&
      value[0] === 'PRODUCER_AUTHENTICATION_UNVERIFIED' && value[1] === 'RUNTIME_AUTHORITY_UNVERIFIED',
  }),
});

function receiptResult(value: unknown): value is CovenAutomationReceiptResult {
  return validResult(value);
}

export function decodeReceiptRead(status: number, value: Record<string, unknown>, id: string, operation: string): CovenAutomationReceiptResult {
  const invalid = (): never => {
    throw new CovenClientError(normalizeCovenError({ code: 'invalid_response' }, operation));
  };
  const error = value.error;
  if (value.ok === false && value.accepted === false && value.status === 'rejected' &&
    !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'event') &&
    text(1, 1_000)(value.reason) && shape({
      code: oneOf('VALIDATION_FAILED', 'NOT_FOUND', 'AUTHORITY_REQUIRED', 'INTERNAL'),
      httpStatus: (entry) => entry === status, message: text(1, 1_000), retryable: (entry) => entry === false,
    })(error) && object(error)) {
    const expected = error.code === 'VALIDATION_FAILED' ? 400 : error.code === 'NOT_FOUND' ? 404
      : error.code === 'AUTHORITY_REQUIRED' ? 403 : 500;
    if (status !== expected || value.reason !== error.message) return invalid();
    throw new CovenClientError(normalizeCovenError({ code: error.code, statusCode: status, retryable: false }, operation));
  }
  if (status !== 200 || value.ok !== true || value.accepted !== true || value.status !== 'completed' ||
    Object.hasOwn(value, 'event') || Object.hasOwn(value, 'error') || Object.hasOwn(value, 'reason') ||
    !receiptResult(value.result) || value.result.receipt.receiptId !== id) return invalid();
  return value.result;
}
