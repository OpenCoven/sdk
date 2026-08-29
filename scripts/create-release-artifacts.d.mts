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
  schemaVersion: 2;
  artifactSet: 'publication-candidate';
  version: string;
  source: {
    repository: 'OpenCoven/sdk';
    commit: string;
    tree: string;
  };
  securityReview: {
    issue: 'OpenCoven/sdk#40';
    commentId: string;
    reviewer: 'BunsDev';
    reviewedCommit: string;
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
}): CreatePublicationArtifactsResult;

export function verifyPublicationArtifacts(options?: {
  root?: string;
  artifactRoot?: string;
  version?: string;
}): PublicationArtifactManifest;

export function parseReleaseArtifactArguments(arguments_: string[]): {
  build: boolean;
  outputRoot?: string;
  version?: string;
};

export function main(arguments_?: string[]): void;
