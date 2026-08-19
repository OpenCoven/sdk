import {
  OperationAbortedError,
  OperationTimeoutError,
  runOperation,
  type OperationEvent,
  type OperationObserver,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const descriptor = {
  system: 'cave' as const,
  operation: 'health',
};

function collectingObserver(events: OperationEvent[]): OperationObserver {
  return {
    onEvent(event) {
      events.push(event);
    },
    onObserverError(error) {
      throw error;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('operation lifecycle events', () => {
  test('emits start then success with monotonic duration', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    const operation = runOperation(
      descriptor,
      { observer: collectingObserver(events) },
      async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 25);
        });
        return 'ok';
      },
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(operation).resolves.toBe('ok');
    expect(events).toEqual([
      {
        phase: 'start',
        system: 'cave',
        operation: 'health',
      },
      {
        phase: 'success',
        system: 'cave',
        operation: 'health',
        durationMs: 25,
      },
    ]);
  });

  test('emits a sanitized failure event', async () => {
    const events: OperationEvent[] = [];
    const transportError = Object.assign(new Error('credential=secret'), {
      code: 'unavailable',
      retryable: true,
      requestId: 'req-123',
      statusCode: 503,
      payload: { secret: 'must not escape' },
    });

    await expect(
      runOperation(
        descriptor,
        { observer: collectingObserver(events) },
        () => Promise.reject(transportError),
      ),
    ).rejects.toBe(transportError);

    expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
    expect(events[1]).toMatchObject({
      phase: 'failure',
      system: 'cave',
      operation: 'health',
      error: {
        system: 'cave',
        operation: 'health',
        code: 'unavailable',
        retryable: true,
        requestId: 'req-123',
        statusCode: 503,
      },
    });
    expect(JSON.stringify(events[1])).not.toContain('credential=secret');
    expect(JSON.stringify(events[1])).not.toContain('must not escape');
    expect(JSON.stringify(events[1])).not.toContain('cause');
    expect(JSON.stringify(events[1])).not.toContain('stack');
  });

  test('emits one timeout terminal event', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    const operation = runOperation(
      descriptor,
      { timeoutMs: 10, observer: collectingObserver(events) },
      () => new Promise<never>(() => undefined),
    );
    const rejection = expect(operation).rejects.toBeInstanceOf(OperationTimeoutError);

    await vi.advanceTimersByTimeAsync(10);
    await rejection;

    expect(events.map(({ phase }) => phase)).toEqual(['start', 'timeout']);
    expect(events[1]).toMatchObject({
      error: {
        code: 'timeout',
        retryable: true,
      },
    });
  });

  test('emits one abort terminal event without serializing its reason', async () => {
    const events: OperationEvent[] = [];
    const controller = new AbortController();
    const operation = runOperation(
      descriptor,
      { signal: controller.signal, observer: collectingObserver(events) },
      () => new Promise<never>(() => undefined),
    );

    controller.abort({ secret: 'abort secret' });

    await expect(operation).rejects.toBeInstanceOf(OperationAbortedError);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);
    expect(events[1]).toMatchObject({
      error: {
        code: 'aborted',
        retryable: false,
      },
    });
    expect(JSON.stringify(events[1])).not.toContain('abort secret');
  });

  test('isolates onEvent failures through onObserverError', async () => {
    const observerFailure = new Error('observer failed');
    const reported: Array<{ error: unknown; event: OperationEvent }> = [];
    const observer: OperationObserver = {
      onEvent() {
        throw observerFailure;
      },
      onObserverError(error, event) {
        reported.push({ error, event });
      },
    };

    await expect(
      runOperation(descriptor, { observer }, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    expect(reported.map(({ event }) => event.phase)).toEqual(['start', 'success']);
    expect(reported.every(({ error }) => error === observerFailure)).toBe(true);
  });

  test('propagates onObserverError failures', async () => {
    const reporterFailure = new Error('observer reporter failed');
    const executor = vi.fn(() => Promise.resolve('unexpected'));
    const observer: OperationObserver = {
      onEvent() {
        throw new Error('observer failed');
      },
      onObserverError() {
        throw reporterFailure;
      },
    };

    await expect(runOperation(descriptor, { observer }, executor)).rejects.toBe(
      reporterFailure,
    );
    expect(executor).not.toHaveBeenCalled();
  });

  test('does not emit a second terminal event when terminal reporting fails', async () => {
    const reporterFailure = new Error('observer reporter failed');
    const phases: OperationEvent['phase'][] = [];
    const observer: OperationObserver = {
      onEvent(event) {
        phases.push(event.phase);
        if (event.phase === 'success') {
          throw new Error('observer failed');
        }
      },
      onObserverError() {
        throw reporterFailure;
      },
    };

    await expect(
      runOperation(descriptor, { observer }, () => Promise.resolve('ok')),
    ).rejects.toBe(reporterFailure);
    expect(phases).toEqual(['start', 'success']);
  });

  test('clamps negative durations to zero', async () => {
    const events: OperationEvent[] = [];
    vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(5);

    await runOperation(
      descriptor,
      { observer: collectingObserver(events) },
      () => Promise.resolve('ok'),
    );

    expect(events[1]).toMatchObject({
      phase: 'success',
      durationMs: 0,
    });
  });
});
