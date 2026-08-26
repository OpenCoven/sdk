import {
  CaveClientError,
  createDiscoveredCaveClient,
  type CaveDiscoveredEndpoint,
} from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
} from '@opencoven/sdk-core';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createTestHpkeAuthority,
  type OpenedTestRequest,
} from './helpers/cave-hpke-authority.js';

const PAIRING_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BEARER = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const REQUEST_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const CREDENTIAL_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba002';
const CAPABILITIES = [
  'health',
  'pairing',
  'credentials',
  'familiars',
  'projects',
  'conversations',
  'conversation-messages',
  'cursors',
];
const OPERATIONS = [
  'health.read',
  'pairing.create',
  'pairing.poll',
  'pairing.exchange',
  'pairing.admin.list',
  'pairing.admin.decide',
  'credentials.admin.list',
  'credentials.admin.revoke',
  'familiars.list',
  'projects.list',
  'conversations.list',
  'conversations.read',
  'messages.list',
];

function envelope(data: unknown, cursor?: unknown): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: CAPABILITIES,
    operations: OPERATIONS,
    ...(cursor === undefined ? {} : { cursor }),
    data,
  };
}

function errorEnvelope(
  code: string,
  reason: string,
  retryable: boolean,
): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: CAPABILITIES,
    operations: OPERATIONS,
    error: {
      code,
      message: 'Fixed test error.',
      retryable,
      details: { reason },
    },
  };
}

function healthEnvelope(instanceId: string): Record<string, unknown> {
  return envelope({
    instanceId,
    pairingRequired: true,
    releaseVersion: '0.3.10',
  });
}

function cursor() {
  return {
    current:
      'eyJ2IjoxLCJzIjoiMjAyNi0wOC0xNVQwMDowMDowMS4wMDBaIiwiaSI6ImNvbnZlcnNhdGlvbi1leGFtcGxlIn0',
    hasMore: false,
  };
}

function familiarPage(): Record<string, unknown> {
  return envelope(
    {
      familiars: [
        { id: 'cody', displayName: 'Cody', role: 'Implementation' },
      ],
    },
    cursor(),
  );
}

async function seedBearer(
  store: ReturnType<typeof createMemorySecretStore>,
  reference: ReturnType<typeof createSecretStoreReference>,
  discovered: Extract<CaveDiscoveredEndpoint, { version: 2 }>,
  instanceId: string,
): Promise<string> {
  const serialized = JSON.stringify({
    version: 1,
    bearer: BEARER,
    authorityBinding: {
      version: 1,
      instanceId,
      endpoint: discovered.endpoint,
      record: {
        identity: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        device: discovered.record.device,
        inode: discovered.record.inode,
      },
      freshness: discovered.freshness,
    },
  });
  await store.set(reference.key, serialized);
  return serialized;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('direct Cave hpke-bound-v1 transport', () => {
  test('uses the same bound transport in enforce mode', async () => {
    const authority = await createTestHpkeAuthority(
      'http://127.0.0.1:3020',
      'enforce',
    );
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-enforce');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const opened = await authority.open(request);
        return await authority.respond(opened, 200, familiarPage());
      },
    });

    await expect(client.listFamiliars()).resolves.toMatchObject({
      data: [{ id: 'cody' }],
    });
  });

  test('protects exactly seven operations and applies only Auth-opened responses', async () => {
    const authority = await createTestHpkeAuthority();
    const discovered: CaveDiscoveredEndpoint = authority.discovered;
    const protectedRoutes: string[] = [];
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request =
          input instanceof Request
            ? input
            : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/api/client/v1/health') {
          expect(request.headers.get('authorization')).toBeNull();
          expect(
            request.headers.get('x-coven-client-v1-authority'),
          ).toBeNull();
          return Response.json(healthEnvelope(authority.instanceId));
        }
        if (url.pathname === '/api/client/v1/pairing/requests') {
          expect(request.headers.get('x-coven-pairing-secret')).toBeNull();
          expect(
            request.headers.get('x-coven-client-v1-authority'),
          ).toBeNull();
          return Response.json(
            envelope({
              requestId: REQUEST_ID,
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
            { status: 201 },
          );
        }

        const opened = await authority.open(request);
        protectedRoutes.push(`${request.method} ${url.pathname}`);
        return await protectedResponse(url.pathname, opened, authority);
      },
    );
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-direct');
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => discovered,
      fetch: fetchImplementation,
    });

    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-direct',
      scopes: ['chat:read'],
    });
    await expect(pairing.poll()).resolves.toMatchObject({
      id: REQUEST_ID,
      status: 'approved',
    });
    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    await expect(client.listFamiliars()).resolves.toMatchObject({
      data: [{ id: 'cody' }],
    });
    await expect(client.listProjects()).resolves.toMatchObject({
      data: [{ id: 'project-1' }],
    });
    await expect(client.listConversations()).resolves.toMatchObject({
      data: [{ id: 'conversation-1' }],
    });
    await expect(client.getConversation('conversation-1')).resolves.toMatchObject({
      id: 'conversation-1',
    });
    await expect(
      client.listConversationMessages('conversation-1'),
    ).resolves.toMatchObject({
      data: [{ id: 'message-1' }],
    });

    expect(protectedRoutes).toEqual([
      `GET /api/client/v1/pairing/requests/${REQUEST_ID}`,
      `POST /api/client/v1/pairing/requests/${REQUEST_ID}/exchange`,
      'GET /api/client/v1/familiars',
      'GET /api/client/v1/projects',
      'GET /api/client/v1/conversations',
      'GET /api/client/v1/conversations/conversation-1',
      'GET /api/client/v1/conversations/conversation-1/messages',
    ]);
  });

  test.each([
    {
      label: 'plaintext unauthorized response',
      response: () =>
        Response.json(errorEnvelope('unauthorized', 'revoked', false), {
          status: 401,
        }),
    },
    {
      label: 'forged HPKE envelope',
      response: () =>
        Response.json(
          {
            version: 1,
            mechanism: 'hpke-bound-v1',
            keyId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            requestNonce: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            enc: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
            ciphertext: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
          },
          {
            status: 200,
            headers: {
              'content-type':
                'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
            },
          },
        ),
    },
    {
      label: 'plaintext success replacement',
      response: () => Response.json(familiarPage()),
    },
  ])('maps $label to one redacted failure and preserves credentials', async ({
    response,
  }) => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-forgery');
    const before = await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async () => response(),
    });

    const error = await client.listFamiliars().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CaveClientError);
    expect(error).toMatchObject({
      code: 'invalid_response',
      retryable: false,
      details: undefined,
    });
    expect(error instanceof Error ? error.message : String(error)).toBe(
      'cave.listFamiliars: invalid_response',
    );
    expect(await store.get(reference.key)).toBe(before);
  });

  test('redacts hostile fetch failures from errors and observers', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-fetch-redaction');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const events: unknown[] = [];
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async () => {
        throw new Error(`hostile fetch leaked ${BEARER}`);
      },
      operation: {
        observer: {
          onEvent(event) {
            events.push(event);
          },
          onObserverError(error) {
            throw error;
          },
        },
      },
    });

    const error = await client.listFamiliars().catch((caught: unknown) => caught);
    const serialized = JSON.stringify({
      error: inspect(error),
      events,
    });

    expect(error).toMatchObject({
      code: 'service_unavailable',
      retryable: true,
    });
    expect(serialized).not.toContain(BEARER);
    expect(serialized).not.toMatch(
      /x-coven-client-v1-authority|ciphertext|requestNonce/iu,
    );
  });

  test('fails closed against a real-socket replacement listener', async () => {
    const observedHeaders: Record<string, string | string[] | undefined>[] = [];
    const server = createServer((request, response) => {
      observedHeaders.push(request.headers);
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(errorEnvelope('unauthorized', 'replacement', false)),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Replacement listener did not bind.');
    }

    try {
      const authority = await createTestHpkeAuthority(
        `http://127.0.0.1:${address.port}`,
      );
      const store = createMemorySecretStore();
      const reference = createSecretStoreReference(
        'cave-hpke-real-socket-replacement',
      );
      const before = await seedBearer(
        store,
        reference,
        authority.discovered,
        authority.instanceId,
      );
      const client = createDiscoveredCaveClient({
        credentials: { store, reference },
        discoverEndpoint: async () => authority.discovered,
      });

      await expect(client.listFamiliars()).rejects.toMatchObject({
        code: 'invalid_response',
        retryable: false,
      });
      expect(observedHeaders).toHaveLength(1);
      expect(observedHeaders[0]?.authorization).toBeUndefined();
      expect(observedHeaders[0]?.['x-coven-pairing-secret']).toBeUndefined();
      expect(observedHeaders[0]?.['x-coven-client-v1-authority']).toBe(
        'hpke-bound-v1',
      );
      expect(await store.get(reference.key)).toBe(before);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  test('uses authenticated inner unauthorized semantics only after Auth open', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-inner-unauthorized');
    const before = await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const opened = await authority.open(request);
        return await authority.respond(
          opened,
          401,
          errorEnvelope('unauthorized', 'credential_revoked', false),
        );
      },
    });

    await expect(client.listFamiliars()).rejects.toMatchObject({
      code: 'unauthorized',
      statusCode: 401,
    });
    expect(await store.get(reference.key)).toBe(before);
  });

  test('rediscoveries once for plaintext stale-key guidance and reseals fresh bytes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_787_672_578_109);
    const first = await createTestHpkeAuthority();
    const second = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-stale-key');
    await seedBearer(store, reference, first.discovered, first.instanceId);
    const discoveries = [first.discovered, second.discovered];
    const nonces: string[] = [];
    const encapsulatedKeys: string[] = [];
    const issuedAtValues: number[] = [];
    const responsePublicKeys: string[] = [];
    let attempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => discoveries.shift() ?? second.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        nonces.push(
          request.headers.get(
            'x-coven-client-v1-authority-request-nonce',
          ) ?? '',
        );
        encapsulatedKeys.push(
          request.headers.get('x-coven-client-v1-authority-enc') ?? '',
        );
        issuedAtValues.push(
          Number(
            request.headers.get('x-coven-client-v1-authority-issued-at'),
          ),
        );
        attempts += 1;
        if (attempts === 1) {
          expect(
            request.headers.get('x-coven-client-v1-authority-key-id'),
          ).toBe(first.discovered.authority.keyId);
          responsePublicKeys.push(
            (await first.open(request)).responsePublicKeyEncoded,
          );
          return Response.json(
            errorEnvelope('conflict', 'authority_key_stale', true),
            { status: 409 },
          );
        }
        expect(
          request.headers.get('x-coven-client-v1-authority-key-id'),
        ).toBe(second.discovered.authority.keyId);
        const opened = await second.open(request);
        responsePublicKeys.push(opened.responsePublicKeyEncoded);
        return await second.respond(opened, 200, familiarPage());
      },
    });

    await expect(client.listFamiliars()).resolves.toMatchObject({
      data: [{ id: 'cody' }],
    });
    expect(attempts).toBe(2);
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).not.toBe(nonces[1]);
    expect(encapsulatedKeys[0]).not.toBe(encapsulatedKeys[1]);
    expect(issuedAtValues[1]).toBeGreaterThan(issuedAtValues[0] ?? 0);
    expect(responsePublicKeys).toHaveLength(2);
    expect(responsePublicKeys[0]).not.toBe(responsePublicKeys[1]);
    now.mockRestore();
  });

  test('never falls back to v1 plaintext after observing discovery v2', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-downgrade');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const v1: CaveDiscoveredEndpoint = {
      version: 1,
      endpoint: authority.discovered.endpoint,
      freshness: {
        pid: 4_321,
        nonce: 'legacy-runtime',
        startedAt: '2026-08-25T15:42:58.109Z',
      },
      record: authority.discovered.record,
    };
    const discoveries = [authority.discovered, v1];
    const fetchImplementation = vi.fn(async () =>
      Response.json(healthEnvelope(authority.instanceId)),
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => discoveries.shift() ?? v1,
      fetch: fetchImplementation,
    });

    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
    await expect(client.listFamiliars()).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('retries authenticated replay capacity once with a fresh envelope', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-capacity');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const nonces: string[] = [];
    let attempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const opened = await authority.open(request);
        nonces.push(opened.binding.requestNonce);
        attempts += 1;
        return attempts === 1
          ? await authority.respond(
              opened,
              503,
              errorEnvelope(
                'service_unavailable',
                'authority_replay_capacity',
                true,
              ),
              { retryAfter: '0' },
            )
          : await authority.respond(opened, 200, familiarPage());
      },
    });

    await expect(client.listFamiliars()).resolves.toMatchObject({
      data: [{ id: 'cody' }],
    });
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test('retries pairing exchange only for authenticated replay-capacity non-dispatch', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-exchange-capacity');
    const exchangeNonces: string[] = [];
    let exchangeAttempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/api/client/v1/health') {
          return Response.json(healthEnvelope(authority.instanceId));
        }
        if (path === '/api/client/v1/pairing/requests') {
          return Response.json(
            envelope({
              requestId: REQUEST_ID,
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
            { status: 201 },
          );
        }
        const opened = await authority.open(request);
        expect(opened.authorization).toEqual({
          kind: 'pairing-secret',
          value: PAIRING_SECRET,
        });
        exchangeNonces.push(opened.binding.requestNonce);
        exchangeAttempts += 1;
        return exchangeAttempts === 1
          ? await authority.respond(
              opened,
              503,
              errorEnvelope(
                'service_unavailable',
                'authority_replay_capacity',
                true,
              ),
              { retryAfter: '0' },
            )
          : await authority.respond(
              opened,
              200,
              envelope({
                bearer: BEARER,
                credential: {
                  id: CREDENTIAL_ID,
                  appName: 'OpenCoven Chat',
                  installationId: 'hpke-exchange-capacity',
                  scopes: ['chat:read'],
                  createdAt: 1_755_730_812_617,
                  lastUsedAt: null,
                  revokedAt: null,
                  revocationReason: null,
                },
              }),
            );
      },
    });
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-exchange-capacity',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(exchangeAttempts).toBe(2);
    expect(exchangeNonces[0]).not.toBe(exchangeNonces[1]);
    expect(await store.get(reference.key)).toContain(BEARER);
  });

  test('does not retry pairing exchange after an unproved dispatch failure', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-exchange-dispatch');
    let exchangeAttempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/api/client/v1/health') {
          return Response.json(healthEnvelope(authority.instanceId));
        }
        if (path === '/api/client/v1/pairing/requests') {
          return Response.json(
            envelope({
              requestId: REQUEST_ID,
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
            { status: 201 },
          );
        }
        await authority.open(request);
        exchangeAttempts += 1;
        throw new Error('connection reset after dispatch');
      },
    });
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-exchange-dispatch',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'service_unavailable',
      retryable: false,
    });
    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'pairing_replayed' },
    });
    expect(exchangeAttempts).toBe(1);
    expect(await store.get(reference.key)).toBeUndefined();
  });

  test('does not let an unauthenticated postflight veto an Auth-opened exchange', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-no-postflight');
    let healthCalls = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/api/client/v1/health') {
          healthCalls += 1;
          if (healthCalls > 1) {
            return Response.json(
              errorEnvelope('unauthorized', 'replacement_listener', false),
              { status: 401 },
            );
          }
          return Response.json(healthEnvelope(authority.instanceId));
        }
        if (path === '/api/client/v1/pairing/requests') {
          return Response.json(
            envelope({
              requestId: REQUEST_ID,
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
            { status: 201 },
          );
        }
        const opened = await authority.open(request);
        return await authority.respond(
          opened,
          200,
          envelope({
            bearer: BEARER,
            credential: {
              id: CREDENTIAL_ID,
              appName: 'OpenCoven Chat',
              installationId: 'hpke-no-postflight',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        );
      },
    });
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-no-postflight',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(healthCalls).toBe(1);
    expect(await store.get(reference.key)).toContain(BEARER);
  });

  test('keeps pairing exchange reusable when plaintext authority is unavailable', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-exchange-unavailable');
    let exchangeAttempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/api/client/v1/health') {
          return Response.json(healthEnvelope(authority.instanceId));
        }
        if (path === '/api/client/v1/pairing/requests') {
          return Response.json(
            envelope({
              requestId: REQUEST_ID,
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
            { status: 201 },
          );
        }
        exchangeAttempts += 1;
        if (exchangeAttempts === 1) {
          return Response.json(
            errorEnvelope(
              'service_unavailable',
              'authority_unavailable',
              true,
            ),
            { status: 503 },
          );
        }
        const opened = await authority.open(request);
        return await authority.respond(
          opened,
          200,
          envelope({
            bearer: BEARER,
            credential: {
              id: CREDENTIAL_ID,
              appName: 'OpenCoven Chat',
              installationId: 'hpke-exchange-unavailable',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        );
      },
    });
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-exchange-unavailable',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'service_unavailable',
    });
    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(exchangeAttempts).toBe(2);
  });

  test('preserves credentials on plaintext authority unavailable', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-unavailable');
    const before = await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async () =>
        Response.json(
          errorEnvelope(
            'service_unavailable',
            'authority_unavailable',
            true,
          ),
          { status: 503 },
        ),
    });

    await expect(client.listFamiliars()).rejects.toMatchObject({
      code: 'service_unavailable',
      retryable: true,
      details: { reason: 'authority_unavailable' },
    });
    expect(await store.get(reference.key)).toBe(before);
  });

  test('does not sleep past the operation deadline for replay capacity', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-deadline');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const fetchImplementation = vi.fn(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const opened = await authority.open(request);
      return await authority.respond(
        opened,
        503,
        errorEnvelope(
          'service_unavailable',
          'authority_replay_capacity',
          true,
        ),
        { retryAfter: '120' },
      );
    });
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: fetchImplementation,
    });

    await expect(
      client.listFamiliars({ timeoutMs: 25 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('honors abort while handling authenticated replay-capacity guidance', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-abort');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const controller = new AbortController();
    const fetchImplementation = vi.fn(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const opened = await authority.open(request);
      const response = await authority.respond(
        opened,
        503,
        errorEnvelope(
          'service_unavailable',
          'authority_replay_capacity',
          true,
        ),
        { retryAfter: '1' },
      );
      controller.abort(new Error('stop'));
      return response;
    });
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: fetchImplementation,
    });

    await expect(
      client.listFamiliars({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

async function protectedResponse(
  path: string,
  opened: OpenedTestRequest,
  authority: Awaited<ReturnType<typeof createTestHpkeAuthority>>,
): Promise<Response> {
  if (path.endsWith(`/${REQUEST_ID}`)) {
    expect(opened.authorization).toEqual({
      kind: 'pairing-secret',
      value: PAIRING_SECRET,
    });
    return await authority.respond(
      opened,
      200,
      envelope({
        id: REQUEST_ID,
        status: 'approved',
        expiresAt: 1_755_731_112_617,
      }),
    );
  }
  if (path.endsWith(`/${REQUEST_ID}/exchange`)) {
    expect(opened.authorization).toEqual({
      kind: 'pairing-secret',
      value: PAIRING_SECRET,
    });
    return await authority.respond(
      opened,
      200,
      envelope({
        bearer: BEARER,
        credential: {
          id: CREDENTIAL_ID,
          appName: 'OpenCoven Chat',
          installationId: 'hpke-direct',
          scopes: ['chat:read'],
          createdAt: 1_755_730_812_617,
          lastUsedAt: null,
          revokedAt: null,
          revocationReason: null,
        },
      }),
    );
  }

  expect(opened.authorization).toEqual({ kind: 'bearer', value: BEARER });
  if (path === '/api/client/v1/familiars') {
    return await authority.respond(
      opened,
      200,
      envelope(
        {
          familiars: [{ id: 'cody', displayName: 'Cody', role: 'Implementation' }],
        },
        cursor(),
      ),
    );
  }
  if (path === '/api/client/v1/projects') {
    return await authority.respond(
      opened,
      200,
      envelope(
        {
          projects: [{
            id: 'project-1',
            name: 'OpenCoven',
            root: '/workspace',
            createdAt: '2026-08-25T00:00:00.000Z',
            updatedAt: '2026-08-25T00:00:00.000Z',
          }],
        },
        cursor(),
      ),
    );
  }
  if (path === '/api/client/v1/conversations') {
    return await authority.respond(
      opened,
      200,
      envelope(
        {
          conversations: [{
            id: 'conversation-1',
            familiarId: 'cody',
            updatedAt: '2026-08-25T00:00:00.000Z',
          }],
        },
        cursor(),
      ),
    );
  }
  if (path.endsWith('/messages')) {
    return await authority.respond(
      opened,
      200,
      envelope(
        {
          messages: [{
            id: 'message-1',
            conversationId: 'conversation-1',
            parentId: null,
            role: 'user',
            text: 'hello',
            createdAt: '2026-08-25T00:00:00.000Z',
            attachmentCount: 0,
            toolCount: 0,
          }],
        },
        cursor(),
      ),
    );
  }
  return await authority.respond(
    opened,
    200,
    envelope({
      conversation: {
        id: 'conversation-1',
        familiarId: 'cody',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
    }),
  );
}
