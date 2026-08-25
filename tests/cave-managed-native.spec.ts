import * as cave from '@opencoven/cave-client';
import type { OperationContext } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const REQUEST_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const EXPIRES_AT = 1_755_731_112_617;
const INSTANCE_ID = '00000000-0000-4000-8000-000000000000';
const CREDENTIAL = {
  id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
  appName: 'OpenCoven Chat',
  installationId: 'chat-install-1',
  scopes: ['chat:read'] as cave.CavePairingScope[],
  createdAt: 1_755_730_812_617,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
};
const AUTHORITY_BINDING = {
  version: 1 as const,
  instanceId: INSTANCE_ID,
  endpoint: {
    kind: 'http' as const,
    url: 'http://127.0.0.1:3020',
  },
  record: {
    identity: `sha256:${'a'.repeat(64)}`,
    device: 7,
    inode: 11,
  },
  freshness: {
    pid: 4_321,
    nonce: 'native-managed-cave',
    startedAt: '2026-08-24T02:03:51.419Z',
  },
};

interface ManagedResponse {
  statusCode: number;
  payload: unknown;
}

interface ManagedTransport {
  health?: (context?: OperationContext) => Promise<ManagedResponse>;
  pairingCreate?: (
    request: cave.CavePairingRequest,
    context?: OperationContext,
  ) => Promise<{ handle: string; response: ManagedResponse }>;
  pairingPoll?: (
    handle: string,
    context?: OperationContext,
  ) => Promise<ManagedResponse>;
  pairingExchange?: (
    handle: string,
    context?: OperationContext,
  ) => Promise<{
    authorityBinding: unknown;
    commitHandle: string;
    response: ManagedResponse;
  }>;
  pairingCommit?: (
    commitHandle: string,
    context?: OperationContext,
  ) => Promise<void>;
  pairingDiscard?: (commitHandle: string) => Promise<unknown>;
  credentialState?: (
    context?: OperationContext,
  ) => Promise<unknown>;
  forgetCredential?: (
    context?: OperationContext,
  ) => Promise<unknown>;
  familiars?: (context?: OperationContext) => Promise<ManagedResponse>;
  listProjects?: (
    options: { limit?: number; cursor?: string },
    context?: OperationContext,
  ) => Promise<ManagedResponse>;
}

afterEach(() => {
  vi.useRealTimers();
});

function createManagedClient(transport: ManagedTransport): cave.CaveClient {
  const factory = (
    cave as unknown as {
      createManagedCaveClient?: (options: {
        transport: ManagedTransport;
      }) => cave.CaveClient;
    }
  ).createManagedCaveClient;

  expect(factory).toBeTypeOf('function');
  if (factory === undefined) {
    throw new Error('createManagedCaveClient was not exported');
  }
  return factory({ transport });
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected promise to reject.');
}

function safeGet(value: unknown, key: PropertyKey): unknown {
  return typeof value === 'object' && value !== null
    ? (Reflect.get(value, key) as unknown)
    : undefined;
}

function successEnvelope(
  data: Record<string, unknown>,
  options: {
    capabilities?: string[];
    operations?: string[];
    cursor?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    ...(options.capabilities === undefined
      ? {}
      : { capabilities: options.capabilities }),
    ...(options.operations === undefined
      ? {}
      : { operations: options.operations }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    data,
  };
}

function healthEnvelope(): Record<string, unknown> {
  return successEnvelope(
    {
      instanceId: INSTANCE_ID,
      pairingRequired: true,
      releaseVersion: '0.3.10',
    },
    {
      capabilities: ['health', 'familiars', 'pairing'],
      operations: [
        'health.read',
        'familiars.list',
        'pairing.create',
        'pairing.poll',
        'pairing.exchange',
      ],
    },
  );
}

function pairingCreatedTransport(
  overrides: Partial<ManagedTransport> = {},
): ManagedTransport {
  return {
    pairingCreate: () =>
      Promise.resolve({
        handle: 'opaque-pairing-handle',
        response: {
          statusCode: 201,
          payload: successEnvelope({
            requestId: REQUEST_ID,
            expiresAt: EXPIRES_AT,
          }),
        },
      }),
    ...overrides,
  };
}

describe('managed native Cave client', () => {
  test('creates a pairing session without exposing the native pairing handle', async () => {
    const pairingCreate = vi.fn(() =>
      Promise.resolve({
        handle: 'opaque-pairing-handle',
        response: {
          statusCode: 201,
          payload: successEnvelope({
            requestId: REQUEST_ID,
            expiresAt: EXPIRES_AT,
          }),
        },
      }),
    );
    const client = createManagedClient({ pairingCreate });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    expect(session.requestId).toBe(REQUEST_ID);
    expect(session.expiresAt).toBe(EXPIRES_AT);
    expect(JSON.stringify(session)).not.toContain('opaque-pairing-handle');
    expect(pairingCreate).toHaveBeenCalledOnce();
  });

  test('polls through the opaque native handle and parses the raw envelope', async () => {
    let observedPairingHandle: string | undefined;
    let observedPollContext: OperationContext | undefined;
    const pairingPoll = vi.fn(
      (handle: string, context?: OperationContext) => {
      observedPairingHandle = handle;
      observedPollContext = context;
      return Promise.resolve({
        statusCode: 200,
        payload: successEnvelope({
          id: REQUEST_ID,
          status: 'approved',
          expiresAt: EXPIRES_AT,
        }),
      });
      },
    );
    const client = createManagedClient(pairingCreatedTransport({ pairingPoll }));
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.poll()).resolves.toEqual({
      id: REQUEST_ID,
      status: 'approved',
      expiresAt: EXPIRES_AT,
    });
    expect(observedPairingHandle).toBe('opaque-pairing-handle');
    expect(observedPollContext?.signal).toBeInstanceOf(AbortSignal);
  });

  test('validates staged exchange metadata before committing native custody', async () => {
    let observedCommitHandle: string | undefined;
    let observedCommitContext: OperationContext | undefined;
    const pairingCommit = vi.fn(
      (commitHandle: string, context?: OperationContext) => {
        observedCommitHandle = commitHandle;
        observedCommitContext = context;
        return Promise.resolve();
      },
    );
    const pairingDiscard = vi.fn(() => Promise.resolve('deleted'));
    const client = createManagedClient(
      pairingCreatedTransport({
        pairingExchange: () =>
          Promise.resolve({
            authorityBinding: AUTHORITY_BINDING,
            commitHandle: 'opaque-commit-handle',
            response: {
              statusCode: 200,
              payload: successEnvelope({
                credential: CREDENTIAL,
              }),
            },
          }),
        pairingCommit,
        pairingDiscard,
      }),
    );
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).resolves.toEqual(CREDENTIAL);
    expect(observedCommitHandle).toBe('opaque-commit-handle');
    expect(observedCommitContext?.signal).toBeInstanceOf(AbortSignal);
    expect(pairingDiscard).not.toHaveBeenCalled();
    expect(JSON.stringify(await rejectedValue(session.exchange()))).not.toContain(
      'opaque-commit-handle',
    );
  });

  test('rejects secret-bearing native responses and discards staged credentials', async () => {
    const createClient = createManagedClient(
      pairingCreatedTransport({
        pairingCreate: () =>
          Promise.resolve({
            handle: 'opaque-pairing-handle',
            response: {
              statusCode: 201,
              payload: successEnvelope({
                requestId: REQUEST_ID,
                expiresAt: EXPIRES_AT,
                secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
              }),
            },
          }),
      }),
    );
    await expect(
      createClient.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      }),
    ).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'pairingCreate',
      },
    });

    const pairingDiscard = vi.fn(() => Promise.resolve('deleted'));
    const exchangeClient = createManagedClient(
      pairingCreatedTransport({
        pairingExchange: () =>
          Promise.resolve({
            authorityBinding: AUTHORITY_BINDING,
            commitHandle: 'opaque-commit-handle',
            response: {
              statusCode: 200,
              payload: successEnvelope({
                bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                credential: CREDENTIAL,
              }),
            },
          }),
        pairingCommit: () => Promise.resolve(),
        pairingDiscard,
      }),
    );
    const session = await exchangeClient.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'pairingExchange',
      },
    });
    expect(pairingDiscard).toHaveBeenCalledWith('opaque-commit-handle');
  });

  test('discards a staged credential that arrives after exchange timeout', async () => {
    vi.useFakeTimers();
    let resolveExchange:
      | ((value: {
          authorityBinding: unknown;
          commitHandle: string;
          response: ManagedResponse;
        }) => void)
      | undefined;
    const pairingDiscard = vi.fn(() => Promise.resolve('deleted'));
    const client = createManagedClient(
      pairingCreatedTransport({
        pairingExchange: () =>
          new Promise((resolve) => {
            resolveExchange = resolve;
          }),
        pairingCommit: () => Promise.resolve(),
        pairingDiscard,
      }),
    );
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const exchange = rejectedValue(session.exchange({ timeoutMs: 10 }));
    await vi.advanceTimersByTimeAsync(10);
    await expect(exchange).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        operation: 'pairingExchange',
      },
    });

    vi.useRealTimers();
    resolveExchange?.({
      authorityBinding: AUTHORITY_BINDING,
      commitHandle: 'late-commit-handle',
      response: {
        statusCode: 200,
        payload: successEnvelope({ credential: CREDENTIAL }),
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
    expect(pairingDiscard).toHaveBeenCalledWith('late-commit-handle');
  });

  test('discards a credential whose native commit completes after timeout', async () => {
    vi.useFakeTimers();
    let resolveCommit: (() => void) | undefined;
    const pairingDiscard = vi.fn(() => Promise.resolve('deleted'));
    const client = createManagedClient(
      pairingCreatedTransport({
        pairingExchange: () =>
          Promise.resolve({
            authorityBinding: AUTHORITY_BINDING,
            commitHandle: 'commit-timeout-handle',
            response: {
              statusCode: 200,
              payload: successEnvelope({ credential: CREDENTIAL }),
            },
          }),
        pairingCommit: () =>
          new Promise<void>((resolve) => {
            resolveCommit = resolve;
          }),
        pairingDiscard,
      }),
    );
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const exchange = rejectedValue(session.exchange({ timeoutMs: 10 }));
    await vi.advanceTimersByTimeAsync(10);
    await expect(exchange).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        operation: 'pairingExchange',
      },
    });
    resolveCommit?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(pairingDiscard).toHaveBeenCalledWith('commit-timeout-handle');
  });

  test('discards a commit that returns after its monotonic deadline', async () => {
    const pairingDiscard = vi.fn(() => Promise.resolve('deleted'));
    const client = createManagedClient(
      pairingCreatedTransport({
        pairingExchange: () =>
          Promise.resolve({
            authorityBinding: AUTHORITY_BINDING,
            commitHandle: 'blocking-commit-handle',
            response: {
              statusCode: 200,
              payload: successEnvelope({ credential: CREDENTIAL }),
            },
          }),
        pairingCommit: () => {
            const startedAt = process.hrtime.bigint();
            while (process.hrtime.bigint() - startedAt < 20_000_000n) {
            // Simulate a native bridge call that blocks the event loop.
          }
          return Promise.resolve();
        },
        pairingDiscard,
      }),
    );
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange({ timeoutMs: 1 })).rejects.toMatchObject({
      normalized: {
        code: 'timeout',
        operation: 'pairingExchange',
      },
    });
    expect(pairingDiscard).toHaveBeenCalledWith('blocking-commit-handle');
  });

  test('spends a session after a terminal native poll error', async () => {
    const pairingPoll = vi.fn(() =>
      Promise.resolve({
        statusCode: 410,
        payload: {
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['pairing'],
          operations: ['pairing.poll'],
          error: {
            code: 'pairing_expired',
            message: 'Pairing expired.',
            retryable: false,
          },
        },
      }),
    );
    const client = createManagedClient(
      pairingCreatedTransport({ pairingPoll }),
    );
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.poll()).rejects.toMatchObject({
      normalized: { code: 'pairing_expired' },
    });
    await expect(session.poll()).rejects.toMatchObject({
      normalized: { code: 'conflict' },
    });
    expect(pairingPoll).toHaveBeenCalledOnce();
  });

  test('rejects negative native pairing expirations', async () => {
    const client = createManagedClient(
      pairingCreatedTransport({
        pairingCreate: () =>
          Promise.resolve({
            handle: 'opaque-pairing-handle',
            response: {
              statusCode: 200,
              payload: successEnvelope({
                requestId: REQUEST_ID,
                expiresAt: -1,
              }),
            },
          }),
      }),
    );

    await expect(
      client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      }),
    ).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'pairingCreate',
      },
    });
  });

  test('sanitizes secret-bearing native rejections and observer events', async () => {
    const events: unknown[] = [];
    const nativeError = Object.assign(
      new Error('native-only-bearer'),
      {
        code: 'native-only-secret-code',
        details: { bearer: 'native-only-bearer' },
      },
    );
    const client = createManagedClient({
      health: () => Promise.reject(nativeError),
    });

    const error = await rejectedValue(
      client.health({
        observer: {
          onEvent(event) {
            events.push(event);
          },
          onObserverError() {},
        },
      }),
    );
    const exposed = JSON.stringify({
      cause: safeGet(error, 'cause'),
      code: safeGet(error, 'code'),
      details: safeGet(error, 'details'),
      events,
      message: safeGet(error, 'message'),
      normalized: safeGet(error, 'normalized'),
    });

    expect(exposed).not.toContain('native-only-bearer');
    expect(exposed).not.toContain('native-only-secret-code');
  });

  test('rejects accessor-backed native authority bindings without invocation', async () => {
    let invoked = false;
    const authorityBinding = { ...AUTHORITY_BINDING };
    Object.defineProperty(authorityBinding, 'version', {
      configurable: true,
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    const pairingDiscard = vi.fn(() => Promise.resolve('deleted'));
    const client = createManagedClient(
      pairingCreatedTransport({
        pairingExchange: () =>
          Promise.resolve({
            authorityBinding,
            commitHandle: 'authority-commit-handle',
            response: {
              statusCode: 200,
              payload: successEnvelope({ credential: CREDENTIAL }),
            },
          }),
        pairingCommit: () => Promise.resolve(),
        pairingDiscard,
      }),
    );
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'pairingExchange',
      },
    });
    expect(invoked).toBe(false);
    expect(pairingDiscard).toHaveBeenCalledWith('authority-commit-handle');
  });

  test('parses health, credential state, authenticated familiars, and local forget', async () => {
    const health = vi.fn(() =>
      Promise.resolve({ statusCode: 200, payload: healthEnvelope() }),
    );
    const credentialState = vi.fn(() => Promise.resolve({ status: 'present' }));
    const familiars = vi.fn(() =>
      Promise.resolve({
        statusCode: 200,
        payload: successEnvelope({
          familiars: [
            {
              id: 'cody',
              display_name: 'Cody',
              role: 'Implementation',
            },
          ],
        }),
      }),
    );
    const forgetCredential = vi.fn(() => Promise.resolve(true));
    const client = createManagedClient({
      health,
      credentialState,
      familiars,
      forgetCredential,
    });

    await expect(client.health()).resolves.toMatchObject({
      status: 'ok',
      instanceId: INSTANCE_ID,
      releaseVersion: '0.3.10',
    });
    await expect(client.credentialStatus()).resolves.toMatchObject({
      status: 'valid',
      access: 'chat:read',
    });
    await expect(client.forgetCredential()).resolves.toBe(true);
    expect(credentialState).toHaveBeenCalledOnce();
    expect(familiars).toHaveBeenCalledOnce();
    expect(forgetCredential).toHaveBeenCalledOnce();
  });

  test('rejects secret-bearing fields anywhere in a native payload', async () => {
    const payload = healthEnvelope();
    payload.native = {
      nested: {
        bearer: 'native-only-bearer',
      },
    };
    const client = createManagedClient({
      health: () => Promise.resolve({ statusCode: 200, payload }),
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
      },
    });
  });

  test('rejects secret-bearing fields on the native response wrapper', async () => {
    const client = createManagedClient({
      health: () =>
        Promise.resolve({
          statusCode: 200,
          payload: healthEnvelope(),
          bearer: 'native-only-bearer',
        }),
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
      },
    });
  });

  test('rejects array accessors without invoking native payload code', async () => {
    let invoked = false;
    const hostileArray: unknown[] = [];
    Object.defineProperty(hostileArray, '0', {
      configurable: true,
      enumerable: true,
      get() {
        invoked = true;
        return 'hostile';
      },
    });
    hostileArray.length = 1;
    const payload = healthEnvelope();
    payload.native = hostileArray;
    const client = createManagedClient({
      health: () => Promise.resolve({ statusCode: 200, payload }),
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
      },
    });
    expect(invoked).toBe(false);
  });

  test('preserves explicit Client v1 errors from native responses', async () => {
    const client = createManagedClient({
      health: () =>
        Promise.resolve({
          statusCode: 429,
          payload: {
            apiVersion: '1.0',
            minimumClientVersion: '0.1.0',
            capabilities: ['health'],
            operations: ['health.read'],
            requestId: 'request-429',
            error: {
              code: 'rate_limited',
              message: 'Try later.',
              retryable: true,
            },
          },
        }),
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'rate_limited',
        operation: 'health',
        requestId: 'request-429',
        retryable: true,
        statusCode: 429,
      },
    });
  });

  test('parses canonical reads returned by the native boundary', async () => {
    let observedProjectOptions:
      | { limit?: number; cursor?: string }
      | undefined;
    let observedProjectContext: OperationContext | undefined;
    const listProjects = vi.fn(
      (
      options: { limit?: number; cursor?: string },
      context?: OperationContext,
      ) => {
      observedProjectOptions = options;
      observedProjectContext = context;
      return Promise.resolve({
        statusCode: 200,
        payload: successEnvelope(
          {
            projects: [
              {
                id: 'project-1',
                name: 'OpenCoven Chat',
                root: '/workspace/chat',
                createdAt: '2026-08-24T00:00:00.000Z',
                updatedAt: '2026-08-24T01:00:00.000Z',
              },
            ],
          },
          {
            capabilities: ['projects', 'cursors'],
            operations: ['projects.list'],
            cursor: { hasMore: false },
          },
        ),
      });
      },
    );
    const client = createManagedClient({ listProjects });

    await expect(client.listProjects({ limit: 25 })).resolves.toMatchObject({
      data: [
        {
          id: 'project-1',
          name: 'OpenCoven Chat',
        },
      ],
      cursor: { hasMore: false },
    });
    expect(observedProjectOptions).toEqual({ limit: 25 });
    expect(observedProjectContext?.signal).toBeInstanceOf(AbortSignal);
  });
});
