import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [resolve(workspaceRoot, 'packages'), resolve(workspaceRoot, 'examples')];
const ignoredDirectoryNames = new Set(['.artifacts', 'coverage', 'dist', 'generated', 'node_modules', 'vendor']);

function collectTypeScriptFiles(root: string): string[] {
  const entries = readdirSync(root).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(root, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      if (ignoredDirectoryNames.has(entry) || entry.startsWith('.')) {
        continue;
      }

      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }

    if (extname(entryPath) === '.ts') {
      files.push(entryPath);
    }
  }

  return files;
}

function getPackageRoot(file: string): string {
  const marker = file.includes('/packages/') ? '/packages/' : '/examples/';
  const markerStart = file.indexOf(marker);
  const packageNameStart = markerStart + marker.length;
  const packageNameEnd = file.indexOf('/', packageNameStart);

  return file.slice(0, packageNameEnd);
}

describe('workspace package boundaries', () => {
  test('do not deep import other package src or dist directories', () => {
    const files = roots.flatMap((root) => collectTypeScriptFiles(root));
    const offenders: string[] = [];

    expect(files.some((file) => file.includes('/dist/') || file.includes('/node_modules/'))).toBe(false);

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const packageRoot = getPackageRoot(file);
      const importPattern = /(?:from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"])/g;
      let match: RegExpExecArray | null = importPattern.exec(content);

      while (match) {
        const specifier = match[1] ?? match[2];

        if (!specifier) {
          match = importPattern.exec(content);
          continue;
        }

        if (specifier.startsWith('@opencoven/') && /(\/src\/|\/dist\/)/.test(specifier)) {
          offenders.push(`${file}: ${specifier}`);
        } else if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);

          if (target.includes('/packages/') && !target.startsWith(packageRoot)) {
            offenders.push(`${file}: ${specifier}`);
          }
        }

        match = importPattern.exec(content);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('skips vendor, generated, dist, and node_modules directories while collecting workspace files', () => {
    const fixtureRoot = resolve(
      workspaceRoot,
      'tests',
      'fixtures',
      'package-boundaries',
      'workspace',
      'packages',
      'demo',
    );
    const files = collectTypeScriptFiles(fixtureRoot)
      .map((file) => file.replace(`${fixtureRoot}/`, ''))
      .sort();

    expect(files).toEqual(['src/index.ts', 'test/demo-fixture.ts', 'tsup.config.ts']);
  });
});
