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

function asErrorShape(value: unknown): object | undefined {
  return typeof value === 'object' && value !== null ? value : undefined;
}

function safeGet(value: object | undefined, key: PropertyKey): unknown {
  if (value === undefined) {
    return undefined;
  }

  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
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
  const shapeCode = safeGet(shape, 'code');
  const shapeRequestId = safeGet(shape, 'requestId');
  const shapeRetryable = safeGet(shape, 'retryable');
  const shapeStatusCode = safeGet(shape, 'statusCode');
  const shapeStatus = safeGet(shape, 'status');
  const code =
    typeof shapeCode === 'string' && shapeCode.length > 0
      ? shapeCode
      : (options.defaultCode ?? 'unknown');
  const requestId = asRequestId(shapeRequestId);
  const statusCode = asStatusCode(shapeStatusCode) ?? asStatusCode(shapeStatus);

  return {
    system: options.system,
    code,
    retryable:
      typeof shapeRetryable === 'boolean' ? shapeRetryable : (options.retryable ?? false),
    operation: options.operation,
    ...(options.message === undefined ? {} : { message: options.message }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(statusCode === undefined ? {} : { statusCode }),
  };
}
