export interface PublicationSourceCandidate {
  commit: string;
  tree: string;
}

export interface PublicationSourceEntry {
  mode: '100644' | '100755';
  path: string;
  sha256: string;
  size: number;
}

export interface PublicationSourceManifest {
  schemaVersion: 1;
  repository: 'OpenCoven/sdk';
  candidate: PublicationSourceCandidate;
  entries: PublicationSourceEntry[];
  runtimeSha256: string;
}

export interface CreatePublicationSourceManifestOptions {
  root: string;
  commit: string;
}

export interface VerifyPublicationSourceIdentityOptions {
  root: string;
  releaseCommit: string;
  manifest: PublicationSourceManifest | string;
}

export function createPublicationSourceManifest(
  options: CreatePublicationSourceManifestOptions,
): PublicationSourceManifest;

export function serializePublicationSourceManifest(
  manifest: PublicationSourceManifest,
): string;

export function parsePublicationSourceManifest(
  input: PublicationSourceManifest | string,
): PublicationSourceManifest;

export function verifyPublicationSourceIdentity(
  options: VerifyPublicationSourceIdentityOptions,
): void;

export function applyPublicationMetadataTransform(options: {
  releaseRoot: string;
  releaseCommit: string;
  candidateRoot: string;
  version: string;
}): void;
