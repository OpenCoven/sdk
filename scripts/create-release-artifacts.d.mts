import type { OwnedTempDirectoryContext } from './owned-temp-directory.mjs';

export interface ReleaseArtifactEntry {
  name: string;
  version: string;
  file: string;
  size: number;
  sha256: string;
}

export interface ConformanceArtifactManifest {
  schemaVersion: 1;
  version: string;
  packages: ReleaseArtifactEntry[];
}

export interface PublicationArtifactManifest {
  schemaVersion: 3;
  artifactSet: 'publication-candidate';
  version: string;
  source: {
    repository: 'OpenCoven/sdk';
    commit: string;
    tree: string;
    npmConfigFiles: Array<{
      path: '.npmrc';
      size: number;
      sha256: string;
    }>;
  };
  toolchain: {
    nodeVersion: 'v24.18.1';
    pnpmVersion: 'pnpm@10.34.0';
    npmVersion: '11.5.1';
    packCommand: 'corepack pnpm@10.34.0 pack --ignore-scripts';
  };
  provenance: {
    repository: 'OpenCoven/sdk';
    workflow: '.github/workflows/release.yml';
    workflowCommit: string;
    sourceRef: 'refs/heads/main';
    runId: string;
    runAttempt: number;
    job: 'publication-candidate';
    artifactName: string;
  };
  packages: ReleaseArtifactEntry[];
}

export type ReleaseArtifactManifest =
  | ConformanceArtifactManifest
  | PublicationArtifactManifest;

export interface CreateConformanceArtifactsOptions {
  root?: string;
  outputRoot?: string;
  build?: boolean;
  version?: string;
  requireConformanceEvidence?: boolean;
}

export interface CreateConformanceArtifactsResult {
  artifactRoot: string;
  artifactSet: 'conformance-candidate' | 'local-verification';
  manifestPath: string;
  manifest: ConformanceArtifactManifest;
  ownedDirectory: OwnedTempDirectoryContext | undefined;
}

export interface CreatePublicationArtifactsResult {
  artifactRoot: string;
  artifactSet: 'publication-candidate';
  manifestPath: string;
  manifest: PublicationArtifactManifest;
  ownedDirectory: OwnedTempDirectoryContext | undefined;
}

export function assertFrozenConformanceArtifacts(
  manifest: ConformanceArtifactManifest,
  frozenLock: import('./conformance-contract.d.mts').FrozenConformanceLock,
): void;

export function assertPublishablePackedManifest(
  manifest: Record<string, unknown>,
  packageName: string,
): void;

export function serializeReleaseManifest(
  manifest: ReleaseArtifactManifest,
): string;

export function createConformanceArtifacts(
  options?: CreateConformanceArtifactsOptions,
): CreateConformanceArtifactsResult;

export function verifyConformanceArtifacts(options?: {
  root?: string;
  artifactRoot?: string;
  version?: string;
  requireConformanceEvidence?: boolean;
}): ConformanceArtifactManifest;

export function createPublicationArtifacts(options?: {
  root?: string;
  outputRoot?: string;
  build?: boolean;
  version?: string;
  env?: NodeJS.ProcessEnv;
}): CreatePublicationArtifactsResult;

export function verifyPublicationArtifacts(options?: {
  root?: string;
  artifactRoot?: string;
  version?: string;
  expectedProvenance?: PublicationArtifactManifest['provenance'];
}): PublicationArtifactManifest;

export function inspectRepositoryNpmConfiguration(root: string): Array<{
  path: '.npmrc';
  size: number;
  sha256: string;
}>;

export function parseReleaseArtifactArguments(arguments_: string[]): {
  build: boolean;
  outputRoot?: string;
  version?: string;
};

export function main(arguments_?: string[]): void;
