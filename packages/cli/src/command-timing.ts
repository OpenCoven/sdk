import {
  OperationConfigurationError,
  OperationTimeoutError,
} from '@opencoven/sdk-core';

const MAX_TIMEOUT_MS = 2_147_483_647;

export interface CliCommandTiming {
  doctorTimeoutMs: number;
  discoverTimeoutMs: number;
  cavePairTimeoutMs: number;
  cavePairPollIntervalMs: number;
  caveStatusTimeoutMs: number;
  caveForgetTimeoutMs: number;
  covenHealthTimeoutMs: number;
}

export const DEFAULT_CLI_COMMAND_TIMING: CliCommandTiming = Object.freeze({
  doctorTimeoutMs: 10_000,
  discoverTimeoutMs: 10_000,
  cavePairTimeoutMs: 30_000,
  cavePairPollIntervalMs: 1_000,
  caveStatusTimeoutMs: 10_000,
  caveForgetTimeoutMs: 10_000,
  covenHealthTimeoutMs: 10_000,
});

function validateTimingValue(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new OperationConfigurationError(
      `${name} must be a positive safe integer no greater than ${MAX_TIMEOUT_MS}`,
    );
  }
}

function cliTimeoutError(operation: string, timeoutMs: number): OperationTimeoutError {
  return new OperationTimeoutError(
    {
      system: 'cli',
      operation,
    },
    timeoutMs,
  );
}

function asCliError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return Object.assign(
    new Error('OpenCoven command failed.'),
    typeof error === 'object' && error !== null ? error : {},
    { cause: error },
  );
}

export function resolveCliCommandTiming(
  overrides: Partial<CliCommandTiming> = {},
): CliCommandTiming {
  const timing: CliCommandTiming = {
    ...DEFAULT_CLI_COMMAND_TIMING,
    ...overrides,
  };

  validateTimingValue('doctorTimeoutMs', timing.doctorTimeoutMs);
  validateTimingValue('discoverTimeoutMs', timing.discoverTimeoutMs);
  validateTimingValue('cavePairTimeoutMs', timing.cavePairTimeoutMs);
  validateTimingValue('cavePairPollIntervalMs', timing.cavePairPollIntervalMs);
  validateTimingValue('caveStatusTimeoutMs', timing.caveStatusTimeoutMs);
  validateTimingValue('caveForgetTimeoutMs', timing.caveForgetTimeoutMs);
  validateTimingValue('covenHealthTimeoutMs', timing.covenHealthTimeoutMs);

  return timing;
}

export function createCliDeadline(
  now: () => number,
  timeoutMs: number,
): number {
  validateTimingValue('timeoutMs', timeoutMs);
  return now() + timeoutMs;
}

export function remainingCliTime(now: () => number, deadline: number): number {
  return Math.max(0, deadline - now());
}

function remainingCliTimeoutMs(
  now: () => number,
  deadline: number,
  operation: string,
): number {
  const remaining = Math.floor(remainingCliTime(now, deadline));
  if (!Number.isSafeInteger(remaining) || remaining < 1) {
    throw cliTimeoutError(operation, 1);
  }
  validateTimingValue('timeoutMs', remaining);
  return remaining;
}

export async function runWithCliTimeout<T>(
  operation: string,
  timeoutMs: number,
  executor: () => Promise<T>,
): Promise<T> {
  validateTimingValue('timeoutMs', timeoutMs);

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(cliTimeoutError(operation, timeoutMs));
    }, timeoutMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

    void Promise.resolve()
      .then(executor)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(asCliError(error));
        },
      );
  });
}

export async function runWithinCliDeadline<T>(
  now: () => number,
  deadline: number,
  operation: string,
  executor: (timeoutMs: number) => Promise<T>,
): Promise<T> {
  const timeoutMs = remainingCliTimeoutMs(now, deadline, operation);
  return await runWithCliTimeout(operation, timeoutMs, () => executor(timeoutMs));
}
