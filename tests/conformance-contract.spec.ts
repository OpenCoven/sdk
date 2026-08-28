import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  aggregateConformanceEvidence,
  parseConformanceAggregationArgs,
  parsePlatformEvidence,
  readAssertionRegistry,
  scanConformanceEvidence,
} from '../scripts/conformance-contract.mjs';
import type {
  AssertionEntry,
  AssertionRegistry,
  CaveAssertionEngine,
  PlatformEvidence,
} from '../scripts/conformance-contract.d.mts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const COMMIT_C = 'c'.repeat(40);
const COMMIT_D = 'd'.repeat(40);
const PLATFORMS = ['darwin-arm64', 'linux-x64', 'win32-x64'] as const;

const registry: AssertionRegistry = {
  schemaVersion: 1,
  cave: {
    engine: 'scripts/client-v1-conformance.mjs',
    requireIncludeTtl: true,
    requireAuthorityTakeover: true,
  },
  sdk: ['sdk.one', 'sdk.two'],
  chat: {
    common: ['chat.common'],
    platforms: {
      'darwin-arm64': ['chat.darwin'],
      'linux-x64': ['chat.linux'],
      'win32-x64': ['chat.windows'],
    },
  },
};

function coverageFailures(
  entries: readonly { id: string }[],
  expected: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.id === 'harness.assertion-coverage') continue;
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
}

function summarize(entries: readonly { result: string }[]) {
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
}

function createCaveEngine(): CaveAssertionEngine {
  const engine: CaveAssertionEngine = {
    COVERAGE_ASSERTION_ID: 'harness.assertion-coverage',
    FINDINGS: [
      {
        id: 'cave-finding',
        measured: 'safe aggregate fixture',
        says: 'safe aggregate fixture',
        severity: 'documentation',
        where: 'docs/client-v1.md',
        why: 'fixture',
      },
    ],
    NOT_COVERED: [
      'The SDK and Chat halves are covered only by the cross-repository envelope.',
    ],
    expectedAssertionIds: () => ['cave.one', 'cave.two'],
    checkAssertionCoverage: coverageFailures,
    summarizeConformance: summarize,
    renderConformanceRecord: (entries, context) => ({
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
      nodeVersion: process.version,
      includeTtl: context.includeTtl,
      authorityTakeover: context.authorityTakeover,
      notCovered: context.notCovered,
      findings: context.findings,
      summary: summarize(entries),
      assertions: entries,
    }),
  };
  return engine;
}

function assertion(id: string): AssertionEntry {
  return {
    id,
    result: 'pass',
    diagnosticId: `${id}.passed`,
  };
}

function createPlatformEvidence(
  platform: (typeof PLATFORMS)[number],
): PlatformEvidence {
  const [os, arch] = platform.split('-') as [string, string];
  const chatPlatformId = registry.chat.platforms[platform][0];
  if (chatPlatformId === undefined) {
    throw new Error(`Missing test assertion for ${platform}.`);
  }
  const caveAssertions = [
    { id: 'cave.one', result: 'pass' as const, detail: '' },
    { id: 'cave.two', result: 'pass' as const, detail: '' },
    {
      id: 'harness.assertion-coverage',
      result: 'pass' as const,
      detail: 'complete',
    },
  ];
  return {
    schemaVersion: 1,
    issue: 'OpenCoven/sdk#38',
    platform,
    ranAt: '2026-08-28T23:30:00.000Z',
    environment: {
      os,
      arch,
      nodeVersion: 'v24.18.1',
      packageManagerVersion: 'pnpm@10.34.0',
    },
    releases: {
      cave: '0.3.9',
      coven: '0.1.0',
    },
    commits: {
      cave: COMMIT_A,
      coven: COMMIT_B,
      sdk: COMMIT_C,
      chat: COMMIT_D,
    },
    digests: {
      caveAssertionEngine: SHA_A,
      caveContractFixture: SHA_B,
      hpkeVectors: 'c'.repeat(64),
      consumerLock: 'd'.repeat(64),
      sdkTarballs: [
        { packageName: '@opencoven/sdk-core', sha256: '1'.repeat(64) },
        { packageName: '@opencoven/cave-client', sha256: '2'.repeat(64) },
        { packageName: '@opencoven/coven-client', sha256: '3'.repeat(64) },
        { packageName: '@opencoven/sdk', sha256: '4'.repeat(64) },
      ],
    },
    caveRecord: {
      harness: 'scripts/client-v1-conformance.mjs',
      issues: [
        'OpenCoven/coven-cave#4832',
        'OpenCoven/coven-cave#4838',
      ],
      scope: 'cave-only',
      ranAt: '2026-08-28T23:30:00.000Z',
      caveVersion: '0.3.9',
      commit: COMMIT_A,
      platform,
      nodeVersion: 'v24.18.1',
      includeTtl: true,
      authorityTakeover: {
        authorityMode: 'enforce',
        discoveryVersion: 2,
        mechanism: 'hpke-bound-v1',
      },
      notCovered: [...createCaveEngine().NOT_COVERED],
      findings: [...createCaveEngine().FINDINGS],
      summary: summarize(caveAssertions),
      assertions: caveAssertions,
    },
    sdkAssertions: registry.sdk.map(assertion),
    chatAssertions: [
      ...registry.chat.common.map(assertion),
      assertion(chatPlatformId),
    ],
    notCovered: [],
    isolation: {
      strategy: 'process-owned-temporary-roots',
      network: 'loopback-only',
      sourceCheckoutDependency: false,
      workspaceLinkDependency: false,
      retainedPrivatePaths: false,
      retainedSocketHandles: false,
      roots: [
        { id: 'cave-home', ownershipVerified: true, removedAfterRun: true },
        { id: 'coven-home', ownershipVerified: true, removedAfterRun: true },
        { id: 'consumer-home', ownershipVerified: true, removedAfterRun: true },
        {
          id: 'native-credential-store',
          ownershipVerified: true,
          removedAfterRun: true,
        },
      ],
      operatorState: [
        { id: 'cave-home', beforeSha256: SHA_A, afterSha256: SHA_A },
        { id: 'coven-home', beforeSha256: SHA_B, afterSha256: SHA_B },
        {
          id: 'native-credential-store',
          beforeSha256: 'c'.repeat(64),
          afterSha256: 'c'.repeat(64),
        },
        {
          id: 'projects',
          beforeSha256: 'd'.repeat(64),
          afterSha256: 'd'.repeat(64),
        },
      ],
    },
  };
}

function createRecords(): PlatformEvidence[] {
  return PLATFORMS.map(createPlatformEvidence);
}

describe('cross-repository conformance contract', () => {
  test('strictly parses the aggregation command', () => {
    expect(
      parseConformanceAggregationArgs([
        '--',
        '--cave-root',
        '../coven-cave',
        '--record',
        'darwin.json',
        '--record',
        'linux.json',
        '--record',
        'windows.json',
        '--out',
        'aggregate.json',
      ]),
    ).toEqual({
      caveRoot: '../coven-cave',
      recordPaths: ['darwin.json', 'linux.json', 'windows.json'],
      outputPath: 'aggregate.json',
      registryPath: null,
    });
    expect(() =>
      parseConformanceAggregationArgs(['--cave-root', '../cave', '--wat']),
    ).toThrow('Unknown option --wat');
    expect(() =>
      parseConformanceAggregationArgs([
        '--cave-root',
        '../cave',
        '--record',
        'one.json',
        '--out',
        'aggregate.json',
      ]),
    ).toThrow('exactly three --record values');
  });

  test('strictly parses bounded platform JSON', () => {
    const record = createPlatformEvidence('darwin-arm64');
    expect(parsePlatformEvidence(JSON.stringify(record), 'darwin.json')).toEqual(
      record,
    );
    expect(() =>
      parsePlatformEvidence(
        JSON.stringify({ ...record, unexpected: true }),
        'darwin.json',
      ),
    ).toThrow('darwin.json has unexpected field "unexpected"');
    expect(() =>
      parsePlatformEvidence('{"schemaVersion":1}', 'partial.json'),
    ).toThrow('partial.json is missing required field "issue"');
    const duplicatedIssue = JSON.stringify(record).replace(
      '"issue":"OpenCoven/sdk#38"',
      '"issue":"OpenCoven/sdk#38","issue":"OpenCoven/sdk#38"',
    );
    expect(() =>
      parsePlatformEvidence(duplicatedIssue, 'duplicate.json'),
    ).toThrow('duplicate.json contains duplicate JSON object key "issue"');
    const routeAssertion = createPlatformEvidence('darwin-arm64');
    const firstCaveAssertion = routeAssertion.caveRecord.assertions[0];
    if (firstCaveAssertion !== undefined) {
      firstCaveAssertion.id =
        'admin.unconfigured/admin/pairing-requests/:id/decision.POST';
    }
    expect(() =>
      parsePlatformEvidence(JSON.stringify(routeAssertion), 'route.json'),
    ).not.toThrow();
    expect(() =>
      parsePlatformEvidence(' '.repeat(1_048_577), 'large.json'),
    ).toThrow('large.json exceeds the 1048576-byte evidence limit');
  });

  test('aggregates all canonical platforms deterministically', () => {
    const baseEngine = createCaveEngine();
    const checkAssertionCoverage = vi.fn(coverageFailures);
    const renderRecord: CaveAssertionEngine['renderConformanceRecord'] = (
      entries,
      context,
    ) => baseEngine.renderConformanceRecord(entries, context);
    const renderConformanceRecord = vi.fn(
      renderRecord,
    );
    const caveEngine = {
      ...baseEngine,
      checkAssertionCoverage,
      renderConformanceRecord,
    };
    const records = createRecords().reverse();
    const first = aggregateConformanceEvidence({
      caveEngine,
      caveEngineSha256: SHA_A,
      canonicalPlatforms: PLATFORMS,
      registry,
      platformRecords: records,
    });
    const second = aggregateConformanceEvidence({
      caveEngine,
      caveEngineSha256: SHA_A,
      canonicalPlatforms: PLATFORMS,
      registry,
      platformRecords: createRecords(),
    });

    expect(first).toEqual(second);
    expect(first.platforms.map(({ platform }) => platform)).toEqual(PLATFORMS);
    expect(first.summary).toEqual({
      status: 'passed',
      platforms: 3,
      caveAssertions: 9,
      sdkAssertions: 6,
      chatAssertions: 6,
      failed: 0,
      skipped: 0,
    });
    expect(first.candidate.commits).toEqual(records[0]?.commits);
    expect(first.caveAssertionAuthority).toEqual({
      repository: 'OpenCoven/coven-cave',
      path: 'scripts/client-v1-conformance.mjs',
      commit: COMMIT_A,
      sha256: SHA_A,
    });
    expect(checkAssertionCoverage).toHaveBeenCalledTimes(18);
    expect(renderConformanceRecord).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(first)).not.toContain('../coven-cave');
  });

  test('fails on missing, duplicate, or unexpected platforms', () => {
    const input = {
      caveEngine: createCaveEngine(),
      caveEngineSha256: SHA_A,
      canonicalPlatforms: PLATFORMS,
      registry,
    };
    expect(() =>
      aggregateConformanceEvidence({
        ...input,
        platformRecords: createRecords().slice(0, 2),
      }),
    ).toThrow('missing platform "win32-x64"');

    const duplicate = createRecords();
    duplicate[2] = createPlatformEvidence('linux-x64');
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: duplicate }),
    ).toThrow('platform "linux-x64" was recorded 2 times');

    const unexpected = createRecords();
    unexpected[2] = {
      ...createPlatformEvidence('win32-x64'),
      platform: 'linux-arm64',
      environment: {
        ...createPlatformEvidence('win32-x64').environment,
        os: 'linux',
        arch: 'arm64',
      },
    };
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: unexpected }),
    ).toThrow('unexpected platform "linux-arm64"');
  });

  test('fails on missing, duplicate, unexpected, failed, or skipped assertions', () => {
    const input = {
      caveEngine: createCaveEngine(),
      caveEngineSha256: SHA_A,
      canonicalPlatforms: PLATFORMS,
      registry,
    };
    const missing = createRecords();
    missing[0]?.sdkAssertions.pop();
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: missing }),
    ).toThrow('darwin-arm64 SDK assertion coverage: missing sdk.two');

    const duplicate = createRecords();
    duplicate[0]?.chatAssertions.push(assertion('chat.common'));
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: duplicate }),
    ).toThrow(
      'darwin-arm64 Chat assertion coverage: duplicate chat.common',
    );

    const unexpected = createRecords();
    unexpected[0]?.caveRecord.assertions.splice(1, 0, {
      id: 'cave.surprise',
      result: 'pass',
      detail: '',
    });
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: unexpected }),
    ).toThrow(
      'darwin-arm64 Cave assertion coverage: unexpected cave.surprise',
    );

    const failed = createRecords();
    const sdkFailure = failed[0]?.sdkAssertions[0];
    if (sdkFailure !== undefined) sdkFailure.result = 'fail';
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: failed }),
    ).toThrow('darwin-arm64 SDK assertion "sdk.one" did not pass');

    const skipped = createRecords();
    const chatSkip = skipped[0]?.chatAssertions[0];
    if (chatSkip !== undefined) chatSkip.result = 'skip';
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: skipped }),
    ).toThrow('darwin-arm64 Chat assertion "chat.common" did not pass');
  });

  test('fails when SDK or Chat remains notCovered', () => {
    const records = createRecords();
    records[0]?.notCovered.push('Chat restart coverage remains external.');
    expect(() =>
      aggregateConformanceEvidence({
        caveEngine: createCaveEngine(),
        caveEngineSha256: SHA_A,
        canonicalPlatforms: PLATFORMS,
        registry,
        platformRecords: records,
      }),
    ).toThrow('darwin-arm64 notCovered still excludes SDK or Chat');
  });

  test('fails when commits or artifact digests differ across platforms', () => {
    const input = {
      caveEngine: createCaveEngine(),
      caveEngineSha256: SHA_A,
      canonicalPlatforms: PLATFORMS,
      registry,
    };
    const commits = createRecords();
    if (commits[1] !== undefined) commits[1].commits.sdk = 'e'.repeat(40);
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: commits }),
    ).toThrow('linux-x64 commits do not match darwin-arm64');

    const digests = createRecords();
    const firstTarball = digests[2]?.digests.sdkTarballs[0];
    if (firstTarball !== undefined) firstTarball.sha256 = 'f'.repeat(64);
    expect(() =>
      aggregateConformanceEvidence({ ...input, platformRecords: digests }),
    ).toThrow('win32-x64 digests do not match darwin-arm64');
  });

  test('fails on incomplete isolation proof', () => {
    const records = createRecords();
    const operatorState = records[0]?.isolation.operatorState[0];
    if (operatorState !== undefined) operatorState.afterSha256 = SHA_B;
    expect(() =>
      aggregateConformanceEvidence({
        caveEngine: createCaveEngine(),
        caveEngineSha256: SHA_A,
        canonicalPlatforms: PLATFORMS,
        registry,
        platformRecords: records,
      }),
    ).toThrow('darwin-arm64 operator state "cave-home" changed');

    const workspaceLinked = createRecords();
    if (workspaceLinked[0] !== undefined) {
      workspaceLinked[0].isolation.workspaceLinkDependency = true;
    }
    expect(() =>
      aggregateConformanceEvidence({
        caveEngine: createCaveEngine(),
        caveEngineSha256: SHA_A,
        canonicalPlatforms: PLATFORMS,
        registry,
        platformRecords: workspaceLinked,
      }),
    ).toThrow('darwin-arm64 used a workspace-link dependency');
  });

  test('fails on Cave record or assertion-engine drift', () => {
    const input = {
      caveEngine: createCaveEngine(),
      caveEngineSha256: SHA_A,
      canonicalPlatforms: PLATFORMS,
      registry,
    };
    const engineDigest = createRecords();
    if (engineDigest[0] !== undefined) {
      engineDigest[0].digests.caveAssertionEngine = SHA_B;
    }
    expect(() =>
      aggregateConformanceEvidence({
        ...input,
        platformRecords: engineDigest,
      }),
    ).toThrow(
      'darwin-arm64 Cave assertion engine digest does not match the loaded engine',
    );

    const caveRecord = createRecords();
    if (caveRecord[0] !== undefined) {
      caveRecord[0].caveRecord.includeTtl = false;
    }
    expect(() =>
      aggregateConformanceEvidence({
        ...input,
        platformRecords: caveRecord,
      }),
    ).toThrow('darwin-arm64 Cave record did not include the TTL assertions');
  });

  test('bounds retained evidence and rejects secrets, content, and private paths', () => {
    expect(() =>
      scanConformanceEvidence({ authorization: 'Bearer abcdefghijklmnop' }),
    ).toThrow('forbidden evidence field "authorization"');
    expect(() =>
      scanConformanceEvidence({ detail: 'x-coven-pairing-secret: abcdefghijklmnop' }),
    ).toThrow('possible secret');
    expect(() =>
      scanConformanceEvidence({ messageBody: 'hello from a private transcript' }),
    ).toThrow('forbidden evidence field "messageBody"');
    expect(() =>
      scanConformanceEvidence({ detail: '/Users/example/.coven/private.json' }),
    ).toThrow('private filesystem path');
    expect(() =>
      scanConformanceEvidence({ detail: '/run/user/501/coven.sock' }),
    ).toThrow('private filesystem path');
    expect(() =>
      scanConformanceEvidence({ detail: 'x'.repeat(16_385) }),
    ).toThrow('string exceeds the 16384-byte evidence limit');
    expect(() => scanConformanceEvidence({ detail: '/api/client/v1/health' })).not
      .toThrow();
  });

  test('ships the complete registry, schema, command, and runbook', () => {
    const workspaceRoot = resolve(import.meta.dirname, '..');
    const loaded = readAssertionRegistry(
      resolve(
        workspaceRoot,
        'conformance/client-v1-cross-repository-assertions.json',
      ),
    );
    expect(loaded.sdk).toContain('sdk.cave.revocation.messages-refused');
    expect(loaded.sdk).toContain('sdk.cave.cursor.reconcile-required');
    expect(loaded.chat.common).toContain('chat.cave.bearer-never-enters-webview');
    expect(loaded.chat.platforms['darwin-arm64']).toContain(
      'chat.coven.unix.wrong-peer-uid-refused',
    );
    expect(loaded.chat.platforms['linux-x64']).toContain(
      'chat.coven.unix.replaced-socket-refused',
    );
    expect(loaded.chat.platforms['win32-x64']).toContain(
      'chat.coven.windows.foreign-pipe-refused',
    );

    const schema = JSON.parse(
      readFileSync(
        resolve(
          workspaceRoot,
          'conformance/client-v1-cross-repository-evidence.schema.json',
        ),
        'utf8',
      ),
    ) as { additionalProperties?: boolean; title?: string };
    expect(schema.title).toBe(
      'OpenCoven Client v1 cross-repository platform evidence',
    );
    expect(schema.additionalProperties).toBe(false);

    const manifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.['conformance:aggregate']).toBe(
      'node ./scripts/aggregate-client-v1-conformance.mjs',
    );
    expect(manifest.scripts?.['test:conformance-contract']).toBe(
      'vitest run tests/conformance-contract.spec.ts',
    );

    const runbook = readFileSync(
      resolve(
        workspaceRoot,
        'docs/workflows/client-v1-cross-repository-conformance.md',
      ),
      'utf8',
    );
    expect(runbook).toContain('Cave remains the assertion authority');
    expect(runbook).toContain('No command in this repository starts a platform run');
    expect(runbook).toContain('conformance:aggregate');
  });
});
