import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import {
  CANONICAL_REPOSITORY_URL,
  PUBLIC_PACKAGES,
  assertCanonicalRepository,
  readPackedPackageManifest,
} from '../scripts/repository-metadata.mjs';
import { isolatedInstallArgs } from '../scripts/package-artifacts.mjs';

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
  test('allows fresh consumer installs to fetch declared dependencies', () => {
    expect(isolatedInstallArgs()).not.toContain('--offline');
    expect(isolatedInstallArgs({ offline: true })).toContain('--offline');
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
      : { status: 1, stderr: 'scripts/verify-package.mjs is missing', stdout: '' };

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Cave health example passed.');
    expect(result.stdout).toContain('Coven health example passed.');
    expect(result.stdout).toContain('Unified health example passed.');
  }, 30_000);
});
