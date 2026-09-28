import { normalizePageOptions } from '@opencoven/sdk-core';

import { object } from './automations-read-validation.js';

/** Largest history response accepted: room for 100 records, far above the 16 KiB read cap. */
export const AUTOMATION_HISTORY_MAX_BYTES = 262_144;

/** A keyset history page's position, shaped as an sdk-core `PageCursor`. */
export interface CovenAutomationHistoryCursor {
  readonly hasMore: boolean;
  /** The cursor this page was read from; absent on the first page. */
  readonly current?: string;
  readonly next?: string;
}

/**
 * A cursor sdk-core would accept (canonical unpadded base64url, at most 512
 * characters) that also fits the action's own `maxLength`.
 */
export function historyCursor(value: unknown, maxLength = 512): value is string {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  try {
    normalizePageOptions({ cursor: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The producer's history sort key: the timestamp with its fraction padded to
 * nine digits, so millisecond and nanosecond rows order by instant. Mirrors
 * the SQL expression character for character.
 */
function historySortKey(timestamp: string): Buffer {
  const characters = Array.from(timestamp);
  const fraction = characters.slice(20).join('').replace(/Z+$/u, '');
  return Buffer.from(`${characters.slice(0, 19).join('')}.${Array.from(`${fraction}000000000`).slice(0, 9).join('')}Z`);
}

/** Strictly newest first by instant, then id, compared as SQLite does: by bytes. */
export function newestFirst<T>(rows: readonly T[], instant: (row: T) => string, id: (row: T) => string): boolean {
  return rows.every((row, index) => {
    if (index === 0) return true;
    const previous = rows[index - 1]!;
    const order = Buffer.compare(historySortKey(instant(previous)), historySortKey(instant(row)));
    return order > 0 || (order === 0 && Buffer.compare(Buffer.from(id(previous)), Buffer.from(id(row))) > 0);
  });
}

/**
 * Validates a page's `cursor` against the request: `current` echoes the
 * requested cursor, `next` is a fresh cursor exactly when `hasMore`, and a
 * page claiming more is full.
 */
export function historyPageCursor(
  position: unknown,
  cursor: string | undefined,
  rows: number,
  limit: number,
  maxLength = 512,
): CovenAutomationHistoryCursor | undefined {
  if (!object(position) || typeof position.hasMore !== 'boolean' ||
    Reflect.ownKeys(position).some((key) => key !== 'hasMore' && key !== 'current' && key !== 'next') ||
    (cursor === undefined ? Object.hasOwn(position, 'current') : position.current !== cursor)) return undefined;
  if (position.hasMore
    ? !historyCursor(position.next, maxLength) || position.next === cursor || rows !== limit
    : Object.hasOwn(position, 'next')) return undefined;
  return {
    hasMore: position.hasMore,
    ...(cursor === undefined ? {} : { current: cursor }),
    ...(position.hasMore ? { next: position.next as string } : {}),
  };
}
