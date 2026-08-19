import {
  assessCompatibility,
  isOperationAbortedError,
  isOperationTimeoutError,
  normalizeError,
  runOperation,
  type CompatibilityAssessment,
  type NormalizedError,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core';

import type { CaveHealth } from './schemas.js';
import type { CaveHealthResponse } from './schemas.js';
import type { CaveTransport } from './transport.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const CAVE_CLIENT_ERROR_BRAND = Symbol.for('@opencoven/cave-client/CaveClientError');

export interface CaveClientOptions {
  transport: CaveTransport;
  operation?: OperationDefaults;
}

export function normalizeCaveError(error: unknown, operation: string): NormalizedError {
  return normalizeError(error, {
    system: 'cave',
    operation,
    message: `Cave ${operation} request failed`,
  });
}

export class CaveClientError extends Error {
  readonly normalized: NormalizedError;
  readonly compatibility: CompatibilityAssessment | undefined;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;

  constructor(
    normalized: NormalizedError,
    compatibility?: CompatibilityAssessment,
    options?: ErrorOptions,
  ) {
    const suffix =
      compatibility === undefined
        ? ''
        : ` (minimum ${compatibility.minimumClientVersion}, client ${compatibility.clientVersion})`;

    super(`${normalized.system}.${normalized.operation}: ${normalized.code}${suffix}`, options);
    this.name = 'CaveClientError';
    this.normalized = normalized;
    this.compatibility = compatibility;
    this.code = normalized.code;
    this.retryable = normalized.retryable;
    this.requestId = normalized.requestId;
    this.statusCode = normalized.statusCode;
    Object.defineProperty(this, CAVE_CLIENT_ERROR_BRAND, { value: true });
  }
}

export function isCaveClientError(error: unknown): error is CaveClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    return Reflect.get(error, CAVE_CLIENT_ERROR_BRAND) === true;
  } catch {
    return false;
  }
}

const CAVE_API_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SUPPORTED_CAVE_API_MAJOR = '1';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidHealthResponse(): CaveClientError {
  return new CaveClientError(
    normalizeCaveError(
      {
        code: 'invalid_response',
      },
      'health',
    ),
  );
}

function validateHealthResponse(response: unknown): response is CaveHealthResponse {
  if (!isObject(response)) {
    return false;
  }

  if (response.apiVersion !== undefined && typeof response.apiVersion !== 'string') {
    return false;
  }

  if (response.minimumClientVersion !== undefined && typeof response.minimumClientVersion !== 'string') {
    return false;
  }

  if (response.requestId !== undefined && typeof response.requestId !== 'string') {
    return false;
  }

  if (!isObject(response.data)) {
    return false;
  }

  return response.data.status === 'ok';
}

export class CaveClient {
  readonly #transport: CaveTransport;
  readonly #operation: OperationDefaults | undefined;

  constructor(options: CaveClientOptions) {
    this.#transport = options.transport;
    this.#operation = options.operation;
  }

  async health(options: OperationOptions = {}): Promise<CaveHealth> {
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
          system: 'cave',
          operation: 'health',
        },
        operationOptions,
        async (context) => {
          try {
            const response: unknown = await this.#transport.health(context);

            if (!validateHealthResponse(response)) {
              throw invalidHealthResponse();
            }

            if (response.minimumClientVersion !== undefined) {
              let compatibility: CompatibilityAssessment;

              try {
                compatibility = assessCompatibility(
                  response.minimumClientVersion,
                  CAVE_CLIENT_VERSION,
                );
              } catch {
                throw invalidHealthResponse();
              }

              if (!compatibility.compatible) {
                throw new CaveClientError(
                  normalizeCaveError(
                    {
                      code: 'incompatible_version',
                    },
                    'health',
                  ),
                  compatibility,
                );
              }
            }

            if (response.apiVersion !== undefined) {
              if (!CAVE_API_VERSION_PATTERN.test(response.apiVersion)) {
                throw invalidHealthResponse();
              }

              if (response.apiVersion.split('.')[0] !== SUPPORTED_CAVE_API_MAJOR) {
                throw new CaveClientError(
                  normalizeCaveError(
                    {
                      code: 'incompatible_version',
                    },
                    'health',
                  ),
                );
              }
            }

            return response.data;
          } catch (error) {
            if (isCaveClientError(error)) {
              throw error;
            }

            throw new CaveClientError(normalizeCaveError(error, 'health'), undefined, {
              cause: error,
            });
          }
        },
      );
    } catch (error) {
      if (isCaveClientError(error)) {
        throw error;
      }

      if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
        throw new CaveClientError(normalizeCaveError(error, 'health'), undefined, {
          cause: error,
        });
      }

      throw error;
    }
  }
}

export function createCaveClient(options: CaveClientOptions): CaveClient {
  return new CaveClient(options);
}
