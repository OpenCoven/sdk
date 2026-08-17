import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import {
  preparePackArtifactOutputDirectory,
  removePackArtifactOutputDirectory,
  resolvePackArtifactOutputDirectory,
} from '../scripts/pack-public-packages.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratchRoot = resolve(root, '.artifacts', 'pack-public-packages-safety-spec');

function createRepository(name: string): string {
  const repositoryRoot = resolve(scratchRoot, name, 'repo');
  mkdirSync(repositoryRoot, { recursive: true });
  return repositoryRoot;
}

function createExternalDirectory(name: string): string {
  const externalRoot = resolve(scratchRoot, name, 'external');
  mkdirSync(externalRoot, { recursive: true });
  return externalRoot;
}

afterEach(() => {
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('pack-public-packages artifact directory safety', () => {
  test.each(['.', '..', '../escape', '/Users/buns', '/'])('rejects unsafe artifact name %s', (name) => {
    expect(() => resolvePackArtifactOutputDirectory(name)).toThrow(/safe child name|must stay inside/);
  });

  test('rejects a symlinked .artifacts base directory', () => {
    const repositoryRoot = createRepository('symlinked-artifacts');
    const externalRoot = createExternalDirectory('symlinked-artifacts');

    symlinkSync(externalRoot, resolve(repositoryRoot, '.artifacts'));

    expect(() =>
      resolvePackArtifactOutputDirectory('public-tarballs', { repositoryRoot }),
    ).toThrow(/must not be a symlink/);
  });

  test('rejects a symlinked intermediate artifact directory', () => {
    const repositoryRoot = createRepository('symlinked-intermediate');
    const externalRoot = createExternalDirectory('symlinked-intermediate');

    mkdirSync(resolve(repositoryRoot, '.artifacts'));
    symlinkSync(externalRoot, resolve(repositoryRoot, '.artifacts', 'pack-public-packages'));

    expect(() =>
      resolvePackArtifactOutputDirectory('public-tarballs', { repositoryRoot }),
    ).toThrow(/must not be a symlink/);
  });

  test('creates and accepts real artifact directories inside the repository root', () => {
    const repositoryRoot = createRepository('real-directories');
    const outputDirectory = preparePackArtifactOutputDirectory('public-tarballs', {
      repositoryRoot,
    });

    expect(outputDirectory).toBe(
      resolve(repositoryRoot, '.artifacts', 'pack-public-packages', 'public-tarballs'),
    );
    expect(lstatSync(resolve(repositoryRoot, '.artifacts')).isDirectory()).toBe(true);
    expect(
      lstatSync(resolve(repositoryRoot, '.artifacts', 'pack-public-packages')).isDirectory(),
    ).toBe(true);
    expect(lstatSync(outputDirectory).isDirectory()).toBe(true);
  });

  test('rejects cleanup paths that are the base directory, repository root, or an external path', () => {
    const repositoryRoot = createRepository('cleanup-guards');
    const outputDirectory = preparePackArtifactOutputDirectory('public-tarballs', {
      repositoryRoot,
    });
    expect(outputDirectory).toContain('/public-tarballs');

    expect(() =>
      removePackArtifactOutputDirectory(resolve(repositoryRoot, '.artifacts', 'pack-public-packages'), {
        repositoryRoot,
      }),
    ).toThrow(/must stay inside/);
    expect(() => removePackArtifactOutputDirectory(repositoryRoot, { repositoryRoot })).toThrow(
      /must stay inside/,
    );
    expect(() =>
      removePackArtifactOutputDirectory(resolve(scratchRoot, 'outside'), { repositoryRoot }),
    ).toThrow(/must stay inside/);
  });

  test('replaces a symlinked artifact leaf without deleting the symlink target', () => {
    const repositoryRoot = createRepository('leaf-symlink-cleanup');
    const externalRoot = createExternalDirectory('leaf-symlink-cleanup');
    const outputDirectory = resolve(
      repositoryRoot,
      '.artifacts',
      'pack-public-packages',
      'public-tarballs',
    );

    mkdirSync(resolve(repositoryRoot, '.artifacts', 'pack-public-packages'), {
      recursive: true,
    });
    writeFileSync(resolve(externalRoot, 'outside.txt'), 'outside\n');
    symlinkSync(externalRoot, outputDirectory);

    const preparedOutputDirectory = preparePackArtifactOutputDirectory('public-tarballs', {
      repositoryRoot,
    });

    expect(preparedOutputDirectory).toBe(outputDirectory);
    expect(lstatSync(preparedOutputDirectory).isDirectory()).toBe(true);
    expect(existsSync(resolve(preparedOutputDirectory, 'outside.txt'))).toBe(false);
    expect(readFileSync(resolve(externalRoot, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  test('removes nested symlinks without following them during cleanup', () => {
    const repositoryRoot = createRepository('nested-symlink-cleanup');
    const externalRoot = createExternalDirectory('nested-symlink-cleanup');
    const outputDirectory = preparePackArtifactOutputDirectory('public-tarballs', {
      repositoryRoot,
    });

    mkdirSync(resolve(outputDirectory, 'nested'), { recursive: true });
    writeFileSync(resolve(outputDirectory, 'nested', 'local.txt'), 'local\n');
    writeFileSync(resolve(externalRoot, 'outside.txt'), 'outside\n');
    symlinkSync(externalRoot, resolve(outputDirectory, 'nested', 'escape'));

    removePackArtifactOutputDirectory(outputDirectory, { repositoryRoot });

    expect(existsSync(outputDirectory)).toBe(false);
    expect(readFileSync(resolve(externalRoot, 'outside.txt'), 'utf8')).toBe('outside\n');
  });
});
