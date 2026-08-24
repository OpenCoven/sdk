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
              health: () => Promise.resolve({ data: { status: 'ok' } }),
            },
          });

    const response =
      client !== undefined && typeof client.health === 'function'
        ? client.health()
        : Promise.resolve(undefined);

    await expect(response).resolves.toEqual({ status: 'ok' });
  });

  test('creates Cave health clients through the public factory', async () => {
    const client = cave.createCaveClient({
      transport: {
        health: () => Promise.resolve({ data: { status: 'ok' } }),
      },
    });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
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
        health: () => Promise.resolve({ data: { status: 'ok' as const } }),
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
    expect(pairingExchange).not.toHaveBeenCalled();
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
      health: () => Promise.resolve({ data: { status: 'ok' as const } }),
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

    await expect(new cave.CaveClient({ transport: caveTransport }).health()).resolves.toEqual({
      status: 'ok',
    });
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
          return Promise.resolve({ data: { status: 'ok' } });
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
          return Promise.resolve({ data: { status: 'ok' } });
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
