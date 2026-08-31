import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  aggregateConformanceEvidence,
  readAssertionRegistry,
} from '../scripts/conformance-contract.mjs';
import type {
  AssertionEntry,
  CaveAssertionEntry,
  CaveAssertionEngine,
  ConformanceSummary,
  PlatformEvidence,
} from '../scripts/conformance-contract.d.mts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = readAssertionRegistry(
  resolve(
    workspaceRoot,
    'conformance/client-v1-cross-repository-assertions.json',
  ),
);
const PLATFORMS = ['darwin-arm64', 'linux-x64', 'win32-x64'] as const;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_REGISTRY = 'e'.repeat(64);
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const COMMIT_C = 'c'.repeat(40);
const COMMIT_D = 'd'.repeat(40);
const COMMIT_E = 'e'.repeat(40);
const RAN_AT = '2026-08-28T23:30:00.000Z';
const CAVE_ASSERTION_IDS = ['cave.one', 'cave.two'];

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

function summarize(
  entries: readonly { result: string }[],
): ConformanceSummary {
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

interface EngineOptions {
  blindToMissing?: boolean;
  countSkipAsPass?: boolean;
  reportExtraSkips?: number;
  corruptRenderedSummary?: boolean;
}

function createCaveEngine(options: EngineOptions = {}): CaveAssertionEngine {
  const summarizeConformance = (
    entries: readonly { result: string }[],
  ): ConformanceSummary => {
    const summary = summarize(entries);
    let passed = summary.passed;
    let skipped = summary.skipped;
    if (options.countSkipAsPass === true) {
      passed += skipped;
      skipped = 0;
    }
    if (typeof options.reportExtraSkips === 'number') {
      skipped += options.reportExtraSkips;
    }
    return { ...summary, passed, skipped };
  };
  const checkAssertionCoverage = (
    entries: readonly { id: string }[],
    expected: readonly string[],
  ): string[] => {
    const failures = coverageFailures(entries, expected);
    if (options.blindToMissing === true) {
      return failures.filter((failure) => !failure.startsWith('missing '));
    }
    return failures;
  };
  const renderConformanceRecord: CaveAssertionEngine['renderConformanceRecord'] =
    (entries, context) => {
      const record: PlatformEvidence['caveRecord'] = {
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
        authorityTakeover: { ...context.authorityTakeover },
        notCovered: [...context.notCovered],
        findings: context.findings.map((finding) => ({ ...finding })),
        summary: summarizeConformance(entries),
        assertions: entries.map((entry) => ({ ...entry })),
      };
      if (options.corruptRenderedSummary === true) {
        record.summary = { ...record.summary, failed: 1 };
      }
      return record;
    };
  return {
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
    expectedAssertionIds: () => [...CAVE_ASSERTION_IDS],
    checkAssertionCoverage,
    summarizeConformance,
    renderConformanceRecord,
  };
}

function passingAssertions(ids: readonly string[]): AssertionEntry[] {
  return ids.map((id) => ({
    id,
    result: 'pass',
    diagnosticId: `${id}.passed`,
  }));
}

function caveAssertionEntries(): CaveAssertionEntry[] {
  const entries: CaveAssertionEntry[] = CAVE_ASSERTION_IDS.map((id) => ({
    id,
    result: 'pass',
    detail: '',
  }));
  entries.push({
    id: 'harness.assertion-coverage',
    result: 'pass',
    detail: 'complete',
  });
  return entries;
}

function chatAssertionIdsFor(platform: string): string[] {
  const platformIds =
    REGISTRY.chat.platforms[platform as keyof typeof REGISTRY.chat.platforms];
  if (platformIds === undefined) {
    throw new Error(`no chat registry entries for ${platform}`);
  }
  return [...REGISTRY.chat.common, ...platformIds];
}

function createPlatformEvidence(
  platform: (typeof PLATFORMS)[number],
): PlatformEvidence {
  const [os, arch] = platform.split('-') as [string, string];
  const caveAssertions = caveAssertionEntries();
  return {
    schemaVersion: 1,
    issue: 'OpenCoven/sdk#38',
    platform,
    ranAt: RAN_AT,
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
      assertionRegistry: SHA_REGISTRY,
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
      ranAt: RAN_AT,
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
      notCovered: ['The SDK and Chat halves are covered only by the cross-repository envelope.'],
      findings: [
        {
          id: 'cave-finding',
          measured: 'safe aggregate fixture',
          says: 'safe aggregate fixture',
          severity: 'documentation',
          where: 'docs/client-v1.md',
          why: 'fixture',
        },
      ],
      summary: summarize(caveAssertions),
      assertions: caveAssertions,
    },
    sdkAssertions: passingAssertions(REGISTRY.sdk),
    chatAssertions: passingAssertions(chatAssertionIdsFor(platform)),
    coverage: {
      cave: true,
      coven: true,
      sdk: true,
      chat: true,
    },
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

function aggregate(records: PlatformEvidence[], engine = createCaveEngine()) {
  return aggregateConformanceEvidence({
    caveEngine: engine,
    caveEngineSha256: SHA_A,
    assertionRegistrySha256: SHA_REGISTRY,
    canonicalPlatforms: PLATFORMS,
    registry: REGISTRY,
    platformRecords: records,
  });
}

function recordFor(
  records: PlatformEvidence[],
  platform: string,
): PlatformEvidence {
  const record = records.find((entry) => entry.platform === platform);
  if (record === undefined) {
    throw new Error(`fixture is missing the ${platform} record`);
  }
  return record;
}

function dropAssertion(
  record: PlatformEvidence,
  list: 'sdkAssertions' | 'chatAssertions',
  id: string,
): void {
  record[list] = record[list].filter((entry) => entry.id !== id);
}

function markAssertion(
  record: PlatformEvidence,
  list: 'sdkAssertions' | 'chatAssertions',
  id: string,
  result: 'fail' | 'skip',
): void {
  const entry = record[list].find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(`fixture is missing the ${id} assertion`);
  }
  entry.result = result;
}

function swapAdjacent(entries: { id: string }[]): void {
  const [first, second] = entries;
  if (first === undefined || second === undefined) {
    throw new Error('fixture list is too short to reorder');
  }
  entries[0] = second;
  entries[1] = first;
}

interface AuthorityDefect {
  name: string;
  expected: string;
  defect: (records: PlatformEvidence[]) => void;
}

function journeyDefects(): AuthorityDefect[] {
  return [
    {
      name: 'authority accepted a wrong pairing secret',
      expected: 'coverage: missing sdk.cave.pairing.wrong-secret-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.pairing.wrong-secret-refused');
      },
    },
    {
      name: 'authority accepted a replayed exchange',
      expected: 'coverage: missing sdk.cave.pairing.replay-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.pairing.replay-refused');
      },
    },
    {
      name: 'authority hid a pairing denial',
      expected: 'coverage: missing sdk.cave.pairing.denied',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.pairing.denied');
      },
    },
    {
      name: 'authority hid a pairing expiry',
      expected: 'coverage: missing sdk.cave.pairing.expired',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.pairing.expired');
      },
    },
    {
      name: 'authority ignored the shared failure budget',
      expected: 'coverage: missing sdk.cave.pairing.shared-failure-budget',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.pairing.shared-failure-budget');
      },
    },
    {
      name: 'authority ignored the pairing rate limit',
      expected: 'coverage: missing sdk.cave.pairing.rate-limit',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.pairing.rate-limit');
      },
    },
    {
      name: 'authority exchanged the pairing twice',
      expected: 'coverage: duplicate sdk.cave.pairing.exchange-once',
      defect: (records) => {
        const record = recordFor(records, 'darwin-arm64');
        const entry = record.sdkAssertions.find(
          (candidate) => candidate.id === 'sdk.cave.pairing.exchange-once',
        );
        if (entry === undefined) {
          throw new Error('fixture is missing the exchange-once assertion');
        }
        record.sdkAssertions.push({ ...entry });
      },
    },
    {
      name: 'authority skipped the missing Content-Length control case',
      expected:
        'coverage: missing sdk.cave.exchange.missing-content-length-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.exchange.missing-content-length-refused');
      },
    },
    {
      name: 'authority skipped the Content-Length: 0 exchange case',
      expected:
        'coverage: missing sdk.cave.exchange.content-length-zero-accepted',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.exchange.content-length-zero-accepted');
      },
    },
    {
      name: 'authority collapsed proxy rejections into the Client v1 envelope',
      expected: 'coverage: missing sdk.cave.proxy-rejection.distinct-envelope',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.proxy-rejection.distinct-envelope');
      },
    },
    {
      name: 'authority trusted a stale discovery record',
      expected: 'coverage: missing sdk.cave.discovery.stale-record-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.discovery.stale-record-refused');
      },
    },
    {
      name: 'authority trusted a replaced Cave instance',
      expected: 'coverage: missing sdk.cave.discovery.replaced-instance-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.discovery.replaced-instance-refused');
      },
    },
    {
      name: 'authority accepted a malformed cursor',
      expected: 'coverage: missing sdk.cave.cursor.malformed-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.cursor.malformed-refused');
      },
    },
    {
      name: 'authority accepted a non-canonical cursor',
      expected: 'coverage: missing sdk.cave.cursor.noncanonical-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.cursor.noncanonical-refused');
      },
    },
    {
      name: 'authority lost the reconcile_required case',
      expected: 'coverage: missing sdk.cave.cursor.reconcile-required',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.cursor.reconcile-required');
      },
    },
    {
      name: 'authority served reads with a revoked credential',
      expected: 'coverage: missing sdk.cave.revocation.familiars-refused',
      defect: (records) => {
        const record = recordFor(records, 'darwin-arm64');
        for (const id of [
          'sdk.cave.revocation.familiars-refused',
          'sdk.cave.revocation.projects-refused',
          'sdk.cave.revocation.conversations-refused',
          'sdk.cave.revocation.conversation-refused',
          'sdk.cave.revocation.messages-refused',
        ]) {
          dropAssertion(record, 'sdkAssertions', id);
        }
      },
    },
    {
      name: 'authority connected without a bounded deadline',
      expected: 'coverage: missing sdk.deadline.connect-bounded',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.deadline.connect-bounded');
      },
    },
    {
      name: 'authority moved the bearer out of the native SecretStore',
      expected: 'coverage: missing sdk.cave.credential.native-store-required',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.credential.native-store-required');
      },
    },
    {
      name: 'authority did not reuse the credential after restart',
      expected: 'coverage: missing sdk.cave.credential.restart-reused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'sdkAssertions', 'sdk.cave.credential.restart-reused');
      },
    },
    {
      name: 'authority failed open without the native keychain',
      expected:
        '"sdk.native.keychain-missing-fails-closed" did not pass',
      defect: (records) => {
        markAssertion(
          recordFor(records, 'darwin-arm64'),
          'sdkAssertions',
          'sdk.native.keychain-missing-fails-closed',
          'fail',
        );
      },
    },
    {
      name: 'authority skipped the trust-binding failure case',
      expected:
        '"sdk.native.trust-binding-missing-fails-closed" did not pass',
      defect: (records) => {
        markAssertion(
          recordFor(records, 'darwin-arm64'),
          'sdkAssertions',
          'sdk.native.trust-binding-missing-fails-closed',
          'skip',
        );
      },
    },
    {
      name: 'authority reported an unplanned assertion',
      expected: 'coverage: unexpected sdk.cave.pairing.unplanned',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').sdkAssertions.push({
          id: 'sdk.cave.pairing.unplanned',
          result: 'pass',
          diagnosticId: 'sdk.cave.pairing.unplanned.passed',
        });
      },
    },
    {
      name: 'authority reordered the SDK assertions',
      expected:
        'darwin-arm64 SDK assertion order does not match the authoritative registry',
      defect: (records) => {
        swapAdjacent(recordFor(records, 'darwin-arm64').sdkAssertions);
      },
    },
    {
      name: 'authority reordered the Chat assertions',
      expected:
        'darwin-arm64 Chat assertion order does not match the authoritative registry',
      defect: (records) => {
        swapAdjacent(recordFor(records, 'darwin-arm64').chatAssertions);
      },
    },
    {
      name: 'authority reordered its own Cave assertions',
      expected:
        'darwin-arm64 Cave assertion order does not match the authoritative registry',
      defect: (records) => {
        swapAdjacent(recordFor(records, 'darwin-arm64').caveRecord.assertions);
      },
    },
    {
      name: 'consumer never inspected the live Unix peer identity',
      expected: 'coverage: missing chat.coven.unix.connected-peer-identity',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.coven.unix.connected-peer-identity');
      },
    },
    {
      name: 'consumer accepted a malicious COVEN_HOME',
      expected: 'coverage: missing chat.coven.unix.malicious-home-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.coven.unix.malicious-home-refused');
      },
    },
    {
      name: 'consumer accepted a wrong socket peer UID',
      expected: 'coverage: missing chat.coven.unix.wrong-peer-uid-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'linux-x64'), 'chatAssertions', 'chat.coven.unix.wrong-peer-uid-refused');
      },
    },
    {
      name: 'consumer accepted a constructed Windows pipe',
      expected: 'coverage: missing chat.coven.windows.constructed-pipe-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'win32-x64'), 'chatAssertions', 'chat.coven.windows.constructed-pipe-refused');
      },
    },
    {
      name: 'consumer accepted a foreign Windows pipe',
      expected: 'coverage: missing chat.coven.windows.foreign-pipe-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'win32-x64'), 'chatAssertions', 'chat.coven.windows.foreign-pipe-refused');
      },
    },
    {
      name: 'consumer skipped executable trust validation',
      expected: 'coverage: missing chat.coven.executable.trusted',
      defect: (records) => {
        dropAssertion(recordFor(records, 'win32-x64'), 'chatAssertions', 'chat.coven.executable.trusted');
      },
    },
    {
      name: 'consumer swallowed structured daemon errors',
      expected: 'coverage: missing chat.coven.structured-errors-preserved',
      defect: (records) => {
        dropAssertion(recordFor(records, 'linux-x64'), 'chatAssertions', 'chat.coven.structured-errors-preserved');
      },
    },
    {
      name: 'consumer retained prompts in evidence',
      expected: 'coverage: missing chat.evidence.no-prompts',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.evidence.no-prompts');
      },
    },
    {
      name: 'consumer retained message bodies in evidence',
      expected: 'coverage: missing chat.evidence.no-message-bodies',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.evidence.no-message-bodies');
      },
    },
    {
      name: 'consumer retained attachments in evidence',
      expected: 'coverage: missing chat.evidence.no-attachments',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.evidence.no-attachments');
      },
    },
    {
      name: 'consumer retained command output in evidence',
      expected: 'coverage: missing chat.evidence.no-command-output',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.evidence.no-command-output');
      },
    },
    {
      name: 'consumer repaired credentials automatically',
      expected: 'coverage: missing chat.cave.restart.no-automatic-repairing',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.cave.restart.no-automatic-repairing');
      },
    },
    {
      name: 'consumer kept stale state after Cave replacement',
      expected: 'coverage: missing chat.cave.replacement.stale-state-refused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.cave.replacement.stale-state-refused');
      },
    },
    {
      name: 'consumer re-paired instead of reusing the credential',
      expected: 'coverage: missing chat.cave.restart.credential-reused',
      defect: (records) => {
        dropAssertion(recordFor(records, 'darwin-arm64'), 'chatAssertions', 'chat.cave.restart.credential-reused');
      },
    },
  ];
}

function authorityBindingDefects(): AuthorityDefect[] {
  return [
    {
      name: 'authority downgraded takeover to observe mode',
      expected: 'did not include the authority-takeover proof',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').caveRecord.authorityTakeover.authorityMode = 'observe';
      },
    },
    {
      name: 'authority downgraded discovery to version 1',
      expected: 'did not include the authority-takeover proof',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').caveRecord.authorityTakeover.discoveryVersion = 1;
      },
    },
    {
      name: 'authority swapped the hpke-bound mechanism',
      expected: 'did not include the authority-takeover proof',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').caveRecord.authorityTakeover.mechanism = 'bearer-v1';
      },
    },
    {
      name: 'authority dropped the TTL assertions',
      expected: 'did not include the TTL assertions',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').caveRecord.includeTtl = false;
      },
    },
    {
      name: 'record ran a different Cave assertion engine',
      expected:
        'Cave assertion engine digest does not match the loaded engine',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').digests.caveAssertionEngine = SHA_B;
      },
    },
    {
      name: 'record aggregated against a different registry',
      expected:
        'assertion registry digest does not match the committed registry',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').digests.assertionRegistry = SHA_B;
      },
    },
    {
      name: 'platform recorded a different SDK commit',
      expected: 'linux-x64 commits do not match darwin-arm64',
      defect: (records) => {
        recordFor(records, 'linux-x64').commits.sdk = COMMIT_E;
      },
    },
    {
      name: 'platform packed different SDK tarballs',
      expected: 'win32-x64 digests do not match darwin-arm64',
      defect: (records) => {
        const tarballs = recordFor(records, 'win32-x64').digests.sdkTarballs;
        const first = tarballs[0];
        if (first === undefined) {
          throw new Error('fixture is missing the first tarball');
        }
        first.sha256 = 'f'.repeat(64);
      },
    },
  ];
}

function isolationDefects(): AuthorityDefect[] {
  return [
    {
      name: 'harness mutated the operator Cave home',
      expected: 'operator state "cave-home" changed',
      defect: (records) => {
        const state = recordFor(records, 'darwin-arm64').isolation.operatorState[0];
        if (state === undefined) {
          throw new Error('fixture is missing the cave-home operator state');
        }
        state.afterSha256 = SHA_B;
      },
    },
    {
      name: 'harness mutated operator projects',
      expected: 'operator state "projects" changed',
      defect: (records) => {
        const states = recordFor(records, 'darwin-arm64').isolation.operatorState;
        const projects = states.find((entry) => entry.id === 'projects');
        if (projects === undefined) {
          throw new Error('fixture is missing the projects operator state');
        }
        projects.afterSha256 = SHA_B;
      },
    },
    {
      name: 'harness left the temporary Coven home behind',
      expected: 'isolation root "coven-home" was not owned and removed',
      defect: (records) => {
        const roots = recordFor(records, 'darwin-arm64').isolation.roots;
        const covenHome = roots.find((entry) => entry.id === 'coven-home');
        if (covenHome === undefined) {
          throw new Error('fixture is missing the coven-home root');
        }
        covenHome.removedAfterRun = false;
      },
    },
    {
      name: 'harness retained socket handles',
      expected: 'retained socket handles',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').isolation.retainedSocketHandles = true;
      },
    },
    {
      name: 'harness retained private filesystem paths',
      expected: 'retained private filesystem paths',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').isolation.retainedPrivatePaths = true;
      },
    },
    {
      name: 'harness left the loopback-only network boundary',
      expected: 'isolation network was not loopback-only',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').isolation.network = 'lan';
      },
    },
    {
      name: 'harness linked the consumer to the SDK workspace',
      expected: 'used a workspace-link dependency',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').isolation.workspaceLinkDependency = true;
      },
    },
    {
      name: 'harness built against the source checkout',
      expected: 'used a source-checkout dependency',
      defect: (records) => {
        recordFor(records, 'darwin-arm64').isolation.sourceCheckoutDependency = true;
      },
    },
    {
      name: 'harness reordered the isolation roots',
      expected:
        'darwin-arm64 isolation roots assertion order does not match the authoritative registry',
      defect: (records) => {
        swapAdjacent(recordFor(records, 'darwin-arm64').isolation.roots);
      },
    },
    {
      name: 'harness reordered the operator-state proofs',
      expected:
        'darwin-arm64 operator state assertion order does not match the authoritative registry',
      defect: (records) => {
        swapAdjacent(recordFor(records, 'darwin-arm64').isolation.operatorState);
      },
    },
  ];
}

describe('representative authority-defect mutations', () => {
  test('the unmutated three-platform candidate aggregates cleanly', () => {
    const result = aggregate(createRecords());
    expect(result.summary.status).toBe('passed');
    expect(result.summary.failed).toBe(0);
    expect(result.summary.skipped).toBe(0);
    expect(result.summary.caveAssertions).toBe(
      PLATFORMS.length * (CAVE_ASSERTION_IDS.length + 1),
    );
    expect(result.summary.sdkAssertions).toBe(REGISTRY.sdk.length * 3);
    expect(result.summary.chatAssertions).toBe(
      PLATFORMS.reduce(
        (total, platform) => total + chatAssertionIdsFor(platform).length,
        0,
      ),
    );
    expect(result.platforms.map(({ platform }) => platform)).toEqual(PLATFORMS);
  });

  test('input order does not change the aggregate bytes', () => {
    const forward = aggregate(createRecords());
    const reversed = aggregate(createRecords().reverse());
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  test.each(journeyDefects())('$name', ({ expected, defect }) => {
    const records = createRecords();
    defect(records);
    expect(() => aggregate(records)).toThrow(expected);
  });

  test.each(authorityBindingDefects())('$name', ({ expected, defect }) => {
    const records = createRecords();
    defect(records);
    expect(() => aggregate(records)).toThrow(expected);
  });

  test.each(isolationDefects())('$name', ({ expected, defect }) => {
    const records = createRecords();
    defect(records);
    expect(() => aggregate(records)).toThrow(expected);
  });

  test('skips are never counted as passes anywhere in a record', () => {
    const records = createRecords();
    const record = recordFor(records, 'darwin-arm64');
    for (const entry of record.caveRecord.assertions) entry.result = 'skip';
    for (const entry of record.sdkAssertions) entry.result = 'skip';
    for (const entry of record.chatAssertions) entry.result = 'skip';
    expect(() => aggregate(records)).toThrow(
      'darwin-arm64 Cave assertion "cave.one" did not pass',
    );
  });

  describe('opaque Cave-record helpers at aggregation time', () => {
    test('rejects non-boolean TTL flags', () => {
      const records = createRecords();
      const record = recordFor(records, 'darwin-arm64');
      const caveRecord = record.caveRecord as unknown as Record<string, unknown>;
      caveRecord.includeTtl = 'yes';
      expect(() => aggregate(records)).toThrow(
        'darwin-arm64 Cave record includeTtl must be a boolean',
      );
    });

    test('rejects non-integer discovery versions', () => {
      const records = createRecords();
      const record = recordFor(records, 'darwin-arm64');
      record.caveRecord.authorityTakeover.discoveryVersion = 2.5;
      expect(() => aggregate(records)).toThrow(
        'darwin-arm64 Cave record discoveryVersion must be an integer',
      );
    });

    test('rejects non-string Cave assertion details', () => {
      const records = createRecords();
      const record = recordFor(records, 'darwin-arm64');
      const entry = record.caveRecord.assertions[0];
      if (entry === undefined) {
        throw new Error('fixture is missing the first Cave assertion');
      }
      (entry as unknown as { detail: unknown }).detail = 7;
      expect(() => aggregate(records)).toThrow(
        'darwin-arm64 Cave record assertions[0].detail must be a string',
      );
    });

    test('rejects unknown Cave assertion results', () => {
      const records = createRecords();
      const record = recordFor(records, 'darwin-arm64');
      const entry = record.caveRecord.assertions[0];
      if (entry === undefined) {
        throw new Error('fixture is missing the first Cave assertion');
      }
      (entry as { result: string }).result = 'unknown';
      expect(() => aggregate(records)).toThrow(
        'darwin-arm64 Cave record assertions[0].result must be pass, fail, or skip',
      );
    });

    test('rejects records whose platform contradicts its environment', () => {
      const records = createRecords();
      recordFor(records, 'darwin-arm64').environment = {
        os: 'linux',
        arch: 'x64',
        nodeVersion: 'v24.18.1',
        packageManagerVersion: 'pnpm@10.34.0',
      };
      expect(() => aggregate(records)).toThrow(
        'darwin-arm64 does not match its OS and architecture',
      );
    });
  });

  describe('defective assertion engines are still caught', () => {
    test('a coverage check blind to missing assertions fails the order check', () => {
      const records = createRecords();
      dropAssertion(
        recordFor(records, 'darwin-arm64'),
        'sdkAssertions',
        'sdk.cave.pairing.wrong-secret-refused',
      );
      expect(() =>
        aggregate(records, createCaveEngine({ blindToMissing: true })),
      ).toThrow(
        'darwin-arm64 SDK assertion order does not match the authoritative registry',
      );
    });

    test('a summary that counts skips as passes fails the per-result check', () => {
      const records = createRecords();
      markAssertion(
        recordFor(records, 'darwin-arm64'),
        'chatAssertions',
        'chat.install.exact-sdk-tarballs',
        'skip',
      );
      expect(() =>
        aggregate(records, createCaveEngine({ countSkipAsPass: true })),
      ).toThrow(
        'darwin-arm64 Chat assertion "chat.install.exact-sdk-tarballs" did not pass',
      );
    });

    test('a summary that invents skips fails the complete-pass check', () => {
      expect(() =>
        aggregate(createRecords(), createCaveEngine({ reportExtraSkips: 1 })),
      ).toThrow('darwin-arm64 Cave assertion summary is not a complete pass');
    });

    test('a renderer that rewrites the summary fails the authority comparison', () => {
      expect(() =>
        aggregate(
          createRecords(),
          createCaveEngine({ corruptRenderedSummary: true }),
        ),
      ).toThrow(
        'darwin-arm64 Cave record does not match the authoritative renderer',
      );
    });
  });
});
