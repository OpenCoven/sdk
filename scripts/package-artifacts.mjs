import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  const command = options.nodePath ?? 'corepack';
  const pnpmArguments = [
    'pnpm@10.34.0',
    '--config.pnpmfile=/dev/null',
    '--config.global-pnpmfile=/dev/null',
    ...args,
  ];
  const commandArguments = options.corepackPath === undefined
    ? pnpmArguments
    : [
        options.corepackPath,
        ...pnpmArguments,
      ];
  return run(command, commandArguments, cwd, options);
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
    '--ignore-pnpmfile',
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
  const command = options.nodePath ?? 'corepack';
  const pnpmArguments = [
    'pnpm@10.34.0',
    '--config.pnpmfile=/dev/null',
    '--config.global-pnpmfile=/dev/null',
    ...args,
  ];
  const commandArguments = options.corepackPath === undefined
    ? pnpmArguments
    : [
        options.corepackPath,
        ...pnpmArguments,
      ];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArguments, {
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
  for (const packageMetadata of PUBLIC_PACKAGES) {
    const invocation = createPublicPackageBuildInvocation({
      root,
      packageMetadata,
      nodePath: options.nodePath ?? process.execPath,
    });
    run(
      invocation.command,
      invocation.args,
      invocation.cwd,
      options,
    );
  }
}

export function createPublicPackageBuildInvocation({
  root,
  packageMetadata,
  nodePath,
}) {
  if (
    !PUBLIC_PACKAGES.some(
      (entry) =>
        entry.packageName === packageMetadata?.packageName
        && entry.workspaceDirectory === packageMetadata?.workspaceDirectory
        && entry.manifestPath === packageMetadata?.manifestPath,
    )
  ) {
    throw new Error('Public package build metadata is not canonical');
  }
  if (typeof nodePath !== 'string' || nodePath.length === 0) {
    throw new Error('Public package build requires an exact Node path');
  }
  const packageRoot = resolve(root, 'packages', packageMetadata.workspaceDirectory);
  const packageManifest = JSON.parse(
    readFileSync(resolve(root, packageMetadata.manifestPath), 'utf8'),
  );
  if (packageManifest.scripts?.build !== 'tsup --config tsup.config.ts') {
    throw new Error(
      `${packageMetadata.packageName} build script must be exactly tsup --config tsup.config.ts`,
    );
  }
  const canonicalRoot = realpathSync(root);
  const tsupRoot = realpathSync(resolve(canonicalRoot, 'node_modules/tsup'));
  const pnpmStorePrefix = resolve(canonicalRoot, 'node_modules/.pnpm');
  if (
    tsupRoot === pnpmStorePrefix
    || !tsupRoot.startsWith(`${pnpmStorePrefix}/`)
  ) {
    throw new Error('Reviewed tsup CLI must resolve inside the frozen pnpm store');
  }
  const tsupManifestPath = resolve(tsupRoot, 'package.json');
  const tsupCliPath = resolve(tsupRoot, 'dist/cli-default.js');
  for (const [path, label] of [
    [tsupManifestPath, 'Reviewed tsup package manifest'],
    [tsupCliPath, 'Reviewed tsup CLI entrypoint'],
  ]) {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
  }
  const tsupManifest = JSON.parse(readFileSync(tsupManifestPath, 'utf8'));
  if (
    tsupManifest.name !== 'tsup'
    || tsupManifest.version !== '8.5.1'
    || tsupManifest.bin?.tsup !== 'dist/cli-default.js'
  ) {
    throw new Error('Reviewed tsup CLI must be exactly tsup 8.5.1');
  }
  return {
    command: nodePath,
    args: [
      tsupCliPath,
      '--config',
      'tsup.config.ts',
    ],
    cwd: packageRoot,
  };
}

const PUBLISH_LIFECYCLE_SCRIPTS = Object.freeze([
  'prepublish',
  'prepare',
  'prepublishOnly',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
]);

export function createPublishSafePackageManifest(manifest, packageName) {
  if (
    typeof manifest !== 'object'
    || manifest === null
    || Array.isArray(manifest)
    || manifest.name !== packageName
    || manifest.private !== false
    || manifest.publishConfig !== undefined
  ) {
    throw new Error(
      `${packageName} source manifest is not safe for publication packing`,
    );
  }
  const result = structuredClone(manifest);
  if (result.scripts !== undefined) {
    if (
      typeof result.scripts !== 'object'
      || result.scripts === null
      || Array.isArray(result.scripts)
    ) {
      throw new Error(`${packageName} scripts must be an object`);
    }
    for (const script of PUBLISH_LIFECYCLE_SCRIPTS) {
      delete result.scripts[script];
    }
    if (Object.keys(result.scripts).length === 0) {
      delete result.scripts;
    }
  }
  return result;
}

function preparePublicPackageManifestsForPacking(root) {
  for (const { packageName, manifestPath } of PUBLIC_PACKAGES) {
    const path = resolve(root, manifestPath);
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const safeManifest = createPublishSafePackageManifest(
      manifest,
      packageName,
    );
    writeFileSync(path, `${JSON.stringify(safeManifest, null, 2)}\n`);
  }
}

export function packPublicPackages({
  root,
  destinationRoot,
  build = true,
  sanitizePublishManifests = false,
  env,
  nodePath,
  corepackPath,
}) {
  if (build) {
    buildPublicPackages(root, { env, nodePath, corepackPath });
  }
  if (sanitizePublishManifests) {
    preparePublicPackageManifestsForPacking(root);
  }

  const tarballs = {};

  for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
    const destination = resolve(destinationRoot, workspaceDirectory);
    mkdirSync(destination, { recursive: true });
    runPnpm(
      [
        'pack',
        '--pack-destination',
        destination,
      ],
      resolve(root, 'packages', workspaceDirectory),
      { env, nodePath, corepackPath },
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
