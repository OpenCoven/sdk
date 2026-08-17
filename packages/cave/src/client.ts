import { normalizeError, type NormalizedError } from '@opencoven/sdk-core';

import type { CaveHealth, CaveHealthResponse } from './schemas.js';
import type { CaveTransport } from './transport.js';

export interface CaveClientOptions {
  transport: CaveTransport;
}

export function normalizeCaveError(error: unknown, operation: string): NormalizedError {
  return normalizeError(error, {
    system: 'cave',
    operation,
  });
}

export class CaveClientError extends Error {
  readonly normalized: NormalizedError;

  constructor(normalized: NormalizedError) {
    super(`${normalized.system}.${normalized.operation}: ${normalized.code}`);
    this.name = 'CaveClientError';
    this.normalized = normalized;
  }
}

function isCaveHealthResponse(response: unknown): response is CaveHealthResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }

  const data = (response as { data?: unknown }).data;

  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { status?: unknown }).status === 'ok'
  );
}

export class CaveClient {
  readonly #transport: CaveTransport;

  constructor(options: CaveClientOptions) {
    this.#transport = options.transport;
  }

  async health(): Promise<CaveHealth> {
    try {
      const response: unknown = await this.#transport.health();

      if (!isCaveHealthResponse(response)) {
        throw new CaveClientError(normalizeCaveError({ code: 'invalid_response' }, 'health'));
      }

      return response.data;
    } catch (error) {
      if (error instanceof CaveClientError) {
        throw error;
      }

      throw new CaveClientError(normalizeCaveError(error, 'health'));
    }
  }
}

export function createCaveClient(options: CaveClientOptions): CaveClient {
  return new CaveClient(options);
}
