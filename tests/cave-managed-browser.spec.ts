import { build } from 'esbuild';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  createManagedCaveClient,
  discoverManagedCaveEndpoint,
  type CaveManagedCredentialTransport,
  type CaveManagedDiscoverySource,
} from '@opencoven/cave-client/managed';
import { afterEach, describe, expect, test, vi } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUEST_ID = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const NATIVE_BEARER = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

const HEALTH = {
  apiVersion: '1.0',
  minimumClientVersion: '0.1.0',
  capabilities: ['health'],
  operations: ['health.read'],
  data: {
    instanceId: 'managed-browser-cave',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
} as const;

const managedTransport = {
  health: () => Promise.resolve(HEALTH),
  managedPairingCreate: () =>
    Promise.resolve({ requestId: REQUEST_ID, expiresAt: 1_755_731_112_617 }),
  managedPairingPoll: () =>
    Promise.resolve({ id: REQUEST_ID, status: 'pending', expiresAt: 1_755_731_112_617 }),
  managedPairingExchange: () =>
    Promise.resolve({
      credential: {
        id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
        appName: 'OpenCoven Chat',
        installationId: 'managed-browser',
        scopes: ['chat:read'],
        createdAt: 1_755_730_812_617,
        lastUsedAt: null,
        revokedAt: null,
        revocationReason: null,
      },
    }),
  managedCredentialStatus: () => Promise.resolve({ status: 'missing' }),
  managedForgetCredential: () => Promise.resolve({ status: 'missing' }),
} satisfies CaveManagedCredentialTransport;

afterEach(() => {
  vi.useRealTimers();
});

describe('managed browser entry point', () => {
  test('bundles for a browser without Node built-ins', async () => {
    const result = await build({
      absWorkingDir: root,
      alias: {
        '@opencoven/sdk-core/browser': resolve(root, 'packages/core/src/browser.ts'),
      },
      bundle: true,
      entryPoints: ['packages/cave/src/managed.ts'],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      target: 'es2024',
      write: false,
    });
    const output = result.outputFiles[0]?.text;

    expect(output).toBeTypeOf('string');
    expect(output).not.toMatch(/["']node:[^"']+["']/u);
    expect(output).not.toMatch(/\bBuffer\b/u);
    expect(output).not.toMatch(/\bprocess\s*\.\s*(?:env|cwd|platform|kill|get)/u);
  });

  test('uses a native-owned discovery source while validating its bytes and metadata in the SDK', async () => {
    const source: CaveManagedDiscoverySource = {
      read: vi.fn(() =>
        Promise.resolve({
          bytes: JSON.stringify({
            version: 1,
            endpoint: 'http://127.0.0.1:3020',
            pid: 4321,
            nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
            startedAt: '2026-08-24T02:03:51.419Z',
          }),
          record: {
            identity: 'tauri:owner-checked:client-v1-discovery',
            device: 0,
            inode: 0,
            processAlive: true,
          },
        }),
      ),
    };

    await expect(discoverManagedCaveEndpoint(source)).resolves.toEqual({
      version: 1,
      endpoint: {
        kind: 'http',
        url: 'http://127.0.0.1:3020',
      },
      freshness: {
        pid: 4321,
        nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
        startedAt: '2026-08-24T02:03:51.419Z',
      },
      record: {
        identity: 'tauri:owner-checked:client-v1-discovery',
        device: 0,
        inode: 0,
      },
    });

    const client = createManagedCaveClient({ transport: managedTransport });
    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
  });

  test('captures managed factory configuration only through own data descriptors', () => {
    const accessorOptions = {
      get transport() {
        throw new Error(`native bearer ${NATIVE_BEARER}`);
      },
    };
    const operation = Object.defineProperty({}, 'observer', {
      enumerable: true,
      get() {
        throw new Error(`native bearer ${NATIVE_BEARER}`);
      },
    });
    const proxyOptions = new Proxy(
      { transport: managedTransport },
      {
        ownKeys() {
          throw new Error(`native bearer ${NATIVE_BEARER}`);
        },
      },
    );

    for (const options of [
      accessorOptions,
      { transport: managedTransport, operation },
      proxyOptions,
    ]) {
      const error = (() => {
        try {
          createManagedCaveClient(options as unknown as {
            transport: CaveManagedCredentialTransport;
          });
        } catch (caught) {
          return caught;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(TypeError);
      expect(JSON.stringify({ error, inspect: inspect(error) })).not.toContain(NATIVE_BEARER);
    }
  });

  test('rejects native discovery records that Rust did not shape safely', async () => {
    const source: CaveManagedDiscoverySource = {
      read: () =>
        Promise.resolve({
          bytes: JSON.stringify({
            version: 1,
            endpoint: 'http://127.0.0.1:3020',
            pid: 4321,
            nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
            startedAt: '2026-08-24T02:03:51.419Z',
            secret: 'must-not-pass',
          }),
          record: {
            identity: 'tauri:owner-checked:client-v1-discovery',
            device: 0,
            inode: 0,
            processAlive: true,
          },
        }),
    };

    await expect(discoverManagedCaveEndpoint(source)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  test('rejects malformed UTF-8 and stale native discovery results', async () => {
    const record = {
      identity: 'tauri:owner-checked:client-v1-discovery',
      device: 0,
      inode: 0,
      processAlive: true,
    };
    const malformed: CaveManagedDiscoverySource = {
      read: () => Promise.resolve({ bytes: new Uint8Array([0xFF]), record }),
    };
    await expect(discoverManagedCaveEndpoint(malformed)).rejects.toMatchObject({
      code: 'invalid_response',
    });

    const stale: CaveManagedDiscoverySource = {
      read: () =>
        Promise.resolve({
          bytes: JSON.stringify({
            version: 1,
            endpoint: 'http://127.0.0.1:3020',
            pid: 4321,
            nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
            startedAt: '2026-08-24T02:03:51.419Z',
          }),
          record: { ...record, processAlive: false },
        }),
    };
    await expect(discoverManagedCaveEndpoint(stale)).rejects.toMatchObject({
      code: 'stale_record',
    });
  });

  test('sanitizes native discovery read failures before observer or error serialization', async () => {
    const events: unknown[] = [];
    const source: CaveManagedDiscoverySource = {
      read: () =>
        Promise.reject(
          Object.assign(new Error(`native bearer ${NATIVE_BEARER}`), {
            code: 'service_unavailable',
            details: { bearer: NATIVE_BEARER },
            cause: { bearer: NATIVE_BEARER },
          }),
        ),
    };
    const error = await discoverManagedCaveEndpoint(source, {
      observer: {
        onEvent(event) {
          events.push(event);
        },
        onObserverError(observerError) {
          throw observerError;
        },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'CaveDiscoveryError',
      code: 'invalid_response',
    });
    const serialized = JSON.stringify({
      error,
      inspect: inspect(error),
      events,
    }, error instanceof Error ? Object.getOwnPropertyNames(error) : undefined);
    expect(serialized).not.toContain(NATIVE_BEARER);
    expect(serialized).not.toMatch(/bearer/iu);
  });

  test.each([
    {
      label: 'ownKeys',
      value: () =>
        new Proxy({}, {
          ownKeys() {
            throw new Error(`native bearer ${NATIVE_BEARER}`);
          },
        }),
    },
    {
      label: 'getOwnPropertyDescriptor',
      value: () =>
        new Proxy({}, {
          getOwnPropertyDescriptor() {
            throw new Error(`native bearer ${NATIVE_BEARER}`);
          },
        }),
    },
    {
      label: 'getPrototypeOf after initial inspection',
      value: () => {
        let inspections = 0;
        return new Proxy({}, {
          getPrototypeOf() {
            inspections += 1;
            if (inspections === 1) {
              return Object.prototype;
            }
            throw new Error(`native bearer ${NATIVE_BEARER}`);
          },
        });
      },
    },
  ])('sanitizes hostile discovery $label proxies', async ({ value }) => {
    const events: unknown[] = [];
    const source: CaveManagedDiscoverySource = {
      read: () => Promise.resolve(value()),
    };
    const error = await discoverManagedCaveEndpoint(source, {
      observer: {
        onEvent(event) {
          events.push(event);
        },
        onObserverError(observerError) {
          throw observerError;
        },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'CaveDiscoveryError',
      code: 'invalid_response',
    });
    const serialized = JSON.stringify({
      string: String(error),
      inspect: inspect(error),
      error,
      events,
    }, error instanceof Error ? Object.getOwnPropertyNames(error) : undefined);
    expect(serialized).not.toContain(NATIVE_BEARER);
    expect(serialized).not.toMatch(/bearer/iu);
  });

  test('sanitizes abort and timeout control failures before caller or observer output', async () => {
    const events: unknown[] = [];
    const source: CaveManagedDiscoverySource = {
      read: () => new Promise(() => {}),
    };
    const controller = new AbortController();
    const aborted = discoverManagedCaveEndpoint(source, {
      signal: controller.signal,
      observer: {
        onEvent(event) {
          events.push(event);
        },
        onObserverError(error) {
          throw error;
        },
      },
    }).catch((caught: unknown) => caught);
    await Promise.resolve();
    controller.abort(new Error(`abort bearer ${NATIVE_BEARER}`));
    const abortError = await aborted;
    expect(abortError).toMatchObject({
      name: 'CaveDiscoveryError',
      code: 'aborted',
    });

    vi.useFakeTimers();
    const timedOut = discoverManagedCaveEndpoint(source, { timeoutMs: 10 }).catch(
      (caught: unknown) => caught,
    );
    await vi.advanceTimersByTimeAsync(10);
    const timeoutError = await timedOut;
    expect(timeoutError).toMatchObject({
      name: 'CaveDiscoveryError',
      code: 'timeout',
    });

    const serialized = JSON.stringify({
      abort: {
        string: String(abortError),
        inspect: inspect(abortError),
        error: abortError,
      },
      timeout: {
        string: String(timeoutError),
        inspect: inspect(timeoutError),
        error: timeoutError,
      },
      events,
    }, [
      'abort',
      'timeout',
      'string',
      'inspect',
      'error',
      'events',
      ...Object.getOwnPropertyNames(abortError),
      ...Object.getOwnPropertyNames(timeoutError),
    ]);
    expect(serialized).not.toContain(NATIVE_BEARER);
    expect(serialized).not.toMatch(/bearer/iu);
    expect(JSON.stringify(events)).toContain('"code":"aborted"');
  });
});
