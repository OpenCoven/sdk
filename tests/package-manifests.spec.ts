import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { CAVE_CLIENT_VERSION } from '@opencoven/cave-client';
import { DEV_CLI_VERSION } from '@opencoven/dev-cli';

import {
  CANONICAL_REPOSITORY_URL,
  PUBLIC_PACKAGES,
  WORKSPACE_PACKAGES,
  assertCanonicalRepository,
} from '../scripts/repository-metadata.mjs';

/**
 * An exact version: a SemVer 2.0.0 string with no range operator in front of
 * it. This is the grammar from semver.org rather than an approximation of it --
 * a looser \\d+ core would accept 01.2.3, which is not a version, and reject
 * 1.2.3+build.4, which is.
 *
 * The pins below are asserted by shape rather than by value. What these tests
 * are protecting is that the versions are *pinned* -- a `^` or `~` would let a
 * resolution drift between runs, which is the opposite of the determinism the
 * stress and release checks depend on. The particular number is not the
 * invariant, and hard-coding it meant every dependency bump failed a test that
 * had no opinion about the new version, only about the old one.
 */
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootManifest = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  pnpm?: {
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
};
const vitestConfig = readFileSync(resolve(workspaceRoot, 'vitest.config.ts'), 'utf8');
const lockfile = readFileSync(resolve(workspaceRoot, 'pnpm-lock.yaml'), 'utf8');
const ROOT_PACKAGE_EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  },
  './package.json': './package.json',
} as const;

function expectedPackageExports(workspaceDirectory: string) {
  return {
    ...ROOT_PACKAGE_EXPORTS,
    ...(workspaceDirectory === 'core'
      ? {
          './browser': {
            types: './dist/browser.d.ts',
            import: './dist/browser.js',
            default: './dist/browser.js',
          },
        }
      : {}),
    ...(workspaceDirectory === 'cave'
      ? {
          './managed': {
            types: './dist/managed.d.ts',
            import: './dist/managed.js',
            default: './dist/managed.js',
          },
        }
      : {}),
  };
}
const EXPECTED_WORKSPACE_DEPENDENCIES = {
  core: {},
  cave: {
    '@hpke/core': '1.9.0',
    '@hpke/dhkem-x25519': '1.8.0',
    '@opencoven/sdk-core': 'workspace:0.1.0',
    canonicalize: '3.0.0',
  },
  coven: {
    '@opencoven/sdk-core': 'workspace:0.1.0',
  },
  sdk: {
    '@opencoven/cave-client': 'workspace:0.1.0',
    '@opencoven/coven-client': 'workspace:0.1.0',
    '@opencoven/sdk-core': 'workspace:0.1.0',
  },
  cli: {
    '@napi-rs/keyring': '1.3.0',
    '@opencoven/cave-client': 'workspace:0.1.0',
    '@opencoven/coven-client': 'workspace:0.1.0',
    '@opencoven/sdk-core': 'workspace:0.1.0',
  },
} as const;

describe('workspace package manifests', () => {
  test('keeps the private CLI outside the four-package 0.1 release inventory', () => {
    expect(PUBLIC_PACKAGES.map(({ packageName }) => packageName)).toEqual([
      '@opencoven/sdk-core',
      '@opencoven/cave-client',
      '@opencoven/coven-client',
      '@opencoven/sdk',
    ]);
    expect(WORKSPACE_PACKAGES.map(({ packageName }) => packageName)).toEqual([
      '@opencoven/sdk-core',
      '@opencoven/cave-client',
      '@opencoven/coven-client',
      '@opencoven/sdk',
      '@opencoven/dev-cli',
    ]);

    const cliManifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'packages/cli/package.json'), 'utf8'),
    ) as { private?: boolean };

    expect(cliManifest.private).toBe(true);
  });

  test('runs the clean Phase 0 matrix before the remaining full verification', () => {
    expect(rootManifest.scripts?.verify).toBe(
      'corepack pnpm@10.34.0 typecheck && corepack pnpm@10.34.0 clean:public-dist && corepack pnpm@10.34.0 test && corepack pnpm@10.34.0 verify:contracts && corepack pnpm@10.34.0 verify:package && corepack pnpm@10.34.0 verify:release && corepack pnpm@10.34.0 test:coverage && corepack pnpm@10.34.0 test:stress && corepack pnpm@10.34.0 lint',
    );
  });

  test('enforces source coverage in the canonical verifier', () => {
    expect(rootManifest.scripts?.['test:coverage']).toBe('vitest run --coverage');
    expect(rootManifest.scripts?.verify).toContain('corepack pnpm@10.34.0 test:coverage');
    expect(rootManifest.devDependencies?.['@vitest/coverage-v8']).toBe(
      rootManifest.devDependencies?.vitest,
    );
    expect(vitestConfig).toContain("'packages/coven/src/discovery.ts':");
    expect(vitestConfig).toContain("'packages/coven/src/transport-unix.ts':");
    expect(vitestConfig).toContain("'packages/coven/src/transport-windows.ts':");
  });

  test('keeps the typings on the runtime this ships for', () => {
    // @types/node describes the runtime the code is compiled against. A major
    // ahead of engines.node accepts APIs that do not exist where this ships,
    // and typechecks cleanly while doing it -- the failure arrives at runtime,
    // on the version the release config says is supported.
    //
    // This is asserted rather than left to the Dependabot ignore rule beside
    // it, because an ignore rule is a request and this is a requirement: a
    // hand-edited bump would sail past the config and be caught here.
    const releaseConfig = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'release.config.json'), 'utf8'),
    ) as { supportedNode?: { major?: number } };

    const typesVersion = rootManifest.devDependencies?.['@types/node'];

    expect(typesVersion).toMatch(EXACT_VERSION);
    expect(
      Number(String(typesVersion).split('.')[0]),
      '@types/node must track release.config.json supportedNode.major',
    ).toBe(releaseConfig.supportedNode?.major);

    // And the engines range must span that major and no other. Checking only
    // the lower bound accepted ">=24.18.0 <26", which covers two majors while
    // reading as though it pinned one.
    const major = releaseConfig.supportedNode?.major;

    expect(rootManifest.engines?.node, 'engines.node must span exactly one major').toMatch(
      new RegExp(`^>=${major}\\.\\d+\\.\\d+ <${Number(major) + 1}$`),
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
    const changesetConfig = JSON.parse(
      readFileSync(resolve(workspaceRoot, '.changeset/config.json'), 'utf8'),
    ) as { fixed?: string[][] };

    expect(changesetConfig.fixed).toEqual([
      PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    ]);

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
  }, 15_000);

  test('verifies the release contract and artifacts on the compatibility path', () => {
    expect(rootManifest.scripts?.['verify:compat']).toBe(
      'corepack pnpm@10.34.0 typecheck && corepack pnpm@10.34.0 test && corepack pnpm@10.34.0 verify:release && corepack pnpm@10.34.0 verify:package',
    );
    expect(rootManifest.scripts?.['verify:compat']).toContain('verify:release');
    expect(rootManifest.scripts?.['verify:compat']).toMatch(
      /verify:release.*verify:package/,
    );
  });

  test('serializes package-mutating test files to protect build outputs', () => {
    expect(vitestConfig).toContain('fileParallelism: false');
  });

  test('keeps every release package unpublished until an intentional release change', () => {
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

  test('pins the CLI native keyring dependency directly and in the lockfile', () => {
    const cliManifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'packages/cli/package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(cliManifest.dependencies?.['@napi-rs/keyring']).toBe('1.3.0');
    expect(cliManifest.optionalDependencies?.['@napi-rs/keyring']).toBeUndefined();
    expect(lockfile).toMatch(/['"]@napi-rs\/keyring['"]:/);
    expect(lockfile).toContain('specifier: 1.3.0');
    expect(lockfile).toContain("'@napi-rs/keyring@1.3.0':");
    expect(lockfile).toMatch(/optionalDependencies:\n(?:\s+'@napi-rs\/keyring-[^']+': 1\.3\.0\n)+/);
  });

  test('declare exact root export maps, dependencies, and approved package metadata', () => {
    const versions = new Set<string>();

    const publicPackageNames = new Set(PUBLIC_PACKAGES.map(({ packageName }) => packageName));

    for (const { packageName, manifestPath, repositoryDirectory, workspaceDirectory } of WORKSPACE_PACKAGES) {
      const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, manifestPath), 'utf8')) as {
        dependencies?: Record<string, string>;
        name: string;
        exports: Record<string, unknown>;
        main?: string;
        types?: string;
        license?: string;
        version?: string;
        sideEffects?: boolean;
        engines?: {
          node?: string;
        };
        repository?: unknown;
      };
      const expectedDependencies =
        EXPECTED_WORKSPACE_DEPENDENCIES[
          workspaceDirectory as keyof typeof EXPECTED_WORKSPACE_DEPENDENCIES
        ];

      expect(manifest.name).toBe(packageName);
      expect(manifest.main).toBe('./dist/index.js');
      expect(manifest.types).toBe('./dist/index.d.ts');
      expect(manifest.sideEffects).toBe(false);
      expect(manifest.exports).toEqual(expectedPackageExports(workspaceDirectory));
      expect(manifest.dependencies ?? {}).toEqual(expectedDependencies);
      expect(manifest.license).toBe('AGPL-3.0-only OR MIT');
      expect(manifest.version).toBe('0.1.0');
      if (publicPackageNames.has(packageName)) {
        versions.add(manifest.version ?? '');
      }
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
    for (const { workspaceDirectory } of WORKSPACE_PACKAGES) {
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
    const owners = WORKSPACE_PACKAGES.flatMap(({ packageName, manifestPath }) => {
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
