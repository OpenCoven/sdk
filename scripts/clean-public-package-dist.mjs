import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_PACKAGES } from './repository-metadata.mjs';

export function publicPackageDistDirectories(root) {
  return PUBLIC_PACKAGES.map(({ workspaceDirectory }) =>
    resolve(root, 'packages', workspaceDirectory, 'dist'),
  );
}

export function cleanPublicPackageDistDirectories(root) {
  for (const directory of publicPackageDistDirectories(root)) {
    rmSync(directory, { force: true, recursive: true });
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  cleanPublicPackageDistDirectories(
    resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  );
}
