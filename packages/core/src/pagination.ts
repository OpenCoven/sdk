import {
  createOperationScope,
  isOperationAbortedError,
  isOperationTimeoutError,
  OperationConfigurationError,
  type OperationOptions,
} from './operation-control.js';
import {
  normalizeOperationEventError,
  notifyOperationObserver,
  operationDuration,
} from './operation-events.js';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_CHARACTERS = 512;
const BASE64URL_CURSOR_RE = /^[A-Za-z0-9_-]{1,512}$/u;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PAGINATION_DESCRIPTOR = {
  system: 'sdk',
  operation: 'iteratePages',
} as const;

export interface PageOptions {
  limit?: number;
  cursor?: string;
}

export interface PageCursor {
  current?: string;
  next?: string;
  previous?: string;
  hasMore: boolean;
}

export interface Page<T> {
  data: readonly T[];
  cursor?: PageCursor;
}

export type BoundedPageOptions = PageOptions &
  OperationOptions &
  (
    | { maxPages: number }
    | { signal: AbortSignal; maxPages?: number }
  );

interface NormalizedPageOptions {
  limit: number;
  cursor?: string;
}

class PaginationResponseError extends Error {
  readonly code = 'invalid_response';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'PaginationResponseError';
  }
}

function invalidOptions(message: string): OperationConfigurationError {
  return new OperationConfigurationError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCursor(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE64URL_CURSOR_RE.test(value)) {
    return false;
  }

  const trailingCharacters = value.length % 4;
  if (trailingCharacters === 1) {
    return false;
  }
  if (trailingCharacters === 0) {
    return true;
  }

  const trailingValue = BASE64URL_ALPHABET.indexOf(
    value.charAt(value.length - 1),
  );
  const canonicalMultiple = trailingCharacters === 2 ? 16 : 4;
  return trailingValue % canonicalMultiple === 0;
}

function validateMaxPages(maxPages: unknown): asserts maxPages is number | undefined {
  if (
    maxPages !== undefined &&
    (typeof maxPages !== 'number' ||
      !Number.isSafeInteger(maxPages) ||
      maxPages <= 0)
  ) {
    throw invalidOptions('maxPages must be a positive safe integer');
  }
}

function validatePageCursor(cursor: unknown): asserts cursor is PageCursor | undefined {
  if (cursor === undefined) {
    return;
  }
  if (!isObject(cursor) || typeof cursor.hasMore !== 'boolean') {
    throw new PaginationResponseError('page cursor was malformed');
  }
  for (const key of ['current', 'next', 'previous'] as const) {
    const value = cursor[key];
    if (value !== undefined && !isCursor(value)) {
      throw new PaginationResponseError(`page cursor ${key} was malformed`);
    }
  }
}

function validatePage<T>(page: unknown): asserts page is Page<T> {
  if (!isObject(page) || !Array.isArray(page.data)) {
    throw new PaginationResponseError('page response was malformed');
  }
  validatePageCursor(page.cursor);
}

function ensureActive(scope: ReturnType<typeof createOperationScope>): void {
  if (scope.context.signal.aborted) {
    throw scope.context.signal.reason;
  }
}

export function normalizePageOptions(
  options: PageOptions = {},
): NormalizedPageOptions {
  if (!isObject(options)) {
    throw invalidOptions('page options must be an object');
  }

  const requestedLimit: unknown = options.limit;
  const limit =
    requestedLimit === undefined ? DEFAULT_PAGE_LIMIT : requestedLimit;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_PAGE_LIMIT
  ) {
    throw invalidOptions(
      `limit must be a positive safe integer no greater than ${MAX_PAGE_LIMIT}`,
    );
  }

  if (options.cursor !== undefined && !isCursor(options.cursor)) {
    throw invalidOptions(
      `cursor must use canonical base64url spelling and be no longer than ${MAX_CURSOR_CHARACTERS} characters`,
    );
  }

  return options.cursor === undefined
    ? { limit }
    : { limit, cursor: options.cursor };
}

async function* generatePages<T>(
  readPage: (options: NormalizedPageOptions) => Promise<Page<T>>,
  normalized: NormalizedPageOptions,
  operationOptions: OperationOptions,
  maxPages: number | undefined,
): AsyncGenerator<T> {
  const scope = createOperationScope(PAGINATION_DESCRIPTOR, {
    signals:
      operationOptions.signal === undefined ? [] : [operationOptions.signal],
    ...(operationOptions.timeoutMs === undefined
      ? {}
      : { timeoutMs: operationOptions.timeoutMs }),
  });
  const startedAt = performance.now();
  const seenCursors = new Set<string>();
  let cursor = normalized.cursor;
  let pagesRead = 0;

  if (cursor !== undefined) {
    seenCursors.add(cursor);
  }

  try {
    notifyOperationObserver(operationOptions.observer, {
      phase: 'start',
      system: PAGINATION_DESCRIPTOR.system,
      operation: PAGINATION_DESCRIPTOR.operation,
    });

    try {
      while (maxPages === undefined || pagesRead < maxPages) {
        ensureActive(scope);
        const readOptions =
          cursor === undefined
            ? { limit: normalized.limit }
            : { limit: normalized.limit, cursor };
        const page = await Promise.race([
          Promise.resolve().then(() => readPage(readOptions)),
          scope.termination,
        ]);
        ensureActive(scope);
        validatePage<T>(page);
        pagesRead += 1;

        for (const item of page.data) {
          ensureActive(scope);
          yield item;
          ensureActive(scope);
        }

        if (page.cursor === undefined || !page.cursor.hasMore) {
          ensureActive(scope);
          break;
        }

        const next = page.cursor.next;
        if (next === undefined) {
          throw new PaginationResponseError(
            'page cursor next was required when hasMore was true',
          );
        }
        if (next === page.cursor.current || seenCursors.has(next)) {
          throw new PaginationResponseError('page cursor did not advance');
        }
        if (pagesRead >= (maxPages ?? Number.POSITIVE_INFINITY)) {
          ensureActive(scope);
          break;
        }

        seenCursors.add(next);
        cursor = next;
      }
    } catch (error) {
      const phase = isOperationTimeoutError(error)
        ? 'timeout'
        : isOperationAbortedError(error)
          ? 'abort'
          : 'failure';
      notifyOperationObserver(operationOptions.observer, {
        phase,
        system: PAGINATION_DESCRIPTOR.system,
        operation: PAGINATION_DESCRIPTOR.operation,
        durationMs: operationDuration(startedAt),
        error: normalizeOperationEventError(
          error,
          PAGINATION_DESCRIPTOR.system,
          PAGINATION_DESCRIPTOR.operation,
        ),
      });
      throw error;
    }
    notifyOperationObserver(operationOptions.observer, {
      phase: 'success',
      system: PAGINATION_DESCRIPTOR.system,
      operation: PAGINATION_DESCRIPTOR.operation,
      durationMs: operationDuration(startedAt),
    });
  } finally {
    scope.dispose();
  }
}

export function iteratePages<T>(
  readPage: (options: NormalizedPageOptions) => Promise<Page<T>>,
  options: BoundedPageOptions,
): AsyncGenerator<T> {
  if (typeof readPage !== 'function') {
    throw invalidOptions('readPage must be a function');
  }
  if (!isObject(options)) {
    throw invalidOptions('bounded page options must be an object');
  }

  const maxPages = options.maxPages;
  validateMaxPages(maxPages);
  const signal = options.signal;
  if (maxPages === undefined && signal === undefined) {
    throw invalidOptions('iteration requires maxPages or a caller-owned signal');
  }
  const timeoutMs = options.timeoutMs;
  const observer = options.observer;
  const operationOptions: OperationOptions = {
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(observer === undefined ? {} : { observer }),
  };

  const validationScope = createOperationScope(PAGINATION_DESCRIPTOR, {
    signals: signal === undefined ? [] : [signal],
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  validationScope.dispose();

  const limit = options.limit;
  const cursor = options.cursor;
  const pageOptions: PageOptions = {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };

  return generatePages(
    readPage,
    normalizePageOptions(pageOptions),
    operationOptions,
    maxPages,
  );
}
