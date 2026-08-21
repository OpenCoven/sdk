import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { ScaffoldFile } from './scaffolds.js';

/**
 * Writing a scaffold to disk.
 *
 * Two rules, in this order. A path must be a plain relative path under the
 * target directory, checked before anything is created, so a template can never
 * write outside where the caller pointed it. And an existing file is refused
 * rather than replaced -- a scaffold is run against directories that already
 * hold work, and silently overwriting a `src/index.ts` someone had edited is the
 * one failure a generator must not have.
 *
 * The refusal is enforced twice: once up front so the message can name every
 * conflict at once, and again by opening each file with `wx` so a file that
 * appears between the check and the write is refused by the kernel rather than
 * clobbered.
 */

/**
 * A dotfile is a legitimate scaffold member, so a leading dot is allowed; `.`
 * and `..` are not, which is what keeps a path inside the target directory.
 */
const SEGMENT_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

export class ScaffoldPathError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Scaffold path "${path}" ${reason}.`);
    this.name = 'ScaffoldPathError';
    this.path = path;
  }
}

export class ScaffoldOverwriteError extends Error {
  readonly conflicts: readonly string[];

  constructor(conflicts: readonly string[]) {
    super(
      `Refusing to overwrite existing ${conflicts.length === 1 ? 'file' : 'files'}: ${conflicts.join(
        ', ',
      )}. Choose an empty directory, or pass --force.`,
    );
    this.name = 'ScaffoldOverwriteError';
    this.conflicts = conflicts;
  }
}

export interface WriteScaffoldOptions {
  force?: boolean;
}

/** Reject anything that is not a plain relative path made of safe segments. */
export function assertSafeScaffoldPath(path: string): void {
  if (path.length === 0) {
    throw new ScaffoldPathError(path, 'is empty');
  }

  if (isAbsolute(path) || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
    throw new ScaffoldPathError(path, 'must be relative and use "/" separators');
  }

  for (const segment of path.split('/')) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new ScaffoldPathError(path, `contains an unsupported segment "${segment}"`);
    }
  }
}

async function findConflicts(
  targetDirectory: string,
  files: readonly ScaffoldFile[],
): Promise<string[]> {
  const { stat } = await import('node:fs/promises');
  const conflicts: string[] = [];

  for (const file of files) {
    try {
      await stat(join(targetDirectory, file.path));
      conflicts.push(file.path);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  return conflicts;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export interface WrittenScaffold {
  /** The resolved target directory. */
  directory: string;
  /** Relative paths written, in the order the template declares them. */
  files: string[];
}

/**
 * Undo a partial write.
 *
 * A cleanup failure is swallowed: the error that caused the rollback is the one
 * the caller needs, and replacing it with an error about tidying up would hide
 * the actual fault. Directories created along the way are left behind, which
 * costs nothing -- conflicts are judged per file, so an empty directory does not
 * refuse the retry.
 */
async function removeWrittenFiles(directory: string, written: readonly string[]): Promise<void> {
  const { rm } = await import('node:fs/promises');

  for (const path of written) {
    try {
      await rm(join(directory, path), { force: true });
    } catch {
      continue;
    }
  }
}

/**
 * Write every file, or leave the directory as it was found.
 *
 * Without the rollback a write that died partway through left a half-scaffold
 * whose retry then failed with a conflict on the files the failed run had
 * already created -- the generator refusing to finish what it started.
 *
 * Rollback runs only when the write was refusing overwrites, because that is the
 * only case in which every file written is known to be new. Under `force` a
 * partial write stays: some of those files existed beforehand, and deleting them
 * to tidy up a failure would destroy the caller's originals, which is worse than
 * the half-written tree.
 */
export async function writeScaffoldFiles(
  files: readonly ScaffoldFile[],
  targetDirectory: string,
  options: WriteScaffoldOptions = {},
): Promise<WrittenScaffold> {
  for (const file of files) {
    assertSafeScaffoldPath(file.path);
  }

  const directory = resolve(targetDirectory);
  const refusesOverwrite = options.force !== true;

  if (refusesOverwrite) {
    const conflicts = await findConflicts(directory, files);

    if (conflicts.length > 0) {
      throw new ScaffoldOverwriteError(conflicts);
    }
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  const written: string[] = [];

  await mkdir(directory, { recursive: true });

  try {
    for (const file of files) {
      const destination = join(directory, file.path);

      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.contents, {
        encoding: 'utf8',
        flag: refusesOverwrite ? 'wx' : 'w',
      });
      written.push(file.path);
    }
  } catch (error) {
    if (refusesOverwrite) {
      await removeWrittenFiles(directory, written);
    }

    throw error;
  }

  return { directory, files: written };
}
