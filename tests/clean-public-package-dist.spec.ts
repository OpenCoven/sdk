import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, test } from 'vitest';

import {
  cleanPublicPackageDistDirectories,
  publicPackageDistDirectories,
} from '../scripts/clean-public-package-dist.mjs';
import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('clean public package dist', () => {
  test('removes only generated public package dist directories', () => {
    const root = resolve(
      process.cwd(),
      `.scratch-clean-public-package-dist-${randomUUID()}`,
    );
    scratchRoots.push(root);
    const publicDirectories = publicPackageDistDirectories(root);
    const cliDirectory = resolve(root, 'packages', 'cli', 'dist');

    for (const directory of publicDirectories) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'generated.txt'), 'generated\n');
    }
    mkdirSync(cliDirectory, { recursive: true });
    writeFileSync(resolve(cliDirectory, 'generated.txt'), 'private\n');

    cleanPublicPackageDistDirectories(root);

    expect(PUBLIC_PACKAGES).toHaveLength(4);
    expect(publicDirectories.every((directory) => !existsSync(directory))).toBe(true);
    expect(existsSync(cliDirectory)).toBe(true);
  });
});
