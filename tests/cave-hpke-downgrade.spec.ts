import { createTestHpkeAuthority } from './helpers/cave-hpke-authority.js';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { createDiscoveredCaveClient, type CaveDiscoveredEndpoint } from '@opencoven/cave-client';
import { createMemorySecretStore, createSecretStoreReference, OperationAbortedError, OperationTimeoutError } from '@opencoven/sdk-core';
import { describe, expect, test, vi } from 'vitest';

import { caveAuthorityBindingFromDiscoveredEndpoint } from '../packages/cave/src/authority-binding.js';

const v1: CaveDiscoveredEndpoint = {
  version: 1,
  endpoint: { kind: 'http', url: 'http://127.0.0.1:3020' },
  freshness: { pid: 4321, nonce: 'legacy-runtime', startedAt: '2026-08-25T15:42:58.109Z' },
  record: { path: '/tmp/cave/client-v1-discovery.json', device: 1, inode: 2 },
};
const v2: CaveDiscoveredEndpoint = {
  ...v1,
  version: 2,
  authority: {
    mechanism: 'hpke-bound-v1', mode: 'enforce', keyId: 'A'.repeat(43),
    publicKey: 'A'.repeat(43), suite: { kemId: 32, kdfId: 1, aeadId: 2 },
  },
};
const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const secret = 'A'.repeat(43);
const envelope = (data: unknown) => ({
  apiVersion: '1.0', minimumClientVersion: '0.0.1',
  capabilities: ['health', 'pairing', 'credentials', 'familiars', 'projects', 'conversations', 'conversation-messages', 'cursors'],
  operations: ['health.read', 'pairing.create', 'pairing.poll', 'pairing.exchange', 'pairing.admin.list', 'pairing.admin.decide', 'credentials.admin.list', 'credentials.admin.revoke', 'familiars.list', 'projects.list', 'conversations.list', 'conversations.read', 'messages.list'],
  data,
});
const health = envelope({
  instanceId: '00000000-0000-4000-8000-000000000000', pairingRequired: true, releaseVersion: '0.3.9',
});
const pairingRequest = { appName: 'Downgrade regression', installationId: 'regression', scopes: ['chat:read' as const] };

function setup(observeV2: boolean) {
  let discoveries = 0;
  const store = createMemorySecretStore();
  const get = vi.spyOn(store, 'get');
  const fetchImplementation = vi.fn((input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (path.endsWith('/health')) return Promise.resolve(Response.json(health));
    if (path.endsWith('/pairing/requests')) {
      return Promise.resolve(Response.json(envelope({ requestId, secret, expiresAt: Date.now() + 60000 }), { status: 201 }));
    }
    return Promise.resolve(Response.json(envelope({ id: requestId, status: 'pending', expiresAt: Date.now() + 60000 })));
  });
  const client = createDiscoveredCaveClient({
    credentials: { store, reference: createSecretStoreReference('downgrade-regression') },
    discoverEndpoint: () => Promise.resolve(++discoveries === 1 && observeV2 ? v2 : v1),
    fetch: fetchImplementation,
  });
  return { client, fetchImplementation, get };
}

describe('discovered client HPKE downgrade protection', () => {
  test('rejects pairing secret dispatch after health has observed v2', async () => {
    const { client, fetchImplementation } = setup(true);
    await client.health();
    const session = await client.createPairing(pairingRequest);
    await expect(session.poll()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  test('rejects a downgraded bearer read before accessing stored credentials', async () => {
    const { client, fetchImplementation, get } = setup(true);
    await client.health();
    await expect(client.listFamiliars()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(get).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test.each(['same', 'different'] as const)('preserves %s-authority credentials when an in-flight lookup observes v2 concurrently', async (authority) => {
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('concurrent-downgrade-regression');
    const serialized = JSON.stringify({
      version: 1,
      bearer: 'B'.repeat(43),
      authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(
        authority === 'same' ? v1 : { ...v1, freshness: { ...v1.freshness, nonce: 'new-authority' } },
        '00000000-0000-4000-8000-000000000000',
      ),
    });
    await store.set(reference.key, serialized);
    const originalGet = store.get.bind(store);
    let releaseLookup!: () => void;
    let lookupStarted!: () => void;
    const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const started = new Promise<void>((resolve) => { lookupStarted = resolve; });
    vi.spyOn(store, 'get').mockImplementationOnce(async (key) => {
      lookupStarted();
      await lookupGate;
      return await originalGet(key);
    });
    let next: CaveDiscoveredEndpoint = v1;
    const fetchImplementation = vi.fn(() => Promise.resolve(Response.json(health)));
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: () => Promise.resolve(next),
      fetch: fetchImplementation,
    });
    const read = client.listFamiliars();
    const rejected = expect(read).rejects.toMatchObject({ code: 'invalid_response' });
    await started;
    try {
      next = v2;
      await client.health();
    } finally {
      next = v1;
      releaseLookup();
    }
    await rejected;
    expect(fetchImplementation.mock.calls).toHaveLength(1);
    expect(await originalGet(reference.key)).toBe(serialized);
  });

  test('keeps rejected exchange secrets unspent for subsequent attempts', async () => {
    const { client, fetchImplementation } = setup(true);
    await client.health();
    const session = await client.createPairing(pairingRequest);
    await expect(session.exchange()).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(session.exchange()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  test('pins a snapshot when a discovery provider later mutates its returned object', async () => {
    const mutable = structuredClone(v1);
    const fetchImplementation = vi.fn((input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      return Promise.resolve(path.endsWith('/pairing/requests')
        ? Response.json(envelope({ requestId, secret, expiresAt: Date.now() + 60000 }), { status: 201 })
        : Response.json(envelope({ id: requestId, status: 'pending', expiresAt: Date.now() + 60000 })));
    });
    const client = createDiscoveredCaveClient({
      credentials: { store: createMemorySecretStore(), reference: createSecretStoreReference('discovery-snapshot') },
      discoverEndpoint: () => Promise.resolve(mutable),
      fetch: fetchImplementation,
    });
    const session = await client.createPairing(pairingRequest);
    mutable.freshness.nonce = 'replaced-runtime';
    await expect(session.poll()).rejects.toMatchObject({ code: 'reconcile_required' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('keeps legacy pairing available on a separate client that has only observed v1', async () => {
    const observed = setup(true);
    await observed.client.health();
    const legacy = setup(false);
    await legacy.client.health();
    const session = await legacy.client.createPairing(pairingRequest);
    await expect(session.poll()).resolves.toMatchObject({ status: 'pending' });
    expect(legacy.fetchImplementation).toHaveBeenCalledTimes(3);
  });
});


describe('discovered HPKE response credential boundary', () => {
  test.each(['plaintext unauthorized', 'plaintext success', 'forged envelope', 'ciphertext from another request'] as const)(
    'preserves the exact stored credential after %s', async (responseKind) => {
      const vector = JSON.parse(await readFile(
        new URL('../packages/cave/fixtures/hpke-bound-v1-vectors.json', import.meta.url), 'utf8',
      )) as { authority: { keyId: string; publicKey: string }; inputs: { instanceId: string; runtimeNonce: string }; response: { enc: string; ciphertext: string } };
      const discovered: CaveDiscoveredEndpoint = {
        ...v2,
        freshness: { ...v2.freshness, nonce: vector.inputs.runtimeNonce },
        authority: { ...v2.authority, keyId: vector.authority.keyId, publicKey: vector.authority.publicKey },
      };
      const store = createMemorySecretStore();
      const reference = createSecretStoreReference('hpke-response-credential-boundary');
      const bearer = 'B'.repeat(43);
      const serialized = JSON.stringify({
        version: 1, bearer,
        authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(discovered, vector.inputs.instanceId),
      });
      await store.set(reference.key, serialized);
      const onEvent = vi.fn();
      const fetchImplementation = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        if (path.endsWith('/health')) {
          return Promise.resolve(Response.json(envelope({ instanceId: vector.inputs.instanceId, pairingRequired: true, releaseVersion: '0.3.9' })));
        }
        const headers = new Headers(init?.headers);
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('x-coven-pairing-secret')).toBe(false);
        expect(JSON.stringify([...headers])).not.toContain(bearer);
        if (responseKind === 'plaintext unauthorized') {
          return Promise.resolve(Response.json({ error: { code: 'unauthorized', message: 'revoked' } }, { status: 401 }));
        }
        if (responseKind === 'plaintext success') return Promise.resolve(Response.json(envelope({ items: [] })));
        return Promise.resolve(Response.json({
          version: 1, mechanism: 'hpke-bound-v1', keyId: vector.authority.keyId,
          requestNonce: responseKind === 'ciphertext from another request' ? headers.get('x-coven-client-v1-authority-request-nonce') : 'C'.repeat(43),
          enc: vector.response.enc, ciphertext: vector.response.ciphertext,
        }, { headers: { 'content-type': 'application/vnd.opencoven.client-v1.hpke-bound-v1+json' } }));
      });
      const client = createDiscoveredCaveClient({
        credentials: { store, reference }, discoverEndpoint: () => Promise.resolve(discovered),
        fetch: fetchImplementation, operation: { observer: { onEvent, onObserverError: vi.fn() } },
      });
      await expect(client.listFamiliars()).rejects.toMatchObject({
        code: 'reconcile_required', retryable: false, details: { reason: 'authority_proof_failed' },
      });
      expect(fetchImplementation.mock.calls.filter(([input]) => new URL(input instanceof Request ? input.url : input).pathname.endsWith('/familiars'))).toHaveLength(1);
      expect(await store.get(reference.key)).toBe(serialized);
      expect(JSON.stringify(onEvent.mock.calls)).not.toContain(bearer);
    },
  );
});


test.each(['authenticated', 'tampered'] as const)('preserves stored credentials after a %s inner unauthorized response', async (kind) => {
  const authority = await createTestHpkeAuthority();
  const store = createMemorySecretStore();
  const reference = createSecretStoreReference('authenticated-inner-unauthorized');
  const bearer = 'B'.repeat(43);
  const serialized = JSON.stringify({ version: 1, bearer,
    authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(authority.discovered, authority.instanceId) });
  await store.set(reference.key, serialized);
  const onEvent = vi.fn();
  let openedRequests = 0;
  const client = createDiscoveredCaveClient({
    credentials: { store, reference }, discoverEndpoint: () => Promise.resolve(authority.discovered),
    operation: { observer: { onEvent, onObserverError: vi.fn() } },
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname.endsWith('/health')) {
        return Response.json(envelope({ instanceId: authority.instanceId, pairingRequired: true, releaseVersion: '0.3.9' }));
      }
      const opened = await authority.open(request);
      openedRequests++;
      expect(opened.authorization).toEqual({ kind: 'bearer', value: bearer });
      const response = await authority.respond(opened, 401, {
        ...envelope(undefined), error: { code: 'unauthorized', message: 'credential revoked', retryable: false },
      });
      if (kind === 'authenticated') return response;
      const body = await response.json() as { ciphertext: string };
      body.ciphertext = (body.ciphertext[0] === 'A' ? 'B' : 'A') + body.ciphertext.slice(1);
      return Response.json(body, { headers: response.headers });
    },
  });
  const result = client.listFamiliars();
  await expect(result).rejects.toMatchObject(kind === 'authenticated'
    ? { code: 'unauthorized', statusCode: 401 }
    : { code: 'reconcile_required', details: { reason: 'authority_proof_failed' } });
  await result.catch((error: unknown) => {
    expect(String(error)).not.toContain(bearer);
    expect(JSON.stringify(error)).not.toContain(bearer);
  });
  expect(openedRequests).toBe(1);
  expect(await store.get(reference.key)).toBe(serialized);
  expect(JSON.stringify(onEvent.mock.calls)).not.toContain(bearer);
});


test.each(['error', 'aborted', 'timeout'] as const)('redacts a hostile protected-fetch %s from the complete public error', async (kind) => {
  const authority = await createTestHpkeAuthority();
  const store = createMemorySecretStore();
  const reference = createSecretStoreReference('hpke-hostile-fetch-cause');
  const bearer = 'B'.repeat(43);
  const serialized = JSON.stringify({ version: 1, bearer,
    authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(authority.discovered, authority.instanceId) });
  await store.set(reference.key, serialized);
  const onEvent = vi.fn();
  let protectedRequests = 0;
  let requestNonce = '';
  const client = createDiscoveredCaveClient({
    credentials: { store, reference }, discoverEndpoint: () => Promise.resolve(authority.discovered),
    operation: { observer: { onEvent, onObserverError: vi.fn() } },
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname.endsWith('/health')) {
        return Response.json(envelope({ instanceId: authority.instanceId, pairingRequired: true, releaseVersion: '0.3.9' }));
      }
      const opened = await authority.open(request);
      expect(opened.authorization).toEqual({ kind: 'bearer', value: bearer });
      protectedRequests++;
      requestNonce = request.headers.get('x-coven-client-v1-authority-request-nonce')!;
      expect(requestNonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      const detail = `hostile transport detail ${bearer} ${requestNonce}`;
      if (kind === 'aborted') throw new OperationAbortedError({ system: 'cave', operation: detail }, { cause: new Error(detail) });
      if (kind === 'timeout') throw new OperationTimeoutError({ system: 'cave', operation: detail }, 123);
      throw new Error(detail);
    },
  });
  const result = client.listFamiliars();
  await expect(result).rejects.toMatchObject({ code: kind === 'error' ? 'service_unavailable' : kind, retryable: kind !== 'aborted' });
  expect(protectedRequests).toBe(1);
  await result.catch((error: unknown) => {
    for (const output of [String(error), JSON.stringify(error), inspect(error, { depth: null })]) {
      expect(output).not.toContain(bearer);
      expect(output).not.toContain(requestNonce);
      expect(output).not.toContain('hostile transport detail');
    }
  });
  expect(await store.get(reference.key)).toBe(serialized);
  for (const output of [JSON.stringify(onEvent.mock.calls), inspect(onEvent.mock.calls, { depth: null })]) {
    expect(output).not.toContain(bearer);
    expect(output).not.toContain(requestNonce);
  }
});


test.each(['aborted', 'timeout'] as const)('preserves genuine HPKE context %s over a hostile fetch rejection', async (kind) => {
  const authority = await createTestHpkeAuthority();
  const store = createMemorySecretStore();
  const reference = createSecretStoreReference('hpke-context-termination');
  const bearer = 'B'.repeat(43);
  const serialized = JSON.stringify({ version: 1, bearer,
    authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(authority.discovered, authority.instanceId) });
  await store.set(reference.key, serialized);
  const controller = new AbortController();
  let protectedRequests = 0;
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => { started = resolve; });
  const client = createDiscoveredCaveClient({
    credentials: { store, reference }, discoverEndpoint: () => Promise.resolve(authority.discovered),
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname.endsWith('/health')) {
        return Response.json(envelope({ instanceId: authority.instanceId, pairingRequired: true, releaseVersion: '0.3.9' }));
      }
      const opened = await authority.open(request);
      expect(opened.authorization).toEqual({ kind: 'bearer', value: bearer });
      protectedRequests++;
      return await new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(kind === 'timeout'
            ? new OperationAbortedError({ system: 'cave', operation: bearer }, { cause: new Error(bearer) })
            : new OperationTimeoutError({ system: 'cave', operation: bearer }, 123));
        }, { once: true });
        started();
      });
    },
  });
  vi.useFakeTimers();
  try {
    const result = client.listFamiliars({ signal: controller.signal, timeoutMs: 1000 });
    const rejected = expect(result).rejects.toMatchObject({ code: kind, retryable: kind === 'timeout' });
    await dispatched;
    expect(protectedRequests).toBe(1);
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(1000);
    else controller.abort();
    await rejected;
    await result.catch((error: unknown) => {
      expect(inspect(error, { depth: null })).not.toContain(bearer);
    });
    expect(await store.get(reference.key)).toBe(serialized);
  } finally {
    controller.abort();
    vi.useRealTimers();
  }
});


test('rejects a real replacement listener after health without exposing credentials', async () => {
  const authority = await createTestHpkeAuthority();
  const observed: { path: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    observed.push({ path, headers: { ...request.headers } });
    response.setHeader('content-type', 'application/json');
    if (path.endsWith('/health')) {
      response.end(JSON.stringify(envelope({ instanceId: authority.instanceId, pairingRequired: true, releaseVersion: '0.3.9' })));
      return;
    }
    response.statusCode = 401;
    response.end(JSON.stringify({ error: { code: 'unauthorized', message: 'replacement listener', retryable: false } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing loopback listener address.');
    const discovered = { ...authority.discovered,
      endpoint: { kind: 'http' as const, url: `http://127.0.0.1:${address.port}` } };
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('hpke-real-replacement-listener');
    const bearer = 'B'.repeat(43);
    const serialized = JSON.stringify({ version: 1, bearer,
      authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(discovered, authority.instanceId) });
    await store.set(reference.key, serialized);
    const client = createDiscoveredCaveClient({
      credentials: { store, reference }, discoverEndpoint: () => Promise.resolve(discovered),
    });
    await expect(client.listFamiliars()).rejects.toMatchObject({
      code: 'reconcile_required', retryable: false, details: { reason: 'authority_proof_failed' },
    });
    expect(observed.map(({ path }) => path)).toEqual(['/api/client/v1/health', '/api/client/v1/familiars?limit=50']);
    const headers = observed[1]!.headers;
    expect(headers['x-coven-client-v1-authority']).toBe('hpke-bound-v1');
    expect(headers['x-coven-client-v1-authority-key-id']).toBe(authority.discovered.authority.keyId);
    expect(headers['x-coven-client-v1-authority-ciphertext']).toEqual(expect.any(String));
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-coven-pairing-secret']).toBeUndefined();
    expect(JSON.stringify(observed)).not.toContain(bearer);
    expect(await store.get(reference.key)).toBe(serialized);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
      server.closeAllConnections();
    });
  }
});
