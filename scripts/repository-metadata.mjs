import { execFileSync } from 'node:child_process';

export const CANONICAL_REPOSITORY_URL = 'git+https://github.com/OpenCoven/sdk.git';

export const PUBLIC_PACKAGES = [
  {
    packageName: '@opencoven/sdk-core',
    workspaceDirectory: 'core',
    manifestPath: 'packages/core/package.json',
    repositoryDirectory: 'packages/core',
  },
  {
    packageName: '@opencoven/cave-client',
    workspaceDirectory: 'cave',
    manifestPath: 'packages/cave/package.json',
    repositoryDirectory: 'packages/cave',
  },
  {
    packageName: '@opencoven/coven-client',
    workspaceDirectory: 'coven',
    manifestPath: 'packages/coven/package.json',
    repositoryDirectory: 'packages/coven',
  },
  {
    packageName: '@opencoven/sdk',
    workspaceDirectory: 'sdk',
    manifestPath: 'packages/sdk/package.json',
    repositoryDirectory: 'packages/sdk',
  },
  {
    packageName: '@opencoven/dev-cli',
    workspaceDirectory: 'cli',
    manifestPath: 'packages/cli/package.json',
    repositoryDirectory: 'packages/cli',
  },
];

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function isLocalRepositoryUrl(url) {
  return (
    url.startsWith('file:') ||
    url.startsWith('git+file:') ||
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(url)
  );
}

export function assertCanonicalRepository(manifest, expectedDirectory, packageName) {
  const repository = manifest?.repository;

  if (typeof repository === 'string') {
    if (isLocalRepositoryUrl(repository)) {
      throw new Error(`${packageName} repository.url must not use a local file URL.`);
    }

    throw new Error(`${packageName} repository metadata must be an object with type, url, and directory.`);
  }

  if (!isObject(repository)) {
    throw new Error(`${packageName} is missing repository metadata.`);
  }

  if (repository.type !== 'git') {
    throw new Error(`${packageName} repository.type must be "git".`);
  }

  if (typeof repository.url !== 'string' || repository.url.length === 0) {
    throw new Error(`${packageName} repository.url must be a non-empty string.`);
  }

  if (isLocalRepositoryUrl(repository.url)) {
    throw new Error(`${packageName} repository.url must not use a local file URL.`);
  }

  if (repository.url !== CANONICAL_REPOSITORY_URL) {
    throw new Error(
      `${packageName} repository.url must be ${CANONICAL_REPOSITORY_URL}, received ${repository.url}.`,
    );
  }

  if (repository.directory !== expectedDirectory) {
    throw new Error(
      `${packageName} repository.directory must be ${expectedDirectory}, received ${repository.directory}.`,
    );
  }

  return repository;
}

export function readPackedPackageManifest(tarballPath) {
  return JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
}
