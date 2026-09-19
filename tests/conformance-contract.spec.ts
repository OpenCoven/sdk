import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import {
  assertEvidenceProducerCompatibility,
  parseFrozenConformanceLock,
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
  | 'currentAuthority0' | 'chainProducer' | 'chainReviewed' | 'chainHarness' | 'binding' | 'authority0' | 'authority1' | 'authority2' | 'authority3' | 'authority4' | 'authority5' | 'authority6' | 'authority7' | 'authority8' | 'authority9' | 'previousProducer' | 'previousReviewed' | 'previousHarness';
const sourceFixture = JSON.parse(sourceFixtureBytes.toString('utf8')) as {
  sources: Record<SourceRole, SourceSnapshot>;
  objects: Record<string, string>;
  previousLock: FrozenConformanceLock;
  chainLock: FrozenConformanceLock;
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
function sourceAuthority(previous = false, chain = false) {
  const commit = (role: SourceRole) => {
    const source = sourceFixture.sources[role];
    return {
      sha: source.commit,
      tree: { sha: source.tree },
      parents: source.parents.map((sha) => ({ sha })),
    };
  };
  return {
    producerCommit: commit(previous ? 'previousProducer' : chain ? 'chainProducer' : 'producer'),
    sourceCommit: commit(previous ? 'previousReviewed' : chain ? 'chainReviewed' : 'reviewed'),
    sourceAuthorityCommits: previous ? [] : !chain ? [commit('currentAuthority0')] : [commit('authority0'), commit('authority1'), commit('authority2'), commit('authority3'), commit('authority4'), commit('authority5'), commit('authority6'), commit('authority7'), commit('authority8'), commit('authority9')],
    harnessCommit: commit(previous ? 'previousHarness' : chain ? 'chainHarness' : 'harness'),
    phase1LockText: sourceBytes(
      previous ? 'previousProducer' : chain ? 'chainProducer' : 'producer', 'phase1-conformance.lock.json',
    ).toString('utf8'),
  };
}
const currentLock = () => readFrozenConformanceLock(resolve(
  workspaceRoot, 'conformance/client-v1-cross-repository-lock.json',
));

describe('reviewed Chat Cave build home isolation', () => {
  test('retains complete Git source bytes, governance files, and combined native deltas', () => {
    expect(sourceFixtureBytes.length).toBe(14_392_405);
    expect(digest(sourceFixtureBytes)).toBe(
      'e814ed68e22ab598ee8e970d8c7fb56783bf0276a5c216d367da80b1cf0ba147',
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
    expect(sourceBytes('harness', 'pnpm-lock.yaml')).toEqual(sourceBytes('producer', 'pnpm-lock.yaml'));
    const consumerLock = sourceBytes('consumer', 'pnpm-lock.yaml');
    expect(currentLock().sources.chat.consumerLock).toMatchObject({
      size: consumerLock.length, sha256: digest(consumerLock),
    });
    expect(sourceBytes('producer', 'src-tauri/Cargo.toml')).toEqual(sourceBytes('harness', 'src-tauri/Cargo.toml'));
  });

  test('accepts the exact delivered merge and its reviewed source and binding ancestry', () => {
    const lock = currentLock();
    expect(lock.evidenceProducer.commit).toBe('157fb3206b9b90f24049aa2043bae534d2b9a709');
    expect(lock.sources.cave).toMatchObject({
      commit: 'ecdcdcf8a75b62bb912ec48215ae20ab0809a181',
      tree: '1634a8eb0a391419bf28af4be0020cfd8c4df472',
      releaseVersion: '0.4.2',
    });
    expect(sourceAuthority().sourceCommit.parents).toEqual([
      { sha: '746794a4a5e03487138bfb08be4938e8580a98bc' },
    ]);
    expect(() => validateChatProducerAuthorityBinding(lock, sourceAuthority())).not.toThrow();
    expect(assertEvidenceProducerCompatibility(lock).sourceAuthorityPath).toEqual([{"repository": "OpenCoven/chat", "commit": "746794a4a5e03487138bfb08be4938e8580a98bc", "tree": "7ea3196b9145d53adffdd9ce86c986e1d6c3367a"}]);
    expect(lock.candidate).toEqual(sourceFixture.previousLock.candidate);
    expect(lock.sources.chat).toEqual(sourceFixture.previousLock.sources.chat);
    expect(lock.sources.coven).toEqual(sourceFixture.previousLock.sources.coven);
  });


  test.each(['identity', 'tree', 'parent'])('rejects a changed current intermediary %s', (field) => {
    const authority = sourceAuthority();
    const intermediate = authority.sourceAuthorityCommits[0];
    if (intermediate === undefined) throw new Error('Missing current intermediary fixture');
    if (field === 'identity') intermediate.sha = '0'.repeat(40);
    else if (field === 'tree') intermediate.tree.sha = '0'.repeat(40);
    else intermediate.parents = [{ sha: '0'.repeat(40) }];
    expect(() => validateChatProducerAuthorityBinding(currentLock(), authority)).toThrow(/Git identities/);
  });

  test('rejects old and new producer authorities against the opposite binding', () => {
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.previousLock, sourceAuthority(true))).not.toThrow();
    expect(() => validateChatProducerAuthorityBinding(currentLock(), sourceAuthority(true))).toThrow(
      'Chat producer authority.sourceAuthorityCommits must match the frozen authority path',
    );
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.previousLock, sourceAuthority())).toThrow(
      'Chat producer authority.sourceAuthorityCommits must match the frozen authority path',
    );
    const authority = sourceAuthority();
    authority.sourceCommit.parents = [{ sha: '5dd09592c4ab8e98eab5e37cc1cdde1a82198085' }];
    expect(() => validateChatProducerAuthorityBinding(currentLock(), authority)).toThrow(/Git identities/);
    const substitutedHarness = sourceAuthority();
    substitutedHarness.harnessCommit = substitutedHarness.sourceCommit;
    expect(() => validateChatProducerAuthorityBinding(currentLock(), substitutedHarness)).toThrow(/Git identities/);
  });

  test('rejects a severed direct source edge or substituted source tree', () => {
    for (const field of ['parents', 'tree'] as const) {
      const authority = sourceAuthority();
      if (field === 'parents') authority.sourceCommit.parents = [];
      else authority.sourceCommit.tree.sha = '0'.repeat(40);
      expect(() => validateChatProducerAuthorityBinding(currentLock(), authority)).toThrow(/Git identities/);
    }
  });

  test('retains the verified historical multi-edge binding', () => {
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.chainLock, sourceAuthority(false, true))).not.toThrow();
  });

  test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])('rejects a severed intermediate authority edge %i', (index) => {
    const authority = sourceAuthority(false, true);
    authority.sourceAuthorityCommits[index]!.parents = [];
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.chainLock, authority)).toThrow(/Git identities/);
  });

  test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])('rejects a substituted intermediate authority tree %i', (index) => {
    const authority = sourceAuthority(false, true);
    authority.sourceAuthorityCommits[index]!.tree.sha = '0'.repeat(40);
    expect(() => validateChatProducerAuthorityBinding(sourceFixture.chainLock, authority)).toThrow(/Git identities/);
  });

  test('rejects a reviewed tree that differs from the delivered producer', () => {
    const authority = sourceAuthority();
    authority.sourceCommit.tree.sha = '0'.repeat(40);
    expect(() => validateChatProducerAuthorityBinding(currentLock(), authority)).toThrow(/Git identities/);
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
      '157fb3206b9b90f24049aa2043bae534d2b9a709',
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
      '86d3054bb7cbbbee1fe5cacbb37b0c2ce01298bb',
    );
    expect(workflowDocument).toContain(
      'b5e0fac1d56ee2188f839e7da8fbddd3a3c2b8c2',
    );
    expect(workflowDocument).toContain('validator_revision');
    expect(workflowDocument).toContain('20863036831');
  });
});

describe('attested source descent', () => {
  const lockPath = resolve(workspaceRoot, 'conformance/client-v1-cross-repository-lock.json');
  const lockText = () => readFileSync(lockPath, 'utf8');
  type MutableLock = {
    evidenceProducer: { commit: string; workflow: Record<string, unknown> };
  };
  const withWorkflow = (patch: Record<string, unknown>) => {
    const value = JSON.parse(lockText()) as MutableLock;
    Object.assign(value.evidenceProducer.workflow, patch);
    return () => parseFrozenConformanceLock(JSON.stringify(value), 'lock');
  };
  const producerCommit = () =>
    (JSON.parse(lockText()) as MutableLock).evidenceProducer.commit;
  const tip = 'a'.repeat(40);
  const middle = 'b'.repeat(40);

  test('accepts the attested source when it is the producer commit', () => {
    expect(withWorkflow({})).not.toThrow();
  });

  test('refuses an attested source that is not the producer commit and claims no descent', () => {
    // The guard this replaces: provenance naming some other commit, unproven.
    expect(
      withWorkflow({ signerDigest: tip, sourceDigest: tip, sourceDescent: [] }),
    ).toThrow(/schema-v2 Chat producer/);
  });

  test('accepts an attested source whose descent reaches the producer commit', () => {
    expect(
      withWorkflow({
        signerDigest: tip,
        sourceDigest: tip,
        sourceDescent: [tip, middle, producerCommit()],
      }),
    ).not.toThrow();
  });

  test('refuses a descent that does not start at the attested source', () => {
    expect(
      withWorkflow({
        signerDigest: tip,
        sourceDigest: tip,
        sourceDescent: [middle, producerCommit()],
      }),
    ).toThrow(/schema-v2 Chat producer/);
  });

  test('refuses a descent that does not end at the producer commit', () => {
    expect(
      withWorkflow({
        signerDigest: tip,
        sourceDigest: tip,
        sourceDescent: [tip, middle],
      }),
    ).toThrow(/schema-v2 Chat producer/);
  });

  test('refuses a signer that disagrees with the attested source', () => {
    expect(
      withWorkflow({
        signerDigest: middle,
        sourceDigest: tip,
        sourceDescent: [tip, producerCommit()],
      }),
    ).toThrow(/schema-v2 Chat producer/);
  });

  test.each([
    ['a single-entry descent', [tip]],
    ['a repeated commit', [tip, tip, 'c'.repeat(40)]],
  ])('refuses %s', (_label, sourceDescent) => {
    expect(
      withWorkflow({ signerDigest: tip, sourceDigest: tip, sourceDescent }),
    ).toThrow();
  });
});
