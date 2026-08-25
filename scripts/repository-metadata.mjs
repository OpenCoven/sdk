import { execFileSync } from 'node:child_process';

export const CANONICAL_REPOSITORY_URL = 'git+https://github.com/OpenCoven/sdk.git';
export const APPROVED_PACKAGE_LICENSE_EXPRESSION = 'AGPL-3.0-only OR MIT';
export const APPROVED_PACKAGE_LICENSE_COMPONENTS = Object.freeze(['AGPL-3.0-only', 'MIT']);

const SDK_CORE_PACKAGE = {
  packageName: '@opencoven/sdk-core',
  workspaceDirectory: 'core',
  manifestPath: 'packages/core/package.json',
  repositoryDirectory: 'packages/core',
};
const CAVE_CLIENT_PACKAGE = {
  packageName: '@opencoven/cave-client',
  workspaceDirectory: 'cave',
  manifestPath: 'packages/cave/package.json',
  repositoryDirectory: 'packages/cave',
};
const COVEN_CLIENT_PACKAGE = {
  packageName: '@opencoven/coven-client',
  workspaceDirectory: 'coven',
  manifestPath: 'packages/coven/package.json',
  repositoryDirectory: 'packages/coven',
};
const SDK_PACKAGE = {
  packageName: '@opencoven/sdk',
  workspaceDirectory: 'sdk',
  manifestPath: 'packages/sdk/package.json',
  repositoryDirectory: 'packages/sdk',
};
const DEV_CLI_PACKAGE = {
  packageName: '@opencoven/dev-cli',
  workspaceDirectory: 'cli',
  manifestPath: 'packages/cli/package.json',
  repositoryDirectory: 'packages/cli',
};

export const PUBLIC_PACKAGES = [
  SDK_CORE_PACKAGE,
  CAVE_CLIENT_PACKAGE,
  COVEN_CLIENT_PACKAGE,
  SDK_PACKAGE,
];

export const WORKSPACE_PACKAGES = [...PUBLIC_PACKAGES, DEV_CLI_PACKAGE];

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

export function assertApprovedPackageLicense(manifestLicense, selector, context) {
  if (manifestLicense !== APPROVED_PACKAGE_LICENSE_EXPRESSION) {
    throw new Error(
      `${context} manifest license must be ${APPROVED_PACKAGE_LICENSE_EXPRESSION}, received ${manifestLicense}.`,
    );
  }

  const selectorComponents =
    typeof selector === 'string'
      ? [...selector.matchAll(/\(([^()\r\n]+)\), see \[LICENSE-[^\]]+\]/g)].map(
          (match) => match[1],
        )
      : [];

  if (
    selectorComponents.length !== APPROVED_PACKAGE_LICENSE_COMPONENTS.length ||
    selectorComponents.some(
      (component, index) => component !== APPROVED_PACKAGE_LICENSE_COMPONENTS[index],
    )
  ) {
    throw new Error(
      `${context} selector license components must be ${APPROVED_PACKAGE_LICENSE_COMPONENTS.join(
        ' OR ',
      )}, received ${selectorComponents.join(' OR ') || 'none'}.`,
    );
  }

  return selectorComponents;
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
