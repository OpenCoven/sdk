import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import * as coven from '@opencoven/coven-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { afterEach, expect, test as testAllPlatforms, vi } from 'vitest';

const test = testAllPlatforms.skipIf(process.platform === 'win32');

const NOW = 1_800_000_000_000;
const body = Buffer.from('{"contract":"coven.session-policy.v1","requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","invocationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","profile":"workspace-readonly-no-network.v1","expiresAtUnixMs":1800000030000,"launch":{"projectRoot":"/example/project","cwd":"/example/project","harness":"codex","familiarId":"sage","launchMode":"nonInteractive","prompt":"Review","title":""}}');
const refusal = {
  contract: 'coven.session-policy.v1',
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  invocationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestDigest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
  decision: 'rejected',
  code: 'enforcement_unavailable',
  admission: 'not_started',
};
const discovery = {
  contract: 'coven.session-policy.v1', enforcement: 'unavailable',
  supportedProfiles: [], reason: 'no_verified_enforcement_backend',
};
const endpoint: coven.CovenDiscoveredEndpoint = {
  version: 1, protocol: coven.COVEN_DAEMON_PROTOCOL, source: 'coven_home',
  endpoint: { kind: 'unix', path: '/example/coven.sock' },
};
const identity: coven.CovenUnixFileIdentity = {
  device: 1, inode: 2, ownerUid: 501, mode: 0o140600, symbolicLink: false, socket: true,
};

class Socket extends EventEmitter implements coven.CovenConnectedSocket {
  connecting = false;
  destroyed = false;
  paused = false;
  writes: Buffer[] = [];
  onWrite: ((bytes: Buffer) => void) | undefined;
  write(value: Uint8Array | string): boolean {
    const bytes = Buffer.from(value);
    this.writes.push(bytes);
    this.onWrite?.(bytes);
    return true;
  }
  pause(): this { this.paused = true; return this; }
  resume(): this { this.paused = false; return this; }
  end(): this { return this; }
  destroy(): this { this.destroyed = true; return this; }
}

function frame(status: number, value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value));
  return Buffer.concat([
    Buffer.from(`HTTP/1.1 ${status} Response\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\n\r\n`),
    bytes,
  ]);
}

function setup(response = frame(409, refusal)) {
  const socket = new Socket();
  socket.onWrite = () => { queueMicrotask(() => socket.emit('data', response)); };
  const connect = vi.fn(() => {
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  const lstat = vi.fn(() => Promise.resolve({ ...identity }));
  const inspectConnected = vi.fn((connected: coven.CovenConnectedSocket) => {
    expect(connected).toBe(socket);
    expect(socket.paused).toBe(true);
    return Promise.resolve({ uid: 501 });
  });
  const options = {
    security: { platform: 'unix' as const, peerIdentity: { inspectConnected } },
    dependencies: { connect, lstat, getEffectiveUid: () => 501 },
  };
  return { socket, connect, lstat, inspectConnected, options };
}

function transport(options: {
  security: coven.CovenUnixTransportSecurityProvider;
  dependencies?: coven.CovenUnixTransportDependencies;
}, discovered = endpoint): coven.CovenSessionPolicyTransport {
  const factory = (coven as {
    createCovenSessionPolicyUnixTransport?: (
      endpoint: coven.CovenDiscoveredEndpoint,
      options: { security: coven.CovenUnixTransportSecurityProvider; dependencies?: coven.CovenUnixTransportDependencies },
    ) => coven.CovenSessionPolicyTransport;
  }).createCovenSessionPolicyUnixTransport;
  expect(factory).toBeTypeOf('function');
  if (factory === undefined) throw new Error('Missing real Unix policy transport');
  return factory(discovered, options);
}

function context(): OperationContext {
  return { signal: new AbortController().signal, deadline: undefined };
}

const get = Object.freeze({
  method: 'GET', path: '/api/v1/session-policy', maxResponseBytes: 16384,
} as const);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test('constructs a real Unix policy transport without discovery, ownership, or socket I/O', () => {
  const seam = setup();
  expect(transport(seam.options)).toHaveProperty('request');
  expect(seam.connect).not.toHaveBeenCalled();
  expect(seam.lstat).not.toHaveBeenCalled();
  expect(seam.inspectConnected).not.toHaveBeenCalled();
});

test('sends only fixed policy GET and returns bounded raw bytes and HTTP status', async () => {
  const seam = setup(frame(403, { error: { code: 'forbidden', message: 'no' } }));
  const response = await transport(seam.options).request(get, context());
  expect(response.status).toBe(403);
  expect(Buffer.from(response.body)).toEqual(Buffer.from('{"error":{"code":"forbidden","message":"no"}}'));
  expect(seam.socket.writes).toEqual([Buffer.from(
    'GET /api/v1/session-policy HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  )]);
  expect(seam.connect).toHaveBeenCalledTimes(1);
  expect(seam.lstat).toHaveBeenCalledTimes(2);
  expect(seam.socket.destroyed).toBe(true);
});

test('client resolves a real framed HTTP409 refusal from one exact-byte POST', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const seam = setup();
  const client = coven.createCovenSessionPolicyClient({ transport: transport(seam.options) });
  const input = Buffer.from(body);
  const result = client.launchRestricted(input);
  input.fill(0);
  await expect(result).resolves.toEqual(refusal);
  expect(seam.socket.writes).toEqual([Buffer.concat([
    Buffer.from(`POST /api/v1/sessions/restricted HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n`),
    body,
  ])]);
  expect(seam.connect).toHaveBeenCalledTimes(1);
  expect(seam.socket.destroyed).toBe(true);
});

test('does not write before exact connected-peer and path revalidation finishes', async () => {
  vi.useFakeTimers();
  const seam = setup(frame(200, discovery));
  let release: ((value: { uid: number }) => void) | undefined;
  seam.inspectConnected.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const result = transport(seam.options).request(get, context());
  await vi.advanceTimersByTimeAsync(0);
  expect(seam.socket.paused).toBe(true);
  expect(seam.socket.writes).toEqual([]);
  release?.({ uid: 501 });
  await expect(result).resolves.toMatchObject({ status: 200 });
  expect(seam.socket.writes).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  { ownerUid: 502 }, { symbolicLink: true }, { socket: false }, { mode: 0o140622 },
])('rejects unsafe initial Unix identity %# before connect', async (change) => {
  const seam = setup();
  seam.lstat.mockResolvedValue({ ...identity, ...change });
  await expect(transport(seam.options).request(get, context())).rejects.toMatchObject({ retryable: false });
  expect(seam.connect).not.toHaveBeenCalled();
});

test.each(['peer', 'path', 'provider'])('fails closed on %s revalidation without a write', async (failure) => {
  const seam = setup();
  if (failure === 'peer') seam.inspectConnected.mockResolvedValue({ uid: 502 });
  if (failure === 'path') seam.lstat.mockResolvedValueOnce(identity).mockResolvedValue({ ...identity, inode: 3 });
  if (failure === 'provider') seam.inspectConnected.mockRejectedValue(new Error('private peer provider cause'));
  const error: unknown = await transport(seam.options).request(get, context()).catch((error: unknown) => error);
  expect(error).toMatchObject({ retryable: false });
  expect(error).not.toHaveProperty('cause');
  expect(JSON.stringify(error)).not.toContain('private');
  expect(seam.socket.writes).toEqual([]);
  expect(seam.socket.destroyed).toBe(true);
});

test('rejects an oversized frame chunk before allocating a concatenated response', async () => {
  const seam = setup(Buffer.alloc(65_536 + 16_384 + 5, 0x20));
  const concatenate = vi.spyOn(Buffer, 'concat');
  await expect(transport(seam.options).request(get, context())).rejects.toMatchObject({
    code: 'invalid_response', retryable: false,
  });
  expect(concatenate).not.toHaveBeenCalled();
  expect(seam.socket.destroyed).toBe(true);
});

test.each([
  Buffer.from('HTTP/1.1 409 No\r\nContent-Length: 16385\r\n\r\n'),
  Buffer.from('HTTP/1.1 409 No\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}'),
  Buffer.from('HTTP/1.1 409 No\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n'),
  Buffer.from('HTTP/1.1 409 No\r\nContent-Length: 2\r\n\r\n{}x'),
  Buffer.from('HTTP/1.1 409 No\r\nX-Large: ' + 'a'.repeat(65537)),
])('rejects invalid or oversized HTTP framing %# and never retries', async (response) => {
  const seam = setup(response);
  await expect(transport(seam.options).request(get, context())).rejects.toMatchObject({
    code: 'invalid_response', retryable: false,
  });
  expect(seam.connect).toHaveBeenCalledTimes(1);
  expect(seam.socket.writes).toHaveLength(1);
  expect(seam.socket.destroyed).toBe(true);
});

test('keeps duplicate JSON bytes intact for strict client rejection', async () => {
  const duplicate = Buffer.from('{"contract":"coven.session-policy.v1","contract":"coven.session-policy.v1"}');
  const response = Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${duplicate.length}\r\n\r\n`), duplicate,
  ]);
  const seam = setup(response);
  await expect(coven.createCovenSessionPolicyClient({ transport: transport(seam.options) }).discover())
    .rejects.toMatchObject({ code: 'invalid_response', delivery: 'unknown' });
  expect(seam.connect).toHaveBeenCalledTimes(1);
});

test('rejects unsolicited response bytes while peer validation is pending', async () => {
  const seam = setup();
  seam.inspectConnected.mockImplementation(() => {
    seam.socket.emit('data', frame(200, discovery));
    return Promise.resolve({ uid: 501 });
  });
  await expect(transport(seam.options).request(get, context())).rejects.toMatchObject({ code: 'invalid_response' });
  expect(seam.socket.writes).toEqual([]);
  expect(seam.socket.destroyed).toBe(true);
});

test('cancellation before transport never begins filesystem or socket work', async () => {
  const seam = setup();
  const controller = new AbortController();
  controller.abort(new Error('private abort'));
  const error: unknown = await transport(seam.options).request(get, { signal: controller.signal, deadline: undefined })
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: 'aborted', retryable: false });
  expect(error).not.toHaveProperty('cause');
  expect(seam.lstat).not.toHaveBeenCalled();
  expect(seam.connect).not.toHaveBeenCalled();
});

test('cancellation after POST destroys the socket and remains unknown delivery', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const seam = setup();
  const controller = new AbortController();
  seam.socket.onWrite = () => { controller.abort(new Error('private abort')); };
  const client = coven.createCovenSessionPolicyClient({ transport: transport(seam.options) });
  await expect(client.launchRestricted(body, { signal: controller.signal })).rejects.toMatchObject({
    code: 'aborted', delivery: 'unknown', retryable: false,
  });
  expect(seam.socket.destroyed).toBe(true);
  expect(seam.socket.writes).toHaveLength(1);
  expect(seam.connect).toHaveBeenCalledTimes(1);
});

test.each(['lstat', 'peer', 'read'])('bounds a stalled %s operation even for direct transport use', async (phase) => {
  vi.useFakeTimers();
  const seam = setup();
  if (phase === 'lstat') seam.lstat.mockImplementation(() => new Promise(() => undefined));
  if (phase === 'peer') seam.inspectConnected.mockImplementation(() => new Promise(() => undefined));
  if (phase === 'read') seam.socket.onWrite = undefined;
  const result = transport(seam.options).request(get, context());
  const assertion = expect(result).rejects.toMatchObject({ code: 'timeout', retryable: false });
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  expect(seam.socket.writes).toHaveLength(phase === 'read' ? 1 : 0);
  expect(vi.getTimerCount()).toBe(0);
});

test('client preserves a native connect timeout without retrying or claiming refusal', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const seam = setup();
  seam.connect.mockImplementation(() => seam.socket);
  const client = coven.createCovenSessionPolicyClient({ transport: transport(seam.options) });
  const result = client.launchRestricted(body, { timeoutMs: 10_000 });
  const assertion = expect(result).rejects.toMatchObject({
    code: 'timeout', delivery: 'unknown', retryable: false,
  });
  await vi.advanceTimersByTimeAsync(2000);
  await assertion;
  expect(seam.connect).toHaveBeenCalledTimes(1);
  expect(seam.socket.writes).toEqual([]);
  expect(seam.socket.destroyed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('client rejects fabricated accepted HTTP201 from the actual framing path', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const seam = setup(frame(201, { ...refusal, decision: 'accepted', admission: 'started' }));
  const client = coven.createCovenSessionPolicyClient({ transport: transport(seam.options) });
  await expect(client.launchRestricted(body))
    .rejects.toMatchObject({ code: 'invalid_response', statusCode: 201, delivery: 'unknown' });
  expect(seam.connect).toHaveBeenCalledTimes(1);
  expect(seam.socket.writes).toHaveLength(1);
  expect(seam.socket.destroyed).toBe(true);
});

test.each([
  { method: 'GET', path: '/api/v1/health', maxResponseBytes: 16384 },
  { method: 'POST', path: '/api/v1/sessions', maxResponseBytes: 16384, body: [] },
  { method: 'DELETE', path: '/api/v1/sessions/restricted', maxResponseBytes: 16384, body: [] },
  { ...get, headers: { Authorization: 'private' } },
  { ...get, maxResponseBytes: 16385 },
  { method: 'POST', path: '/api/v1/sessions/restricted', maxResponseBytes: 16384, body: [123, 125] },
])('has no mutable-byte or generic request escape %#', async (request) => {
  const seam = setup();
  const policy = transport(seam.options);
  // @ts-expect-error Exercise runtime rejection of non-contract request shapes.
  const result: unknown = await policy.request(Object.freeze(request), context())
    .catch((error: unknown) => error);
  expect(result).toMatchObject({ code: 'invalid_request', retryable: false });
  expect(seam.connect).not.toHaveBeenCalled();
});

testAllPlatforms('explicitly rejects Windows without filesystem or connection work', () => {
  const seam = setup();
  expect(() => transport(seam.options, {
    ...endpoint, endpoint: { kind: 'windowsNamedPipe', path: '\\\\.\\pipe\\coven' },
  })).toThrow(expect.objectContaining({ code: 'unsupported_platform' }));
  expect(seam.connect).not.toHaveBeenCalled();
  expect(seam.lstat).not.toHaveBeenCalled();
});

test('rejects hostile frozen-byte reflection without retaining a sensitive error', async () => {
  const seam = setup();
  const octets = new Proxy(Object.freeze([123, 125]), {
    getOwnPropertyDescriptor() { throw new Error('private byte access'); },
  });
  const error: unknown = await transport(seam.options).request(Object.freeze({
    method: 'POST',
    path: '/api/v1/sessions/restricted',
    maxResponseBytes: 16384,
    body: octets,
  }), context()).catch((error: unknown) => error);
  expect(error).toMatchObject({ code: 'invalid_request', retryable: false });
  expect(String(error)).not.toContain('private');
  expect(error).not.toHaveProperty('cause');
  expect(seam.connect).not.toHaveBeenCalled();
});

test('keeps the built-in health wire request unchanged', async () => {
  const seam = setup(frame(200, {
    ok: true, apiVersion: coven.COVEN_DAEMON_PROTOCOL, covenVersion: '0.1.0',
    capabilities: { sessions: true, events: true, structuredErrors: true },
  }));
  await coven.createCovenUnixTransport(endpoint, seam.options).health();
  expect(seam.socket.writes).toEqual([Buffer.from(
    'GET /api/v1/health HTTP/1.1\r\nHost: coven\r\nAccept: application/json\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  )]);
});
