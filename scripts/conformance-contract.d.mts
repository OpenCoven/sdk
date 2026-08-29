export type ConformanceResult = 'pass' | 'fail' | 'skip';

export interface AssertionEntry {
  id: string;
  result: ConformanceResult;
  diagnosticId: string;
}

export interface CaveAssertionEntry {
  id: string;
  result: ConformanceResult;
  detail: string;
}

export interface ConformanceSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  status: string;
}

export interface CaveAssertionEngine {
  COVERAGE_ASSERTION_ID: string;
  FINDINGS: Array<Record<string, unknown>>;
  NOT_COVERED: string[];
  expectedAssertionIds(
    includeTtl: boolean,
    includeAuthorityTakeover?: boolean,
  ): string[];
  checkAssertionCoverage(
    entries: readonly { id: string }[],
    expected: readonly string[],
  ): string[];
  summarizeConformance(
    entries: readonly { result: string }[],
  ): ConformanceSummary;
  renderConformanceRecord(
    entries: CaveAssertionEntry[],
    context: {
      ranAt: string;
      caveVersion: string;
      commit: string;
      platform: string;
      includeTtl: boolean;
      authorityTakeover: PlatformEvidence['caveRecord']['authorityTakeover'];
      notCovered: string[];
      findings: Array<Record<string, unknown>>;
    },
  ): PlatformEvidence['caveRecord'];
}

export interface AssertionRegistry {
  schemaVersion: 1;
  cave: {
    engine: 'scripts/client-v1-conformance.mjs';
    requireIncludeTtl: true;
    requireAuthorityTakeover: true;
  };
  sdk: string[];
  chat: {
    common: string[];
    platforms: {
      'darwin-arm64': string[];
      'linux-x64': string[];
      'win32-x64': string[];
    };
  };
}

export interface PlatformEvidence {
  schemaVersion: 1;
  issue: 'OpenCoven/sdk#38';
  platform: string;
  ranAt: string;
  environment: {
    os: string;
    arch: string;
    nodeVersion: string;
    packageManagerVersion: string;
  };
  releases: {
    cave: string;
    coven: string;
  };
  commits: {
    cave: string;
    coven: string;
    sdk: string;
    chat: string;
  };
  digests: {
    caveAssertionEngine: string;
    caveContractFixture: string;
    hpkeVectors: string;
    consumerLock: string;
    assertionRegistry: string;
    sdkTarballs: Array<{
      packageName: string;
      sha256: string;
    }>;
  };
  caveRecord: {
    harness: string;
    issues: string[];
    scope: string;
    ranAt: string;
    caveVersion: string;
    commit: string;
    platform: string;
    nodeVersion: string;
    includeTtl: boolean;
    authorityTakeover: {
      authorityMode: string;
      discoveryVersion: number;
      mechanism: string;
    };
    notCovered: string[];
    findings: Array<Record<string, unknown>>;
    summary: ConformanceSummary;
    assertions: CaveAssertionEntry[];
  };
  sdkAssertions: AssertionEntry[];
  chatAssertions: AssertionEntry[];
  coverage: {
    cave: true;
    coven: true;
    sdk: true;
    chat: true;
  };
  notCovered: Array<{
    scopeId: string;
    diagnosticId: string;
  }>;
  isolation: {
    strategy: string;
    network: string;
    sourceCheckoutDependency: boolean;
    workspaceLinkDependency: boolean;
    retainedPrivatePaths: boolean;
    retainedSocketHandles: boolean;
    roots: Array<{
      id: string;
      ownershipVerified: boolean;
      removedAfterRun: boolean;
    }>;
    operatorState: Array<{
      id: string;
      beforeSha256: string;
      afterSha256: string;
    }>;
  };
}

export interface AggregationArguments {
  caveRoot: string;
  recordPaths: string[];
  outputPath: string;
}

export interface AggregateConformanceInput {
  caveEngine: CaveAssertionEngine;
  caveEngineSha256: string;
  assertionRegistrySha256: string;
  canonicalPlatforms: readonly string[];
  registry: AssertionRegistry;
  platformRecords: PlatformEvidence[];
}

export interface AggregatedConformanceEvidence {
  schemaVersion: 1;
  issue: 'OpenCoven/sdk#38';
  kind: 'client-v1-cross-repository-conformance';
  canonicalPlatforms: string[];
  caveAssertionAuthority: {
    repository: 'OpenCoven/coven-cave';
    path: 'scripts/client-v1-conformance.mjs';
    commit: string;
    sha256: string;
  };
  assertionRegistryAuthority: {
    path: 'conformance/client-v1-cross-repository-assertions.json';
    commit: string;
    sha256: string;
  };
  candidate: {
    releases: PlatformEvidence['releases'];
    commits: PlatformEvidence['commits'];
    digests: PlatformEvidence['digests'];
  };
  platforms: PlatformEvidence[];
  summary: {
    status: 'passed';
    platforms: number;
    caveAssertions: number;
    sdkAssertions: number;
    chatAssertions: number;
    failed: 0;
    skipped: 0;
  };
}

export function parseConformanceAggregationArgs(
  argv: string[],
): AggregationArguments;
export function parsePlatformEvidence(
  text: string,
  source?: string,
): PlatformEvidence;
export function readAssertionRegistry(path: string): AssertionRegistry;
export function parseAssertionRegistry(
  text: string,
  source?: string,
): AssertionRegistry;
export function scanConformanceEvidence(value: unknown): void;
export function aggregateConformanceEvidence(
  input: AggregateConformanceInput,
): AggregatedConformanceEvidence;
