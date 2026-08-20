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

/**
 * An exact version: a bare semver with no range operator in front of it.
 *
 * The pins below are asserted by shape rather than by value. What these tests
 * are protecting is that the versions are *pinned* -- a `^` or `~` would let a
 * resolution drift between runs, which is the opposite of the determinism the
 * stress and release checks depend on. The particular number is not the
 * invariant, and hard-coding it meant every dependency bump failed a test that
 * had no opinion about the new version, only about the old one.
 */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootManifest = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
};
const vitestConfig = readFileSync(resolve(workspaceRoot, 'vitest.config.ts'), 'utf8');

describe('public package manifests', () => {
  test('builds declaration files before typed linting in the full verifier', () => {
    expect(rootManifest.scripts?.verify).toMatch(
      /^corepack pnpm@10\.34\.0 build && corepack pnpm@10\.34\.0 lint/,
    );
  });

  test('enforces source coverage in the canonical verifier', () => {
    expect(rootManifest.scripts?.['test:coverage']).toBe('vitest run --coverage');
    expect(rootManifest.scripts?.verify).toContain('corepack pnpm@10.34.0 test:coverage');
    expect(rootManifest.devDependencies?.['@vitest/coverage-v8']).toBe(
      rootManifest.devDependencies?.vitest,
    );
  });

  test('runs deterministic multi-seed operation stress verification', () => {
    expect(rootManifest.devDependencies?.['fast-check']).toMatch(EXACT_VERSION);
    expect(rootManifest.scripts?.['test:stress']).toBe(
      'node ./scripts/run-operation-stress.mjs',
    );
    expect(rootManifest.scripts?.verify).toContain(
      'corepack pnpm@10.34.0 test:stress',
    );
  });

  test('uses fixed-version Changesets and packs package changelogs', () => {
    expect(rootManifest.devDependencies?.['@changesets/cli']).toMatch(EXACT_VERSION);
    expect(rootManifest.scripts?.changeset).toBe('changeset');
    expect(rootManifest.scripts?.['release:status']).toBe('changeset status');
    expect(rootManifest.scripts?.['release:version']).toBe('changeset version');

    for (const { manifestPath, workspaceDirectory } of PUBLIC_PACKAGES) {
      const manifest = JSON.parse(
        readFileSync(resolve(workspaceRoot, manifestPath), 'utf8'),
      ) as { files?: string[] };
      const changelog = readFileSync(
        resolve(workspaceRoot, 'packages', workspaceDirectory, 'CHANGELOG.md'),
        'utf8',
      );

      expect(manifest.files).toContain('CHANGELOG.md');
      expect(changelog).toContain('## 0.1.0');
    }
  });

  test('verifies the release contract and artifacts on the compatibility path', () => {
    expect(rootManifest.scripts?.['verify:compat']).toContain('verify:release');
    expect(rootManifest.scripts?.['verify:compat']).toMatch(
      /verify:release.*verify:package/,
    );
  });

  test('serializes package-mutating test files to protect build outputs', () => {
    expect(vitestConfig).toContain('fileParallelism: false');
  });

  test('keeps every package unpublished until an intentional release change', () => {
    expect(rootManifest.pnpm?.overrides?.esbuild).toMatch(EXACT_VERSION);

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
      expect(manifest.license).toBe('AGPL-3.0-only OR MIT');
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

  test('uses the exact approved license components in every package selector', () => {
    for (const { workspaceDirectory } of PUBLIC_PACKAGES) {
      const selector = readFileSync(
        resolve(workspaceRoot, 'packages', workspaceDirectory, 'LICENSE'),
        'utf8',
      );
      const components = [...selector.matchAll(/\(([^()\r\n]+)\), see \[LICENSE-[^\]]+\]/g)].map(
        (match) => match[1],
      );

      expect(components).toEqual(['AGPL-3.0-only', 'MIT']);
    }
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
