import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PUBLIC_PACKAGES } from './repository-metadata.mjs';

const CONFIG_FIELDS = Object.freeze([
  'schemaVersion',
  'publishingEnabled',
  'tagPrefix',
  'npmAccess',
  'npmDistTag',
  'githubEnvironment',
  'supportedNode',
  'packages',
]);
const NODE_ENGINE = '>=24.18.0 <25';
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactFields(value, expectedFields, context) {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }

  for (const field of expectedFields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${context} is missing required field ${field}`);
    }
  }

  for (const field of Object.keys(value)) {
    if (!expectedFields.includes(field)) {
      throw new Error(`${context} contains unknown field ${field}`);
    }
  }
}

function assertStrictSemVer(version) {
  if (typeof version !== 'string' || !STRICT_SEMVER.test(version)) {
    throw new Error(`Release version ${String(version)} must be strict SemVer`);
  }
}

function readManifest(root, packageMetadata) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, packageMetadata.manifestPath), 'utf8'),
  );

  if (!isRecord(manifest)) {
    throw new Error(`${packageMetadata.packageName} package.json must be an object`);
  }

  return manifest;
}

function validateConfigValues(config) {
  if (config.schemaVersion !== 1) {
    throw new Error('release.config.json schemaVersion must be 1');
  }
  if (typeof config.publishingEnabled !== 'boolean') {
    throw new Error('release.config.json publishingEnabled must be a boolean');
  }
  if (config.tagPrefix !== 'sdk-v') {
    throw new Error('release.config.json tagPrefix must be sdk-v');
  }
  if (config.npmAccess !== 'public') {
    throw new Error('release.config.json npmAccess must be public');
  }
  if (config.npmDistTag !== 'latest') {
    throw new Error('release.config.json npmDistTag must be latest');
  }
  if (config.githubEnvironment !== 'npm-release') {
    throw new Error('release.config.json githubEnvironment must be npm-release');
  }

  assertExactFields(
    config.supportedNode,
    ['minimum', 'major'],
    'release.config.json supportedNode',
  );
  if (
    config.supportedNode.minimum !== '24.18.0' ||
    config.supportedNode.major !== 24
  ) {
    throw new Error(
      'release.config.json supportedNode must specify minimum 24.18.0 and major 24',
    );
  }

  const canonicalPackages = PUBLIC_PACKAGES.map(({ packageName }) => packageName);
  if (
    !Array.isArray(config.packages) ||
    config.packages.length !== canonicalPackages.length ||
    config.packages.some(
      (packageName, index) => packageName !== canonicalPackages[index],
    )
  ) {
    throw new Error(
      'release.config.json packages must match the canonical public package order',
    );
  }
}

export function readReleaseConfig(root = process.cwd()) {
  const config = JSON.parse(readFileSync(resolve(root, 'release.config.json'), 'utf8'));
  assertExactFields(config, CONFIG_FIELDS, 'release.config.json');
  validateConfigValues(config);
  return config;
}

export function validateReleaseReadiness({
  root = process.cwd(),
  mode = 'verify',
  version,
  tag,
  requireTag = false,
} = {}) {
  if (mode !== 'verify' && mode !== 'publish') {
    throw new Error(`Release mode must be verify or publish, received ${String(mode)}`);
  }
  if (typeof requireTag !== 'boolean') {
    throw new Error('requireTag must be a boolean');
  }
  if (version !== undefined) {
    assertStrictSemVer(version);
  }

  const config = readReleaseConfig(root);
  if (tag !== undefined) {
    if (typeof tag !== 'string' || tag.length === 0) {
      throw new Error('Release tag must be a non-empty string');
    }
    const comparedVersion = version ?? tag.slice(config.tagPrefix.length);
    if (tag !== `${config.tagPrefix}${comparedVersion}`) {
      throw new Error(`Release tag ${tag} does not match version ${comparedVersion}`);
    }
  } else if (requireTag) {
    throw new Error('Release tag is required');
  }

  const manifests = PUBLIC_PACKAGES.map((packageMetadata) => ({
    packageMetadata,
    manifest: readManifest(root, packageMetadata),
  }));
  const fixedVersion = manifests[0]?.manifest.version;
  assertStrictSemVer(fixedVersion);

  if (version !== undefined && version !== fixedVersion) {
    throw new Error(
      `Release version ${version} does not match package version ${fixedVersion}`,
    );
  }

  for (const { packageMetadata, manifest } of manifests) {
    const packageName = packageMetadata.packageName;
    if (manifest.name !== packageName) {
      throw new Error(`${packageMetadata.manifestPath} name must be ${packageName}`);
    }
    if (manifest.version !== fixedVersion) {
      throw new Error(`All release package versions must match ${fixedVersion}`);
    }
    if (manifest.engines?.node !== NODE_ENGINE) {
      throw new Error(`${packageName} engines.node must be ${NODE_ENGINE}`);
    }

    const changelog = readFileSync(
      resolve(root, 'packages', packageMetadata.workspaceDirectory, 'CHANGELOG.md'),
      'utf8',
    );
    if (!changelog.includes(`## ${fixedVersion}`)) {
      throw new Error(`${packageName} CHANGELOG.md must contain ## ${fixedVersion}`);
    }

    if (!config.publishingEnabled && manifest.private !== true) {
      throw new Error(
        `${packageName} must remain private while publishing is disabled`,
      );
    }
    if (config.publishingEnabled && manifest.private === true) {
      throw new Error(
        `${packageName} must be non-private while publishing is enabled`,
      );
    }

    for (const dependencyField of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      const dependencies = manifest[dependencyField];
      if (!isRecord(dependencies)) {
        continue;
      }

      for (const dependency of PUBLIC_PACKAGES) {
        if (
          Object.hasOwn(dependencies, dependency.packageName) &&
          dependencies[dependency.packageName] !== `workspace:${fixedVersion}`
        ) {
          throw new Error(
            `${packageName} dependency ${dependency.packageName} must be workspace:${fixedVersion}`,
          );
        }
      }
    }
  }

  if (mode === 'publish' && !config.publishingEnabled) {
    throw new Error('Release publishing is disabled by release.config.json');
  }

  return {
    version: fixedVersion,
    publishingEnabled: config.publishingEnabled,
    packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
  };
}
