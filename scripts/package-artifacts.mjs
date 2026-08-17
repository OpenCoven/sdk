import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PUBLIC_PACKAGES,
  assertCanonicalRepository,
  readPackedPackageManifest,
} from './repository-metadata.mjs';

export function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
  });
}

export function runPnpm(args, cwd, options = {}) {
  return run('corepack', ['pnpm@10.34.0', ...args], cwd, options);
}

export function isolatedInstallArgs({ offline = true } = {}) {
  return [
    '--ignore-workspace',
    '--config.inject-workspace-packages=false',
    '--config.link-workspace-packages=false',
    '--config.prefer-workspace-packages=false',
    'install',
    ...(offline ? ['--offline'] : []),
    '--ignore-scripts',
  ];
}

export function findTarball(directory) {
  const tarballs = readdirSync(directory).filter((entry) => entry.endsWith('.tgz'));

  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball in ${directory}, found ${tarballs.length}.`);
  }

  return resolve(directory, tarballs[0]);
}

export function tarballSpecifier(tarballs, workspaceDirectory) {
  const tarballPath = tarballs[workspaceDirectory];

  if (typeof tarballPath !== 'string' || tarballPath.length === 0) {
    throw new Error(`Missing tarball for workspace package "${workspaceDirectory}".`);
  }

  return `file:${tarballPath}`;
}

export function createPublicPackageOverrides(tarballs) {
  return Object.fromEntries(
    PUBLIC_PACKAGES.map(({ packageName, workspaceDirectory }) => [
      packageName,
      tarballSpecifier(tarballs, workspaceDirectory),
    ]),
  );
}

export function assertPackedPackagesExcludeSources(installRoot) {
  for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
    const installedDirectory = resolve(
      installRoot,
      'node_modules',
      '@opencoven',
      packageName.split('/')[1],
    );
    const manifestPath = resolve(installedDirectory, 'package.json');

    if (!existsSync(manifestPath)) {
      continue;
    }

    assertCanonicalRepository(
      JSON.parse(readFileSync(manifestPath, 'utf8')),
      repositoryDirectory,
      `${packageName} installed manifest`,
    );

    if (existsSync(resolve(installedDirectory, 'src'))) {
      throw new Error(`Packed ${workspaceDirectory} package unexpectedly contains source files.`);
    }
  }
}

export function buildPublicPackages(root) {
  runPnpm(['--recursive', '--filter', './packages/*', 'build'], root);
}

export function packPublicPackages({ root, destinationRoot, build = true }) {
  if (build) {
    buildPublicPackages(root);
  }

  const tarballs = {};

  for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
    const destination = resolve(destinationRoot, workspaceDirectory);
    mkdirSync(destination, { recursive: true });
    runPnpm(['pack', '--pack-destination', destination], resolve(root, 'packages', workspaceDirectory));
    tarballs[workspaceDirectory] = findTarball(destination);
    assertCanonicalRepository(
      readPackedPackageManifest(tarballs[workspaceDirectory]),
      repositoryDirectory,
      `${packageName} packed manifest`,
    );
  }

  return tarballs;
}
