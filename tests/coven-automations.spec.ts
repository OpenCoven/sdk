import { EventEmitter } from 'node:events';

import {
  COVEN_DAEMON_PROTOCOL,
  createCovenAutomationsClient,
  createCovenAutomationsUnixTransport,
  isCovenClientError,
  type CovenAutomationCapabilities,
  type CovenAutomationDefinition,
  type CovenAutomationDefinitionList,
  type CovenAutomationCommandRequest,
  type CovenAutomationDefinitionReadRequest,
  type CovenAutomationHealthResult,
  type CovenAutomationListOptions,
  type CovenAutomationRunsOptions,
  type CovenAutomationRunsResult,
  type CovenAutomationOccurrenceHistoryPage,
  type CovenAutomationRunHistoryPage,
  type CovenAutomationOccurrencesOptions,
  type CovenAutomationOccurrencesResult,
  type CovenAutomationOccurrenceResult,
  type CovenAutomationOccurrenceRun,
  type CovenAutomationRunResult,
  type CovenConnectedSocket,
  type CovenDiscoveredEndpoint,
} from '@opencoven/coven-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { expect, expectTypeOf, test, vi } from 'vitest';

function advertisement() {
  return {
    capabilities: [{
      id: 'coven.automations', label: 'Coven-native routine automations',
      adapter: 'coven-daemon', status: 'available', policy: 'allow',
      actions: ['coven.automations.definition.get.v1', 'coven.automations.definition.list.v1', 'coven.automations.health', 'coven.automations.runs',
        'coven.automations.occurrence.list.v1', 'coven.automations.occurrence.get.v1', 'coven.automations.run.get.v1',
        'coven.automations.receipt.get.v1', 'coven.automations.occurrence.history.v1',
        'coven.automations.run.history.v1'],
      variantNegotiation: {
        version: 1, contractProfile: 'coven.automations.v1', description: 'Variant negotiation',
        supported: {
          triggers: [{ variant: 'schedule', profile: 'coven.automations.v1', notes: 'Scoped RRULE' }],
          conditions: [], actions: [{ variant: 'familiarInvocation' }],
          triggerPolicies: [{ variant: 'overlap.forbid' }], deliveryPolicies: [],
          retentionPolicies: [{ variant: 'retention.standard' }],
        },
        experimental: [{ variant: 'future.experimental' }],
        refused: [{ variant: 'outputTarget.atomic', reason: 'Not executable' }],
        negotiationRules: ['Unknown variants fail closed.'],
      },
    }],
  };
}

const listAction = 'coven.automations.definition.list.v1';
const getAction = 'coven.automations.definition.get.v1';
const healthAction = 'coven.automations.health';
const runsAction = 'coven.automations.runs';
const occurrencesAction = 'coven.automations.occurrence.list.v1';
const occurrenceAction = 'coven.automations.occurrence.get.v1';
const receiptAction = 'coven.automations.receipt.get.v1';

function occurrenceSnapshot() {
  return {
    id: 'occurrence-1', automationId: 'morning', automationRevision: 1, definitionDigest: null,
    scheduledFor: '2026-09-14T00:00:00Z', kind: 'schedule', state: 'planned',
    leaseOwner: null, leaseExpiresAt: null, schedulerGeneration: null, fenceGeneration: 0,
    failureReason: null, createdAt: 'created', updatedAt: 'updated',
  };
}

function occurrenceDetail() {
  return {
    ...occurrenceSnapshot(), runsTruncated: false,
    runs: [{ ...runSnapshot(), automationRevision: 1, definitionDigest: null, authorityProfile: null, timeoutAt: null }],
  };
}

test.each(['due', 'eligible', 'claimed', 'running', 'recovery_required'] as const)(
  'reads exact global occurrence view %s under one operation scope', async (view) => {
    const payload = { occurrences: [occurrenceSnapshot()] };
    const { client, transport } = readSetup(payload, occurrencesAction);
    const result = await client.occurrences({ view });
    expectTypeOf(result).toEqualTypeOf<CovenAutomationOccurrencesResult>();
    expect(result).toEqual(payload);
    const [request, context] = transport.readDefinitions.mock.calls[0]!;
    expect(request).toEqual({ action: occurrencesAction, view, limit: 20 });
    expect(Object.isFrozen(request)).toBe(true);
    expect(transport.capabilities.mock.calls[0]?.[0]).toBe(context);
    expect(await readSetup({ occurrences: [] }, occurrencesAction).client.occurrences({ view, limit: 100 }))
      .toEqual({ occurrences: [] });
  },
);

test('reads correlated occurrence detail and preserves explicit missing/truncation diagnostics', async () => {
  const payload = { occurrence: occurrenceDetail() };
  const { client, transport } = readSetup(payload, occurrenceAction);
  const result = await client.getOccurrence(' occurrence-1 ');
  expectTypeOf(result).toEqualTypeOf<CovenAutomationOccurrenceResult>();
  expectTypeOf<CovenAutomationOccurrenceRun['occurrenceId']>().toEqualTypeOf<string>();
  expect(result).toEqual(payload);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: occurrenceAction, id: ' occurrence-1 ' });
  expect(transport.readDefinitions.mock.calls[0]?.[1]).toBe(transport.capabilities.mock.calls[0]?.[0]);
  expect(await readSetup({ occurrence: null }, occurrenceAction).client.getOccurrence('missing')).toEqual({ occurrence: null });
  const detail = occurrenceDetail();
  const runs = Array.from({ length: 20 }, (_, index) => ({ ...detail.runs[0], id: `run-${index}`, attempts: [] }));
  const truncated = { occurrence: { ...detail, runs, runsTruncated: true } };
  expect(await readSetup(truncated, occurrenceAction).client.getOccurrence('occurrence-1')).toEqual(truncated);
});

test('preserves populated occurrence fields and opaque producer diagnostics', async () => {
  const occurrence = {
    ...occurrenceDetail(), kind: 'producer-kind', state: 'producer-state',
    definitionDigest: 'digest', leaseOwner: 'owner', leaseExpiresAt: 'expires', failureReason: 'reason',
    schedulerGeneration: Number.MAX_SAFE_INTEGER, fenceGeneration: Number.MAX_SAFE_INTEGER,
    runs: occurrenceDetail().runs.map((run) => ({
      ...run, definitionDigest: 'digest', authorityProfile: 'profile', timeoutAt: 'timeout', receiptId: 'reference',
    })),
  };
  expect(await readSetup({ occurrence }, occurrenceAction).client.getOccurrence('occurrence-1')).toEqual({ occurrence });
});

test.each([
  undefined, null, [], {}, 'morning', { view: 'all' }, { view: 'due', id: 'morning' },
  { view: 'due', after: 'cursor' },
  ...[0, 101, -1, 1.5, '20', null, Number.NaN, Infinity].map((limit) => ({ view: 'due', limit })),
])('rejects unsupported occurrence query before transport %#', async (query) => {
  const { client, transport } = readSetup();
  await expect(client.occurrences(query as CovenAutomationOccurrencesOptions)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

test.each([
  ...Object.keys(occurrenceSnapshot()).map((key) => ({ [key]: undefined })),
  { id: '' }, { automationId: '' }, { automationRevision: 0 }, { automationRevision: 1.5 },
  { automationRevision: Number.MAX_SAFE_INTEGER + 1 }, { definitionDigest: 5 },
  { schedulerGeneration: -1 }, { schedulerGeneration: 0.5 }, { fenceGeneration: -1 },
  { fenceGeneration: Number.MAX_SAFE_INTEGER + 1 }, { leaseOwner: false },
])('rejects malformed occurrence records in both reads %#', async (change) => {
  await expect(readSetup({ occurrences: [{ ...occurrenceSnapshot(), ...change }] }, occurrencesAction)
    .client.occurrences({ view: 'due' })).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(readSetup({ occurrence: { ...occurrenceDetail(), ...change } }, occurrenceAction)
    .client.getOccurrence('occurrence-1')).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  { id: 'other' }, { runsTruncated: undefined }, { runsTruncated: 'false' }, { runsTruncated: true },
  { runs: null }, { runs: [] , runsTruncated: true },
  ...[
    { automationId: 'other' }, { occurrenceId: 'other' }, { automationRevision: 2 },
    { definitionDigest: 'other' }, { authorityProfile: undefined }, { timeoutAt: false },
    { cancellation: {} }, { attempts: [{ ...runSnapshot().attempts[0], runId: 'other' }] },
  ].map((change) => ({ runs: [{ ...occurrenceDetail().runs[0], ...change }] })),
])('rejects uncorrelated or malformed occurrence detail %#', async (change) => {
  await expect(readSetup({ occurrence: { ...occurrenceDetail(), ...change } }, occurrenceAction)
    .client.getOccurrence('occurrence-1')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('rejects duplicate and over-limit occurrences and detail runs', async () => {
  const occurrence = occurrenceSnapshot();
  for (const occurrences of [[occurrence, occurrence], [occurrence, { ...occurrence, id: 'other' }]]) {
    await expect(readSetup({ occurrences }, occurrencesAction).client.occurrences({ view: 'due', limit: 1 }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  }
  await expect(readSetup({ occurrences: [occurrence, occurrence] }, occurrencesAction).client.occurrences({ view: 'due' }))
    .rejects.toMatchObject({ code: 'invalid_response' });
  for (const runs of [Array(21).fill(occurrenceDetail().runs[0]), Array(2).fill(occurrenceDetail().runs[0])]) {
    await expect(readSetup({ occurrence: { ...occurrenceDetail(), runs } }, occurrenceAction)
      .client.getOccurrence('occurrence-1')).rejects.toMatchObject({ code: 'invalid_response' });
  }
});

test.each([occurrencesAction, occurrenceAction])('occurrence read %s enforces capability, errors, limits and cancellation', async (action) => {
  const payload = action === occurrencesAction ? { occurrences: [] } : { occurrence: null };
  const { client, transport } = readSetup(payload, action);
  const read = (options = {}) => action === occurrencesAction
    ? client.occurrences({ view: 'due' }, options) : client.getOccurrence('occurrence-1', options);
  await read();
  const missing = advertisement();
  missing.capabilities[0]!.actions = [`${action}.unsupported`];
  transport.capabilities.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify(missing)) });
  await expect(read()).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
  await expect(read({ signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
  for (const body of [Buffer.alloc(16_385, 32), Buffer.from('{"ok":true,"ok":true}'), Buffer.from([0xff]),
    Buffer.from(JSON.stringify(readEnvelope('wrong', payload)))]) {
    transport.readDefinitions.mockResolvedValueOnce({ status: 200, body });
    await expect(read()).rejects.toMatchObject({ code: 'invalid_response' });
  }
  transport.readDefinitions.mockResolvedValueOnce({ status: 400, body: Buffer.from(JSON.stringify({
    ok: false, accepted: false, action, status: 'rejected', reason: '/private/store',
  })) });
  await expect(read()).rejects.toMatchObject({ code: 'action_rejected' });
  transport.readDefinitions.mockImplementationOnce(() => new Promise(() => {}));
  await expect(read({ timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
});

function runSnapshot() {
  return {
    id: 'run-1', automationId: 'morning', occurrenceId: 'occurrence-1', sessionId: null,
    familiarId: null, runtime: null, status: 'running', exitCode: null, logJson: null,
    outputCommit: null, startedAt: '2026-09-14T00:00:00Z', finishedAt: null, receiptId: null,
    attempts: [{
      id: 'attempt-1', runId: 'run-1', occurrenceId: 'occurrence-1', attemptNumber: 1,
      adoptionKey: 'adoption-1', occurrenceFenceGeneration: 1, dispatchGeneration: 0,
      state: 'adopted', failureClass: null, priorAttemptNumber: null, priorDisposition: null,
      retryClassification: 'initial', notBefore: '2026-09-14T00:00:00Z',
      sessionId: null, stateReason: null, openedAt: '2026-09-14T00:00:00Z', settledAt: null,
    }],
  };
}

test('reads canonical bounded run history under one operation scope', async () => {
  const payload = { runs: [runSnapshot()] };
  const { client, transport } = readSetup(payload, runsAction);
  const result = await client.runs(' morning ');
  expectTypeOf(result).toEqualTypeOf<CovenAutomationRunsResult>();
  expectTypeOf<CovenAutomationRunsOptions>().toEqualTypeOf<{ readonly limit?: number }>();
  expect(result).toEqual(payload);
  const [request, context] = transport.readDefinitions.mock.calls[0]!;
  expect(request).toEqual({ action: runsAction, id: ' morning ', limit: 20 });
  expect(Object.isFrozen(request)).toBe(true);
  expect(transport.capabilities.mock.calls[0]?.[0]).toBe(context);
  expect(await readSetup({ runs: [] }, runsAction).client.runs('missing', { limit: 100 })).toEqual({ runs: [] });
});

test('preserves legacy runs and populated retry/cancellation diagnostics without inventing authority', async () => {
  const first = runSnapshot().attempts[0]!;
  const payload = { runs: [{
    ...runSnapshot(), status: 'producer-status', exitCode: -1, receiptId: 'receipt-ref',
    logJson: 'opaque text, not necessarily JSON', outputCommit: 'producer-output',
    sessionId: 'session-2', familiarId: 'familiar-1', runtime: 'coven-code', finishedAt: 'finished',
    attempts: [
      { ...first, state: 'failed', failureClass: 'runtime_unavailable', settledAt: 'settled', stateReason: 'reason' },
      {
        ...first, id: 'attempt-2', adoptionKey: 'adoption-2', attemptNumber: 2, priorAttemptNumber: 1,
        priorDisposition: 'failed', retryClassification: 'automatic_retry', sessionId: 'session-2',
        occurrenceFenceGeneration: Number.MAX_SAFE_INTEGER, dispatchGeneration: Number.MAX_SAFE_INTEGER,
      },
    ],
    cancellation: {
      scope: 'run', requestedBy: { principalId: 'owner-local' }, status: 'cancelled',
      requestedAt: 'requested', reason: 'operator request', acknowledgedAt: 'ack', reconciledAt: 'reconciled',
    },
  }, {
    ...runSnapshot(), id: 'legacy-run', occurrenceId: null, attempts: [],
  }] };
  const result = await readSetup(payload, runsAction).client.runs('morning');
  expect(result).toEqual(payload);
  expect(result.runs[0]).not.toHaveProperty('automationRevision');
  expect(result.runs[0]).not.toHaveProperty('definitionDigest');
  expect(result.runs[0]).not.toHaveProperty('authorityProfile');
});

test.each([
  {}, { scope: 'attempt' }, { requestedBy: null }, { requestedBy: {} },
  { requestedBy: { principalId: 1 } }, { status: 'invented' }, { requestedAt: null },
  { reason: null }, { acknowledgedAt: null }, { reconciledAt: null },
])('rejects malformed cancellation projections %#', async (change) => {
  const cancellation = {
    scope: 'run', requestedBy: { principalId: 'owner-local' }, status: 'requested', requestedAt: 'requested',
    ...change,
  };
  const payload = { runs: [{ ...runSnapshot(), cancellation: Object.keys(change).length === 0 ? {} : cancellation }] };
  await expect(readSetup(payload, runsAction).client.runs('morning')).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each(['requested', 'stopping', 'cancelled', 'recovery_required', 'rejected'])(
  'preserves minimal cancellation status %s with absent optional fields', async (status) => {
    const payload = { runs: [{
      ...runSnapshot(), cancellation: { scope: 'run', requestedBy: { principalId: 'owner' }, status, requestedAt: 'now' },
    }] };
    expect(await readSetup(payload, runsAction).client.runs('morning')).toEqual(payload);
  },
);

test.each([null, [], '20', 20])('refuses malformed run query %#', async (query) => {
  const { client, transport } = readSetup({ runs: [] }, runsAction);
  await expect(client.runs('morning', query as CovenAutomationRunsOptions)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test.each([null, [], {}, { runs: null }, { runs: {} }])('refuses noncanonical history payload %#', async (payload) => {
  await expect(readSetup(payload, runsAction).client.runs('morning')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('run history refuses crossed envelopes and sanitizes canonical rejections', async () => {
  const { client, transport } = readSetup({ runs: [] }, getAction);
  await expect(client.runs('morning')).rejects.toMatchObject({ code: 'invalid_response' });
  transport.readDefinitions.mockResolvedValue({
    status: 400,
    body: Buffer.from(JSON.stringify({
      ok: false, accepted: false, action: runsAction, status: 'rejected', reason: '/private/store',
    })),
  });
  await expect(client.runs('morning')).rejects.toMatchObject({
    code: 'action_rejected', normalized: { operation: 'automations.runs' },
  });
  await expect(client.runs('morning')).rejects.not.toThrow('/private/store');
});

test.each([0, 101, -1, 1.5, NaN, Infinity, '20', null])('refuses invalid run limits before I/O %#', async (limit) => {
  const { client, transport } = readSetup({ runs: [] }, runsAction);
  await expect(client.runs('morning', { limit: limit as number })).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

test.each([
  ...Object.keys(runSnapshot()).map((key) => ({ [key]: undefined })),
  { automationId: 'other' }, { id: '' }, { exitCode: 1.5 }, { exitCode: Number.MAX_SAFE_INTEGER + 1 },
  { attempts: null }, { receiptId: 2 }, { cancellation: null },
])('rejects malformed or crossed run history fields %#', async (change) => {
  await expect(readSetup({ runs: [{ ...runSnapshot(), ...change }] }, runsAction).client.runs('morning'))
    .rejects.toMatchObject({ code: 'invalid_response', normalized: { operation: 'automations.runs' } });
});

test.each([
  ...Object.keys(runSnapshot().attempts[0]!).map((key) => ({ [key]: undefined })),
  { runId: 'other' }, { occurrenceId: 'other' }, { attemptNumber: 0 }, { attemptNumber: 11 },
  { occurrenceFenceGeneration: 0 }, { dispatchGeneration: -1 }, { dispatchGeneration: 1.1 },
  { state: 'invented' }, { failureClass: 'invented' }, { retryClassification: 'invented' },
  { priorAttemptNumber: 1 }, { priorDisposition: 'failed' },
])('rejects malformed or uncorrelated attempts %#', async (change) => {
  const run = runSnapshot();
  run.attempts = [{ ...run.attempts[0]!, ...change }] as typeof run.attempts;
  await expect(readSetup({ runs: [run] }, runsAction).client.runs('morning'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test('rejects duplicate runs/attempts and histories exceeding the requested limit', async () => {
  const run = runSnapshot();
  await expect(readSetup({ runs: [run, run] }, runsAction).client.runs('morning'))
    .rejects.toMatchObject({ code: 'invalid_response' });
  await expect(readSetup({ runs: [run, { ...run, id: 'run-2', attempts: [] }] }, runsAction).client.runs('morning', { limit: 1 }))
    .rejects.toMatchObject({ code: 'invalid_response' });
  await expect(readSetup({ runs: [{ ...run, attempts: [run.attempts[0], run.attempts[0]] }] }, runsAction).client.runs('morning'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test('run history gates fresh capabilities, cancellation, timeout and bounded strict JSON', async () => {
  const { client, transport } = readSetup({ runs: [] }, runsAction);
  await client.runs('morning');
  transport.capabilities.mockResolvedValueOnce({
    status: 200, body: Buffer.from(JSON.stringify({ capabilities: [] })),
  });
  await expect(client.runs('morning')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
  await expect(setup().client.runs('morning')).rejects.toMatchObject({ code: 'unsupported_operation' });
  await expect(client.runs('morning', {}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
  for (const body of [Buffer.alloc(16_385, 32), Buffer.from('{"runs":[],"runs":[]}'), Buffer.from([0xff])]) {
    transport.readDefinitions.mockResolvedValueOnce({ status: 200, body });
    await expect(client.runs('morning')).rejects.toMatchObject({ code: 'invalid_response' });
  }
  transport.readDefinitions.mockImplementationOnce(() => new Promise(() => {}));
  await expect(client.runs('morning', {}, { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
});

function healthSnapshot() {
  return {
    automationId: 'morning', nextDueAt: null, lastPlannedAt: null, lastStartedAt: null,
    lastSuccessAt: null, consecutiveFailures: 0, leaseOwner: null, leaseExpiresAt: null,
    staleReason: null, currentAttempt: null, maxAttempts: 1, retryNotBefore: null,
    consecutiveExhaustions: 0, quarantinedAt: null, quarantineFailureClass: null, quarantineReason: null,
  };
}

test('reads canonical health with nullable fields under the shared operation scope', async () => {
  const payload = { health: healthSnapshot() };
  const { client, transport } = readSetup(payload, healthAction);
  const result = await client.health(' morning ');
  expectTypeOf(result).toEqualTypeOf<CovenAutomationHealthResult>();
  expect(result).toEqual(payload);
  const [request, context] = transport.readDefinitions.mock.calls[0]!;
  expect(request).toEqual({ action: healthAction, id: ' morning ' });
  expect(Object.isFrozen(request)).toBe(true);
  expect(transport.capabilities.mock.calls[0]?.[0]).toBe(context);
});

test('preserves populated health, retry and quarantine fields without interpreting authority', async () => {
  const health = Object.fromEntries(Object.entries(healthSnapshot()).map(([key, value]) =>
    [key, value === null ? (key === 'currentAttempt' ? 2 : 'producer value') : value]));
  Object.assign(health, { consecutiveFailures: Number.MAX_SAFE_INTEGER, consecutiveExhaustions: 3, maxAttempts: 255 });
  expect(await readSetup({ health }, healthAction).client.health('morning')).toEqual({ health });
});

test.each([
  ...Object.keys(healthSnapshot()).map((key) => ({ [key]: undefined })),
  { automationId: 'other' }, { nextDueAt: 42 }, { leaseOwner: {} }, { quarantineReason: false },
  { currentAttempt: 0 }, { currentAttempt: -1 }, { currentAttempt: 1.5 },
  { currentAttempt: Number.MAX_SAFE_INTEGER + 1 }, { maxAttempts: 0 }, { maxAttempts: 256 },
  { maxAttempts: 1.5 }, { consecutiveFailures: -1 }, { consecutiveFailures: 1.5 },
  { consecutiveFailures: Number.MAX_SAFE_INTEGER + 1 }, { consecutiveExhaustions: -1 },
  { consecutiveExhaustions: Number.MAX_SAFE_INTEGER + 1 },
])('rejects malformed, missing, unsafe or crossed health fields %#', async (change) => {
  await expect(readSetup({ health: { ...healthSnapshot(), ...change } }, healthAction).client.health('morning'))
    .rejects.toMatchObject({ code: 'invalid_response', normalized: { operation: 'automations.health' } });
});

test.each([null, [], {}, { routine: null }, { health: null }, { health: [] }])(
  'rejects noncanonical health payload %#', async (payload) => {
    await expect(readSetup(payload, healthAction).client.health('morning'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  },
);

test('gates health on its own fresh action and preserves unsupported transports', async () => {
  const { client, transport } = readSetup({ health: healthSnapshot() }, healthAction);
  await client.health('morning');
  const value = advertisement();
  value.capabilities[0]!.actions = [listAction, getAction];
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(value)) });
  await expect(client.health('morning')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
  await expect(setup().client.health('morning')).rejects.toMatchObject({ code: 'unsupported_operation' });
});

test('health rejects crossed envelopes and sanitizes missing-routine rejections', async () => {
  const { client, transport } = readSetup({ health: healthSnapshot() }, getAction);
  await expect(client.health('morning')).rejects.toMatchObject({ code: 'invalid_response' });
  transport.readDefinitions.mockResolvedValue({
    status: 400, body: Buffer.from(JSON.stringify({
      ok: false, accepted: false, action: healthAction, status: 'rejected', reason: '/private/database',
    })),
  });
  await expect(client.health('morning')).rejects.toMatchObject({
    code: 'action_rejected', normalized: { operation: 'automations.health' },
  });
  await expect(client.health('morning')).rejects.not.toThrow('/private/database');
});

test('health shares cancellation and bounded JSON behavior', async () => {
  const { client, transport } = readSetup({ health: healthSnapshot() }, healthAction);
  await expect(client.health('morning', { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
  expect(transport.capabilities).not.toHaveBeenCalled();
  transport.readDefinitions.mockResolvedValue({ status: 200, body: Buffer.alloc(16_385) });
  await expect(client.health('morning')).rejects.toMatchObject({ code: 'invalid_response' });
  transport.readDefinitions.mockImplementation(() => new Promise(() => {}));
  await expect(client.health('morning', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
  expect(transport.readDefinitions.mock.calls.at(-1)?.[1].signal.aborted).toBe(true);
});

function routine() {
  return {
    schemaVersion: 1, id: 'morning', name: 'Morning', status: 'PAUSED',
    rrule: 'FREQ=DAILY;BYHOUR=9', timezone: 'utc', misfire: 'latest',
    overlap: 'forbid', timeoutMinutes: 30, runtime: 'coven-code', prompt: 'Read the report.',
  };
}

function definitionList() {
  return { routines: [routine()], revisionById: { morning: 2 }, tombstonedAtById: {} };
}

function definitionGet() {
  return { routine: routine(), revision: 2, tombstonedAt: null };
}

function readEnvelope(action: string, payload: unknown) {
  return {
    ok: true, accepted: true, action, status: 'completed',
    event: { kind: 'automations.changed', action, payload },
  };
}

function readSetup(value: unknown = definitionList(), action: string = listAction, status = 200) {
  const transport = {
    capabilities: vi.fn<(context: OperationContext) => Promise<{ status: number; body: Buffer }>>()
      .mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(advertisement())) }),
    readDefinitions: vi.fn<(request: CovenAutomationDefinitionReadRequest, context: OperationContext) =>
      Promise<{ status: number; body: Buffer }>>()
      .mockResolvedValue({ status, body: Buffer.from(JSON.stringify(readEnvelope(action, value))) }),
  };
  return { transport, client: createCovenAutomationsClient({ transport }) };
}

test('lists compatibility routines with exact revision and tombstone maps, not rich definitions', async () => {
  const { client, transport } = readSetup();
  const result = await client.list();
  expectTypeOf(result).toEqualTypeOf<CovenAutomationDefinitionList>();
  expect(result).toEqual(definitionList());
  const [request, context] = transport.readDefinitions.mock.calls[0]!;
  expect(request).toEqual({ action: listAction, includeTombstoned: false });
  expect(Object.isFrozen(request)).toBe(true);
  expect(transport.capabilities.mock.calls[0]?.[0]).toBe(context);
  expect(context.deadline).toBeTypeOf('number');
});

test('gets a tombstoned routine without hiding it or upgrading it to an active definition', async () => {
  const payload = { ...definitionGet(), tombstonedAt: '2026-09-14T00:00:00Z' };
  const { client, transport } = readSetup(payload, getAction);
  const result = await client.get(' morning ');
  expectTypeOf(result).toEqualTypeOf<CovenAutomationDefinition>();
  expect(result).toEqual(payload);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: getAction, id: ' morning ' });
});

test('preserves producer missing result and empty list', async () => {
  expect(await readSetup({ routine: null }, getAction).client.get('missing')).toEqual({ routine: null });
  expect(await readSetup({ routines: [], revisionById: {}, tombstonedAtById: {} }).client.list()).toEqual({
    routines: [], revisionById: {}, tombstonedAtById: {},
  });
});

test('includes tombstones only on explicit request', async () => {
  const payload = { ...definitionList(), tombstonedAtById: { morning: '2026-09-14T00:00:00Z' } };
  const { client, transport } = readSetup(payload);
  expect(await client.list({ includeTombstoned: true })).toEqual(payload);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: listAction, includeTombstoned: true });
  await expect(client.list()).rejects.toMatchObject({ code: 'invalid_response' });
});

test('preserves optional compatibility fields and retry metadata', async () => {
  const payload = {
    ...definitionGet(),
    routine: {
      ...routine(), familiarId: 'reader', cwd: '/work/project', outputTarget: 'reserved',
      model: 'example', tags: ['read'], retry: {
        maxAttempts: 3, backoffPolicy: 'fixed', backoffSeconds: 5, retryableClasses: ['runtime_unavailable'],
      },
    },
  };
  expect(await readSetup(payload, getAction).client.get('morning')).toEqual(payload);
  payload.routine.retry = { maxAttempts: 1, backoffPolicy: 'none' } as typeof payload.routine.retry;
  expect(await readSetup(payload, getAction).client.get('morning')).toEqual(payload);
});

test.each([
  { routines: null }, { revisionById: null }, { tombstonedAtById: [] },
  { routines: [routine(), routine()] }, { revisionById: {} },
  { revisionById: { morning: 0 } }, { revisionById: { morning: Number.MAX_SAFE_INTEGER + 1 } },
  { revisionById: { other: 2 } }, { revisionById: { morning: 2, other: 3 } },
  { tombstonedAtById: { other: 'date' } }, { tombstonedAtById: { morning: null } },
])('rejects malformed or uncorrelated list metadata %#', async (change) => {
  await expect(readSetup({ ...definitionList(), ...change }).client.list({ includeTombstoned: true }))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  { routine: null, revision: 1 }, { routine: null, tombstonedAt: null },
  { revision: undefined }, { revision: 0 }, { revision: 1.5 },
  { tombstonedAt: undefined }, { tombstonedAt: false },
  { routine: { ...routine(), id: 'other' } }, { routine: [] },
])('rejects malformed get or crossed ID %#', async (change) => {
  await expect(readSetup({ ...definitionGet(), ...change }, getAction).client.get('morning'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  { schemaVersion: 'coven.automations.v1' }, { status: 'ACTIVEISH' }, { status: {} },
  { misfire: 'all' }, { overlap: 'allow' }, { timeoutMinutes: 0 }, { id: '' },
  { name: null }, { rrule: null }, { timezone: null }, { prompt: null }, { runtime: null },
  { familiarId: null }, { cwd: null }, { model: null }, { outputTarget: null },
  { tags: null }, { tags: [1] }, { retry: null }, { retry: {} },
  { retry: { maxAttempts: 256, backoffPolicy: 'none' } },
  { retry: { maxAttempts: 2, backoffPolicy: 'unknown' } },
  { retry: { maxAttempts: 2, backoffPolicy: 'fixed', backoffSeconds: -1 } },
  { retry: { maxAttempts: 2, backoffPolicy: 'fixed', retryableClasses: null } },
  { retry: { maxAttempts: 2, backoffPolicy: 'fixed', retryableClasses: ['unknown'] } },
])('rejects incompatible compatibility routine shape %#', async (change) => {
  await expect(readSetup({
    ...definitionGet(), routine: { ...routine(), ...change },
  }, getAction).client.get('morning')).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  null, { ok: false }, { accepted: false }, { action: getAction }, { status: 'rejected' },
  { error: {} }, { reason: 'secret' }, { result: {} }, { event: null },
  { event: { kind: 'wrong', action: listAction, payload: definitionList() } },
  { event: { kind: 'automations.changed', action: getAction, payload: definitionList() } },
])('rejects invalid read response envelope %#', async (change) => {
  const { client, transport } = readSetup();
  const value = change === null ? null : { ...readEnvelope(listAction, definitionList()), ...change };
  transport.readDefinitions.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(value)) });
  await expect(client.list()).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  Buffer.from('{"ok":true,"ok":false}'), Buffer.from([0xff]), Buffer.alloc(16_385),
  Buffer.from('{"bad":"\\ud800"}'), Buffer.from('[]'), Buffer.from('{}'),
])('rejects invalid raw bounded JSON %#', async (body) => {
  const { client, transport } = readSetup();
  transport.readDefinitions.mockResolvedValue({ status: 200, body });
  await expect(client.list()).rejects.toMatchObject({ code: 'invalid_response' });
});

test('maps canonical rejection without leaking daemon reasons', async () => {
  const { client, transport } = readSetup();
  transport.readDefinitions.mockResolvedValue({
    status: 400, body: Buffer.from(JSON.stringify({
      ok: false, accepted: false, action: listAction, status: 'rejected', reason: '/private/database',
    })),
  });
  await expect(client.list()).rejects.toMatchObject({
    code: 'action_rejected', normalized: { operation: 'automations.list' },
  });
  await expect(client.list()).rejects.not.toThrow('/private/database');
});

test.each([400, 403, 404, 500])('rejects HTTP %i success-shaped bodies', async (status) => {
  await expect(readSetup(definitionList(), listAction, status).client.list())
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each(['missing', 'planned', 'unnegotiated', 'action_missing'])('gates reads on fresh advertisement: %s', async (kind) => {
  const { client, transport } = readSetup();
  const entry = advertisement().capabilities[0]!;
  const value = { capabilities: kind === 'missing' ? [] : [{
    ...entry, ...(kind === 'planned' ? { status: 'planned' } : {}),
    ...(kind === 'unnegotiated' ? { variantNegotiation: undefined } : {}),
    ...(kind === 'action_missing' ? { actions: [] } : {}),
  }] };
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(value)) });
  await expect(client.list()).rejects.toMatchObject({ code: 'capability_unsupported' });
  await expect(client.health('morning')).rejects.toMatchObject({ code: 'capability_unsupported' });
  await expect(client.runs('morning')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

test('does not cache an earlier capability advertisement or require a read hook for capabilities', async () => {
  const { client, transport } = readSetup();
  await client.list();
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from('{"capabilities":[]}') });
  await expect(client.list()).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).toHaveBeenCalledOnce();
  const old = setup();
  await expect(old.client.list()).rejects.toMatchObject({ code: 'unsupported_operation' });
  expect(old.capabilities).not.toHaveBeenCalled();
});

test.each(['', '  ', '\ud800', 'x'.repeat(4_097), null, 42])('refuses invalid read IDs before I/O %#', async (id) => {
  const { client, transport } = readSetup();
  await expect(client.get(id as string)).rejects.toMatchObject({ code: 'invalid_options' });
  await expect(client.health(id as string)).rejects.toMatchObject({ code: 'invalid_options' });
  await expect(client.runs(id as string)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test.each([null, [], { includeTombstoned: null }, { includeTombstoned: 'yes' }])('validates list options %#', async (query) => {
  const { client, transport } = readSetup();
  await expect(client.list(query as CovenAutomationListOptions)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test('shares deadline and abort scope across discovery and reading', async () => {
  const { client, transport } = readSetup();
  const controller = new AbortController();
  controller.abort();
  await expect(client.list({}, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  expect(transport.capabilities).not.toHaveBeenCalled();
  transport.readDefinitions.mockImplementation(() => new Promise(() => {}));
  await expect(client.list({}, { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
  expect(transport.readDefinitions.mock.calls[0]?.[1].signal.aborted).toBe(true);
});

function setup(value: unknown = advertisement(), status = 200) {
  const capabilities = vi.fn(() => Promise.resolve({ status, body: Buffer.from(JSON.stringify(value)) }));
  const client = createCovenAutomationsClient({ transport: { capabilities } });
  return { client, capabilities };
}

test('reads advertised profile without upgrading experimental or refused variants', async () => {
  const { client, capabilities } = setup();
  const result = await client.capabilities();
  expectTypeOf(result).toEqualTypeOf<CovenAutomationCapabilities>();
  expect(result).toEqual({
    status: 'available', policy: 'allow', actions: advertisement().capabilities[0]?.actions,
    variantNegotiation: advertisement().capabilities[0]?.variantNegotiation,
  });
  expect(capabilities).toHaveBeenCalledOnce();
  expect(capabilities.mock.calls[0]).toHaveLength(1);
});

test.each([
  [{ capabilities: [] }, 'not_advertised'],
  [{ capabilities: [{ ...advertisement().capabilities[0], status: 'planned' }] }, 'planned'],
  [{ capabilities: [{ ...advertisement().capabilities[0], variantNegotiation: undefined }] }, 'profile_missing'],
])('reports unavailable advertisement truthfully', async (value, reason) => {
  expect(await setup(value).client.capabilities()).toEqual({ status: 'unavailable', reason });
});

test.each([
  null, {}, { capabilities: {} }, { capabilities: [null] },
  { capabilities: [...advertisement().capabilities, ...advertisement().capabilities] },
  ...['actions', 'policy', 'status', 'label', 'adapter'].map((key) => ({
    capabilities: [{ ...advertisement().capabilities[0], [key]: null }],
  })),
  ...['label', 'adapter'].flatMap((key) => [undefined, 42].map((value) => ({
    capabilities: [{ ...advertisement().capabilities[0], [key]: value }],
  }))),
  ...[
    { version: 2 }, { contractProfile: 'unknown' }, { description: null },
    { supported: {} }, { supported: { ...advertisement().capabilities[0]?.variantNegotiation.supported, actions: [null] } },
    { experimental: [{ variant: '' }] }, { experimental: [{ variant: 'x', profile: 1 }] },
    { experimental: [{ variant: 'x', notes: false }] },
    { refused: [{ variant: 'x', reason: null }] }, { negotiationRules: [1] },
  ].map((change) => ({
    capabilities: [{
      ...advertisement().capabilities[0],
      variantNegotiation: { ...advertisement().capabilities[0]?.variantNegotiation, ...change },
    }],
  })),
])('rejects malformed or incompatible catalog %#', async (value) => {
  await expect(setup(value).client.capabilities()).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([404, 403, 500])('does not confuse HTTP %i with a missing advertisement', async (status) => {
  await expect(setup(advertisement(), status).client.capabilities()).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(16_385),
  Buffer.from('{"capabilities":[],"capabilities":[]}'),
  Buffer.from('{"capabilities":[],"capabilit\\u0069es":[]}'),
  Buffer.from(JSON.stringify(advertisement()).replace('"policy":"allow"', '"policy":"requiresApproval","policy":"allow"')),
  Buffer.from(JSON.stringify(advertisement()).replace('"version":1', '"version":2,"version":1')),
])('rejects invalid or oversized bytes %#', async (body) => {
  const client = createCovenAutomationsClient({
    transport: { capabilities: () => Promise.resolve({ status: 200, body }) },
  });
  await expect(client.capabilities()).rejects.toMatchObject({ code: 'invalid_response' });
});

test('supports cancellation, bounded deadlines, and redacts transport failures', async () => {
  const { client, capabilities } = setup();
  await expect(client.capabilities({ signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
  expect(capabilities).not.toHaveBeenCalled();
  const hanging = createCovenAutomationsClient({
    transport: { capabilities: () => new Promise(() => {}) },
    operation: { timeoutMs: 10 },
  });
  await expect(hanging.capabilities()).rejects.toMatchObject({ code: 'timeout' });
  const failed = createCovenAutomationsClient({
    transport: { capabilities: () => Promise.reject(new Error('/private/secret.sock')) },
  });
  try {
    await failed.capabilities();
    expect.unreachable();
  } catch (error) {
    expect(isCovenClientError(error)).toBe(true);
    expect(String(error)).not.toContain('secret');
    expect(error).not.toHaveProperty('cause');
  }
});

class Socket extends EventEmitter implements CovenConnectedSocket {
  connecting = false;
  destroyed = false;
  paused = false;
  writes: string[] = [];
  status = 200;
  response = Buffer.from(JSON.stringify(advertisement()));
  write(value: Uint8Array | string): boolean {
    this.writes.push(Buffer.from(value).toString());
    queueMicrotask(() => this.emit('data', Buffer.concat([
      Buffer.from(`HTTP/1.1 ${this.status} Response\r\nContent-Length: ${this.response.length}\r\n\r\n`), this.response,
    ])));
    return true;
  }
  pause(): this { this.paused = true; return this; }
  resume(): this { this.paused = false; return this; }
  end(): this { return this; }
  destroy(): this { this.destroyed = true; return this; }
}

const endpoint: CovenDiscoveredEndpoint = {
  version: 1, protocol: COVEN_DAEMON_PROTOCOL, source: 'coven_home',
  endpoint: { kind: 'unix', path: '/example/coven.sock' },
};

function unixSetup(uid = 501) {
  const socket = new Socket();
  const inspectConnected = vi.fn(() => {
    expect(socket.paused).toBe(true);
    expect(socket.writes).toEqual([]);
    return Promise.resolve({ uid });
  });
  const transport = createCovenAutomationsUnixTransport(endpoint, {
    security: { platform: 'unix', peerIdentity: { inspectConnected } },
    dependencies: {
      getEffectiveUid: () => 501,
      lstat: () => Promise.resolve({
        device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true,
      }),
      connect: () => {
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      },
    },
  });
  return { socket, inspectConnected, transport, client: createCovenAutomationsClient({ transport }) };
}

test.skipIf(process.platform === 'win32')('Unix reader authenticates before sending only the canonical GET', async () => {
  const { client, socket, inspectConnected } = unixSetup();
  expect(await client.capabilities()).toMatchObject({ status: 'available' });
  expect(inspectConnected).toHaveBeenCalledOnce();
  expect(socket.writes).toEqual([
    'GET /api/v1/capabilities HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  ]);
  expect(socket.destroyed).toBe(true);
});

test.skipIf(process.platform === 'win32')('Unix reader refuses a mismatched connected peer before sending bytes', async () => {
  const { client, socket } = unixSetup(502);
  await expect(client.capabilities()).rejects.toMatchObject({ code: 'owner_mismatch' });
  expect(socket.writes).toEqual([]);
  expect(socket.destroyed).toBe(true);
});

test.skipIf(process.platform === 'win32').each([
  { action: listAction, includeTombstoned: true },
  { action: getAction, id: ' morning ' },
  { action: healthAction, id: ' morning ' },
  { action: runsAction, id: ' morning ', limit: 20 },
  { action: occurrencesAction, view: 'due', limit: 20 },
  { action: occurrenceAction, id: ' occurrence-1 ' },
  { action: receiptAction, id: ' receipt-1 ' },
  { action: getAction, id: 'é\r\nInjected: true' },
])('Unix read transport authenticates and sends only allowlisted JSON actions %#', async (request) => {
  const { transport, socket, inspectConnected } = unixSetup();
  socket.response = Buffer.from(JSON.stringify(readEnvelope(request.action, definitionGet())));
  const result = await transport.readDefinitions!(request as CovenAutomationDefinitionReadRequest, {
    signal: new AbortController().signal, deadline: undefined,
  });
  expect(result.status).toBe(200);
  expect(inspectConnected).toHaveBeenCalledOnce();
  const body = JSON.stringify({ ...request, ...('id' in request ? { id: request.id?.trim() } : {}) });
  expect(socket.writes).toEqual([
    'POST /api/v1/actions HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\n' +
    'Content-Type: application/json\r\nConnection: close\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  ]);
  expect(socket.destroyed).toBe(true);
});

test.skipIf(process.platform === 'win32').each([getAction, healthAction, occurrenceAction, receiptAction] as const)('Unix read transport never sends %s to an untrusted peer', async (action) => {
  const { transport, socket } = unixSetup(502);
  await expect(transport.readDefinitions!({ action, id: 'morning' }, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toBeDefined();
  expect(socket.writes).toEqual([]);
});

test.skipIf(process.platform === 'win32')('Unix history transport refuses untrusted peers before writing', async () => {
  const { transport, socket } = unixSetup(502);
  await expect(transport.readDefinitions!({ action: runsAction, id: 'morning', limit: 1 }, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toBeDefined();
  expect(socket.writes).toEqual([]);
});

test.skipIf(process.platform === 'win32').each([
  null, {}, { action: 'coven.automations.definition.create.v1', id: 'morning' },
  { action: 'coven.automations.health.v1', id: 'morning' },
  { action: 'coven.automations.unquarantine', id: 'morning' },
  { action: 'coven.automations.runs.v1', id: 'morning', limit: 20 },
  { action: runsAction, id: 'morning' },
  { action: runsAction, id: 'morning', limit: 0 },
  { action: runsAction, id: 'morning', limit: 101 },
  { action: runsAction, id: 'morning', limit: '20' },
  { action: runsAction, id: 'morning', limit: 20, receiptId: 'secret' },
  { action: occurrencesAction, view: 'all', limit: 20 },
  { action: occurrencesAction, view: 'due', limit: 0 },
  { action: occurrencesAction, view: 'due', limit: 101 },
  { action: occurrencesAction, view: 'due', limit: 20, id: 'morning' },
  { action: occurrencesAction, get view() { throw new Error('accessor must not run'); }, limit: 20 },
  { action: occurrenceAction, id: 'occurrence-1', limit: 20 },
  { action: receiptAction, id: 'receipt-1', limit: 20 },
  { action: receiptAction, id: '/private/receipt' },
  { action: receiptAction, id: 'a'.repeat(161) },
  { action: receiptAction, get id() { throw new Error('accessor must not run'); } },
  { action: runsAction, id: 'morning', get limit() { throw new Error('accessor must not run'); } },
  { action: getAction, id: 'morning', definition: {} }, { action: getAction, id: '' },
  { action: listAction, includeTombstoned: 'true' },
  Object.create({ action: getAction, id: 'morning' }) as unknown,
  { get action() { throw new Error('accessor must not run'); }, id: 'morning' },
  new Proxy({}, { ownKeys() { throw new Error('proxy must fail closed'); } }),
])('direct read transport rejects malformed requests and mutations before I/O %#', async (request) => {
  const { transport, socket, inspectConnected } = unixSetup();
  await expect(transport.readDefinitions!(request as CovenAutomationDefinitionReadRequest, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toMatchObject({ code: 'invalid_options' });
  expect(socket.writes).toEqual([]);
  expect(inspectConnected).not.toHaveBeenCalled();
});

const lifecycleEnvelope = () => ({
  action: 'coven.automations.command.v1',
  envelope: {
    schemaVersion: 'coven.automations.v1', command: 'definition.pause.v1', adoptionKey: 'adopt:pause:morning',
    expectedRevision: 2, origin: { principal: { principalId: 'principal:owner' }, channel: 'sdk' },
    intent: { statement: 'Pause it.' }, payload: { automationId: 'morning' },
  },
});

test.skipIf(process.platform === 'win32').each([
  ['another envelope command', (value: ReturnType<typeof lifecycleEnvelope>) => { value.envelope.command = 'legacy.import.v1'; }],
  ['a create envelope', (value: ReturnType<typeof lifecycleEnvelope>) => { value.envelope.command = 'definition.create.v1'; }],
  ['an extra request field', (value: ReturnType<typeof lifecycleEnvelope>) => { (value as Record<string, unknown>).origin = 'x'; }],
  ['an extra envelope field', (value: ReturnType<typeof lifecycleEnvelope>) => { (value.envelope as Record<string, unknown>).extra = 1; }],
  ['a flat action', (value: ReturnType<typeof lifecycleEnvelope>) => { value.action = 'coven.automations.definition.pause.v1'; }],
  ['a non-sdk channel', (value: ReturnType<typeof lifecycleEnvelope>) => { (value.envelope.origin as Record<string, unknown>).channel = 'cli'; }],
  ['a tombstone reason', (value: ReturnType<typeof lifecycleEnvelope>) => {
    value.envelope.command = 'definition.tombstone.v1';
    (value.envelope.payload as Record<string, unknown>).reason = 'Gone.';
  }],
])('direct command transport refuses %s before I/O', async (_label, change) => {
  const { transport, socket, inspectConnected } = unixSetup();
  const request = lifecycleEnvelope();
  change(request);
  await expect(transport.sendCommand!(request as unknown as CovenAutomationCommandRequest, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toMatchObject({ code: 'invalid_options' });
  expect(socket.writes).toEqual([]);
  expect(inspectConnected).not.toHaveBeenCalled();
});

test.skipIf(process.platform === 'win32')('read transport rejects oversized response without exposing partial results', async () => {
  const { transport, socket } = unixSetup();
  socket.response = Buffer.alloc(16_385);
  await expect(transport.readDefinitions!({ action: listAction, includeTombstoned: false }, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toMatchObject({ code: 'body_limit' });
  expect(socket.destroyed).toBe(true);
});

test.skipIf(process.platform === 'win32').each(['get', 'health', 'runs', 'occurrences', 'getOccurrence'] as const)('client %s reads through two independently authenticated Unix connections', async (method) => {
  const action = method === 'get' ? getAction : method === 'health' ? healthAction : method === 'runs' ? runsAction
    : method === 'occurrences' ? occurrencesAction : occurrenceAction;
  const payload = method === 'get' ? definitionGet() : method === 'health' ? { health: healthSnapshot() } : method === 'runs' ? { runs: [runSnapshot()] }
    : method === 'occurrences' ? { occurrences: [occurrenceSnapshot()] } : { occurrence: occurrenceDetail() };
  const sockets: Socket[] = [];
  const inspectConnected = vi.fn((socket: CovenConnectedSocket) => {
    expect(socket).toBe(sockets.at(-1));
    expect(sockets.at(-1)?.writes).toEqual([]);
    return Promise.resolve({ uid: 501 });
  });
  const transport = createCovenAutomationsUnixTransport(endpoint, {
    security: { platform: 'unix', peerIdentity: { inspectConnected } },
    dependencies: {
      getEffectiveUid: () => 501,
      lstat: () => Promise.resolve({
        device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true,
      }),
      connect: () => {
        const socket = new Socket();
        socket.response = Buffer.from(JSON.stringify(sockets.length === 0
          ? advertisement() : readEnvelope(action, payload)));
        sockets.push(socket);
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      },
    },
  });
  const client = createCovenAutomationsClient({ transport });
  expect(await (method === 'occurrences' ? client.occurrences({ view: 'due' })
    : client[method](method === 'getOccurrence' ? 'occurrence-1' : 'morning'))).toEqual(payload);
  expect(sockets).toHaveLength(2);
  expect(inspectConnected).toHaveBeenCalledTimes(2);
  expect(sockets[0]?.writes[0]).toMatch(/^GET \/api\/v1\/capabilities /);
  expect(sockets[1]?.writes[0]).toMatch(/^POST \/api\/v1\/actions /);
  expect(sockets.every((socket) => socket.destroyed)).toBe(true);
});

test.skipIf(process.platform === 'win32').each([
  ['NOT_FOUND', 404], ['AUTHORITY_REQUIRED', 403], ['INTERNAL', 500],
] as const)('receipt client preserves %s through independently authenticated Unix connections', async (code, status) => {
  const sockets: Socket[] = [];
  const inspectConnected = vi.fn(() => Promise.resolve({ uid: 501 }));
  const transport = createCovenAutomationsUnixTransport(endpoint, {
    security: { platform: 'unix', peerIdentity: { inspectConnected } },
    dependencies: {
      getEffectiveUid: () => 501,
      lstat: () => Promise.resolve({
        device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true,
      }),
      connect: () => {
        const socket = new Socket();
        if (sockets.length > 0) {
          socket.status = status;
          socket.response = Buffer.from(JSON.stringify({
            ok: false, accepted: false, action: receiptAction, status: 'rejected', reason: '/private/receipt',
            error: { code, httpStatus: status, message: '/private/receipt', retryable: false },
          }));
        }
        sockets.push(socket);
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      },
    },
  });
  await expect(createCovenAutomationsClient({ transport }).getReceipt(' receipt-1 '))
    .rejects.toMatchObject({ code, statusCode: status, retryable: false });
  expect(sockets).toHaveLength(2);
  expect(inspectConnected).toHaveBeenCalledTimes(2);
  expect(sockets[0]?.writes[0]).toMatch(/^GET \/api\/v1\/capabilities /);
  expect(sockets[1]?.writes[0]).toContain(`{"action":"${receiptAction}","id":"receipt-1"}`);
  expect(sockets.every((socket) => socket.destroyed)).toBe(true);
});

test.skipIf(process.platform === 'win32').each([
  [undefined, 'invalid_options'],
  [{ signal: new AbortController().signal, deadline: Number.NaN }, 'invalid_options'],
  [{ signal: new AbortController().signal, deadline: 0 }, 'timeout'],
])('direct transport validates operation context before I/O %#', async (context, code) => {
  const { transport, socket, inspectConnected } = unixSetup();
  await expect(transport.capabilities(context as OperationContext)).rejects.toMatchObject({ code });
  expect(inspectConnected).not.toHaveBeenCalled();
  expect(socket.writes).toEqual([]);
});

test.skipIf(process.platform === 'win32')('direct transport supplies a bounded default deadline', async () => {
  const { transport } = unixSetup();
  const result = await transport.capabilities({ signal: new AbortController().signal, deadline: undefined });
  expect(result.status).toBe(200);
});

test.skipIf(process.platform === 'win32')('Unix reader bounds response bodies before decoding', async () => {
  const { socket, client } = unixSetup();
  socket.response = Buffer.alloc(16_385);
  await expect(client.capabilities()).rejects.toMatchObject({ code: 'body_limit' });
  expect(socket.destroyed).toBe(true);
});

test('Unix factory rejects Windows endpoints without I/O', () => {
  expect(() => createCovenAutomationsUnixTransport({
    ...endpoint, endpoint: { kind: 'windowsNamedPipe', path: '\\\\.\\pipe\\coven' },
  }, {
    security: { platform: 'unix', peerIdentity: { inspectConnected: () => Promise.resolve({ uid: 501 }) } },
  })).toThrow();
});

test('Unix factory rejects Unix endpoints on Windows before I/O', () => {
  const connect = vi.fn();
  const lstat = vi.fn();
  const inspectConnected = vi.fn();
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    expect(() => createCovenAutomationsUnixTransport(endpoint, {
      security: { platform: 'unix', peerIdentity: { inspectConnected } },
      dependencies: { connect, lstat },
    })).toThrow(expect.objectContaining({ code: 'unsupported_platform' }));
    expect(connect).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    expect(inspectConnected).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

const runAction = 'coven.automations.run.get.v1';

function runDetail() {
  return { ...runSnapshot(), automationRevision: 1, definitionDigest: null, authorityProfile: null, timeoutAt: null };
}

test('filters an occurrence view by automation and sends the trimmed id', async () => {
  const payload = { occurrences: [occurrenceSnapshot()] };
  const { client, transport } = readSetup(payload, occurrencesAction);
  expect(await client.occurrences({ view: 'due', automationId: ' morning ', limit: 5 })).toEqual(payload);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({
    action: occurrencesAction, view: 'due', limit: 5, automationId: ' morning ',
  });
});

test('refuses a filtered occurrence page that names another automation', async () => {
  const payload = { occurrences: [occurrenceSnapshot(), { ...occurrenceSnapshot(), id: 'occurrence-2', automationId: 'evening' }] };
  await expect(readSetup(payload, occurrencesAction).client.occurrences({ view: 'claimed', automationId: 'morning' }))
    .rejects.toMatchObject({ code: 'invalid_response' });
  // The unfiltered view accepts the same mixed page.
  expect(await readSetup(payload, occurrencesAction).client.occurrences({ view: 'claimed' })).toEqual(payload);
});

test.each(['', '   ', 5, null, ['morning']])('rejects automationId %j before transport', async (automationId) => {
  const { client, transport } = readSetup();
  await expect(client.occurrences({ view: 'due', automationId } as unknown as CovenAutomationOccurrencesOptions))
    .rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

test('reads one run by id with its attempts, and absence explicitly', async () => {
  const payload = { run: runDetail() };
  const { client, transport } = readSetup(payload, runAction);
  const result = await client.getRun(' run-1 ');
  expectTypeOf(result).toEqualTypeOf<CovenAutomationRunResult>();
  expect(result).toEqual(payload);
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: runAction, id: ' run-1 ' });
  expect(await readSetup({ run: null }, runAction).client.getRun('missing')).toEqual({ run: null });
});

test.each([
  ['another run', { id: 'run-2' }],
  ['no automation', { automationId: '' }],
  ['no occurrence', { occurrenceId: '' }],
  ['a bad revision', { automationRevision: 0 }],
  ['a non-string digest', { definitionDigest: 5 }],
  ['a non-string authority profile', { authorityProfile: 7 }],
  ['a cancellation projection', { cancellation: null }],
  ['too many attempts', { attempts: Array.from({ length: 11 }, () => runSnapshot().attempts[0]) }],
])('rejects a run read with %s', async (_label, change) => {
  await expect(readSetup({ run: { ...runDetail(), ...change } }, runAction).client.getRun('run-1'))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test('does not read a run when the producer does not advertise the action', async () => {
  const { client, transport } = readSetup({ run: runDetail() }, runAction);
  const advertised = advertisement();
  advertised.capabilities[0]!.actions = advertised.capabilities[0]!.actions.filter((action) => action !== runAction);
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(advertised)) });
  await expect(client.getRun('run-1')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

const historyAction = 'coven.automations.occurrence.history.v1';

function historyRow(day: number, state = 'planned') {
  return {
    ...occurrenceSnapshot(), id: `morning-${day}`, state,
    scheduledFor: `2026-09-${String(day).padStart(2, '0')}T09:00:00.000Z`,
  };
}

function historyCursorFor(row: { scheduledFor: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.scheduledFor, row.id])).toString('base64url');
}

function historyPage(rows: readonly unknown[], cursor: Record<string, unknown>) {
  return { automationId: 'morning', occurrences: rows, cursor };
}

test('reads one page of an automation\'s history and sends the trimmed id', async () => {
  const rows = [historyRow(5), historyRow(4, 'succeeded')];
  const next = historyCursorFor(rows[1]!);
  const { client, transport } = readSetup(historyPage(rows, { hasMore: true, next }), historyAction);
  const result = await client.occurrenceHistory(' morning ', { limit: 2 });
  expectTypeOf(result).toEqualTypeOf<CovenAutomationOccurrenceHistoryPage>();
  expect(result).toEqual({ automationId: 'morning', data: rows, cursor: { hasMore: true, next } });
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: historyAction, automationId: ' morning ', limit: 2 });
  expect(Object.isFrozen(transport.readDefinitions.mock.calls[0]?.[0])).toBe(true);
});

test('reads a later page by cursor and requires the producer to echo it', async () => {
  const cursor = historyCursorFor(historyRow(4));
  const rows = [historyRow(3, 'failed')];
  const { client, transport } = readSetup(historyPage(rows, { hasMore: false, current: cursor }), historyAction);
  expect(await client.occurrenceHistory('morning', { cursor })).toEqual({
    automationId: 'morning', data: rows, cursor: { hasMore: false, current: cursor },
  });
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: historyAction, automationId: 'morning', limit: 20, cursor });
});

test('iterates every page newest first within maxPages', async () => {
  const rows = [5, 4, 3, 2, 1].map((day) => historyRow(day));
  const { client, transport } = readSetup();
  transport.readDefinitions.mockImplementation((request) => {
    const read = request as { cursor?: string; limit: number };
    const start = read.cursor === undefined ? 0 : rows.findIndex((row) => historyCursorFor(row) === read.cursor) + 1;
    const slice = rows.slice(start, start + read.limit);
    const more = start + read.limit < rows.length;
    const cursor = {
      hasMore: more,
      ...(read.cursor === undefined ? {} : { current: read.cursor }),
      ...(more ? { next: historyCursorFor(slice.at(-1)!) } : {}),
    };
    return Promise.resolve({
      status: 200, body: Buffer.from(JSON.stringify(readEnvelope(historyAction, historyPage(slice, cursor)))),
    });
  });
  const seen: string[] = [];
  for await (const occurrence of client.iterateOccurrenceHistory('morning', { limit: 2, maxPages: 5 })) {
    seen.push(occurrence.id);
  }
  expect(seen).toEqual(['morning-5', 'morning-4', 'morning-3', 'morning-2', 'morning-1']);
  expect(transport.readDefinitions).toHaveBeenCalledTimes(3);

  const bounded: string[] = [];
  for await (const occurrence of client.iterateOccurrenceHistory('morning', { limit: 2, maxPages: 1 })) {
    bounded.push(occurrence.id);
  }
  expect(bounded).toEqual(['morning-5', 'morning-4']);
  expect(() => client.iterateOccurrenceHistory('morning', { limit: 2 } as never)).toThrow(/maxPages or a caller-owned signal/u);
});

test('orders mixed-precision history by instant, not text', async () => {
  // Manual rows carry nanoseconds, scheduled rows milliseconds.
  const rows = [
    { ...historyRow(1), id: 'manual-ns', scheduledFor: '2026-09-10T09:00:00.123100000Z' },
    { ...historyRow(1), id: 'scheduled-ms', scheduledFor: '2026-09-10T09:00:00.123Z' },
    { ...historyRow(1), id: 'tie-b', scheduledFor: '2026-09-09T09:00:00.500000000Z' },
    { ...historyRow(1), id: 'tie-a', scheduledFor: '2026-09-09T09:00:00.500Z' },
    { ...historyRow(1), id: 'whole-second', scheduledFor: '2026-09-08T09:00:00Z' },
  ];
  expect((await readSetup(historyPage(rows, { hasMore: false }), historyAction).client.occurrenceHistory('morning'))
    .data.map((row) => row.id)).toEqual(['manual-ns', 'scheduled-ms', 'tie-b', 'tie-a', 'whole-second']);
  await expect(readSetup(historyPage([rows[1], rows[0]], { hasMore: false }), historyAction).client
    .occurrenceHistory('morning')).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(readSetup(historyPage([rows[3], rows[2]], { hasMore: false }), historyAction).client
    .occurrenceHistory('morning')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('accepts a full history page above the 16 KiB read cap', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...historyRow(1), id: `morning-${String(999 - index).padStart(3, '0')}`, failureReason: 'x'.repeat(200),
  }));
  const page = historyPage(rows, { hasMore: false });
  expect(Buffer.byteLength(JSON.stringify(readEnvelope(historyAction, page)))).toBeGreaterThan(16_384);
  const { client } = readSetup(page, historyAction);
  expect((await client.occurrenceHistory('morning', { limit: 100 })).data).toHaveLength(100);
  const { client: oversized, transport } = readSetup();
  transport.readDefinitions.mockResolvedValue({ status: 200, body: Buffer.alloc(262_145, 32) });
  await expect(oversized.occurrenceHistory('morning')).rejects.toMatchObject({ code: 'invalid_response' });
});

const historyCursor = historyCursorFor(historyRow(9));
test.each([
  ['another automation id', { automationId: 'evening' }, undefined],
  ['a row from another automation', { occurrences: [{ ...historyRow(5), automationId: 'evening' }] }, undefined],
  ['rows oldest first', { occurrences: [historyRow(4), historyRow(5)] }, undefined],
  ['a repeated row', { occurrences: [historyRow(5), historyRow(5)] }, undefined],
  ['more rows than the limit', { occurrences: [historyRow(5), historyRow(4), historyRow(3)] }, undefined],
  ['no cursor', { cursor: undefined }, undefined],
  ['hasMore without next', { cursor: { hasMore: true } }, undefined],
  ['next without hasMore', { cursor: { hasMore: false, next: historyCursor } }, undefined],
  ['a malformed next', { cursor: { hasMore: true, next: 'not a cursor' } }, undefined],
  ['a short page claiming more', { occurrences: [historyRow(5)], cursor: { hasMore: true, next: historyCursor } }, undefined],
  ['an unknown cursor field', { cursor: { hasMore: false, previous: historyCursor } }, undefined],
  ['a current on the first page', { cursor: { hasMore: false, current: historyCursor } }, undefined],
  ['no current echo', { cursor: { hasMore: false } }, historyCursor],
  ['a different current', { cursor: { hasMore: false, current: historyCursorFor(historyRow(8)) } }, historyCursor],
  ['a next equal to the cursor', { cursor: { hasMore: true, current: historyCursor, next: historyCursor } }, historyCursor],
])('rejects a history page with %s', async (_label, change, cursor) => {
  const page = { ...historyPage([historyRow(5), historyRow(4)], { hasMore: false }), ...change };
  const { client } = readSetup(page, historyAction);
  await expect(client.occurrenceHistory('morning', { limit: 2, ...(cursor === undefined ? {} : { cursor }) }))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  ['an empty id', '', {}],
  ['a blank id', '   ', {}],
  ['a zero limit', 'morning', { limit: 0 }],
  ['an extra field', 'morning', { view: 'due' }],
  ['a padded cursor', 'morning', { cursor: `${historyCursor}=` }],
  ['a non-string cursor', 'morning', { cursor: 7 }],
  ['a cursor over 512 characters', 'morning', { cursor: 'A'.repeat(516) }],
  ['a non-canonical cursor', 'morning', { cursor: 'AB' }],
])('rejects history with %s before transport', async (_label, automationId, query) => {
  const { client, transport } = readSetup();
  await expect(client.occurrenceHistory(automationId, query as never)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

test('does not read history when the producer does not advertise the action', async () => {
  const { client, transport } = readSetup(historyPage([], { hasMore: false }), historyAction);
  const advertised = advertisement();
  advertised.capabilities[0]!.actions = advertised.capabilities[0]!.actions.filter((action) => action !== historyAction);
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(advertised)) });
  await expect(client.occurrenceHistory('morning')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

const runHistoryAction = 'coven.automations.run.history.v1';

function runRow(id: string, startedAt: string, occurrenceId: string | null = 'occurrence-1') {
  return { ...runSnapshot(), id, occurrenceId, startedAt, attempts: [] };
}

function runPage(runs: readonly unknown[], cursor: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { automationId: 'morning', ...extra, runs, cursor };
}

test('reads a page of run history, optionally for one occurrence', async () => {
  const rows = [runRow('run-3', '2026-09-14T00:00:03.000Z'), runRow('run-2', '2026-09-14T00:00:02.000Z')];
  const next = historyCursorFor({ scheduledFor: rows[1]!.startedAt, id: rows[1]!.id });
  const { client, transport } = readSetup(runPage(rows, { hasMore: true, next }), runHistoryAction);
  const result = await client.runHistory(' morning ', { limit: 2 });
  expectTypeOf(result).toEqualTypeOf<CovenAutomationRunHistoryPage>();
  expect(result).toEqual({ automationId: 'morning', data: rows, cursor: { hasMore: true, next } });
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: runHistoryAction, automationId: ' morning ', limit: 2 });

  const filtered = readSetup(runPage(rows, { hasMore: false, current: next }, { occurrenceId: 'occurrence-1' }), runHistoryAction);
  expect(await filtered.client.runHistory('morning', { occurrenceId: ' occurrence-1 ', cursor: next })).toEqual({
    automationId: 'morning', occurrenceId: 'occurrence-1', data: rows, cursor: { hasMore: false, current: next },
  });
  expect(filtered.transport.readDefinitions.mock.calls[0]?.[0]).toEqual({
    action: runHistoryAction, automationId: 'morning', limit: 20, occurrenceId: ' occurrence-1 ', cursor: next,
  });
});

test('orders mixed-precision run history by instant and iterates within maxPages', async () => {
  const rows = [
    runRow('run-e', '2026-09-03T09:00:00Z', null),
    runRow('run-d', '2026-09-02T09:00:00.000000000Z'),
    runRow('run-c', '2026-09-02T09:00:00.000Z'),
    runRow('run-b', '2026-09-01T09:00:00.100500000Z'),
    runRow('run-a', '2026-09-01T09:00:00.100Z'),
  ];
  expect((await readSetup(runPage(rows, { hasMore: false }), runHistoryAction).client.runHistory('morning'))
    .data.map((run) => run.id)).toEqual(['run-e', 'run-d', 'run-c', 'run-b', 'run-a']);
  await expect(readSetup(runPage([rows[4], rows[3]], { hasMore: false }), runHistoryAction).client.runHistory('morning'))
    .rejects.toMatchObject({ code: 'invalid_response' });

  const { client, transport } = readSetup();
  transport.readDefinitions.mockImplementation((request) => {
    const read = request as { cursor?: string; limit: number };
    const start = read.cursor === undefined ? 0
      : rows.findIndex((row) => historyCursorFor({ scheduledFor: row.startedAt, id: row.id }) === read.cursor) + 1;
    const slice = rows.slice(start, start + read.limit);
    const more = start + read.limit < rows.length;
    const last = slice.at(-1)!;
    const cursor = {
      hasMore: more,
      ...(read.cursor === undefined ? {} : { current: read.cursor }),
      ...(more ? { next: historyCursorFor({ scheduledFor: last.startedAt, id: last.id }) } : {}),
    };
    return Promise.resolve({
      status: 200, body: Buffer.from(JSON.stringify(readEnvelope(runHistoryAction, runPage(slice, cursor)))),
    });
  });
  const seen: string[] = [];
  for await (const run of client.iterateRunHistory('morning', { limit: 2, maxPages: 5 })) seen.push(run.id);
  expect(seen).toEqual(['run-e', 'run-d', 'run-c', 'run-b', 'run-a']);
  expect(transport.readDefinitions).toHaveBeenCalledTimes(3);
});

const runHistoryCursor = historyCursorFor({ scheduledFor: '2026-09-09T00:00:00Z', id: 'run-9' });
test.each([
  ['another automation id', { automationId: 'evening' }, {}],
  ['an unrequested occurrence echo', { occurrenceId: 'occurrence-1' }, {}],
  ['no occurrence echo when filtered', {}, { occurrenceId: 'occurrence-1' }],
  ['a run of another occurrence', { occurrenceId: 'occurrence-1', runs: [runRow('run-2', '2026-09-14T00:00:02Z', 'occurrence-2')] },
    { occurrenceId: 'occurrence-1' }],
  ['a run of another automation', { runs: [{ ...runRow('run-2', '2026-09-14T00:00:02Z'), automationId: 'evening' }] }, {}],
  ['more runs than the limit', { runs: [runRow('run-3', '2026-09-14T00:00:03Z'), runRow('run-2', '2026-09-14T00:00:02Z'),
    runRow('run-1', '2026-09-14T00:00:01Z')] }, {}],
  ['hasMore without next', { cursor: { hasMore: true } }, {}],
  ['a next over 256 characters', { cursor: { hasMore: true, next: 'A'.repeat(300) } }, {}],
  ['no current echo', { cursor: { hasMore: false } }, { cursor: runHistoryCursor }],
])('rejects a run history page with %s', async (_label, change, query) => {
  const page = { ...runPage([runRow('run-2', '2026-09-14T00:00:02Z'), runRow('run-1', '2026-09-14T00:00:01Z')], { hasMore: false }), ...change };
  await expect(readSetup(page, runHistoryAction).client.runHistory('morning', { limit: 2, ...query }))
    .rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  ['an empty id', '', {}],
  ['a blank occurrence', 'morning', { occurrenceId: '  ' }],
  ['a non-string occurrence', 'morning', { occurrenceId: 7 }],
  ['an extra field', 'morning', { view: 'due' }],
  ['a cursor over 256 characters', 'morning', { cursor: 'A'.repeat(300) }],
  ['a non-canonical cursor', 'morning', { cursor: 'AB' }],
])('rejects run history with %s before transport', async (_label, automationId, query) => {
  const { client, transport } = readSetup();
  await expect(client.runHistory(automationId, query as never)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});

test('does not read run history when the producer does not advertise the action', async () => {
  const { client, transport } = readSetup(runPage([], { hasMore: false }), runHistoryAction);
  const advertised = advertisement();
  advertised.capabilities[0]!.actions = advertised.capabilities[0]!.actions.filter((action) => action !== runHistoryAction);
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(advertised)) });
  await expect(client.runHistory('morning')).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.readDefinitions).not.toHaveBeenCalled();
});
