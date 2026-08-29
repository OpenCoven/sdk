import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import * as contract from '../scripts/conformance-contract.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = resolve(
  workspaceRoot,
  'conformance/client-v1-cross-repository-lock.json',
);
const registryPath = resolve(
  workspaceRoot,
  'conformance/client-v1-cross-repository-assertions.json',
);
const schemaPath = resolve(
  workspaceRoot,
  'conformance/client-v1-cross-repository-evidence.schema.json',
);
const PLATFORMS = ['darwin-arm64', 'linux-x64', 'win32-x64'] as const;
const TEST_COMPATIBLE_PRODUCER = {
  status: 'compatible',
  repository: 'OpenCoven/chat',
  commit: 'f'.repeat(40),
  tree: 'c'.repeat(40),
  packageManifest: {
    path: 'package.json',
    size: 3_500,
    sha256: '1'.repeat(64),
  },
  harness: {
    path: 'scripts/phase1-conformance.mjs',
    version: '0.1.0',
    size: 120_000,
    sha256: '2'.repeat(64),
  },
  command: 'test:phase1-conformance',
  recordSchemaVersion: 2,
  workflow: {
    path: '.github/workflows/client-v1-conformance.yml',
    job: 'platform-conformance',
    environment: 'client-v1-conformance',
    signerWorkflow:
      'OpenCoven/chat/.github/workflows/client-v1-conformance.yml',
    signerDigest: 'f'.repeat(40),
    sourceDigest: 'f'.repeat(40),
    predicateType: 'https://slsa.dev/provenance/v1',
    denySelfHostedRunners: true,
  },
} as const;

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredFunction(name: string): (...args: never[]) => unknown {
  const value = (contract as unknown as Record<string, unknown>)[name];
  expect(value, `${name} must be exported`).toBeTypeOf('function');
  return value as (...args: never[]) => unknown;
}

function readLock(): Record<string, unknown> {
  const readFrozenConformanceLock = requiredFunction(
    'readFrozenConformanceLock',
  );
  return readFrozenConformanceLock(lockPath as never) as Record<string, unknown>;
}

function readRegistry(): Record<string, unknown> {
  return contract.readAssertionRegistry(registryPath) as unknown as Record<
    string,
    unknown
  >;
}

function createCompatibleLock(
  lock: Record<string, unknown> = readLock(),
): Record<string, unknown> {
  return {
    ...structuredClone(lock),
    evidenceProducer: structuredClone(TEST_COMPATIBLE_PRODUCER),
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeys);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

function artifactMetadata(
  path: string,
  bytes: Buffer,
): { path: string; size: number; sha256: string } {
  return {
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function createCaveEngine(registry: Record<string, unknown>) {
  const assertions = registry.assertions as {
    cave: string[];
  };
  const coverageId = assertions.cave.at(-1);
  if (coverageId === undefined) {
    throw new Error('Frozen Cave assertion registry is empty.');
  }
  const expectedWithoutCoverage = assertions.cave.slice(0, -1);
  const findings = [
    {
      id: 'frozen-test-finding',
      where: 'docs/api/client-v1.md',
      says: 'documented behavior',
      measured: 'observed behavior',
      severity: 'documentation',
      why: 'test fixture',
    },
  ];
  const notCovered = [
    'The SDK and Chat halves live in other repositories.',
    'The production Coven daemon is covered by the cross-repository run.',
    'A genuinely remote peer is outside this release gate.',
    'Write scopes are outside this read-only release.',
    'OAuth and desktop consent UI are outside this release gate.',
    'Cross-process pairing state is outside the process-local contract.',
  ];

  return {
    COVERAGE_ASSERTION_ID: coverageId,
    FINDINGS: findings,
    NOT_COVERED: notCovered,
    expectedAssertionIds() {
      throw new Error('aggregation must not derive Cave IDs dynamically');
    },
    checkAssertionCoverage(
      entries: readonly { id: string }[],
      expected: readonly string[],
    ) {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        if (entry.id === coverageId) continue;
        counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
      }
      const failures: string[] = [];
      for (const id of expected) {
        const count = counts.get(id) ?? 0;
        if (count === 0) failures.push(`missing ${id}`);
        if (count > 1) failures.push(`duplicate ${id}`);
      }
      for (const id of counts.keys()) {
        if (!expected.includes(id)) failures.push(`unexpected ${id}`);
      }
      return failures;
    },
    summarizeConformance(entries: readonly { result: string }[]) {
      const passed = entries.filter(({ result }) => result === 'pass').length;
      const failed = entries.filter(({ result }) => result === 'fail').length;
      const skipped = entries.filter(({ result }) => result === 'skip').length;
      return {
        total: entries.length,
        passed,
        failed,
        skipped,
        status: failed > 0 ? 'failed' : 'passed',
      };
    },
    renderConformanceRecord(
      entries: Array<{ id: string; result: string; detail: string }>,
      context: {
        ranAt: string;
        caveVersion: string;
        commit: string;
        platform: string;
        includeTtl: boolean;
        authorityTakeover: Record<string, unknown>;
        notCovered: string[];
        findings: Array<Record<string, unknown>>;
      },
    ) {
      return {
        harness: 'scripts/client-v1-conformance.mjs',
        issues: [
          'OpenCoven/coven-cave#4832',
          'OpenCoven/coven-cave#4838',
        ],
        scope: 'cave-only',
        ranAt: context.ranAt,
        caveVersion: context.caveVersion,
        commit: context.commit,
        platform: context.platform,
        nodeVersion: 'v24.18.1',
        includeTtl: context.includeTtl,
        authorityTakeover: context.authorityTakeover,
        notCovered: context.notCovered,
        findings: context.findings,
        summary: this.summarizeConformance(entries),
        assertions: entries,
      };
    },
    expectedWithoutCoverage,
  };
}

function createPlatformEvidence(
  platform: (typeof PLATFORMS)[number],
  lock: Record<string, unknown>,
  registry: Record<string, unknown>,
) {
  lock = createCompatibleLock(lock);
  const candidate = lock.candidate as {
    repository: string;
    commit: string;
    tree: string;
    releaseManifest: Record<string, unknown>;
    sdkPackages: Array<Record<string, unknown>>;
    cavePackageFiles: Array<Record<string, unknown>>;
  };
  const sources = lock.sources as {
    cave: {
      repository: string;
      commit: string;
      tree: string;
      releaseVersion: string;
      files: Array<Record<string, unknown>>;
    };
    coven: {
      repository: string;
      commit: string;
      tree: string;
      releaseVersion: string;
    };
    chat: {
      repository: string;
      commit: string;
      tree: string;
      consumerLock: Record<string, unknown>;
      vendorFiles: Array<Record<string, unknown>>;
    };
  };
  const toolchain = lock.toolchain as {
    nodeVersion: string;
    pnpmVersion: string;
    rustVersion: string;
    tauriVersion: string;
  };
  const producer =
    (
      lock.evidenceProducer as
        | typeof TEST_COMPATIBLE_PRODUCER
        | { status?: string }
    ).status === 'compatible'
      ? (lock.evidenceProducer as typeof TEST_COMPATIBLE_PRODUCER)
      : TEST_COMPATIBLE_PRODUCER;
  const evidenceSchema = lock.evidenceSchema as {
    path: string;
    size: number;
    sha256: string;
  };
  const harnessContract = producer.harness as {
    path: string;
    version: string;
  };
  const scanners = lock.scanners as {
    redaction: { name: string; version: string };
    retainedEvidence: { name: string; version: string };
  };
  const assertions = registry.assertions as {
    cave: string[];
    sdk: string[];
    chat: {
      common: string[];
      platforms: Record<(typeof PLATFORMS)[number], string[]>;
    };
  };
  const caveEngine = createCaveEngine(registry);
  const caveAssertions = assertions.cave.map((id) => ({
    id,
    result: 'pass',
    detail: id === caveEngine.COVERAGE_ASSERTION_ID ? 'complete' : '',
  }));
  const startedAt = '2026-08-29T04:00:00.000Z';
  const completedAt = '2026-08-29T04:00:01.000Z';
  const [os, arch] = platform.split('-');
  const nativeBackend = {
    'darwin-arm64': 'macos-keychain',
    'linux-x64': 'linux-keyring',
    'win32-x64': 'windows-credential-manager',
  }[platform];
  const identityBackend =
    platform === 'win32-x64'
      ? 'windows-named-pipe-client-identity'
      : 'unix-peer-credentials';
  const lockBytes = Buffer.from(
    contract.serializeCanonicalJson(lock),
    'utf8',
  );
  const registryBytes = readFileSync(registryPath);
  const caveRecord = caveEngine.renderConformanceRecord(caveAssertions, {
    ranAt: startedAt,
    caveVersion: sources.cave.releaseVersion,
    commit: sources.cave.commit,
    platform,
    includeTtl: true,
    authorityTakeover: {
      authorityMode: 'enforce',
      discoveryVersion: 2,
      mechanism: 'hpke-bound-v1',
    },
    notCovered: caveEngine.NOT_COVERED,
    findings: caveEngine.FINDINGS,
  });

  return {
    schemaVersion: 2,
    issue: 'OpenCoven/sdk#38',
    platform,
    timing: {
      startedAt,
      completedAt,
      durationMs: 1_000,
    },
    environment: {
      os,
      arch,
      nodeVersion: toolchain.nodeVersion,
      pnpmVersion: toolchain.pnpmVersion,
      rustVersion: toolchain.rustVersion,
      tauriVersion: toolchain.tauriVersion,
      nativeCustody: {
        backend: nativeBackend,
        available: true,
      },
      covenIdentity: {
        backend: identityBackend,
        available: true,
      },
    },
    releases: {
      cave: sources.cave.releaseVersion,
      coven: sources.coven.releaseVersion,
    },
    provenance: {
      candidate: {
        repository: candidate.repository,
        commit: candidate.commit,
        tree: candidate.tree,
      },
      validator: {
        repository: 'OpenCoven/sdk',
        commit: 'e'.repeat(40),
        tree: 'd'.repeat(40),
        contract: {
          path: 'scripts/conformance-contract.mjs',
          size: 32_768,
          sha256: 'a'.repeat(64),
        },
        schema: {
          path: evidenceSchema.path,
          size: evidenceSchema.size,
          sha256: evidenceSchema.sha256,
        },
      },
      cave: {
        repository: sources.cave.repository,
        commit: sources.cave.commit,
        tree: sources.cave.tree,
      },
      coven: {
        repository: sources.coven.repository,
        commit: sources.coven.commit,
        tree: sources.coven.tree,
      },
      chat: {
        repository: sources.chat.repository,
        commit: sources.chat.commit,
        tree: sources.chat.tree,
      },
    },
    harness: {
      name: harnessContract.path,
      version: harnessContract.version,
      repository: producer.repository,
      commit: producer.commit,
      tree: producer.tree,
      invocationId: '123e4567-e89b-42d3-a456-426614174000',
    },
    artifacts: {
      frozenLock: artifactMetadata(
        'conformance/client-v1-cross-repository-lock.json',
        lockBytes,
      ),
      assertionRegistry: artifactMetadata(
        'conformance/client-v1-cross-repository-assertions.json',
        registryBytes,
      ),
      releaseManifest: candidate.releaseManifest,
      sdkPackages: candidate.sdkPackages,
      candidateCaveFiles: candidate.cavePackageFiles,
      caveAuthorityFiles: sources.cave.files,
      consumerLock: sources.chat.consumerLock,
      chatVendorFiles: sources.chat.vendorFiles,
    },
    caveRecord,
    sdkAssertions: assertions.sdk.map((id) => ({
      id,
      result: 'pass',
      diagnosticId: 'phase1.assertion.passed',
    })),
    chatAssertions: [
      ...assertions.chat.common,
      ...assertions.chat.platforms[platform],
    ].map((id) => ({
      id,
      result: 'pass',
      diagnosticId: 'phase1.assertion.passed',
    })),
    coverage: {
      cave: true,
      coven: true,
      sdk: true,
      chat: true,
    },
    notCovered: registry.notCovered,
    isolation: {
      strategy: 'process-owned-temporary-roots',
      network: 'loopback-only',
      sourceCheckoutDependency: false,
      workspaceLinkDependency: false,
      retainedPrivatePaths: false,
      retainedSocketHandles: false,
      roots: [
        'cave-home',
        'coven-home',
        'consumer-home',
        'native-credential-store',
      ].map((id, index) => ({
        id,
        opaqueId: `${index + 1}`.repeat(32),
        ownershipVerified: true,
        removedAfterRun: true,
      })),
      operatorState: [
        'cave-home',
        'coven-home',
        'native-credential-store',
        'projects',
      ].map((id, index) => ({
        id,
        beforeSha256: `${index + 5}`.repeat(64),
        afterSha256: `${index + 5}`.repeat(64),
      })),
    },
    scans: {
      redaction: {
        status: 'passed',
        scanner: scanners.redaction.name,
        version: scanners.redaction.version,
      },
      retainedEvidence: {
        status: 'passed',
        scanner: scanners.retainedEvidence.name,
        version: scanners.retainedEvidence.version,
      },
    },
  };
}

function aggregate(records: Array<Record<string, unknown>>) {
  const lock = createCompatibleLock();
  const registry = readRegistry();
  const caveEngine = createCaveEngine(registry);
  const lockBytes = Buffer.from(
    contract.serializeCanonicalJson(lock),
    'utf8',
  );
  const registryBytes = readFileSync(registryPath);
  const sources = lock.sources as {
    cave: { files: Array<{ path: string; sha256: string }> };
  };
  const engine = sources.cave.files.find(
    ({ path }) => path === 'scripts/client-v1-conformance.mjs',
  );
  if (engine === undefined) {
    throw new Error('Frozen Cave engine metadata is missing.');
  }
  return contract.aggregateConformanceEvidence({
    caveEngine,
    caveEngineSha256: engine.sha256,
    assertionRegistrySha256: sha256(registryBytes),
    frozenLockSha256: sha256(lockBytes),
    frozenLockSize: lockBytes.byteLength,
    frozenLock: lock,
    canonicalPlatforms: PLATFORMS,
    registry,
    platformRecords: records,
  } as never);
}

describe('unresolved SDK #38 conformance gaps', () => {
  test('freezes the exact candidate, manifest, package, source, and consumer bytes', () => {
    const lock = readLock() as {
      candidate: {
        commit: string;
        tree: string;
        releaseManifest: {
          file: string;
          size: number;
          sha256: string;
        };
        sdkPackages: Array<{
          packageName: string;
          releaseFile: string;
          vendorPath: string;
          size: number;
          sha256: string;
        }>;
        cavePackageFiles: Array<{ path: string; size: number; sha256: string }>;
      };
      sources: {
        cave: { commit: string; tree: string };
        coven: { commit: string; tree: string };
        chat: {
          commit: string;
          tree: string;
          consumerLock: { path: string; size: number; sha256: string };
        };
      };
    };

    expect(lock.candidate).toMatchObject({
      commit: 'acc38488f00860d246c3c553375634d64806eabb',
      tree: '643be6db60736dc8bd7b01873dcd1c14f26d93ef',
      releaseManifest: {
        file: 'release-manifest.json',
        size: 1_031,
        sha256:
          'b8bfb62236fc8add4a9baad9f00e5401db15074a2d21fe2847a9158104cefb3c',
      },
    });
    expect(lock.candidate.sdkPackages).toEqual([
      {
        packageName: '@opencoven/sdk-core',
        version: '0.1.0',
        releaseFile: 'tarballs/core/opencoven-sdk-core-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/sdk-core-0.1.0.tgz',
        size: 33_284,
        sha256:
          '9a574e8bd5178ce2aa20db97e8a741c7c9569515546a2d3089406f41a9d040fe',
      },
      {
        packageName: '@opencoven/cave-client',
        version: '0.1.0',
        releaseFile: 'tarballs/cave/opencoven-cave-client-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/cave-client-0.1.0.tgz',
        size: 81_543,
        sha256:
          'c44544adf8e712d6be1e8686788e63aa0133eb318274d1fb1926138a7da148c0',
      },
      {
        packageName: '@opencoven/coven-client',
        version: '0.1.0',
        releaseFile: 'tarballs/coven/opencoven-coven-client-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/coven-client-0.1.0.tgz',
        size: 33_009,
        sha256:
          'cba09410aeae9670173a1f7bfe3174b5dd610873358944ed0955c86ac56a3aa1',
      },
      {
        packageName: '@opencoven/sdk',
        version: '0.1.0',
        releaseFile: 'tarballs/sdk/opencoven-sdk-0.1.0.tgz',
        vendorPath: 'vendor/opencoven-sdk/sdk-0.1.0.tgz',
        size: 15_833,
        sha256:
          'eee7557feeaf4719d0cb990a66fdddf62270dbbeb05cfe7e35efbfe22827d04f',
      },
    ]);
    expect(lock.candidate.cavePackageFiles).toEqual([
      {
        path: 'packages/cave/fixtures/contract-fixture.json',
        size: 12_308,
        sha256:
          'b2694cd1a70a2ddd81b54ee43ade1ff5aa1ecd661fa6e41e5b7acedd8db400bd',
      },
      {
        path: 'packages/cave/fixtures/contract-fixture.sha256',
        size: 65,
        sha256:
          '6e847024eae72a6fa31e911f54393948152edf17892200316b94950abfd9a4c6',
      },
      {
        path: 'packages/cave/fixtures/contract-fixture.provenance.json',
        size: 333,
        sha256:
          'bbb6d3a1c75d75144ca44dfc2f3f84991d9db075cdb9a887eb419a1bfe737d4e',
      },
      {
        path: 'packages/cave/fixtures/hpke-bound-v1-vectors.json',
        size: 4_041,
        sha256:
          'f806967291de12175277b6b24ac3c7bba912ae760fd8227fb21b1a4d5f5e6797',
      },
      {
        path: 'packages/cave/fixtures/hpke-bound-v1-vectors.sha256',
        size: 65,
        sha256:
          '20a0e7737d940fd661cb95ba1d1b9fda01eac840fbdff667c64659966ca3d544',
      },
    ]);
    expect(lock.sources).toMatchObject({
      cave: {
        commit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
        tree: '5f5a2711552746695ffba6ff7a9e8af81647f194',
      },
      coven: {
        commit: '721437b84026c042e431b0882dcd14fdb29ac07d',
        tree: '7cc5988b5a06f3f279e5c034cf2228775bd2b0e0',
      },
      chat: {
        commit: 'dbbcf3a71155730f0e707e181ef3ca7e770c719f',
        tree: '85ce03bfa8ec1a8e5002821eee3147cd73a59e25',
        consumerLock: {
          path: 'pnpm-lock.yaml',
          size: 56_222,
          sha256:
            'd2f0db8eca64112324e861bb7cbd2b645ed9ae4aad836200855b3477f3ea49ae',
        },
      },
    });

    expect(
      execFileSync(
        'git',
        [
          '-C',
          workspaceRoot,
          'rev-parse',
          'acc38488f00860d246c3c553375634d64806eabb^{tree}',
        ],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe(lock.candidate.tree);
    for (const expected of lock.candidate.cavePackageFiles) {
      const bytes = execFileSync(
        'git',
        [
          '-C',
          workspaceRoot,
          'show',
          `acc38488f00860d246c3c553375634d64806eabb:${expected.path}`,
        ],
        { encoding: 'buffer' },
      );
      expect(bytes.byteLength).toBe(expected.size);
      expect(sha256(bytes)).toBe(expected.sha256);
    }
  });

  test('binds the ordered platform matrix and immutable schema bytes through the lock', () => {
    const lock = readLock() as {
      schemaVersion: number;
      platformMatrix: string[];
      evidenceSchema: {
        identity: string;
        path: string;
        version: number;
        size: number;
        sha256: string;
      };
      assertionRegistry: {
        path: string;
        size: number;
        sha256: string;
      };
    };
    const schemaText = readFileSync(schemaPath, 'utf8');
    const registryText = readFileSync(registryPath, 'utf8');
    const schema = JSON.parse(schemaText) as {
      $id?: string;
      'x-opencoven-frozen-contract'?: {
        assertionRegistry?: Record<string, unknown>;
        platformMatrix?: string[];
        schemaVersion?: number;
      };
    };
    const validateFrozenConformanceBindings = requiredFunction(
      'validateFrozenConformanceBindings',
    );

    expect(lock.schemaVersion).toBe(2);
    expect(lock.platformMatrix).toEqual(PLATFORMS);
    expect(lock.evidenceSchema).toEqual({
      identity:
        'urn:opencoven:schema:client-v1-cross-repository-platform-evidence:2',
      path: 'conformance/client-v1-cross-repository-evidence.schema.json',
      version: 2,
      size: Buffer.byteLength(schemaText, 'utf8'),
      sha256: sha256(schemaText),
    });
    expect(schema.$id).toBe(lock.evidenceSchema.identity);
    expect(schema['x-opencoven-frozen-contract']).toEqual({
      schemaVersion: 2,
      platformMatrix: PLATFORMS,
      assertionRegistry: lock.assertionRegistry,
    });
    expect(() =>
      validateFrozenConformanceBindings(
        lock as never,
        schemaText as never,
        registryText as never,
      ),
    ).not.toThrow();
    expect(() =>
      validateFrozenConformanceBindings(
        lock as never,
        schemaText.replace(
          'OpenCoven Client v1 cross-repository platform evidence',
          'drifted evidence schema',
        ) as never,
        registryText as never,
      ),
    ).toThrow('Evidence schema bytes do not match the frozen lock');
    expect(() =>
      validateFrozenConformanceBindings(
        lock as never,
        schemaText as never,
        `${registryText} ` as never,
      ),
    ).toThrow('Assertion registry bytes do not match the frozen lock');
  });

  test('fails closed because the frozen Chat commit has no schema-v2 producer', () => {
    const lock = readLock() as {
      evidenceProducer: Record<string, unknown>;
    };
    const assertEvidenceProducerCompatibility = requiredFunction(
      'assertEvidenceProducerCompatibility',
    );

    expect(lock.evidenceProducer).toEqual({
      status: 'blocked',
      blockerId: 'frozen-chat-commit-has-no-platform-evidence-producer',
      repository: 'OpenCoven/chat',
      commit: 'dbbcf3a71155730f0e707e181ef3ca7e770c719f',
      tree: '85ce03bfa8ec1a8e5002821eee3147cd73a59e25',
      packageManifest: {
        path: 'package.json',
        size: 3_202,
        sha256:
          'dff8b65c3643b04c9cb85dccfd9035f90046b1f047b84c0a563a6bce6880e17f',
      },
      availableHarness: {
        path: 'scripts/contract-canary.mjs',
        size: 36_293,
        sha256:
          '1118d1999874b6a5a6fcf48355fe2a30c66b6142e178ff759569982bab4696f4',
      },
      availableCommand: 'test:contract-canary',
      requiredRecordSchemaVersion: 2,
    });
    expect(() =>
      assertEvidenceProducerCompatibility(lock as never),
    ).toThrow(
      'Frozen Chat commit dbbcf3a71155730f0e707e181ef3ca7e770c719f has no schema-v2 platform evidence producer',
    );
  });

  test('freezes every Cave assertion and the complete exclusion set', () => {
    const registry = readRegistry() as {
      schemaVersion: number;
      provenance: {
        commit: string;
        tree: string;
        engine: { path: string; size: number; sha256: string };
      };
      requiredSubjects: string[];
      assertions: {
        cave: string[];
        sdk: string[];
        chat: {
          common: string[];
          platforms: Record<(typeof PLATFORMS)[number], string[]>;
        };
      };
      notCovered: Array<{ scopeId: string; diagnosticId: string }>;
    };

    expect(registry.schemaVersion).toBe(2);
    expect(registry.provenance).toEqual({
      repository: 'OpenCoven/coven-cave',
      commit: '2a0ff9237e94e652e477b22f60fd6d721b9e6451',
      tree: '5f5a2711552746695ffba6ff7a9e8af81647f194',
      engine: {
        path: 'scripts/client-v1-conformance.mjs',
        size: 141_424,
        sha256:
          '27d0e898931e6b01a67cbfa20f1d72ba0f988f19772c0e5ca3ccb239a56eba02',
      },
      includeTtl: true,
      includeAuthorityTakeover: true,
    });
    expect(registry.requiredSubjects).toEqual(['cave', 'coven', 'sdk', 'chat']);
    expect(registry.assertions.cave).toHaveLength(110);
    expect(registry.assertions.cave.at(-1)).toBe(
      'harness.assertion-coverage',
    );
    expect(registry.notCovered).toEqual([
      {
        scopeId: 'cross-process-pairing',
        diagnosticId: 'phase1.scope.cross-process-pairing.not-covered',
      },
      {
        scopeId: 'oauth-ui',
        diagnosticId: 'phase1.scope.oauth-ui.not-covered',
      },
      {
        scopeId: 'remote-peer',
        diagnosticId: 'phase1.scope.remote-peer.not-covered',
      },
      {
        scopeId: 'write-apis',
        diagnosticId: 'phase1.scope.write-apis.not-covered',
      },
    ]);
    expect(registry.notCovered.map(({ scopeId }) => scopeId)).not.toContain(
      'sdk',
    );
    expect(registry.notCovered.map(({ scopeId }) => scopeId)).not.toContain(
      'chat',
    );
  });

  test('rejects malformed frozen registries before aggregation', () => {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const duplicate = structuredClone(registry) as {
      assertions: { cave: string[] };
    };
    duplicate.assertions.cave.push(duplicate.assertions.cave[0] ?? '');
    expect(() =>
      contract.parseAssertionRegistry(
        JSON.stringify(duplicate),
        'duplicate registry',
      ),
    ).toThrow(/duplicate assertion id/u);

    const missingProvenance = structuredClone(registry);
    delete missingProvenance.provenance;
    expect(() =>
      contract.parseAssertionRegistry(
        JSON.stringify(missingProvenance),
        'missing provenance registry',
      ),
    ).toThrow(/missing required field "provenance"/u);

    const arbitraryExclusion = structuredClone(registry) as {
      notCovered: Array<{ scopeId: string; diagnosticId: string }>;
    };
    arbitraryExclusion.notCovered.pop();
    expect(() =>
      contract.parseAssertionRegistry(
        JSON.stringify(arbitraryExclusion),
        'partial exclusion registry',
      ),
    ).toThrow(/complete frozen exclusion set/u);
  });

  test('executes the JSON Schema and parser for complete platform metadata', () => {
    const lock = readLock();
    const registry = readRegistry();
    const evidence = createPlatformEvidence('darwin-arm64', lock, registry);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const validateJsonSchemaValue = requiredFunction(
      'validateJsonSchemaValue',
    );

    expect(() =>
      validateJsonSchemaValue(evidence as never, schema as never, 'record' as never),
    ).not.toThrow();
    expect(
      contract.parsePlatformEvidence(JSON.stringify(evidence), 'record.json'),
    ).toEqual(evidence);

    const unknownMetadata = structuredClone(evidence);
    (
      unknownMetadata.environment as Record<string, unknown>
    ).rawCommand = 'node harness.js';
    expect(() =>
      validateJsonSchemaValue(
        unknownMetadata as never,
        schema as never,
        'record' as never,
      ),
    ).toThrow(/additional property "rawCommand"/u);
    expect(() =>
      contract.parsePlatformEvidence(
        JSON.stringify(unknownMetadata),
        'unknown-metadata.json',
      ),
    ).toThrow(/additional property "rawCommand"/u);
  });

  test('separates the candidate, validator, source, and harness identities', () => {
    const lock = readLock();
    const registry = readRegistry();
    const evidence = createPlatformEvidence('darwin-arm64', lock, registry);
    const provenance = evidence.provenance as {
      candidate: { commit: string; tree: string };
      validator: { commit: string; tree: string };
      cave: { commit: string; tree: string };
      coven: { commit: string; tree: string };
      chat: { commit: string; tree: string };
    };
    const harness = evidence.harness as { commit: string; tree: string };

    expect(provenance.candidate.commit).toBe(
      'acc38488f00860d246c3c553375634d64806eabb',
    );
    expect(provenance.validator.commit).not.toBe(
      provenance.candidate.commit,
    );
    expect(provenance.validator.tree).not.toBe(provenance.candidate.tree);
    for (const identity of [
      provenance.candidate,
      provenance.validator,
      provenance.cave,
      provenance.coven,
      provenance.chat,
      harness,
    ]) {
      expect(identity.commit).toMatch(/^[0-9a-f]{40}$/u);
      expect(identity.tree).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  test('rejects a validator identity equal to the packed candidate', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    for (const record of records) {
      const provenance = record.provenance as {
        candidate: { commit: string; tree: string };
        validator: { commit: string; tree: string };
      };
      provenance.validator.commit = provenance.candidate.commit;
      provenance.validator.tree = provenance.candidate.tree;
    }

    expect(() => aggregate(records)).toThrow(
      /validator provenance must be distinct from the packed SDK candidate/u,
    );
  });

  test('rejects repeated arbitrary artifact hashes and partial exclusions', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const repeated = structuredClone(records);
    for (const record of repeated) {
      const packages = (
        record.artifacts as unknown as {
          sdkPackages: Array<{ sha256: string }>;
        }
      ).sdkPackages;
      for (const entry of packages) {
        entry.sha256 =
          '9a574e8bd5178ce2aa20db97e8a741c7c9569515546a2d3089406f41a9d040fe';
      }
    }
    expect(() => aggregate(repeated)).toThrow(/frozen SDK package metadata/u);

    const partial = structuredClone(records);
    for (const record of partial) {
      (record.notCovered as unknown[]).pop();
    }
    expect(() => aggregate(partial)).toThrow(
      /notCovered must equal the complete frozen exclusion set/u,
    );
  });

  test('uses only the frozen Cave assertion IDs at aggregation time', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );

    expect(() => aggregate(records)).not.toThrow();
  });

  test('fails missing, duplicate, unexpected, failed, and skipped results', () => {
    const lock = readLock();
    const registry = readRegistry();
    const createRecords = () =>
      PLATFORMS.map((platform) =>
        createPlatformEvidence(platform, lock, registry),
      );

    const missing = createRecords();
    (missing[0]?.sdkAssertions as unknown[]).pop();
    expect(() => aggregate(missing)).toThrow(/SDK assertion coverage: missing/u);

    const duplicate = createRecords();
    const firstChatAssertion = (
      duplicate[0]?.chatAssertions as Array<Record<string, unknown>>
    )[0];
    if (firstChatAssertion === undefined) {
      throw new Error('Expected a Chat assertion fixture.');
    }
    (duplicate[0]?.chatAssertions as Array<Record<string, unknown>>).push({
      ...firstChatAssertion,
    });
    expect(() => aggregate(duplicate)).toThrow(
      /Chat assertion coverage: duplicate/u,
    );

    const unexpected = createRecords();
    (
      unexpected[0]?.caveRecord as {
        assertions: Array<Record<string, unknown>>;
      }
    ).assertions.splice(1, 0, {
      id: 'cave.unexpected',
      result: 'pass',
      detail: '',
    });
    expect(() => aggregate(unexpected)).toThrow(
      /Cave assertion coverage: unexpected/u,
    );

    const failed = createRecords();
    (
      failed[0]?.sdkAssertions as Array<{ result: string }>
    )[0]!.result = 'fail';
    expect(() => aggregate(failed)).toThrow(/did not pass/u);

    const skipped = createRecords();
    (
      skipped[0]?.chatAssertions as Array<{ result: string }>
    )[0]!.result = 'skip';
    expect(() => aggregate(skipped)).toThrow(/did not pass/u);
  });

  test('deep-canonicalizes aggregate bytes with LF and one trailing newline', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const serializeCanonicalJson = requiredFunction('serializeCanonicalJson');
    const first = serializeCanonicalJson(
      aggregate(records) as never,
    ) as string;
    const second = serializeCanonicalJson(
      aggregate(
        [...records]
          .reverse()
          .map((record) => reverseObjectKeys(record) as Record<string, unknown>),
      ) as never,
    ) as string;

    expect(Buffer.from(first, 'utf8')).toEqual(Buffer.from(second, 'utf8'));
    expect(first.endsWith('\n')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(false);
    expect(first).not.toContain('\r');
  });

  test('fully parses the canonical aggregate instead of trusting its summary', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const serializeCanonicalJson = requiredFunction('serializeCanonicalJson');
    const parseAggregatedConformanceEvidence = requiredFunction(
      'parseAggregatedConformanceEvidence',
    );
    const caveEngine = createCaveEngine(registry);
    const canonical = serializeCanonicalJson(
      aggregate(records) as never,
    ) as string;

    expect(
      parseAggregatedConformanceEvidence(
        canonical as never,
        'aggregate.json' as never,
        {
          caveEngine,
          frozenLockText: contract.serializeCanonicalJson(
            createCompatibleLock(),
          ),
        } as never,
      ),
    ).toEqual(JSON.parse(canonical));
    expect(() =>
      parseAggregatedConformanceEvidence(
        serializeCanonicalJson(
          {
            schemaVersion: 2,
            issue: 'OpenCoven/sdk#38',
            kind: 'client-v1-cross-repository-conformance',
            canonicalPlatforms: PLATFORMS,
            candidate: {
              provenance: {
                repository: 'OpenCoven/sdk',
                commit: 'acc38488f00860d246c3c553375634d64806eabb',
              },
            },
            summary: { status: 'passed' },
          } as never,
        ) as never,
        'forged.json' as never,
        {
          caveEngine,
          frozenLockText: contract.serializeCanonicalJson(
            createCompatibleLock(),
          ),
        } as never,
      ),
    ).toThrow(/missing required field/u);

    const copiedClaim = JSON.parse(canonical) as {
      platforms: Array<{
        caveRecord: {
          findings: Array<{ says: string }>;
        };
      }>;
    };
    const finding = copiedClaim.platforms[0]?.caveRecord.findings[0];
    if (finding === undefined) {
      throw new Error('Expected a Cave finding fixture.');
    }
    finding.says = 'fabricated aggregate-copied claim';
    expect(() =>
      parseAggregatedConformanceEvidence(
        serializeCanonicalJson(copiedClaim as never) as never,
        'copied-claim.json' as never,
        {
          caveEngine,
          frozenLockText: contract.serializeCanonicalJson(
            createCompatibleLock(),
          ),
        } as never,
      ),
    ).toThrow(/Cave record does not match the authoritative renderer/u);
  });

  test('binds reviewed protected-job attestations to each primary platform record', () => {
    const lock = readLock();
    const registry = readRegistry();
    const records = PLATFORMS.map((platform) =>
      createPlatformEvidence(platform, lock, registry),
    );
    const aggregateRecord = aggregate(records) as unknown as {
      candidate: { provenance: Record<string, unknown> };
      platforms: Array<Record<string, unknown> & { platform: string }>;
      validator: {
        repository: string;
        commit: string;
        tree: string;
      };
    };
    const aggregateText = contract.serializeCanonicalJson(aggregateRecord);
    const aggregatePath =
      'docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json';
    const compatibleLock = createCompatibleLock(lock);
    const index = {
      schemaVersion: 1,
      issue: 'OpenCoven/sdk#38',
      kind: 'client-v1-cross-repository-evidence-index',
      candidate: aggregateRecord.candidate.provenance,
      validator: {
        repository: aggregateRecord.validator.repository,
        commit: aggregateRecord.validator.commit,
        tree: aggregateRecord.validator.tree,
      },
      aggregate: {
        path: aggregatePath,
        size: Buffer.byteLength(aggregateText, 'utf8'),
        sha256: sha256(aggregateText),
      },
      producer: {
        repository: 'OpenCoven/chat',
        commit: 'f'.repeat(40),
        tree: 'c'.repeat(40),
        harness: {
          path: 'scripts/phase1-conformance.mjs',
          version: '0.1.0',
          size: 120_000,
          sha256: '2'.repeat(64),
        },
        workflow: {
          path: '.github/workflows/client-v1-conformance.yml',
          job: 'platform-conformance',
          environment: 'client-v1-conformance',
          signerWorkflow:
            'OpenCoven/chat/.github/workflows/client-v1-conformance.yml',
          signerDigest: 'f'.repeat(40),
          sourceDigest: 'f'.repeat(40),
          predicateType: 'https://slsa.dev/provenance/v1',
          denySelfHostedRunners: true,
        },
      },
      platforms: aggregateRecord.platforms.map((record, index_) => {
        const recordText = contract.serializeCanonicalJson(record);
        const artifactSha256 = `${index_ + 7}`.repeat(64);
        return {
          platform: record.platform,
          record: {
            size: Buffer.byteLength(recordText, 'utf8'),
            sha256: sha256(recordText),
          },
          protectedJob: {
            runId: String(10_000 + index_),
            runAttempt: 1,
            jobId: String(20_000 + index_),
            artifactName: `client-v1-conformance-${record.platform}`,
            artifactSha256,
            attestationSubjectSha256: artifactSha256,
            attestationBundleSha256: `${index_ + 3}`.repeat(64),
          },
        };
      }),
    };
    const parseReviewedEvidenceIndex = requiredFunction(
      'parseReviewedEvidenceIndex',
    );

    expect(
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(index) as never,
        'evidence index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toEqual(index);

    const fabricated = structuredClone(index);
    fabricated.platforms[0]!.record.sha256 = 'f'.repeat(64);
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(fabricated) as never,
        'fabricated evidence index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'fabricated evidence index darwin-arm64 record digest does not match the primary record',
    );

    const substitutedArtifact = structuredClone(index);
    substitutedArtifact.platforms[1]!.protectedJob.artifactName =
      'client-v1-conformance-darwin-arm64';
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(substitutedArtifact) as never,
        'substituted artifact index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'substituted artifact index linux-x64 artifact name does not match its platform',
    );

    const duplicateJob = structuredClone(index);
    duplicateJob.platforms[1]!.protectedJob = structuredClone(
      duplicateJob.platforms[0]!.protectedJob,
    );
    duplicateJob.platforms[1]!.protectedJob.artifactName =
      'client-v1-conformance-linux-x64';
    duplicateJob.platforms[1]!.protectedJob.artifactSha256 = '8'.repeat(64);
    duplicateJob.platforms[1]!.protectedJob.attestationSubjectSha256 =
      '8'.repeat(64);
    duplicateJob.platforms[1]!.protectedJob.attestationBundleSha256 =
      '9'.repeat(64);
    expect(() =>
      parseReviewedEvidenceIndex(
        contract.serializeCanonicalJson(duplicateJob) as never,
        'duplicate protected job index' as never,
        {
          frozenLock: compatibleLock,
          aggregate: aggregateRecord,
          aggregatePath,
          aggregateText,
        } as never,
      ),
    ).toThrow(
      'duplicate protected job index protected job provenance must be unique per platform',
    );
  });

  test.each([
    'Pairing_Secrets',
    'pairing-secret',
    'BEARER_TOKENS',
    'api.credentials',
    'privateKey',
    'passwords',
    'prompt_messages',
    'attachmentContents',
    'command-output',
    'private_cause',
    'requestHeaders',
    'response_urls',
    'socket-handles',
    'pipeHandles',
    'raw-diagnostics',
  ])('rejects normalized dangerous key %s', (key) => {
    expect(() => contract.scanConformanceEvidence({ [key]: 'redacted' })).toThrow(
      /forbidden evidence field/u,
    );
  });

  test.each([
    '/operator/private.json',
    '//server/share/private.json',
    'file:/operator/private.json',
    'file:C:\\operator\\private.json',
    '@name',
    '\\\\server\\pipe\\opencoven-private',
    '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\private.json',
    '\\\\.\\PhysicalDrive0',
    '//./pipe/opencoven-private',
    '/Users/operator/private.json',
    '/home/operator/private.json',
    '/mnt/c/Users/operator/private.json',
    '/private/var/folders/secret',
    '/var/tmp/private.json',
    '~/private.json',
    'C:\\Users\\operator\\private.json',
    'D:/operator/private.json',
    '\\\\server\\share\\private.json',
    '\\\\?\\C:\\private.json',
    '\\\\.\\pipe\\opencoven-private',
    '\u0000opencoven-abstract-socket',
    '@opencoven-abstract-socket',
    'https://operator.example.invalid/private',
    'file:///Users/operator/private.json',
    'unix:///tmp/opencoven.sock',
    '/workspace/operator/private.json',
    '/builds/operator/private.json',
    'operator@example.invalid',
  ])('rejects portable private path, handle, URL, or operator id %s', (value) => {
    expect(() => contract.scanConformanceEvidence({ detail: value })).toThrow();
  });

  test.each([
    '/operator/private.json',
    '//server/share/private.json',
    'file:/operator/private.json',
    '@name',
    '\\\\server\\pipe\\opencoven-private',
    'path=/operator/private.json',
    'uri:file:/operator/private.json',
    'pipe=\\\\server\\pipe\\opencoven-private',
    'socket=@name',
    'device,\\\\.\\PhysicalDrive0',
    'home:[~/private.json]',
  ])('rejects private value %s inside Cave text fields', (value) => {
    expect(() =>
      contract.scanConformanceEvidence({
        caveRecord: {
          assertions: [{ detail: `observed ${value}` }],
          findings: [{ says: `measured ${value}` }],
        },
      }),
    ).toThrow();
  });

  test('allows schema-approved opaque identifiers, digests, versions, and API routes', () => {
    expect(() =>
      contract.scanConformanceEvidence({
        invocationId: '123e4567-e89b-42d3-a456-426614174000',
        opaqueId: '0123456789abcdef0123456789abcdef',
        sha256: 'a'.repeat(64),
        nodeVersion: 'v24.18.1',
        caveRecord: {
          assertions: [{ detail: '/api/client/v1/health' }],
        },
        artifacts: {
          sdkPackages: [{ packageName: '@opencoven/sdk' }],
        },
        diagnosticId: 'phase1.assertion.passed',
      }),
    ).not.toThrow();
    expect(() =>
      contract.scanConformanceEvidence({
        detail: '/api/client/v1/health',
      }),
    ).toThrow();
  });
});
