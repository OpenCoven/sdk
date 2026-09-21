import { createHash } from 'node:crypto';

import { canonicalAutomationJson, snapshotAutomationJson, type AutomationJson } from './automations-canonical-json.js';
import { isAutomationDefinitionDocument } from './automations-definition-document.js';
import { isAutomationEvent } from './automations-events.js';
import type { CovenAutomationReceiptDigest } from './automations-receipts.js';

export type CovenAutomationDefinitionDigestResult =
  | { readonly status: 'computed'; readonly digest: CovenAutomationReceiptDigest }
  | { readonly status: 'invalid'; readonly reason: 'INVALID_DEFINITION' };

export interface CovenAutomationEventIntegrity {
  readonly schema: 'valid' | 'invalid';
  readonly integrity: 'valid' | 'invalid' | 'unavailable';
  readonly producerAuthentication: { readonly status: 'unverified'; readonly evidence: 'unavailable' };
  readonly reasons: readonly ('INVALID_EVENT' | 'INTEGRITY_ABSENT' | 'INTEGRITY_MISMATCH')[];
}

/** Internal hashing of an owned snapshot; state digests retain every integrity member. */
export function automationJsonDigest(value: AutomationJson, omitIntegrity = false): string {
  return createHash('sha256').update(canonicalAutomationJson(value, omitIntegrity)).digest('hex');
}

/** Hash a complete supplied document. This neither compares its integrity nor establishes authority. */
export function computeDefinitionDigest(definition: unknown): CovenAutomationDefinitionDigestResult {
  const owned = snapshotAutomationJson(definition, 'jcs');
  if (!isAutomationDefinitionDocument(owned)) return Object.freeze({ status: 'invalid', reason: 'INVALID_DEFINITION' });
  return Object.freeze({ status: 'computed', digest: Object.freeze({
    algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: automationJsonDigest(owned, true),
  }) });
}

/** Optional local digest consistency; a matching digest never authenticates its producer. */
export function verifyEventIntegrity(event: unknown): CovenAutomationEventIntegrity {
  const owned = snapshotAutomationJson(event, 'jcs');
  const schema = isAutomationEvent(owned) ? 'valid' : 'invalid';
  let integrity: CovenAutomationEventIntegrity['integrity'] = 'unavailable';
  const reasons: ('INVALID_EVENT' | 'INTEGRITY_ABSENT' | 'INTEGRITY_MISMATCH')[] = [];
  if (!isAutomationEvent(owned)) reasons.push('INVALID_EVENT');
  else if (owned.integrity === undefined) reasons.push('INTEGRITY_ABSENT');
  else {
    integrity = automationJsonDigest(owned, true) === owned.integrity.value ? 'valid' : 'invalid';
    if (integrity === 'invalid') reasons.push('INTEGRITY_MISMATCH');
  }
  return Object.freeze({ schema, integrity, reasons: Object.freeze(reasons),
    producerAuthentication: Object.freeze({ status: 'unverified', evidence: 'unavailable' }) });
}
