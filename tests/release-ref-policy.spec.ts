import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { isReleaseRef } from '../scripts/release-ref-policy.mjs';
import { parseReleaseWorkflowDocument } from '../scripts/release-readiness.mjs';
import { validateJsonSchemaValue } from '../scripts/conformance-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const workflow = parseReleaseWorkflowDocument(
  readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'),
);
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object in the release policy');
  }
  return value as Record<string, unknown>;
}
const schema = record(JSON.parse(
  readFileSync(resolve(root, 'conformance/release-artifact-manifest.schema.json'), 'utf8'),
));
const publication = record(record(schema.$defs).publicationArtifactSet);
const provenance = record(record(publication.properties).provenance);
const refSchema = record(record(provenance.properties).sourceRef);
const allowed = ['refs/heads/main', 'refs/heads/release/sdk-v0.0.1'];
const rejected = [
  'refs/heads/release',
  'refs/heads/release/sdk-v0.0.10',
  'refs/heads/release/sdk-v0.0.2',
  'refs/heads/release/sdk-v0.0.1/extra',
  'refs/heads/release/sdk-v0.0.1 ',
  'refs/heads/Release/sdk-v0.0.1',
  'refs/heads/Main',
  'refs/tags/release/sdk-v0.0.1',
  'refs/pull/1/merge',
  'release/sdk-v0.0.1',
  '',
];

describe('exact SDK publication refs', () => {
  test.each([...allowed, ...rejected])('enforces ref %j in runtime and workflow', (ref) => {
    const accepted = allowed.includes(ref);
    expect(isReleaseRef(ref)).toBe(accepted);
    const validateRef = () => validateJsonSchemaValue(ref, refSchema, 'sourceRef');
    if (accepted) {
      expect(validateRef).not.toThrow();
    } else {
      expect(validateRef).toThrow();
    }
    const preflight = record(record(workflow.jobs).preflight);
    if (!Array.isArray(preflight.steps)) {
      throw new Error('Missing preflight steps');
    }
    const step = preflight.steps.map(record).find(
      (entry) => entry.name === 'Require approved release ref',
    );
    expect(step).toBeDefined();
    if (step === undefined || typeof step.run !== 'string') {
      throw new Error('Missing executable release-ref preflight');
    }
    expect(step.if).toBeUndefined();
    const result = spawnSync('/bin/bash', ['-eu', '-c', step.run], {
      env: { PATH: process.env.PATH, GITHUB_REF: ref },
      encoding: 'utf8',
    });
    expect(result.status).toBe(accepted ? 0 : 1);
  });

  test('rejects non-string refs without coercion', () => {
    expect(isReleaseRef(null)).toBe(false);
    expect(isReleaseRef({ toString: () => allowed[0] })).toBe(false);
  });
});
