export type OpenCovenSystem = 'cave' | 'coven' | 'sdk' | 'cli';

export interface NormalizedError {
  system: OpenCovenSystem;
  code: string;
  retryable: boolean;
  operation: string;
  message?: string;
  requestId?: string;
  statusCode?: number;
}

export interface NormalizeErrorOptions {
  system: OpenCovenSystem;
  operation: string;
  defaultCode?: string;
  retryable?: boolean;
  message?: string;
}

interface ErrorShape {
  code?: unknown;
  requestId?: unknown;
  retryable?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

function asErrorShape(value: unknown): ErrorShape | undefined {
  return typeof value === 'object' && value !== null ? value : undefined;
}

function asRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asStatusCode(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

export function normalizeError(error: unknown, options: NormalizeErrorOptions): NormalizedError {
  const shape = asErrorShape(error);
  const code =
    typeof shape?.code === 'string' && shape.code.length > 0
      ? shape.code
      : (options.defaultCode ?? 'unknown');
  const requestId = asRequestId(shape?.requestId);
  const statusCode = asStatusCode(shape?.statusCode) ?? asStatusCode(shape?.status);

  return {
    system: options.system,
    code,
    retryable: typeof shape?.retryable === 'boolean' ? shape.retryable : (options.retryable ?? false),
    operation: options.operation,
    ...(options.message === undefined ? {} : { message: options.message }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(statusCode === undefined ? {} : { statusCode }),
  };
}
