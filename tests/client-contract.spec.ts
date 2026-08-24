import * as cave from '@opencoven/cave-client';
import * as coven from '@opencoven/coven-client';
import type { OperationContext, OperationEvent } from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

interface HealthClient {
  health(): Promise<{ status: 'ok' }>;
}

interface ClientConstructor {
  new (options: { transport: unknown }): HealthClient;
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

  test('creates Cave health clients through the public factory', async () => {
    const client = cave.createCaveClient({
      transport: {
        health: () => Promise.resolve(VALID_CAVE_HEALTH_RESPONSE),
      },
    });

    await expect(client.health()).resolves.toEqual(VALID_CAVE_HEALTH);
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
