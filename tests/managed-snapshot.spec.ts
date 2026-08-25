import { performance } from 'node:perf_hooks';

import { describe, expect, test } from 'vitest';

import {
  snapshotManagedResult,
  snapshotManagedResultWithBudget,
} from '../packages/cave/src/managed-snapshot.js';

const NODE_BUDGET = 4_096;
const ENTRY_BUDGET = 131_072;
const ARRAY_ELEMENT_BUDGET = 65_536;

function diamond(depth: number): object {
  let node: object = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    node = { left: node, right: node };
  }
  return node;
}

describe('managed result snapshot resource limits', () => {
  test('rejects repeated identities, including cycles and diamond graphs', () => {
    const shared = { safe: true };
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(snapshotManagedResult({ left: shared, right: shared })).toBeUndefined();
    expect(snapshotManagedResult(cyclic)).toBeUndefined();
    expect(snapshotManagedResult(diamond(18))).toBeUndefined();
  });

  test('rejects global node and entry budget exhaustion deterministically', () => {
    const tooManyNodes = Array.from(
      { length: NODE_BUDGET + 1 },
      () => ({}),
    );
    const tooManyEntries = {
      left: Array.from({ length: ARRAY_ELEMENT_BUDGET }, () => 0),
      right: Array.from({ length: ARRAY_ELEMENT_BUDGET }, () => 0),
    };

    expect(snapshotManagedResult(tooManyNodes)).toBeUndefined();
    expect(snapshotManagedResult(tooManyEntries)).toBeUndefined();
  });

  test('rejects wide values and hostile proxies without throwing', () => {
    const wideArray = Array.from(
      { length: ARRAY_ELEMENT_BUDGET + 1 },
      () => 0,
    );
    const wideObject = Object.fromEntries(
      Array.from(
        { length: ENTRY_BUDGET + 1 },
        (_, index) => [`field${index}`, index],
      ),
    );
    const proxy = new Proxy({}, {
      ownKeys() {
        throw new Error('native bearer must not escape');
      },
    });

    expect(() => snapshotManagedResult(wideArray)).not.toThrow();
    expect(snapshotManagedResult(wideArray)).toBeUndefined();
    expect(() => snapshotManagedResult(wideObject)).not.toThrow();
    expect(snapshotManagedResult(wideObject)).toBeUndefined();
    expect(() => snapshotManagedResult(proxy)).not.toThrow();
    expect(snapshotManagedResult(proxy)).toBeUndefined();
  });

  test('rejects a depth-18 diamond without expanding it', () => {
    const startedAt = performance.now();
    const snapshot = snapshotManagedResult(diamond(18));
    const elapsedMs = performance.now() - startedAt;

    expect(snapshot).toBeUndefined();
    expect(elapsedMs).toBeLessThan(100);
  });

  test('returns immutable descriptor snapshots and exposes bounded failure categories', () => {
    const snapshot = snapshotManagedResult({
      nested: [null, true, 42, 'safe', new Uint8Array([1, 2, 3])],
    }) as {
      nested: readonly [null, boolean, number, string, readonly number[]];
    };
    expect(snapshot).toEqual({
      nested: [null, true, 42, 'safe', [1, 2, 3]],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.nested[4])).toBe(true);

    const accessor = {} as { value?: unknown };
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: () => 'native-only-bearer',
    });
    const sparse = new Array<unknown>(2);
    sparse[1] = 'sparse';
    expect(snapshotManagedResult(accessor)).toBeUndefined();
    expect(snapshotManagedResult(sparse)).toBeUndefined();
    expect(snapshotManagedResult(new Date())).toBeUndefined();
    expect(snapshotManagedResult(Object.create({ inherited: true }))).toBeUndefined();

    expect(
      snapshotManagedResultWithBudget(['one', 'two'], { maxArrayElements: 1 }),
    ).toEqual({ valid: false, limitExceeded: true });
    expect(
      snapshotManagedResultWithBudget({ one: 1, two: 2 }, { maxEntries: 1 }),
    ).toEqual({ valid: false, limitExceeded: true });
    expect(
      snapshotManagedResultWithBudget({ nested: {} }, { maxNodes: 1 }),
    ).toEqual({ valid: false, limitExceeded: true });
    expect(
      snapshotManagedResultWithBudget('toolong', { maxStringCodeUnits: 3 }),
    ).toEqual({ valid: false, limitExceeded: true });
    expect(
      snapshotManagedResultWithBudget(new Uint8Array([1, 2]), {
        maxTypedArrayElements: 1,
      }),
    ).toEqual({ valid: false, limitExceeded: true });
    expect(snapshotManagedResultWithBudget({}, { maxNodes: 0 })).toEqual({
      valid: false,
      limitExceeded: false,
    });
  });
});
