import * as cave from '@opencoven/cave-client';
import { inspect } from 'node:util';
import { createMemorySecretStore, createSecretStoreReference } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { parseCaveCredentialMetadata } from '../packages/cave/src/credential-metadata.js';
import { CAVE_CONTRACT_ERROR_CODES } from '../packages/cave/src/contract-constraints.js';

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

function withAccessor(
  value: Record<string, unknown>,
  key: string,
  getter: () => unknown,
): Record<string, unknown> {
  Object.defineProperty(value, key, {
    enumerable: true,
    get: getter,
  });
  return value;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('managed native Cave credential custody', () => {
  test('maps repeated managed result identities to a fixed redacted invalid response', async () => {
    const repeated = { nativeBearer: BEARER };
    const client = managedClient(managedTransport({
      health: vi.fn(() =>
        Promise.resolve({
          ...HEALTH_ENVELOPE,
          data: {
            ...HEALTH_ENVELOPE.data,
            left: repeated,
            right: repeated,
          },
        }),
      ),
    }));

    const error = await client.health().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      normalized: { code: 'invalid_response' },
    });
    expectRedacted({
      error: serializedError(error),
      inspect: inspect(error),
    });
  });

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

  test('preserves managed local poll and replay state errors without native remapping', async () => {
    let resolvePoll: ((status: unknown) => void) | undefined;
    const events: unknown[] = [];
    const transport = managedTransport({
      managedPairingPoll: vi.fn(() =>
        new Promise<unknown>((resolve) => {
          resolvePoll = resolve;
        }),
      ),
    });
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
      installationId: 'chat-local-pairing-state',
      scopes: ['chat:read'],
    });

    const firstPoll = session.poll();
    await vi.waitFor(() => expect(resolvePoll).toBeTypeOf('function'));
    const concurrentPoll = await session.poll().catch((error: unknown) => error);

    expect(concurrentPoll).toMatchObject({
      normalized: {
        code: 'operation_in_progress',
        retryable: true,
      },
      details: { reason: 'pairing_poll_in_progress' },
    });

    resolvePoll?.({
      id: REQUEST_ID,
      status: 'approved',
      expiresAt: 1_755_731_112_617,
    });
    await expect(firstPoll).resolves.toMatchObject({ status: 'approved' });
    await expect(session.exchange()).resolves.toEqual(credential());

    const replay = await session.exchange().catch((error: unknown) => error);
    expect(replay).toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
      },
      details: { reason: 'pairing_replayed' },
    });
    expectRedacted({
      concurrentPoll: serializedError(concurrentPoll),
      replay: serializedError(replay),
      inspect: [inspect(concurrentPoll), inspect(replay)],
      events,
    });
  });

  test('does not trust a native error that imitates the CaveClientError brand', async () => {
    const imitation = Object.assign(new Error(`native bearer ${BEARER}`), {
      code: 'conflict',
      details: { reason: BEARER },
      retryable: false,
    });
    Object.defineProperty(imitation, Symbol.for('@opencoven/cave-client/CaveClientError'), {
      value: true,
    });
    const client = managedClient(managedTransport({
      health: vi.fn(() => Promise.reject(imitation)),
    }));

    const error = await client.health().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      normalized: { code: 'conflict', retryable: false },
      details: undefined,
    });
    expectRedacted({
      error: serializedError(error),
      inspect: inspect(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
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

  test.each(CAVE_CONTRACT_ERROR_CODES)(
    'preserves the managed contract error code and retry semantics for %s',
    async (code) => {
      const retryable = code === 'rate_limited' || code === 'service_unavailable';
      const envelope = {
        apiVersion: '1.0',
        minimumClientVersion: '0.1.0',
        capabilities: ['familiars', 'cursors'],
        operations: ['familiars.list'],
        error: {
          code,
          message: `native bearer ${BEARER}`,
          retryable,
          details: { bearer: BEARER },
        },
      };
      const direct = new cave.CaveClient({
        transport: {
          health: () => Promise.resolve(HEALTH_ENVELOPE),
          listFamiliars: () => Promise.resolve(envelope),
        },
      });
      const managed = managedClient(managedTransport({
        listFamiliars: vi.fn(() => Promise.resolve(envelope)),
      }));

      const directError = await direct.listFamiliars().catch((error: unknown) => error);
      const managedError = await managed.listFamiliars().catch((error: unknown) => error);
      expect(directError).toMatchObject({
        normalized: { code, retryable },
      });
      expect(managedError).toMatchObject({
        normalized: { code, retryable },
      });
      expectRedacted({
        error: serializedError(managedError),
        normalized: (managedError as cave.CaveClientError).normalized,
      });
    },
  );

  test('rejects accessor and proxy constructor configuration without leaking or bypassing custody', () => {
    const transport = managedTransport();
    const operation = Object.defineProperty({}, 'timeoutMs', {
      enumerable: true,
      get() {
        throw new Error(`operation bearer ${BEARER}`);
      },
    });
    const credentials = Object.defineProperty({}, 'store', {
      enumerable: true,
      get() {
        throw new Error(`credentials bearer ${BEARER}`);
      },
    });
    const accessorOptions = {
      get transport() {
        throw new Error(`constructor bearer ${BEARER}`);
      },
    };
    const mixedOptions = {
      transport,
      credentials: {
        store: createMemorySecretStore(),
        reference: createSecretStoreReference('constructor-mixed'),
      },
      get credentialCustody() {
        return { mode: 'managed-native' as const };
      },
    };
    const proxyOptions = new Proxy(
      { transport },
      {
        getOwnPropertyDescriptor() {
          throw new Error(`constructor bearer ${BEARER}`);
        },
      },
    );

    for (const options of [
      accessorOptions,
      mixedOptions,
      proxyOptions,
      {
        transport,
        credentialCustody: { mode: 'managed-native' as const },
        operation,
      },
      {
        transport,
        credentialCustody: { mode: 'managed-native' as const },
        credentials,
      },
    ]) {
      const error = (() => {
        try {
          new cave.CaveClient(options as unknown as cave.CaveClientOptions);
        } catch (caught) {
          return caught;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(TypeError);
      expectRedacted({
        string: String(error),
        inspect: inspect(error),
        json: serializedError(error),
      });
    }
  });

  test('keeps own-data JavaScript credentials mutually exclusive with managed custody', () => {
    const error = (() => {
      try {
        new cave.CaveClient(
          ({
            transport: managedTransport(),
            credentials: {
              store: createMemorySecretStore(),
              reference: createSecretStoreReference('constructor-mixed-data'),
            },
            credentialCustody: { mode: 'managed-native' },
          }) as unknown as cave.CaveClientOptions,
        );
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toContain('cannot use a JavaScript SecretStore');
    expect(JSON.stringify(error, error instanceof Error
      ? Object.getOwnPropertyNames(error)
      : undefined)).not.toContain(BEARER);
  });

  test('rejects nested accessor, custom-array, and revoked-proxy managed results before they leak', async () => {
    const accessorCredential = credential() as unknown as Record<string, unknown>;
    let scopeReads = 0;
    withAccessor(accessorCredential, 'scopes', () => {
      scopeReads += 1;
      return scopeReads === 1 ? ['chat:read'] : [BEARER];
    });
    class CustomScopes extends Array<string> {}
    const customScopes = new CustomScopes('chat:read');
    const { proxy, revoke } = Proxy.revocable(
      {
        status: 'missing',
      },
      {},
    );
    revoke();

    const transport = managedTransport({
      managedPairingExchange: vi.fn(() =>
        Promise.resolve({ credential: accessorCredential }),
      ),
    });
    const client = managedClient(transport);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });
    const accessorError = await session.exchange().catch((error: unknown) => error);
    expect(accessorError).toMatchObject({ normalized: { code: 'invalid_response' } });
    expectRedacted({
      accessorError: serializedError(accessorError),
      scopes: (accessorError as cave.CaveClientError).details,
    });

    transport.managedPairingExchange = vi.fn(() =>
      Promise.resolve({
        credential: {
          ...credential(),
          scopes: customScopes,
        },
      }),
    );
    const customArrayError = await (
      await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-2',
        scopes: ['chat:read'],
      })
    ).exchange().catch((error: unknown) => error);
    expect(customArrayError).toMatchObject({ normalized: { code: 'invalid_response' } });

    transport.managedCredentialStatus = vi.fn(() => Promise.resolve(proxy));
    const proxyError = await client.credentialStatus().catch((error: unknown) => error);
    expect(proxyError).toMatchObject({ normalized: { code: 'invalid_response' } });
  });

  test.each([
    {
      label: 'ownKeys',
      proxy: () =>
        new Proxy(credential(), {
          ownKeys() {
            throw new Error(`native bearer ${BEARER}`);
          },
        }),
    },
    {
      label: 'getOwnPropertyDescriptor',
      proxy: () =>
        new Proxy(credential(), {
          getOwnPropertyDescriptor() {
            throw new Error(`native bearer ${BEARER}`);
          },
        }),
    },
    {
      label: 'getPrototypeOf after initial inspection',
      proxy: () => {
        let inspections = 0;
        return new Proxy(credential(), {
          getPrototypeOf() {
            inspections += 1;
            if (inspections === 1) {
              return Object.prototype;
            }
            throw new Error(`native bearer ${BEARER}`);
          },
        });
      },
    },
  ])('sanitizes $label proxy failures during persistent managed exchange', async ({ proxy }) => {
    const events: unknown[] = [];
    const transport = managedTransport({
      managedPairingExchange: vi.fn(() =>
        Promise.resolve({ credential: proxy() }),
      ),
    });
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
      installationId: 'chat-proxy',
      scopes: ['chat:read'],
    });
    const error = await session.exchange().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      normalized: { code: 'invalid_response', operation: 'pairingExchange' },
    });
    expect(error instanceof Error ? error.cause : undefined).toBeUndefined();
    expectRedacted({
      json: serializedError(error),
      string: String(error),
      inspect: inspect(error),
      normalized: (error as cave.CaveClientError).normalized,
      events,
    });
  });

  test.each([
    ['valid', (value: cave.CaveCredentialMetadata) => value, true],
    ['empty app name', (value: cave.CaveCredentialMetadata) => ({ ...value, appName: '' }), false],
    ['empty installation ID', (value: cave.CaveCredentialMetadata) => ({ ...value, installationId: '' }), false],
    ['duplicate scope', (value: cave.CaveCredentialMetadata) => ({ ...value, scopes: ['chat:read', 'chat:read'] }), false],
    ['unsupported scope', (value: cave.CaveCredentialMetadata) => ({ ...value, scopes: ['admin:all'] }), false],
    ['negative timestamp', (value: cave.CaveCredentialMetadata) => ({ ...value, createdAt: -1 }), false],
    ['non-finite timestamp', (value: cave.CaveCredentialMetadata) => ({ ...value, createdAt: Number.POSITIVE_INFINITY }), false],
    ['malformed nullable timestamp', (value: cave.CaveCredentialMetadata) => ({ ...value, lastUsedAt: 'never' }), false],
    ['negative revoked timestamp', (value: cave.CaveCredentialMetadata) => ({ ...value, revokedAt: -1 }), false],
    ['empty revocation reason', (value: cave.CaveCredentialMetadata) => ({ ...value, revocationReason: '' }), false],
    ['extra field', (value: cave.CaveCredentialMetadata) => ({ ...value, bearer: BEARER }), false],
    ['accessor field', (value: cave.CaveCredentialMetadata) =>
      withAccessor({ ...value }, 'appName', () => 'OpenCoven Chat'), false],
  ] as const)(
    'keeps direct and managed credential metadata parsing in parity: %s',
    async (_label, shape, accepted) => {
      const metadata = shape(credential());
      const direct = parseCaveCredentialMetadata(metadata);
      const transport = managedTransport({
        managedPairingExchange: vi.fn(() =>
          Promise.resolve({ credential: metadata }),
        ),
      });
      const client = managedClient(transport);
      const session = await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-metadata-parity',
        scopes: ['chat:read'],
      });

      if (accepted) {
        expect(direct).toEqual(credential());
        await expect(session.exchange()).resolves.toEqual(credential());
      } else {
        expect(direct).toBeUndefined();
        await expect(session.exchange()).rejects.toMatchObject({
          normalized: { code: 'invalid_response', operation: 'pairingExchange' },
        });
      }
    },
  );

  test('rejects nested managed accessors before health, pairing, status, and canonical parsing', async () => {
    const createTransport = managedTransport({
      managedPairingCreate: vi.fn(() =>
        Promise.resolve(
          withAccessor(
            {
              requestId: REQUEST_ID,
              expiresAt: 1_755_731_112_617,
            },
            'expiresAt',
            () => 1_755_731_112_617,
          ),
        ),
      ),
    });
    await expect(
      managedClient(createTransport).createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-create-accessor',
        scopes: ['chat:read'],
      }),
    ).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });

    const healthData = withAccessor(
      {
        instanceId: 'managed-native-cave',
        pairingRequired: true,
        releaseVersion: '0.3.9',
      },
      'instanceId',
      () => BEARER,
    );
    const canonicalEntry = withAccessor(
      {
        id: 'familiar-1',
        displayName: 'Cedar',
        role: 'guide',
      },
      'displayName',
      () => BEARER,
    );
    const transport = managedTransport({
      health: vi.fn(() =>
        Promise.resolve({
          ...HEALTH_ENVELOPE,
          data: healthData as unknown as typeof HEALTH_ENVELOPE.data,
        }),
      ),
      managedPairingPoll: vi.fn(() =>
        Promise.resolve(
          withAccessor(
            {
              id: REQUEST_ID,
              status: 'approved',
              expiresAt: 1_755_731_112_617,
            },
            'status',
            () => 'approved',
          ),
        ),
      ),
      managedCredentialStatus: vi.fn(() =>
        Promise.resolve({
          status: 'valid',
          access: 'chat:read',
          health: withAccessor(
            { ...HEALTH_ENVELOPE },
            'apiVersion',
            () => '1.0',
          ),
        }),
      ),
      listFamiliars: vi.fn(() =>
        Promise.resolve({
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['familiars', 'cursors'],
          operations: ['familiars.list'],
          data: { familiars: [canonicalEntry] },
        }),
      ),
    });
    const client = managedClient(transport);

    await expect(client.health()).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });
    await expect(session.poll()).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });
    await expect(client.credentialStatus()).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });
    await expect(client.listFamiliars()).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });

    transport.managedForgetCredential = vi.fn(() =>
      Promise.resolve(withAccessor({ status: 'deleted' }, 'status', () => 'deleted')),
    );
    await expect(client.forgetCredential()).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });
  });

  test('returns immutable managed snapshots rather than transport-owned values', async () => {
    const transport = managedTransport({
      listFamiliars: vi.fn(() =>
        Promise.resolve({
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['familiars', 'cursors'],
          operations: ['familiars.list'],
          data: {
            familiars: [{
              id: 'familiar-1',
              displayName: 'Cedar',
              role: 'guide',
            }],
          },
        }),
      ),
    });
    const client = managedClient(transport);
    const health = await client.health();
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });
    const status = await session.poll();
    const exchanged = await session.exchange();
    const credentialStatus = await client.credentialStatus();
    const familiars = await client.listFamiliars();

    expect(Object.isFrozen(health)).toBe(true);
    expect(Object.isFrozen(health.capabilities)).toBe(true);
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(exchanged)).toBe(true);
    expect(Object.isFrozen(exchanged.scopes)).toBe(true);
    expect(Object.isFrozen(credentialStatus)).toBe(true);
    expect(Object.isFrozen(familiars)).toBe(true);
    expect(Object.isFrozen(familiars.data)).toBe(true);
    expect(Object.isFrozen(familiars.data[0])).toBe(true);
  });

  test('reconstructs managed canonical outputs without nested native extras', async () => {
    const nestedBearer = 'nested-bearer-must-not-return';
    const transport = managedTransport({
      familiarContract: vi.fn(() =>
        Promise.resolve({
          ok: true,
          id: 'cody',
          workspace: '/cody',
          present: { soul: true, identity: true, ward: true, memory: true, bearer: nestedBearer },
          identity: { name: 'Cody', creature: 'Implementation familiar', bearer: nestedBearer },
          ward: {
            version: '0.1.0',
            familiar: 'cody',
            person: 'val',
            protectedFiles: ['SOUL.md'],
            invariants: [],
            editablePaths: ['scratch/'],
            approvalTiers: { auto: ['run tests'], humanReview: ['push a branch'] },
            bearer: nestedBearer,
          },
          bearer: nestedBearer,
          report: {
            specVersion: '1',
            pass: false,
            bearer: nestedBearer,
            properties: [{ property: 'Named Identity', pass: true, bearer: nestedBearer }],
            violations: [{
              file: 'SOUL.md',
              field: 'name',
              message: 'Missing name',
              bearer: nestedBearer,
            }],
            warnings: [{
              file: 'MEMORY.md',
              field: 'memory',
              message: 'No memory',
              bearer: nestedBearer,
            }],
          },
        } as unknown as cave.CaveFamiliarContractResponse),
      ),
      familiarAnalytics: vi.fn(() =>
        Promise.resolve({
          ok: true,
          bearer: nestedBearer,
          analytics: {
            generatedAt: '2026-08-24T02:03:51.419Z',
            bearer: nestedBearer,
            windows: {
              '7d': {
                attempts: 1,
                completed: 1,
                failed: 0,
                cancelled: 0,
                successRate: 1,
                toolCalls: 1,
                toolFailures: 0,
                bearer: nestedBearer,
                models: [{
                  key: 'model',
                  attempts: 1,
                  completed: 1,
                  failed: 0,
                  cancelled: 0,
                  successRate: 1,
                  toolCalls: 1,
                  toolFailures: 0,
                  bearer: nestedBearer,
                }],
                harnesses: [{
                  key: 'harness',
                  attempts: 1,
                  completed: 1,
                  failed: 0,
                  cancelled: 0,
                  successRate: 1,
                  toolCalls: 1,
                  toolFailures: 0,
                  bearer: nestedBearer,
                }],
                coverage: {
                  all: { known: 1, total: 1, ratio: 1, bearer: nestedBearer },
                },
                days: [
                  {
                    date: '2026-08-18',
                    completed: 1,
                    failed: 0,
                    cancelled: 0,
                    bearer: nestedBearer,
                  },
                ],
              },
            },
            recentAttempts: [{
              id: 'attempt-1',
              executionKind: 'chat',
              occurredAt: '2026-08-24T02:03:51.419Z',
              harnessId: 'harness',
              status: 'completed',
              toolCalls: 1,
              toolFailures: 0,
              bearer: nestedBearer,
            }],
            backfill: {
              state: 'complete',
              imported: 1,
              bearer: nestedBearer,
            },
          },
        } as unknown as cave.CaveFamiliarAnalyticsResponse),
      ),
      listFamiliars: vi.fn(() =>
        Promise.resolve({
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['familiars', 'cursors'],
          operations: ['familiars.list'],
          bearer: nestedBearer,
          data: {
            bearer: nestedBearer,
            familiars: [{
              id: 'cody',
              displayName: 'Cody',
              role: 'guide',
              bearer: nestedBearer,
            }],
          },
        }),
      ),
    });
    const client = managedClient(transport);
    const contract = await client.familiarContract('cody');
    const analytics = await client.familiarAnalytics('cody');
    const familiars = await client.listFamiliars();

    expectRedacted({ contract, analytics, familiars });
    expect(Object.isFrozen(contract.report)).toBe(true);
    // The ward and the day series are reconstructed field by field, so the
    // native object's extras cannot ride along into a caller's hands.
    expect(contract.ward).toEqual({
      version: '0.1.0',
      familiar: 'cody',
      person: 'val',
      protectedFiles: ['SOUL.md'],
      invariants: [],
      editablePaths: ['scratch/'],
      approvalTiers: { auto: ['run tests'], humanReview: ['push a branch'] },
    });
    expect(analytics.windows['7d']?.days).toEqual([
      { date: '2026-08-18', completed: 1, failed: 0, cancelled: 0 },
    ]);
    expect(Object.isFrozen(analytics.windows['7d'])).toBe(true);
    expect(Object.isFrozen(familiars.data[0])).toBe(true);
  });

  test('refuses malformed managed ward, identity, and day series before they reach a caller', async () => {
    // The managed path reconstructs every field rather than passing the
    // native object through, so a malformed one has to fail there -- not be
    // handed to the caller as a partially trusted object.
    const report = {
      specVersion: '0.1.0',
      pass: true,
      properties: [],
      violations: [],
      warnings: [],
    };
    const present = { soul: true, identity: true, ward: true, memory: true };
    const contractWith = (overrides: Record<string, unknown>) =>
      managedClient(
        managedTransport({
          familiarContract: vi.fn(() =>
            Promise.resolve({
              ok: true,
              id: 'cody',
              present,
              report,
              ...overrides,
            } as unknown as cave.CaveFamiliarContractResponse),
          ),
        }),
      );

    await expect(
      contractWith({ identity: { name: 'Cody', person: 7 } }).familiarContract('cody'),
    ).rejects.toMatchObject({ normalized: { code: 'invalid_response' } });
    await expect(
      contractWith({
        ward: {
          protectedFiles: ['SOUL.md'],
          invariants: [],
          editablePaths: [],
          approvalTiers: { auto: [], humanReview: [null] },
        },
      }).familiarContract('cody'),
    ).rejects.toMatchObject({ normalized: { code: 'invalid_response' } });

    const analyticsClient = managedClient(
      managedTransport({
        familiarAnalytics: vi.fn(() =>
          Promise.resolve({
            ok: true,
            analytics: {
              generatedAt: '2026-08-24T02:03:51.419Z',
              windows: {
                '7d': {
                  attempts: 0,
                  completed: 0,
                  failed: 0,
                  cancelled: 0,
                  successRate: null,
                  toolCalls: 0,
                  toolFailures: 0,
                  models: [],
                  harnesses: [],
                  coverage: {},
                  days: [{ date: '2026-08-18', completed: 0, failed: 'one', cancelled: 0 }],
                },
              },
              recentAttempts: [],
              backfill: { state: 'complete', imported: 0 },
            },
          } as unknown as cave.CaveFamiliarAnalyticsResponse),
        ),
      }),
    );
    await expect(analyticsClient.familiarAnalytics('cody')).rejects.toMatchObject({
      normalized: { code: 'invalid_response' },
    });
  });

  test('uses direct pairing exchange accessors only once before returning or persisting', async () => {
    const accessorBearer = 'getter-bearer-must-not-return';
    const store = createMemorySecretStore();
    const reference = createSecretStoreReference('direct-accessor-exchange');
    const authorityBinding: cave.CaveAuthorityBinding = {
      version: 1,
      instanceId: 'managed-native-cave',
      endpoint: { kind: 'http', url: 'http://127.0.0.1:3020' },
      record: { identity: 'sha256:direct-accessor', device: 1, inode: 2 },
      freshness: {
        pid: 1,
        nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
        startedAt: '2026-08-24T02:03:51.419Z',
      },
    };
    let bearerReads = 0;
    let credentialReads = 0;
    let authorityReads = 0;
    const exchange = {
      get bearer() {
        bearerReads += 1;
        return bearerReads === 1 ? BEARER : accessorBearer;
      },
      get credential() {
        credentialReads += 1;
        return credentialReads === 1
          ? { ...credential(), harmlessAdditive: 'base-compatible-additive' }
          : { ...credential(), appName: accessorBearer };
      },
      get authorityBinding() {
        authorityReads += 1;
        return authorityReads === 1
          ? authorityBinding
          : { ...authorityBinding, instanceId: accessorBearer };
      },
    };
    const client = new cave.CaveClient({
      transport: {
        health: () => Promise.resolve(HEALTH_ENVELOPE),
        pairingCreate: () =>
          Promise.resolve({
            requestId: REQUEST_ID,
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        pairingExchange: () => Promise.resolve(exchange),
      },
      credentials: { store, reference },
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-direct-accessor',
      scopes: ['chat:read'],
    });
    const result = await session.exchange();
    const stored = await store.get(reference.key);

    expect(result).toEqual(credential());
    expect(bearerReads).toBe(1);
    expect(credentialReads).toBe(1);
    expect(authorityReads).toBe(1);
    expect(JSON.stringify({ result, stored })).not.toContain(accessorBearer);
    expect(stored).not.toContain('base-compatible-additive');
  });

  test('redacts managed health and canonical failures before causes, inspect, or observer events', async () => {
    const events: unknown[] = [];
    const nativeError = Object.assign(new Error(`native bearer ${BEARER}`), {
      code: 'service_unavailable',
      details: { bearer: BEARER },
      cause: { secret: PAIRING_SECRET },
    });
    const transport = managedTransport({
      health: vi.fn(() => Promise.reject(nativeError)),
      listFamiliars: vi.fn(() => Promise.reject(nativeError)),
    });
    const client = managedClient(transport, {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        throw error;
      },
    });

    const healthError = await client.health().catch((error: unknown) => error);
    const canonicalError = await client.listFamiliars().catch((error: unknown) => error);
    for (const error of [healthError, canonicalError]) {
      expect(error).toMatchObject({
        normalized: { code: 'service_unavailable' },
      });
      expectRedacted({
        json: serializedError(error),
        inspect: inspect(error),
        cause: error instanceof Error ? error.cause : undefined,
        normalized: (error as cave.CaveClientError).normalized,
      });
    }
    expectRedacted(events);
  });

  test('rejects managed polling that is not bound to the active pairing request', async () => {
    const transport = managedTransport({
      managedPairingPoll: vi.fn(() =>
        Promise.resolve({
          id: '018f4f1a-77c2-7a31-8a15-55a25aaba009',
          status: 'approved',
          expiresAt: 1_755_731_112_617,
        }),
      ),
    });
    const client = managedClient(transport);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.poll()).rejects.toMatchObject({
      normalized: { code: 'invalid_response', operation: 'pairingPoll' },
    });
    await expect(session.exchange()).resolves.toEqual(credential());
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
