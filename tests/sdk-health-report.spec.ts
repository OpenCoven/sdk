import {
  CaveClient,
  CaveClientError,
  isCaveClientError,
  type CaveHealth,
  type CaveHealthResponse,
} from '@opencoven/cave-client';
import {
  COVEN_DAEMON_PROTOCOL,
  CovenClient,
  CovenClientError,
  isCovenClientError,
} from '@opencoven/coven-client';
import {
  OpenCovenSdkError,
  createOpenCovenSdk,
  type OpenCovenHealthOptions,
} from '@opencoven/sdk';
import type { OperationEvent } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

interface DuplicateCaveModule {
  CaveClient: typeof CaveClient;
}

interface DuplicateCovenModule {
  CovenClient: typeof CovenClient;
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
} as const satisfies CaveHealthResponse;

const VALID_CAVE_HEALTH = {
  status: 'ok',
  apiVersion: VALID_CAVE_HEALTH_RESPONSE.apiVersion,
  minimumClientVersion: VALID_CAVE_HEALTH_RESPONSE.minimumClientVersion,
  capabilities: VALID_CAVE_HEALTH_RESPONSE.capabilities,
  operations: VALID_CAVE_HEALTH_RESPONSE.operations,
  instanceId: VALID_CAVE_HEALTH_RESPONSE.data.instanceId,
  pairingRequired: VALID_CAVE_HEALTH_RESPONSE.data.pairingRequired,
  releaseVersion: VALID_CAVE_HEALTH_RESPONSE.data.releaseVersion,
} as const satisfies CaveHealth;

function createCaveClient(): CaveClient {
  return new CaveClient({
    transport: {
      health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
    },
  });
}

function createCovenClient(): CovenClient {
  return new CovenClient({
    transport: {
      health: () =>
        Promise.resolve({
          ok: true,
          apiVersion: COVEN_DAEMON_PROTOCOL,
          covenVersion: '0.1.0',
          capabilities: {
            sessions: true,
            events: true,
            structuredErrors: true,
          },
        }),
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('unified health reporting', () => {
  test('reports availability and requires configured clients', () => {
    const cave = createCaveClient();
    const coven = createCovenClient();
    const configured = createOpenCovenSdk({ cave, coven });
    const empty = createOpenCovenSdk({});

    expect(configured.availability()).toEqual({ cave: true, coven: true });
    expect(configured.requireCave()).toBe(cave);
    expect(configured.requireCoven()).toBe(coven);
    expect(empty.availability()).toEqual({ cave: false, coven: false });
    expect(() => empty.requireCave()).toThrow(OpenCovenSdkError);
    expect(() => empty.requireCoven()).toThrow(OpenCovenSdkError);
  });

  test('preserves the existing configured health response', async () => {
    const sdk = createOpenCovenSdk({
      cave: createCaveClient(),
      coven: createCovenClient(),
    });

    await expect(createOpenCovenSdk({}).health()).resolves.toEqual({});
    await expect(sdk.health()).resolves.toEqual({
      cave: VALID_CAVE_HEALTH,
      coven: { status: 'ok' },
    });
  });

  test('reports unconfigured clients explicitly', async () => {
    await expect(createOpenCovenSdk({}).healthReport()).resolves.toEqual({
      cave: { status: 'not_configured' },
      coven: { status: 'not_configured' },
    });
  });

  test('reports both configured clients as healthy', async () => {
    const sdk = createOpenCovenSdk({
      cave: createCaveClient(),
      coven: createCovenClient(),
    });

    await expect(sdk.healthReport()).resolves.toEqual({
      cave: {
        status: 'healthy',
        health: VALID_CAVE_HEALTH,
      },
      coven: {
        status: 'healthy',
        health: { status: 'ok' },
      },
    });
  });

  test('preserves one client failure while reporting the other client', async () => {
    const sdk = createOpenCovenSdk({
      cave: new CaveClient({
        transport: {
          health: () => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })),
        },
      }),
      coven: createCovenClient(),
    });

    const report = await sdk.healthReport();

    expect(report.cave.status).toBe('unhealthy');
    if (report.cave.status === 'unhealthy') {
      expect(report.cave.error).toBeInstanceOf(CaveClientError);
      expect(report.cave.error.normalized).toMatchObject({
        system: 'cave',
        operation: 'health',
        code: 'offline',
      });
    }
    expect(report.coven).toEqual({
      status: 'healthy',
      health: { status: 'ok' },
    });
  });

  test('starts configured checks concurrently', async () => {
    let caveStarted = false;
    let covenStarted = false;
    let resolveCave: ((value: CaveHealthResponse) => void) | undefined;
    let resolveCoven:
      | ((value: {
          ok: true;
          apiVersion: typeof COVEN_DAEMON_PROTOCOL;
          covenVersion: string;
          capabilities: {
            sessions: boolean;
            events: boolean;
            structuredErrors: true;
          };
        }) => void)
      | undefined;

    const cave = new CaveClient({
      transport: {
        health: () =>
          new Promise((resolve) => {
            caveStarted = true;
            resolveCave = resolve;
          }),
      },
    });
    const coven = new CovenClient({
      transport: {
        health: () =>
          new Promise((resolve) => {
            covenStarted = true;
            resolveCoven = resolve;
          }),
      },
    });

    const reportPromise = createOpenCovenSdk({ cave, coven }).healthReport();

    expect(caveStarted).toBe(true);
    expect(covenStarted).toBe(true);

    resolveCave?.(VALID_CAVE_HEALTH_RESPONSE);
    resolveCoven?.({
      ok: true,
      apiVersion: COVEN_DAEMON_PROTOCOL,
      covenVersion: '0.1.0',
      capabilities: {
        sessions: true,
        events: true,
        structuredErrors: true,
      },
    });

    await expect(reportPromise).resolves.toMatchObject({
      cave: { status: 'healthy' },
      coven: { status: 'healthy' },
    });
  });

  test('rethrows unexpected invariant failures', async () => {
    class InvalidCaveClient extends CaveClient {
      override health(): Promise<CaveHealth> {
        throw new TypeError('broken client invariant');
      }
    }

    const cave = new InvalidCaveClient({
      transport: {
        health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      },
    });

    await expect(createOpenCovenSdk({ cave }).healthReport()).rejects.toThrow(
      'broken client invariant',
    );
  });

  test('uses the Coven client error type for Coven failures', async () => {
    const sdk = createOpenCovenSdk({
      coven: new CovenClient({
        transport: {
          health: () => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })),
        },
      }),
    });

    const report = await sdk.healthReport();

    expect(report.coven.status).toBe('unhealthy');
    if (report.coven.status === 'unhealthy') {
      expect(report.coven.error).toBeInstanceOf(CovenClientError);
    }
  });

  test('recognizes Cave errors from a duplicate client module instance', async () => {
    const duplicateModuleUrl = new URL(
      `../packages/cave/src/client.ts?duplicate=${Date.now()}`,
      import.meta.url,
    ).href;
    const duplicateCave = (await import(
      /* @vite-ignore */ duplicateModuleUrl
    )) as DuplicateCaveModule;
    const cave = new duplicateCave.CaveClient({
      transport: {
        health: () => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })),
      },
    });

    const report = await createOpenCovenSdk({ cave }).healthReport();

    expect(report.cave.status).toBe('unhealthy');
    if (report.cave.status === 'unhealthy') {
      expect(report.cave.error.normalized.code).toBe('offline');
    }
  });

  test('recognizes Coven errors from a duplicate client module instance', async () => {
    const duplicateModuleUrl = new URL(
      `../packages/coven/src/client.ts?duplicate=${Date.now()}`,
      import.meta.url,
    ).href;
    const duplicateCoven = (await import(
      /* @vite-ignore */ duplicateModuleUrl
    )) as DuplicateCovenModule;
    const coven = new duplicateCoven.CovenClient({
      transport: {
        health: () => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })),
      },
    });

    const report = await createOpenCovenSdk({ coven }).healthReport();

    expect(report.coven.status).toBe('unhealthy');
    if (report.coven.status === 'unhealthy') {
      expect(report.coven.error.normalized.code).toBe('offline');
    }
  });

  test('rejects hostile error-brand proxies without escaping', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter');
        },
      },
    );

    expect(isCaveClientError(hostile)).toBe(false);
    expect(isCovenClientError(hostile)).toBe(false);
  });

  test('uses one global timeout as the complete sequential health budget', async () => {
    vi.useFakeTimers();
    let covenStarted = false;
    const sdk = createOpenCovenSdk({
      cave: new CaveClient({
        transport: {
          health: () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve(VALID_CAVE_HEALTH_RESPONSE);
              }, 30);
            }),
        },
      }),
      coven: new CovenClient({
        transport: {
          health: () => {
            covenStarted = true;
            return new Promise<never>(() => undefined);
          },
        },
      }),
    });
    const result = sdk.health({ timeoutMs: 50 });
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30);
    expect(covenStarted).toBe(true);
    await vi.advanceTimersByTimeAsync(20);

    const error = await caught;
    expect(error).toBeInstanceOf(CovenClientError);
    expect(error).toMatchObject({
      normalized: {
        code: 'timeout',
        retryable: true,
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('prevents a later sequential client from starting after global abort', async () => {
    const controller = new AbortController();
    let covenStarted = false;
    const sdk = createOpenCovenSdk({
      cave: new CaveClient({
        transport: {
          health: () => new Promise<never>(() => undefined),
        },
      }),
      coven: new CovenClient({
        transport: {
          health: () => {
            covenStarted = true;
            return Promise.resolve({
              ok: true,
              apiVersion: COVEN_DAEMON_PROTOCOL,
              covenVersion: '0.1.0',
              capabilities: {
                sessions: true,
                events: true,
                structuredErrors: true,
              },
            });
          },
        },
      }),
    });
    const result = sdk.health({ signal: controller.signal });

    controller.abort();

    await expect(result).rejects.toMatchObject({
      normalized: {
        system: 'cave',
        code: 'aborted',
      },
    });
    expect(covenStarted).toBe(false);
  });

  test('retains a healthy report peer when the other client times out', async () => {
    vi.useFakeTimers();
    const sdk = createOpenCovenSdk({
      cave: new CaveClient({
        transport: {
          health: () => new Promise<never>(() => undefined),
        },
      }),
      coven: createCovenClient(),
    });
    const report = sdk.healthReport({
      timeoutMs: 100,
      cave: { timeoutMs: 10 },
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(report).resolves.toMatchObject({
      cave: {
        status: 'unhealthy',
        error: {
          normalized: {
            code: 'timeout',
          },
        },
      },
      coven: {
        status: 'healthy',
        health: { status: 'ok' },
      },
    });
  });

  test('applies a shared global timeout to all concurrent checks', async () => {
    vi.useFakeTimers();
    const sdk = createOpenCovenSdk({
      cave: new CaveClient({
        transport: {
          health: () => new Promise<never>(() => undefined),
        },
      }),
      coven: new CovenClient({
        transport: {
          health: () => new Promise<never>(() => undefined),
        },
      }),
    });
    const report = sdk.healthReport({ timeoutMs: 20 });
    const settled = report.then((value) => value);

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(20);

    await expect(settled).resolves.toMatchObject({
      cave: {
        status: 'unhealthy',
        error: { normalized: { code: 'timeout' } },
      },
      coven: {
        status: 'unhealthy',
        error: { normalized: { code: 'timeout' } },
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('limits a per-client abort to that report entry', async () => {
    const caveController = new AbortController();
    const options: OpenCovenHealthOptions = {
      cave: { signal: caveController.signal },
    };
    const sdk = createOpenCovenSdk({
      cave: new CaveClient({
        transport: {
          health: () => new Promise<never>(() => undefined),
        },
      }),
      coven: createCovenClient(),
    });
    const report = sdk.healthReport(options);

    caveController.abort();

    await expect(report).resolves.toMatchObject({
      cave: {
        status: 'unhealthy',
        error: { normalized: { code: 'aborted' } },
      },
      coven: {
        status: 'healthy',
      },
    });
  });

  test('forwards only system-specific lifecycle events', async () => {
    const events: OperationEvent[] = [];
    const sdk = createOpenCovenSdk({
      cave: createCaveClient(),
      coven: createCovenClient(),
    });

    await sdk.healthReport({
      observer: {
        onEvent(event) {
          events.push(event);
        },
        onObserverError(error) {
          throw error;
        },
      },
    });

    expect(events).toHaveLength(4);
    expect(new Set(events.map(({ system }) => system))).toEqual(
      new Set(['cave', 'coven']),
    );
    expect(events.some(({ system }) => system === 'sdk')).toBe(false);
  });

  test('enforces a global budget when a source-compatible client override ignores options', async () => {
    vi.useFakeTimers();
    class NonCooperativeCaveClient extends CaveClient {
      override health(): Promise<CaveHealth> {
        return new Promise<never>(() => undefined);
      }
    }
    const sdk = createOpenCovenSdk({
      cave: new NonCooperativeCaveClient({
        transport: {
          health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
        },
      }),
    });
    const result = sdk.health({ timeoutMs: 10 });
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(await caught).toMatchObject({
      normalized: {
        system: 'cave',
        code: 'timeout',
      },
    });
  });

  test('reports timeout for a non-cooperative client override', async () => {
    vi.useFakeTimers();
    class NonCooperativeCovenClient extends CovenClient {
      override health(): Promise<{ status: 'ok' }> {
        return new Promise<never>(() => undefined);
      }
    }
    const sdk = createOpenCovenSdk({
      cave: createCaveClient(),
      coven: new NonCooperativeCovenClient({
        transport: {
          health: () =>
            Promise.resolve({
              ok: true,
              apiVersion: COVEN_DAEMON_PROTOCOL,
              covenVersion: '0.1.0',
              capabilities: {
                sessions: true,
                events: true,
                structuredErrors: true,
              },
            }),
        },
      }),
    });
    const report = sdk.healthReport({
      coven: { timeoutMs: 15 },
    });

    await vi.advanceTimersByTimeAsync(15);

    await expect(report).resolves.toMatchObject({
      cave: { status: 'healthy' },
      coven: {
        status: 'unhealthy',
        error: {
          normalized: {
            system: 'coven',
            code: 'timeout',
          },
        },
      },
    });
  });
});
