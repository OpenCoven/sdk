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
  schemaVersion: 7;
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
  npmTrustedPublisher: {
    repository: 'OpenCoven/sdk';
    workflow: 'release.yml';
    environment: 'npm-publish';
    job: 'publish';
  };
  supportedNode: {
    minimum: '24.18.0';
    major: 24;
  };
  nativeConformancePlatforms: NativeConformancePlatforms;
  conformanceEvidence: {
    issue: 'OpenCoven/sdk#38';
    artifactSet: 'conformance-candidate';
    candidateCommit: 'eb84e0fa5560c4268af5d815933e569777727824';
    runtimeManifestSha256: '5c87f4a8367bbbc29c00bfe5cf55c7c2d58c2e13f71b8729cd566838846901c7';
    aggregateRecord: string | null;
  };
  publicationCandidate: {
    artifactSet: 'publication-candidate';
    environment: 'publication-candidate';
    securityReviewIssue: 'OpenCoven/sdk#40';
    workflow: '.github/workflows/release.yml';
    job: 'publication-candidate';
    attestationJob: 'publication-candidate-attestation';
  };
  protectedApproval: {
    environment: 'npm-release';
    environmentId: '20778492972';
    witnessJob: 'approval-witness';
    witnessAttestationJob: 'approval-witness-attestation';
    approvalJob: 'approval-evidence';
    approvalAttestationJob: 'approval-evidence-attestation';
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

export interface ReleaseConfigurationOptions {
  root?: string;
  mode?: 'verify' | 'publish';
  version?: string;
  tag?: string;
  requireTag?: boolean;
  requireFrozenRuntime?: boolean;
  requireConformanceEvidence?: boolean;
  requireLiveEnvironmentPolicy?: boolean;
  caveAuthorityRoot?: string;
  githubExecute?: (
    command: string,
    arguments_: string[],
    options?: Record<string, unknown>,
  ) => string;
  env?: NodeJS.ProcessEnv;
  environmentPolicyNow?: () => Date;
}

export type ReleaseReadinessOptions = Omit<
  ReleaseConfigurationOptions,
  | 'requireFrozenRuntime'
  | 'requireConformanceEvidence'
  | 'requireLiveEnvironmentPolicy'
>;

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

export function inspectAnnotatedReleaseTag(root: string, tag: string): {
  name: string;
  ref: string;
  objectId: string;
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

export function validateReleaseConfiguration(
  options?: ReleaseConfigurationOptions,
): ReleaseReadinessSummary;

export function validateDevelopmentReleaseConfiguration(
  options?: Pick<ReleaseConfigurationOptions, 'root' | 'version'>,
): ReleaseReadinessSummary;
