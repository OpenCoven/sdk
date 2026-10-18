import { createHash } from 'node:crypto';

import {
  COVEN_DAEMON_PROTOCOL,
  CovenMissionContextMismatch,
  CovenMissionError,
  CovenMissionsClient,
  CovenMissionUncertain,
  createCovenAutomationsUnixTransport,
  createCovenMissionsClient,
  type CovenMissionCommandRequest,
  type CovenMissionSubmitInput,
  type CovenMissionView,
} from '@opencoven/coven-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { expect, test, vi } from 'vitest';


const ENVELOPE = 'coven.automations.command.v1';
const SUBMIT = 'coven.automations.mission.submit.v1';
const GET = 'coven.automations.mission.get.v1';
const CANCEL = 'coven.automations.mission.cancel.v1';
const EVENTS = 'coven.automations.events.subscribe.v1';
const KEY = 'adopt:mission:0001';
/** sha256("adopt:mission:0001"), first 32 hex digits. */
const MISSION_ID = 'mission-b22855c15769da95a4e6b688337a6fb2';
/** The daemon names a mission's occurrence `occ-<missionId>`. */
const OCCURRENCE = `occ-${MISSION_ID}`;
const OWNER = 'principal:coven-local-owner:0123456789abcdef';
const digest = (value: string) => ({ algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: value.repeat(64) });

const input: CovenMissionSubmitInput = {
  familiar: { rootId: `familiar:${'a'.repeat(32)}`, revisionId: `familiar-revision:${'a'.repeat(32)}:3` },
  envelope: { id: 'r0-read.1', descriptorDigest: digest('b') } as CovenMissionSubmitInput['envelope'],
  project: { cwd: '/Users/owner/project' },
  task: { statement: 'Diagnose the failing build', prompt: 'Read the last CI log and report the cause.' },
  limits: { timeoutMinutes: 10 },
  validUntil: '2026-10-18T12:10:00.000Z',
};

function missionView(overrides: Record<string, unknown> = {}): CovenMissionView {
  return {
    missionId: MISSION_ID, occurrenceId: OCCURRENCE, revision: 1, state: 'queued', terminal: false,
    principal: { principalId: OWNER },
    familiar: input.familiar, envelope: input.envelope, project: input.project,
    task: { statement: input.task.statement },
    submittedAt: '2026-10-18T12:00:00.000Z', validUntil: input.validUntil, attempts: [],
    ...overrides,
  };
}

const completed = (revision: number) => missionView({
  revision, state: 'completed', terminal: true,
  attempts: [{ attemptId: 'attempt-1', attemptNumber: 1, state: 'succeeded' }],
  result: {
    outcome: 'completed', settledAt: '2026-10-18T12:04:00.000Z', resultDigest: digest('c'),
    artifacts: [{ kind: 'report', ref: 'report-1', mediaType: 'text/markdown', bytes: 812, digest: digest('c') }],
    usage: { source: 'harness_result_event', inputTokens: 1200, outputTokens: 340 }, observation: 'complete',
  },
});

function committed(command: string, adoptionKey: string, result: unknown, outcome: 'committed' | 'replayed' = 'committed') {
  return {
    ok: true, accepted: true, action: ENVELOPE, status: 'completed',
    result: {
      schemaVersion: 'coven.automations.v1', command, adoptionKey, outcome, result,
      ...(outcome === 'replayed' ? { replay: { firstCommittedAt: '2026-10-18T12:00:00.000Z' } } : {}),
    },
  };
}

function rejected(command: string, adoptionKey: string, code: string, httpStatus: number, extra: Record<string, unknown> = {}) {
  const error = { code, httpStatus, message: 'refused for /Users/owner/secret', retryable: false, ...extra };
  return {
    ok: false, accepted: false, action: ENVELOPE, status: 'rejected', reason: error.message, error,
    result: { schemaVersion: 'coven.automations.v1', command, adoptionKey, outcome: 'rejected', error },
  };
}

const read = (mission: unknown) => ({ ok: true, accepted: true, action: GET, status: 'completed', result: mission });
const json = (status: number, value: unknown) => ({ status, body: Buffer.from(JSON.stringify(value)) });

function advertisement(actions: readonly string[] = [ENVELOPE, SUBMIT, GET, CANCEL, EVENTS]) {
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

type Answer = { status: number; body: Buffer };

function setup(actions?: readonly string[]) {
  const transport = {
    capabilities: vi.fn<(context: OperationContext) => Promise<Answer>>()
      .mockResolvedValue(json(200, advertisement(actions))),
    sendCommand: vi.fn<(request: CovenMissionCommandRequest, context: OperationContext) => Promise<Answer>>(),
    readDefinitions: vi.fn<(request: unknown, context: OperationContext) => Promise<Answer>>(),
  };
  return { transport, client: createCovenMissionsClient({ transport, principalId: 'principal:chat' }) };
}

test('derives the mission id from the adoption key, as the daemon does', () => {
  expect(CovenMissionsClient.missionIdFor(KEY)).toBe(MISSION_ID);
  const second = 'adopt:mission:0002';
  expect(CovenMissionsClient.missionIdFor(second))
    .toBe(`mission-${createHash('sha256').update(second).digest('hex').slice(0, 32)}`);
  for (const bad of ['short', ' adopt:mission:0001', 'adopt/mission/0001', 'x'.repeat(201)]) {
    expect(() => CovenMissionsClient.missionIdFor(bad)).toThrow(expect.objectContaining({ code: 'invalid_options' }));
  }
});

test('submit sends one exact, frozen spec envelope and returns the committed mission', async () => {
  const { client, transport } = setup();
  transport.sendCommand.mockResolvedValue(json(200, committed('mission.submit.v1', KEY, {
    missionId: MISSION_ID, occurrenceId: OCCURRENCE, mission: missionView(),
  })));
  const result = await client.submit(input, { adoptionKey: KEY, correlationId: 'chat-turn-7' });
  expect(result).toEqual({ outcome: 'committed', adoptionKey: KEY, missionId: MISSION_ID, occurrenceId: OCCURRENCE, mission: missionView() });
  expect(Object.isFrozen(result)).toBe(true);
  const [request] = transport.sendCommand.mock.calls[0]!;
  expect(request).toEqual({
    action: ENVELOPE,
    envelope: {
      schemaVersion: 'coven.automations.v1', command: 'mission.submit.v1', adoptionKey: KEY,
      origin: { principal: { principalId: 'principal:chat' }, channel: 'sdk', correlationId: 'chat-turn-7' },
      intent: { statement: input.task.statement },
      payload: input,
    },
  });
  expect(Object.isFrozen(request.envelope.payload) && Object.isFrozen((request.envelope.payload as CovenMissionSubmitInput).task)).toBe(true);
});

test('submit generates an adoption key when none is given and returns it', async () => {
  const { client, transport } = setup();
  transport.sendCommand.mockImplementation((request) => Promise.resolve(json(200, committed('mission.submit.v1', request.envelope.adoptionKey, {
    missionId: CovenMissionsClient.missionIdFor(request.envelope.adoptionKey), occurrenceId: OCCURRENCE,
    mission: missionView({ missionId: CovenMissionsClient.missionIdFor(request.envelope.adoptionKey) }),
  }))));
  const result = await client.submit(input);
  expect(result.adoptionKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(result.missionId).toBe(CovenMissionsClient.missionIdFor(result.adoptionKey));
});

test('M-01: before any submit, the derived id reads NOT_FOUND as a typed error', async () => {
  const { client, transport } = setup();
  transport.readDefinitions.mockResolvedValue(json(404, {
    ok: false, accepted: false, action: GET, status: 'rejected', reason: 'no such mission',
    error: { code: 'NOT_FOUND', httpStatus: 404, message: 'no such mission', retryable: false },
  }));
  const failure = await client.get(CovenMissionsClient.missionIdFor(KEY)).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CovenMissionError);
  expect(failure).toMatchObject({ code: 'NOT_FOUND', statusCode: 404, retryable: false });
  expect(String((failure as Error).message)).not.toContain('/Users');
  expect(transport.readDefinitions.mock.calls[0]?.[0]).toEqual({ action: GET, missionId: MISSION_ID });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test('M-02: a lost answer is resent with the same key and bytes, and a replay is success', async () => {
  const { client, transport } = setup();
  transport.sendCommand
    .mockRejectedValueOnce(new Error('ECONNRESET'))
    .mockResolvedValueOnce(json(502, { error: 'bad gateway' }))
    .mockResolvedValueOnce(json(200, committed('mission.submit.v1', KEY, {
      missionId: MISSION_ID, occurrenceId: OCCURRENCE, mission: missionView(),
    }, 'replayed')));
  const result = await client.submit(input, { adoptionKey: KEY });
  expect(result.outcome).toBe('replayed');
  expect(result.missionId).toBe(MISSION_ID);
  const sent = transport.sendCommand.mock.calls.map(([request]) => request);
  expect(sent).toHaveLength(3);
  expect(new Set(sent).size).toBe(1);
});

test('M-02: an answer that never arrives is uncertain, never "nothing happened"', async () => {
  const { client, transport } = setup();
  transport.sendCommand.mockRejectedValue(new Error('ETIMEDOUT'));
  const failure = await client.submit(input, { adoptionKey: KEY }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CovenMissionUncertain);
  expect(failure).toMatchObject({ code: 'outcome_unknown', retryable: true, adoptionKey: KEY, missionId: MISSION_ID });
  expect(transport.sendCommand).toHaveBeenCalledTimes(4);
});

test('an answer for another submit is not taken as this one', async () => {
  for (const result of [
    { missionId: `mission-${'0'.repeat(32)}`, occurrenceId: OCCURRENCE, mission: missionView({ missionId: `mission-${'0'.repeat(32)}` }) },
    { missionId: MISSION_ID, occurrenceId: OCCURRENCE, mission: missionView({ familiar: { rootId: `familiar:${'f'.repeat(32)}`, revisionId: `familiar-revision:${'f'.repeat(32)}:1` } }) },
    { missionId: MISSION_ID, occurrenceId: 'another-occurrence', mission: missionView() },
    { missionId: MISSION_ID, occurrenceId: OCCURRENCE, mission: { ...missionView(), prompt: input.task.prompt } },
  ]) {
    const { client, transport } = setup();
    transport.sendCommand.mockResolvedValue(json(200, committed('mission.submit.v1', KEY, result)));
    await expect(client.submit(input, { adoptionKey: KEY })).rejects.toBeInstanceOf(CovenMissionUncertain);
  }
});

test('M-03: refusals are typed, carry the adoption outcome, and copy no daemon message', async () => {
  const { client, transport } = setup();
  transport.sendCommand.mockResolvedValueOnce(json(409, rejected('mission.submit.v1', KEY, 'ADOPTION_REPLAY_MISMATCH', 409, {
    adoption: { key: KEY, conflictOutcome: 'committed' },
  })));
  const mismatch = await client.submit(input, { adoptionKey: KEY }).catch((error: unknown) => error);
  expect(mismatch).toBeInstanceOf(CovenMissionError);
  expect(mismatch).toMatchObject({ code: 'ADOPTION_REPLAY_MISMATCH', statusCode: 409, conflictOutcome: 'committed' });
  expect(String((mismatch as Error).message)).not.toContain('/Users');

  transport.sendCommand.mockResolvedValueOnce(json(429, rejected('mission.submit.v1', KEY, 'CONCURRENCY_LIMIT', 429)));
  await expect(client.submit(input, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT', statusCode: 429 });

  transport.sendCommand.mockResolvedValueOnce(json(409, rejected('mission.submit.v1', KEY, 'REVISION_CONFLICT', 409, { currentRevision: 4 })));
  await expect(client.submit(input, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 4 });
  // A refusal is an answer: it is not resent.
  expect(transport.sendCommand).toHaveBeenCalledTimes(3);
});

test('a refusal whose status disagrees with its code proves nothing', async () => {
  const { client, transport } = setup();
  transport.sendCommand.mockResolvedValue(json(400, rejected('mission.submit.v1', KEY, 'CONCURRENCY_LIMIT', 400)));
  await expect(client.submit(input, { adoptionKey: KEY })).rejects.toBeInstanceOf(CovenMissionUncertain);
});

test('mission commands need the daemon to advertise them, and nothing is sent otherwise', async () => {
  const { client, transport } = setup([ENVELOPE, GET, EVENTS]);
  await expect(client.submit(input, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'capability_unsupported' });
  await expect(client.cancel(MISSION_ID, {}, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(transport.sendCommand).not.toHaveBeenCalled();
});

test('M-15: inputs outside the contract fail before any I/O', async () => {
  const { client, transport } = setup();
  const variants: unknown[] = [
    { ...input, task: { ...input.task, prompt: 'é'.repeat(16_385) } },
    { ...input, task: { ...input.task, statement: 'x'.repeat(201) } },
    { ...input, task: { ...input.task, prompt: '' } },
    { ...input, limits: { timeoutMinutes: 61 } },
    { ...input, limits: { timeoutMinutes: 1.5 } },
    { ...input, project: { cwd: 'relative/path' } },
    { ...input, familiar: { ...input.familiar, revisionId: 'familiar-revision:abc:1' } },
    { ...input, validUntil: '2026-10-18 12:10' },
    { ...input, outputTarget: 'patch' },
  ];
  for (const variant of variants) {
    await expect(client.submit(variant as CovenMissionSubmitInput, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'invalid_options' });
  }
  const accessor = { ...input };
  const read = vi.fn(() => input.task);
  Object.defineProperty(accessor, 'task', { enumerable: true, get: read });
  await expect(client.submit(accessor, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'invalid_options' });
  expect(read).not.toHaveBeenCalled();
  await expect(client.submit(input, { adoptionKey: 'bad key' })).rejects.toMatchObject({ code: 'invalid_options' });
  expect(transport.capabilities).not.toHaveBeenCalled();
});

test('cancel returns the receipt and the view, and passes lost_to_completion through', async () => {
  const { client, transport } = setup();
  const cancellation = { cancellationId: 'cancel-1', requestedAt: '2026-10-18T12:03:00.000Z', outcome: 'lost_to_completion' };
  transport.sendCommand.mockResolvedValue(json(200, committed('mission.cancel.v1', 'adopt:cancel:0001', {
    cancellation, mission: { ...completed(4), cancellation },
  })));
  const result = await client.cancel(MISSION_ID, { reason: ' User stopped it. ' }, { adoptionKey: 'adopt:cancel:0001' });
  expect(result.cancellation.outcome).toBe('lost_to_completion');
  expect(result.mission.state).toBe('completed');
  expect(transport.sendCommand.mock.calls[0]?.[0].envelope).toMatchObject({
    command: 'mission.cancel.v1', intent: { statement: 'User stopped it.' },
    payload: { missionId: MISSION_ID, reason: 'User stopped it.' },
  });
});

test('M-09: a cancel after the mission is terminal is ILLEGAL_TRANSITION, carrying the settled view', async () => {
  const { client, transport } = setup();
  const settled = missionView({
    revision: 2, state: 'unavailable', terminal: true, reason: 'authority_unavailable',
    result: { outcome: 'unavailable', settledAt: '2026-10-18T12:00:00.000Z', artifacts: [], usage: null, observation: 'complete' },
  });
  transport.sendCommand.mockResolvedValueOnce(json(422, rejected('mission.cancel.v1', 'adopt:cancel:0002', 'ILLEGAL_TRANSITION', 422, {
    details: { mission: settled },
  })));
  const failure = await client.cancel(MISSION_ID, {}, { adoptionKey: 'adopt:cancel:0002' }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CovenMissionError);
  expect(failure).toMatchObject({ code: 'ILLEGAL_TRANSITION', statusCode: 422, mission: settled });
  expect(Object.isFrozen((failure as CovenMissionError).mission)).toBe(true);

  // Another mission's view, or a view that is not settled, proves nothing.
  for (const mission of [{ ...settled, missionId: `mission-${'1'.repeat(32)}` }, missionView({ revision: 2, state: 'running' })]) {
    transport.sendCommand.mockResolvedValueOnce(json(422, rejected('mission.cancel.v1', 'adopt:cancel:0003', 'ILLEGAL_TRANSITION', 422, {
      details: { mission },
    })));
    await expect(client.cancel(MISSION_ID, {}, { adoptionKey: 'adopt:cancel:0003' })).rejects.toMatchObject({ code: 'outcome_unknown' });
  }
});

test('M-04: a stale familiar revision is REVISION_CONFLICT naming the current revision', async () => {
  const { client, transport } = setup();
  const current = `familiar-revision:${'a'.repeat(32)}:4`;
  transport.sendCommand.mockResolvedValueOnce(json(409, rejected('mission.submit.v1', KEY, 'REVISION_CONFLICT', 409, {
    details: { currentRevisionId: current },
  })));
  await expect(client.submit(input, { adoptionKey: KEY })).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevisionId: current });
  transport.sendCommand.mockResolvedValueOnce(json(409, rejected('mission.submit.v1', KEY, 'REVISION_CONFLICT', 409, {
    details: { currentRevisionId: 'revision 4' },
  })));
  await expect(client.submit(input, { adoptionKey: KEY })).rejects.toBeInstanceOf(CovenMissionUncertain);
});

test('get refuses a view that breaks the contract', async () => {
  for (const view of [
    missionView({ missionId: `mission-${'1'.repeat(32)}` }),
    missionView({ state: 'completed', terminal: true }),
    missionView({ state: 'queued', terminal: true, result: completed(2).result }),
    missionView({ state: 'rejected', terminal: true, result: { ...completed(2).result, outcome: 'rejected' } }),
    missionView({ reason: 'timeout' }),
    missionView({ attempts: [{ attemptId: 'a-2', attemptNumber: 2, state: 'started' }] }),
    { ...missionView(), task: { statement: input.task.statement, prompt: input.task.prompt } },
  ]) {
    const { client, transport } = setup();
    transport.readDefinitions.mockResolvedValue(json(200, read(view)));
    await expect(client.get(MISSION_ID)).rejects.toMatchObject({ code: 'invalid_response' });
  }
  const { client, transport } = setup();
  const unavailable = missionView({ state: 'unavailable', terminal: false, reason: 'authority_unavailable' });
  transport.readDefinitions.mockResolvedValue(json(200, read(unavailable)));
  expect(await client.get(MISSION_ID)).toEqual(unavailable);
});

test('watch yields each new revision once and ends at the first terminal view', async () => {
  const { client, transport } = setup();
  const running = missionView({ revision: 2, state: 'running', attempts: [{ attemptId: 'attempt-1', attemptNumber: 1, state: 'started' }] });
  const reads: Answer[] = [
    json(200, read(missionView())),
    json(200, read(missionView())),
    json(200, read(running)),
    json(200, read(completed(3))),
  ];
  transport.readDefinitions.mockImplementation(() => Promise.resolve(reads.shift() ?? json(500, {})));
  const seen: string[] = [];
  for await (const view of client.watch(MISSION_ID, { pollIntervalMs: 100 })) seen.push(`${view.revision}:${view.state}`);
  expect(seen).toEqual(['1:queued', '2:running', '3:completed']);
  expect(reads).toHaveLength(0);
  expect(transport.readDefinitions.mock.calls.every(([request]) => (request as { action: string }).action === GET)).toBe(true);
});

test('M-14: a restarted watch resumes from the revision it last showed', async () => {
  const { client, transport } = setup();
  const reads: Answer[] = [
    json(200, read(missionView({ revision: 2, state: 'running' }))),
    json(200, read(completed(3))),
  ];
  transport.readDefinitions.mockImplementation(() => Promise.resolve(reads.shift() ?? json(500, {})));
  const seen: number[] = [];
  for await (const view of client.watch(MISSION_ID, { afterRevision: 2, pollIntervalMs: 100 })) seen.push(view.revision);
  expect(seen).toEqual([3]);
});

test('watch waits pollIntervalMs between reads', async () => {
  vi.useFakeTimers();
  try {
    const { client, transport } = setup();
    const reads: Answer[] = [
      json(200, read(missionView({ revision: 2, state: 'running' }))),
      json(200, read(missionView({ revision: 2, state: 'running' }))),
      json(200, read(completed(3))),
    ];
    transport.readDefinitions.mockImplementation(() => Promise.resolve(reads.shift() ?? json(500, {})));
    const iterator = client.watch(MISSION_ID, { afterRevision: 2, pollIntervalMs: 5_000 });
    const next = iterator.next();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(transport.readDefinitions).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.readDefinitions).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await next).value).toMatchObject({ revision: 3, state: 'completed' });
    expect((await iterator.next()).done).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('return() ends a watch that is waiting, without waiting out the interval', async () => {
  vi.useFakeTimers();
  try {
    const { client, transport } = setup();
    transport.readDefinitions.mockResolvedValue(json(200, read(missionView({ revision: 2, state: 'running' }))));
    const iterator = client.watch(MISSION_ID, { afterRevision: 2, pollIntervalMs: 60_000 });
    const next = iterator.next();
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.readDefinitions).toHaveBeenCalledTimes(1);
    await iterator.return!();
    expect(await next).toEqual({ done: true, value: undefined });
    expect(transport.readDefinitions).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('M-11: watch never shows a view for another principal or familiar', async () => {
  const { client, transport } = setup();
  transport.readDefinitions.mockResolvedValue(json(200, read(missionView())));
  const iterator = client.watch(MISSION_ID, {
    expect: { principalId: OWNER, familiar: { rootId: `familiar:${'f'.repeat(32)}`, revisionId: `familiar-revision:${'f'.repeat(32)}:1` } },
  });
  const failure = await iterator.next().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CovenMissionContextMismatch);
  expect(failure).toMatchObject({ code: 'context_mismatch', missionId: MISSION_ID });
  expect((await iterator.next()).done).toBe(true);

  const other = setup();
  other.transport.readDefinitions.mockResolvedValue(json(200, read(missionView())));
  await expect(other.client.watch(MISSION_ID, { expect: { principalId: 'principal:someone-else', familiar: input.familiar } }).next())
    .rejects.toBeInstanceOf(CovenMissionContextMismatch);
});

function unixTransport() {
  const connect = vi.fn(() => { throw new Error('must not connect'); });
  const transport = createCovenAutomationsUnixTransport({
    version: 1, protocol: COVEN_DAEMON_PROTOCOL, source: 'coven_home',
    endpoint: { kind: 'unix', path: '/example/coven.sock' },
  }, {
    security: { platform: 'unix', peerIdentity: { inspectConnected: () => Promise.resolve({ uid: 501 }) } },
    dependencies: {
      connect, getEffectiveUid: () => 501,
      lstat: () => Promise.resolve({ device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true }),
    },
  });
  return { transport, connect };
}

const bounded = () => ({ signal: new AbortController().signal, deadline: undefined });

async function sentSubmit(): Promise<CovenMissionCommandRequest> {
  const { client, transport } = setup();
  transport.sendCommand.mockResolvedValue(json(200, committed('mission.submit.v1', KEY, {
    missionId: MISSION_ID, occurrenceId: OCCURRENCE, mission: missionView(),
  })));
  await client.submit(input, { adoptionKey: KEY });
  return transport.sendCommand.mock.calls[0]![0];
}

type Tamperable = { envelope: Record<string, unknown> & { payload: Record<string, unknown> & { task: Record<string, unknown> } } };

test.each([
  ['an extra payload field', (request: Tamperable) => { request.envelope.payload.outputTarget = 'patch'; }],
  ['an oversized prompt', (request: Tamperable) => { request.envelope.payload.task.prompt = 'x'.repeat(32_769); }],
  ['an intent that is not the task statement', (request: Tamperable) => { request.envelope.intent = { statement: 'Something else.' }; }],
  ['an expected revision', (request: Tamperable) => { request.envelope.expectedRevision = 1; }],
  ['another command name', (request: Tamperable) => { request.envelope.command = 'mission.get.v1'; }],
])('the built-in transport refuses a mission submit with %s before I/O', async (_label, change) => {
  const tampered = JSON.parse(JSON.stringify(await sentSubmit())) as Tamperable;
  change(tampered);
  const { transport, connect } = unixTransport();
  await expect(transport.sendCommand!(tampered as never, bounded())).rejects.toMatchObject({ code: 'invalid_options' });
  expect(connect).not.toHaveBeenCalled();
});

test('the built-in transport sends a valid mission submit and a mission read', async () => {
  const { transport, connect } = unixTransport();
  await expect(transport.sendCommand!(await sentSubmit(), bounded())).rejects.not.toMatchObject({ code: 'invalid_options' });
  await expect(transport.readDefinitions!({ action: GET, missionId: MISSION_ID }, bounded()))
    .rejects.not.toMatchObject({ code: 'invalid_options' });
  expect(connect).toHaveBeenCalledTimes(2);
  await expect(transport.readDefinitions!({ action: GET, missionId: 'mission-short' } as never, bounded()))
    .rejects.toMatchObject({ code: 'invalid_options' });
  expect(connect).toHaveBeenCalledTimes(2);
});
