import { normalizeError, type NormalizedError } from '@opencoven/sdk-core';

import {
  COVEN_DAEMON_PROTOCOL,
  type CovenHealth,
  type CovenHealthResponse,
} from './schemas.js';
import type { CovenTransport } from './transport.js';

export interface CovenClientOptions {
  transport: CovenTransport;
}

export function normalizeCovenError(error: unknown, operation: string): NormalizedError {
  return normalizeError(error, {
    system: 'coven',
    operation,
  });
}

export class CovenClientError extends Error {
  readonly normalized: NormalizedError;

  constructor(normalized: NormalizedError) {
    super(`${normalized.system}.${normalized.operation}: ${normalized.code}`);
    this.name = 'CovenClientError';
    this.normalized = normalized;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function isCovenHealthResponse(response: unknown): response is CovenHealthResponse {
  const responseRecord = asRecord(response);
  const capabilities = asRecord(responseRecord?.capabilities);

  return (
    responseRecord?.ok === true &&
    responseRecord.apiVersion === COVEN_DAEMON_PROTOCOL &&
    typeof responseRecord.covenVersion === 'string' &&
    typeof capabilities?.sessions === 'boolean' &&
    typeof capabilities.events === 'boolean' &&
    typeof capabilities.eventCursor === 'string' &&
    typeof capabilities.structuredErrors === 'boolean'
  );
}

export class CovenClient {
  readonly #transport: CovenTransport;

  constructor(options: CovenClientOptions) {
    this.#transport = options.transport;
  }

  async health(): Promise<CovenHealth> {
    try {
      const response: unknown = await this.#transport.health();

      if (!isCovenHealthResponse(response)) {
        throw new CovenClientError(normalizeCovenError({ code: 'invalid_response' }, 'health'));
      }

      return { status: 'ok' };
    } catch (error) {
      if (error instanceof CovenClientError) {
        throw error;
      }

      throw new CovenClientError(normalizeCovenError(error, 'health'));
    }
  }
}

export function createCovenClient(options: CovenClientOptions): CovenClient {
  return new CovenClient(options);
}
