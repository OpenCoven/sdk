import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createPackArtifactOutputDirectory } from '../scripts/pack-public-packages.mjs';
import { cleanupOwnedTempRoot, createOwnedTempDirectory } from '../scripts/owned-temp-directory.mjs';

const createdTempDirectories: Array<ReturnType<typeof createOwnedTempDirectory>> = [];
const scratchRoots: string[] = [];

afterEach(() => {
  while (createdTempDirectories.length > 0) {
    const context = createdTempDirectories.pop();

    if (context === undefined) {
      continue;
    }

    try {
      cleanupOwnedTempRoot(context);
    } catch {
      rmSync(context.rootPath, { force: true, recursive: true });
    }
  }

  while (scratchRoots.length > 0) {
    const scratchRoot = scratchRoots.pop();

    if (scratchRoot !== undefined) {
      rmSync(scratchRoot, { force: true, recursive: true });
    }
  }
});

describe('pack-public-packages artifact directory safety', () => {
  test.each(['.', '..', '../escape', '/Users/buns', '/'])(
    'rejects unsafe temp child path segment %s',
    (name) => {
      expect(() =>
        createOwnedTempDirectory({
          prefix: 'opencoven-sdk-pack-public-packages-test',
          childSegments: [name],
        }),
      ).toThrow(/safe child name/);
    },
  );

  test('creates mode-0700 temp directories under the real OS temp directory', () => {
    const outputDirectory = createPackArtifactOutputDirectory();
    createdTempDirectories.push(outputDirectory);

    expect(realpathSync(outputDirectory.rootPath).startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(outputDirectory.path).toBe(resolve(outputDirectory.rootPath, 'tarballs'));
    expect(lstatSync(outputDirectory.rootPath).mode & 0o777).toBe(0o700);
    expect(lstatSync(outputDirectory.path).mode & 0o777).toBe(0o700);
  });

  test('rejects cleanup after the owned root identity changes', () => {
    const outputDirectory = createPackArtifactOutputDirectory();
    createdTempDirectories.push(outputDirectory);

    const displacedRoot = `${outputDirectory.rootPath}.displaced`;
    renameSync(outputDirectory.rootPath, displacedRoot);
    scratchRoots.push(displacedRoot);
    mkdirSync(outputDirectory.rootPath, { recursive: true, mode: 0o700 });

    expect(() => cleanupOwnedTempRoot(outputDirectory)).toThrow(/changed identity/);
  });

  test('rejects cleanup when a recreated root reuses the freed inode number', () => {
    // The test above retains the original directory, guaranteeing an ordinary
    // inode mismatch. Linux can instead reuse an inode after deletion, so an
    // inode-only guard may wave the impostor through.
    //
    // This one removes the platform from the equation: it recreates the root
    // and then rewrites the recorded dev/ino to whatever the new directory
    // actually has, which is exactly what inode reuse produces. Anything that
    // still refuses is refusing on evidence other than the inode.
    const outputDirectory = createPackArtifactOutputDirectory();
    createdTempDirectories.push(outputDirectory);

    rmSync(outputDirectory.rootPath, { force: true, recursive: true });
    mkdirSync(outputDirectory.rootPath, { recursive: true, mode: 0o700 });

    const impostorStats = lstatSync(outputDirectory.rootPath);
    const withReusedInode = {
      ...outputDirectory,
      rootDevice: impostorStats.dev,
      rootInode: impostorStats.ino,
    };

    expect(() => cleanupOwnedTempRoot(withReusedInode)).toThrow(/changed identity/);
  });

  test('removes nested symlinks without following them during cleanup', () => {
    const outputDirectory = createPackArtifactOutputDirectory();
    const scratchRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-sdk-pack-public-packages-safety-spec-'),
    );
    const externalRoot = resolve(scratchRoot, 'external');

    createdTempDirectories.push(outputDirectory);
    scratchRoots.push(scratchRoot);

    mkdirSync(externalRoot, { recursive: true });
    mkdirSync(resolve(outputDirectory.path, 'nested'), { recursive: true });
    writeFileSync(resolve(outputDirectory.path, 'nested', 'local.txt'), 'local\n');
    writeFileSync(resolve(externalRoot, 'outside.txt'), 'outside\n');
    symlinkSync(externalRoot, resolve(outputDirectory.path, 'nested', 'escape'));

    cleanupOwnedTempRoot(outputDirectory);
    createdTempDirectories.pop();

    expect(() => lstatSync(outputDirectory.rootPath)).toThrow();
    expect(lstatSync(externalRoot).isDirectory()).toBe(true);
    expect(readFileSync(resolve(externalRoot, 'outside.txt'), 'utf8')).toBe('outside\n');
  });
});
