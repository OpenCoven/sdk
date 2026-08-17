import {
  assessCompatibility,
  normalizeError,
  type CompatibilityAssessment,
  type NormalizedError,
} from '@opencoven/sdk-core';

import type { CaveHealth } from './schemas.js';
import type { CaveHealthResponse } from './schemas.js';
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
  readonly compatibility: CompatibilityAssessment | undefined;

  constructor(normalized: NormalizedError, compatibility?: CompatibilityAssessment) {
    const suffix =
      compatibility === undefined
        ? ''
        : ` (minimum ${compatibility.minimumClientVersion}, client ${compatibility.clientVersion})`;

    super(`${normalized.system}.${normalized.operation}: ${normalized.code}${suffix}`);
    this.name = 'CaveClientError';
    this.normalized = normalized;
    this.compatibility = compatibility;
  }
}

const CAVE_CLIENT_VERSION = '0.1.0' as const;
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

  constructor(options: CaveClientOptions) {
    this.#transport = options.transport;
  }

  async health(): Promise<CaveHealth> {
    try {
      const response = await this.#transport.health();

      if (!validateHealthResponse(response)) {
        throw invalidHealthResponse();
      }

      if (response.minimumClientVersion !== undefined) {
        let compatibility: CompatibilityAssessment;

        try {
          compatibility = assessCompatibility(response.minimumClientVersion, CAVE_CLIENT_VERSION);
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
