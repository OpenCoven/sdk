import {
  isOperationAbortedError,
  isOperationTimeoutError,
  normalizeError,
  runOperation,
  type NormalizedError,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core';

import {
  CovenIpcError,
  discoverCovenEndpoint,
  type DiscoverCovenEndpointOptions,
} from './discovery.js';
import { COVEN_DAEMON_PROTOCOL, type CovenHealth, type CovenHealthResponse } from './schemas.js';
import type { CovenTransport } from './transport.js';
import {
  createCovenUnixTransport,
  isCovenDaemonResponseError,
  type CovenDaemonFailure,
  type CovenUnixTransportOptions,
} from './transport-unix.js';
import {
  createCovenWindowsTransport,
  type CovenWindowsTransportOptions,
} from './transport-windows.js';

const COVEN_CLIENT_ERROR_BRAND = Symbol.for('@opencoven/coven-client/CovenClientError');

export interface CovenClientOptions {
  transport: CovenTransport;
  operation?: OperationDefaults;
}

export interface CovenDiscoveredClientOptions {
  discovery?: DiscoverCovenEndpointOptions;
  operation?: OperationDefaults;
  unix?: CovenUnixTransportOptions;
  windows?: CovenWindowsTransportOptions;
}

export function normalizeCovenError(error: unknown, operation: string): NormalizedError {
  return normalizeError(error, {
    system: 'coven',
    operation,
    message: `Coven ${operation} request failed`,
  });
}

export class CovenClientError extends Error {
  readonly normalized: NormalizedError;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;
  readonly daemon: CovenDaemonFailure | undefined;

  constructor(normalized: NormalizedError, options?: ErrorOptions) {
    super(`${normalized.system}.${normalized.operation}: ${normalized.code}`, options);
    this.name = 'CovenClientError';
    this.normalized = normalized;
    this.code = normalized.code;
    this.retryable = normalized.retryable;
    this.requestId = normalized.requestId;
    this.statusCode = normalized.statusCode;
    this.daemon = isCovenDaemonResponseError(options?.cause)
      ? options.cause.daemon
      : undefined;
    Object.defineProperty(this, COVEN_CLIENT_ERROR_BRAND, { value: true });
  }
}

export function isCovenClientError(error: unknown): error is CovenClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    return Reflect.get(error, COVEN_CLIENT_ERROR_BRAND) === true;
  } catch {
    return false;
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
  readonly #operation: OperationDefaults | undefined;

  constructor(options: CovenClientOptions) {
    this.#transport = options.transport;
    this.#operation = options.operation;
  }

  async health(options: OperationOptions = {}): Promise<CovenHealth> {
    const timeoutMs = options.timeoutMs ?? this.#operation?.timeoutMs;
    const observer = options.observer ?? this.#operation?.observer;
    const operationOptions: OperationOptions = {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(observer === undefined ? {} : { observer }),
    };

    try {
      return await runOperation(
        {
          system: 'coven',
          operation: 'health',
        },
        operationOptions,
        async (context) => {
          try {
            const response: unknown = await this.#transport.health(context);

            if (
              !validateHealthResponse(response) ||
              response.apiVersion !== COVEN_DAEMON_PROTOCOL
            ) {
              throw invalidHealthResponse();
            }

            return { status: 'ok' };
          } catch (error) {
            if (isCovenClientError(error)) {
              throw error;
            }

            throw new CovenClientError(normalizeCovenError(error, 'health'), {
              cause: error,
            });
          }
        },
      );
    } catch (error) {
      if (isCovenClientError(error)) {
        throw error;
      }

      if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
        throw new CovenClientError(normalizeCovenError(error, 'health'), {
          cause: error,
        });
      }

      throw error;
    }
  }
}

export function createCovenClient(options: CovenClientOptions): CovenClient {
  return new CovenClient(options);
}

export async function createDiscoveredCovenClient(
  options: CovenDiscoveredClientOptions = {},
): Promise<CovenClient> {
  const endpoint = await discoverCovenEndpoint(options.discovery);
  let transport: CovenTransport;

  if (endpoint.endpoint.kind === 'unix') {
    transport = createCovenUnixTransport(endpoint, options.unix);
  } else {
    if (options.windows === undefined) {
      throw new CovenIpcError(
        'unsafe_endpoint',
        'Windows named-pipe ownership validation is required.',
        { phase: 'validate_endpoint' },
      );
    }
    transport = createCovenWindowsTransport(endpoint, options.windows);
  }

  return new CovenClient({
    transport,
    ...(options.operation === undefined ? {} : { operation: options.operation }),
  });
}
