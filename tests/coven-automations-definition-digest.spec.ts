import { computeDefinitionDigest } from '@opencoven/coven-client';
import { expect, test } from 'vitest';

import vectors from '../packages/coven/fixtures/automations-pure-v1/test-vectors.json' with { type: 'json' };

const golden = vectors.fixtures['definition.golden'];
const digest = computeDefinitionDigest;
const changed = (path: string[], value: unknown, remove = false): unknown => {
  const input = structuredClone(golden) as unknown as Record<string, unknown>;
  let parent = input;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  if (remove) delete parent[path.at(-1)!];
  else parent[path.at(-1)!] = value;
  return input;
};

test('computes the exact normative golden body digest without normalization', () => {
  expect(digest(golden)).toEqual({ status: 'computed', digest: golden.integrity });
});

test('excludes only top-level integrity and covers the prompt and nested extension integrity', () => {
  expect(digest(changed(['integrity', 'value'], 'a'.repeat(64)))).toEqual(digest(golden));
  expect(digest(changed(['action', 'prompt'], 'changed'))).not.toEqual(digest(golden));
  expect(digest(changed(['extensions'], { 'x-proof': { integrity: 'a' } })))
    .not.toEqual(digest(changed(['extensions'], { 'x-proof': { integrity: 'b' } })));
});

test.each([
  [['schemaVersion'], 'coven.automations.v2'], [['revision'], 0], [['revision'], 1.5],
  [['lifecycleState'], 'tombstoned'], [['trigger', 'variant'], 'webhook'],
  [['trigger', 'schedule', 'timezone'], 'local'], [['action', 'prompt'], ''],
  [['conditions'], [{}]], [['binding', 'familiarBindingPolicy'], 'any'],
  [['policies', 'timeout', 'perRunMinutes'], 44641], [['policies', 'retry', 'maxAttempts'], 11],
  [['policies', 'retry', 'backoffPolicy'], 'unknown'], [['policies', 'concurrency', 'overlap'], 'allow'],
  [['policies', 'misfire', 'disposition'], 'all'], [['display', 'tags'], ['duplicate', 'duplicate']],
  [['runtimeRequirements', 'capabilities'], ['duplicate', 'duplicate']], [['extensions'], { unnamespaced: true }],
] as const)('rejects malformed structural field %j', (path, value) => {
  expect(digest(changed([...path], value))).toEqual({ status: 'invalid', reason: 'INVALID_DEFINITION' });
});

test('honors draft optional bindings and executable conditional requirements', () => {
  const draft = structuredClone(golden) as unknown as Record<string, unknown>;
  draft.lifecycleState = 'draft';
  delete draft.runtimeRequirements;
  delete (draft.binding as Record<string, unknown>).familiarId;
  expect(digest(draft)).toMatchObject({ status: 'computed' });
  for (const state of ['active', 'paused', 'disabled']) {
    expect(digest({ ...draft, lifecycleState: state })).toMatchObject({ status: 'invalid' });
  }
  expect(digest(changed(['policies', 'delivery'], {}))).toMatchObject({ status: 'computed' });
  expect(digest(changed(['policies', 'delivery'], { outputTarget: '/tmp/example' }))).toMatchObject({ status: 'invalid' });
  expect(digest(changed(['policies', 'retry'], { maxAttempts: 1, backoffPolicy: 'fixed' }))).toMatchObject({ status: 'invalid' });
});

test('accepts finite opaque JSON fractions while rejecting unsafe integers and host values', () => {
  expect(digest(changed(['extensions'], { 'x-json': [1.5, -0, 1e-7, null, true] }))).toMatchObject({ status: 'computed' });
  for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, 1n, Symbol('secret')]) {
    expect(digest(changed(['extensions'], { 'x-json': value }))).toEqual({ status: 'invalid', reason: 'INVALID_DEFINITION' });
  }
});

test('owns input without freezing or mutating the caller and returns immutable values', () => {
  const input = structuredClone(golden);
  const before = structuredClone(input);
  const result = digest(input) as { digest: object };
  expect(input).toEqual(before);
  expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.digest)).toBe(true);
});

test('refuses legacy get projections and accessors without secret disclosure', () => {
  expect(digest({ routine: golden, revision: 1, tombstonedAt: null })).toMatchObject({ status: 'invalid' });
  let invoked = false;
  const input = { ...golden, get display() { invoked = true; throw new Error('secret'); } };
  expect(digest(input)).toEqual({ status: 'invalid', reason: 'INVALID_DEFINITION' });
  expect(invoked).toBe(false);
});

for (const entry of vectors.cases) {
  if ('targetSchema' in entry && entry.targetSchema === 'automation-definition.schema.json' && 'object' in entry) {
    test(`producer structural vector: ${entry.name}`, () => {
      expect(digest(entry.object).status).toBe(entry.expected === 'accept' ? 'computed' : 'invalid');
    });
  }
}
