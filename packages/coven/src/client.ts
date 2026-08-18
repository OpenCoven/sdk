import { normalizeError, type NormalizedError } from '@opencoven/sdk-core';

import { COVEN_DAEMON_PROTOCOL, type CovenHealth, type CovenHealthResponse } from './schemas.js';
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidHealthResponse(): CovenClientError {
  return new CovenClientError(
    normalizeCovenError(
      {
        code: 'invalid_response',
      },
      'health',
    ),
  );
}

function validateCapabilities(value: unknown): value is CovenHealthResponse['capabilities'] {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.sessions === 'boolean' &&
    typeof value.events === 'boolean' &&
    (value.eventCursor === undefined || typeof value.eventCursor === 'string') &&
    value.structuredErrors === true
  );
}

function validateHealthResponse(response: unknown): response is CovenHealthResponse {
  if (!isObject(response)) {
    return false;
  }

  if (response.ok !== true) {
    return false;
  }

  if (typeof response.apiVersion !== 'string' || typeof response.covenVersion !== 'string') {
    return false;
  }

  return validateCapabilities(response.capabilities);
}

export class CovenClient {
  readonly #transport: CovenTransport;

  constructor(options: CovenClientOptions) {
    this.#transport = options.transport;
  }

  async health(): Promise<CovenHealth> {
    try {
      const response: unknown = await this.#transport.health();

      if (!validateHealthResponse(response) || response.apiVersion !== COVEN_DAEMON_PROTOCOL) {
        throw invalidHealthResponse();
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
