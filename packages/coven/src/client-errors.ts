import { normalizeError, type NormalizedError } from '@opencoven/sdk-core';

import { daemonFailureFromError, type CovenDaemonFailure } from './transport-unix.js';

const COVEN_CLIENT_ERROR_BRAND = Symbol.for('@opencoven/coven-client/CovenClientError');

function ownDataErrorShape(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const shape: Record<string, unknown> = {};
    for (const key of [
      'code',
      'requestId',
      'retryable',
      'status',
      'statusCode',
    ] as const) {
      const descriptor = descriptors[key];
      if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
        shape[key] = descriptor.value;
      }
    }
    return shape;
  } catch {
    return {};
  }
}

export function normalizeCovenError(error: unknown, operation: string): NormalizedError {
  return normalizeError(ownDataErrorShape(error), {
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
    this.daemon = daemonFailureFromError(options?.cause);
    Object.defineProperty(this, COVEN_CLIENT_ERROR_BRAND, { value: true });
  }
}

export function isCovenClientError(error: unknown): error is CovenClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      error,
      COVEN_CLIENT_ERROR_BRAND,
    );
    return descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === true;
  } catch {
    return false;
  }
}
