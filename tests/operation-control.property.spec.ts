import {
  assessCompatibility,
  createOperationScope,
  normalizeError,
  OperationConfigurationError,
  runOperation,
  type OperationEvent,
} from '@opencoven/sdk-core';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

const configuredSeed = Number(process.env.FAST_CHECK_SEED ?? '20260819');
if (!Number.isSafeInteger(configuredSeed)) {
  throw new TypeError('FAST_CHECK_SEED must be a safe integer');
}

fc.configureGlobal({
  seed: configuredSeed,
  numRuns: 500,
  endOnFailure: true,
});

const descriptor = {
  system: 'cave' as const,
  operation: 'health',
};

describe('operation control properties', () => {
  test('valid timeouts produce exactly one terminal outcome', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2_147_483_647 }), async (timeoutMs) => {
        const events: OperationEvent[] = [];

        await expect(
          runOperation(
            descriptor,
            {
              timeoutMs,
              observer: {
                onEvent(event) {
                  events.push(event);
                },
                onObserverError(error) {
                  throw error;
                },
              },
            },
            () => Promise.resolve('ok'),
          ),
        ).resolves.toBe('ok');
        expect(events.filter(({ phase }) => phase !== 'start')).toHaveLength(1);
      }),
    );
  });

  test('invalid timeouts always throw configuration errors', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.double({ noNaN: false, noDefaultInfinity: false }).filter(
            (value) =>
              !Number.isSafeInteger(value) ||
              value <= 0 ||
              value > 2_147_483_647,
          ),
          fc.integer({ min: 2_147_483_648, max: Number.MAX_SAFE_INTEGER }),
        ),
        (timeoutMs) => {
          expect(() => createOperationScope(descriptor, { timeoutMs })).toThrow(
            OperationConfigurationError,
          );
        },
      ),
    );
  });

  test('arbitrary error records never add unknown normalized keys', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (error) => {
        const normalized = normalizeError(error, descriptor);

        expect(Object.keys(normalized).every((key) =>
          [
            'system',
            'code',
            'retryable',
            'operation',
            'message',
            'requestId',
            'statusCode',
          ].includes(key),
        )).toBe(true);
      }),
    );
  });

  test('hostile allowlisted proxy traps never escape normalization', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('code', 'retryable', 'requestId', 'status', 'statusCode'),
        (hostileKey) => {
          const error = new Proxy(
            {
              code: 'offline',
              retryable: true,
              requestId: 'req',
              status: 503,
              statusCode: 503,
            },
            {
              get(target, key, receiver) {
                if (key === hostileKey) {
                  throw new Error('hostile getter');
                }
                const result: unknown = Reflect.get(target, key, receiver);
                return result;
              },
            },
          );

          expect(() => normalizeError(error, descriptor)).not.toThrow();
        },
      ),
    );
  });

  test('generated resolve reject abort and timeout races emit one terminal event', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('resolve', 'reject', 'abort', 'timeout'),
        async (outcome) => {
          const events: OperationEvent[] = [];
          const controller = new AbortController();
          const operation = runOperation(
            descriptor,
            {
              signal: controller.signal,
              ...(outcome === 'timeout' ? { timeoutMs: 1 } : {}),
              observer: {
                onEvent(event) {
                  events.push(event);
                },
                onObserverError(error) {
                  throw error;
                },
              },
            },
            () => {
              if (outcome === 'resolve') {
                return Promise.resolve('ok');
              }
              if (outcome === 'reject') {
                return Promise.reject(new Error('failed'));
              }
              return new Promise<never>(() => undefined);
            },
          );

          if (outcome === 'abort') {
            controller.abort();
          }

          await operation.catch(() => undefined);
          expect(events.filter(({ phase }) => phase !== 'start')).toHaveLength(1);
        },
      ),
    );
  });

  test('generated stable SemVer versions follow tuple precedence', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
        ),
        fc.tuple(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 0, max: 100 }),
        ),
        (minimum, client) => {
          const minimumVersion = minimum.join('.');
          const clientVersion = client.join('.');
          const expected =
            client[0] > minimum[0] ||
            (client[0] === minimum[0] &&
              (client[1] > minimum[1] ||
                (client[1] === minimum[1] && client[2] >= minimum[2])));

          expect(assessCompatibility(minimumVersion, clientVersion).compatible).toBe(
            expected,
          );
        },
      ),
    );
  });
});
