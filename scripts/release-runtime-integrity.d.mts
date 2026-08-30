export const PROTECTED_PNPM_PACKAGE_MANAGER: 'pnpm@10.34.0';
export const AUTHENTICATED_GIT_EXECUTABLE: '/usr/bin/git';

export const AUTHENTICATED_NODE_VERSION: 'v24.18.1';
export const AUTHENTICATED_NODE_LINUX_X64_VERSION: 'v24.18.1';
export const AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256:
  'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a';
export const AUTHENTICATED_NODE_LINUX_X64_PATH:
  '/opt/hostedtoolcache/node/24.18.1/x64/bin/node';
export const AUTHENTICATED_NODE_LINUX_X64_SIZE: 123656816;
export const NODE_LINUX_X64_EXECUTABLE_SHA256:
  'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a';
export const AUTHENTICATED_COREPACK_ENTRYPOINT_SHA256:
  '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9';
export const AUTHENTICATED_COREPACK_VERSION: '0.35.0';
export const AUTHENTICATED_COREPACK_TREE_SHA256:
  '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08';

export const AUTHENTICATED_NPM_CLI_VERSION: '11.5.1';
export const REVIEWED_NPM_CLI_VERSION: '11.5.1';
export const AUTHENTICATED_NPM_TARBALL_URL:
  'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz';
export const REVIEWED_NPM_TARBALL_URL:
  'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz';
export const AUTHENTICATED_NPM_TARBALL_INTEGRITY:
  'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
export const REVIEWED_NPM_TARBALL_INTEGRITY:
  'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
export const AUTHENTICATED_NPM_CLI_TREE_SHA256:
  'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09';
export const REVIEWED_NPM_CLI_TREE_SHA256:
  'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09';
export const AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256:
  '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';
export const REVIEWED_NPM_CLI_ENTRYPOINT_SHA256:
  '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';

export const RELEASE_RUNTIME_INTEGRITY_CONSTANTS: Readonly<{
  protectedPnpmPackageManager: 'pnpm@10.34.0';
  authenticatedGitExecutable: '/usr/bin/git';
  authenticatedNodeVersion: 'v24.18.1';
  authenticatedNodeLinuxX64Version: 'v24.18.1';
  authenticatedNodeLinuxX64ExecutableSha256:
    'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a';
  authenticatedNodeLinuxX64Path:
    '/opt/hostedtoolcache/node/24.18.1/x64/bin/node';
  authenticatedNodeLinuxX64Size: 123656816;
  authenticatedCorepackEntrypointSha256:
    '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9';
  authenticatedCorepackVersion: '0.35.0';
  authenticatedCorepackTreeSha256:
    '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08';
  authenticatedNpmCliVersion: '11.5.1';
  authenticatedNpmTarballUrl:
    'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz';
  authenticatedNpmTarballIntegrity:
    'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
  authenticatedNpmCliTreeSha256:
    'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09';
  authenticatedNpmCliEntrypointSha256:
    '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7';
}>;

export function createGitHubTokenFreeEnvironment(
  source?: Record<string, string | undefined>,
): Record<string, string>;

export function createGitHubCliEnvironment(
  source?: Record<string, string | undefined>,
): Record<string, string>;

export function runWithGitHubTokensScrubbed<T>(
  environment: Record<string, string | undefined>,
  operation: () => T | Promise<T>,
): Promise<T>;

export interface AuthenticatedGitRuntime {
  gitPath: '/usr/bin/git';
  gitSize: number;
  gitVersion: string;
}

export function resolveAuthenticatedGitRuntime(options?: {
  platform?: NodeJS.Platform;
}): AuthenticatedGitRuntime;

export function createSterileReleaseEnvironment(options: {
  authenticatedNodePath: string;
  home: string;
  temporary: string;
  corepackHome: string;
  source?: Record<string, string | undefined>;
  include?: Record<string, string>;
}): Record<string, string>;

export function protectedPnpmArguments(
  command: string,
  args?: string[],
): string[];

export function verifyAuthenticatedNodeExecutable(options: {
  executablePath: string;
  expectedPath: string;
  expectedVersion: string;
  actualVersion: string;
  expectedSha256: string;
}): void;

export function verifyAuthenticatedCorepackEntrypoint(options: {
  nodeExecutablePath: string;
  corepackPath: string;
}): {
  corepackPath: string;
  corepackVersion: '0.35.0';
  corepackTreeSha256:
    '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08';
};

export function resolveAuthenticatedReleaseRuntime(options: {
  env: Record<string, string | undefined>;
  actualExecutablePath?: string;
  actualVersion?: string;
}): {
  nodePath: string;
  nodeSize: number;
  nodeSha256:
    'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a';
  nodeVersion: 'v24.18.1';
  corepackPath: string;
  corepackVersion: '0.35.0';
  corepackTreeSha256:
    '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08';
};

export function verifyAuthenticatedNpmCliTree(options: {
  root: string;
  version: string;
}): {
  cliPath: string;
  treeSha256: string;
};

export function verifyAuthenticatedNpmTarball(bytes: Buffer): {
  integrity:
    'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==';
};

export function assertNoReleaseRuntimeShadows(root: string): void;
