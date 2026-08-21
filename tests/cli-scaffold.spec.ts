import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SCAFFOLD_TEMPLATES,
  ScaffoldOverwriteError,
  ScaffoldPathError,
  assertSafeScaffoldPath,
  createScaffoldFiles,
  describeScaffoldTemplate,
  isScaffoldTemplate,
  runCli,
  writeScaffoldFiles,
} from '@opencoven/dev-cli';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
  type OwnedTempDirectoryContext,
} from '../scripts/owned-temp-directory.mjs';

let context: OwnedTempDirectoryContext | undefined;

function targetPath(...segments: string[]): string {
  if (context === undefined) {
    throw new Error('Owned temp directory was not created.');
  }

  return resolve(context.rootPath, ...segments);
}

beforeEach(() => {
  context = createOwnedTempDirectory({ prefix: 'opencoven-scaffold-spec' });
});

afterEach(() => {
  if (context !== undefined) {
    cleanupOwnedTempRoot(context);
    context = undefined;
  }
});

describe('scaffold templates', () => {
  test('supports exactly the three documented templates', () => {
    expect([...SCAFFOLD_TEMPLATES]).toEqual(['cave-chat', 'coven-observer', 'unified-status']);
    expect(isScaffoldTemplate('cave-chat')).toBe(true);
    expect(isScaffoldTemplate('cave-chatty')).toBe(false);
  });

  test.each(SCAFFOLD_TEMPLATES)('%s generates a buildable package', (template) => {
    const files = createScaffoldFiles(template);

    expect(files.map((file) => file.path)).toEqual([
      '.gitignore',
      'README.md',
      'package.json',
      'src/index.ts',
      'tsconfig.json',
    ]);

    const manifest = JSON.parse(
      files.find((file) => file.path === 'package.json')?.contents ?? '{}',
    ) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.name).toBe(`opencoven-${template}`);
    expect(manifest.scripts.build).toBe('tsc --pretty false');
    expect(manifest.scripts.start).toBe('node dist/index.js');
    expect(Object.keys(manifest.dependencies).length).toBeGreaterThan(0);

    for (const range of Object.values(manifest.dependencies)) {
      expect(range).toBe('0.1.0');
    }

    expect(manifest.devDependencies.typescript).toBe('6.0.3');
    expect(describeScaffoldTemplate(template).length).toBeGreaterThan(0);
  });

  test.each(SCAFFOLD_TEMPLATES)('%s documents the v1 browser limitation', (template) => {
    const readme = createScaffoldFiles(template).find((file) => file.path === 'README.md');

    expect(readme?.contents).toContain('A browser cannot connect to Cave or Coven directly in v1');
    expect(readme?.contents).toContain('are not published');
  });

  test('generates identical bytes on every call', () => {
    expect(createScaffoldFiles('unified-status')).toEqual(createScaffoldFiles('unified-status'));
  });
});

describe('scaffold paths', () => {
  test('accepts a relative path and a dotfile', () => {
    expect(() => {
      assertSafeScaffoldPath('src/index.ts');
    }).not.toThrow();
    expect(() => {
      assertSafeScaffoldPath('.gitignore');
    }).not.toThrow();
  });

  test.each([
    ['', 'is empty'],
    ['/etc/passwd', 'must be relative'],
    ['C:/Windows/system32', 'must be relative'],
    ['src\\index.ts', 'must be relative'],
    ['../outside.ts', 'unsupported segment'],
    ['src/./index.ts', 'unsupported segment'],
    ['src/a b.ts', 'unsupported segment'],
  ])('rejects %s', (path, reason) => {
    expect(() => {
      assertSafeScaffoldPath(path);
    }).toThrow(reason);
  });

  test('refuses to write a file whose path escapes the target directory', async () => {
    await expect(
      writeScaffoldFiles([{ path: '../escaped.ts', contents: '' }], targetPath('app')),
    ).rejects.toBeInstanceOf(ScaffoldPathError);

    expect(readdirSync(targetPath())).not.toContain('escaped.ts');
  });
});

describe('scaffold writing', () => {
  test('writes every declared file under the target directory', async () => {
    const directory = targetPath('app');
    const written = await writeScaffoldFiles(createScaffoldFiles('cave-chat'), directory);

    expect(written.directory).toBe(directory);
    expect(written.files).toEqual([
      '.gitignore',
      'README.md',
      'package.json',
      'src/index.ts',
      'tsconfig.json',
    ]);
    expect(readFileSync(resolve(directory, 'src/index.ts'), 'utf8')).toContain('CaveClient');
  });

  test('refuses to overwrite, naming every conflict, and leaves the file untouched', async () => {
    const directory = targetPath('app');

    await writeScaffoldFiles(createScaffoldFiles('cave-chat'), directory);
    writeFileSync(resolve(directory, 'src/index.ts'), 'my own work\n');

    const failure: unknown = await writeScaffoldFiles(
      createScaffoldFiles('cave-chat'),
      directory,
    ).catch((error: unknown) => error);

    if (!(failure instanceof ScaffoldOverwriteError)) {
      throw new TypeError('Expected ScaffoldOverwriteError.');
    }

    expect(failure.conflicts).toEqual([
      '.gitignore',
      'README.md',
      'package.json',
      'src/index.ts',
      'tsconfig.json',
    ]);
    expect(failure.message).toContain('pass --force');
    expect(readFileSync(resolve(directory, 'src/index.ts'), 'utf8')).toBe('my own work\n');
  });

  test('overwrites only when force is given', async () => {
    const directory = targetPath('app');

    await writeScaffoldFiles(createScaffoldFiles('cave-chat'), directory);
    writeFileSync(resolve(directory, 'src/index.ts'), 'my own work\n');
    await writeScaffoldFiles(createScaffoldFiles('cave-chat'), directory, { force: true });

    expect(readFileSync(resolve(directory, 'src/index.ts'), 'utf8')).toContain('CaveClient');
  });

  test('reports a single conflict in the singular', async () => {
    const directory = targetPath('app');
    const files = createScaffoldFiles('cave-chat').slice(0, 1);

    await writeScaffoldFiles(files, directory);

    await expect(writeScaffoldFiles(files, directory)).rejects.toThrow(
      'Refusing to overwrite existing file: .gitignore',
    );
  });
});

describe('opencoven scaffold command', () => {
  test('creates a template and reports what it wrote', async () => {
    const directory = targetPath('app');
    const result = await runCli(['--json', 'scaffold', 'unified-status', directory]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'scaffold',
      data: {
        template: 'unified-status',
        directory,
        files: ['.gitignore', 'README.md', 'package.json', 'src/index.ts', 'tsconfig.json'],
      },
      ok: true,
    });
    expect(readdirSync(directory).sort()).toEqual([
      '.gitignore',
      'README.md',
      'package.json',
      'src',
      'tsconfig.json',
    ]);
  });

  test('names the created files in human output', async () => {
    const directory = targetPath('app');
    const result = await runCli(['scaffold', 'coven-observer', directory]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Created opencoven-coven-observer in');
    expect(result.stdout).toContain('  src/index.ts');
  });

  test('refuses a second run and succeeds with --force', async () => {
    const directory = targetPath('app');

    await runCli(['scaffold', 'cave-chat', directory]);

    const refused = await runCli(['--json', 'scaffold', 'cave-chat', directory]);

    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({
      command: 'scaffold',
      error: { code: 'scaffold_conflict' },
      ok: false,
    });

    const forced = await runCli(['scaffold', 'cave-chat', directory, '--force']);

    expect(forced.exitCode).toBe(0);
  });

  test('names the supported templates when one is missing or unknown', async () => {
    const missing = await runCli(['scaffold']);

    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toBe(
      'Specify a template: cave-chat, coven-observer, unified-status.\n',
    );

    const unknown = await runCli(['--json', 'scaffold', 'cave-chatty', targetPath('app')]);

    expect(unknown.exitCode).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({
      command: 'scaffold',
      error: { code: 'unknown_template' },
      ok: false,
    });
  });

  test('requires a target directory rather than guessing one', async () => {
    const result = await runCli(['--json', 'scaffold', 'cave-chat']);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'scaffold',
      error: {
        code: 'missing_directory',
        message: 'Specify a target directory: opencoven scaffold cave-chat <directory>.',
      },
      ok: false,
    });
    expect(readdirSync(targetPath())).toEqual(['.opencoven-owned-temp']);
  });
});
