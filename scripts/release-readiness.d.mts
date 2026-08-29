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
  schemaVersion: 5;
  publishingEnabled: boolean;
  tagPrefix: 'sdk-v';
  npmAccess: 'public';
  npmDistTag: 'latest';
  npmCliVersion: '11.5.1';
  npmRegistry: 'https://registry.npmjs.org/';
  githubEnvironment: 'npm-release';
  supportedNode: {
    minimum: '24.18.0';
    major: 24;
  };
  nativeConformancePlatforms: NativeConformancePlatforms;
  conformanceEvidence: {
    issue: 'OpenCoven/sdk#38';
    artifactSet: 'conformance-candidate';
    candidateCommit: 'acc38488f00860d246c3c553375634d64806eabb';
    aggregateRecord: string | null;
  };
  publicationCandidate: {
    artifactSet: 'publication-candidate';
    environment: 'publication-candidate';
    securityReviewIssue: 'OpenCoven/sdk#40';
    workflow: '.github/workflows/release.yml';
    job: 'publication-candidate';
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

export function inspectReleaseRepository(root: string): {
  root: string;
  repository: 'OpenCoven/sdk';
  commit: string;
  tree: string;
};

export function validateReleaseWorkflow(
  root: string,
  config: ReleaseConfig,
): void;

export function parseReleaseWorkflowDocument(
  workflow: string,
): Record<string, unknown>;

export function assertFrozenNodeRuntime(
  root?: string,
  actualVersion?: string,
): 'v24.18.1';

export function validateValidatorRuntimeFiles(
  root: string,
  validatorCommit: string,
  releaseCommit?: string,
): void;

export function validateReleaseReadiness(
  options?: ReleaseReadinessOptions,
): ReleaseReadinessSummary;
