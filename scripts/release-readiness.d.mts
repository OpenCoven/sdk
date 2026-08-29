export type NativeConformancePlatform =
  | 'darwin-arm64'
  | 'linux-x64'
  | 'win32-x64';

export type NativeConformancePlatforms = readonly [
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
];

export interface ReleaseConfig {
  schemaVersion: 2;
  publishingEnabled: boolean;
  tagPrefix: 'sdk-v';
  npmAccess: 'public';
  npmDistTag: 'latest';
  githubEnvironment: 'npm-release';
  supportedNode: {
    minimum: '24.18.0';
    major: 24;
  };
  nativeConformancePlatforms: NativeConformancePlatforms;
  conformanceEvidence: {
    issue: 'OpenCoven/sdk#38';
    candidateCommit: 'acc38488f00860d246c3c553375634d64806eabb';
    aggregateRecord: string | null;
  };
  packages: string[];
}

export interface ReleaseReadinessOptions {
  root?: string;
  mode?: 'verify' | 'publish';
  version?: string;
  tag?: string;
  requireTag?: boolean;
  requireConformanceEvidence?: boolean;
  caveAuthorityRoot?: string;
}

export interface ReleaseReadinessSummary {
  version: string;
  publishingEnabled: boolean;
  packages: string[];
  conformanceEvidenceRecord: string | null;
}

export function readReleaseConfig(root?: string): ReleaseConfig;

export function validateValidatorRuntimeFiles(
  root: string,
  validatorCommit: string,
  releaseCommit?: string,
): void;

export function validateReleaseReadiness(
  options?: ReleaseReadinessOptions,
): ReleaseReadinessSummary;
