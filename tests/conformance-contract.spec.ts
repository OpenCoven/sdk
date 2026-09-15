import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import {
  assertEvidenceProducerCompatibility,
  parseAssertionRegistry,
  parseConformanceAggregationArgs,
  parsePlatformEvidence,
  readAssertionRegistry,
  readFrozenConformanceLock,
  validateChatProducerAuthorityBinding,
} from '../scripts/conformance-contract.mjs';
import type { FrozenConformanceLock } from '../scripts/conformance-contract.mjs';
import { verifyProtectedWorkflow } from '../scripts/github-conformance-evidence.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFixtureBytes = brotliDecompressSync(readFileSync(resolve(
  workspaceRoot, 'tests/fixtures/chat280-cave5ee-source.json.br',
)));
interface SourceFile {
  path: string;
  mode: string;
  blob: string;
  size: number;
  sha256: string;
}
interface SourceSnapshot {
  repository: string;
  commit: string;
  tree: string;
  parents: string[];
  files: SourceFile[];
}
type SourceRole = 'producer' | 'reviewed' | 'harness' | 'consumer' | 'cave'
  | 'previousProducer' | 'previousReviewed' | 'previousHarness';
const sourceFixture = JSON.parse(sourceFixtureBytes.toString('utf8')) as {
  sources: Record<SourceRole, SourceSnapshot>;
  objects: Record<string, string>;
  previousLock: FrozenConformanceLock;
};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function objectBytes(oid: string): Buffer {
  const content = sourceFixture.objects[oid];
  if (content === undefined) throw new Error(`Missing source object ${oid}`);
  return Buffer.from(content, 'base64');
}
function sourceBytes(role: SourceRole, path: string): Buffer {
  const file = sourceFixture.sources[role]?.files.find((entry) => entry.path === path);
  if (file === undefined) throw new Error(`Missing ${role} source fixture ${path}`);
  return objectBytes(file.blob);
}
function sourceAuthority(previous = false) {
  const commit = (role: SourceRole) => {
    const source = sourceFixture.sources[role];
    return {
      sha: source.commit,
      tree: { sha: source.tree },
      parents: source.parents.map((sha) => ({ sha })),
    };
  };
  return {
    producerCommit: commit(previous ? 'previousProducer' : 'producer'),
    sourceCommit: commit(previous ? 'previousReviewed' : 'reviewed'),
    sourceAuthorityCommits: [],
    harnessCommit: commit(previous ? 'previousHarness' : 'harness'),
    phase1LockText: sourceBytes(
      previous ? 'previousProducer' : 'producer', 'phase1-conformance.lock.json',
    ).toString('utf8'),
  };
}
const currentLock = () => readFrozenConformanceLock(resolve(
  workspaceRoot, 'conformance/client-v1-cross-repository-lock.json',
));

describe('reviewed Chat280 and Cave5ee source adoption', () => {
  test('retains complete Git source bytes, governance files, and pre-UI native deltas', () => {
    expect(sourceFixtureBytes.length).toBe(3_870_043);
    expect(digest(sourceFixtureBytes)).toBe(
      '196d789e76fb12498226755f8184a67f9d487cc7aa611a7d340d310b4fdd601a',
    );
    for (const source of Object.values(sourceFixture.sources)) {
      const rawCommit = objectBytes(source.commit);
      expect(createHash('sha1').update(`commit ${rawCommit.length}\0`).update(rawCommit).digest('hex')).toBe(source.commit);
      expect(rawCommit.toString('utf8').split('\n')[0]).toBe(`tree ${source.tree}`);
      expect(rawCommit.toString('utf8').split('\n').filter((line) => line.startsWith('parent ')))
        .toEqual(source.parents.map((parent) => `parent ${parent}`));
      for (const file of source.files) {
        const bytes = objectBytes(file.blob);
        expect(bytes.length, file.path).toBe(file.size);
        expect(digest(bytes), file.path).toBe(file.sha256);
        expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(file.blob);
        expect(['100644', '100755']).toContain(file.mode);
      }
    }
    const phase1 = JSON.parse(sourceBytes('producer', 'phase1-conformance.lock.json').toString('utf8')) as {
      harnessAuthority: { files: SourceFile[]; productionDeltas: SourceFile[] };
    };
    expect(phase1.harnessAuthority.files).toHaveLength(25);
    expect(phase1.harnessAuthority.productionDeltas).toHaveLength(10);
    for (const expected of [...phase1.harnessAuthority.files, ...phase1.harnessAuthority.productionDeltas]) {
      expect(sourceFixture.sources.harness.files.find(({ path }) => path === expected.path)).toMatchObject(expected);
    }
    expect(sourceFixture.sources.reviewed.files).toEqual(sourceFixture.sources.producer.files);
    expect(sourceBytes('producer', 'package.json')).not.toEqual(sourceBytes('consumer', 'package.json'));
    expect(sourceBytes('harness', 'pnpm-lock.yaml').equals(sourceBytes('producer', 'pnpm-lock.yaml'))).toBe(false);
    const consumerLock = sourceBytes('consumer', 'pnpm-lock.yaml');
    expect(currentLock().sources.chat.consumerLock).toMatchObject({
      size: consumerLock.length, sha256: digest(consumerLock),
    });
    expect(sourceBytes('producer', 'src-tauri/Cargo.toml')).not.toEqual(sourceBytes('harness', 'src-tauri/Cargo.toml'));
  });

  test('accepts the exact delivered merge and its separate two-parent reviewed source', () => {
    const lock = currentLock();
    expect(lock.evidenceProducer.commit).toBe('53bc5dadf6590ba05ca01572496db6afae9b8b27');
    expect(lock.sources.cave).toMatchObject({
      commit: '5ee8545f5c2fe4c6121dfdfe842395a354bb3d7d',
      tree: '23cd75ef310e1f293a40e3eee183ea8df6180544',
      releaseVersion: '0.4.2',
    });
    expect(sourceAuthority().sourceCommit.parents).toEqual([
      { sha: '5dd09592c4ab8e98eab5e37cc1cdde1a82198085' },
      { sha: '1cf8693e86a8c323708a3d9050d5cff86a158ae6' },
    ]);
    expect(() => validateChatProducerAuthorityBinding(lock, sourceAuthority())).not.toThrow();
    expect(assertEvidenceProducerCompatibility(lock).sourceAuthorityPath).toEqual([]);
    expect(lock.candidate).toEqual(sourceFixture.previousLock.candidate);
    expect(lock.sources.chat).toEqual(sourceFixture.previousLock.sources.chat);
    expect(lock.sources.coven).toEqual(sourceFixture.previousLock.sources.coven);
  });

  test('rejects old and new producer authorities against the opposite binding', () => {
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.previousLock, sourceAuthority(true))).not.toThrow();
    expect(() => validateChatProducerAuthorityBinding(currentLock(), sourceAuthority(true))).toThrow(/Git identities/);
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.previousLock, sourceAuthority())).toThrow(/Git identities/);
    const authority = sourceAuthority();
    authority.sourceCommit.parents = [{ sha: '5dd09592c4ab8e98eab5e37cc1cdde1a82198085' }];
    expect(() => validateChatProducerAuthorityBinding(currentLock(), authority)).toThrow(/Git identities/);
    const substitutedHarness = sourceAuthority();
    substitutedHarness.harnessCommit = substitutedHarness.sourceCommit;
    expect(() => validateChatProducerAuthorityBinding(currentLock(), substitutedHarness)).toThrow(/Git identities/);
  });

  test('keeps actual Cave engine bytes separate from historical SDK fixture provenance', () => {
    const lock = currentLock();
    const manifest = JSON.parse(sourceBytes('cave', 'package.json').toString('utf8')) as { version: string };
    expect(manifest.version).toBe(lock.sources.cave.releaseVersion);
    for (const expected of lock.sources.cave.files) {
      const bytes = sourceBytes('cave', expected.path);
      expect({ size: bytes.length, sha256: digest(bytes) }).toEqual({
        size: expected.size, sha256: expected.sha256,
      });
    }
    const provenance = JSON.parse(readFileSync(resolve(
      workspaceRoot, 'packages/cave/fixtures/contract-fixture.provenance.json',
    ), 'utf8')) as { commit: string };
    expect(provenance.commit).toBe('e806655a7100e9d589662a6f3817c3fd8cde48ad');
    for (const path of ['contract-fixture.json', 'contract-fixture.sha256', 'hpke-bound-v1-vectors.json', 'hpke-bound-v1-vectors.sha256']) {
      expect(sourceBytes('cave', `src/lib/server/client-v1/${path}`).equals(
        readFileSync(resolve(workspaceRoot, 'packages/cave/fixtures', path)),
      ), path).toBe(true);
    }
  });

  test('rejects stale Cave version, engine, source, and original-consumer substitutions', () => {
    const original = JSON.parse(sourceAuthority().phase1LockText) as {
      cave: { revision: string };
      chat: { revision: string };
      release: { caveVersion: string; caveArtifacts: { assertionEngine: { size: number; sha256: string } } };
    };
    const mutations = [
      (lock: typeof original) => { lock.cave.revision = sourceFixture.previousLock.sources.cave.commit; },
      (lock: typeof original) => { lock.release.caveVersion = '0.4.4'; },
      (lock: typeof original) => { lock.release.caveArtifacts.assertionEngine.size = 150_592; },
      (lock: typeof original) => { lock.release.caveArtifacts.assertionEngine.sha256 = '3e18320712aafb5208e5eddb66b1916208b5b208aec8a5d79a8d900c7909cc92'; },
      (lock: typeof original) => { lock.chat.revision = sourceFixture.sources.producer.commit; },
    ];
    for (const mutate of mutations) {
      const lock = structuredClone(original);
      mutate(lock);
      expect(() => validateChatProducerAuthorityBinding(currentLock(), {
        ...sourceAuthority(), phase1LockText: JSON.stringify(lock),
      })).toThrow(/phase1 (?:lock|release|Cave)/);
    }
  });

  test('binds the complete protected workflow bytes without accepting the old workflow', () => {
    const lock = currentLock();
    const producer = assertEvidenceProducerCompatibility(lock);
    const bytes = sourceBytes('producer', producer.workflow.path);
    expect({ size: bytes.length, sha256: digest(bytes) }).toMatchObject({
      size: producer.workflow.size,
      sha256: producer.workflow.sha256,
    });
    const manifest = sourceBytes('producer', 'package.json');
    expect(producer.packageManifest).toMatchObject({ size: manifest.length, sha256: digest(manifest) });
    expect(() => verifyProtectedWorkflow(bytes.toString('utf8'), producer, lock.toolchain)).not.toThrow();
    expect(() => verifyProtectedWorkflow(
      sourceBytes('previousProducer', producer.workflow.path).toString('utf8'),
      producer, lock.toolchain,
    )).toThrow();
  });

  test('runs the actual reviewed Chat lock and SDK binding modules against both generations', () => {
    const artifactRoot = resolve(workspaceRoot, '.artifacts');
    mkdirSync(artifactRoot, { recursive: true });
    const root = mkdtempSync(resolve(artifactRoot, 'chat280-source-test-'));
    try {
      for (const file of sourceFixture.sources.harness.files) {
        const path = resolve(root, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, sourceBytes('harness', file.path));
      }
      writeFileSync(resolve(root, 'producer-lock.json'), sourceAuthority().phase1LockText);
      writeFileSync(resolve(root, 'previous-lock.json'), sourceAuthority(true).phase1LockText);
      writeFileSync(resolve(root, 'sdk-lock.json'), JSON.stringify(currentLock()));
      writeFileSync(resolve(root, 'previous-sdk-lock.json'), JSON.stringify(sourceFixture.previousLock));
      writeFileSync(resolve(root, 'sdk-registry.json'), readFileSync(resolve(
        workspaceRoot, 'conformance/client-v1-cross-repository-assertions.json',
      )));
      writeFileSync(resolve(root, 'cave-engine.mjs'), sourceBytes('cave', 'scripts/client-v1-conformance.mjs'));
      execFileSync(process.execPath, ['--input-type=module', '--eval', `
        import assert from 'node:assert/strict';
        import { readFileSync } from 'node:fs';
        import { readPhase1ConformanceLock } from './scripts/phase1-conformance-lock.mjs';
        import { assertSdkContractMatchesPhase1Lock } from './scripts/phase1-schema-v2-evidence.mjs';
        import { expectedAssertionIds, COVERAGE_ASSERTION_ID } from './cave-engine.mjs';
        const phase1 = readPhase1ConformanceLock('producer-lock.json');
        const sdk = { frozenLock: JSON.parse(readFileSync('sdk-lock.json', 'utf8')) };
        const previousSdk = { frozenLock: JSON.parse(readFileSync('previous-sdk-lock.json', 'utf8')) };
        assert.equal(phase1.release.caveVersion, '0.4.2');
        assert.doesNotThrow(() => assertSdkContractMatchesPhase1Lock(sdk, phase1));
        assert.throws(() => readPhase1ConformanceLock('previous-lock.json'), /release authority versions/);
        assert.throws(() => assertSdkContractMatchesPhase1Lock(previousSdk, phase1), /Phase 1 cave pin/);
        const registry = JSON.parse(readFileSync('sdk-registry.json', 'utf8'));
        assert.deepEqual(registry.assertions.cave, [...expectedAssertionIds(true, true), COVERAGE_ASSERTION_ID]);
      `], { cwd: root, stdio: 'pipe' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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
      '53bc5dadf6590ba05ca01572496db6afae9b8b27',
    );
    expect(workflowDocument).not.toContain(
      'f6eba8af1f71d4251583cf39d4e5fb5b4797d209',
    );
    expect(workflowDocument).not.toContain(
      '293a6282ef76763bb6334e1232baf4eb77cb2ef7',
    );
    expect(workflowDocument).not.toContain(
      '6ab87e150af7b46ce4d3c0a480a14b8a06acc694',
    );
    expect(workflowDocument).toContain(
      '9f073f05241c2d3241b23ed9d73b26c6cd55ce7e',
    );
    expect(workflowDocument).toContain(
      '2caf91629bc4fb66dcc462ea9d01bfc32ca1df28',
    );
    expect(workflowDocument).toContain(
      '1cf8693e86a8c323708a3d9050d5cff86a158ae6',
    );
    expect(workflowDocument).toContain('validator_revision');
    expect(workflowDocument).toContain('20863036831');
  });
});
