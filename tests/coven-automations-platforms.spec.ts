import { EventEmitter } from 'node:events';

import {
  COVEN_DAEMON_PROTOCOL,
  type CovenAutomationsClient,
  CovenClientError,
  createCovenClient,
  createCovenAutomationsClient,
  createCovenAutomationsUnixTransport,
  createCovenAutomationsWindowsTransport,
  isCovenClientError,
  type CovenAutomationDefinitionReadRequest,
  type CovenConnectedSocket,
  type CovenDiscoveredEndpoint,
  type CovenWindowsPipeIdentity,
} from '@opencoven/coven-client';
import { createOpenCovenSdk } from '@opencoven/sdk';
import type { OperationContext, OperationOptions } from '@opencoven/sdk-core';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import eventVectors from '../packages/coven/fixtures/automations-events-v1/event-reducer-determinism.vectors.json' with { type: 'json' };

const receiptAction = 'coven.automations.receipt.get.v1';
const receiptResult = {
  receipt: {
    schemaVersion: 'coven.automations.v1', receiptId: 'receipt-1', automationId: 'morning',
    automationRevision: 1, occurrenceId: 'occurrence-1', runId: 'run-1', attemptId: 'attempt-1',
    identity: { familiarId: 'familiar-1' }, sideEffectClass: 'none',
    outcome: { disposition: 'failed' }, producedAt: '2026-09-14T00:00:00Z',
    producer: { component: 'coven-daemon', instanceId: 'local' },
    integrity: { algorithm: 'sha256', canonicalization: 'jcs-rfc8785', value: 'a'.repeat(64) },
    privacy: { classification: 'operational', retention: { classification: 'standard' } },
  },
  verification: {
    status: 'unverifiable', integrity: 'valid', correlation: 'valid',
    receiptAuthentication: { status: 'unverified', evidence: 'unavailable' },
    runtimeAuthority: { status: 'unverified', evidence: 'unavailable' },
    reasons: ['PRODUCER_AUTHENTICATION_UNVERIFIED', 'RUNTIME_AUTHORITY_UNVERIFIED'],
  },
};

const reads: {
  request: CovenAutomationDefinitionReadRequest;
  payload: unknown;
  call: (client: CovenAutomationsClient, options?: OperationOptions) => Promise<unknown>;
}[] = [
  {
    request: { action: 'coven.automations.definition.list.v1', includeTombstoned: false },
    payload: { routines: [], revisionById: {}, tombstonedAtById: {} },
    call: (client, options) => client.list({}, options),
  },
  {
    request: { action: 'coven.automations.definition.get.v1', id: 'morning' },
    payload: { routine: null },
    call: (client, options) => client.get(' morning ', options),
  },
  {
    request: { action: 'coven.automations.health', id: 'morning' },
    payload: { health: {
      automationId: 'morning', nextDueAt: null, lastPlannedAt: null, lastStartedAt: null,
      lastSuccessAt: null, consecutiveFailures: 0, leaseOwner: null, leaseExpiresAt: null,
      staleReason: null, currentAttempt: null, maxAttempts: 1, retryNotBefore: null,
      consecutiveExhaustions: 0, quarantinedAt: null, quarantineFailureClass: null, quarantineReason: null,
    } },
    call: (client, options) => client.health('morning', options),
  },
  {
    request: { action: 'coven.automations.runs', id: 'morning', limit: 20 },
    payload: { runs: [] },
    call: (client, options) => client.runs('morning', {}, options),
  },
  {
    request: { action: 'coven.automations.occurrence.list.v1', view: 'due', limit: 20 },
    payload: { occurrences: [] },
    call: (client, options) => client.occurrences({ view: 'due' }, options),
  },
  {
    request: { action: 'coven.automations.occurrence.get.v1', id: 'occurrence-1' },
    payload: { occurrence: null },
    call: (client, options) => client.getOccurrence('occurrence-1', options),
  },
  {
    request: { action: receiptAction, id: 'receipt-1' },
    payload: receiptResult,
    call: (client, options) => client.getReceipt(' receipt-1 ', options),
  },
];

function advertisement(actions = reads.map(({ request }) => request.action)) {
  return { capabilities: [{
    id: 'coven.automations', label: 'Automations', adapter: 'coven-daemon', status: 'available',
    policy: 'allow', actions, variantNegotiation: {
      version: 1, contractProfile: 'coven.automations.v1', description: 'Negotiation',
      supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
      experimental: [], refused: [], negotiationRules: [],
    },
  }] };
}

function envelope(action: string, payload: unknown) {
  return {
    ok: true, accepted: true, action, status: 'completed',
    ...(action === receiptAction ? { result: payload } : {
      event: { kind: 'automations.changed', action, payload },
    }),
  };
}

class Socket extends EventEmitter implements CovenConnectedSocket {
  connecting = false;
  destroyed = false;
  paused = false;
  writes: string[] = [];
  response: Buffer | undefined = Buffer.from(JSON.stringify(advertisement()));
  rawResponse: Buffer | undefined;
  write(value: Uint8Array | string): boolean {
    this.writes.push(Buffer.from(value).toString());
    const response = this.rawResponse ?? (this.response === undefined ? undefined : Buffer.concat([
      Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${this.response.length}\r\n\r\n`), this.response,
    ]));
    if (response !== undefined) queueMicrotask(() => this.emit('data', response));
    return true;
  }
  pause(): this { this.paused = true; return this; }
  resume(): this { this.paused = false; return this; }
  end(): this { return this; }
  destroy(): this { this.destroyed = true; return this; }
}

const endpoint: CovenDiscoveredEndpoint = {
  version: 1, protocol: COVEN_DAEMON_PROTOCOL, source: 'config_paths',
  endpoint: { kind: 'windowsNamedPipe', path: '\\\\.\\pipe\\coven-daemon.sock' },
  owner: { kind: 'windows', identity: 'S-1-5-21-owner' },
  freshness: { daemonPid: 42, daemonStartedAt: 'started', processCreationTime: '100' },
};

function identity(change: Partial<CovenWindowsPipeIdentity> = {}): CovenWindowsPipeIdentity {
  return {
    ownerIdentity: 'S-1-5-21-owner', ownerOnly: true, pipeIdentity: 'pipe-1',
    serverProcessId: 42, processCreationTime: '100', ...change,
  };
}

function setup(platform: 'unix' | 'windows' = 'windows', discovered = endpoint) {
  const sockets: Socket[] = [];
  const configure = vi.fn<(socket: Socket, index: number) => void>();
  const connect = vi.fn((path: string) => {
    expect(path).toBe(platform === 'windows' ? discovered.endpoint.path : '/example/coven.sock');
    const socket = new Socket();
    configure(socket, sockets.length);
    sockets.push(socket);
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  const ownership = {
    currentUserIdentity: vi.fn(() => Promise.resolve('S-1-5-21-owner')),
    inspect: vi.fn(() => Promise.resolve(identity())),
    inspectConnected: vi.fn((_path: string, socket: CovenConnectedSocket) => {
      expect(socket).toBe(sockets.at(-1));
      expect(sockets.at(-1)?.paused).toBe(true);
      expect(sockets.at(-1)?.writes).toEqual([]);
      return Promise.resolve(identity());
    }),
  };
  const security = { platform: 'windows' as const, ownership };
  const transport = platform === 'windows'
    ? createCovenAutomationsWindowsTransport(discovered, { security, dependencies: { connect } })
    : createCovenAutomationsUnixTransport({
      version: 1, protocol: COVEN_DAEMON_PROTOCOL, source: 'coven_home',
      endpoint: { kind: 'unix', path: '/example/coven.sock' },
    }, {
      security: { platform: 'unix', peerIdentity: { inspectConnected: () => Promise.resolve({ uid: 501 }) } },
      dependencies: {
        connect, getEffectiveUid: () => 501,
        lstat: () => Promise.resolve({
          device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true,
        }),
      },
    });
  return { sockets, connect, configure, ownership, security, transport, client: createCovenAutomationsClient({ transport }) };
}

afterEach(() => { vi.useRealTimers(); });

describe.each(['unix', 'windows'] as const)('%s Automations parity', (platform) => {
  test.skipIf(platform === 'unix' && process.platform === 'win32')('reads 100 events with an event-only 1 MiB bound', async () => {
    const { client, configure, sockets } = setup(platform);
    const action = 'coven.automations.events.subscribe.v1';
    const event = eventVectors.cases[0]!.events[0]!;
    const stream = { kind: 'occurrence' as const, id: event.stream.id };
    const result = {
      stream, after: null, nextAfter: 99,
      events: Array.from({ length: 100 }, (_, sequence) => ({
        ...event, sequence, eventId: `evt${String(sequence).padStart(32, '0')}`,
      })),
      checkpoint: 'ecp00000000000000000000000000000001', checkpointExpiresAt: '2026-09-21T00:00:00Z',
    };
    const body = Buffer.from(JSON.stringify({ ok: true, accepted: true, action, status: 'completed', result }));
    expect(body.length).toBeGreaterThan(16_384);
    configure.mockImplementation((socket, index) => {
      socket.response = index === 0 ? Buffer.from(JSON.stringify(advertisement([action]))) : body;
    });
    expect(await client.events({ stream })).toEqual(result);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.writes[0]?.split('\r\n\r\n')[1]).toBe(JSON.stringify({ action, stream }));
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    configure.mockImplementation((socket, index) => {
      if (index === 2) socket.response = Buffer.from(JSON.stringify(advertisement([action])));
      else socket.rawResponse = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 1048577\r\n\r\n');
    });
    await expect(client.events({ stream })).rejects.toMatchObject({ code: 'body_limit' });
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
  });

  test.skipIf(platform === 'unix' && process.platform === 'win32')('return closes a pending subscription socket before any late response', async () => {
    const { client, configure, sockets } = setup(platform);
    configure.mockImplementation((socket, index) => {
      socket.response = index === 0 ? Buffer.from(JSON.stringify(advertisement(['coven.automations.events.subscribe.v1']))) : undefined;
    });
    const iterator = client.subscribe({ stream: { kind: 'automation', id: 'morning' } });
    const pending = iterator.next();
    await vi.waitFor(() => expect(sockets[1]?.writes).toHaveLength(1), { interval: 1 });
    await iterator.return?.();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    sockets[1]?.emit('data', Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'));
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(sockets).toHaveLength(2);
  });

  test.skipIf(platform === 'unix' && process.platform === 'win32').each(reads)(
    'authenticates and strictly decodes $request.action', async ({ request, payload, call }) => {
      const { client, configure, sockets, ownership } = setup(platform);
      configure.mockImplementation((socket, index) => {
        socket.response = Buffer.from(JSON.stringify(index === 0
          ? advertisement() : envelope(request.action, payload)));
      });
      expect(await call(client)).toEqual(payload);
      expect(sockets).toHaveLength(2);
      expect(sockets[0]?.writes).toEqual([
        'GET /api/v1/capabilities HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      ]);
      const body = JSON.stringify(request);
      expect(sockets[1]?.writes).toEqual([
        'POST /api/v1/actions HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\n' +
        'Content-Type: application/json\r\nConnection: close\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      ]);
      expect(sockets.every((socket) => socket.destroyed)).toBe(true);
      if (platform === 'windows') {
        expect(ownership.inspect).toHaveBeenCalledTimes(2);
        expect(ownership.inspectConnected).toHaveBeenCalledTimes(2);
      }
      configure.mockImplementation((socket) => {
        socket.response = Buffer.from(JSON.stringify(advertisement([])));
      });
      await expect(call(client)).rejects.toMatchObject({ code: 'capability_unsupported' });
      expect(sockets).toHaveLength(3);
      for (const body of [
        Buffer.from('{"ok":true,"ok":true}'), Buffer.from([0xff]),
        Buffer.from(JSON.stringify(envelope('wrong.action', payload))),
        Buffer.from(JSON.stringify(envelope(request.action, {}))),
        Buffer.alloc(16_385),
      ]) {
        configure.mockImplementation((socket, index) => {
          socket.response = index % 2 === 1 ? Buffer.from(JSON.stringify(advertisement())) : body;
        });
        await expect(call(client)).rejects.toMatchObject({
          code: body.length > 16_384 ? 'body_limit' : 'invalid_response',
        });
      }
      expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    },
  );
});

test.each([
  { ownerOnly: false }, { ownerIdentity: 'S-1-5-21-other' }, { ownerIdentity: '' },
  { pipeIdentity: '' }, { serverProcessId: 0 }, { serverProcessId: 1.5 }, { processCreationTime: '' },
])('Windows rejects unsafe initial identity before connecting %#', async (change) => {
  const { client, ownership, connect } = setup();
  ownership.inspect.mockResolvedValue(identity(change));
  await expect(client.capabilities()).rejects.toBeInstanceOf(CovenClientError);
  expect(connect).not.toHaveBeenCalled();
});

test.each([
  { ownerOnly: false }, { ownerIdentity: 'S-1-5-21-other' },
  { pipeIdentity: 'replacement' }, { serverProcessId: 43 }, { processCreationTime: '101' },
])('Windows revalidates every identity field before GET and POST %#', async (change) => {
  for (const post of [false, true]) {
    const { transport, sockets, ownership } = setup();
    ownership.inspectConnected.mockResolvedValue(identity(change));
    const context = { signal: new AbortController().signal, deadline: undefined };
    const result = post ? transport.readDefinitions!(reads[0]!.request, context) : transport.capabilities(context);
    await expect(result).rejects.toMatchObject({
      code: 'ownerIdentity' in change ? 'owner_mismatch' : 'unsafe_endpoint',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(sockets[0]?.writes).toEqual([]);
    expect(sockets[0]?.destroyed).toBe(true);
  }
});

test.each([
  { daemonPid: 43 }, { daemonPid: 42, processCreationTime: '101' },
])('Windows refuses stale discovery even when both pipe inspections agree %#', async (freshness) => {
  const { client, sockets } = setup('windows', {
    ...endpoint, freshness: { daemonStartedAt: 'started', ...freshness },
  });
  await expect(client.capabilities()).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  expect(sockets[0]?.writes).toEqual([]);
  expect(sockets[0]?.destroyed).toBe(true);
});

test('Windows reauthenticates after capabilities and refuses a changed owner before the action', async () => {
  const { client, sockets, ownership } = setup();
  ownership.inspectConnected.mockResolvedValueOnce(identity()).mockResolvedValue(identity({ ownerOnly: false }));
  await expect(client.getReceipt('receipt-1')).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  expect(sockets).toHaveLength(2);
  expect(sockets[1]?.writes).toEqual([]);
  expect(sockets.every((socket) => socket.destroyed)).toBe(true);
});

test('Windows requires native adapters and local endpoints, with no TCP fallback', async () => {
  const { security } = setup();
  for (const options of [undefined, {}, { security: { platform: 'unix' } }, {
    security: { platform: 'windows', ownership: { ...security.ownership, inspectConnected: undefined } },
  }]) {
    expect(() => { Reflect.apply(createCovenAutomationsWindowsTransport, undefined, [endpoint, options]); })
      .toThrow(expect.objectContaining({ code: 'unsafe_endpoint' }));
  }
  for (const candidate of [
    { ...endpoint, protocol: 'wrong' }, { ...endpoint, version: 2 },
    { ...endpoint, endpoint: { kind: 'http', url: 'http://127.0.0.1:4000' } },
    { ...endpoint, endpoint: { kind: 'windowsNamedPipe', path: '\\\\remote\\pipe\\coven.sock' } },
    { ...endpoint, endpoint: { kind: 'unix', path: '/example/coven.sock' } },
  ]) {
    expect(() => { Reflect.apply(createCovenAutomationsWindowsTransport, undefined, [candidate, { security }]); })
      .toThrow(expect.objectContaining({ code: 'unsafe_endpoint' }));
  }
  const mismatch = setup('windows', { ...endpoint, owner: { kind: 'windows', identity: 'other' } });
  await expect(mismatch.client.capabilities()).rejects.toMatchObject({ code: 'owner_mismatch' });
  expect(mismatch.connect).not.toHaveBeenCalled();
});

test.each(['currentUserIdentity', 'inspect', 'inspectConnected'] as const)(
  'Windows bounds pending %s and ignores late adapter completion', async (step) => {
    for (const aborted of [false, true]) {
      const { client, ownership, sockets, connect } = setup();
      let resolveStep: (() => void) | undefined;
      if (step === 'currentUserIdentity') {
        ownership.currentUserIdentity.mockImplementation(() => new Promise((resolve) => {
          resolveStep = () => resolve('S-1-5-21-owner');
        }));
      } else {
        ownership[step].mockImplementation(() => new Promise((resolve) => {
          resolveStep = () => resolve(identity());
        }));
      }
      const controller = new AbortController();
      const result = client.capabilities({ signal: controller.signal, timeoutMs: 20 });
      const rejected = expect(result).rejects.toMatchObject({ code: aborted ? 'aborted' : 'timeout' });
      await vi.waitFor(() => expect(resolveStep).toBeTypeOf('function'), { interval: 1, timeout: 100 });
      if (aborted) controller.abort();
      await rejected;
      resolveStep?.();
      await Promise.resolve();
      expect(sockets.every((socket) => socket.destroyed && socket.writes.length === 0)).toBe(true);
      if (step !== 'inspectConnected') expect(connect).not.toHaveBeenCalled();
    }
  },
);

test.each(['capabilities', 'action'] as const)('Windows cancels pending %s response under the shared client budget', async (stage) => {
  for (const aborted of [false, true]) {
    const { client, configure, sockets } = setup();
    configure.mockImplementation((socket, index) => {
      if (stage === 'capabilities' || index === 1) socket.response = undefined;
    });
    const controller = new AbortController();
    const result = client.list({}, { signal: controller.signal, timeoutMs: 30 });
    const rejected = expect(result).rejects.toMatchObject({ code: aborted ? 'aborted' : 'timeout' });
    await vi.waitFor(() => expect(sockets.at(-1)?.writes).toHaveLength(1), { interval: 1, timeout: 100 });
    if (stage === 'action') await vi.waitFor(() => expect(sockets).toHaveLength(2), { interval: 1, timeout: 100 });
    if (aborted) controller.abort();
    await rejected;
    expect(sockets).toHaveLength(stage === 'capabilities' ? 1 : 2);
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
  }
});

test.each([
  Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 5\r\n\r\nhello'),
  Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 16385\r\n\r\n'),
])('Windows rejects malformed framing and excessive responses %#', async (rawResponse) => {
  const { client, configure, sockets } = setup();
  configure.mockImplementation((socket) => { socket.rawResponse = rawResponse; });
  await expect(client.capabilities()).rejects.toBeInstanceOf(CovenClientError);
  expect(sockets[0]?.destroyed).toBe(true);
});

test('Windows closes disconnected sockets and never retries over another transport', async () => {
  const { client, configure, sockets, connect } = setup();
  configure.mockImplementation((socket) => {
    socket.response = undefined;
    socket.resume = () => { queueMicrotask(() => socket.emit('close')); return socket; };
  });
  await expect(client.capabilities()).rejects.toMatchObject({ code: 'connect_failure' });
  expect(connect).toHaveBeenCalledOnce();
  expect(sockets[0]?.destroyed).toBe(true);
});

test.each(['already_closed', 'connecting', 'revalidating', 'destroyed_before_close'] as const)(
  'Windows refuses a closed socket before request bytes: %s', async (stage) => {
    const { transport, configure, sockets, ownership } = setup();
    let finishInspection: (() => void) | undefined;
    configure.mockImplementation((socket) => {
      if (stage === 'already_closed') socket.destroyed = true;
      if (stage === 'connecting') queueMicrotask(() => socket.emit('close'));
    });
    if (stage === 'revalidating') {
      ownership.inspectConnected.mockImplementation(() => new Promise((resolve) => {
        finishInspection = () => resolve(identity());
        queueMicrotask(() => sockets[0]?.emit('close'));
      }));
    }
    if (stage === 'destroyed_before_close') {
      ownership.inspectConnected.mockImplementation(() => new Promise((resolve) => {
        queueMicrotask(() => {
          sockets[0]!.destroyed = true;
          resolve(identity());
        });
      }));
    }
    await expect(transport.readDefinitions!(reads[0]!.request, {
      signal: new AbortController().signal, deadline: performance.now() + 100,
    })).rejects.toMatchObject({
      code: 'connect_failure',
      diagnostics: { phase: stage === 'revalidating' || stage === 'destroyed_before_close' ? 'revalidate_endpoint' : 'connect' },
    });
    finishInspection?.();
    await Promise.resolve();
    expect(sockets[0]?.writes).toEqual([]);
    expect(sockets[0]?.destroyed).toBe(true);
    expect(sockets[0]?.eventNames()).toEqual([]);
  },
);

test.each([
  [undefined, 'invalid_options'],
  [{ signal: new AbortController().signal, deadline: Number.NaN }, 'invalid_options'],
  [{ signal: new AbortController().signal, deadline: Infinity }, 'invalid_options'],
  [{ signal: new AbortController().signal, deadline: 0 }, 'timeout'],
  [{ signal: AbortSignal.abort(), deadline: undefined }, 'aborted'],
])('Windows direct operations reject invalid or terminated contexts before I/O %#', async (context, code) => {
  const { transport, ownership, connect } = setup();
  await expect(transport.capabilities(context as OperationContext)).rejects.toMatchObject({ code });
  await expect(transport.readDefinitions!(reads[0]!.request, context as OperationContext)).rejects.toMatchObject({ code });
  expect(ownership.currentUserIdentity).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

test('Windows direct transport uses the bounded default when no deadline is supplied', async () => {
  const { transport, sockets } = setup();
  expect(await transport.capabilities({ signal: new AbortController().signal, deadline: undefined }))
    .toMatchObject({ status: 200 });
  expect(sockets[0]?.destroyed).toBe(true);
});

test.each([
  { action: 'coven.automations.definition.create.v1' },
  { action: 'coven.automations.getRun', id: 'run-1' },
  { action: 'coven.automations.runs', id: 'morning', limit: 101 },
  { action: receiptAction, id: 'receipt-1', authority: true },
  { action: 'coven.automations.events.read.v1', stream: { kind: 'automation', id: 'morning' } },
  { action: 'coven.automations.events.subscribe.v1', stream: { kind: 'automation', id: 'morning' }, limit: 100 },
  { action: 'coven.automations.events.subscribe.v1', stream: { kind: 'feed', id: 'all' } },
  { action: 'coven.automations.events.subscribe.v1', stream: { kind: 'run', id: 'run-1' }, after: 1, checkpoint: 'checkpoint' },
])('Windows refuses unsupported action bytes before adapter I/O %#', async (request) => {
  const { transport, ownership, connect } = setup();
  await expect(transport.readDefinitions!(request as CovenAutomationDefinitionReadRequest, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toMatchObject({ code: 'invalid_options' });
  expect(ownership.inspect).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

test('normal and umbrella clients retain optional namespace identity and shared operation defaults', async () => {
  const observer = { onEvent: vi.fn(), onObserverError: vi.fn() };
  const override = { onEvent: vi.fn(), onObserverError: vi.fn() };
  const contexts: OperationContext[] = [];
  const health = vi.fn(() => Promise.resolve({
    ok: true as const, apiVersion: COVEN_DAEMON_PROTOCOL, covenVersion: '0.4.4',
    capabilities: { sessions: true, events: true, structuredErrors: true as const },
  }));
  const capabilities = vi.fn((context: OperationContext) => {
    contexts.push(context);
    return Promise.resolve({ status: 200, body: Buffer.from(JSON.stringify(advertisement())) });
  });
  const readDefinitions = vi.fn((request: CovenAutomationDefinitionReadRequest, context: OperationContext) => {
    contexts.push(context);
    return Promise.resolve({ status: 200, body: Buffer.from(JSON.stringify(envelope(request.action, reads[0]!.payload))) });
  });
  const coven = createCovenClient({
    transport: { health }, automationsTransport: { capabilities, readDefinitions },
    operation: { timeoutMs: 200, observer },
  });
  const sdk = createOpenCovenSdk({ coven });
  expect(capabilities).not.toHaveBeenCalled();
  expect(health).not.toHaveBeenCalled();
  expectTypeOf(coven.automations).toEqualTypeOf<CovenAutomationsClient | undefined>();
  expect(coven.requireAutomations()).toBe(coven.automations);
  expect(sdk.coven?.automations).toBe(coven.automations);
  expect(sdk.requireCoven().requireAutomations()).toBe(coven.automations);
  await coven.health();
  expect(capabilities).not.toHaveBeenCalled();
  const started = performance.now();
  await sdk.requireCoven().requireAutomations().list();
  expect(contexts[0]).toBe(contexts[1]);
  expect(contexts[0]?.deadline).toBeGreaterThanOrEqual(started + 190);
  expect(observer.onEvent).toHaveBeenCalled();
  observer.onEvent.mockClear();
  const overriddenStart = performance.now();
  await coven.requireAutomations().list({}, { timeoutMs: 500, observer: override });
  expect(contexts[2]).toBe(contexts[3]);
  expect(contexts[2]?.deadline).toBeGreaterThanOrEqual(overriddenStart + 490);
  expect(override.onEvent).toHaveBeenCalled();
  expect(observer.onEvent).not.toHaveBeenCalled();
  await expect(coven.requireAutomations().list({}, { signal: AbortSignal.abort() }))
    .rejects.toMatchObject({ code: 'aborted' });
  expect(capabilities).toHaveBeenCalledTimes(2);
});

test('health-only clients fail explicitly when Automations is required and standalone remains independent', async () => {
  const transport = { health: vi.fn(() => Promise.reject(new Error('not called'))) };
  const coven = createCovenClient({ transport });
  expect(coven.automations).toBeUndefined();
  expect(() => coven.requireAutomations()).toThrow(expect.objectContaining({
    code: 'not_configured', normalized: { system: 'coven', operation: 'automations', code: 'not_configured',
      message: 'Coven automations request failed', retryable: false },
  }));
  try { coven.requireAutomations(); } catch (error) { expect(isCovenClientError(error)).toBe(true); }
  expect(transport.health).not.toHaveBeenCalled();
  const { client } = setup();
  expect(await client.capabilities()).toMatchObject({ status: 'available' });
});

test('integrated Automations shares one deadline across capability and read, not two fresh defaults', async () => {
  const contexts: OperationContext[] = [];
  const coven = createCovenClient({
    transport: { health: () => Promise.reject(new Error('unused')) },
    operation: { timeoutMs: 30 },
    automationsTransport: {
      capabilities: async (context) => {
        contexts.push(context);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 200, body: Buffer.from(JSON.stringify(advertisement())) };
      },
      readDefinitions: (_request, context) => {
        contexts.push(context);
        return new Promise(() => {});
      },
    },
  });
  await expect(coven.requireAutomations().list()).rejects.toMatchObject({ code: 'timeout' });
  expect(contexts).toHaveLength(2);
  expect(contexts[0]).toBe(contexts[1]);
  expect(contexts[1]?.signal.aborted).toBe(true);
});
