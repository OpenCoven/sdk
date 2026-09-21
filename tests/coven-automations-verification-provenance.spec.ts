import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { verifyReceipt } from '@opencoven/coven-client';
import { expect, test } from 'vitest';

const root = new URL('../packages/coven/fixtures/automations-receipt-v1/', import.meta.url);
const read = (file: string): string => readFileSync(new URL(file, root), 'utf8');
interface Schema {
  $ref?: string;
  $defs?: Record<string, Schema>;
  properties?: Record<string, Schema>;
  required?: string[];
  enum?: unknown[];
  items?: Schema;
}
const schema = JSON.parse(read('automation-receipt.schema.json')) as Schema;
const common = JSON.parse(read('common.schema.json')) as Schema;
const vectors = JSON.parse(read('receipt-integrity-validation.vectors.json')) as {
  cases: { receipt: Record<string, unknown> }[];
};
const receipt = vectors.cases[0]!.receipt;
const context = {
  receiptId: receipt.receiptId as string, automationId: receipt.automationId as string,
  automationRevision: receipt.automationRevision as number, occurrenceId: receipt.occurrenceId as string,
  runId: receipt.runId as string, attemptId: receipt.attemptId as string, familiarId: 'charm',
};

test('pins the exact canonical schema, vectors and executable source provenance', () => {
  const manifest = JSON.parse(read('manifest.provenance.json')) as {
    repository: string; commit: string;
    files: { file: string; sourcePath: string; sha256: string }[];
    sources: { sourcePath: string; sha256: string }[];
  };
  expect(manifest.repository).toBe('https://github.com/OpenCoven/coven');
  expect(manifest.commit).toBe('aa28d994965a83c0dfba8eaca071e182d605fed1');
  const hashes = {
    'automation-receipt.schema.json': '8c50cd955e43cef1649e384bd9aa48b3e4214db989e9ba4e3e704aad19cb1fc7',
    'common.schema.json': '891933e8d88110eb19336ef7b268554be05352d5150ae0f45a6a41b814ef75e6',
    'receipt-integrity-validation.vectors.json': '10ca288e3f3b897abcdf11b8581dfc317b3582f6fb2eaffd988fdf91d67012d3',
  };
  expect(manifest.files).toHaveLength(3);
  for (const file of manifest.files) {
    expect(file.sha256).toBe(hashes[file.file as keyof typeof hashes]);
    expect(createHash('sha256').update(read(file.file)).digest('hex')).toBe(file.sha256);
    expect(file.sourcePath).toBe(file.file.endsWith('vectors.json')
      ? `conformance/automations/runner/${file.file}` : `spec/coven-automations/v1/${file.file}`);
  }
  expect(manifest.sources).toEqual([
    { sourcePath: 'crates/coven-cli/src/automations/contract/types.rs', sha256: 'e9eaca6922cec465544bcb69dc6e5e07458d6779af6b635d9916118f84455d72' },
    { sourcePath: 'crates/coven-cli/src/automations/contract/canonical_json.rs', sha256: '5ba05768c9c303294da4b2d6005781afbf51a7447696363bc96e4c15e61e3be2' },
    { sourcePath: 'crates/coven-cli/src/automations/receipts.rs', sha256: 'd56fce1ec5aa56f030eabc65387f8721543f111d68e4b96d255fb1838a68a774' },
    { sourcePath: 'crates/coven-cli/src/control_plane.rs', sha256: '57155ca118b4520c3abab4ea5b3968a89e0164f394e46e308a17e37749772e34' },
  ]);
});

test('mechanically covers every schema field, required property, closed object and supported enum', () => {
  const digest = receipt.definitionDigest;
  const full = {
    ...receipt, deliveryDigest: digest, resultDigest: digest,
    authority: { principal: { principalId: 'owner:local', displayName: '' }, approval: { approvalPolicyRef: 'policy', approvalRecordRef: '' } },
    runtime: { runtimeId: 'runtime', capabilities: ['read'], model: '' },
    outcome: { disposition: 'failed', failureClass: '', detail: '', partialFailures: [{ step: 'step', reason: 'reason', recovered: false }], recoveryDisposition: 'not_required' },
    privacy: { classification: 'public', retention: { classification: 'extended', deleteAfter: '2026-09-20T00:00:00Z' }, notes: '' },
  };
  expect(verifyReceipt(full, context).schema).toBe('valid');
  const changed = (path: string[], value: unknown, remove = false): unknown => {
    const clone = structuredClone(full) as Record<string, unknown>;
    let parent = clone;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    if (remove) delete parent[path.at(-1)!];
    else parent[path.at(-1)!] = value;
    return clone;
  };
  let checked = 0;
  const walk = (node: Schema, value: unknown, path: string[]): void => {
    if (node.$ref !== undefined) {
      const name = node.$ref.split('/').at(-1)!;
      expect(common.$defs).toHaveProperty(name);
      return walk(common.$defs![name]!, value, path);
    }
    if (node.properties !== undefined) {
      const record = value as Record<string, unknown>;
      expect(Object.keys(record).sort(), path.join('.')).toEqual(Object.keys(node.properties).sort());
      expect(verifyReceipt(changed([...path, 'unsupported'], true), context).schema).toBe('invalid');
      for (const [key, child] of Object.entries(node.properties)) {
        checked++;
        const removed = verifyReceipt(changed([...path, key], undefined, true), context).schema;
        expect(removed, [...path, key].join('.')).toBe(node.required?.includes(key) === true ? 'invalid' : 'valid');
        expect(verifyReceipt(changed([...path, key], null), context).schema).toBe('invalid');
        walk(child, record[key], [...path, key]);
      }
    } else if (node.enum !== undefined) {
      for (const variant of node.enum) {
        const unsupportedPrivacy = path.join('.') === 'privacy.classification' && (variant === 'sensitive' || variant === 'restricted');
        expect(verifyReceipt(changed(path, variant), context).schema).toBe(unsupportedPrivacy ? 'invalid' : 'valid');
      }
    } else if (node.items !== undefined) {
      const array = value as unknown[];
      if (array.length > 0) walk(node.items, array[0], [...path, '0']);
    }
  };
  walk(schema, full, []);
  expect(checked).toBeGreaterThan(60);
});
