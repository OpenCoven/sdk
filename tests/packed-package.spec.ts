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
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
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
  installIsolatedConsumersOfflineAfterWarming,
  installIsolatedOfflineAfterWarming,
  isolatedInstallArgs,
} from '../scripts/package-artifacts.mjs';
import * as packageArtifacts from '../scripts/package-artifacts.mjs';
import { cleanupOwnedTempRoot, createOwnedTempDirectory } from '../scripts/owned-temp-directory.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const packageArtifactHelpers = packageArtifacts as unknown as {
  findTarball(directory: string): string;
  runPnpm(args: string[], cwd: string): void;
};
const ROOT_PACKAGE_EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  },
  './package.json': './package.json',
} as const;

function expectedPackedDependencies(workspaceDirectory: string, version: string): Record<string, string> {
  switch (workspaceDirectory) {
    case 'core':
      return {};
    case 'cave':
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

describe('packed public packages', () => {
  test('generates an isolated consumer that typechecks and invokes bounded Cave iterators', () => {
    const verifier = readFileSync(resolve(root, 'scripts', 'verify-package.mjs'), 'utf8');

    expect(verifier).toContain(
      `import {
  CaveClient,
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveProject,
} from '@opencoven/cave-client';`,
    );
    expect(verifier).toContain('type BoundedPageOptions,');
    expect(verifier).toContain('const boundedPageOptions: BoundedPageOptions = { maxPages: 1 };');
    expect(verifier).toContain('cave.iterateFamiliars(boundedPageOptions)');
    expect(verifier).toContain('cave.iterateProjects(boundedPageOptions)');
    expect(verifier).toContain('cave.iterateConversations(boundedPageOptions)');
    expect(verifier).toContain(
      "cave.iterateConversationMessages('conversation-1', boundedPageOptions)",
    );
    expect(verifier).toContain('const caveIterators: [');
    expect(verifier).toContain('AsyncGenerator<CaveCanonicalFamiliar>');
    expect(verifier).toContain('AsyncGenerator<CaveProject>');
    expect(verifier).toContain('AsyncGenerator<CaveConversation>');
    expect(verifier).toContain('AsyncGenerator<CaveConversationMessage>');
    expect(verifier).toContain('const iteratorClient = new CaveClient({');
    expect(verifier).toContain('iteratorClient.iterateFamiliars({ maxPages: 1 })');
    expect(verifier).toContain('iteratorClient.iterateProjects({ maxPages: 1 })');
    expect(verifier).toContain('iteratorClient.iterateConversations({ maxPages: 1 })');
    expect(verifier).toContain(
      "iteratorClient.iterateConversationMessages('conversation-1', { maxPages: 1 })",
    );
    expect(verifier).toContain("typeof iterator.next !== 'function'");
    expect(verifier).toContain(
      "throw new Error('Packed Cave iterator methods are unavailable.');",
    );
  });

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

  test('warms isolated installs before enforcing offline resolution', () => {
    const warmArgs = isolatedInstallArgs({ offline: false });

    expect(warmArgs).not.toContain('--offline');
    expect(warmArgs).toContain('--prefer-offline');
    expect(isolatedInstallArgs()).toContain('--offline');
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
        expect(manifest.exports).toEqual(ROOT_PACKAGE_EXPORTS);
        expect(manifest.dependencies ?? {}).toEqual(
          expectedPackedDependencies(workspaceDirectory, manifest.version),
        );
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
