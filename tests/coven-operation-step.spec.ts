import { afterEach, describe, expect, test, vi } from 'vitest';

import { awaitOperationStep } from '../packages/coven/src/transport-unix.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('queued Coven operation steps', () => {
  test('does not invoke an operation when aborted before its microtask runs', async () => {
    const reason = new Error('stop queued operation');
    const controller = new AbortController();
    const operation = vi.fn(() => Promise.resolve('complete'));

    const result = awaitOperationStep(
      operation,
      { signal: controller.signal, deadline: undefined },
      'validate_endpoint',
    );
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();
  });

  test('does not invoke an operation when its deadline expires before its microtask runs', async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const operation = vi.fn(() => Promise.resolve('complete'));

    const result = awaitOperationStep(
      operation,
      {
        signal: new AbortController().signal,
        deadline: now + 1,
      },
      'validate_endpoint',
    );
    now = 1;

    await expect(result).rejects.toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'validate_endpoint' },
    });
    expect(operation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('rejects when the deadline expires while arming operation controls', async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      reads += 1;
      return reads === 1 ? 0 : 1;
    });
    const operation = vi.fn(() => Promise.resolve('complete'));

    const result = awaitOperationStep(
      operation,
      {
        signal: new AbortController().signal,
        deadline: 1,
      },
      'validate_endpoint',
    );

    await expect(result).rejects.toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'validate_endpoint' },
    });
    expect(operation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
