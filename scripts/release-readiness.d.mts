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
  schemaVersion: 6;
  publishingEnabled: boolean;
  tagPrefix: 'sdk-v';
  npmAccess: 'public';
  npmDistTag: 'latest';
  npmCliVersion: '11.5.1';
  npmRegistry: 'https://registry.npmjs.org/';
  npmCliDistribution: {
    tarball: 'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz';
    integrity: 'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
    treeSha256: 'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09';
    entrypointSha256: '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';
  };
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
    runtimeManifestSha256: '1cf387f4f53f456c87a51ab09ab68f7ff7291480f9a7cd3a4fe3bb70f907e56a';
    aggregateRecord: string | null;
  };
  publicationCandidate: {
    artifactSet: 'publication-candidate';
    environment: 'publication-candidate';
    securityReviewIssue: 'OpenCoven/sdk#40';
    workflow: '.github/workflows/release.yml';
    job: 'publication-candidate';
  };
  protectedApproval: {
    environment: 'npm-release';
    environmentId: '20778492972';
    witnessJob: 'approval-witness';
    approvalJob: 'approval-evidence';
    publishJob: 'publish';
    reviewer: {
      id: 68980965;
      authorAssociation: 'MEMBER';
      permission: 'admin';
      roleName: 'admin';
    };
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
