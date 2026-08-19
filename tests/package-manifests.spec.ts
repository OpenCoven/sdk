import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { CAVE_CLIENT_VERSION } from '@opencoven/cave-client';
import { DEV_CLI_VERSION } from '@opencoven/dev-cli';

import {
  CANONICAL_REPOSITORY_URL,
  PUBLIC_PACKAGES,
  assertCanonicalRepository,
} from '../scripts/repository-metadata.mjs';

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootManifest = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
  pnpm?: {
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
};

describe('public package manifests', () => {
  test('builds declaration files before typed linting in the full verifier', () => {
    expect(rootManifest.scripts?.verify).toMatch(
      /^corepack pnpm@10\.34\.0 build && corepack pnpm@10\.34\.0 lint/,
    );
  });

  test('keeps every package unpublished until an intentional release change', () => {
    expect(rootManifest.pnpm?.overrides?.esbuild).toBe('0.28.1');

    for (const { manifestPath } of PUBLIC_PACKAGES) {
      const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, manifestPath), 'utf8')) as {
        private?: boolean;
        scripts?: Record<string, string>;
      };

      expect(manifest.private).toBe(true);
      expect(manifest.scripts?.prepublishOnly).toBe(
        'node ../../scripts/require-release-authorization.mjs',
      );
    }
  });

  test('declare only root exports and approved package metadata', () => {
    const versions = new Set<string>();

    for (const { packageName, manifestPath, repositoryDirectory } of PUBLIC_PACKAGES) {
      const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, manifestPath), 'utf8')) as {
        dependencies?: Record<string, string>;
        name: string;
        exports: Record<string, unknown>;
        license?: string;
        version?: string;
        engines?: {
          node?: string;
        };
        repository?: unknown;
      };

      expect(manifest.name).toBe(packageName);
      expect(Object.keys(manifest.exports)).toEqual(['.', './package.json']);
      expect(manifest.license).toBe('AGPL-3.0-or-later OR MIT');
      expect(manifest.version).toBe('0.1.0');
      versions.add(manifest.version ?? '');
      expect(manifest.engines?.node).toBe('>=24.18.0 <25');
      expect(assertCanonicalRepository(manifest, repositoryDirectory, packageName)).toEqual({
        type: 'git',
        url: CANONICAL_REPOSITORY_URL,
        directory: repositoryDirectory,
      });

      for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
        if (dependency.startsWith('@opencoven/')) {
          expect(range).toBe(`workspace:${manifest.version}`);
        }
      }
    }

    expect(versions).toEqual(new Set(['0.1.0']));
  });

  test('derives exported runtime versions from package manifests', () => {
    const caveManifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'packages/cave/package.json'), 'utf8'),
    ) as { version: string };
    const cliManifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'packages/cli/package.json'), 'utf8'),
    ) as { version: string };

    expect(CAVE_CLIENT_VERSION).toBe(caveManifest.version);
    expect(DEV_CLI_VERSION).toBe(cliManifest.version);
  });

  test('assigns the opencoven binary only to @opencoven/dev-cli', () => {
    const owners = PUBLIC_PACKAGES.flatMap(({ packageName, manifestPath }) => {
      const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, manifestPath), 'utf8')) as {
        bin?: string | Record<string, string>;
      };

      if (typeof manifest.bin === 'string') {
        return [`${packageName}:default`];
      }

      return manifest.bin?.opencoven ? [packageName] : [];
    });

    expect(owners).toEqual(['@opencoven/dev-cli']);
  });

  test('rejects missing or local repository URLs', () => {
    expect(() =>
      assertCanonicalRepository({}, 'packages/core', '@opencoven/sdk-core'),
    ).toThrow('missing repository metadata');
    expect(() =>
      assertCanonicalRepository(
        {
          repository: {
            type: 'git',
            url: 'file:///Users/example/OpenCoven/sdk.git',
            directory: 'packages/core',
          },
        },
        'packages/core',
        '@opencoven/sdk-core',
      ),
    ).toThrow('must not use a local file URL');
  });
});
