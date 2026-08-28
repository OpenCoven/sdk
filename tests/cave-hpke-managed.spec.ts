/* eslint-disable @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import {
  createManagedCaveClient as createRootManagedClient,
} from '@opencoven/cave-client';
import {
  createManagedCaveClient as createBrowserManagedClient,
  type CaveManagedDiscoverySource,
} from '@opencoven/cave-client/managed';
import { describe, expect, test, vi } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = JSON.parse(
  readFileSync(
    resolve(root, 'packages/cave/fixtures/contract-fixture.json'),
    'utf8',
  ),
) as {
  examples: {
    discoveryRecordV2: Record<string, unknown> & {
      authority: {
        keyId: string;
      };
    };
  };
};
const REQUEST_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const NATIVE_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function source(): CaveManagedDiscoverySource {
  return {
    read: async () => ({
      bytes: `${JSON.stringify(fixture.examples.discoveryRecordV2)}\n`,
      record: {
        identity: 'native:owner-checked:client-v1-discovery',
        device: 7,
        inode: 11,
        processAlive: true,
      },
    }),
  };
}

function envelope(data: unknown): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['health', 'pairing'],
    operations: [
      'health.read',
      'pairing.create',
      'pairing.poll',
      'pairing.exchange',
    ],
    data,
  };
}

function healthEnvelope(): Record<string, unknown> {
  return {
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['health', 'familiars'],
    operations: ['health.read', 'familiars.list'],
    data: {
      instanceId: 'managed-hpke',
      pairingRequired: true,
      releaseVersion: '0.3.10',
    },
  };
}

function authenticated<T>(value: T): {
  authentication: {
    mechanism: 'hpke-bound-v1';
    keyId: string;
  };
  value: T;
} {
  return {
    authentication: {
      mechanism: 'hpke-bound-v1',
      keyId: fixture.examples.discoveryRecordV2.authority.keyId,
    },
    value,
  };
}

function credentialStatusClient(options: {
  discoverySource: CaveManagedDiscoverySource;
  operation?: { timeoutMs: number };
  status: ReturnType<typeof vi.fn>;
}) {
  return createBrowserManagedClient({
    transport: {
      health: async () => envelope({
        instanceId: 'managed-timeout',
        pairingRequired: true,
        releaseVersion: '0.3.10',
      }),
      managedPairingCreate: async () => ({
        requestId: REQUEST_ID,
        expiresAt: 1_755_731_112_617,
      }),
      managedPairingPoll: async () => ({
        id: REQUEST_ID,
        status: 'approved',
        expiresAt: 1_755_731_112_617,
      }),
      managedPairingExchange: async () => ({ credential: {} }),
      managedCredentialStatus: async () => ({ status: 'missing' }),
      managedForgetCredential: async () => ({ status: 'missing' }),
      managedHpkeCredentialStatus: options.status,
    },
    discovery: { source: options.discoverySource },
    ...(options.operation === undefined
      ? {}
      : { operation: options.operation }),
  } as never);
}

function browserManagedTransport(overrides: Record<string, unknown> = {}) {
  return {
    health: async () => healthEnvelope(),
    managedPairingCreate: async () => ({
      requestId: REQUEST_ID,
      expiresAt: 1_755_731_112_617,
    }),
    managedPairingPoll: async () => ({
      id: REQUEST_ID,
      status: 'approved',
      expiresAt: 1_755_731_112_617,
    }),
    managedPairingExchange: async () => ({ credential: {} }),
    managedCredentialStatus: async () => ({ status: 'missing' }),
    managedForgetCredential: async () => ({ status: 'missing' }),
    ...overrides,
  };
}

describe('managed hpke-bound-v1 handoff', () => {
  test.each([
    ['default', { operation: { timeoutMs: 1_000 }, call: {} }],
    ['per-call', { call: { timeoutMs: 1_000 } }],
  ])('lets %s managed deadlines reach discovery and transport', async (
    _label,
    configuration,
  ) => {
    const discoverySource = source();
    const read = vi.spyOn(discoverySource, 'read');
    const status = vi.fn(async () =>
      authenticated({ status: 'missing' }),
    );
    const client = credentialStatusClient({
      discoverySource,
      status,
      ...('operation' in configuration
        ? { operation: configuration.operation }
        : {}),
    });

    await expect(
      client.credentialStatus(configuration.call),
    ).resolves.toEqual({ status: 'missing' });
    expect(read).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
  });

  test('times out blocked managed discovery without invoking transport', async () => {
    const read = vi.fn(async () => await new Promise<never>(() => undefined));
    const status = vi.fn();
    const client = credentialStatusClient({
      discoverySource: { read },
      status,
    });

    await expect(
      client.credentialStatus({ timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(read).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  test('rejects an already-aborted managed call before discovery or transport', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const read = vi.fn();
    const status = vi.fn();
    const client = credentialStatusClient({
      discoverySource: { read },
      status,
    });

    await expect(
      client.credentialStatus({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(read).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  test('rejects accessor-backed staged native configuration without invocation', () => {
    let reads = 0;
    const options = Object.defineProperty(
      {
        transport: {},
      },
      'discovery',
      {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error(`native secret ${NATIVE_SECRET}`);
        },
      },
    );

    const error = (() => {
      try {
        createRootManagedClient(options as never);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(TypeError);
    expect(reads).toBe(0);
    expect(inspect(error)).not.toContain(NATIVE_SECRET);
  });

  test('defers a throwing familiar contract proxy until redacted invocation', async () => {
    let reads = 0;
    const transport = new Proxy(browserManagedTransport(), {
      get(target, property, receiver) {
        if (property === 'familiarContract') {
          reads += 1;
          throw new Error(`hostile proxy ${NATIVE_SECRET}`);
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const client = createBrowserManagedClient({
      transport,
      discovery: { source: source() },
    } as never);
    expect(reads).toBe(0);

    const error = await client
      .familiarContract('cody')
      .catch((caught: unknown) => caught);

    expect(reads).toBe(1);
    expect(String(error)).toBe(
      'CaveClientError: cave.familiarContract: invalid_response',
    );
    expect(inspect(error)).not.toContain(NATIVE_SECRET);
    expect(inspect(error)).not.toContain('hostile proxy');
  });

  test('defers a throwing familiar analytics getter until redacted invocation', async () => {
    let reads = 0;
    const transport = Object.defineProperty(
      browserManagedTransport(),
      'familiarAnalytics',
      {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error(`hostile accessor ${NATIVE_SECRET}`);
        },
      },
    );

    const client = createBrowserManagedClient({
      transport,
      discovery: { source: source() },
    } as never);
    expect(reads).toBe(0);

    const error = await client
      .familiarAnalytics('cody')
      .catch((caught: unknown) => caught);

    expect(reads).toBe(1);
    expect(String(error)).toBe(
      'CaveClientError: cave.familiarAnalytics: invalid_response',
    );
    expect(inspect(error)).not.toContain(NATIVE_SECRET);
    expect(inspect(error)).not.toContain('hostile accessor');
  });

  test('invokes normal own familiar functions through discovery wrapping', async () => {
    const familiarContract = vi.fn(async () => ({
      ok: true,
      id: 'cody',
      present: true,
      report: {
        specVersion: '1',
        pass: true,
        properties: [],
        violations: [],
        warnings: [],
      },
    }));
    const familiarAnalytics = vi.fn(async () => ({
      ok: true,
      analytics: {
        generatedAt: '2026-08-24T02:03:51.419Z',
        windows: {},
        recentAttempts: [],
        backfill: {
          state: 'complete',
          imported: 0,
        },
      },
    }));
    const client = createBrowserManagedClient({
      transport: browserManagedTransport({
        familiarContract,
        familiarAnalytics,
      }),
      discovery: { source: source() },
    } as never);

    await expect(client.familiarContract('cody')).resolves.toMatchObject({
      id: 'cody',
      present: true,
    });
    await expect(client.familiarAnalytics('cody')).resolves.toMatchObject({
      generatedAt: '2026-08-24T02:03:51.419Z',
    });
    expect(familiarContract).toHaveBeenCalledOnce();
    expect(familiarAnalytics).toHaveBeenCalledOnce();
  });

  test('preserves unsupported optional familiar operations under discovery wrapping', async () => {
    const client = createBrowserManagedClient({
      transport: browserManagedTransport(),
      discovery: { source: source() },
    } as never);

    await expect(client.familiarContract('cody')).rejects.toMatchObject({
      code: 'unsupported_operation',
    });
    await expect(client.familiarAnalytics('cody')).rejects.toMatchObject({
      code: 'unsupported_operation',
    });
  });

  test('routes browser-managed operation families through their v2 boundaries', async () => {
    const cursor = {
      current:
        'eyJ2IjoxLCJzIjoiMjAyNi0wOC0xNVQwMDowMDowMS4wMDBaIiwiaSI6ImNvbnZlcnNhdGlvbi1leGFtcGxlIn0',
      hasMore: false,
    };
    const health = vi.fn(async () => healthEnvelope());
    const managedForgetCredential = vi.fn(async () => ({ status: 'deleted' }));
    const managedHpkePairingExchange = vi.fn(async () =>
      authenticated({
        credential: {
          id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
          appName: 'OpenCoven Chat',
          installationId: 'managed-boundaries',
          scopes: ['chat:read'],
          createdAt: 1_755_730_812_617,
          lastUsedAt: null,
          revokedAt: null,
          revocationReason: null,
        },
      }),
    );
    const managedHpkeFamiliars = vi.fn(async () =>
      authenticated({
        ok: true,
        familiars: [{
          id: 'cody',
          display_name: 'Cody',
          role: 'Implementation',
        }],
      }),
    );
    const managedHpkeListFamiliars = vi.fn(async () =>
      authenticated(
        {
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['familiars', 'cursors'],
          operations: ['familiars.list'],
          data: {
            familiars: [{
              id: 'cody',
              displayName: 'Cody',
              role: 'Implementation',
            }],
          },
          cursor,
        },
      ),
    );
    const managedHpkeListProjects = vi.fn(async () =>
      authenticated(
        {
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['projects', 'cursors'],
          operations: ['projects.list'],
          data: {
            projects: [{
              id: 'project-1',
              name: 'OpenCoven',
              root: '/workspace',
              createdAt: '2026-08-24T00:00:00.000Z',
              updatedAt: '2026-08-24T01:00:00.000Z',
            }],
          },
          cursor,
        },
      ),
    );
    const managedHpkeListConversations = vi.fn(async () =>
      authenticated(
        {
          apiVersion: '1.0',
          minimumClientVersion: '0.1.0',
          capabilities: ['conversations', 'cursors'],
          operations: ['conversations.list'],
          data: {
            conversations: [{
              id: 'conversation-1',
              familiarId: 'cody',
              updatedAt: '2026-08-24T01:00:00.000Z',
            }],
          },
          cursor,
        },
      ),
    );
    const client = createBrowserManagedClient({
      transport: browserManagedTransport({
        health,
        managedForgetCredential,
        managedHpkePairingExchange,
        managedHpkeFamiliars,
        managedHpkeListFamiliars,
        managedHpkeListProjects,
        managedHpkeListConversations,
      }),
      discovery: { source: source() },
    } as never);
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'managed-boundaries',
      scopes: ['chat:read'],
    });

    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
    await expect(pairing.exchange()).resolves.toMatchObject({
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
    });
    await expect(client.familiars()).resolves.toEqual([
      {
        id: 'cody',
        displayName: 'Cody',
        role: 'Implementation',
      },
    ]);
    await expect(client.listFamiliars()).resolves.toMatchObject({
      data: [{ id: 'cody' }],
    });
    await expect(client.listProjects()).resolves.toMatchObject({
      data: [{ id: 'project-1' }],
    });
    await expect(client.listConversations()).resolves.toMatchObject({
      data: [{ id: 'conversation-1' }],
    });
    await expect(client.forgetCredential()).resolves.toBe(true);
    expect(health).toHaveBeenCalledOnce();
    expect(managedHpkePairingExchange).toHaveBeenCalledOnce();
    expect(managedHpkeFamiliars).toHaveBeenCalledOnce();
    expect(managedHpkeListFamiliars).toHaveBeenCalledOnce();
    expect(managedHpkeListProjects).toHaveBeenCalledOnce();
    expect(managedHpkeListConversations).toHaveBeenCalledOnce();
    expect(managedForgetCredential).toHaveBeenCalledOnce();
  });

  test('passes strict immutable v2 authority metadata to the staged native adapter', async () => {
    const pairingPollHpke = vi.fn(
      async (
        handle: string,
        discovered: {
          version: number;
          authority: { keyId: string };
        },
      ) => {
        expect(handle).toBe('opaque-pairing-handle');
        expect(discovered).toMatchObject({
          version: 2,
          authority: {
            mechanism: 'hpke-bound-v1',
            mode: 'advertise',
            keyId: fixture.examples.discoveryRecordV2.authority.keyId,
          },
        });
        expect(Object.isFrozen(discovered)).toBe(true);
        expect(Object.isFrozen(discovered.authority)).toBe(true);
        return {
          authentication: authenticated(undefined).authentication,
          statusCode: 200,
          payload: envelope({
            id: REQUEST_ID,
            status: 'approved',
            expiresAt: 1_755_731_112_617,
          }),
        };
      },
    );
    const client = createRootManagedClient({
      transport: {
        pairingCreate: async () => ({
          handle: 'opaque-pairing-handle',
          response: {
            statusCode: 201,
            payload: envelope({
              requestId: REQUEST_ID,
              expiresAt: 1_755_731_112_617,
            }),
          },
        }),
        pairingPollHpke,
      },
      discovery: { source: source() },
    } as never);
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'managed-hpke-root',
      scopes: ['chat:read'],
    });

    await expect(pairing.poll()).resolves.toMatchObject({
      id: REQUEST_ID,
      status: 'approved',
    });
    expect(pairingPollHpke).toHaveBeenCalledOnce();
  });

  test('passes v2 authority metadata to the browser-safe managed adapter', async () => {
    const managedHpkePairingPoll = vi.fn(
      async (
        requestId: string,
        discovered: {
          version: number;
          authority: { keyId: string };
        },
      ) => {
        expect(requestId).toBe(REQUEST_ID);
        expect(discovered).toMatchObject({
          version: 2,
          authority: {
            keyId: fixture.examples.discoveryRecordV2.authority.keyId,
          },
        });
        expect(Object.isFrozen(discovered)).toBe(true);
        return authenticated({
          id: REQUEST_ID,
          status: 'approved',
          expiresAt: 1_755_731_112_617,
        });
      },
    );
    const client = createBrowserManagedClient({
      transport: {
        health: async () => envelope({
          instanceId: 'managed-browser',
          pairingRequired: true,
          releaseVersion: '0.3.10',
        }),
        managedPairingCreate: async () => ({
          requestId: REQUEST_ID,
          expiresAt: 1_755_731_112_617,
        }),
        managedHpkePairingPoll,
        managedHpkePairingExchange: async () =>
          authenticated({ credential: {} }),
        managedHpkeCredentialStatus: async () =>
          authenticated({ status: 'missing' }),
        managedForgetCredential: async () => ({ status: 'missing' }),
      },
      discovery: { source: source() },
    } as never);
    const pairing = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'managed-hpke-browser',
      scopes: ['chat:read'],
    });

    await expect(pairing.poll()).resolves.toMatchObject({
      id: REQUEST_ID,
      status: 'approved',
    });
    expect(managedHpkePairingPoll).toHaveBeenCalledOnce();
  });

  test('rejects unauthenticated native credential state without producing revoked state', async () => {
    const hostile = Object.defineProperty(
      {
        value: {
          status: 'revoked',
          health: envelope({
            instanceId: 'managed-hostile',
            pairingRequired: true,
            releaseVersion: '0.3.10',
          }),
        },
      },
      'authentication',
      {
        enumerable: true,
        get() {
          throw new Error(`native secret ${NATIVE_SECRET}`);
        },
      },
    );
    const client = createBrowserManagedClient({
      transport: {
        health: async () => envelope({
          instanceId: 'managed-hostile',
          pairingRequired: true,
          releaseVersion: '0.3.10',
        }),
        managedPairingCreate: async () => ({
          requestId: REQUEST_ID,
          expiresAt: 1_755_731_112_617,
        }),
        managedHpkePairingPoll: async () =>
          authenticated({
            id: REQUEST_ID,
            status: 'approved',
            expiresAt: 1_755_731_112_617,
          }),
        managedHpkePairingExchange: async () =>
          authenticated({ credential: {} }),
        managedHpkeCredentialStatus: async () => hostile,
        managedForgetCredential: async () => ({ status: 'missing' }),
      },
      discovery: { source: source() },
    } as never);

    const result = await client.credentialStatus().catch((error: unknown) => error);

    expect(result).toMatchObject({
      code: 'invalid_response',
    });
    expect(inspect(result)).not.toContain(NATIVE_SECRET);
  });

  test('does not let an unauthenticated staged native 401 produce revoked state', async () => {
    const client = createRootManagedClient({
      transport: {
        health: async () => ({
          statusCode: 200,
          payload: healthEnvelope(),
        }),
        credentialState: async () => ({ status: 'present' }),
        familiarsHpke: async () => ({
          statusCode: 401,
          payload: {
            apiVersion: '1.0',
            minimumClientVersion: '0.1.0',
            capabilities: ['health', 'familiars'],
            operations: ['health.read', 'familiars.list'],
            error: {
              code: 'unauthorized',
              message: 'Forged unauthorized.',
              retryable: false,
            },
          },
        }),
      },
      discovery: { source: source() },
    } as never);

    const result = await client.credentialStatus().catch((error: unknown) => error);

    expect(result).toMatchObject({
      code: 'invalid_response',
    });
    expect(result).not.toMatchObject({ status: 'revoked' });
  });
});
