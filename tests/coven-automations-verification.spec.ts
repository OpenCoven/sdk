import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';

import * as coven from '@opencoven/coven-client';
import { expect, test, vi } from 'vitest';

const fixtureRoot = new URL('../packages/coven/fixtures/automations-receipt-v1/', import.meta.url);
const vectors = JSON.parse(readFileSync(new URL('receipt-integrity-validation.vectors.json', fixtureRoot), 'utf8')) as {
  cases: { caseId: string; receipt: Record<string, unknown>; expected: { outcome: string } }[];
};
const original = vectors.cases[0]!.receipt;
const context = {
  receiptId: 'receipt-daily-notes-0001', automationId: 'daily-notes', automationRevision: 1,
  occurrenceId: 'daily-notes-1756544400000', runId: 'run-daily-notes-0001',
  attemptId: 'att-daily-notes-0001-1', familiarId: 'charm',
};
const digest = { algorithm: 'sha256' as const, canonicalization: 'jcs-rfc8785' as const, value: 'a'.repeat(64) };

// Independent test input construction. Pinned producer vectors supply the primary hash oracle.
function sealed(value: Record<string, unknown>): Record<string, unknown> {
  const body = { ...value };
  delete body.integrity;
  const canonical = JSON.stringify(body, (_key, entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : entry);
  return { ...value, integrity: { ...digest, value: createHash('sha256').update(canonical).digest('hex') } };
}

test('exposes local receipt verification independently of transport configuration', () => {
  expect(coven).toHaveProperty('verifyReceipt', expect.any(Function));
});

test.each(vectors.cases)('matches the pinned producer integrity vector $caseId', ({ receipt, expected }) => {
  const result = coven.verifyReceipt(receipt, context);
  expect(result.schema).toBe('valid');
  expect(result.integrity).toBe(expected.outcome === 'accepted' ? 'valid' : 'invalid');
  expect(result.status).toBe(expected.outcome === 'accepted' ? 'unverifiable' : 'invalid');
  expect(result.receiptAuthentication).toEqual({ status: 'unverified', evidence: 'unavailable' });
  expect(result.runtimeAuthority).toEqual({ status: 'unverified', evidence: 'unavailable' });
});

test.each(Object.keys(context) as (keyof typeof context)[])('checks the explicit %s binding', (key) => {
  const result = coven.verifyReceipt(original, { ...context, [key]: key === 'automationRevision' ? 2 : 'different' });
  expect(result.status).toBe('invalid');
  expect(result.integrity).toBe('valid');
  expect(result.bindings[key]).toBe('invalid');
});

test('checks only explicitly supplied optional bindings and digest references', () => {
  const value = sealed({ ...original, deliveryDigest: digest, resultDigest: digest });
  const optional = {
    occurrenceFenceGeneration: 1, attemptNumber: 1, runtimeId: 'coven-code',
    definitionDigest: original.definitionDigest as coven.CovenAutomationReceiptDigest,
    deliveryDigest: digest, resultDigest: digest,
  };
  const result = coven.verifyReceipt(value, { ...context, ...optional });
  expect(result.status).toBe('unverifiable');
  expect(Object.values(result.bindings).every((entry) => entry === 'valid')).toBe(true);
  for (const key of Object.keys(optional) as (keyof typeof optional)[]) {
    expect(coven.verifyReceipt(value, context).bindings[key]).toBe('unavailable');
    const replacement = key.endsWith('Digest') ? { ...digest, value: '0'.repeat(64) }
      : key === 'runtimeId' ? 'different' : 2;
    const mismatch = coven.verifyReceipt(value, { ...context, ...optional, [key]: replacement });
    expect(mismatch.status).toBe('invalid');
    expect(mismatch.bindings[key]).toBe('invalid');
    const missing = { ...value };
    delete missing[key === 'runtimeId' ? 'runtime' : key];
    expect(coven.verifyReceipt(sealed(missing), { ...context, ...optional }).bindings[key]).toBe('invalid');
  }
});

test.each(['none', 'producer-hmac', 'cosign'])('does not treat the %s label as authentication evidence', (authentication) => {
  const value = { ...original, integrity: { ...(original.integrity as object), authentication } };
  const result = coven.verifyReceipt(value, context);
  expect(result.integrity).toBe('valid');
  expect(result.status).toBe('unverifiable');
  expect(result.reasons).toContain('PRODUCER_AUTHENTICATION_UNVERIFIED');
  expect(result.reasons).toContain('RUNTIME_AUTHORITY_UNVERIFIED');
});

test('detects changed payload and integrity values', () => {
  for (const value of [
    { ...original, producer: { component: 'forged', instanceId: 'forged' } },
    { ...original, integrity: digest },
  ]) {
    expect(coven.verifyReceipt(value, context)).toMatchObject({ status: 'invalid', integrity: 'invalid' });
  }
});

test('accepts safe numeric bounds and preserves well-formed Unicode without normalization', () => {
  for (const revision of [1, Number.MAX_SAFE_INTEGER]) {
    for (const familiarId of ['é', 'e\u0301', '😀', '\u0000\n"\\']) {
      const value = sealed({ ...original, automationRevision: revision, identity: { familiarId } });
      expect(coven.verifyReceipt(value, { ...context, automationRevision: revision, familiarId }).integrity).toBe('valid');
    }
  }
});

test.each([0, -0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity])(
  'rejects invalid receipt integers before hashing %#', (automationRevision) => {
    expect(coven.verifyReceipt({ ...original, automationRevision }, context)).toMatchObject({
      status: 'invalid', schema: 'invalid', integrity: 'unavailable',
    });
  },
);

test('rejects undefined, lone surrogates, unsupported fields and privacy variants', () => {
  for (const value of [
    null, undefined, [], { ...original, identity: { familiarId: '\ud800' } },
    { ...original, definitionDigest: undefined }, { ...original, integrity: { ...digest, authentication: 'verified' } },
    { ...original, unexpected: 'secret' },
    { ...original, privacy: { classification: 'restricted', retention: { classification: 'standard' } } },
    { ...original, outcome: { disposition: 'succeeded', integrity: digest } },
  ]) expect(coven.verifyReceipt(value, context)).toMatchObject({ status: 'invalid', schema: 'invalid' });
});

test('requires explicit well-formed caller bindings without borrowing receipt values', () => {
  for (const key of Object.keys(context)) {
    const missing = { ...context } as Record<string, unknown>;
    delete missing[key];
    const result = coven.verifyReceipt(original, missing as unknown as coven.CovenAutomationReceiptTrustContext);
    expect(result.status).toBe('invalid');
    expect(result.reasons).toContain('INVALID_TRUST_CONTEXT');
  }
  for (const extra of [{ runtimeDigest: digest }, { resultDigest: { ...digest, value: 'invalid' } }, { runtimeId: '' }]) {
    expect(coven.verifyReceipt(original, { ...context, ...extra }).reasons).toContain('INVALID_TRUST_CONTEXT');
  }
});

test('owns bounded input without invoking accessors or toJSON and redacts proxy failures', () => {
  const getter = vi.fn(() => { throw new Error('private bearer /private/path'); });
  const cycle: Record<string, unknown> = { ...original };
  cycle.loop = cycle;
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const dense = { ...original, runtime: { runtimeId: 'runtime', capabilities: Array.from({ length: 5_000 }, (_, index) => `cap${index}`) } };
  for (const value of [
    Object.defineProperty({ ...original }, 'receiptId', { get: getter }),
    { ...original, toJSON: getter }, new Proxy({}, { ownKeys: getter }), revoked.proxy,
    new Proxy({}, { getPrototypeOf: getter }), cycle, { ...original, extra: 'x'.repeat(300_000) }, dense,
    Object.assign(Object.create({ inherited: 'private' }) as object, original),
    { ...original, runtime: { runtimeId: 'runtime', capabilities: new Array(5_000) } },
  ]) {
    const result = coven.verifyReceipt(value, context);
    expect(result).toMatchObject({ status: 'invalid', schema: 'invalid' });
    expect(inspect(result)).not.toMatch(/private|bearer|path/);
  }
  // Proxy traps may execute; property getters and toJSON must not.
  expect(getter).toHaveBeenCalledTimes(2);
  const contextGetter = vi.fn(() => { throw new Error('private context'); });
  const unsafe = Object.defineProperty({ ...context }, 'receiptId', { get: contextGetter });
  expect(coven.verifyReceipt(original, unsafe).reasons).toContain('INVALID_TRUST_CONTEXT');
  expect(contextGetter).not.toHaveBeenCalled();
});

test('returns an immutable result with no receipt or context object references', () => {
  const value = structuredClone(original);
  const expected = { ...context };
  const result = coven.verifyReceipt(value, expected);
  const before = structuredClone(result);
  value.receiptId = 'changed';
  expected.receiptId = 'changed';
  expect(result).toEqual(before);
  for (const item of [result, result.bindings, result.reasons, result.receiptAuthentication, result.runtimeAuthority]) {
    expect(Object.isFrozen(item)).toBe(true);
  }
  expect(inspect(result)).not.toContain(context.receiptId);
});

test('client convenience never invokes transport, capability negotiation, observers or recovery', () => {
  const unavailable = vi.fn(() => { throw new Error('Unexpected runtime call'); });
  const client = new coven.CovenClient({
    transport: { health: unavailable }, automationsTransport: { capabilities: unavailable, readDefinitions: unavailable },
    operation: { observer: { onEvent: unavailable, onObserverError: unavailable } },
  });
  expect(client.requireAutomations().verifyReceipt(original, context)).toEqual(coven.verifyReceipt(original, context));
  expect(unavailable).not.toHaveBeenCalled();
});
