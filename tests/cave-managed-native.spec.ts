import * as cave from '@opencoven/cave-client';
import { afterEach, describe, expect, test, vi } from 'vitest';

const PAIRING_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BEARER = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const REQUEST_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';

const HEALTH_ENVELOPE = {
  apiVersion: '1.0',
  minimumClientVersion: '0.1.0',
  capabilities: ['health', 'familiars'],
  operations: ['health.read', 'familiars.list'],
  data: {
    instanceId: 'managed-native-cave',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
} as const;

function credential(): cave.CaveCredentialMetadata {
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

type ManagedTransportSpies = cave.CaveManagedCredentialTransport & {
  managedPairingCreate: ReturnType<typeof vi.fn>;
  managedPairingPoll: ReturnType<typeof vi.fn>;
  managedPairingExchange: ReturnType<typeof vi.fn>;
  managedCredentialStatus: ReturnType<typeof vi.fn>;
  managedForgetCredential: ReturnType<typeof vi.fn>;
};

function managedTransport(
  overrides: Partial<ManagedTransportSpies> = {},
): ManagedTransportSpies {
  return {
    health: vi.fn(() => Promise.resolve(HEALTH_ENVELOPE)),
    managedPairingCreate: vi.fn(() =>
      Promise.resolve({
        requestId: REQUEST_ID,
        expiresAt: 1_755_731_112_617,
      }),
    ),
    managedPairingPoll: vi.fn(() =>
      Promise.resolve({
        id: REQUEST_ID,
        status: 'approved',
        expiresAt: 1_755_731_112_617,
      }),
    ),
    managedPairingExchange: vi.fn(() =>
      Promise.resolve({
        credential: credential(),
      }),
    ),
    managedCredentialStatus: vi.fn(() =>
      Promise.resolve({
        status: 'valid',
        access: 'chat:read',
        health: HEALTH_ENVELOPE,
      }),
    ),
    managedForgetCredential: vi.fn(() => Promise.resolve({ status: 'deleted' })),
    ...overrides,
  };
}

function managedClient(
  transport: cave.CaveManagedCredentialTransport,
  observer?: { onEvent: (event: unknown) => void; onObserverError: (error: unknown) => void },
): cave.CaveClient {
  return new cave.CaveClient({
    transport,
    credentialCustody: { mode: 'managed-native' },
    ...(observer === undefined ? {} : { operation: { observer } }),
  });
}

function serializedError(error: unknown): string {
  if (!(error instanceof Error)) {
    return JSON.stringify(error);
  }

  return JSON.stringify(error, Object.getOwnPropertyNames(error));
}

function expectRedacted(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(PAIRING_SECRET);
  expect(serialized).not.toContain(BEARER);
  expect(serialized).not.toMatch(/secret|bearer/iu);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('managed native Cave credential custody', () => {
  test('keeps pairing and bearer material outside JavaScript while preserving CavePairingSession', async () => {
    const transport = managedTransport();
    const events: unknown[] = [];
    const client = managedClient(transport, {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        throw error;
      },
    });

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });
    const status = await session.poll();
    const exchanged = await session.exchange();

    expect(session).toMatchObject({
      requestId: REQUEST_ID,
      expiresAt: 1_755_731_112_617,
    });
    expect(status).toMatchObject({ id: REQUEST_ID, status: 'approved' });
    expect(exchanged).toEqual(credential());
    expect(transport.managedPairingCreate.mock.calls).toHaveLength(1);
    expect(transport.managedPairingPoll.mock.calls).toHaveLength(1);
    expect(transport.managedPairingPoll.mock.calls[0]?.[0]).toBe(REQUEST_ID);
    expect(transport.managedPairingPoll.mock.calls[0]).toHaveLength(2);
    expect(transport.managedPairingExchange.mock.calls).toHaveLength(1);
    expect(transport.managedPairingExchange.mock.calls[0]?.[0]).toBe(REQUEST_ID);
    expect(transport.managedPairingExchange.mock.calls[0]).toHaveLength(2);
    expectRedacted({ session, status, exchanged, events });
  });

  test.each([
    {
      label: 'pairing create',
      transport: () =>
        managedTransport({
          managedPairingCreate: vi.fn(() =>
            Promise.resolve({
              requestId: REQUEST_ID,
              expiresAt: 1_755_731_112_617,
              secret: PAIRING_SECRET,
            }),
          ),
        }),
      invoke: (client: cave.CaveClient) =>
        client.createPairing({
          appName: 'OpenCoven Chat',
          installationId: 'chat-install-1',
          scopes: ['chat:read'],
        }),
    },
    {
      label: 'pairing poll',
      transport: () =>
        managedTransport({
          managedPairingPoll: vi.fn(() =>
            Promise.resolve({
              id: REQUEST_ID,
              status: 'approved',
              expiresAt: 1_755_731_112_617,
              bearer: BEARER,
            }),
          ),
        }),
      invoke: async (client: cave.CaveClient) => {
        const session = await client.createPairing({
          appName: 'OpenCoven Chat',
          installationId: 'chat-install-1',
          scopes: ['chat:read'],
        });
        return await session.poll();
      },
    },
    {
      label: 'pairing exchange',
      transport: () =>
        managedTransport({
          managedPairingExchange: vi.fn(() =>
            Promise.resolve({
              credential: credential(),
              bearer: BEARER,
            }),
          ),
        }),
      invoke: async (client: cave.CaveClient) => {
        const session = await client.createPairing({
          appName: 'OpenCoven Chat',
          installationId: 'chat-install-1',
          scopes: ['chat:read'],
        });
        return await session.exchange();
      },
    },
    {
      label: 'credential metadata',
      transport: () =>
        managedTransport({
          managedPairingExchange: vi.fn(() =>
            Promise.resolve({
              credential: {
                ...credential(),
                secret: PAIRING_SECRET,
              },
            }),
          ),
        }),
      invoke: async (client: cave.CaveClient) => {
        const session = await client.createPairing({
          appName: 'OpenCoven Chat',
          installationId: 'chat-install-1',
          scopes: ['chat:read'],
        });
        return await session.exchange();
      },
    },
  ])('rejects secret-bearing managed $label results without leaking them', async ({
    transport: buildTransport,
    invoke,
  }) => {
    const events: unknown[] = [];
    const client = managedClient(buildTransport(), {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        throw error;
      },
    });

    const error = await invoke(client).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      normalized: {
        code: 'invalid_response',
      },
    });
    expectRedacted({
      error: serializedError(error),
      normalized: (error as cave.CaveClientError).normalized,
      events,
    });
  });

  test('redacts managed adapter failures before they become SDK errors or observer events', async () => {
    const transport = managedTransport({
      managedPairingCreate: vi.fn(() =>
        Promise.reject(
          Object.assign(new Error(`native failed with ${PAIRING_SECRET}`), {
            code: 'service_unavailable',
            details: { bearer: BEARER },
            retryable: true,
          }),
        ),
      ),
    });
    const events: unknown[] = [];
    const client = managedClient(transport, {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        throw error;
      },
    });

    const error = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      normalized: {
        code: 'service_unavailable',
        retryable: true,
        operation: 'pairingCreate',
      },
    });
    expectRedacted({
      message: error instanceof Error ? error.message : String(error),
      serialized: serializedError(error),
      normalized: (error as cave.CaveClientError).normalized,
      events,
    });
  });

  test('rejects malformed managed metadata and validates health before exposing credential status', async () => {
    const transport = managedTransport({
      managedCredentialStatus: vi.fn(() =>
        Promise.resolve({
          status: 'valid',
          access: 'chat:read',
          health: {
            ...HEALTH_ENVELOPE,
            apiVersion: '2.0',
          },
        }),
      ),
    });
    const client = managedClient(transport);

    await expect(client.credentialStatus()).rejects.toMatchObject({
      normalized: {
        code: 'incompatible_version',
        operation: 'credentialStatus',
      },
    });

    transport.managedCredentialStatus = vi.fn(() =>
      Promise.resolve({
        status: 'valid',
        access: 'chat:read',
        health: HEALTH_ENVELOPE,
        secret: PAIRING_SECRET,
      }),
    );

    const error = await client.credentialStatus().catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      normalized: { code: 'invalid_response' },
    });
    expectRedacted(serializedError(error));
  });

  test('preserves native credential status and replacement-safe forget semantics', async () => {
    const transport = managedTransport();
    const client = managedClient(transport);

    await expect(client.credentialStatus()).resolves.toEqual({
      status: 'valid',
      access: 'chat:read',
      health: {
        status: 'ok',
        apiVersion: '1.0',
        minimumClientVersion: '0.1.0',
        capabilities: ['health', 'familiars'],
        operations: ['health.read', 'familiars.list'],
        instanceId: 'managed-native-cave',
        pairingRequired: true,
        releaseVersion: '0.3.9',
      },
    });

    transport.managedCredentialStatus = vi.fn(() =>
      Promise.resolve({ status: 'missing' }),
    );
    await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });

    transport.managedCredentialStatus = vi.fn(() =>
      Promise.resolve({
        status: 'revoked',
        health: HEALTH_ENVELOPE,
      }),
    );
    await expect(client.credentialStatus()).resolves.toMatchObject({ status: 'revoked' });

    transport.managedCredentialStatus = vi.fn(() =>
      Promise.resolve({
        status: 'disconnected',
        reason: 'reconcile_required',
      }),
    );
    await expect(client.credentialStatus()).resolves.toEqual({
      status: 'disconnected',
      reason: 'reconcile_required',
    });

    for (const access of [
      'scope_denied',
      'service_unavailable',
      'rate_limited',
    ] as const) {
      transport.managedCredentialStatus = vi.fn(() =>
        Promise.resolve({
          status: 'valid',
          access,
          health: HEALTH_ENVELOPE,
        }),
      );
      await expect(client.credentialStatus()).resolves.toMatchObject({
        status: 'valid',
        access,
      });
    }

    transport.managedForgetCredential = vi.fn(() =>
      Promise.resolve({ status: 'credential_update_in_progress' }),
    );
    await expect(client.forgetCredential()).rejects.toMatchObject({
      normalized: {
        code: 'credential_update_in_progress',
        retryable: true,
      },
    });

    transport.managedForgetCredential = vi.fn(() =>
      Promise.resolve({ status: 'deleted', bearer: BEARER }),
    );
    const malformedForget = await client.forgetCredential().catch(
      (error: unknown) => error,
    );
    expect(malformedForget).toMatchObject({
      normalized: { code: 'invalid_response' },
    });
    expectRedacted(serializedError(malformedForget));

    transport.managedForgetCredential = vi.fn(() =>
      Promise.resolve({ status: 'missing' }),
    );
    await expect(client.forgetCredential()).resolves.toBe(false);

    transport.managedForgetCredential = vi.fn(() =>
      Promise.resolve({ status: 'deleted' }),
    );
    await expect(client.forgetCredential()).resolves.toBe(true);
  });

  test('never replays a timed-out managed exchange after the native mutation completes late', async () => {
    vi.useFakeTimers();
    let resolveExchange: ((result: unknown) => void) | undefined;
    const transport = managedTransport({
      managedPairingExchange: vi.fn(() =>
        new Promise<unknown>((resolve) => {
          resolveExchange = resolve;
        }),
      ),
    });
    const client = managedClient(transport);
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
    });
    resolveExchange?.({ credential: credential() });
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.managedPairingExchange.mock.calls).toHaveLength(1);
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: { reason: 'pairing_replayed' },
    });
  });

  test('redacts cancellation and keeps an aborted managed exchange terminal', async () => {
    let resolveExchange: ((result: unknown) => void) | undefined;
    const transport = managedTransport({
      managedPairingExchange: vi.fn(() =>
        new Promise<unknown>((resolve) => {
          resolveExchange = resolve;
        }),
      ),
    });
    const events: unknown[] = [];
    const client = managedClient(transport, {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        throw error;
      },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });
    const controller = new AbortController();
    const exchange = session.exchange({ signal: controller.signal }).catch(
      (error: unknown) => error,
    );

    await Promise.resolve();
    controller.abort({ bearer: BEARER, secret: PAIRING_SECRET });

    const error = await exchange;
    expect(error).toMatchObject({
      normalized: {
        code: 'aborted',
        retryable: false,
        operation: 'pairingExchange',
      },
    });
    resolveExchange?.({ credential: credential() });
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.managedPairingExchange.mock.calls).toHaveLength(1);
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: { code: 'conflict' },
    });
    expectRedacted({
      serialized: serializedError(error),
      normalized: (error as cave.CaveClientError).normalized,
      events,
    });
  });

  test('uses existing direct transport and SecretStore custody unchanged when native mode is absent', async () => {
    const pairingCreate = vi.fn(() =>
      Promise.resolve({
        requestId: REQUEST_ID,
        secret: PAIRING_SECRET,
        expiresAt: 1_755_731_112_617,
      }),
    );
    const client = new cave.CaveClient({
      transport: {
        health: () => Promise.resolve(HEALTH_ENVELOPE),
        pairingCreate,
      },
    });

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    expect(pairingCreate).toHaveBeenCalledTimes(1);
    expect(session.requestId).toBe(REQUEST_ID);
  });

  test('rejects runtime attempts to combine managed native and JavaScript credential custody', () => {
    const transport = managedTransport();

    expect(() =>
      new cave.CaveClient({
        transport,
        credentialCustody: { mode: 'managed-native' },
        credentials: {
          store: {
            get: () => Promise.resolve(undefined),
            set: () => Promise.resolve(),
            delete: () => Promise.resolve(false),
          },
          reference: { key: 'managed-native-conflict' },
        },
      } as unknown as cave.CaveClientOptions),
    ).toThrow('Managed native credential custody cannot use a JavaScript SecretStore.');
  });
});
