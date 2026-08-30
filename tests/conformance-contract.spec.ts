import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  parseAssertionRegistry,
  parseConformanceAggregationArgs,
  parsePlatformEvidence,
  readAssertionRegistry,
  readFrozenConformanceLock,
} from '../scripts/conformance-contract.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('cross-repository conformance contract entrypoints', () => {
  test('requires every checkout and exactly three platform records', () => {
    expect(
      parseConformanceAggregationArgs([
        '--',
        '--candidate-root',
        '../sdk-candidate',
        '--cave-root',
        '../coven-cave',
        '--coven-root',
        '../coven',
        '--chat-root',
        '../chat-source',
        '--harness-root',
        '../chat-harness',
        '--record',
        'darwin.json',
        '--record',
        'linux.json',
        '--record',
        'windows.json',
        '--out',
        'acc38488-evidence.json',
      ]),
    ).toEqual({
      candidateRoot: '../sdk-candidate',
      caveRoot: '../coven-cave',
      covenRoot: '../coven',
      chatRoot: '../chat-source',
      harnessRoot: '../chat-harness',
      recordPaths: ['darwin.json', 'linux.json', 'windows.json'],
      outputName: 'acc38488-evidence.json',
    });

    expect(() =>
      parseConformanceAggregationArgs([
        '--cave-root',
        '../cave',
        '--record',
        'darwin.json',
        '--record',
        'linux.json',
        '--record',
        'windows.json',
        '--out',
        'aggregate.json',
      ]),
    ).toThrow('Missing required option --candidate-root');
    expect(() =>
      parseConformanceAggregationArgs([
        '--candidate-root',
        '../sdk',
        '--cave-root',
        '../cave',
        '--coven-root',
        '../coven',
        '--chat-root',
        '../chat',
        '--harness-root',
        '../harness',
        '--record',
        'one.json',
        '--out',
        'aggregate.json',
      ]),
    ).toThrow('exactly three --record values');
    expect(() =>
      parseConformanceAggregationArgs([
        '--candidate-root',
        '../sdk',
        '--cave-root',
        '../cave',
        '--coven-root',
        '../coven',
        '--chat-root',
        '../chat',
        '--harness-root',
        '../harness',
        '--record',
        'darwin.json',
        '--record',
        'linux.json',
        '--record',
        'windows.json',
        '--out',
        '../aggregate.json',
      ]),
    ).toThrow('--out must be a canonical JSON filename, not a path');
  });

  test('rejects oversized, duplicate-key, and incomplete platform JSON', () => {
    expect(() =>
      parsePlatformEvidence(' '.repeat(1_048_577), 'large.json'),
    ).toThrow('large.json exceeds the 1048576-byte limit');
    expect(() =>
      parsePlatformEvidence(
        '{"schemaVersion":2,"schemaVersion":2}',
        'duplicate.json',
      ),
    ).toThrow('duplicate.json contains duplicate JSON object key "schemaVersion"');
    expect(() =>
      parsePlatformEvidence('{"schemaVersion":2}', 'partial.json'),
    ).toThrow('partial.json is missing JSON Schema property "issue"');
  });

  test('locks registry provenance, Cave IDs, subjects, and exclusions', () => {
    const lock = readFrozenConformanceLock(
      resolve(
        workspaceRoot,
        'conformance/client-v1-cross-repository-lock.json',
      ),
    );
    const registry = readAssertionRegistry(
      resolve(
        workspaceRoot,
        'conformance/client-v1-cross-repository-assertions.json',
      ),
    );

    expect(registry.provenance.commit).toBe(lock.sources.cave.commit);
    expect(registry.provenance.tree).toBe(lock.sources.cave.tree);
    expect(registry.provenance.engine).toEqual(lock.sources.cave.files[0]);
    expect(registry.requiredSubjects).toEqual(['cave', 'coven', 'sdk', 'chat']);
    expect(registry.assertions.cave).toHaveLength(110);
    expect(registry.assertions.sdk).toContain(
      'sdk.cave.revocation.messages-refused',
    );
    expect(registry.assertions.chat.common).toContain(
      'chat.cave.bearer-never-enters-webview',
    );
    expect(registry.notCovered.map(({ scopeId }) => scopeId)).toEqual([
      'cross-process-pairing',
      'oauth-ui',
      'remote-peer',
      'write-apis',
    ]);

    const unexpected = JSON.parse(
      readFileSync(
        resolve(
          workspaceRoot,
          'conformance/client-v1-cross-repository-assertions.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    unexpected.extra = true;
    expect(() =>
      parseAssertionRegistry(JSON.stringify(unexpected), 'unexpected registry'),
    ).toThrow('unexpected field "extra"');
  });

  test('ships the schema, frozen lock, command, and no synthetic result', () => {
    const schema = JSON.parse(
      readFileSync(
        resolve(
          workspaceRoot,
          'conformance/client-v1-cross-repository-evidence.schema.json',
        ),
        'utf8',
      ),
    ) as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      title?: string;
    };
    expect(schema.title).toBe(
      'OpenCoven Client v1 cross-repository platform evidence',
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toHaveProperty('provenance');
    expect(schema.properties).toHaveProperty('harness');
    expect(schema.properties).toHaveProperty('scans');

    const manifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.['conformance:aggregate']).toBe(
      'node ./scripts/aggregate-client-v1-conformance.mjs',
    );
    expect(manifest.scripts?.['test:conformance-contract']).toBe(
      'vitest run tests/conformance-contract.spec.ts tests/conformance-cli-security.spec.ts tests/conformance-gaps.spec.ts tests/conformance-checkouts-publication.spec.ts',
    );

    const resultsReadme = readFileSync(
      resolve(
        workspaceRoot,
        'docs/client-v1-cross-repository-results/README.md',
      ),
      'utf8',
    );
    expect(resultsReadme).toContain('There is no passing record yet.');

    const workflowDocument = readFileSync(
      resolve(
        workspaceRoot,
        'docs/workflows/client-v1-cross-repository-conformance.md',
      ),
      'utf8',
    );
    expect(workflowDocument).toContain(
      '0cee6963839df5694609bf4c3ecd4c3ac54efc53',
    );
    expect(workflowDocument).toContain('validator_revision');
    expect(workflowDocument).toContain('20863036831');
  });
});
