import type { OwnedTempDirectoryContext } from './owned-temp-directory.mjs';

export interface ReleaseArtifactEntry {
  name: string;
  version: string;
  file: string;
  size: number;
  sha256: string;
}

export interface ReleaseArtifactManifest {
  schemaVersion: 1;
  version: string;
  packages: ReleaseArtifactEntry[];
}

export interface CreateReleaseArtifactsOptions {
  root?: string;
  outputRoot?: string;
  build?: boolean;
  version?: string;
  requireConformanceEvidence?: boolean;
}

export interface CreateReleaseArtifactsResult {
  artifactRoot: string;
  manifestPath: string;
  manifest: ReleaseArtifactManifest;
  ownedDirectory: OwnedTempDirectoryContext | undefined;
}

export function assertFrozenReleaseArtifacts(
  manifest: ReleaseArtifactManifest,
  frozenLock: import('./conformance-contract.d.mts').FrozenConformanceLock,
): void;

export function createReleaseArtifacts(
  options?: CreateReleaseArtifactsOptions,
): CreateReleaseArtifactsResult;

export function verifyReleaseArtifacts(options?: {
  root?: string;
  artifactRoot?: string;
  version?: string;
  requireConformanceEvidence?: boolean;
}): ReleaseArtifactManifest;

export function parseReleaseArtifactArguments(arguments_: string[]): {
  build: boolean;
  outputRoot?: string;
  version?: string;
};

export function main(arguments_?: string[]): void;
