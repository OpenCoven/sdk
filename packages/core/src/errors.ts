export type OpenCovenSystem = 'cave' | 'coven' | 'sdk' | 'cli';

export interface NormalizedError {
  system: OpenCovenSystem;
  code: string;
  retryable: boolean;
  operation: string;
}

export interface NormalizeErrorOptions {
  system: OpenCovenSystem;
  operation: string;
  defaultCode?: string;
  retryable?: boolean;
}

interface ErrorShape {
  code?: unknown;
  retryable?: unknown;
}

function asErrorShape(value: unknown): ErrorShape | undefined {
  return typeof value === 'object' && value !== null ? value : undefined;
}

export function normalizeError(error: unknown, options: NormalizeErrorOptions): NormalizedError {
  const shape = asErrorShape(error);
  const code =
    typeof shape?.code === 'string' && shape.code.length > 0
      ? shape.code
      : (options.defaultCode ?? 'unknown');

  return {
    system: options.system,
    code,
    retryable: typeof shape?.retryable === 'boolean' ? shape.retryable : (options.retryable ?? false),
    operation: options.operation,
  };
}
