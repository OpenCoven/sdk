/* eslint-disable @typescript-eslint/require-await */
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
import { CAVE_HPKE_LIMITS } from '../packages/cave/src/hpke-bound-v1-node.js';

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

  test('enforces maxResponseBytes on authenticated response bodies', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-body-limit');
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
      maxResponseBytes: 1,
    });

    await expect(client.listFamiliars()).rejects.toMatchObject({
      normalized: { code: 'body_limit' },
    });
  });

  test('accepts an authenticated response body at the configured boundary', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-body-boundary');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const payload = familiarPage();
    const maximumBytes = new TextEncoder().encode(
      JSON.stringify(payload),
    ).byteLength;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const opened = await authority.open(request);
        return await authority.respond(opened, 200, payload);
      },
      maxResponseBytes: maximumBytes,
    });

    await expect(client.listFamiliars()).resolves.toMatchObject({
      data: [{ id: 'cody' }],
    });
  });

  test('enforces maxResponseBytes before exposing authenticated error payloads', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-error-limit');
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
        return await authority.respond(
          opened,
          503,
          errorEnvelope('service_unavailable', 'maintenance', true),
        );
      },
      maxResponseBytes: 1,
    });

    await expect(client.listFamiliars()).rejects.toMatchObject({
      normalized: { code: 'body_limit' },
    });
  });

  test('keeps the same response body limit for legacy plaintext responses', async () => {
    const authority = await createTestHpkeAuthority();
    const discovered: CaveDiscoveredEndpoint = {
      version: 1,
      endpoint: authority.discovered.endpoint,
      freshness: {
        pid: 4_321,
        nonce: 'legacy-runtime',
        startedAt: '2026-08-25T15:42:58.109Z',
      },
      record: authority.discovered.record,
    };
    const client = createDiscoveredCaveClient({
      credentials: {
        store: createMemorySecretStore(),
        reference: createSecretStoreReference('cave-legacy-body-limit'),
      },
      discoverEndpoint: async () => discovered,
      fetch: async () => Response.json(healthEnvelope(authority.instanceId)),
      maxResponseBytes: 1,
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: { code: 'body_limit' },
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

  test('defers v2 pairing health until poll and retries without exposing the secret', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-poll-health-retry');
    let healthAttempts = 0;
    let pollAttempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
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
        if (path === '/api/client/v1/health') {
          expect(request.headers.get('x-coven-pairing-secret')).toBeNull();
          healthAttempts += 1;
          return healthAttempts === 1
            ? Response.json(
                errorEnvelope(
                  'service_unavailable',
                  'authority_unavailable',
                  true,
                ),
                { status: 503 },
              )
            : Response.json(healthEnvelope(authority.instanceId));
        }

        const opened = await authority.open(request);
        pollAttempts += 1;
        return await authority.respond(
          opened,
          200,
          envelope({
            id: REQUEST_ID,
            status: 'approved',
            expiresAt: 1_755_731_112_617,
          }),
        );
      },
    });

    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-poll-health-retry',
      scopes: ['chat:read'],
    });
    expect(healthAttempts).toBe(0);
    expect(inspect(pairing)).not.toContain(PAIRING_SECRET);

    const firstError = await pairing.poll().catch((error: unknown) => error);
    expect(firstError).toMatchObject({
      code: 'service_unavailable',
      retryable: true,
    });
    expect(inspect(firstError)).not.toContain(PAIRING_SECRET);
    expect(pollAttempts).toBe(0);

    await expect(pairing.poll()).resolves.toMatchObject({
      id: REQUEST_ID,
      status: 'approved',
    });
    await expect(pairing.poll()).resolves.toMatchObject({
      id: REQUEST_ID,
      status: 'approved',
    });
    expect(healthAttempts).toBe(2);
    expect(pollAttempts).toBe(2);
  });

  test('restores v2 pairing exchange after a pre-dispatch health failure', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference(
      'cave-hpke-exchange-health-retry',
    );
    let healthAttempts = 0;
    let exchangeAttempts = 0;
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
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
        if (path === '/api/client/v1/health') {
          expect(request.headers.get('x-coven-pairing-secret')).toBeNull();
          healthAttempts += 1;
          return healthAttempts === 1
            ? Response.json(
                errorEnvelope(
                  'service_unavailable',
                  'authority_unavailable',
                  true,
                ),
                { status: 503 },
              )
            : Response.json(healthEnvelope(authority.instanceId));
        }

        const opened = await authority.open(request);
        exchangeAttempts += 1;
        return await authority.respond(
          opened,
          200,
          envelope({
            bearer: BEARER,
            credential: {
              id: CREDENTIAL_ID,
              appName: 'OpenCoven Chat',
              installationId: 'hpke-exchange-health-retry',
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
      installationId: 'hpke-exchange-health-retry',
      scopes: ['chat:read'],
    });

    const firstError = await pairing.exchange().catch((error: unknown) => error);
    expect(firstError).toMatchObject({
      code: 'service_unavailable',
      retryable: true,
    });
    expect(inspect(firstError)).not.toContain(PAIRING_SECRET);
    expect(exchangeAttempts).toBe(0);

    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(healthAttempts).toBe(2);
    expect(exchangeAttempts).toBe(1);
    expect(await store.get(reference.key)).toContain(BEARER);
  });

  test('shares one deterministic v2 health resolution across poll and exchange', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference(
      'cave-hpke-shared-pairing-health',
    );
    let healthAttempts = 0;
    const protectedBindings: string[] = [];
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
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
        if (path === '/api/client/v1/health') {
          healthAttempts += 1;
          return Response.json(healthEnvelope(authority.instanceId));
        }

        const opened = await authority.open(request);
        protectedBindings.push(opened.binding.instanceId);
        return path.endsWith('/exchange')
          ? await authority.respond(
              opened,
              200,
              envelope({
                bearer: BEARER,
                credential: {
                  id: CREDENTIAL_ID,
                  appName: 'OpenCoven Chat',
                  installationId: 'hpke-shared-pairing-health',
                  scopes: ['chat:read'],
                  createdAt: 1_755_730_812_617,
                  lastUsedAt: null,
                  revokedAt: null,
                  revocationReason: null,
                },
              }),
            )
          : await authority.respond(
              opened,
              200,
              envelope({
                id: REQUEST_ID,
                status: 'approved',
                expiresAt: 1_755_731_112_617,
              }),
            );
      },
    });
    const request: Parameters<typeof client.createPairing>[0] = {
      appName: 'OpenCoven Chat',
      installationId: 'hpke-shared-pairing-health',
      scopes: ['chat:read'],
    };
    const pollPairing = await client.createPairing(request);
    const exchangePairing = await client.createPairing(request);

    const [status, credential] = await Promise.all([
      pollPairing.poll(),
      exchangePairing.exchange(),
    ]);

    expect(status).toMatchObject({ id: REQUEST_ID, status: 'approved' });
    expect(credential).toMatchObject({ id: CREDENTIAL_ID });
    expect(healthAttempts).toBe(1);
    expect(protectedBindings).toEqual([
      authority.instanceId,
      authority.instanceId,
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

  test('restores pairing exchange after two authenticated capacity rejections', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-capacity-terminal');
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
        exchangeAttempts += 1;
        if (exchangeAttempts <= 2) {
          return await authority.respond(
            opened,
            503,
            errorEnvelope(
              'service_unavailable',
              'authority_replay_capacity',
              true,
            ),
            { retryAfter: '0' },
          );
        }
        return await authority.respond(
          opened,
          200,
          envelope({
            bearer: BEARER,
            credential: {
              id: CREDENTIAL_ID,
              appName: 'OpenCoven Chat',
              installationId: 'hpke-capacity-terminal',
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
      installationId: 'hpke-capacity-terminal',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'service_unavailable',
      details: { reason: 'authority_replay_capacity' },
    });
    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(exchangeAttempts).toBe(3);
  });

  test('restores pairing exchange when capacity retry exceeds its deadline', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-capacity-timeout');
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
              { retryAfter: '120' },
            )
          : await authority.respond(
              opened,
              200,
              envelope({
                bearer: BEARER,
                credential: {
                  id: CREDENTIAL_ID,
                  appName: 'OpenCoven Chat',
                  installationId: 'hpke-capacity-timeout',
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
      installationId: 'hpke-capacity-timeout',
      scopes: ['chat:read'],
    });

    await expect(
      pairing.exchange({ timeoutMs: 25 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(exchangeAttempts).toBe(2);
  });

  test('restores pairing exchange when capacity retry wait is aborted', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-capacity-abort');
    const controller = new AbortController();
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
        exchangeAttempts += 1;
        if (exchangeAttempts === 1) {
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
          setTimeout(() => controller.abort(new Error('stop')), 20);
          return response;
        }
        return await authority.respond(
          opened,
          200,
          envelope({
            bearer: BEARER,
            credential: {
              id: CREDENTIAL_ID,
              appName: 'OpenCoven Chat',
              installationId: 'hpke-capacity-abort',
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
      installationId: 'hpke-capacity-abort',
      scopes: ['chat:read'],
    });

    await expect(
      pairing.exchange({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    await expect(pairing.exchange()).resolves.toMatchObject({
      id: CREDENTIAL_ID,
    });
    expect(exchangeAttempts).toBe(2);
  });

  test('does not restore pairing exchange for forged plaintext capacity guidance', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-capacity-forged');
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
        return Response.json(
          errorEnvelope(
            'service_unavailable',
            'authority_replay_capacity',
            true,
          ),
          { status: 503 },
        );
      },
    });
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-capacity-forged',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'pairing_replayed' },
    });
    expect(exchangeAttempts).toBe(1);
  });

  test('does not restore pairing exchange for repeated plaintext stale guidance', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-stale-forged');
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
        if (exchangeAttempts > 2) {
          throw new Error('pairing secret was redispatched');
        }
        return Response.json(
          errorEnvelope('conflict', 'authority_key_stale', true),
          { status: 409 },
        );
      },
    });
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'hpke-stale-forged',
      scopes: ['chat:read'],
    });

    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'pairing_replayed' },
    });
    expect(exchangeAttempts).toBe(2);
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

  test('does not restore pairing exchange from plaintext authority guidance', async () => {
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
        throw new Error('pairing secret was redispatched');
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
    await expect(pairing.exchange()).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'pairing_replayed' },
    });
    expect(exchangeAttempts).toBe(1);
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
    const fetchImplementation = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
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
    const fetchImplementation = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
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

  test('cancels and unlocks a stalled HPKE response stream on timeout', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-stream-timeout');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: {
            'content-type':
              'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
          },
        }),
    });

    await expect(
      client.listFamiliars({ timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  test('cancels and unlocks a stalled HPKE response stream on abort', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-stream-abort');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    const controller = new AbortController();
    let cancelled = false;
    let abortScheduled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          if (!abortScheduled) {
            abortScheduled = true;
            queueMicrotask(() => controller.abort(new Error('stop')));
          }
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: {
            'content-type':
              'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
          },
        }),
    });

    await expect(
      client.listFamiliars({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  test('does not await non-settling stream cancellation on HPKE overflow', async () => {
    const authority = await createTestHpkeAuthority();
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('cave-hpke-stream-overflow');
    await seedBearer(
      store,
      reference,
      authority.discovered,
      authority.instanceId,
    );
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(CAVE_HPKE_LIMITS.responseEnvelopeBytes + 1),
        );
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discoverEndpoint: async () => authority.discovered,
      fetch: async () =>
        new Response(stream, {
          status: 200,
          headers: {
            'content-type':
              'application/vnd.opencoven.client-v1.hpke-bound-v1+json',
          },
        }),
    });

    await expect(
      client.listFamiliars({ timeoutMs: 500 }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
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
