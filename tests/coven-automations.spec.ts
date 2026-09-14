import { EventEmitter } from 'node:events';

import {
  COVEN_DAEMON_PROTOCOL,
  createCovenAutomationsClient,
  createCovenAutomationsUnixTransport,
  isCovenClientError,
  type CovenAutomationCapabilities,
  type CovenAutomationDefinition,
  type CovenAutomationDefinitionList,
  type CovenAutomationDefinitionReadRequest,
  type CovenAutomationListOptions,
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
      actions: ['coven.automations.definition.get.v1', 'coven.automations.definition.list.v1'],
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
  response = Buffer.from(JSON.stringify(advertisement()));
  write(value: Uint8Array | string): boolean {
    this.writes.push(Buffer.from(value).toString());
    queueMicrotask(() => this.emit('data', Buffer.concat([
      Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${this.response.length}\r\n\r\n`), this.response,
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

test.skipIf(process.platform === 'win32')('Unix read transport never sends action bytes to an untrusted peer', async () => {
  const { transport, socket } = unixSetup(502);
  await expect(transport.readDefinitions!({ action: getAction, id: 'morning' }, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toBeDefined();
  expect(socket.writes).toEqual([]);
});

test.skipIf(process.platform === 'win32').each([
  null, {}, { action: 'coven.automations.definition.create.v1', id: 'morning' },
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

test.skipIf(process.platform === 'win32')('read transport rejects oversized response without exposing partial results', async () => {
  const { transport, socket } = unixSetup();
  socket.response = Buffer.alloc(16_385);
  await expect(transport.readDefinitions!({ action: listAction, includeTombstoned: false }, {
    signal: new AbortController().signal, deadline: undefined,
  })).rejects.toMatchObject({ code: 'body_limit' });
  expect(socket.destroyed).toBe(true);
});

test.skipIf(process.platform === 'win32')('client reads through two independently authenticated Unix connections', async () => {
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
          ? advertisement() : readEnvelope(getAction, definitionGet())));
        sockets.push(socket);
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      },
    },
  });
  expect(await createCovenAutomationsClient({ transport }).get('morning')).toEqual(definitionGet());
  expect(sockets).toHaveLength(2);
  expect(inspectConnected).toHaveBeenCalledTimes(2);
  expect(sockets[0]?.writes[0]).toMatch(/^GET \/api\/v1\/capabilities /);
  expect(sockets[1]?.writes[0]).toMatch(/^POST \/api\/v1\/actions /);
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
