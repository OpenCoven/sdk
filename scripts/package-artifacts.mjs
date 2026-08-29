import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
    env: options.env,
  });
}

export function runPnpm(args, cwd, options = {}) {
  return run('corepack', ['pnpm@10.34.0', ...args], cwd, options);
}

export function isolatedInstallArgs({ offline = true, workspace = false } = {}) {
  return [
    workspace ? '--recursive' : '--ignore-workspace',
    '--config.inject-workspace-packages=false',
    '--config.link-workspace-packages=false',
    '--config.prefer-workspace-packages=false',
    '--no-hoist',
    '--config.public-hoist-pattern=[]',
    '--config.shamefully-hoist=false',
    '--config.node-linker=isolated',
    'install',
    // The warm pass may reach the registry for metadata the store lacks; the
    // asserting pass may not reach it at all.
    offline ? '--offline' : '--prefer-offline',
    '--ignore-scripts',
  ];
}

function removeInstalledModuleTrees(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);

    if (entry.name === 'node_modules') {
      rmSync(entryPath, { force: true, recursive: true });
      continue;
    }

    if (entry.isDirectory()) {
      removeInstalledModuleTrees(entryPath);
    }
  }
}

function runPnpmAsync(args, cwd, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('corepack', ['pnpm@10.34.0', ...args], {
      cwd,
      stdio: options.stdio ?? 'inherit',
      env: options.env,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const status = signal === null ? `exit code ${code}` : `signal ${signal}`;
      reject(new Error(`pnpm ${args.join(' ')} failed in ${cwd} with ${status}.`));
    });
  });
}

async function runPnpmAsyncForDirectories(args, directories, options) {
  const results = await Promise.allSettled(
    directories.map((directory) => runPnpmAsync(args, directory, options)),
  );
  const failure = results.find((result) => result.status === 'rejected');

  if (failure !== undefined) {
    throw failure.reason;
  }
}

/**
 * Install an isolated fixture or fixture workspace twice: once warm, once
 * offline.
 *
 * The offline install is the assertion. It proves every dependency the packed
 * tarballs pull in is genuinely present in the store, so nothing is being
 * resolved from the network behind the check's back.
 *
 * But an offline install can only assert that once the store actually holds
 * those dependencies, and a fresh CI runner's store does not. That is what
 * failed: a transitive @types/node had no metadata in the runner's mirror, so
 * the offline install failed on an absence that says nothing about the
 * tarballs.
 *
 * Warming first separates the two questions. The warm pass is allowed to fetch
 * what it is missing. Its installed module trees are then removed while its
 * store entries and lockfile remain, so the offline pass must perform a clean
 * install with no network at all. Dropping --offline or retaining the warm
 * install would make the check faster by removing the guarantee it exists to
 * provide.
 */
export function installIsolatedOfflineAfterWarming(
  directory,
  { workspace = false, ...options } = {},
) {
  runPnpm(isolatedInstallArgs({ offline: false, workspace }), directory, options);
  removeInstalledModuleTrees(directory);
  runPnpm(isolatedInstallArgs({ offline: true, workspace }), directory, options);
}

export async function installIsolatedConsumersOfflineAfterWarming(
  directories,
  { workspace = false, ...options } = {},
) {
  await runPnpmAsyncForDirectories(
    isolatedInstallArgs({ offline: false, workspace }),
    directories,
    options,
  );

  for (const directory of directories) {
    removeInstalledModuleTrees(directory);
  }

  await runPnpmAsyncForDirectories(
    isolatedInstallArgs({ offline: true, workspace }),
    directories,
    options,
  );
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

export function buildPublicPackages(root, options = {}) {
  runPnpm(
    [
      '--recursive',
      ...PUBLIC_PACKAGES.flatMap(({ packageName }) => ['--filter', packageName]),
      'build',
    ],
    root,
    options,
  );
}

export function packPublicPackages({
  root,
  destinationRoot,
  build = true,
  env,
}) {
  if (build) {
    buildPublicPackages(root, { env });
  }

  const tarballs = {};

  for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
    const destination = resolve(destinationRoot, workspaceDirectory);
    mkdirSync(destination, { recursive: true });
    runPnpm(
      ['pack', '--pack-destination', destination],
      resolve(root, 'packages', workspaceDirectory),
      { env },
    );
    tarballs[workspaceDirectory] = findTarball(destination);
    assertCanonicalRepository(
      readPackedPackageManifest(tarballs[workspaceDirectory], { env }),
      repositoryDirectory,
      `${packageName} packed manifest`,
    );
  }

  return tarballs;
}
