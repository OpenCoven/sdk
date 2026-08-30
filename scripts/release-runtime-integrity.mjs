import { accessSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { devNull } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { posix } from 'node:path';

export const PROTECTED_PNPM_PACKAGE_MANAGER = 'pnpm@10.34.0';

export const AUTHENTICATED_NODE_VERSION = 'v24.18.1';
export const AUTHENTICATED_NODE_LINUX_X64_VERSION = AUTHENTICATED_NODE_VERSION;
export const AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256 =
  'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a';
export const AUTHENTICATED_NODE_LINUX_X64_PATH =
  '/opt/hostedtoolcache/node/24.18.1/x64/bin/node';
export const AUTHENTICATED_NODE_LINUX_X64_SIZE = 123656816;
export const NODE_LINUX_X64_EXECUTABLE_SHA256 =
  AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256;
export const AUTHENTICATED_COREPACK_ENTRYPOINT_SHA256 =
  '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9';
export const AUTHENTICATED_COREPACK_VERSION = '0.35.0';
export const AUTHENTICATED_COREPACK_TREE_SHA256 =
  '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08';

export const AUTHENTICATED_NPM_CLI_VERSION = '11.5.1';
export const REVIEWED_NPM_CLI_VERSION = AUTHENTICATED_NPM_CLI_VERSION;
export const AUTHENTICATED_NPM_TARBALL_URL =
  'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz';
export const REVIEWED_NPM_TARBALL_URL = AUTHENTICATED_NPM_TARBALL_URL;
export const AUTHENTICATED_NPM_TARBALL_INTEGRITY =
  'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
export const REVIEWED_NPM_TARBALL_INTEGRITY =
  AUTHENTICATED_NPM_TARBALL_INTEGRITY;
export const AUTHENTICATED_NPM_CLI_TREE_SHA256 =
  'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09';
export const REVIEWED_NPM_CLI_TREE_SHA256 = AUTHENTICATED_NPM_CLI_TREE_SHA256;
export const AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256 =
  '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';
export const REVIEWED_NPM_CLI_ENTRYPOINT_SHA256 =
  AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256;

export const RELEASE_RUNTIME_INTEGRITY_CONSTANTS = Object.freeze({
  protectedPnpmPackageManager: PROTECTED_PNPM_PACKAGE_MANAGER,
  authenticatedNodeVersion: AUTHENTICATED_NODE_VERSION,
  authenticatedNodeLinuxX64Version: AUTHENTICATED_NODE_LINUX_X64_VERSION,
  authenticatedNodeLinuxX64ExecutableSha256:
    AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256,
  authenticatedNodeLinuxX64Path: AUTHENTICATED_NODE_LINUX_X64_PATH,
  authenticatedNodeLinuxX64Size: AUTHENTICATED_NODE_LINUX_X64_SIZE,
  authenticatedCorepackEntrypointSha256:
    AUTHENTICATED_COREPACK_ENTRYPOINT_SHA256,
  authenticatedCorepackVersion: AUTHENTICATED_COREPACK_VERSION,
  authenticatedCorepackTreeSha256: AUTHENTICATED_COREPACK_TREE_SHA256,
  authenticatedNpmCliVersion: AUTHENTICATED_NPM_CLI_VERSION,
  authenticatedNpmTarballUrl: AUTHENTICATED_NPM_TARBALL_URL,
  authenticatedNpmTarballIntegrity: AUTHENTICATED_NPM_TARBALL_INTEGRITY,
  authenticatedNpmCliTreeSha256: AUTHENTICATED_NPM_CLI_TREE_SHA256,
  authenticatedNpmCliEntrypointSha256:
    AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256,
});

const EXPECTED_NPM_BIN = Object.freeze({
  npm: 'bin/npm-cli.js',
  npx: 'bin/npx-cli.js',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha512Integrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function isGitHubTokenName(name) {
  const normalized = name.toUpperCase();
  return normalized === 'GH_TOKEN' || normalized === 'GITHUB_TOKEN';
}

export function createGitHubTokenFreeEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) => !isGitHubTokenName(name) && value !== undefined,
    ),
  );
}

export function createGitHubCliEnvironment(source = process.env) {
  const tokenEntry = Object.entries(source).find(
    ([name]) => name.toUpperCase() === 'GH_TOKEN',
  );
  if (typeof tokenEntry?.[1] !== 'string' || tokenEntry[1].length === 0) {
    throw new Error('GH_TOKEN is required for authoritative GitHub verification');
  }
  return {
    PATH: '/usr/bin:/bin',
    HOME: source.HOME ?? source.RUNNER_TEMP ?? '/tmp',
    TMPDIR: source.TMPDIR ?? source.RUNNER_TEMP ?? '/tmp',
    GH_HOST: 'github.com',
    GH_TOKEN: tokenEntry[1],
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export async function runWithGitHubTokensScrubbed(
  environment,
  operation,
) {
  if (
    environment === null
    || typeof environment !== 'object'
    || typeof operation !== 'function'
  ) {
    throw new Error(
      'GitHub token scrubbing requires an environment and operation',
    );
  }
  const originalTokens = Object.entries(environment).filter(
    ([name]) => isGitHubTokenName(name),
  );
  for (const [name] of originalTokens) {
    delete environment[name];
  }
  try {
    return await operation();
  } finally {
    for (const name of Object.keys(environment)) {
      if (isGitHubTokenName(name)) {
        delete environment[name];
      }
    }
    for (const [name, value] of originalTokens) {
      environment[name] = value;
    }
  }
}

function toPosixRelative(root, path) {
  return relative(root, path).split(sep).join(posix.sep);
}

function statRegularFileWithoutSymlink(path, label) {
  const stats = lstatSync(path);

  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`);
  }

  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }

  return stats;
}

function assertExecutableFile(path, label) {
  const stats = statRegularFileWithoutSymlink(path, label);

  try {
    accessSync(path, fsConstants.X_OK);
  } catch (error) {
    throw new Error(`${label} must be executable: ${path}`, { cause: error });
  }

  return stats;
}

export function createSterileReleaseEnvironment({
  authenticatedNodePath,
  home,
  temporary,
  corepackHome,
  source,
  include,
}) {
  void source;
  assertNonEmptyString(authenticatedNodePath, 'authenticatedNodePath');
  assertNonEmptyString(home, 'home');
  assertNonEmptyString(temporary, 'temporary');
  assertNonEmptyString(corepackHome, 'corepackHome');

  const sanitizedInclude = {};
  if (include !== undefined) {
    for (const [name, value] of Object.entries(include)) {
      if (typeof value === 'string') {
        sanitizedInclude[name] = value;
      }
    }
  }

  return {
    ...sanitizedInclude,
    PATH: `${dirname(authenticatedNodePath)}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: temporary,
    COREPACK_HOME: corepackHome,
  };
}

export function protectedPnpmArguments(command, args = []) {
  assertNonEmptyString(command, 'command');
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new Error('args must be an array of strings');
  }

  const hookDisablingArgument = command === 'install'
    ? '--ignore-pnpmfile'
    : '--config.pnpmfile=/dev/null';
  return [
    PROTECTED_PNPM_PACKAGE_MANAGER,
    command,
    ...args.filter(
      (argument) =>
        argument !== '--ignore-pnpmfile'
        && argument !== '--config.pnpmfile=/dev/null'
        && argument !== '--config.global-pnpmfile=/dev/null',
    ),
    hookDisablingArgument,
    '--config.global-pnpmfile=/dev/null',
  ];
}

export function verifyAuthenticatedNodeExecutable({
  executablePath,
  expectedPath,
  expectedVersion,
  actualVersion,
  expectedSha256,
}) {
  for (const [value, label] of [
    [executablePath, 'executablePath'],
    [expectedPath, 'expectedPath'],
    [expectedVersion, 'expectedVersion'],
    [actualVersion, 'actualVersion'],
    [expectedSha256, 'expectedSha256'],
  ]) {
    assertNonEmptyString(value, label);
  }

  assertExecutableFile(executablePath, 'authenticated Node executable');
  const resolvedExecutablePath = realpathSync(executablePath);
  const resolvedExpectedPath = realpathSync(expectedPath);

  if (resolvedExecutablePath !== resolvedExpectedPath) {
    throw new Error(
      `authenticated Node executable real path is ${resolvedExecutablePath}; expected ${resolvedExpectedPath}`,
    );
  }

  if (actualVersion !== expectedVersion) {
    throw new Error(
      `authenticated Node executable version is ${actualVersion}; expected ${expectedVersion}`,
    );
  }

  const actualSha256 = sha256(readFileSync(executablePath));
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `authenticated Node executable digest is ${actualSha256}; expected ${expectedSha256}`,
    );
  }
}

export function verifyAuthenticatedCorepackEntrypoint({
  nodeExecutablePath,
  corepackPath,
}) {
  assertNonEmptyString(nodeExecutablePath, 'nodeExecutablePath');
  assertNonEmptyString(corepackPath, 'corepackPath');
  const expectedPath = resolve(
    dirname(nodeExecutablePath),
    '../lib/node_modules/corepack/dist/corepack.js',
  );
  const resolvedCorepackPath = realpathSync(corepackPath);
  if (resolvedCorepackPath !== realpathSync(expectedPath)) {
    throw new Error(
      `authenticated Corepack entrypoint path is ${resolvedCorepackPath}; expected ${expectedPath}`,
    );
  }
  statRegularFileWithoutSymlink(
    resolvedCorepackPath,
    'authenticated Corepack entrypoint',
  );
  const actualSha256 = sha256(readFileSync(resolvedCorepackPath));
  if (actualSha256 !== AUTHENTICATED_COREPACK_ENTRYPOINT_SHA256) {
    throw new Error(
      `authenticated Corepack entrypoint digest is ${actualSha256}; expected ${AUTHENTICATED_COREPACK_ENTRYPOINT_SHA256}`,
    );
  }
  const corepackRoot = resolve(resolvedCorepackPath, '../..');
  const packagePath = resolve(corepackRoot, 'package.json');
  statRegularFileWithoutSymlink(
    packagePath,
    'authenticated Corepack package manifest',
  );
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (
    manifest.name !== 'corepack'
    || manifest.version !== AUTHENTICATED_COREPACK_VERSION
    || manifest.bin?.corepack !== './dist/corepack.js'
    || manifest.bin?.pnpm !== './dist/pnpm.js'
  ) {
    throw new Error(
      `authenticated Corepack package identity must be exactly corepack ${AUTHENTICATED_COREPACK_VERSION}`,
    );
  }
  const treeSha256 = authenticatedNpmTreeDigest(
    collectAuthenticatedNpmFiles(corepackRoot),
  );
  if (treeSha256 !== AUTHENTICATED_COREPACK_TREE_SHA256) {
    throw new Error(
      `authenticated Corepack tree digest is ${treeSha256}; expected ${AUTHENTICATED_COREPACK_TREE_SHA256}`,
    );
  }
  return {
    corepackPath: resolvedCorepackPath,
    corepackVersion: AUTHENTICATED_COREPACK_VERSION,
    corepackTreeSha256: treeSha256,
  };
}

export function resolveAuthenticatedReleaseRuntime({
  env,
  actualExecutablePath = process.execPath,
  actualVersion = process.version,
}) {
  if (
    env === null
    || typeof env !== 'object'
    || Array.isArray(env)
    || env.RUNNER_OS !== 'Linux'
    || env.RUNNER_ARCH !== 'X64'
  ) {
    throw new Error(
      'Protected release runtime requires the GitHub-hosted Linux X64 runner',
    );
  }
  assertNonEmptyString(env.RUNNER_TOOL_CACHE, 'RUNNER_TOOL_CACHE');
  const expectedNodePath = resolve(
    env.RUNNER_TOOL_CACHE,
    'node/24.18.1/x64/bin/node',
  );
  if (expectedNodePath !== AUTHENTICATED_NODE_LINUX_X64_PATH) {
    throw new Error(
      `Protected release runtime path must be ${AUTHENTICATED_NODE_LINUX_X64_PATH}`,
    );
  }
  if (env.OPENCOVEN_AUTHENTICATED_NODE_PATH !== expectedNodePath) {
    throw new Error(
      `OPENCOVEN_AUTHENTICATED_NODE_PATH must equal ${expectedNodePath}`,
    );
  }
  verifyAuthenticatedNodeExecutable({
    executablePath: actualExecutablePath,
    expectedPath: expectedNodePath,
    expectedVersion: AUTHENTICATED_NODE_VERSION,
    actualVersion,
    expectedSha256: AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256,
  });
  const corepackPath = resolve(
    dirname(expectedNodePath),
    '../lib/node_modules/corepack/dist/corepack.js',
  );
  const corepack = verifyAuthenticatedCorepackEntrypoint({
    nodeExecutablePath: expectedNodePath,
    corepackPath,
  });
  const nodeStats = lstatSync(expectedNodePath);
  return {
    nodePath: realpathSync(expectedNodePath),
    nodeSize: nodeStats.size,
    nodeSha256: AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256,
    nodeVersion: AUTHENTICATED_NODE_VERSION,
    corepackPath: realpathSync(corepackPath),
    corepackVersion: corepack.corepackVersion,
    corepackTreeSha256: corepack.corepackTreeSha256,
  };
}

function readAuthenticatedNpmManifest(root, version) {
  const packagePath = resolve(root, 'package.json');
  statRegularFileWithoutSymlink(packagePath, 'authenticated npm CLI package.json');

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`authenticated npm CLI package.json is not valid JSON: ${packagePath}`, {
      cause: error,
    });
  }

  if (
    manifest === null
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || manifest.name !== 'npm'
    || manifest.version !== version
  ) {
    throw new Error(`authenticated npm CLI package identity must be exactly npm ${version}`);
  }

  const { bin } = manifest;
  if (
    bin === null
    || typeof bin !== 'object'
    || Array.isArray(bin)
    || bin.npm !== EXPECTED_NPM_BIN.npm
    || bin.npx !== EXPECTED_NPM_BIN.npx
    || Object.keys(bin).length !== Object.keys(EXPECTED_NPM_BIN).length
  ) {
    throw new Error(
      'authenticated npm CLI bin mapping must be exactly {"npm":"bin/npm-cli.js","npx":"bin/npx-cli.js"}',
    );
  }

  return manifest;
}

function collectAuthenticatedNpmFiles(root) {
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const directory = stack.pop();
    const directoryStats = lstatSync(directory);

    if (directoryStats.isSymbolicLink()) {
      throw new Error(`authenticated npm CLI tree must not contain symlinks: ${directory}`);
    }

    if (!directoryStats.isDirectory()) {
      throw new Error(`authenticated npm CLI tree path must be a directory: ${directory}`);
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      const relativePath = toPosixRelative(root, entryPath);
      const stats = lstatSync(entryPath);

      if (stats.isSymbolicLink()) {
        throw new Error(
          `authenticated npm CLI tree must not contain symlinks: ${relativePath}`,
        );
      }

      if (stats.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!stats.isFile()) {
        throw new Error(
          `authenticated npm CLI tree must contain regular files only: ${relativePath}`,
        );
      }

      files.push({
        path: relativePath,
        mode: (stats.mode & 0o7777).toString(8).padStart(4, '0'),
        size: stats.size,
        sha256: sha256(readFileSync(entryPath)),
      });
    }
  }

  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return files;
}

function authenticatedNpmTreeDigest(files) {
  return sha256(`${JSON.stringify({ schemaVersion: 1, files })}\n`);
}

export function verifyAuthenticatedNpmCliTree({ root, version }) {
  assertNonEmptyString(root, 'root');
  assertNonEmptyString(version, 'version');

  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink()) {
    throw new Error(`authenticated npm CLI root must not be a symlink: ${root}`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`authenticated npm CLI root must be a directory: ${root}`);
  }

  const canonicalRoot = realpathSync(root);
  readAuthenticatedNpmManifest(canonicalRoot, version);

  const cliPath = resolve(canonicalRoot, EXPECTED_NPM_BIN.npm);
  statRegularFileWithoutSymlink(cliPath, 'authenticated npm CLI entrypoint');
  const treeSha256 = authenticatedNpmTreeDigest(collectAuthenticatedNpmFiles(canonicalRoot));

  if (treeSha256 !== AUTHENTICATED_NPM_CLI_TREE_SHA256) {
    throw new Error(
      `authenticated npm CLI tree digest is ${treeSha256}; expected ${AUTHENTICATED_NPM_CLI_TREE_SHA256}`,
    );
  }

  const cliSha256 = sha256(readFileSync(cliPath));
  if (cliSha256 !== AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256) {
    throw new Error(
      `authenticated npm CLI entrypoint digest is ${cliSha256}; expected ${AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256}`,
    );
  }

  return {
    cliPath,
    treeSha256,
  };
}

export function verifyAuthenticatedNpmTarball(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    throw new Error('authenticated npm tarball must be non-empty bytes');
  }
  const integrity = sha512Integrity(bytes);
  if (integrity !== AUTHENTICATED_NPM_TARBALL_INTEGRITY) {
    throw new Error(
      `authenticated npm tarball integrity is ${integrity}; expected ${AUTHENTICATED_NPM_TARBALL_INTEGRITY}`,
    );
  }
  return { integrity };
}

export function assertNoReleaseRuntimeShadows(root) {
  assertNonEmptyString(root, 'root');
  const canonicalRoot = realpathSync(root);
  const workspaceRoots = [canonicalRoot];
  for (const group of ['packages', 'examples']) {
    const groupRoot = resolve(canonicalRoot, group);
    let entries;
    try {
      entries = readdirSync(groupRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        workspaceRoots.push(resolve(groupRoot, entry.name));
      }
    }
  }
  for (const workspaceRoot of workspaceRoots) {
    for (const name of ['node', 'corepack', 'pnpm', 'npm']) {
      const candidate = resolve(workspaceRoot, 'node_modules/.bin', name);
      try {
        lstatSync(candidate);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      throw new Error(
        `Release dependencies must not shadow authenticated ${name}: ${candidate}`,
      );
    }
  }
}
