import {
  computeDefinitionDigest,
  createCovenAutomationsClient,
  createCovenAutomationsUnixTransport,
  COVEN_DAEMON_PROTOCOL,
  type CovenAutomationDraftInput,
  type CovenAutomationCommandContext,
  type CovenAutomationCommandRequest,
  type CovenAutomationCommandResult,
} from '@opencoven/coven-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { expect, expectTypeOf, test, vi } from 'vitest';

const ACTION = 'coven.automations.command.v1';
const LIFECYCLE = [
  'coven.automations.definition.create.v1', 'coven.automations.definition.revise.v1',
  'coven.automations.definition.activate.v1', 'coven.automations.definition.pause.v1',
  'coven.automations.definition.disable.v1', 'coven.automations.definition.tombstone.v1',
];

function advertisement(actions: readonly string[] = [ACTION, ...LIFECYCLE]) {
  return {
    capabilities: [{
      id: 'coven.automations', label: 'Automations', adapter: 'coven-daemon', status: 'available',
      policy: 'allow', actions, variantNegotiation: {
        version: 1, contractProfile: 'coven.automations.v1', description: 'Negotiation',
        supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
        experimental: [], refused: [], negotiationRules: [],
      },
    }],
  };
}

const context: CovenAutomationCommandContext = {
  adoptionKey: 'adopt:activate:morning:0001',
  intent: 'Turn the morning routine back on.',
  principalId: 'principal:owner',
  correlationId: 'corr-0001',
};

function committed(command: string, adoptionKey: string, outcome: 'committed' | 'replayed' = 'committed') {
  return {
    ok: true, accepted: true, action: ACTION, status: 'completed',
    result: {
      schemaVersion: 'coven.automations.v1', command, adoptionKey, outcome, revision: 2,
      result: { id: 'morning', status: 'ACTIVE', revision: 2, reason: null },
      ...(outcome === 'committed'
        ? { eventRef: { stream: 'automation:morning', sequence: 1 } }
        : { replay: { firstCommittedAt: '2026-09-28T09:00:00.000Z' } }),
    },
  };
}

function rejected(command: string, adoptionKey: string) {
  const error = {
    code: 'REVISION_CONFLICT', httpStatus: 409, message: 'stale revision for secret-id', retryable: false,
    currentRevision: 3,
  };
  return {
    ok: false, accepted: false, action: ACTION, status: 'rejected', reason: error.message, error,
    result: { schemaVersion: 'coven.automations.v1', command, adoptionKey, outcome: 'rejected', error },
  };
}

function setup(body: unknown = committed('definition.activate.v1', context.adoptionKey), status = 200) {
  const transport = {
    capabilities: vi.fn<(context: OperationContext) => Promise<{ status: number; body: Buffer }>>()
      .mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(advertisement())) }),
    sendCommand: vi.fn<(request: CovenAutomationCommandRequest, context: OperationContext) =>
      Promise<{ status: number; body: Buffer }>>()
      .mockResolvedValue({ status, body: Buffer.from(JSON.stringify(body)) }),
  };
  return { transport, client: createCovenAutomationsClient({ transport }) };
}

test('activate sends one exact spec envelope and returns the committed outcome', async () => {
  const { client, transport } = setup();
  const result = await client.activate('morning', 1, context, { reason: ' Back from holiday. ' });
  expectTypeOf(result).toEqualTypeOf<CovenAutomationCommandResult>();
  expect(result).toEqual({
    outcome: 'committed', command: 'definition.activate.v1', adoptionKey: context.adoptionKey, revision: 2,
    result: { id: 'morning', status: 'ACTIVE', revision: 2, reason: null },
    eventRef: { stream: 'automation:morning', sequence: 1 },
  });
  const [request, operation] = transport.sendCommand.mock.calls[0]!;
  expect(request).toEqual({
    action: ACTION,
    envelope: {
      schemaVersion: 'coven.automations.v1', command: 'definition.activate.v1',
      adoptionKey: context.adoptionKey, expectedRevision: 1,
      origin: { principal: { principalId: 'principal:owner' }, channel: 'sdk', correlationId: 'corr-0001' },
      intent: { statement: context.intent },
      payload: { automationId: 'morning', reason: 'Back from holiday.' },
    },
  });
  expect(Object.isFrozen(request) && Object.isFrozen(request.envelope) && Object.isFrozen(request.envelope.payload)).toBe(true);
  expect(transport.capabilities.mock.calls[0]?.[0]).toBe(operation);
});

test.each([
  ['pause', 'definition.pause.v1'],
  ['disable', 'definition.disable.v1'],
  ['tombstone', 'definition.tombstone.v1'],
] as const)('%s sends its own command', async (method, command) => {
  const { client, transport } = setup(committed(command, context.adoptionKey));
  const result = await client[method]('morning', 4, context);
  expect(result.outcome).toBe('committed');
  expect(transport.sendCommand.mock.calls[0]?.[0].envelope.command).toBe(command);
  expect((transport.sendCommand.mock.calls[0]?.[0].envelope as { expectedRevision?: number }).expectedRevision).toBe(4);
});

test('returns replays and typed rejections without copying the producer message', async () => {
  const replay = await setup(committed('definition.activate.v1', context.adoptionKey, 'replayed')).client
    .activate('morning', 1, context);
  expect(replay).toMatchObject({ outcome: 'replayed', replay: { firstCommittedAt: '2026-09-28T09:00:00.000Z' } });
  expect(replay).not.toHaveProperty('eventRef');

  const refused = await setup(rejected('definition.activate.v1', context.adoptionKey), 409).client
    .activate('morning', 1, context);
  expect(refused).toEqual({
    outcome: 'rejected', command: 'definition.activate.v1', adoptionKey: context.adoptionKey,
    error: { code: 'REVISION_CONFLICT', retryable: false, currentRevision: 3 },
  });
  expect(JSON.stringify(refused)).not.toContain('secret-id');
});

test('treats a transport-authority refusal before the envelope as a typed rejection', async () => {
  const body = {
    ok: false, accepted: false, action: ACTION, status: 'rejected',
    error: { code: 'AUTHORITY_REQUIRED', httpStatus: 403, message: 'owner IPC', retryable: false },
  };
  expect(await setup(body, 403).client.activate('morning', 1, context)).toEqual({
    outcome: 'rejected', command: 'definition.activate.v1', adoptionKey: context.adoptionKey,
    error: { code: 'AUTHORITY_REQUIRED', retryable: false },
  });
});

test.each([
  ['a blank id', () => ['', 1, context, {}]],
  ['an id outside the automation charset', () => ['morning routine', 1, context, {}]],
  ['a zero revision', () => ['morning', 0, context, {}]],
  ['an unsafe revision', () => ['morning', Number.MAX_SAFE_INTEGER + 1, context, {}]],
  ['a short adoption key', () => ['morning', 1, { ...context, adoptionKey: 'short' }, {}]],
  ['an adoption key with spaces', () => ['morning', 1, { ...context, adoptionKey: 'adopt key 0001' }, {}]],
  ['an empty intent', () => ['morning', 1, { ...context, intent: '   ' }, {}]],
  ['an intent over 1000 characters', () => ['morning', 1, { ...context, intent: 'x'.repeat(1_001) }, {}]],
  ['a principal outside the charset', () => ['morning', 1, { ...context, principalId: 'owner name' }, {}]],
  ['an unknown context field', () => ['morning', 1, { ...context, authority: 'owner' }, {}]],
  ['an empty reason', () => ['morning', 1, context, { reason: ' ' }]],
  ['a reason over 500 characters', () => ['morning', 1, context, { reason: 'x'.repeat(501) }]],
  ['an unknown option', () => ['morning', 1, context, { unexpected: true }]],
  ['an intent over 1000 code points', () => ['morning', 1, { ...context, intent: '🌙'.repeat(1_001) }, {}]],
])('rejects %s before any I/O', async (_label, args) => {
  const { client, transport } = setup();
  await expect((client.activate as (...values: unknown[]) => Promise<unknown>)(...args()))
    .rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test('refuses a tombstone reason before any I/O', async () => {
  const { client, transport } = setup();
  await expect((client.tombstone as (...values: unknown[]) => Promise<unknown>)('morning', 1, context, { reason: 'Gone.' }))
    .rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test.each([
  ['the envelope action', LIFECYCLE],
  ['the specific command', [ACTION, ...LIFECYCLE.filter((action) => !action.endsWith('activate.v1'))]],
])('does not send when the producer does not advertise %s', async (_label, actions) => {
  const { client, transport } = setup();
  transport.capabilities.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(advertisement(actions))) });
  await expect(client.activate('morning', 1, context)).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test('a transport without sendCommand cannot mutate', async () => {
  const transport = {
    capabilities: () => Promise.resolve({ status: 200, body: Buffer.from(JSON.stringify(advertisement())) }),
  };
  await expect(createCovenAutomationsClient({ transport }).activate('morning', 1, context))
    .rejects.toMatchObject({ code: 'unsupported_operation' });
});

test.each([
  ['a transport failure', (transport: ReturnType<typeof setup>['transport']) =>
    transport.sendCommand.mockRejectedValue(new Error('socket reset'))],
  ['an answer for another key', (transport: ReturnType<typeof setup>['transport']) =>
    transport.sendCommand.mockResolvedValue({
      status: 200, body: Buffer.from(JSON.stringify(committed('definition.activate.v1', 'adopt:someone-else'))),
    })],
  ['a 200 carrying a rejection', (transport: ReturnType<typeof setup>['transport']) =>
    transport.sendCommand.mockResolvedValue({
      status: 200, body: Buffer.from(JSON.stringify(rejected('definition.activate.v1', context.adoptionKey))),
    })],
  ['malformed JSON', (transport: ReturnType<typeof setup>['transport']) =>
    transport.sendCommand.mockResolvedValue({ status: 200, body: Buffer.from('{') })],
  ['a commit without a revision', (transport: ReturnType<typeof setup>['transport']) => {
    const body = committed('definition.activate.v1', context.adoptionKey);
    delete (body.result as Record<string, unknown>).revision;
    transport.sendCommand.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(body)) });
  }],
])('reports an unknown outcome after %s', async (_label, arrange) => {
  const { client, transport } = setup();
  arrange(transport);
  await expect(client.activate('morning', 1, context)).rejects.toMatchObject({
    code: 'outcome_unknown', retryable: true,
  });
});

test('a deadline that expires while the command is in flight is an unknown outcome', async () => {
  const { client, transport } = setup();
  transport.sendCommand.mockImplementation(() => new Promise(() => {}));
  await expect(client.activate('morning', 1, context, { timeoutMs: 20 })).rejects.toMatchObject({
    code: 'outcome_unknown',
  });
});

test('cancellation before the command is sent is not an unknown outcome', async () => {
  const { client, transport } = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(client.activate('morning', 1, context, { signal: controller.signal })).rejects.not.toMatchObject({
    code: 'outcome_unknown',
  });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test('bounds count code points, not UTF-16 units', async () => {
  // 600 astral characters are 1200 UTF-16 units but within the 1000 code-point limit.
  const { client, transport } = setup();
  await client.activate('morning', 1, { ...context, intent: '🌙'.repeat(600) }, { reason: '🌙'.repeat(400) });
  expect(transport.sendCommand).toHaveBeenCalledTimes(1);
});

test('replays narrow to a required replay timestamp', async () => {
  const result = await setup(committed('definition.activate.v1', context.adoptionKey, 'replayed')).client
    .activate('morning', 1, context);
  if (result.outcome === 'replayed') {
    expectTypeOf(result.replay.firstCommittedAt).toEqualTypeOf<string>();
  }
  expect(result.outcome).toBe('replayed');
});

test.each([
  ['a commit whose wrapper was not accepted', () => ({ ...committed('definition.activate.v1', context.adoptionKey), accepted: false }), 200],
  ['a commit whose wrapper is rejected', () => ({ ...committed('definition.activate.v1', context.adoptionKey), status: 'rejected' }), 200],
  ['a refusal whose wrapper was accepted', () => ({ ...rejected('definition.activate.v1', context.adoptionKey), accepted: true }), 409],
  ['a resultless refusal marked completed', () => ({
    ok: false, accepted: false, action: ACTION, status: 'completed',
    error: { code: 'AUTHORITY_REQUIRED', httpStatus: 403, message: 'owner IPC', retryable: false },
  }), 403],
])('reports an unknown outcome for %s', async (_label, body, status) => {
  await expect(setup(body(), status).client.activate('morning', 1, context)).rejects.toMatchObject({
    code: 'outcome_unknown',
  });
});

function draft(): CovenAutomationDraftInput {
  return {
    schemaVersion: 'coven.automations.v1',
    automationId: 'daily-notes',
    display: { name: 'Daily notes', tags: ['notes'] },
    trigger: { variant: 'schedule', version: 1, schedule: { rrule: 'FREQ=DAILY;BYHOUR=9', timezone: 'utc' } },
    action: { variant: 'familiarInvocation', version: 1, prompt: 'Write the daily reflection.', cwd: '~/notes' },
    binding: {
      familiarBindingPolicy: 'exact', familiarId: 'charm',
      authority: { approvalPolicyRef: 'policy://authority/familiars/charm' },
    },
    runtimeRequirements: { runtimeId: 'coven-code', capabilities: ['sessions.launch'] },
    policies: {
      timeout: { perRunMinutes: 30 },
      retry: { maxAttempts: 3, backoffPolicy: 'exponential', retryableClasses: ['transient_dispatch'] },
      concurrency: { overlap: 'forbid' },
      misfire: { disposition: 'latest' },
      retention: { occurrenceHistory: { classification: 'standard' } },
    },
  };
}

const draftContext: CovenAutomationCommandContext = { ...context, adoptionKey: 'adopt:create:daily-notes' };

function definitionCommitted(command: string, adoptionKey: string, revision: number) {
  return {
    ok: true, accepted: true, action: ACTION, status: 'completed',
    result: {
      schemaVersion: 'coven.automations.v1', command, adoptionKey, outcome: 'committed', revision,
      result: { routine: { id: 'daily-notes' }, revision, definition: { automationId: 'daily-notes', revision } },
      eventRef: { stream: 'automation:daily-notes', sequence: 0 },
    },
  };
}

test('createDraft sends a draft at revision 1 with a computed integrity', async () => {
  const { client, transport } = setup(definitionCommitted('definition.create.v1', draftContext.adoptionKey, 1));
  const result = await client.createDraft(draft(), draftContext);
  expect(result).toMatchObject({ outcome: 'committed', command: 'definition.create.v1', revision: 1 });
  const request = transport.sendCommand.mock.calls[0]![0];
  expect(request.envelope.command).toBe('definition.create.v1');
  expect(request.envelope).not.toHaveProperty('expectedRevision');
  const sent = (request.envelope.payload as unknown as { definition: Record<string, unknown> }).definition;
  expect(sent).toMatchObject({ ...draft(), revision: 1, lifecycleState: 'draft' });
  const recomputed = computeDefinitionDigest(sent);
  expect(recomputed.status).toBe('computed');
  expect((sent.integrity as { value: string }).value).toBe(recomputed.status === 'computed' ? recomputed.digest.value : '');
  expect(Object.isFrozen(sent) && Object.isFrozen(sent.policies)).toBe(true);
});

test('revise sends the next revision with the caller-chosen lifecycle state', async () => {
  const { client, transport } = setup(definitionCommitted('definition.revise.v1', 'adopt:revise:daily-notes', 3));
  const next = { ...draft(), lifecycleState: 'paused' as const, action: { ...draft().action, prompt: 'Reflect briefly.' } };
  const result = await client.revise('daily-notes', 2, next, { ...context, adoptionKey: 'adopt:revise:daily-notes' });
  expect(result).toMatchObject({ outcome: 'committed', revision: 3 });
  const envelope = transport.sendCommand.mock.calls[0]![0].envelope as unknown as {
    expectedRevision: number; payload: { definition: Record<string, unknown> };
  };
  expect(envelope.expectedRevision).toBe(2);
  expect(envelope.payload.definition).toMatchObject({ revision: 3, lifecycleState: 'paused' });
});

test.each([
  ['a caller-set revision', () => ({ ...draft(), revision: 1 })],
  ['a caller-set integrity', () => ({ ...draft(), integrity: { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: 'a'.repeat(64) } })],
  ['a caller-set lifecycle state', () => ({ ...draft(), lifecycleState: 'draft' })],
  ['an invalid document', () => ({ ...draft(), action: { variant: 'familiarInvocation', version: 1, prompt: '' } })],
])('createDraft refuses %s before any I/O', async (_label, input) => {
  const { client, transport } = setup();
  await expect(client.createDraft(input() as never, draftContext)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test.each([
  ['a different automation id', () => ['other-notes', 2, { ...draft(), lifecycleState: 'paused' }]],
  ['a draft lifecycle state', () => ['daily-notes', 2, { ...draft(), lifecycleState: 'draft' }]],
  ['no lifecycle state', () => ['daily-notes', 2, draft()]],
  ['a zero expected revision', () => ['daily-notes', 0, { ...draft(), lifecycleState: 'paused' }]],
])('revise refuses %s before any I/O', async (_label, args) => {
  const { client, transport } = setup();
  const [id, revision, input] = args() as [string, number, unknown];
  await expect(client.revise(id, revision, input as never, draftContext)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test('createDraft refuses an unknown option before any I/O', async () => {
  const { client, transport } = setup();
  await expect(client.createDraft(draft(), draftContext, { reason: 'x' } as never)).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
});

function unixTransport() {
  const connect = vi.fn(() => { throw new Error('must not connect'); });
  return createCovenAutomationsUnixTransport({
    version: 1, protocol: COVEN_DAEMON_PROTOCOL, source: 'coven_home',
    endpoint: { kind: 'unix', path: '/example/coven.sock' },
  }, {
    security: { platform: 'unix', peerIdentity: { inspectConnected: () => Promise.resolve({ uid: 501 }) } },
    dependencies: {
      connect, getEffectiveUid: () => 501,
      lstat: () => Promise.resolve({ device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true }),
    },
  });
}

interface TamperableEnvelope {
  expectedRevision?: number;
  payload: { extra?: boolean; definition: { revision: number; action: { prompt: string } } };
}

test.each([
  ['a digest that does not match the body', (envelope: TamperableEnvelope) => {
    envelope.payload.definition.action.prompt = 'Changed after hashing.';
  }],
  ['a create at revision 2', (envelope: TamperableEnvelope) => { envelope.payload.definition.revision = 2; }],
  ['a create carrying expectedRevision', (envelope: TamperableEnvelope) => { envelope.expectedRevision = 1; }],
  ['an extra payload field', (envelope: TamperableEnvelope) => { envelope.payload.extra = true; }],
])('the built-in transport refuses a definition command with %s before I/O', async (_label, change) => {
  const { client, transport } = setup(definitionCommitted('definition.create.v1', draftContext.adoptionKey, 1));
  await client.createDraft(draft(), draftContext);
  const valid = transport.sendCommand.mock.calls[0]![0];
  const tampered = JSON.parse(JSON.stringify(valid)) as { envelope: TamperableEnvelope };
  change(tampered.envelope);
  await expect(unixTransport().sendCommand!(tampered as never, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toMatchObject({ code: 'invalid_options' });
});
