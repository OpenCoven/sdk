import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import {
  CANONICAL_REPOSITORY_URL,
  PUBLIC_PACKAGES,
  assertCanonicalRepository,
  readPackedPackageManifest,
} from '../scripts/repository-metadata.mjs';
import {
  installIsolatedOfflineAfterWarming,
  isolatedInstallArgs,
} from '../scripts/package-artifacts.mjs';
import { cleanupOwnedTempRoot, createOwnedTempDirectory } from '../scripts/owned-temp-directory.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const verifier = resolve(root, 'scripts/verify-package.mjs');

function runPnpm(args: string[], cwd: string) {
  return spawnSync('corepack', ['pnpm@10.34.0', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function findTarball(directory: string): string {
  const tarballs = readdirSync(directory).filter((entry) => entry.endsWith('.tgz'));

  expect(tarballs, `Expected one tarball in ${directory}.`).toHaveLength(1);
  const [tarball] = tarballs;

  if (tarball === undefined) {
    throw new Error(`Expected one tarball in ${directory}.`);
  }

  return resolve(directory, tarball);
}

describe('packed public packages', () => {
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
      expect(readFileSync(resolve(artifactContext.rootPath, 'node_modules', '.offline-install'), 'utf8')).toBe(
        'clean\n',
      );
    } finally {
      process.env.PATH = originalPath;
      cleanupOwnedTempRoot(artifactContext);
    }
  });

  test('pack tarballs preserve canonical repository metadata', () => {
    const artifactRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-packed-package-spec-'));
    const tarballRoot = resolve(artifactRoot, 'tarballs');
    mkdirSync(tarballRoot, { recursive: true });

    try {
      for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
        const destination = resolve(tarballRoot, workspaceDirectory);
        mkdirSync(destination, { recursive: true });

        const packed = runPnpm(
          ['pack', '--pack-destination', destination],
          resolve(root, 'packages', workspaceDirectory),
        );

        expect(packed.status, packed.stderr).toBe(0);

        const manifest = readPackedPackageManifest(findTarball(destination));
        expect(assertCanonicalRepository(manifest, repositoryDirectory, packageName)).toEqual({
          type: 'git',
          url: CANONICAL_REPOSITORY_URL,
          directory: repositoryDirectory,
        });
      }
    } finally {
      rmSync(artifactRoot, { force: true, recursive: true });
    }
  }, 30_000);

  test('pack, install, import, and compile only their public exports', () => {
    const result = existsSync(verifier)
      ? spawnSync(process.execPath, [verifier], {
          cwd: root,
          encoding: 'utf8',
        })
      : { status: 1, stderr: 'scripts/verify-package.mjs is missing' };

    expect(result.status, result.stderr).toBe(0);
  }, 30_000);
});
