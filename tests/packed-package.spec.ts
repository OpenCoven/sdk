import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';
import {
  CaveClient,
  createManagedCaveClient,
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveManagedNativeDiscardResult,
  type CaveManagedNativePairingExchange,
  type CaveManagedNativeTransport,
  type CaveProject,
} from '@opencoven/cave-client';
import {
  type BoundedPageOptions,
} from '@opencoven/sdk-core';

import {
  CANONICAL_REPOSITORY_URL,
  PUBLIC_PACKAGES,
  assertCanonicalRepository,
  readPackedPackageManifest,
} from '../scripts/repository-metadata.mjs';
import {
  createPublishSafePackageManifest,
  createPublicPackageBuildInvocation,
  installIsolatedConsumersOfflineAfterWarming,
  installIsolatedOfflineAfterWarming,
  isolatedInstallArgs,
} from '../scripts/package-artifacts.mjs';
import * as packageArtifacts from '../scripts/package-artifacts.mjs';
import { cleanupOwnedTempRoot, createOwnedTempDirectory } from '../scripts/owned-temp-directory.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const packageArtifactHelpers = packageArtifacts as unknown as {
  findTarball(directory: string): string;
  runPnpm(
    args: string[],
    cwd: string,
    options?: {
      corepackPath?: string;
      env?: NodeJS.ProcessEnv;
      nodePath?: string;
      stdio?: 'ignore' | 'inherit' | 'pipe';
    },
  ): void;
  runPnpmAsync(
    args: string[],
    cwd: string,
    options?: {
      corepackPath?: string;
      env?: NodeJS.ProcessEnv;
      nodePath?: string;
      stdio?: 'ignore' | 'inherit' | 'pipe';
    },
  ): Promise<void>;
};
const ROOT_PACKAGE_EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  },
  './package.json': './package.json',
} as const;

function expectedPackageExports(workspaceDirectory: string) {
  return {
    ...ROOT_PACKAGE_EXPORTS,
    ...(workspaceDirectory === 'core'
      ? {
          './browser': {
            types: './dist/browser.d.ts',
            import: './dist/browser.js',
            default: './dist/browser.js',
          },
        }
      : {}),
    ...(workspaceDirectory === 'cave'
      ? {
          './managed': {
            types: './dist/managed.d.ts',
            import: './dist/managed.js',
            default: './dist/managed.js',
          },
        }
      : {}),
  };
}

function expectedPackedDependencies(workspaceDirectory: string, version: string): Record<string, string> {
  switch (workspaceDirectory) {
    case 'core':
      return {};
    case 'cave':
      return {
        '@hpke/core': '1.9.0',
        '@hpke/dhkem-x25519': '1.8.0',
        '@opencoven/sdk-core': version,
        canonicalize: '3.0.0',
      };
    case 'coven':
      return {
        '@opencoven/sdk-core': version,
      };
    case 'sdk':
      return {
        '@opencoven/cave-client': version,
        '@opencoven/coven-client': version,
        '@opencoven/sdk-core': version,
      };
    case 'cli':
      return {
        '@napi-rs/keyring': '1.3.0',
        '@opencoven/cave-client': version,
        '@opencoven/coven-client': version,
        '@opencoven/sdk-core': version,
      };
    default:
      throw new Error(`Unexpected workspace package ${workspaceDirectory}.`);
  }
}

function readTarballFile(tarball: string, path: string): string {
  return execFileSync('tar', ['-xOf', tarball, `package/${path}`], {
    encoding: 'utf8',
  });
}

async function waitForPath(path: string) {
  const deadline = Date.now() + 2_000;

  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

function usePackedCaveIteratorContracts(
  client: CaveClient,
  options: BoundedPageOptions,
): [
  AsyncGenerator<CaveCanonicalFamiliar>,
  AsyncGenerator<CaveProject>,
  AsyncGenerator<CaveConversation>,
  AsyncGenerator<CaveConversationMessage>,
] {
  return [
    client.iterateFamiliars(options),
    client.iterateProjects(options),
    client.iterateConversations(options),
    client.iterateConversationMessages('conversation-1', options),
  ];
}

void usePackedCaveIteratorContracts;

function usePackedManagedNativeContracts(
  transport: CaveManagedNativeTransport,
  exchange: CaveManagedNativePairingExchange,
  discard: CaveManagedNativeDiscardResult,
): CaveClient {
  void exchange;
  void discard;
  return createManagedCaveClient({ transport });
}

void usePackedManagedNativeContracts;

describe('packed public packages', () => {
  test('exposes bounded Cave iterators from package roots', () => {
    const client = new CaveClient({
      transport: {
        health: () => Promise.reject(new Error('not called')),
      },
    });

    expect(client.iterateFamiliars.bind(client)).toBeTypeOf('function');
    expect(client.iterateProjects.bind(client)).toBeTypeOf('function');
    expect(client.iterateConversations.bind(client)).toBeTypeOf('function');
    expect(
      client.iterateConversationMessages.bind(client),
    ).toBeTypeOf('function');
  });

  test('exposes the managed native Cave factory from package roots', () => {
    expect(createManagedCaveClient).toBeTypeOf('function');
  });

  test('builds public packages with the authenticated Node and exact tsup entrypoint', () => {
    const invocation = createPublicPackageBuildInvocation({
      root,
      packageMetadata: PUBLIC_PACKAGES[0]!,
      nodePath: '/opt/hostedtoolcache/node/24.18.1/x64/bin/node',
    });

    expect(invocation.command).toBe(
      '/opt/hostedtoolcache/node/24.18.1/x64/bin/node',
    );
    expect(invocation.args[0]).toMatch(
      /node_modules\/tsup\/dist\/cli-default\.js$/u,
    );
    expect(invocation.args[0]).not.toContain('node_modules/.bin');
    expect(invocation.args.slice(1)).toEqual([
      '--config',
      'tsup.config.ts',
    ]);
    expect(invocation.cwd).toBe(resolve(root, 'packages/core'));
  });

  test('removes publish lifecycle hooks before invoking pnpm pack', () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-publish-safe-pack-spec',
      childSegments: ['package', 'tarballs'],
    });
    const packageRoot = resolve(artifactContext.rootPath, 'package');
    const tarballRoot = resolve(artifactContext.rootPath, 'tarballs');
    const manifest = createPublishSafePackageManifest(
      {
        name: '@opencoven/sdk-core',
        version: '0.1.0',
        private: false,
        scripts: {
          build: 'tsup --config tsup.config.ts',
          prepack:
            'node -e "require(\'node:fs\').writeFileSync(\'prepack-ran\',\'yes\')"',
          prepublishOnly: 'node require-release-authorization.mjs',
          postpublish: 'node exfiltrate.mjs',
        },
      },
      '@opencoven/sdk-core',
    );

    expect(manifest.scripts).toEqual({
      build: 'tsup --config tsup.config.ts',
    });
    writeFileSync(
      resolve(packageRoot, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    packageArtifactHelpers.runPnpm(
      ['pack', '--pack-destination', tarballRoot],
      packageRoot,
    );
    expect(existsSync(resolve(packageRoot, 'prepack-ran'))).toBe(false);
    const packedManifest = JSON.parse(
      readTarballFile(
        packageArtifactHelpers.findTarball(tarballRoot),
        'package.json',
      ),
    ) as { scripts?: Record<string, string> };
    expect(packedManifest.scripts).toEqual({
      build: 'tsup --config tsup.config.ts',
    });
    cleanupOwnedTempRoot(artifactContext);
  });

  test('warms isolated installs before enforcing offline resolution', () => {
    const warmArgs = isolatedInstallArgs({ offline: false });

    expect(warmArgs).not.toContain('--offline');
    expect(warmArgs).toContain('--prefer-offline');
    expect(isolatedInstallArgs()).toContain('--offline');
  });

  test.each([
    ['nodePath', { nodePath: process.execPath }],
    ['corepackPath', { corepackPath: '/tmp/corepack.js' }],
  ])('rejects partial synchronous pnpm runtime overrides containing only %s', (_label, options) => {
    expect(() =>
      packageArtifactHelpers.runPnpm(['--version'], root, options),
    ).toThrow('nodePath and corepackPath must be provided together');
  });

  test.each([
    ['nodePath', { nodePath: process.execPath }],
    ['corepackPath', { corepackPath: '/tmp/corepack.js' }],
  ])('rejects partial asynchronous pnpm runtime overrides containing only %s', async (_label, options) => {
    await expect(
      packageArtifactHelpers.runPnpmAsync(['--version'], root, options),
    ).rejects.toThrow('nodePath and corepackPath must be provided together');
  });

  test('constructs exact synchronous authenticated and reviewed-default pnpm commands', () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-pnpm-sync-invocation-spec',
      childSegments: ['fake-bin'],
    });
    const fakeBin = resolve(artifactContext.rootPath, 'fake-bin');
    const authenticatedCorepack = resolve(
      artifactContext.rootPath,
      'authenticated-corepack.cjs',
    );
    const defaultCorepack = resolve(fakeBin, 'corepack');
    const authenticatedCallPath = resolve(
      artifactContext.rootPath,
      'authenticated-call.json',
    );
    const defaultCallPath = resolve(
      artifactContext.rootPath,
      'default-call.json',
    );
    const recorder = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.PNPM_CALL_PATH, JSON.stringify({
  argv: process.argv.slice(2),
  entrypoint: process.argv[1],
  executable: process.execPath,
}));
`;

    writeFileSync(authenticatedCorepack, recorder);
    writeFileSync(defaultCorepack, recorder, { mode: 0o700 });

    try {
      packageArtifactHelpers.runPnpm(
        ['pack', '--ignore-scripts'],
        artifactContext.rootPath,
        {
          nodePath: process.execPath,
          corepackPath: authenticatedCorepack,
          env: {
            ...process.env,
            PNPM_CALL_PATH: authenticatedCallPath,
          },
          stdio: 'pipe',
        },
      );
      packageArtifactHelpers.runPnpm(
        ['pack', '--ignore-scripts'],
        artifactContext.rootPath,
        {
          env: {
            ...process.env,
            PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
            PNPM_CALL_PATH: defaultCallPath,
          },
          stdio: 'pipe',
        },
      );

      expect(JSON.parse(readFileSync(authenticatedCallPath, 'utf8'))).toEqual({
        argv: [
          'pnpm@10.34.0',
          '--config.pnpmfile=/dev/null',
          '--config.global-pnpmfile=/dev/null',
          'pack',
          '--ignore-scripts',
        ],
        entrypoint: authenticatedCorepack,
        executable: process.execPath,
      });
      expect(JSON.parse(readFileSync(defaultCallPath, 'utf8'))).toEqual({
        argv: [
          'pnpm@10.34.0',
          '--config.pnpmfile=/dev/null',
          '--config.global-pnpmfile=/dev/null',
          'pack',
          '--ignore-scripts',
        ],
        entrypoint: defaultCorepack,
        executable: process.execPath,
      });
    } finally {
      cleanupOwnedTempRoot(artifactContext);
    }
  });

  test('constructs exact asynchronous authenticated and reviewed-default pnpm commands', async () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-pnpm-async-invocation-spec',
      childSegments: ['fake-bin'],
    });
    const fakeBin = resolve(artifactContext.rootPath, 'fake-bin');
    const authenticatedCorepack = resolve(
      artifactContext.rootPath,
      'authenticated-corepack.cjs',
    );
    const defaultCorepack = resolve(fakeBin, 'corepack');
    const authenticatedCallPath = resolve(
      artifactContext.rootPath,
      'authenticated-call.json',
    );
    const defaultCallPath = resolve(
      artifactContext.rootPath,
      'default-call.json',
    );
    const recorder = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.PNPM_CALL_PATH, JSON.stringify({
  argv: process.argv.slice(2),
  entrypoint: process.argv[1],
  executable: process.execPath,
}));
`;

    writeFileSync(authenticatedCorepack, recorder);
    writeFileSync(defaultCorepack, recorder, { mode: 0o700 });

    try {
      await packageArtifactHelpers.runPnpmAsync(
        ['install', '--offline'],
        artifactContext.rootPath,
        {
          nodePath: process.execPath,
          corepackPath: authenticatedCorepack,
          env: {
            ...process.env,
            PNPM_CALL_PATH: authenticatedCallPath,
          },
          stdio: 'pipe',
        },
      );
      await packageArtifactHelpers.runPnpmAsync(
        ['install', '--offline'],
        artifactContext.rootPath,
        {
          env: {
            ...process.env,
            PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
            PNPM_CALL_PATH: defaultCallPath,
          },
          stdio: 'pipe',
        },
      );

      expect(JSON.parse(readFileSync(authenticatedCallPath, 'utf8'))).toEqual({
        argv: [
          'pnpm@10.34.0',
          '--config.pnpmfile=/dev/null',
          '--config.global-pnpmfile=/dev/null',
          'install',
          '--offline',
        ],
        entrypoint: authenticatedCorepack,
        executable: process.execPath,
      });
      expect(JSON.parse(readFileSync(defaultCallPath, 'utf8'))).toEqual({
        argv: [
          'pnpm@10.34.0',
          '--config.pnpmfile=/dev/null',
          '--config.global-pnpmfile=/dev/null',
          'install',
          '--offline',
        ],
        entrypoint: defaultCorepack,
        executable: process.execPath,
      });
    } finally {
      cleanupOwnedTempRoot(artifactContext);
    }
  });

  test('installs isolated consumer workspaces recursively', () => {
    const workspaceArgs = isolatedInstallArgs({ workspace: true });

    expect(workspaceArgs).toContain('--recursive');
    expect(workspaceArgs).not.toContain('--ignore-workspace');
    expect(workspaceArgs).toContain('--no-hoist');
    expect(workspaceArgs).toContain('--config.public-hoist-pattern=[]');
    expect(workspaceArgs).toContain('--config.shamefully-hoist=false');
    expect(workspaceArgs).toContain('--config.node-linker=isolated');
  });

  test('removes warm module trees before the clean offline install', () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-packed-offline-install-spec',
      childSegments: ['fake-bin', 'packages'],
    });

    const fakeBin = resolve(artifactContext.rootPath, 'fake-bin');
    const nestedConsumer = resolve(artifactContext.rootPath, 'packages', 'consumer');
    const fakeCorepack = resolve(fakeBin, 'corepack');
    const callsPath = resolve(artifactContext.rootPath, 'corepack-calls.json');
    const lockfilePath = resolve(artifactContext.rootPath, 'pnpm-lock.yaml');
    const originalPath = process.env.PATH;

    mkdirSync(nestedConsumer, { recursive: true });
    writeFileSync(
      fakeCorepack,
      `#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const cwd = process.cwd();
const callsPath = resolve(cwd, 'corepack-calls.json');
const lockfilePath = resolve(cwd, 'pnpm-lock.yaml');
const rootModules = resolve(cwd, 'node_modules');
const nestedModules = resolve(cwd, 'packages', 'consumer', 'node_modules');
const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')) : [];

calls.push(process.argv.slice(2));
writeFileSync(callsPath, JSON.stringify(calls));

if (calls.length === 1) {
  mkdirSync(rootModules, { recursive: true });
  mkdirSync(nestedModules, { recursive: true });
  writeFileSync(lockfilePath, 'lockfileVersion: "9.0"\\n');
  process.exit(0);
}

if (existsSync(rootModules) || existsSync(nestedModules)) {
  console.error('offline install observed module trees from the warm install');
  process.exit(1);
}

if (!existsSync(lockfilePath)) {
  console.error('offline install lost the warmed lockfile');
  process.exit(1);
}

mkdirSync(rootModules, { recursive: true });
writeFileSync(resolve(rootModules, '.offline-install'), 'clean\\n');
`,
    );
    chmodSync(fakeCorepack, 0o700);
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`;

    try {
      expect(() =>
        installIsolatedOfflineAfterWarming(artifactContext.rootPath, { workspace: true }),
      ).not.toThrow();

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as string[][];
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('--prefer-offline');
      expect(calls[1]).toContain('--offline');
      expect(readFileSync(lockfilePath, 'utf8')).toBe('lockfileVersion: "9.0"\n');
      expect(
        readFileSync(resolve(artifactContext.rootPath, 'node_modules', '.offline-install'), 'utf8'),
      ).toBe('clean\n');
    } finally {
      process.env.PATH = originalPath;
      cleanupOwnedTempRoot(artifactContext);
    }
  });

  test('cleans every isolated consumer before parallel offline installs', async () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-packed-parallel-offline-install-spec',
      childSegments: ['fake-bin'],
    });
    const fakeBin = resolve(artifactContext.rootPath, 'fake-bin');
    const fakeCorepack = resolve(fakeBin, 'corepack');
    const originalPath = process.env.PATH;
    const consumerRoots = ['consumer-a', 'consumer-b'].map((name) =>
      resolve(artifactContext.rootPath, name),
    );

    for (const consumerRoot of consumerRoots) {
      mkdirSync(resolve(consumerRoot, 'packages', 'consumer'), { recursive: true });
    }

    writeFileSync(
      fakeCorepack,
      `#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const cwd = process.cwd();
const callsPath = resolve(cwd, 'corepack-calls.json');
const lockfilePath = resolve(cwd, 'pnpm-lock.yaml');
const rootModules = resolve(cwd, 'node_modules');
const nestedModules = resolve(cwd, 'packages', 'consumer', 'node_modules');
const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, 'utf8')) : [];

calls.push(process.argv.slice(2));
writeFileSync(callsPath, JSON.stringify(calls));

if (calls.length === 1) {
  mkdirSync(rootModules, { recursive: true });
  mkdirSync(nestedModules, { recursive: true });
  writeFileSync(lockfilePath, 'lockfileVersion: "9.0"\\n');
  process.exit(0);
}

if (existsSync(rootModules) || existsSync(nestedModules) || !existsSync(lockfilePath)) {
  process.exit(1);
}
`,
    );
    chmodSync(fakeCorepack, 0o700);
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`;

    try {
      await expect(
        installIsolatedConsumersOfflineAfterWarming(consumerRoots),
      ).resolves.toBeUndefined();

      for (const consumerRoot of consumerRoots) {
        const calls = JSON.parse(
          readFileSync(resolve(consumerRoot, 'corepack-calls.json'), 'utf8'),
        ) as string[][];
        expect(calls).toHaveLength(2);
        expect(calls[0]).toContain('--prefer-offline');
        expect(calls[1]).toContain('--offline');
        expect(readFileSync(resolve(consumerRoot, 'pnpm-lock.yaml'), 'utf8')).toBe(
          'lockfileVersion: "9.0"\n',
        );
      }
    } finally {
      process.env.PATH = originalPath;
      cleanupOwnedTempRoot(artifactContext);
    }
  });

  test('packs exact root export maps and direct dependencies for every public package', () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-packed-manifest-contract-spec',
      childSegments: ['tarballs'],
    });
    const tarballRoot = resolve(artifactContext.rootPath, 'tarballs');

    try {
      for (const { workspaceDirectory } of PUBLIC_PACKAGES) {
        const destination = resolve(tarballRoot, workspaceDirectory);
        mkdirSync(destination, { recursive: true });
        packageArtifactHelpers.runPnpm(
          ['pack', '--pack-destination', destination],
          resolve(root, 'packages', workspaceDirectory),
        );

        const tarball = packageArtifactHelpers.findTarball(destination);
        const manifest = JSON.parse(readTarballFile(tarball, 'package.json')) as {
          version: string;
          main?: string;
          types?: string;
          exports?: Record<string, unknown>;
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };

        expect(manifest.main).toBe('./dist/index.js');
        expect(manifest.types).toBe('./dist/index.d.ts');
        expect(manifest.exports).toEqual(expectedPackageExports(workspaceDirectory));
        expect(manifest.dependencies ?? {}).toEqual(
          expectedPackedDependencies(workspaceDirectory, manifest.version),
        );
        if (workspaceDirectory === 'cave') {
          const declarations = readTarballFile(tarball, 'dist/index.d.ts');
          expect(declarations).toContain('CaveManagedCredentialTransport');
          expect(declarations).toContain('CaveManagedNativeCredentialCustody');
          const managedDeclarations = readTarballFile(tarball, 'dist/managed.d.ts');
          expect(managedDeclarations).toContain('createManagedCaveClient');
          expect(managedDeclarations).not.toMatch(
            /\bNodeJS\.(?:ProcessEnv|Platform)\b/u,
          );
        }
        if (workspaceDirectory === 'core') {
          expect(readTarballFile(tarball, 'dist/browser.d.ts')).toContain(
            'normalizePageOptions',
          );
        }
        if (workspaceDirectory === 'cli') {
          expect(manifest.optionalDependencies?.['@napi-rs/keyring']).toBeUndefined();
        }
      }
    } finally {
      cleanupOwnedTempRoot(artifactContext);
    }
  }, 60_000);

  test.each(['warm', 'offline'] as const)(
    'waits for every parallel %s install before propagating a child failure',
    async (failingPhase) => {
      const artifactContext = createOwnedTempDirectory({
        prefix: `opencoven-packed-${failingPhase}-settling-spec`,
        childSegments: ['fake-bin'],
      });
      const fakeBin = resolve(artifactContext.rootPath, 'fake-bin');
      const fakeCorepack = resolve(fakeBin, 'corepack');
      const markerPath = resolve(artifactContext.rootPath, `${failingPhase}-slow-settled`);
      const originalPath = process.env.PATH;
      const consumerRoots = ['consumer-a', 'consumer-b'].map((name) =>
        resolve(artifactContext.rootPath, name),
      );

      for (const consumerRoot of consumerRoots) {
        mkdirSync(consumerRoot, { recursive: true });
      }

      writeFileSync(
        fakeCorepack,
        `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const { basename, resolve } = require('node:path');

const args = process.argv.slice(2);
const cwd = process.cwd();
const phase = args.includes('--offline') ? 'offline' : 'warm';

if (phase !== ${JSON.stringify(failingPhase)}) {
  process.exit(0);
}

if (basename(cwd) === 'consumer-a') {
  process.exit(17);
}

setTimeout(() => {
  writeFileSync(resolve(cwd, '..', ${JSON.stringify(`${failingPhase}-slow-settled`)}), 'settled\\n');
}, 150);
`,
      );
      chmodSync(fakeCorepack, 0o700);
      process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`;

      try {
        await expect(
          installIsolatedConsumersOfflineAfterWarming(consumerRoots),
        ).rejects.toThrow(/failed in .*consumer-a with exit code 17/);

        const slowSettledBeforeRejection = existsSync(markerPath);
        await waitForPath(markerPath);

        expect(slowSettledBeforeRejection).toBe(true);
        expect(readFileSync(markerPath, 'utf8')).toBe('settled\n');
      } finally {
        process.env.PATH = originalPath;
        cleanupOwnedTempRoot(artifactContext);
      }
    },
    30_000,
  );

  test('reads canonical repository metadata from a packed manifest', () => {
    const artifactContext = createOwnedTempDirectory({
      prefix: 'opencoven-packed-metadata-spec',
      childSegments: ['package'],
    });
    const packageRoot = resolve(artifactContext.rootPath, 'package');
    const tarball = resolve(artifactContext.rootPath, 'package.tgz');
    const packageMetadata = PUBLIC_PACKAGES[0];

    if (packageMetadata === undefined) {
      throw new Error('Expected at least one public package metadata entry.');
    }

    const { packageName, repositoryDirectory } = packageMetadata;

    try {
      writeFileSync(
        resolve(packageRoot, 'package.json'),
        `${JSON.stringify({
          name: packageName,
          repository: {
            type: 'git',
            url: CANONICAL_REPOSITORY_URL,
            directory: repositoryDirectory,
          },
        })}\n`,
      );
      writeFileSync(resolve(packageRoot, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0\n');
      const packed = spawnSync('tar', ['-czf', tarball, 'package'], {
        cwd: artifactContext.rootPath,
        encoding: 'utf8',
      });

      expect(packed.status, packed.stderr).toBe(0);
      expect(readTarballFile(tarball, 'CHANGELOG.md')).toContain('## 0.1.0');
      expect(
        assertCanonicalRepository(
          readPackedPackageManifest(tarball),
          repositoryDirectory,
          packageName,
        ),
      ).toEqual({
        type: 'git',
        url: CANONICAL_REPOSITORY_URL,
        directory: repositoryDirectory,
      });
    } finally {
      cleanupOwnedTempRoot(artifactContext);
    }
  }, 30_000);
});
