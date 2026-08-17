export interface RepositoryMetadata {
  type: 'git';
  url: string;
  directory: string;
}

export interface PackageManifest {
  repository?: unknown;
  [key: string]: unknown;
}

export interface PublicPackageMetadata {
  packageName: string;
  workspaceDirectory: string;
  manifestPath: string;
  repositoryDirectory: string;
}

export const CANONICAL_REPOSITORY_URL: 'git+https://github.com/OpenCoven/sdk.git';
export const PUBLIC_PACKAGES: readonly PublicPackageMetadata[];

export function assertCanonicalRepository(
  manifest: PackageManifest,
  expectedDirectory: string,
  packageName: string,
): RepositoryMetadata;

export function readPackedPackageManifest(tarballPath: string): PackageManifest;
