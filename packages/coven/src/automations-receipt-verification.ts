import { createHash } from 'node:crypto';

import { canonicalAutomationJson, snapshotAutomationJson } from './automations-canonical-json.js';
import { integer, object } from './automations-read-validation.js';
import {
  isReceiptReadProjection, receiptId,
  type CovenAutomationReceipt, type CovenAutomationReceiptDigest,
} from './automations-receipts.js';

/** Explicit caller expectations; never populate these from an untrusted receipt itself. */
export interface CovenAutomationReceiptTrustContext {
  readonly receiptId: string;
  readonly automationId: string;
  readonly automationRevision: number;
  readonly occurrenceId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly familiarId: string;
  readonly occurrenceFenceGeneration?: number;
  readonly attemptNumber?: number;
  readonly runtimeId?: string;
  /** These compare digest references only; no definition, delivery or result bytes are read. */
  readonly definitionDigest?: CovenAutomationReceiptDigest;
  readonly deliveryDigest?: CovenAutomationReceiptDigest;
  readonly resultDigest?: CovenAutomationReceiptDigest;
}

export type CovenAutomationReceiptVerificationCheck = 'valid' | 'invalid' | 'unavailable';

const bindingReasons = {
  receiptId: 'RECEIPT_ID_MISMATCH', automationId: 'AUTOMATION_ID_MISMATCH',
  automationRevision: 'AUTOMATION_REVISION_MISMATCH', occurrenceId: 'OCCURRENCE_ID_MISMATCH',
  runId: 'RUN_ID_MISMATCH', attemptId: 'ATTEMPT_ID_MISMATCH', familiarId: 'FAMILIAR_ID_MISMATCH',
  occurrenceFenceGeneration: 'OCCURRENCE_FENCE_MISMATCH', attemptNumber: 'ATTEMPT_NUMBER_MISMATCH',
  runtimeId: 'RUNTIME_ID_MISMATCH', definitionDigest: 'DEFINITION_DIGEST_MISMATCH',
  deliveryDigest: 'DELIVERY_DIGEST_MISMATCH', resultDigest: 'RESULT_DIGEST_MISMATCH',
} as const;

export type CovenAutomationReceiptVerificationReason = typeof bindingReasons[keyof typeof bindingReasons] |
  'INVALID_RECEIPT' | 'INVALID_TRUST_CONTEXT' | 'INTEGRITY_MISMATCH' |
  'PRODUCER_AUTHENTICATION_UNVERIFIED' | 'RUNTIME_AUTHORITY_UNVERIFIED';

/** Local checks cannot establish authenticated provenance, authority, delivery or execution. */
export interface CovenAutomationReceiptVerification {
  readonly status: 'invalid' | 'unverifiable';
  readonly schema: 'valid' | 'invalid';
  readonly integrity: CovenAutomationReceiptVerificationCheck;
  readonly bindings: Readonly<Record<keyof CovenAutomationReceiptTrustContext, CovenAutomationReceiptVerificationCheck>>;
  readonly receiptAuthentication: { readonly status: 'unverified'; readonly evidence: 'unavailable' };
  readonly runtimeAuthority: { readonly status: 'unverified'; readonly evidence: 'unavailable' };
  readonly reasons: readonly CovenAutomationReceiptVerificationReason[];
}

const bindingKeys = Object.keys(bindingReasons) as (keyof CovenAutomationReceiptTrustContext)[];
const requiredBindings = ['receiptId', 'automationId', 'automationRevision', 'occurrenceId', 'runId', 'attemptId', 'familiarId'] as const;

function validDigest(value: unknown): boolean {
  return object(value) && Object.keys(value).length === 3 &&
    value.algorithm === 'sha256' && value.canonicalization === 'jcs-rfc8785' &&
    typeof value.value === 'string' && /^[0-9a-f]{64}$/.test(value.value);
}

function validContext(value: unknown): value is CovenAutomationReceiptTrustContext {
  if (!object(value) || requiredBindings.some((key) => !Object.hasOwn(value, key))) return false;
  return Object.entries(value).every(([key, entry]) => {
    switch (key) {
      case 'receiptId': case 'occurrenceId': case 'runId': case 'attemptId': return receiptId(entry);
      case 'automationId': return typeof entry === 'string' && entry.length <= 96 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry);
      case 'automationRevision': case 'occurrenceFenceGeneration': case 'attemptNumber': return integer(entry, 1);
      case 'familiarId': case 'runtimeId': return typeof entry === 'string' && [...entry].length >= 1 && [...entry].length <= 64;
      case 'definitionDigest': case 'deliveryDigest': case 'resultDigest': return validDigest(entry);
      default: return false;
    }
  });
}

function receiptBinding(receipt: CovenAutomationReceipt, key: keyof CovenAutomationReceiptTrustContext): unknown {
  if (key === 'familiarId') return receipt.identity.familiarId;
  if (key === 'runtimeId') return receipt.runtime?.runtimeId;
  return receipt[key];
}

/** Pure local verification. Unknown or malformed host values produce fixed, non-secret reasons. */
export function verifyReceipt(receipt: unknown, trustContext: CovenAutomationReceiptTrustContext): CovenAutomationReceiptVerification {
  const captured = snapshotAutomationJson(receipt);
  const expected = snapshotAutomationJson(trustContext);
  const schema = isReceiptReadProjection(captured) ? 'valid' : 'invalid';
  const contextValid = validContext(expected);
  const reasons: CovenAutomationReceiptVerificationReason[] = [];
  const bindings = Object.fromEntries(bindingKeys.map((key) => [key, 'unavailable'])) as
    Record<keyof CovenAutomationReceiptTrustContext, CovenAutomationReceiptVerificationCheck>;
  let integrity: CovenAutomationReceiptVerificationCheck = 'unavailable';
  if (schema === 'invalid') reasons.push('INVALID_RECEIPT');
  if (!contextValid) reasons.push('INVALID_TRUST_CONTEXT');
  if (isReceiptReadProjection(captured) && contextValid) {
    integrity = createHash('sha256').update(canonicalAutomationJson(captured, true)).digest('hex') === captured.integrity.value
      ? 'valid' : 'invalid';
    if (integrity === 'invalid') reasons.push('INTEGRITY_MISMATCH');
    for (const key of bindingKeys) {
      if (!Object.hasOwn(expected, key)) continue;
      const actual = receiptBinding(captured, key);
      const wanted: unknown = expected[key];
      const matches = object(wanted) ? object(actual) && actual.value === wanted.value : actual === wanted;
      bindings[key] = matches ? 'valid' : 'invalid';
      if (!matches) reasons.push(bindingReasons[key]);
    }
  }
  const status = reasons.length === 0 ? 'unverifiable' : 'invalid';
  reasons.push('PRODUCER_AUTHENTICATION_UNVERIFIED', 'RUNTIME_AUTHORITY_UNVERIFIED');
  return Object.freeze({
    status, schema, integrity, bindings: Object.freeze(bindings),
    receiptAuthentication: Object.freeze({ status: 'unverified', evidence: 'unavailable' }),
    runtimeAuthority: Object.freeze({ status: 'unverified', evidence: 'unavailable' }),
    reasons: Object.freeze(reasons),
  });
}
