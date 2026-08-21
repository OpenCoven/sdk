import { existsSync, readFileSync } from 'node:fs';
import type * as FsPromisesModule from 'node:fs/promises';
import { resolve } from 'node:path';

import type { writeScaffoldFiles as WriteScaffoldFiles } from '@opencoven/dev-cli';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
  type OwnedTempDirectoryContext,
} from '../scripts/owned-temp-directory.mjs';

/**
 * Rollback of a write that failed *after* the file was created.
 *
 * The failures a scaffold meets in the wild -- a full disk, an I/O error --
 * land between the `wx` open and the write that follows it, which is a window
 * no fixture on a healthy filesystem can reach. These specs mock
 * `node:fs/promises` to open it deliberately. They live in their own file
 * because the mock is installed before the CLI is imported, and the rest of
 * the scaffold suite must keep the real filesystem.
 */

type FsPromises = typeof FsPromisesModule;
type CliModule = { writeScaffoldFiles: typeof WriteScaffoldFiles };

let context: OwnedTempDirectoryContext | undefined;
let actual: FsPromises;

function targetPath(...segments: string[]): string {
  if (context === undefined) {
    throw new Error('Owned temp directory was not created.');
  }

  return resolve(context.rootPath, ...segments);
}

const files = [
  { path: 'first.txt', contents: 'first\n' },
  { path: 'second.txt', contents: 'second\n' },
];

/** Install a `writeFile` that misbehaves on its `call`th invocation. */
async function mockWriteFile(
  call: number,
  misbehave: (path: string, options: Parameters<FsPromises['writeFile']>[2]) => Promise<void>,
): Promise<CliModule> {
  let calls = 0;

  vi.doMock('node:fs/promises', () => ({
    ...actual,
    writeFile: async (
      path: string,
      data: string,
      options: Parameters<FsPromises['writeFile']>[2],
    ): Promise<void> => {
      calls += 1;

      if (calls === call) {
        await misbehave(path, options);
      }

      return actual.writeFile(path, data, options);
    },
  }));

  return import('@opencoven/dev-cli');
}

beforeEach(async () => {
  context = createOwnedTempDirectory({ prefix: 'opencoven-scaffold-rollback' });
  actual = await vi.importActual<FsPromises>('node:fs/promises');
});

afterEach(() => {
  vi.doUnmock('node:fs/promises');
  vi.resetModules();

  if (context !== undefined) {
    cleanupOwnedTempRoot(context);
    context = undefined;
  }
});

describe('scaffold rollback', () => {
  test('removes the file the failed write had already created', async () => {
    const { writeScaffoldFiles } = await mockWriteFile(2, async (path, options) => {
      // The kernel has created the file by the time a write can fail on it, so
      // the rollback has to account for a path it never got to record.
      await actual.writeFile(path, '', options);

      const error: NodeJS.ErrnoException = new Error('ENOSPC: no space left on device');

      error.code = 'ENOSPC';
      throw error;
    });
    const directory = targetPath('app');

    await expect(writeScaffoldFiles(files, directory)).rejects.toThrow('ENOSPC');

    expect(existsSync(resolve(directory, 'first.txt'))).toBe(false);
    expect(existsSync(resolve(directory, 'second.txt'))).toBe(false);

    // The point of the rollback: the retry is not refused by the leftovers of
    // the run that failed.
    const retried = await writeScaffoldFiles(files, directory);

    expect(retried.files).toEqual(['first.txt', 'second.txt']);
    expect(readFileSync(resolve(directory, 'second.txt'), 'utf8')).toBe('second\n');
  });

  test('keeps a file that appeared between the conflict check and the write', async () => {
    const { writeScaffoldFiles } = await mockWriteFile(2, async (path) => {
      // Another process wins the race for this path. The real `wx` write that
      // follows is then refused by the kernel, with the file intact.
      await actual.writeFile(path, 'someone else\n', { encoding: 'utf8' });
    });
    const directory = targetPath('app');

    await expect(writeScaffoldFiles(files, directory)).rejects.toThrow('EEXIST');

    expect(existsSync(resolve(directory, 'first.txt'))).toBe(false);
    expect(readFileSync(resolve(directory, 'second.txt'), 'utf8')).toBe('someone else\n');
  });
});
