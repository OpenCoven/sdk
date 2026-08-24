import * as cave from '@opencoven/cave-client';
import * as coven from '@opencoven/coven-client';
import {
  createSecretStoreReference,
  type OperationContext,
  type OperationEvent,
  type PageOptions,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

interface HealthClient {
  health(): Promise<{ status: 'ok' }>;
}

interface ClientConstructor {
  new (options: { transport: unknown }): HealthClient;
}

function pairingCredential(): cave.CaveCredentialMetadata {
  return {
    id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
    appName: 'OpenCoven Chat',
    installationId: 'chat-install-1',
    scopes: ['chat:read'],
    createdAt: 1_755_730_812_617,
    lastUsedAt: null,
    revokedAt: null,
    revocationReason: null,
  };
}

function authorityBinding(): cave.CaveAuthorityBinding {
  return {
    version: 1,
    instanceId: 'test-cave',
    endpoint: {
      kind: 'http',
      url: 'http://127.0.0.1:3020',
    },
    record: {
      identity:
        'sha256:2ebc3bc10d73758b0a0d5f6d1c4ec15c064c530d10e845ca8451e6d8f5f5c6d0',
      device: 7,
      inode: 9,
    },
    freshness: {
      pid: 42,
      nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
      startedAt: '2026-08-24T02:03:51.419Z',
    },
  };
}

function recordingSecretStore() {
  const retained = new Map<string, string>();

  return {
    retained,
    store: {
      get: vi.fn((key: string) => Promise.resolve(retained.get(key))),
      set: vi.fn((key: string, value: string) => {
        retained.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => Promise.resolve(retained.delete(key))),
    },
  };
}

function expectStoredCredentialRecord(serialized: string | undefined): void {
  expect(serialized).toBeTypeOf('string');
  expect(JSON.parse(serialized as string)).toMatchObject({
    version: 1,
    bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    authorityBinding: {
      version: 1,
      instanceId: 'test-cave',
    },
  });
}

const VALID_CAVE_HEALTH_RESPONSE = {
  apiVersion: '1.0',
  capabilities: ['health'],
  minimumClientVersion: '0.1.0',
  operations: ['health.read'],
  data: {
    instanceId: 'test-cave',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
} as const;

const VALID_CAVE_HEALTH = {
  status: 'ok',
  apiVersion: VALID_CAVE_HEALTH_RESPONSE.apiVersion,
  minimumClientVersion: VALID_CAVE_HEALTH_RESPONSE.minimumClientVersion,
  capabilities: VALID_CAVE_HEALTH_RESPONSE.capabilities,
  operations: VALID_CAVE_HEALTH_RESPONSE.operations,
  instanceId: VALID_CAVE_HEALTH_RESPONSE.data.instanceId,
  pairingRequired: VALID_CAVE_HEALTH_RESPONSE.data.pairingRequired,
  releaseVersion: VALID_CAVE_HEALTH_RESPONSE.data.releaseVersion,
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe('constrained client transports', () => {
  test('requests Cave health through a caller-supplied constrained transport', async () => {
    const CaveClient = (cave as { CaveClient?: ClientConstructor }).CaveClient;
    const client =
      CaveClient === undefined
        ? undefined
        : new CaveClient({
            transport: {
              health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
            },
          });

    const response =
      client !== undefined && typeof client.health === 'function'
        ? client.health()
        : Promise.resolve(undefined);

    await expect(response).resolves.toEqual(VALID_CAVE_HEALTH);
  });

  test('keeps legacy familiars and the five canonical reads on one CaveTransport', async () => {
    const metadata = {
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: ['canonical-reads'],
    } as const;
    const transport = {
      health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      familiars: () => Promise.resolve({ ok: true, familiars: [] }),
      listFamiliars: (
        options: PageOptions,
        context?: OperationContext,
      ) =>
        Promise.resolve({
          ...metadata,
          data: { familiars: [] },
          observed: { options, context },
        }),
      listProjects: (
        options: PageOptions,
        context?: OperationContext,
      ) =>
        Promise.resolve({
          ...metadata,
          data: { projects: [] },
          observed: { options, context },
        }),
      listConversations: (
        options: PageOptions,
        context?: OperationContext,
      ) =>
        Promise.resolve({
          ...metadata,
          data: { conversations: [] },
          observed: { options, context },
        }),
      getConversation: (
        conversationId: string,
        context?: OperationContext,
      ) =>
        Promise.resolve({
          ...metadata,
          data: {
            conversation: {
              id: conversationId,
              familiarId: 'familiar-1',
              updatedAt: '2026-08-24T00:00:00.000Z',
            },
          },
          observed: { context },
        }),
      listConversationMessages: (
        conversationId: string,
        options: PageOptions,
        context?: OperationContext,
      ) =>
        Promise.resolve({
          ...metadata,
          data: { messages: [] },
          observed: { conversationId, options, context },
        }),
    } satisfies cave.CaveTransport;
    const client = new cave.CaveClient({ transport });

    await expect(client.familiars()).resolves.toEqual([]);
    await expect(client.listFamiliars()).resolves.toEqual({ data: [] });
    await expect(client.listProjects()).resolves.toEqual({ data: [] });
    await expect(client.listConversations()).resolves.toEqual({ data: [] });
    await expect(client.getConversation('conversation-1')).resolves.toEqual({
      id: 'conversation-1',
      familiarId: 'familiar-1',
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    await expect(
      client.listConversationMessages('conversation-1'),
    ).resolves.toEqual({ data: [] });
  });

  test('creates Cave health clients through the public factory', async () => {
    const client = cave.createCaveClient({
      transport: {
        health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      },
    });

    await expect(client.health()).resolves.toEqual(VALID_CAVE_HEALTH);
  });

  test('fails Cave pairing exchange locally when no credential store is configured', async () => {
    const pairingExchange = vi.fn(() =>
      Promise.resolve({
        bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        credential: {
          id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
          appName: 'OpenCoven Chat',
          installationId: 'chat-install-1',
          scopes: ['chat:read'] as cave.CavePairingScope[],
          createdAt: 1_755_730_812_617,
          lastUsedAt: null,
          revokedAt: null,
          revocationReason: null,
        },
      }),
    );
    const client = new cave.CaveClient({
      transport: {
        health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
        pairingCreate: () =>
          Promise.resolve({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            expiresAt: 1_755_731_112_617,
          }),
        pairingExchange,
      },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'unsupported_operation',
        retryable: false,
        operation: 'pairingExchange',
      },
    });
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'unsupported_operation',
        retryable: false,
        operation: 'pairingExchange',
      },
    });
    expect(pairingExchange).not.toHaveBeenCalled();
  });

  test('persists credentials from public authority-bound custom transports', async () => {
    const { retained, store } = recordingSecretStore();
    const reference = createSecretStoreReference('cave-client-authority-bound');
    const credential = pairingCredential();
    const transport = {
      health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      pairingCreate: () =>
        Promise.resolve({
          requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
          secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          expiresAt: 1_755_731_112_617,
        }),
      pairingExchange: () =>
        Promise.resolve({
          bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          credential,
          authorityBinding: authorityBinding(),
        } satisfies cave.CaveAuthorityBoundPairingExchange),
    } satisfies cave.CaveCredentialPersistingTransport;

    const client = new cave.CaveClient({
      transport,
      credentials: {
        store,
        reference,
      },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).resolves.toEqual(credential);
    expectStoredCredentialRecord(retained.get(reference.key));
    expect(store.set).toHaveBeenCalled();
  });

  test('fails before durable writes when a custom transport omits authority binding', async () => {
    const { retained, store } = recordingSecretStore();
    const reference = createSecretStoreReference('cave-client-missing-binding');
    const credential = pairingCredential();
    const missingBindingTransport = {
      health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      pairingCreate: () =>
        Promise.resolve({
          requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
          secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          expiresAt: 1_755_731_112_617,
        }),
      pairingExchange: vi.fn(() =>
        Promise.resolve({
          bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          credential,
        } satisfies cave.CavePairingExchange),
      ),
    } satisfies cave.CaveTransport;

    // @ts-expect-error authorityBinding is required when credentials are configured
    const missingBindingOptions: cave.CaveClientOptions = {
      transport: missingBindingTransport,
      credentials: {
        store,
        reference,
      },
    };
    void missingBindingOptions;

    const client = new cave.CaveClient({
      transport: missingBindingTransport as unknown as cave.CaveCredentialPersistingTransport,
      credentials: {
        store,
        reference,
      },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'authority_binding_missing',
      },
    });
    expect(store.set).not.toHaveBeenCalled();
    expect(retained.size).toBe(0);
    expect(missingBindingTransport.pairingExchange).toHaveBeenCalledTimes(1);
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
    expect(missingBindingTransport.pairingExchange).toHaveBeenCalledTimes(1);
  });

  test('times out non-cooperative exchange transports promptly without late persistence', async () => {
    vi.useFakeTimers();
    const { retained, store } = recordingSecretStore();
    const reference = createSecretStoreReference('cave-client-timeout-no-late-persist');
    const credential = pairingCredential();
    let resolveExchange: ((value: cave.CaveAuthorityBoundPairingExchange) => void) | undefined;
    const pairingExchange = vi.fn(
      () =>
        new Promise<cave.CaveAuthorityBoundPairingExchange>((resolve) => {
          resolveExchange = resolve;
        }),
    );
    const transport = {
      health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      pairingCreate: () =>
        Promise.resolve({
          requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
          secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          expiresAt: 1_755_731_112_617,
        }),
      pairingExchange,
    } satisfies cave.CaveCredentialPersistingTransport;

    const client = new cave.CaveClient({
      transport,
      credentials: {
        store,
        reference,
      },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const exchange = session.exchange({ timeoutMs: 10 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);

    await expect(exchange).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        retryable: true,
        operation: 'pairingExchange',
      },
      cause: {
        code: 'timeout',
      },
    });
    expect(store.set).not.toHaveBeenCalled();

    resolveExchange?.({
      bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      credential,
      authorityBinding: authorityBinding(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.set).not.toHaveBeenCalled();
    expect(retained.size).toBe(0);
    expect(pairingExchange).toHaveBeenCalledTimes(1);
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
  });

  test('requests Coven health through a caller-supplied constrained transport', async () => {
    const CovenClient = (coven as { CovenClient?: ClientConstructor }).CovenClient;
    const client =
      CovenClient === undefined
        ? undefined
        : new CovenClient({
            transport: {
              health: () => Promise.resolve({
                ok: true,
                apiVersion: 'coven.daemon.v1',
                covenVersion: '0.1.0',
                capabilities: {
                  sessions: true,
                  events: true,
                  eventCursor: 'sequence',
                  structuredErrors: true,
                },
              }),
            },
          });

    const response =
      client !== undefined && typeof client.health === 'function'
        ? client.health()
        : Promise.resolve(undefined);

    await expect(response).resolves.toEqual({ status: 'ok' });
  });

  test('creates Coven health clients through the public factory', async () => {
    const client = coven.createCovenClient({
      transport: {
        health: () =>
          Promise.resolve({
            ok: true,
            apiVersion: coven.COVEN_DAEMON_PROTOCOL,
            covenVersion: '0.1.0',
            capabilities: {
              sessions: true,
              events: true,
              structuredErrors: true,
            },
          }),
      },
    });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
  });

  test('normalizes malformed Cave health responses with a stable code', async () => {
    const client = new cave.CaveClient({
      transport: {
        health: () =>
          Promise.resolve({} as unknown as cave.CaveHealthResponse),
      },
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        system: 'cave',
        code: 'invalid_response',
        retryable: false,
        operation: 'health',
      },
    });
  });

  test('normalizes malformed Coven health responses with a stable code', async () => {
    const client = new coven.CovenClient({
      transport: {
        health: () =>
          Promise.resolve(null as unknown as coven.CovenHealthResponse),
      },
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        system: 'coven',
        code: 'invalid_response',
        retryable: false,
        operation: 'health',
      },
    });
  });

  test('keeps zero-argument transports source compatible', async () => {
    const caveTransport = {
      health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
    } satisfies cave.CaveTransport;
    const covenTransport = {
      health: () =>
        Promise.resolve({
          ok: true as const,
          apiVersion: coven.COVEN_DAEMON_PROTOCOL,
          covenVersion: '0.1.0',
          capabilities: {
            sessions: true,
            events: true,
            structuredErrors: true as const,
          },
        }),
    } satisfies coven.CovenTransport;

    await expect(
      new cave.CaveClient({ transport: caveTransport }).health(),
    ).resolves.toEqual(VALID_CAVE_HEALTH);
    await expect(new coven.CovenClient({ transport: covenTransport }).health()).resolves.toEqual({
      status: 'ok',
    });
  });

  test('passes an operation context to Cave transports', async () => {
    vi.useFakeTimers();
    let context: OperationContext | undefined;
    const client = new cave.CaveClient({
      transport: {
        health(receivedContext) {
          context = receivedContext;
          return Promise.resolve(VALID_CAVE_HEALTH_RESPONSE);
        },
      },
    });

    await client.health({ timeoutMs: 50 });

    expect(context?.signal).toBeInstanceOf(AbortSignal);
    expect(context?.deadline).toBe(performance.now() + 50);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('passes an undefined deadline when no Cave timeout is configured', async () => {
    let context: OperationContext | undefined;
    const client = new cave.CaveClient({
      transport: {
        health(receivedContext) {
          context = receivedContext;
          return Promise.resolve(VALID_CAVE_HEALTH_RESPONSE);
        },
      },
    });

    await client.health();

    expect(context?.deadline).toBeUndefined();
  });

  test('lets per-call Cave controls override constructor defaults', async () => {
    vi.useFakeTimers();
    const defaultEvents: OperationEvent[] = [];
    const callEvents: OperationEvent[] = [];
    const client = new cave.CaveClient({
      operation: {
        timeoutMs: 100,
        observer: {
          onEvent(event) {
            defaultEvents.push(event);
          },
          onObserverError(error) {
            throw error;
          },
        },
      },
      transport: {
        health: () => new Promise<never>(() => undefined),
      },
    });
    const result = client.health({
      timeoutMs: 10,
      observer: {
        onEvent(event) {
          callEvents.push(event);
        },
        onObserverError(error) {
          throw error;
        },
      },
    });
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    const error = await caught;
    expect(error).toBeInstanceOf(cave.CaveClientError);
    expect(error).toMatchObject({
      normalized: {
        code: 'timeout',
        retryable: true,
      },
      cause: {
        code: 'timeout',
      },
    });
    expect(defaultEvents).toEqual([]);
    expect(callEvents.map(({ phase }) => phase)).toEqual(['start', 'timeout']);
  });

  test('applies Coven constructor controls and combines caller cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let receivedContext: OperationContext | undefined;
    const client = new coven.CovenClient({
      operation: {
        timeoutMs: 100,
      },
      transport: {
        health(context) {
          receivedContext = context;
          return new Promise<never>(() => undefined);
        },
      },
    });
    const result = client.health({ signal: controller.signal });

    controller.abort('stop');

    const error = await result.catch((caught: unknown) => caught);
    expect(receivedContext?.signal.aborted).toBe(true);
    expect(error).toBeInstanceOf(coven.CovenClientError);
    expect(error).toMatchObject({
      normalized: {
        code: 'aborted',
        retryable: false,
      },
      cause: {
        code: 'aborted',
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
