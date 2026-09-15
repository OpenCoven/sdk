import { readFile } from 'node:fs/promises';
import { createDiscoveredCaveClient, type CaveDiscoveredEndpoint } from '@opencoven/cave-client';
import { createMemorySecretStore, createSecretStoreReference } from '@opencoven/sdk-core';
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
