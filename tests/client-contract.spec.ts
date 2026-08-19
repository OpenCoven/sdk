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
});
