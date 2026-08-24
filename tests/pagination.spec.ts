import {
  iteratePages,
  normalizePageOptions,
  OperationAbortedError,
  OperationTimeoutError,
  type BoundedPageOptions,
  type OperationEvent,
  type OperationObserver,
  type Page,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const FIRST_CURSOR = 'eyJwYWdlIjoxfQ';
const SECOND_CURSOR = 'eyJwYWdlIjoyfQ';
const THIRD_CURSOR = 'eyJwYWdlIjozfQ';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

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

function compileOnly(): void {
  const readPage = (): Promise<Page<string>> =>
    Promise.resolve({ data: [] });
  const controller = new AbortController();

  void iteratePages(readPage, { maxPages: 1 });
  void iteratePages(readPage, { signal: controller.signal });
  void ({ maxPages: 1 } satisfies BoundedPageOptions);
  void ({ signal: controller.signal } satisfies BoundedPageOptions);

  // @ts-expect-error Iteration requires maxPages or a caller-owned signal.
  void iteratePages(readPage, {});
  // @ts-expect-error Bounded page options cannot omit both runtime bounds.
  void ({} satisfies BoundedPageOptions);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('page option normalization', () => {
  test('defaults the page limit to 50', () => {
    expect(normalizePageOptions()).toEqual({ limit: 50 });
  });

  test('rejects a supplied null page limit at runtime', () => {
    const normalizeRuntimeInput = normalizePageOptions as unknown as (
      options?: unknown,
    ) => unknown;

    expect(() => normalizeRuntimeInput({ limit: null })).toThrow(
      expect.objectContaining({ code: 'invalid_options' }),
    );
  });

  test.each([1, 100])('accepts page limit %d', (limit) => {
    expect(normalizePageOptions({ limit })).toEqual({ limit });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 101])(
    'rejects invalid page limit %s',
    (limit) => {
      expect(() => normalizePageOptions({ limit })).toThrow(
        expect.objectContaining({ code: 'invalid_options' }),
      );
    },
  );

  test('accepts bounded canonical base64url cursor spelling without decoding it', () => {
    const opaqueCursor = 'b3BhcXVlX2N1cnNvci12YWx1ZQ';
    const boundedCursor = 'abcd'.repeat(128);

    expect(normalizePageOptions({ cursor: opaqueCursor })).toEqual({
      limit: 50,
      cursor: opaqueCursor,
    });
    expect(normalizePageOptions({ cursor: boundedCursor })).toEqual({
      limit: 50,
      cursor: boundedCursor,
    });
  });

  test.each(['A', 'AAAAA'])(
    'rejects impossible unpadded base64url length for %s',
    (cursor) => {
      expect(() => normalizePageOptions({ cursor })).toThrow(
        expect.objectContaining({ code: 'invalid_options' }),
      );
    },
  );

  test.each(['AB', 'AAB'])(
    'rejects nonzero trailing base64url pad bits for %s',
    (cursor) => {
      expect(() => normalizePageOptions({ cursor })).toThrow(
        expect.objectContaining({ code: 'invalid_options' }),
      );
    },
  );

  test.each(['', 'cursor=', 'cursor+', 'cursor/', 'cursor value', 'a'.repeat(513)])(
    'rejects invalid cursor spelling',
    (cursor) => {
      expect(() => normalizePageOptions({ cursor })).toThrow(
        expect.objectContaining({ code: 'invalid_options' }),
      );
    },
  );
});

describe('bounded page iteration', () => {
  test('requires maxPages or a caller-owned signal in the public type surface', () => {
    expect(compileOnly).toBeTypeOf('function');
  });

  test('rejects iteration without a page bound or abort signal', () => {
    const unsafeIteratePages = iteratePages as unknown as (
      readPage: () => Promise<Page<never>>,
      options?: unknown,
    ) => AsyncGenerator<never>;

    expect(() => unsafeIteratePages(() => Promise.resolve({ data: [] }))).toThrow(
      expect.objectContaining({ code: 'invalid_options' }),
    );
    expect(() =>
      unsafeIteratePages(() => Promise.resolve({ data: [] }), {}),
    ).toThrow(
      expect.objectContaining({ code: 'invalid_options' }),
    );
  });

  test('snapshots initial page options and operation controls at construction', async () => {
    const originalController = new AbortController();
    const replacementController = new AbortController();
    const originalEvents: OperationEvent[] = [];
    const replacementEvents: OperationEvent[] = [];
    const options: BoundedPageOptions = {
      limit: 10,
      cursor: SECOND_CURSOR,
      maxPages: 1,
      signal: originalController.signal,
      timeoutMs: 100,
      observer: collectingObserver(originalEvents),
    };
    const readPage = vi.fn(
      (
        pageOptions: {
          limit: number;
          cursor?: string;
          signal: AbortSignal;
        },
      ): Promise<Page<string>> =>
        Promise.resolve({
          data: ['item'],
          cursor: {
            ...(pageOptions.cursor === undefined
              ? {}
              : { current: pageOptions.cursor }),
            next: THIRD_CURSOR,
            hasMore: true,
          },
        }),
    );
    const iterator = iteratePages(readPage, options);

    options.limit = 99;
    options.cursor = THIRD_CURSOR;
    options.maxPages = 2;
    options.signal = replacementController.signal;
    options.timeoutMs = 1;
    options.observer = collectingObserver(replacementEvents);

    await expect(collect(iterator)).resolves.toEqual(['item']);
    expect(readPage).toHaveBeenCalledOnce();
    expect(readPage.mock.calls[0]?.[0]).toMatchObject({
      limit: 10,
      cursor: SECOND_CURSOR,
    });
    expect(readPage.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(originalEvents.map(({ phase }) => phase)).toEqual(['start', 'success']);
    expect(replacementEvents).toEqual([]);
  });

  test('retains a signal-only bound when the options signal is removed', async () => {
    const controller = new AbortController();
    const options: BoundedPageOptions = { signal: controller.signal };
    const readPage = vi.fn(() =>
      Promise.resolve({
        data: ['unexpected'],
        cursor: { next: FIRST_CURSOR, hasMore: true },
      }),
    );
    const iterator = iteratePages(readPage, options);

    delete (options as { signal?: AbortSignal }).signal;
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
    expect(readPage).not.toHaveBeenCalled();
  });

  test('retains the initial timeout when options are mutated before iteration', async () => {
    vi.useFakeTimers();
    const options: BoundedPageOptions = { maxPages: 1, timeoutMs: 10 };
    const iterator = iteratePages(
      () => new Promise<Page<never>>(() => undefined),
      options,
    );
    let caught: unknown;

    options.timeoutMs = 1_000;
    void iterator.next().catch((error: unknown) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(caught).toMatchObject({
      code: 'timeout',
      retryable: true,
    });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxPages %s',
    (maxPages) => {
      expect(() =>
        iteratePages(() => Promise.resolve({ data: [] }), { maxPages }),
      ).toThrow(expect.objectContaining({ code: 'invalid_options' }));
    },
  );

  test('iterates an empty page', async () => {
    const readPage = vi.fn(
      (options: { limit: number; cursor?: string; signal: AbortSignal }) => {
        void options.signal;
        return Promise.resolve({
          data: [],
          cursor: { hasMore: false },
        });
      },
    );

    await expect(collect(iteratePages(readPage, { maxPages: 1 }))).resolves.toEqual(
      [],
    );
    expect(readPage).toHaveBeenCalledOnce();
    expect(readPage.mock.calls[0]?.[0]).toMatchObject({ limit: 50 });
    expect(readPage.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  test('iterates exactly one page when hasMore is false', async () => {
    const readPage = vi.fn(
      (options: { limit: number; cursor?: string; signal: AbortSignal }) => {
        void options.signal;
        return Promise.resolve({
          data: ['one', 'two'],
          cursor: { hasMore: false },
        });
      },
    );

    await expect(
      collect(iteratePages(readPage, { limit: 25, maxPages: 5 })),
    ).resolves.toEqual(['one', 'two']);
    expect(readPage).toHaveBeenCalledOnce();
    expect(readPage.mock.calls[0]?.[0]).toMatchObject({ limit: 25 });
    expect(readPage.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  test('iterates multiple pages until hasMore is false', async () => {
    const readPage = vi.fn(
      (options: {
        limit: number;
        cursor?: string;
        signal: AbortSignal;
      }): Promise<Page<string>> => {
        if (options.cursor === undefined) {
          return Promise.resolve({
            data: ['one'],
            cursor: { next: FIRST_CURSOR, hasMore: true },
          });
        }
        if (options.cursor === FIRST_CURSOR) {
          return Promise.resolve({
            data: ['two'],
            cursor: {
              current: FIRST_CURSOR,
              next: SECOND_CURSOR,
              hasMore: true,
            },
          });
        }
        return Promise.resolve({
          data: ['three'],
          cursor: { current: SECOND_CURSOR, hasMore: false },
        });
      },
    );

    await expect(
      collect(iteratePages(readPage, { limit: 10, maxPages: 4 })),
    ).resolves.toEqual(['one', 'two', 'three']);
    expect(
      readPage.mock.calls.map(([{ cursor, limit }]) =>
        cursor === undefined ? { limit } : { limit, cursor },
      ),
    ).toEqual([
      { limit: 10 },
      { limit: 10, cursor: FIRST_CURSOR },
      { limit: 10, cursor: SECOND_CURSOR },
    ]);
    expect(
      readPage.mock.calls.every(([options]) =>
        options.signal instanceof AbortSignal
      ),
    ).toBe(true);
  });

  test.each([
    ['missing', undefined],
    ['mismatched', FIRST_CURSOR],
  ] as const)(
    'rejects a %s initial cursor.current before yielding page data',
    async (_kind, current) => {
      const yielded: string[] = [];
      const readPage = vi.fn(
        (
          options: {
            limit: number;
            cursor?: string;
            signal: AbortSignal;
          },
        ): Promise<Page<string>> => {
          void options;
          return Promise.resolve({
            data: ['must-not-leak'],
            cursor: {
              ...(current === undefined ? {} : { current }),
              hasMore: false,
            },
          });
        },
      );

      try {
        for await (const item of iteratePages(readPage, {
          cursor: SECOND_CURSOR,
          limit: 25,
          maxPages: 1,
        })) {
          yielded.push(item);
        }
        throw new Error('Expected cursor.current validation to fail.');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'invalid_response',
          details: { field: 'cursor.current' },
          retryable: false,
        });
      }

      expect(yielded).toEqual([]);
      expect(readPage).toHaveBeenCalledOnce();
      expect(readPage.mock.calls[0]?.[0]).toMatchObject({
        cursor: SECOND_CURSOR,
        limit: 25,
      });
      expect(readPage.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    },
  );

  test.each([
    ['missing', undefined],
    ['mismatched', THIRD_CURSOR],
  ] as const)(
    'rejects a %s continuation cursor.current before yielding that page data',
    async (_kind, current) => {
      const yielded: string[] = [];
      const readPage = vi.fn(
        (
          options: {
            limit: number;
            cursor?: string;
            signal: AbortSignal;
          },
        ): Promise<Page<string>> =>
          Promise.resolve(
            options.cursor === undefined
              ? {
                  data: ['first-page'],
                  cursor: { next: FIRST_CURSOR, hasMore: true },
                }
              : {
                  data: ['must-not-leak'],
                  cursor: {
                    ...(current === undefined ? {} : { current }),
                    hasMore: false,
                  },
                },
          ),
      );

      try {
        for await (const item of iteratePages(readPage, {
          limit: 10,
          maxPages: 2,
        })) {
          yielded.push(item);
        }
        throw new Error('Expected cursor.current validation to fail.');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'invalid_response',
          details: { field: 'cursor.current' },
          retryable: false,
        });
      }

      expect(yielded).toEqual(['first-page']);
      expect(
        readPage.mock.calls.map(([options]) =>
          options.cursor === undefined
            ? { limit: options.limit }
            : { cursor: options.cursor, limit: options.limit },
        ),
      ).toEqual([
        { limit: 10 },
        { cursor: FIRST_CURSOR, limit: 10 },
      ]);
    },
  );

  test('accepts exact cursor.current echoes for initial and continuation requests', async () => {
    const readPage = vi.fn(
      (
        options: {
          limit: number;
          cursor?: string;
          signal: AbortSignal;
        },
      ): Promise<Page<string>> =>
        Promise.resolve(
          options.cursor === SECOND_CURSOR
            ? {
                data: ['one'],
                cursor: {
                  current: SECOND_CURSOR,
                  next: THIRD_CURSOR,
                  hasMore: true,
                },
              }
            : {
                data: ['two'],
                cursor: {
                  current: THIRD_CURSOR,
                  hasMore: false,
                },
              },
        ),
    );

    await expect(
      collect(
        iteratePages(readPage, {
          cursor: SECOND_CURSOR,
          limit: 10,
          maxPages: 2,
        }),
      ),
    ).resolves.toEqual(['one', 'two']);
    expect(
      readPage.mock.calls.map(([options]) => ({
        cursor: options.cursor,
        limit: options.limit,
      })),
    ).toEqual([
      { cursor: SECOND_CURSOR, limit: 10 },
      { cursor: THIRD_CURSOR, limit: 10 },
    ]);
  });

  test('stops before requesting page maxPages plus one', async () => {
    const readPage = vi.fn(
      (options: { limit: number; cursor?: string }): Promise<Page<string>> => {
        const current = options.cursor;
        const next = current === undefined ? FIRST_CURSOR : SECOND_CURSOR;
        return Promise.resolve({
          data: [current ?? 'first'],
          cursor: {
            ...(current === undefined ? {} : { current }),
            next,
            hasMore: true,
          },
        });
      },
    );

    await expect(
      collect(iteratePages(readPage, { maxPages: 2 })),
    ).resolves.toEqual(['first', FIRST_CURSOR]);
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  test('honors an already-aborted signal before reading a page', async () => {
    const controller = new AbortController();
    controller.abort('caller stopped');
    const readPage = vi.fn(() => Promise.resolve({ data: [] }));

    await expect(
      collect(iteratePages(readPage, { signal: controller.signal })),
    ).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
    expect(readPage).not.toHaveBeenCalled();
  });

  test('honors abort between pages', async () => {
    const controller = new AbortController();
    const readPage = vi.fn(() =>
      Promise.resolve({
        data: ['one'],
        cursor: { next: FIRST_CURSOR, hasMore: true },
      }),
    );
    const iterator = iteratePages(readPage, { signal: controller.signal });

    await expect(iterator.next()).resolves.toEqual({ value: 'one', done: false });
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
    expect(readPage).toHaveBeenCalledOnce();
  });

  test('honors abort after the final item before natural completion', async () => {
    const controller = new AbortController();
    const iterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['one'],
          cursor: { hasMore: false },
        }),
      { signal: controller.signal },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'one', done: false });
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
  });

  test('honors abort after the final item before maxPages completion', async () => {
    const controller = new AbortController();
    const iterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['one'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        }),
      { maxPages: 1, signal: controller.signal },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'one', done: false });
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
  });

  test('honors abort after an item before rejecting a missing next cursor', async () => {
    const controller = new AbortController();
    const iterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['one'],
          cursor: { hasMore: true },
        }),
      { signal: controller.signal },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'one', done: false });
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
  });

  test('honors abort after an item before rejecting a non-progressing next cursor', async () => {
    const controller = new AbortController();
    const iterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['one'],
          cursor: {
            current: FIRST_CURSOR,
            next: FIRST_CURSOR,
            hasMore: true,
          },
        }),
      { signal: controller.signal },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'one', done: false });
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
  });

  test('rejects hasMore without a next cursor', async () => {
    const iterator = iteratePages(
      () => Promise.resolve({
        data: ['item'],
        cursor: { hasMore: true },
      }),
      { maxPages: 2 },
    );

    await expect(collect(iterator)).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
  });

  test('rejects a non-progressing next cursor instead of looping', async () => {
    const iterator = iteratePages(
      () => Promise.resolve({
        data: ['item'],
        cursor: {
          current: FIRST_CURSOR,
          next: FIRST_CURSOR,
          hasMore: true,
        },
      }),
      { maxPages: 2 },
    );

    await expect(collect(iterator)).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
  });

  test('rejects a previously requested next cursor instead of cycling', async () => {
    const readPage = vi.fn(
      (options: { limit: number; cursor?: string }): Promise<Page<string>> => {
        if (options.cursor === undefined) {
          return Promise.resolve({
            data: ['one'],
            cursor: { next: FIRST_CURSOR, hasMore: true },
          });
        }
        if (options.cursor === FIRST_CURSOR) {
          return Promise.resolve({
            data: ['two'],
            cursor: {
              current: FIRST_CURSOR,
              next: SECOND_CURSOR,
              hasMore: true,
            },
          });
        }
        return Promise.resolve({
          data: ['three'],
          cursor: {
            current: SECOND_CURSOR,
            next: FIRST_CURSOR,
            hasMore: true,
          },
        });
      },
    );

    await expect(
      collect(iteratePages(readPage, { maxPages: 4 })),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
    expect(readPage).toHaveBeenCalledTimes(3);
  });

  test('accepts a caller-provided initial cursor and advances from it', async () => {
    const readPage = vi.fn(
      (options: {
        limit: number;
        cursor?: string;
        signal: AbortSignal;
      }): Promise<Page<string>> =>
        Promise.resolve({
          data: ['item'],
          cursor: {
            ...(options.cursor === undefined ? {} : { current: options.cursor }),
            next: THIRD_CURSOR,
            hasMore: false,
          },
        }),
    );

    await expect(
      collect(
        iteratePages(readPage, {
          cursor: SECOND_CURSOR,
          maxPages: 1,
        }),
      ),
    ).resolves.toEqual(['item']);
    expect(readPage.mock.calls[0]?.[0]).toMatchObject({
      limit: 50,
      cursor: SECOND_CURSOR,
    });
    expect(readPage.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  test('emits observer start and success events for completed iteration', async () => {
    const events: OperationEvent[] = [];

    await expect(
      collect(
        iteratePages(
          () =>
            Promise.resolve({
              data: ['item'],
              cursor: { hasMore: false },
            }),
          { maxPages: 1, observer: collectingObserver(events) },
        ),
      ),
    ).resolves.toEqual(['item']);

    expect(events.map(({ phase }) => phase)).toEqual(['start', 'success']);
    expect(events[0]).toEqual({
      phase: 'start',
      system: 'sdk',
      operation: 'iteratePages',
    });
    const successEvent = events[1];
    expect(successEvent).toMatchObject({
      phase: 'success',
      system: 'sdk',
      operation: 'iteratePages',
    });
    if (successEvent?.phase !== 'success') {
      throw new Error('expected pagination success event');
    }
    expect(successEvent.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('emits observer start and failure events for page errors', async () => {
    const events: OperationEvent[] = [];
    const pageError = new Error('page failed');

    await expect(
      collect(
        iteratePages(() => Promise.reject(pageError), {
          maxPages: 1,
          observer: collectingObserver(events),
        }),
      ),
    ).rejects.toBe(pageError);

    expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
    expect(events[1]).toMatchObject({
      system: 'sdk',
      operation: 'iteratePages',
      error: {
        system: 'sdk',
        operation: 'iteratePages',
        code: 'unknown',
        retryable: false,
      },
    });
  });

  test('emits observer start and abort events for caller cancellation', async () => {
    const events: OperationEvent[] = [];
    const controller = new AbortController();
    const iterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        }),
      {
        signal: controller.signal,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    controller.abort('caller stopped');

    await expect(iterator.next()).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);
    expect(events[1]).toMatchObject({
      system: 'sdk',
      operation: 'iteratePages',
      error: {
        code: 'aborted',
        retryable: false,
      },
    });
    expect(JSON.stringify(events[1])).not.toContain('caller stopped');
  });

  test('aborts and disposes operation controls when returned after a yield', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      reason: undefined,
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
    const iterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        }),
      {
        signal,
        timeoutMs: 1_000,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    expect(listeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await expect(iterator.return(undefined)).resolves.toEqual({
      value: undefined,
      done: true,
    });

    expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);
    expect(events[1]).toMatchObject({
      phase: 'abort',
      error: {
        code: 'aborted',
        retryable: false,
      },
    });
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('return preserves a timeout that fires while suspended at a yield', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    let transportSignal: AbortSignal | undefined;
    const iterator = iteratePages(
      (options) => {
        transportSignal = options.signal;
        return Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        });
      },
      {
        maxPages: 2,
        timeoutMs: 10,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    expect(transportSignal).toBeDefined();

    await vi.advanceTimersByTimeAsync(10);

    expect(transportSignal?.aborted).toBe(true);
    const timeoutReason = transportSignal?.reason as unknown;
    expect(timeoutReason).toBeInstanceOf(OperationTimeoutError);
    expect(timeoutReason).toMatchObject({
      code: 'timeout',
      retryable: true,
    });

    await expect(iterator.return(undefined)).resolves.toEqual({
      value: undefined,
      done: true,
    });

    expect(transportSignal?.reason).toBe(timeoutReason);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'timeout']);
    expect(events[1]).toMatchObject({
      phase: 'timeout',
      error: {
        code: 'timeout',
        retryable: true,
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  test('return preserves a caller abort that wins while suspended at a yield', async () => {
    const events: OperationEvent[] = [];
    const controller = new AbortController();
    const callerReason = new Error('caller stopped');
    let transportSignal: AbortSignal | undefined;
    const iterator = iteratePages(
      (options) => {
        transportSignal = options.signal;
        return Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        });
      },
      {
        maxPages: 2,
        signal: controller.signal,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    controller.abort(callerReason);

    expect(transportSignal?.aborted).toBe(true);
    const abortReason = transportSignal?.reason as unknown;
    expect(abortReason).toBeInstanceOf(OperationAbortedError);
    expect((abortReason as Error).cause).toBe(callerReason);

    await expect(iterator.return(undefined)).resolves.toEqual({
      value: undefined,
      done: true,
    });

    expect(transportSignal?.reason).toBe(abortReason);
    expect((transportSignal?.reason as Error).cause).toBe(callerReason);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);
    expect(events[1]).toMatchObject({
      phase: 'abort',
      error: {
        code: 'aborted',
        retryable: false,
      },
    });
  });

  test('throw preserves a timeout that wins while suspended at a yield', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    const consumerError = new Error('consumer failed');
    let transportSignal: AbortSignal | undefined;
    const iterator = iteratePages(
      (options) => {
        transportSignal = options.signal;
        return Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        });
      },
      {
        maxPages: 2,
        timeoutMs: 10,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    await vi.advanceTimersByTimeAsync(10);

    const timeoutReason = transportSignal?.reason as unknown;
    expect(timeoutReason).toBeInstanceOf(OperationTimeoutError);

    await expect(iterator.throw(consumerError)).rejects.toBe(timeoutReason);

    expect(transportSignal?.reason).toBe(timeoutReason);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'timeout']);
    expect(events[1]).toMatchObject({
      phase: 'timeout',
      error: {
        code: 'timeout',
        retryable: true,
      },
    });
    expect(events.filter(({ phase }) => phase !== 'start')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('throw preserves a caller abort that wins while suspended at a yield', async () => {
    const events: OperationEvent[] = [];
    const controller = new AbortController();
    const callerReason = new Error('caller stopped');
    const consumerError = new Error('consumer failed');
    let transportSignal: AbortSignal | undefined;
    const iterator = iteratePages(
      (options) => {
        transportSignal = options.signal;
        return Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        });
      },
      {
        maxPages: 2,
        signal: controller.signal,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    controller.abort(callerReason);

    const abortReason = transportSignal?.reason as unknown;
    expect(abortReason).toBeInstanceOf(OperationAbortedError);
    expect((abortReason as Error).cause).toBe(callerReason);

    await expect(iterator.throw(consumerError)).rejects.toBe(abortReason);

    expect(transportSignal?.reason).toBe(abortReason);
    expect((transportSignal?.reason as Error).cause).toBe(callerReason);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'abort']);
    expect(events[1]).toMatchObject({
      phase: 'abort',
      error: {
        code: 'aborted',
        retryable: false,
      },
    });
  });

  test('throw after a yield cancels transport and reports the consumer error as failure', async () => {
    const events: OperationEvent[] = [];
    const consumerError = new Error('consumer failed');
    let transportSignal: AbortSignal | undefined;
    const iterator = iteratePages(
      (options) => {
        transportSignal = options.signal;
        return Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        });
      },
      {
        maxPages: 2,
        observer: collectingObserver(events),
      },
    );

    await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false });
    await expect(iterator.throw(consumerError)).rejects.toBe(consumerError);

    expect(transportSignal?.aborted).toBe(true);
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
    expect(events[1]).toMatchObject({
      phase: 'failure',
      error: {
        code: 'unknown',
        retryable: false,
      },
    });
    expect(events.filter(({ phase }) => phase !== 'start')).toHaveLength(1);
  });

  test('throw before first next follows AsyncGenerator protocol without starting an operation', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    const consumerError = new Error('consumer failed');
    const readPage = vi.fn(() => Promise.resolve({ data: [] }));
    const iterator = iteratePages(readPage, {
      maxPages: 1,
      timeoutMs: 1_000,
      observer: collectingObserver(events),
    });

    await expect(iterator.throw(consumerError)).rejects.toBe(consumerError);
    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });

    expect(readPage).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('throw promptly terminates an in-flight transport read without unhandled rejection', async () => {
    const events: OperationEvent[] = [];
    const consumerError = new Error('consumer failed');
    const cleanupController = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error);
    };
    let transportSignal: AbortSignal | undefined;
    const readPage = vi.fn(
      (options: { signal: AbortSignal }): Promise<Page<never>> => {
        transportSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              const reason = options.signal.reason as unknown;
              reject(
                reason instanceof Error
                  ? reason
                  : new Error('transport aborted', { cause: reason }),
              );
            },
            { once: true },
          );
        });
      },
    );
    const iterator = iteratePages(readPage, {
      maxPages: 1,
      signal: cleanupController.signal,
      observer: collectingObserver(events),
    });
    const pendingNext = iterator.next().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );

    process.on('unhandledRejection', onUnhandled);
    try {
      await vi.waitFor(() => {
        expect(readPage).toHaveBeenCalledOnce();
      });
      const thrown = iterator.throw(consumerError).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      const settlement = await Promise.race([
        Promise.all([pendingNext, thrown]),
        new Promise<'still-pending'>((resolve) => {
          setTimeout(() => {
            resolve('still-pending');
          }, 50);
        }),
      ]);

      expect(settlement).not.toBe('still-pending');
      expect(settlement).toEqual([
        { error: consumerError },
        { error: consumerError },
      ]);
      expect(transportSignal?.aborted).toBe(true);
      expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
      expect(events.filter(({ phase }) => phase !== 'start')).toHaveLength(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      cleanupController.abort('test cleanup');
      await pendingNext;
    }
  });

  test('queued iterator operations never expose throw transport cancellation details', async () => {
    const events: OperationEvent[] = [];
    const firstError = new Error('first consumer failure');
    const secondError = new Error('second consumer failure');
    let transportSignal: AbortSignal | undefined;
    const readPage = vi.fn(
      (options: { signal: AbortSignal }): Promise<Page<never>> => {
        transportSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              const reason = options.signal.reason as unknown;
              reject(
                reason instanceof Error
                  ? reason
                  : new Error('transport aborted', { cause: reason }),
              );
            },
            { once: true },
          );
        });
      },
    );
    const iterator = iteratePages(readPage, {
      maxPages: 1,
      observer: collectingObserver(events),
    });
    const settle = <T>(promise: Promise<T>) =>
      promise.then(
        (result) => ({ status: 'fulfilled' as const, result }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
    const pendingNext = settle(iterator.next());

    await vi.waitFor(() => {
      expect(readPage).toHaveBeenCalledOnce();
    });

    const firstThrow = settle(iterator.throw(firstError));
    const secondThrow = settle(iterator.throw(secondError));
    const queuedNext = settle(iterator.next());
    const queuedReturn = settle(iterator.return(undefined));
    const settlement = await Promise.race([
      Promise.all([
        pendingNext,
        firstThrow,
        secondThrow,
        queuedNext,
        queuedReturn,
      ]),
      new Promise<'still-pending'>((resolve) => {
        setTimeout(() => {
          resolve('still-pending');
        }, 50);
      }),
    ]);

    expect(settlement).not.toBe('still-pending');
    if (settlement === 'still-pending') {
      return;
    }

    const internalAbort = transportSignal?.reason as OperationAbortedError;
    expect(internalAbort).toBeInstanceOf(OperationAbortedError);
    expect(internalAbort).not.toBe(firstError);
    expect(internalAbort).not.toBe(secondError);

    expect(settlement[0]).toEqual({ status: 'rejected', error: firstError });
    expect(settlement[1]).toEqual({ status: 'rejected', error: firstError });
    const secondThrowOutcome = settlement[2];
    expect(secondThrowOutcome.status).toBe('rejected');
    if (secondThrowOutcome.status === 'rejected') {
      expect([firstError, secondError]).toContain(secondThrowOutcome.error);
    }
    expect(settlement[3]).toEqual({
      status: 'fulfilled',
      result: { value: undefined, done: true },
    });
    expect(settlement[4]).toEqual({
      status: 'fulfilled',
      result: { value: undefined, done: true },
    });

    const expectPublicSettlement = (exposed: unknown): void => {
      expect(exposed).not.toBe(internalAbort);
      expect(exposed).not.toBe(internalAbort.cause);
      if (exposed instanceof OperationAbortedError) {
        expect(exposed.cause).not.toBe(internalAbort.cause);
      }
    };
    for (const outcome of settlement) {
      if (outcome.status === 'rejected') {
        expectPublicSettlement(outcome.error);
      } else {
        expectPublicSettlement(outcome.result.value as unknown);
      }
    }
    expect(events.map(({ phase }) => phase)).toEqual(['start', 'failure']);
    expect(events.filter(({ phase }) => phase !== 'start')).toHaveLength(1);
  });

  test('disposes operation controls when abort observation throws', async () => {
    vi.useFakeTimers();
    const reporterFailure = new Error('observer reporter failed');
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      reason: undefined,
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
    const iterator = iteratePages(
      () => Promise.resolve({ data: ['item'] }),
      {
        signal,
        timeoutMs: 1_000,
        observer: {
          onEvent(event) {
            if (event.phase === 'abort') {
              throw new Error('observer failed');
            }
          },
          onObserverError() {
            throw reporterFailure;
          },
        },
      },
    );

    await iterator.next();
    await expect(iterator.return(undefined)).rejects.toBe(reporterFailure);

    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('return aborts an in-flight transport read without waiting for it', async () => {
    const callerController = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const readPage = vi.fn(
      (
        pageOptions: {
          limit: number;
          cursor?: string;
          signal: AbortSignal;
        },
      ): Promise<Page<never>> => {
        transportSignal = pageOptions.signal;
        return new Promise((_resolve, reject) => {
          transportSignal?.addEventListener(
            'abort',
            () => {
              const reason = transportSignal?.reason as unknown;
              reject(
                reason instanceof Error
                  ? reason
                  : new Error('transport aborted', { cause: reason }),
              );
            },
            { once: true },
          );
        });
      },
    );
    const iterator = iteratePages(readPage, {
      maxPages: 1,
      signal: callerController.signal,
    });
    const pendingNext = iterator.next().then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );

    await vi.waitFor(() => {
      expect(readPage).toHaveBeenCalledOnce();
    });
    const returned = iterator.return(undefined);

    try {
      const closeOutcome = await Promise.race([
        returned.then(() => 'returned' as const),
        new Promise<'still-pending'>((resolve) => {
          setTimeout(() => {
            resolve('still-pending');
          }, 50);
        }),
      ]);

      expect(closeOutcome).toBe('returned');
      expect(transportSignal).toBeDefined();
      expect(transportSignal).not.toBe(callerController.signal);
      expect(transportSignal?.aborted).toBe(true);
      await expect(pendingNext).resolves.toMatchObject({
        error: {
          code: 'aborted',
          retryable: false,
        },
      });
      await expect(returned).resolves.toEqual({
        value: undefined,
        done: true,
      });
    } finally {
      callerController.abort('test cleanup');
      await pendingNext;
      await returned;
    }
  });

  test('return before first next does not start an operation', async () => {
    vi.useFakeTimers();
    const events: OperationEvent[] = [];
    const readPage = vi.fn(() => Promise.resolve({ data: [] }));
    const iterator = iteratePages(readPage, {
      maxPages: 1,
      timeoutMs: 1_000,
      observer: collectingObserver(events),
    });

    await expect(iterator.return(undefined)).resolves.toEqual({
      value: undefined,
      done: true,
    });

    expect(readPage).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('repeated return and completion do not duplicate terminal events', async () => {
    const returnedEvents: OperationEvent[] = [];
    const returnedIterator = iteratePages(
      () =>
        Promise.resolve({
          data: ['item'],
          cursor: { next: FIRST_CURSOR, hasMore: true },
        }),
      {
        maxPages: 2,
        observer: collectingObserver(returnedEvents),
      },
    );

    await returnedIterator.next();
    await returnedIterator.return(undefined);
    await returnedIterator.return(undefined);
    await returnedIterator.next();

    expect(returnedEvents.map(({ phase }) => phase)).toEqual(['start', 'abort']);

    const completedEvents: OperationEvent[] = [];
    const completedIterator = iteratePages(
      () => Promise.resolve({ data: [] }),
      {
        maxPages: 1,
        observer: collectingObserver(completedEvents),
      },
    );

    await completedIterator.next();
    await completedIterator.return(undefined);
    await completedIterator.return(undefined);

    expect(completedEvents.map(({ phase }) => phase)).toEqual([
      'start',
      'success',
    ]);
  });
});
