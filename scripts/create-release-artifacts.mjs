#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOwnedTempDirectory } from './owned-temp-directory.mjs';
import { packPublicPackages } from './package-artifacts.mjs';
import {
  PUBLIC_PACKAGES,
  readPackedPackageManifest,
} from './repository-metadata.mjs';
import { validateReleaseReadiness } from './release-readiness.mjs';

const RELEASE_MANIFEST_NAME = 'release-manifest.json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertRecord(value, context) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
}

function assertExactFields(value, fields, context) {
  assertRecord(value, context);
  const actualFields = Object.keys(value);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${context} is missing field ${field}`);
    }
  }
  for (const field of actualFields) {
    if (!fields.includes(field)) {
      throw new Error(`${context} contains unexpected field ${field}`);
    }
  }
}

function resolveArtifactFile(artifactRoot, file, context) {
  if (
    typeof file !== 'string' ||
    file.length === 0 ||
    isAbsolute(file) ||
    file.split('/').includes('..') ||
    file.includes('\\')
  ) {
    throw new Error(`${context} file must be a relative artifact path`);
  }

  const resolvedRoot = resolve(artifactRoot);
  const resolvedFile = resolve(resolvedRoot, file);
  if (
    resolvedFile === resolvedRoot ||
    !resolvedFile.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error(`${context} file escapes the artifact root`);
  }
  return resolvedFile;
}

function readReleaseManifest(artifactRoot) {
  const manifestPath = resolve(artifactRoot, RELEASE_MANIFEST_NAME);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assertExactFields(
    manifest,
    ['schemaVersion', 'version', 'packages'],
    RELEASE_MANIFEST_NAME,
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error(`${RELEASE_MANIFEST_NAME} schemaVersion must be 1`);
  }
  if (!Array.isArray(manifest.packages)) {
    throw new Error(`${RELEASE_MANIFEST_NAME} packages must be an array`);
  }
  return { manifest, manifestPath };
}

export function createReleaseArtifacts({
  root = process.cwd(),
  outputRoot,
  build = true,
  version,
} = {}) {
  if (typeof build !== 'boolean') {
    throw new Error('build must be a boolean');
  }

  const readiness = validateReleaseReadiness({ root, version });
  const ownedDirectory =
    outputRoot === undefined
      ? createOwnedTempDirectory({ prefix: 'opencoven-sdk-release-artifacts' })
      : undefined;
  const artifactRoot = resolve(outputRoot ?? ownedDirectory.rootPath);
  const manifestPath = resolve(artifactRoot, RELEASE_MANIFEST_NAME);

  if (existsSync(manifestPath)) {
    throw new Error(`Release manifest already exists: ${manifestPath}`);
  }
  mkdirSync(resolve(artifactRoot, 'tarballs'), { recursive: true });

  const tarballs = packPublicPackages({
    root,
    destinationRoot: resolve(artifactRoot, 'tarballs'),
    build,
  });
  const packages = PUBLIC_PACKAGES.map(
    ({ packageName, workspaceDirectory }) => {
      const tarballPath = tarballs[workspaceDirectory];
      if (typeof tarballPath !== 'string') {
        throw new Error(`Missing packed tarball for ${packageName}`);
      }

      const packedManifest = readPackedPackageManifest(tarballPath);
      if (
        packedManifest.name !== packageName ||
        packedManifest.version !== readiness.version
      ) {
        throw new Error(
          `Packed manifest for ${packageName} must use version ${readiness.version}`,
        );
      }

      const bytes = readFileSync(tarballPath);
      return {
        name: packageName,
        version: readiness.version,
        file: relative(artifactRoot, tarballPath).split(sep).join('/'),
        size: bytes.byteLength,
        sha256: digest(bytes),
      };
    },
  );
  const manifest = {
    schemaVersion: 1,
    version: readiness.version,
    packages,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
  });

  verifyReleaseArtifacts({ root, artifactRoot, version: readiness.version });
  return {
    artifactRoot,
    manifestPath,
    manifest,
    ownedDirectory,
  };
}

export function verifyReleaseArtifacts({
  root = process.cwd(),
  artifactRoot,
  version,
} = {}) {
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) {
    throw new Error('artifactRoot is required');
  }

  const readiness = validateReleaseReadiness({ root, version });
  const { manifest } = readReleaseManifest(artifactRoot);
  if (manifest.version !== readiness.version) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} version must be ${readiness.version}`,
    );
  }
  if (manifest.packages.length !== PUBLIC_PACKAGES.length) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} must contain exactly ${PUBLIC_PACKAGES.length} packages`,
    );
  }

  const names = new Set();
  for (const [index, packageMetadata] of PUBLIC_PACKAGES.entries()) {
    const entry = manifest.packages[index];
    assertExactFields(
      entry,
      ['name', 'version', 'file', 'size', 'sha256'],
      `${RELEASE_MANIFEST_NAME} package ${index}`,
    );
    if (names.has(entry.name)) {
      throw new Error(`${RELEASE_MANIFEST_NAME} contains duplicate package ${entry.name}`);
    }
    names.add(entry.name);
    if (entry.name !== packageMetadata.packageName) {
      throw new Error(
        `${RELEASE_MANIFEST_NAME} package ${index} must be ${packageMetadata.packageName}`,
      );
    }
    if (entry.version !== readiness.version) {
      throw new Error(
        `${entry.name} artifact version must be ${readiness.version}`,
      );
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`${entry.name} artifact size must be a non-negative integer`);
    }
    if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`${entry.name} artifact sha256 must be 64 lowercase hex characters`);
    }

    const tarballPath = resolveArtifactFile(artifactRoot, entry.file, entry.name);
    const expectedDirectory = resolve(
      artifactRoot,
      'tarballs',
      packageMetadata.workspaceDirectory,
    );
    if (dirname(tarballPath) !== expectedDirectory || !basename(tarballPath).endsWith('.tgz')) {
      throw new Error(`${entry.name} artifact file must use its canonical tarball directory`);
    }

    const stats = lstatSync(tarballPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${entry.name} artifact must be a regular file`);
    }
    const bytes = readFileSync(tarballPath);
    if (bytes.byteLength !== entry.size) {
      throw new Error(`${entry.name} size does not match ${RELEASE_MANIFEST_NAME}`);
    }
    if (digest(bytes) !== entry.sha256) {
      throw new Error(`${entry.name} digest does not match ${RELEASE_MANIFEST_NAME}`);
    }

    const packedManifest = readPackedPackageManifest(tarballPath);
    if (
      packedManifest.name !== entry.name ||
      packedManifest.version !== entry.version
    ) {
      throw new Error(`${entry.name} packed manifest does not match release metadata`);
    }
  }

  return manifest;
}

export function parseReleaseArtifactArguments(arguments_) {
  const options = { build: true };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (index === 0 && argument === '--') {
      continue;
    }
    if (argument === '--skip-build') {
      options.build = false;
      continue;
    }
    const key = argument === '--output' ? 'outputRoot' : argument === '--version' ? 'version' : undefined;
    if (key === undefined) {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new Error(`Option ${argument} may only be provided once`);
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

export function main(arguments_ = process.argv.slice(2)) {
  const result = createReleaseArtifacts({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    ...parseReleaseArtifactArguments(arguments_),
  });
  process.stdout.write(
    `${JSON.stringify({
      artifactRoot: result.artifactRoot,
      manifestPath: result.manifestPath,
      manifest: result.manifest,
    })}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
