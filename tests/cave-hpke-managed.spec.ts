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

describe('managed hpke-bound-v1 handoff', () => {
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
