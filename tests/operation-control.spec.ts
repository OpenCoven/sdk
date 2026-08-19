import {
  createOperationScope,
  isOperationAbortedError,
  isOperationTimeoutError,
  OperationAbortedError,
  OperationConfigurationError,
  OperationTimeoutError,
  runOperation,
  type OperationDescriptor,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const descriptor: OperationDescriptor = {
  system: 'cave',
  operation: 'health',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('operation control', () => {
  test('creates no timer when timeout is omitted', () => {
    vi.useFakeTimers();

    const scope = createOperationScope(descriptor);

    expect(scope.context.deadline).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    scope.dispose();
  });

  test.each([1, 2_147_483_647])('accepts timeout %d', (timeoutMs) => {
    vi.useFakeTimers();

    const scope = createOperationScope(descriptor, { timeoutMs });

    expect(scope.context.deadline).toBe(performance.now() + timeoutMs);
    expect(vi.getTimerCount()).toBe(1);
    scope.dispose();
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid timeout %s',
    (timeoutMs) => {
      expect(() => createOperationScope(descriptor, { timeoutMs })).toThrow(
        OperationConfigurationError,
      );
    },
  );

  test('rejects an already-aborted signal before invoking the executor', async () => {
    const controller = new AbortController();
    controller.abort('caller stopped');
    const executor = vi.fn(() => Promise.resolve('unexpected'));
    const phases: string[] = [];

    const error = await runOperation(
      descriptor,
      {
        signal: controller.signal,
        observer: {
          onEvent(event) {
            phases.push(event.phase);
          },
          onObserverError(observerError) {
            throw observerError;
          },
        },
      },
      executor,
    ).catch((caught: unknown) => caught);

    expect(executor).not.toHaveBeenCalled();
    expect(phases).toEqual(['start', 'abort']);
    expect(error).toBeInstanceOf(OperationAbortedError);
    expect(isOperationAbortedError(error)).toBe(true);
    expect((error as Error).cause).toBe('caller stopped');
  });

  test('lets caller abort win before timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = runOperation(
      descriptor,
      { signal: controller.signal, timeoutMs: 100 },
      () => new Promise<never>(() => undefined),
    );

    controller.abort();

    await expect(result).rejects.toBeInstanceOf(OperationAbortedError);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('lets timeout win before a late resolve', async () => {
    vi.useFakeTimers();
    let resolveOperation: ((value: string) => void) | undefined;
    const result = runOperation(descriptor, { timeoutMs: 10 }, () => {
      return new Promise<string>((resolve) => {
        resolveOperation = resolve;
      });
    });
    const rejection = expect(result).rejects.toBeInstanceOf(OperationTimeoutError);

    await vi.advanceTimersByTimeAsync(10);

    await rejection;
    resolveOperation?.('late');
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('lets transport resolve win before timeout', async () => {
    vi.useFakeTimers();

    await expect(
      runOperation(descriptor, { timeoutMs: 10 }, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('lets transport rejection win before timeout', async () => {
    vi.useFakeTimers();
    const transportError = new Error('transport failed');

    await expect(
      runOperation(descriptor, { timeoutMs: 10 }, () => Promise.reject(transportError)),
    ).rejects.toBe(transportError);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('normalizes a synchronous executor throw as an operation rejection', async () => {
    const executorError = new Error('synchronous failure');

    await expect(
      runOperation(descriptor, {}, () => {
        throw executorError;
      }),
    ).rejects.toBe(executorError);
  });

  test('rejects a never-settling executor at timeout', async () => {
    vi.useFakeTimers();
    const result = runOperation(
      descriptor,
      { timeoutMs: 25 },
      () => new Promise<never>(() => undefined),
    );
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(25);

    const error = await caught;
    expect(error).toBeInstanceOf(OperationTimeoutError);
    expect(isOperationTimeoutError(error)).toBe(true);
  });

  test('handles a late executor rejection after timeout', async () => {
    vi.useFakeTimers();
    let rejectOperation: ((error: unknown) => void) | undefined;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const result = runOperation(descriptor, { timeoutMs: 5 }, () => {
        return new Promise<never>((_resolve, reject) => {
          rejectOperation = reject;
        });
      });
      const rejection = expect(result).rejects.toBeInstanceOf(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(5);
      await rejection;
      unhandled.length = 0;
      rejectOperation?.(new Error('late rejection'));
      await Promise.resolve();

      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('removes external abort listeners after success', async () => {
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      addEventListener(type: string, listener: () => void) {
        if (type === 'abort') {
          listeners.add(listener);
        }
      },
      removeEventListener(type: string, listener: () => void) {
        if (type === 'abort') {
          listeners.delete(listener);
        }
      },
    } as unknown as AbortSignal;

    await expect(
      runOperation(descriptor, { signal }, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    expect(listeners.size).toBe(0);
  });

  test('unrefs the timeout when the host timer supports it', () => {
    const sampleTimer = setTimeout(() => undefined, 1);
    const timerPrototype = Object.getPrototypeOf(sampleTimer) as {
      unref(): unknown;
    };
    clearTimeout(sampleTimer);
    const unref = vi.spyOn(timerPrototype, 'unref');

    const scope = createOperationScope(descriptor, { timeoutMs: 50 });

    expect(unref).toHaveBeenCalled();
    scope.dispose();
  });

  test('inherits an earlier parent deadline without creating a duplicate timer', async () => {
    vi.useFakeTimers();
    const parent = createOperationScope(descriptor, { timeoutMs: 100 });
    const child = createOperationScope(descriptor, {
      signals: [parent.context.signal],
      timeoutMs: 200,
    });
    const parentError = parent.termination.catch((error: unknown) => error);
    const childError = child.termination.catch((error: unknown) => error);

    expect(child.context.deadline).toBe(parent.context.deadline);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(await childError).toBe(await parentError);
    child.dispose();
    parent.dispose();
  });

  test('rejects hostile error-brand proxies safely', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter');
        },
      },
    );

    expect(isOperationTimeoutError(hostile)).toBe(false);
    expect(isOperationAbortedError(hostile)).toBe(false);
  });
});
