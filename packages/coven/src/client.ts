import { normalizeError, type NormalizedError } from '@opencoven/sdk-core';

import {
  COVEN_DAEMON_PROTOCOL,
  type CovenHealth,
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

export class CovenClient {
  readonly #transport: CovenTransport;

  constructor(options: CovenClientOptions) {
    this.#transport = options.transport;
  }

  async health(): Promise<CovenHealth> {
    try {
      const response = await this.#transport.health();

      if (!response.ok || response.apiVersion !== COVEN_DAEMON_PROTOCOL) {
        throw new Error('Invalid Coven health response.');
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
