import * as cave from '@opencoven/cave-client';
import * as coven from '@opencoven/coven-client';
import { describe, expect, test } from 'vitest';

interface HealthClient {
  health(): Promise<{ status: 'ok' }>;
}

interface ClientConstructor {
  new (options: { transport: unknown }): HealthClient;
}

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
});
