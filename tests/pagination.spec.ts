import {
  iteratePages,
  normalizePageOptions,
  type BoundedPageOptions,
  type Page,
} from '@opencoven/sdk-core';
import { describe, expect, test, vi } from 'vitest';

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

describe('page option normalization', () => {
  test('defaults the page limit to 50', () => {
    expect(normalizePageOptions()).toEqual({ limit: 50 });
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

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxPages %s',
    (maxPages) => {
      expect(() =>
        iteratePages(() => Promise.resolve({ data: [] }), { maxPages }),
      ).toThrow(expect.objectContaining({ code: 'invalid_options' }));
    },
  );

  test('iterates an empty page', async () => {
    const readPage = vi.fn(() =>
      Promise.resolve({
        data: [],
        cursor: { hasMore: false },
      }),
    );

    await expect(collect(iteratePages(readPage, { maxPages: 1 }))).resolves.toEqual(
      [],
    );
    expect(readPage).toHaveBeenCalledOnce();
    expect(readPage).toHaveBeenCalledWith({ limit: 50 });
  });

  test('iterates exactly one page when hasMore is false', async () => {
    const readPage = vi.fn(() =>
      Promise.resolve({
        data: ['one', 'two'],
        cursor: { hasMore: false },
      }),
    );

    await expect(
      collect(iteratePages(readPage, { limit: 25, maxPages: 5 })),
    ).resolves.toEqual(['one', 'two']);
    expect(readPage).toHaveBeenCalledOnce();
    expect(readPage).toHaveBeenCalledWith({ limit: 25 });
  });

  test('iterates multiple pages until hasMore is false', async () => {
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
          cursor: { current: SECOND_CURSOR, hasMore: false },
        });
      },
    );

    await expect(
      collect(iteratePages(readPage, { limit: 10, maxPages: 4 })),
    ).resolves.toEqual(['one', 'two', 'three']);
    expect(readPage.mock.calls).toEqual([
      [{ limit: 10 }],
      [{ limit: 10, cursor: FIRST_CURSOR }],
      [{ limit: 10, cursor: SECOND_CURSOR }],
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
      (options: { limit: number; cursor?: string }): Promise<Page<string>> =>
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
    expect(readPage).toHaveBeenCalledWith({
      limit: 50,
      cursor: SECOND_CURSOR,
    });
  });
});
