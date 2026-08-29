#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { verifyPublicationArtifacts } from './create-release-artifacts.mjs';
import { PUBLIC_PACKAGES } from './repository-metadata.mjs';
import { readReleaseConfig } from './release-readiness.mjs';

export function createNpmPublishArgs({ tarball, access, distTag }) {
  if (typeof tarball !== 'string' || tarball.length === 0) {
    throw new Error('tarball must be a non-empty string');
  }
  if (access !== 'public' && access !== 'restricted') {
    throw new Error('access must be public or restricted');
  }
  if (typeof distTag !== 'string' || distTag.length === 0) {
    throw new Error('distTag must be a non-empty string');
  }

  return [
    'publish',
    tarball,
    '--access',
    access,
    '--tag',
    distTag,
    '--provenance',
  ];
}

export function publishReleaseArtifacts({
  root = process.cwd(),
  artifactRoot,
  version,
  env = process.env,
  execute = execFileSync,
} = {}) {
  const manifest = verifyPublicationArtifacts({
    root,
    artifactRoot,
    version,
  });

  if (env.OPENCOVEN_RELEASE_AUTHORIZATION !== 'publish') {
    throw new Error('OPENCOVEN_RELEASE_AUTHORIZATION must be publish');
  }
  if (env.NPM_TOKEN !== undefined || env.NODE_AUTH_TOKEN !== undefined) {
    throw new Error(
      'Token-based npm authentication is forbidden for regular releases',
    );
  }

  const config = readReleaseConfig(root);
  const publishEnvironment = { ...env };
  delete publishEnvironment.GH_TOKEN;
  delete publishEnvironment.GITHUB_TOKEN;
  for (const packageMetadata of PUBLIC_PACKAGES) {
    const entry = manifest.packages.find(
      ({ name }) => name === packageMetadata.packageName,
    );
    if (entry === undefined) {
      throw new Error(`Missing release artifact for ${packageMetadata.packageName}`);
    }

    execute(
      'npm',
      createNpmPublishArgs({
        tarball: resolve(artifactRoot, entry.file),
        access: config.npmAccess,
        distTag: config.npmDistTag,
      }),
      {
        cwd: root,
        env: publishEnvironment,
        stdio: 'inherit',
      },
    );
  }

  return manifest;
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (index === 0 && argument === '--') {
      continue;
    }
    const key =
      argument === '--artifact-root'
        ? 'artifactRoot'
        : argument === '--version'
          ? 'version'
          : undefined;
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
  return publishReleaseArtifacts({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    ...parseArguments(arguments_),
  });
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
