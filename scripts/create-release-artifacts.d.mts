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
  schemaVersion: 6;
  artifactSet: 'publication-candidate';
  version: string;
  source: {
    repository: 'OpenCoven/sdk';
    commit: string;
    tree: string;
    runtimeManifest: {
      file: 'publication-source-manifest.json';
      size: number;
      sha256: string;
      runtimeSha256: string;
      candidateCommit: string;
      candidateTree: string;
    };
    npmConfigFiles: Array<{
      path: '.npmrc';
      size: number;
      sha256: string;
    }>;
  };
  toolchain: {
    nodeVersion: 'v24.18.1';
    nodePath: '/opt/hostedtoolcache/node/24.18.1/x64/bin/node';
    nodeSize: 123656816;
    nodeSha256: 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a';
    corepackVersion: '0.35.0';
    corepackTreeSha256: '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08';
    pnpmVersion: 'pnpm@10.34.0';
    npmVersion: '11.5.1';
    npmTarball: 'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz';
    npmIntegrity: 'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
    npmTreeSha256: 'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09';
    npmEntrypointSha256: '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';
    packCommand: 'sanitize package manifests; node <authenticated-corepack> pnpm@10.34.0 --config.pnpmfile=/dev/null --config.global-pnpmfile=/dev/null pack';
  };
  publisher: {
    path: 'scripts/publish-release-artifacts.mjs';
    size: number;
    sha256: string;
  };
  provenance: {
    repository: 'OpenCoven/sdk';
    workflow: '.github/workflows/release.yml';
    workflowCommit: string;
    sourceRef: 'refs/heads/main';
    runId: string;
    runAttempt: number;
    job: 'publication-candidate';
    environment: 'publication-candidate';
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
