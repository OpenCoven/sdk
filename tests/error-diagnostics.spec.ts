import { CaveClient, CaveClientError } from '@opencoven/cave-client';
import { CovenClient, CovenClientError } from '@opencoven/coven-client';
import { normalizeError } from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

describe('safe error diagnostics', () => {
  test('includes only SDK-authored messages and allowlisted scalar metadata', () => {
    const normalized = normalizeError(
      {
        code: 'unavailable',
        message: 'transport secret must not be copied',
        requestId: 'req-123',
        retryable: true,
        statusCode: 503,
      },
      {
        system: 'cave',
        operation: 'health',
        message: 'Cave health request failed',
      },
    );

    expect(normalized).toEqual({
      system: 'cave',
      code: 'unavailable',
      retryable: true,
      operation: 'health',
      message: 'Cave health request failed',
      requestId: 'req-123',
      statusCode: 503,
    });
  });

  test('accepts status as a fallback and rejects invalid optional metadata', () => {
    expect(
      normalizeError(
        {
          requestId: '   ',
          statusCode: 99,
          status: 429,
        },
        {
          system: 'coven',
          operation: 'health',
        },
      ),
    ).toEqual({
      system: 'coven',
      code: 'unknown',
      retryable: false,
      operation: 'health',
      statusCode: 429,
    });

    expect(
      normalizeError(
        {
          requestId: 123,
          status: 600,
        },
        {
          system: 'coven',
          operation: 'health',
        },
      ),
    ).toEqual({
      system: 'coven',
      code: 'unknown',
      retryable: false,
      operation: 'health',
    });
  });

  test('preserves Cave transport failures as native causes', async () => {
    const transportError = Object.assign(new Error('socket closed'), {
      code: 'unavailable',
      requestId: 'req-cave',
      retryable: true,
      statusCode: 503,
    });
    const client = new CaveClient({
      transport: {
        health: () => Promise.reject(transportError),
      },
    });

    const error: unknown = await client.health().catch((caught: unknown) => caught);

    if (!(error instanceof CaveClientError)) {
      throw new TypeError('Expected CaveClientError.');
    }

    expect(error.cause).toBe(transportError);
    expect(error.normalized).toEqual({
      system: 'cave',
      code: 'unavailable',
      retryable: true,
      operation: 'health',
      message: 'Cave health request failed',
      requestId: 'req-cave',
      statusCode: 503,
    });
  });

  test('preserves Coven transport failures as native causes', async () => {
    const transportError = Object.assign(new Error('daemon unavailable'), {
      code: 'unavailable',
      requestId: 'req-coven',
      status: 502,
    });
    const client = new CovenClient({
      transport: {
        health: () => Promise.reject(transportError),
      },
    });

    const error: unknown = await client.health().catch((caught: unknown) => caught);

    if (!(error instanceof CovenClientError)) {
      throw new TypeError('Expected CovenClientError.');
    }

    expect(error.cause).toBe(transportError);
    expect(error.normalized).toEqual({
      system: 'coven',
      code: 'unavailable',
      retryable: false,
      operation: 'health',
      message: 'Coven health request failed',
      requestId: 'req-coven',
      statusCode: 502,
    });
  });
});
