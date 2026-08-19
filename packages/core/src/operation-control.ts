import type { OpenCovenSystem } from './errors.js';

const MAX_TIMEOUT_MS = 2_147_483_647;
const OPERATION_TIMEOUT_ERROR_BRAND = Symbol.for(
  '@opencoven/sdk-core/OperationTimeoutError',
);
const OPERATION_ABORTED_ERROR_BRAND = Symbol.for(
  '@opencoven/sdk-core/OperationAbortedError',
);

export interface OperationDescriptor {
  system: OpenCovenSystem;
  operation: string;
}

export interface OperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface OperationDefaults {
  timeoutMs?: number;
}

export interface OperationContext {
  signal: AbortSignal;
  deadline: number | undefined;
}

export interface OperationScopeOptions {
  signals?: readonly AbortSignal[];
  timeoutMs?: number;
}

export interface OperationScope {
  readonly context: OperationContext;
  readonly termination: Promise<never>;
  dispose(): void;
}

export class OperationTimeoutError extends Error {
  readonly code = 'timeout';
  readonly retryable = true;

  constructor(descriptor: OperationDescriptor, timeoutMs: number) {
    super(`${descriptor.system}.${descriptor.operation} timed out after ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
    Object.defineProperty(this, OPERATION_TIMEOUT_ERROR_BRAND, { value: true });
  }
}

export class OperationAbortedError extends Error {
  readonly code = 'aborted';
  readonly retryable = false;

  constructor(descriptor: OperationDescriptor, options?: ErrorOptions) {
    super(`${descriptor.system}.${descriptor.operation} was aborted`, options);
    this.name = 'OperationAbortedError';
    Object.defineProperty(this, OPERATION_ABORTED_ERROR_BRAND, { value: true });
  }
}

export class OperationConfigurationError extends TypeError {
  readonly code = 'invalid_options';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'OperationConfigurationError';
  }
}

function safelyRead(value: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function hasBrand(error: unknown, brand: symbol): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    safelyRead(error, brand) === true
  );
}

export function isOperationTimeoutError(error: unknown): error is OperationTimeoutError {
  return hasBrand(error, OPERATION_TIMEOUT_ERROR_BRAND);
}

export function isOperationAbortedError(error: unknown): error is OperationAbortedError {
  return hasBrand(error, OPERATION_ABORTED_ERROR_BRAND);
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
  ) {
    throw new OperationConfigurationError(
      `timeoutMs must be a positive safe integer no greater than ${MAX_TIMEOUT_MS}`,
    );
  }
}

function validateSignal(signal: AbortSignal): void {
  if (
    typeof signal !== 'object' ||
    signal === null ||
    typeof safelyRead(signal, 'aborted') !== 'boolean' ||
    typeof safelyRead(signal, 'addEventListener') !== 'function' ||
    typeof safelyRead(signal, 'removeEventListener') !== 'function'
  ) {
    throw new OperationConfigurationError('signal must be AbortSignal-compatible');
  }
}

function signalReason(signal: AbortSignal): unknown {
  return safelyRead(signal, 'reason');
}

export function createOperationScope(
  descriptor: OperationDescriptor,
  options: OperationScopeOptions = {},
): OperationScope {
  validateTimeout(options.timeoutMs);

  const signals = options.signals ?? [];
  for (const signal of signals) {
    validateSignal(signal);
  }

  const controller = new AbortController();
  const deadline =
    options.timeoutMs === undefined ? undefined : performance.now() + options.timeoutMs;
  const removers: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  let rejectTermination: ((error: unknown) => void) | undefined;
  const termination = new Promise<never>((_resolve, reject) => {
    rejectTermination = reject;
  });
  void termination.catch(() => undefined);

  const abort = (error: OperationTimeoutError | OperationAbortedError): void => {
    if (controller.signal.aborted) {
      return;
    }

    controller.abort(error);
    rejectTermination?.(error);
  };

  for (const signal of signals) {
    const onAbort = (): void => {
      abort(new OperationAbortedError(descriptor, { cause: signalReason(signal) }));
    };

    if (signal.aborted) {
      onAbort();
      break;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    removers.push(() => {
      signal.removeEventListener('abort', onAbort);
    });
  }

  if (options.timeoutMs !== undefined && !controller.signal.aborted) {
    timer = setTimeout(() => {
      abort(new OperationTimeoutError(descriptor, options.timeoutMs as number));
    }, options.timeoutMs);

    const timerWithUnref = timer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timerWithUnref.unref?.();
  }

  return {
    context: {
      signal: controller.signal,
      deadline,
    },
    termination,
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      for (const remove of removers) {
        remove();
      }
    },
  };
}

export async function runOperation<T>(
  descriptor: OperationDescriptor,
  options: OperationOptions,
  executor: (context: OperationContext) => Promise<T>,
): Promise<T> {
  const scope = createOperationScope(descriptor, {
    signals: options.signal === undefined ? [] : [options.signal],
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  try {
    if (scope.context.signal.aborted) {
      return await scope.termination;
    }

    const operation = Promise.resolve().then(() => executor(scope.context));
    return await Promise.race([operation, scope.termination]);
  } finally {
    scope.dispose();
  }
}
