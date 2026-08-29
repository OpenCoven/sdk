export type CanonicalPlatform =
  | 'darwin-arm64'
  | 'linux-x64'
  | 'win32-x64';
export type ConformanceResult = 'pass' | 'fail' | 'skip';

export interface FileMetadata {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleaseManifestMetadata {
  file: 'release-manifest.json';
  version: string;
  size: number;
  sha256: string;
}

export interface SdkPackageMetadata {
  packageName:
    | '@opencoven/sdk-core'
    | '@opencoven/cave-client'
    | '@opencoven/coven-client'
    | '@opencoven/sdk';
  version: string;
  releaseFile: string;
  vendorPath: string;
  size: number;
  sha256: string;
}

export interface VendorFileMetadata {
  packageName: SdkPackageMetadata['packageName'];
  path: string;
  size: number;
  sha256: string;
}

export interface CheckoutIdentity {
  repository: string;
  commit: string;
  tree: string;
}

export interface ValidatorIdentity extends CheckoutIdentity {
  repository: 'OpenCoven/sdk';
  contract: FileMetadata;
  schema: FileMetadata;
}

export interface FrozenConformanceLock {
  schemaVersion: 1;
  issue: 'OpenCoven/sdk#38';
  candidate: CheckoutIdentity & {
    repository: 'OpenCoven/sdk';
    releaseManifest: ReleaseManifestMetadata;
    sdkPackages: SdkPackageMetadata[];
    cavePackageFiles: FileMetadata[];
  };
  sources: {
    cave: CheckoutIdentity & {
      repository: 'OpenCoven/coven-cave';
      releaseVersion: string;
      files: FileMetadata[];
    };
    coven: CheckoutIdentity & {
      repository: 'OpenCoven/coven';
      releaseVersion: string;
    };
    chat: CheckoutIdentity & {
      repository: 'OpenCoven/chat';
      consumerLock: FileMetadata;
      vendorFiles: VendorFileMetadata[];
    };
  };
  toolchain: {
    nodeVersion: string;
    pnpmVersion: string;
    rustVersion: string;
    tauriVersion: string;
  };
  harness: {
    name: string;
    version: string;
    repository: 'OpenCoven/chat';
  };
  scanners: {
    redaction: {
      name: string;
      version: string;
    };
    retainedEvidence: {
      name: string;
      version: string;
    };
  };
  assertionRegistry: FileMetadata;
}

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
  status: 'passed' | 'failed';
}

export interface CaveAssertionEngine {
  COVERAGE_ASSERTION_ID: string;
  FINDINGS: CaveFinding[];
  NOT_COVERED: string[];
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
      authorityTakeover: CaveRecord['authorityTakeover'];
      notCovered: string[];
      findings: CaveFinding[];
    },
  ): CaveRecord;
}

export interface AssertionRegistry {
  schemaVersion: 2;
  provenance: {
    repository: 'OpenCoven/coven-cave';
    commit: string;
    tree: string;
    engine: FileMetadata;
    includeTtl: true;
    includeAuthorityTakeover: true;
  };
  requiredSubjects: ['cave', 'coven', 'sdk', 'chat'];
  assertions: {
    cave: string[];
    sdk: string[];
    chat: {
      common: string[];
      platforms: Record<CanonicalPlatform, string[]>;
    };
  };
  notCovered: Array<{
    scopeId:
      | 'cross-process-pairing'
      | 'oauth-ui'
      | 'remote-peer'
      | 'write-apis';
    diagnosticId: string;
  }>;
}

export interface CaveFinding {
  id: string;
  where: string;
  says: string;
  measured: string;
  severity: string;
  why: string;
}

export interface CaveRecord {
  harness: 'scripts/client-v1-conformance.mjs';
  issues: string[];
  scope: string;
  ranAt: string;
  caveVersion: string;
  commit: string;
  platform: CanonicalPlatform;
  nodeVersion: string;
  includeTtl: true;
  authorityTakeover: {
    authorityMode: 'enforce';
    discoveryVersion: 2;
    mechanism: 'hpke-bound-v1';
  };
  notCovered: string[];
  findings: CaveFinding[];
  summary: ConformanceSummary;
  assertions: CaveAssertionEntry[];
}

export interface PlatformEvidence {
  schemaVersion: 2;
  issue: 'OpenCoven/sdk#38';
  platform: CanonicalPlatform;
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  environment: {
    os: 'darwin' | 'linux' | 'win32';
    arch: 'arm64' | 'x64';
    nodeVersion: string;
    pnpmVersion: string;
    rustVersion: string;
    tauriVersion: string;
    nativeCustody: {
      backend:
        | 'macos-keychain'
        | 'linux-keyring'
        | 'windows-credential-manager';
      available: true;
    };
    covenIdentity: {
      backend:
        | 'unix-peer-credentials'
        | 'windows-named-pipe-client-identity';
      available: true;
    };
  };
  releases: {
    cave: string;
    coven: string;
  };
  provenance: {
    candidate: CheckoutIdentity;
    validator: ValidatorIdentity;
    cave: CheckoutIdentity;
    coven: CheckoutIdentity;
    chat: CheckoutIdentity;
  };
  harness: CheckoutIdentity & {
    name: string;
    version: string;
    repository: 'OpenCoven/chat';
    invocationId: string;
  };
  artifacts: {
    frozenLock: FileMetadata;
    assertionRegistry: FileMetadata;
    releaseManifest: ReleaseManifestMetadata;
    sdkPackages: SdkPackageMetadata[];
    candidateCaveFiles: FileMetadata[];
    caveAuthorityFiles: FileMetadata[];
    consumerLock: FileMetadata;
    chatVendorFiles: VendorFileMetadata[];
  };
  caveRecord: CaveRecord;
  sdkAssertions: AssertionEntry[];
  chatAssertions: AssertionEntry[];
  coverage: {
    cave: true;
    coven: true;
    sdk: true;
    chat: true;
  };
  notCovered: AssertionRegistry['notCovered'];
  isolation: {
    strategy: 'process-owned-temporary-roots';
    network: 'loopback-only';
    sourceCheckoutDependency: false;
    workspaceLinkDependency: false;
    retainedPrivatePaths: false;
    retainedSocketHandles: false;
    roots: Array<{
      id:
        | 'cave-home'
        | 'coven-home'
        | 'consumer-home'
        | 'native-credential-store';
      opaqueId: string;
      ownershipVerified: true;
      removedAfterRun: true;
    }>;
    operatorState: Array<{
      id:
        | 'cave-home'
        | 'coven-home'
        | 'native-credential-store'
        | 'projects';
      beforeSha256: string;
      afterSha256: string;
    }>;
  };
  scans: {
    redaction: {
      status: 'passed';
      scanner: string;
      version: string;
    };
    retainedEvidence: {
      status: 'passed';
      scanner: string;
      version: string;
    };
  };
}

export interface AggregationArguments {
  candidateRoot: string;
  caveRoot: string;
  covenRoot: string;
  chatRoot: string;
  harnessRoot: string;
  recordPaths: string[];
  outputName: string;
}

export interface AggregateConformanceInput {
  caveEngine: CaveAssertionEngine;
  caveEngineSha256: string;
  assertionRegistrySha256: string;
  frozenLockSha256: string;
  frozenLockSize: number;
  frozenLock: FrozenConformanceLock;
  canonicalPlatforms: readonly CanonicalPlatform[];
  registry: AssertionRegistry;
  platformRecords: PlatformEvidence[];
}

export interface AggregatedConformanceEvidence {
  schemaVersion: 2;
  issue: 'OpenCoven/sdk#38';
  kind: 'client-v1-cross-repository-conformance';
  canonicalPlatforms: CanonicalPlatform[];
  contract: {
    frozenLock: FileMetadata;
    assertionRegistry: FileMetadata;
  };
  candidate: {
    provenance: CheckoutIdentity;
    releaseManifest: ReleaseManifestMetadata;
    sdkPackages: SdkPackageMetadata[];
    cavePackageFiles: FileMetadata[];
  };
  validator: ValidatorIdentity;
  authorities: {
    cave: CheckoutIdentity;
    coven: CheckoutIdentity;
    chat: CheckoutIdentity;
    harness: Omit<PlatformEvidence['harness'], 'invocationId'>;
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
  schema?: Record<string, unknown>,
): PlatformEvidence;
export function readFrozenConformanceLock(
  path?: string,
): FrozenConformanceLock;
export function parseFrozenConformanceLock(
  text: string,
  source?: string,
): FrozenConformanceLock;
export function readAssertionRegistry(path?: string): AssertionRegistry;
export function parseAssertionRegistry(
  text: string,
  source?: string,
): AssertionRegistry;
export function validateJsonSchemaValue<T>(
  value: T,
  schema: Record<string, unknown>,
  label?: string,
): T;
export function scanConformanceEvidence(value: unknown): void;
export function serializeCanonicalJson(value: unknown): string;
export function parseAggregatedConformanceEvidence(
  text: string,
  source?: string,
  options?: {
    frozenLockText?: string;
    assertionRegistryText?: string;
    schema?: Record<string, unknown>;
  },
): AggregatedConformanceEvidence;
export function aggregateConformanceEvidence(
  input: AggregateConformanceInput,
): AggregatedConformanceEvidence;
