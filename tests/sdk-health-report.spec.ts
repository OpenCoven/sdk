import { CaveClient, CaveClientError, type CaveHealth } from '@opencoven/cave-client';
import {
  COVEN_DAEMON_PROTOCOL,
  CovenClient,
  CovenClientError,
} from '@opencoven/coven-client';
import { OpenCovenSdkError, createOpenCovenSdk } from '@opencoven/sdk';
import { describe, expect, test } from 'vitest';

function createCaveClient(): CaveClient {
  return new CaveClient({
    transport: {
      health: () => Promise.resolve({ data: { status: 'ok' } }),
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
      cave: { status: 'ok' },
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
        health: { status: 'ok' },
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
    let resolveCave: ((value: { data: { status: 'ok' } }) => void) | undefined;
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

    resolveCave?.({ data: { status: 'ok' } });
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
        health: () => Promise.resolve({ data: { status: 'ok' } }),
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
});
