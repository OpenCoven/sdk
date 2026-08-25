import { performance } from 'node:perf_hooks';

import { describe, expect, test } from 'vitest';

import { snapshotManagedResult } from '../packages/cave/src/managed-snapshot.js';

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
});
