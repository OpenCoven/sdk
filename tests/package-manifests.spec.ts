import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicPackages = [
  ['@opencoven/sdk-core', 'packages/core/package.json'],
  ['@opencoven/cave-client', 'packages/cave/package.json'],
  ['@opencoven/coven-client', 'packages/coven/package.json'],
  ['@opencoven/sdk', 'packages/sdk/package.json'],
  ['@opencoven/dev-cli', 'packages/cli/package.json'],
] as const;

describe('public package manifests', () => {
  test('declare only root exports and approved package metadata', () => {
    for (const [name, relativePath] of publicPackages) {
      const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), 'utf8')) as {
        name: string;
        exports: Record<string, unknown>;
        license?: string;
        version?: string;
        engines?: {
          node?: string;
        };
      };

      expect(manifest.name).toBe(name);
      expect(Object.keys(manifest.exports)).toEqual(['.', './package.json']);
      expect(manifest.license).toBe('AGPL-3.0-or-later OR MIT');
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.engines?.node).toBe('>=24.18.0 <25');
    }
  });

  test('assigns the opencoven binary only to @opencoven/dev-cli', () => {
    const owners = publicPackages.flatMap(([name, relativePath]) => {
      const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), 'utf8')) as {
        bin?: string | Record<string, string>;
      };

      if (typeof manifest.bin === 'string') {
        return [`${name}:default`];
      }

      return manifest.bin?.opencoven ? [name] : [];
    });

    expect(owners).toEqual(['@opencoven/dev-cli']);
  });
});
