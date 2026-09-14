import {
  createCovenAutomationsClient,
  type CovenAutomationReceipt,
  type CovenAutomationReceiptResult,
  type CovenAutomationDefinitionReadRequest,
} from '@opencoven/coven-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { expect, expectTypeOf, test, vi } from 'vitest';

const action = 'coven.automations.receipt.get.v1';
const digest = { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: 'a'.repeat(64) };

function receipt() {
  return {
    schemaVersion: 'coven.automations.v1', receiptId: 'receipt-1', automationId: 'morning',
    automationRevision: 1, occurrenceId: 'occurrence-1', runId: 'run-1', attemptId: 'attempt-1',
    identity: { familiarId: 'familiar-1' }, sideEffectClass: 'none',
    outcome: { disposition: 'failed' }, producedAt: '2026-09-14T00:00:00.000Z',
    producer: { component: 'coven-daemon', instanceId: 'local-authority' },
    integrity: { ...digest }, privacy: { classification: 'operational', retention: { classification: 'standard' } },
  };
}

function fullReceipt() {
  return {
    ...receipt(), definitionDigest: { ...digest }, occurrenceFenceGeneration: 1, attemptNumber: 1,
    authority: {
      principal: { principalId: 'owner:local@example', displayName: '' },
      approval: { approvalPolicyRef: 'policy', approvalRecordRef: '' },
    },
    runtime: { runtimeId: 'runtime', capabilities: ['read'], model: '' },
    deliveryDigest: { ...digest }, resultDigest: { ...digest }, exercisedCapabilities: ['read'],
    outcome: {
      disposition: 'failed', failureClass: 'runtime_authority_unsupported', detail: '',
      partialFailures: [{ step: 'dispatch', reason: 'unsupported', recovered: false }],
      recoveryDisposition: 'not_required',
    },
    producer: { ...receipt().producer, implementationVersion: '' },
    integrity: { ...digest, authentication: 'none' },
    privacy: {
      classification: 'public', retention: { classification: 'extended', deleteAfter: '2026-09-15T00:00:00Z' },
      notes: '',
    },
  };
}

function result(value: unknown = receipt()) {
  return {
    receipt: value,
    verification: {
      status: 'unverifiable', integrity: 'valid', correlation: 'valid',
      receiptAuthentication: { status: 'unverified', evidence: 'unavailable' },
      runtimeAuthority: { status: 'unverified', evidence: 'unavailable' },
      reasons: ['PRODUCER_AUTHENTICATION_UNVERIFIED', 'RUNTIME_AUTHORITY_UNVERIFIED'],
    },
  };
}

function envelope(value: unknown = result()) {
  return { ok: true, accepted: true, action, status: 'completed', result: value };
}

function setup(value: unknown = envelope(), status = 200) {
  const transport = {
    capabilities: vi.fn<(context: OperationContext) => Promise<{ status: number; body: Buffer }>>()
      .mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({
        capabilities: [{
          id: 'coven.automations', label: 'Automations', adapter: 'coven-daemon', status: 'available',
          policy: 'allow', actions: [action], variantNegotiation: {
            version: 1, contractProfile: 'coven.automations.v1', description: 'Negotiation',
            supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
            experimental: [], refused: [], negotiationRules: [],
          },
        }],
      })) }),
    readDefinitions: vi.fn<(request: CovenAutomationDefinitionReadRequest, context: OperationContext) =>
      Promise<{ status: number; body: Buffer }>>()
      .mockResolvedValue({ status, body: Buffer.from(JSON.stringify(value)) }),
  };
  return { transport, client: createCovenAutomationsClient({ transport }) };
}

test('reads the exact receipt result without upgrading producer diagnostics to independent verification', async () => {
  const { client, transport } = setup();
  const value = await client.getReceipt(' receipt-1 ');
  expectTypeOf(value).toEqualTypeOf<CovenAutomationReceiptResult>();
  expectTypeOf(value.receipt).toEqualTypeOf<CovenAutomationReceipt>();
  expectTypeOf(value.verification.status).toEqualTypeOf<'unverifiable'>();
  expect(value).toEqual(result());
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action, id: ' receipt-1 ' });
  expect(Object.isFrozen(transport.readDefinitions.mock.calls[0]?.[0])).toBe(true);
  expect(transport.readDefinitions.mock.calls[0]?.[1]).toBe(transport.capabilities.mock.calls[0]?.[0]);
  expect(await setup(envelope(result(fullReceipt()))).client.getReceipt('receipt-1')).toEqual(result(fullReceipt()));
});

test.each(['', ' ', '/private/receipt', 'a:b', '-receipt', 'a'.repeat(161), '\ud800', 'a\nb'])(
  'rejects invalid canonical receipt ID before transport %#', async (id) => {
    const { client, transport } = setup();
    await expect(client.getReceipt(id)).rejects.toMatchObject({ code: 'invalid_options' });
    expect(transport.capabilities).not.toHaveBeenCalled();
    expect(transport.readDefinitions).not.toHaveBeenCalled();
  },
);

// Every object field is non-null; required fields must also survive omission.
function fieldPaths(value: Record<string, unknown>, prefix: string[] = []): string[][] {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = [...prefix, key];
    return [path, ...(typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? fieldPaths(entry as Record<string, unknown>, path) : [])];
  });
}

function changed(value: object, path: string[], replacement: unknown): object {
  const copy = structuredClone(value) as Record<string, unknown>;
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = replacement;
  return copy;
}

test.each(fieldPaths(fullReceipt()))('rejects null receipt field %j', async (...path) => {
  await expect(setup(envelope(result(changed(fullReceipt(), path, null)))).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each(fieldPaths(receipt()))('rejects missing required receipt field %j', async (...path) => {
  await expect(setup(envelope(result(changed(receipt(), path, undefined)))).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  ['schemaVersion', 1], ['schemaVersion', 'coven.automations.v2'], ['receiptId', 'other'],
  ['automationId', 'a'.repeat(97)], ['runId', '/private/run'], ['attemptId', 'a'.repeat(161)],
  ['automationRevision', 0], ['automationRevision', 1.5], ['automationRevision', Number.MAX_SAFE_INTEGER + 1],
  ['occurrenceFenceGeneration', 0], ['attemptNumber', -1], ['sideEffectClass', 'future'],
  ['automationId', 'morning\n'], ['runId', 'run-1\n'], ['attemptId', 'attempt-1\r\n'],
  ['producedAt', '2026-09-14T00:00:00+00:00'], ['producedAt', '2026-09-14T00:00:00.1Z'],
  ['producedAt', '2026-09-14T00:00:00Z\n'],
  ['exercisedCapabilities', ['read', 'read']], ['exercisedCapabilities', Array.from({ length: 129 }, (_, i) => `cap-${i}`)],
  ['exercisedCapabilities', ['']], ['extensions', {}],
])('rejects unsupported receipt field %s %#', async (key, value) => {
  await expect(setup(envelope(result({ ...fullReceipt(), [key]: value }))).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  [['identity', 'familiarId'], ''], [['identity', 'familiarId'], 'x'.repeat(65)], [['identity', 'unknown'], true],
  [['authority', 'principal', 'principalId'], '/owner'], [['authority', 'approval', 'approvalPolicyRef'], ''],
  [['authority', 'principal', 'principalId'], 'owner\n'],
  [['runtime', 'capabilities'], ['read', 'read']], [['runtime', 'capabilities'], ['a'.repeat(97)]],
  [['runtime', 'runtimeId'], ''], [['runtime', 'model'], 'a'.repeat(129)],
  [['definitionDigest', 'algorithm'], 'sha512'], [['deliveryDigest', 'canonicalization'], 'other'],
  [['resultDigest', 'value'], 'A'.repeat(64)], [['integrity', 'value'], 'a'.repeat(63)],
  [['integrity', 'value'], 'a'.repeat(64) + '\n'],
  [['integrity', 'authentication'], 'verified'], [['integrity', 'unknown'], true],
  [['outcome', 'disposition'], 'running'], [['outcome', 'detail'], 'x'.repeat(2001)],
  [['outcome', 'partialFailures'], [{ step: '', reason: 'no' }]],
  [['outcome', 'partialFailures'], [{ step: 'step', reason: 'no', recovered: null }]],
  [['outcome', 'partialFailures'], Array(129).fill({ step: 'step', reason: 'no' })],
  [['outcome', 'recoveryDisposition'], 'accepted'], [['privacy', 'classification'], 'sensitive'],
  [['privacy', 'classification'], 'restricted'], [['privacy', 'retention', 'classification'], 'forever'],
  [['producer', 'component'], ''], [['producer', 'instanceId'], 'x'.repeat(129)],
] as [string[], unknown][])('rejects malformed nested receipt field %j %#', async (path, value) => {
  await expect(setup(envelope(result(changed(fullReceipt(), path, value)))).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  { result: undefined }, { event: {} }, { error: null }, { reason: 'secret' },
  { ok: false }, { accepted: false }, { status: 'adopted' }, { action: 'coven.automations.run' },
  { result: { ...result(), receipt: null } }, { result: { ...result(), verification: null } },
  ...[
    { status: 'verified' }, { integrity: 'invalid' }, { correlation: 'unknown' },
    { reasons: [] }, { reasons: ['RUNTIME_AUTHORITY_UNVERIFIED', 'PRODUCER_AUTHENTICATION_UNVERIFIED'] },
    { receiptAuthentication: { status: 'verified', evidence: 'available' } },
    { runtimeAuthority: { status: 'unverified', evidence: 'available' } }, { admission: 'accepted' },
  ].map((change) => ({ result: { ...result(), verification: { ...result().verification, ...change } } })),
])('rejects crossed envelopes or upgraded verification labels %#', async (change) => {
  await expect(setup({ ...envelope(), ...change }).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each(fieldPaths(result().verification))('rejects missing diagnostic field %j', async (...path) => {
  const verification = changed(result().verification, path, undefined);
  await expect(setup(envelope({ ...result(), verification })).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  {}, { code: 'NOT_FOUND', httpStatus: 500, message: 'unavailable', retryable: false },
  { code: 'UNKNOWN', httpStatus: 404, message: 'unavailable', retryable: false },
  { code: 'NOT_FOUND', httpStatus: 404, message: 'unavailable', retryable: true },
  { code: 'NOT_FOUND', httpStatus: 404, message: 'different', retryable: false },
  { code: 'NOT_FOUND', httpStatus: 404, message: 'unavailable', retryable: false, details: null },
])('rejects malformed typed rejection %#', async (error) => {
  await expect(setup({
    ok: false, accepted: false, action, status: 'rejected', reason: 'unavailable', error,
  }, 404).client.getReceipt('receipt-1')).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  ['NOT_FOUND', 404], ['AUTHORITY_REQUIRED', 403], ['INTERNAL', 500], ['VALIDATION_FAILED', 400],
] as const)('preserves sanitized producer rejection %s', async (code, status) => {
  const value = {
    ok: false, accepted: false, action, status: 'rejected', reason: '/private/secret token',
    error: { code, httpStatus: status, message: '/private/secret token', retryable: false },
  };
  const { client } = setup(value, status);
  await expect(client.getReceipt('receipt-1')).rejects.toMatchObject({ code, statusCode: status, retryable: false });
  await client.getReceipt('receipt-1').catch((error: unknown) => {
    expect(String(error)).not.toContain('secret');
    expect(JSON.stringify(error)).not.toContain('/private');
  });
  await expect(setup(value, 200).client.getReceipt('receipt-1')).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(setup({ ...value, result: null }, status).client.getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test('requires exact capability and transport support and observes a shared deadline/abort scope', async () => {
  const { client, transport } = setup();
  transport.capabilities.mockResolvedValueOnce({ status: 200, body: Buffer.from('{"capabilities":[]}') });
  await expect(client.getReceipt('receipt-1')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
  await expect(createCovenAutomationsClient({ transport: { capabilities: transport.capabilities } }).getReceipt('receipt-1'))
    .rejects.toMatchObject({ code: 'unsupported_operation' });
  await expect(client.getReceipt('receipt-1', { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
  transport.readDefinitions.mockImplementationOnce(() => new Promise(() => {}));
  await expect(client.getReceipt('receipt-1', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
  expect(transport.readDefinitions.mock.calls.at(-1)?.[1].signal.aborted).toBe(true);
});

test.each([
  Buffer.alloc(16_385, 32), Buffer.from('{"ok":true,"ok":true}'), Buffer.from([0xff]),
  Buffer.from('{"result":{"receiptId":"\\ud800"}}'),
])('rejects oversized or malformed receipt response bytes %#', async (body) => {
  const { client, transport } = setup();
  transport.readDefinitions.mockResolvedValueOnce({ status: 200, body });
  await expect(client.getReceipt('receipt-1')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('preserves supported diagnostic variants, Unicode scalar bounds and safe integer endpoints', async () => {
  for (const disposition of ['succeeded', 'failed', 'cancelled', 'timed_out', 'ambiguous']) {
    const value = { ...fullReceipt(), outcome: { disposition } };
    expect(await setup(envelope(result(value))).client.getReceipt('receipt-1')).toEqual(result(value));
  }
  for (const authentication of ['none', 'producer-hmac', 'cosign']) {
    const value = {
      ...fullReceipt(), automationRevision: Number.MAX_SAFE_INTEGER, attemptNumber: Number.MAX_SAFE_INTEGER,
      identity: { familiarId: '\u{1f431}'.repeat(64) }, integrity: { ...digest, authentication },
    };
    expect(await setup(envelope(result(value))).client.getReceipt('receipt-1')).toEqual(result(value));
  }
  for (const sideEffectClass of ['none', 'local_read', 'local_write', 'external_read', 'external_mutation', 'irreversible_external_mutation']) {
    const value = { ...receipt(), sideEffectClass };
    expect(await setup(envelope(result(value))).client.getReceipt('receipt-1')).toEqual(result(value));
  }
  for (const recoveryDisposition of ['not_required', 'recovered_inline', 'deferred_to_operator']) {
    const value = { ...fullReceipt(), outcome: { ...fullReceipt().outcome, recoveryDisposition } };
    expect(await setup(envelope(result(value))).client.getReceipt('receipt-1')).toEqual(result(value));
  }
  const id = 'a'.repeat(160);
  const value = {
    ...fullReceipt(), receiptId: id, exercisedCapabilities: [], runtime: { runtimeId: 'runtime', capabilities: [] },
    privacy: { classification: 'public', retention: { classification: 'ephemeral' } },
  };
  expect(await setup(envelope(result(value))).client.getReceipt(id)).toEqual(result(value));
});
