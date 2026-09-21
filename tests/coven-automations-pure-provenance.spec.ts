import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { computeDefinitionDigest, type CovenAutomationDefinitionDocument } from '@opencoven/coven-client';
import { expect, expectTypeOf, test } from 'vitest';
import type { AutomationDefinition } from '../packages/coven/fixtures/automations-events-v1/coven.automations.v1.js';
import manifest from '../packages/coven/fixtures/automations-pure-v1/manifest.provenance.json' with { type: 'json' };
import vectors from '../packages/coven/fixtures/automations-pure-v1/test-vectors.json' with { type: 'json' };
import sourceSchema from '../packages/coven/fixtures/automations-pure-v1/automation-definition.schema.json' with { type: 'json' };
import sourceCommon from '../packages/coven/fixtures/automations-events-v1/common.schema.json' with { type: 'json' };
import machines from '../packages/coven/fixtures/automations-pure-v1/state-machines.json' with { type: 'json' };

const hashes = {
  'automation-definition.schema.json': '5b369bb5fd69de356b96c521aa7c7b79b847514f94fc03633d33c44f864bd91a',
  'test-vectors.json': 'b6f6c663b28084b29caf4f46ee988efa097ac1ca96af63ee08debbe1b6968dd7',
  'state-machines.json': '2cef95d98b945cd11fb362abd736c5fe6901bea8621083819d66fa61d849dc94',
  'definition-validation.vectors.json': 'cfe1f9bb680b4f5b5bb28812b56d6c17828c8fa4858b523268208c56038abefa',
  '../automations-events-v1/event-envelope.schema.json': '9eb27e62d6133bb506bdf311a74208689e502397cc1d73a3cf8963f9d5610a30',
  '../automations-events-v1/common.schema.json': '891933e8d88110eb19336ef7b268554be05352d5150ae0f45a6a41b814ef75e6',
  '../automations-events-v1/coven.automations.v1.d.ts': 'dff07129d244d1b8aa2f04315696814aea64087410f96066fa1ebd47f6755ad7',
  '../automations-events-v1/event-reducer-determinism.vectors.json': '416238d7b52f741630be9be80212f18c03b39d8cd237b1cc2d147cbcd4dd46f9',
};

test('pins exact producer schemas, vectors, declarations and executable source identity', () => {
  expect(manifest.commit).toBe('aa28d994965a83c0dfba8eaca071e182d605fed1');
  expect(manifest.repository).toBe('https://github.com/OpenCoven/coven');
  expect([...manifest.files, ...manifest.reusedFiles]).toHaveLength(Object.keys(hashes).length);
  for (const file of [...manifest.files, ...manifest.reusedFiles]) {
    expect(file.sha256).toBe(hashes[file.file as keyof typeof hashes]);
    expect(createHash('sha256').update(readFileSync(new URL(`../packages/coven/fixtures/automations-pure-v1/${file.file}`, import.meta.url))).digest('hex'))
      .toBe(file.sha256);
  }
  expect(manifest.sources).toEqual([
    { sourcePath: 'crates/coven-cli/src/automations/contract/events.rs', sha256: '9ff8f9b7b7b6e3586ad29b207cc87cbde24167e6fb74220d31d3212cb4b035ee' },
    { sourcePath: 'crates/coven-cli/src/automations/contract/types.rs', sha256: 'e9eaca6922cec465544bcb69dc6e5e07458d6779af6b635d9916118f84455d72' },
    { sourcePath: 'crates/coven-cli/src/automations/contract/canonical_json.rs', sha256: '5ba05768c9c303294da4b2d6005781afbf51a7447696363bc96e4c15e61e3be2' },
    { sourcePath: 'crates/coven-cli/src/automations/conformance_target.rs', sha256: 'e2a734cf602ab3c8abaef4dad24b97ced461625871ed3c3240fe418dc533a336' },
  ]);
});

type ReadonlyJson<T> = T extends object ? { readonly [P in keyof T]: ReadonlyJson<T[P]> } : T;
type WireDefinition = Omit<AutomationDefinition, 'binding' | 'policies' | 'trigger'> & {
  binding: Omit<AutomationDefinition['binding'], 'familiarId'> & { familiarId?: string };
  policies: Omit<AutomationDefinition['policies'], 'delivery'> & { delivery?: { outputTarget?: string; mode?: 'atomic' } };
  trigger: { variant: 'schedule'; version: 1; schedule: { rrule: string; timezone: string } };
};
test('complete readonly types match pinned fields with only documented executable wire corrections', () => {
  expectTypeOf<CovenAutomationDefinitionDocument>().toExtend<ReadonlyJson<WireDefinition>>();
  expectTypeOf<ReadonlyJson<WireDefinition>>().toExtend<CovenAutomationDefinitionDocument>();
});

interface Schema {
  $ref?: string; oneOf?: Schema[]; $defs?: Record<string, Schema>; properties?: Record<string, Schema>; required?: string[];
  enum?: unknown[]; const?: unknown; items?: Schema; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; maxItems?: number; uniqueItems?: boolean;
}
const schema = sourceSchema as Schema;
const common = sourceCommon as Schema;
const full: Record<string, unknown> = {
  ...vectors.fixtures['definition.golden'], lifecycleState: 'draft',
  deletion: { tombstoned: true, requestedAt: '2026-09-20T00:00:00Z', requestedBy: { principalId: 'owner:local', displayName: '' }, reason: '' },
  display: { name: 'Definition', description: '', tags: ['tag'] },
  runtimeRequirements: { runtimeId: 'runtime', capabilities: ['read'], model: '' },
  binding: { familiarBindingPolicy: 'exact', familiarId: 'charm', authority: { approvalPolicyRef: 'policy', approvalRecordRef: '' } },
  policies: {
    timeout: { perRunMinutes: 1 }, retry: { maxAttempts: 1, backoffPolicy: 'none', backoffSeconds: 1, retryableClasses: ['transient_dispatch'] },
    concurrency: { overlap: 'forbid' }, misfire: { disposition: 'latest' }, delivery: { outputTarget: '', mode: 'atomic' },
    retention: { occurrenceHistory: { classification: 'standard', deleteAfter: '2026-09-20T00:00:00Z' },
      runLogs: { classification: 'standard', deleteAfter: '2026-09-20T00:00:00Z' }, receipts: { classification: 'extended', deleteAfter: '2026-09-20T00:00:00Z' } },
  },
  provenance: { createdBy: { principalId: 'owner:local', displayName: '' }, createdAt: '2026-09-20T00:00:00Z',
    updatedBy: { principalId: 'owner:local', displayName: '' }, updatedAt: '2026-09-20T00:00:00Z', importedFrom: '' },
  activation: { effectiveFrom: '2026-09-20T00:00:00Z', effectiveUntil: '2026-09-20T00:00:00Z' }, extensions: { 'x-value': 0.5 },
};
const changed = (path: string[], value: unknown, remove = false): unknown => {
  const clone = structuredClone(full);
  let parent = clone;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  if (remove) delete parent[path.at(-1)!];
  else parent[path.at(-1)!] = value;
  return clone;
};

test('mechanically covers every definition field, closed object, enum and structural bound', () => {
  expect(computeDefinitionDigest(full).status).toBe('computed');
  let checked = 0;
  const walk = (node: Schema, value: unknown, path: string[]): void => {
    if (node.$ref !== undefined) {
      const container = node.$ref.startsWith('common.') ? common : schema;
      const name = node.$ref.split('/').at(-1)!;
      // Common definitions reference other common definitions with a local fragment.
      return walk((container.$defs?.[name] ?? common.$defs?.[name])!, value, path);
    }
    if (node.oneOf !== undefined) {
      expect(node.oneOf).toHaveLength(1);
      return walk(node.oneOf[0]!, value, path);
    }
    if (node.properties !== undefined) {
      expect(Object.keys(value as object).sort(), path.join('.')).toEqual(Object.keys(node.properties).sort());
      expect(computeDefinitionDigest(changed([...path, 'unknown'], true)).status, path.join('.')).toBe('invalid');
      for (const [key, child] of Object.entries(node.properties)) {
        checked++;
        const required = node.required?.includes(key) === true || [...path, key].join('.') === 'policies.delivery.mode';
        expect(computeDefinitionDigest(changed([...path, key], undefined, true)).status, [...path, key].join('.'))
          .toBe(required ? 'invalid' : 'computed');
        expect(computeDefinitionDigest(changed([...path, key], null)).status, [...path, key].join('.')).toBe('invalid');
        walk(child, (value as Record<string, unknown>)[key], [...path, key]);
      }
    }
    for (const variant of node.enum ?? []) expect(computeDefinitionDigest(changed(path, variant)).status, path.join('.')).toBe('computed');
    if (node.enum !== undefined || node.const !== undefined) expect(computeDefinitionDigest(changed(path, 'unsupported')).status).toBe('invalid');
    if (node.minimum !== undefined) expect(computeDefinitionDigest(changed(path, node.minimum - 1)).status).toBe('invalid');
    if (node.maximum !== undefined) expect(computeDefinitionDigest(changed(path, node.maximum + 1)).status).toBe('invalid');
    if (node.minLength !== undefined && node.minLength > 0) expect(computeDefinitionDigest(changed(path, '')).status).toBe('invalid');
    if (node.maxLength !== undefined) expect(computeDefinitionDigest(changed(path, 'a'.repeat(node.maxLength + 1))).status).toBe('invalid');
    if (node.maxItems !== undefined) expect(computeDefinitionDigest(changed(path, Array.from({ length: node.maxItems + 1 }, (_, i) => String(i)))).status).toBe('invalid');
    if (Array.isArray(value) && value.length > 0 && node.items !== undefined) {
      if (node.uniqueItems === true) expect(computeDefinitionDigest(changed(path, [value[0], value[0]])).status).toBe('invalid');
      walk(node.items, value[0], [...path, '0']);
    }
  };
  walk(schema, full, []);
  expect(checked).toBe(80);
});

test('pins the occurrence terminal vocabulary without claiming adjacency validation', () => {
  expect(machines.machines.find((machine) => machine.id === 'occurrence.v1')?.terminalStates)
    .toEqual(['succeeded', 'failed', 'cancelled', 'timed_out', 'skipped', 'superseded']);
});
