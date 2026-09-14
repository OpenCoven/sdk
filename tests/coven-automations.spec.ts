import { EventEmitter } from 'node:events';

import {
  COVEN_DAEMON_PROTOCOL,
  createCovenAutomationsClient,
  createCovenAutomationsUnixTransport,
  isCovenClientError,
  type CovenAutomationCapabilities,
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
      actions: ['coven.automations.definition.get.v1'],
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
  ...['actions', 'policy', 'status'].map((key) => ({
    capabilities: [{ ...advertisement().capabilities[0], [key]: null }],
  })),
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

test.each([Buffer.from('{'), Buffer.from([0xff]), Buffer.alloc(16_385)])('rejects invalid or oversized bytes %#', async (body) => {
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
