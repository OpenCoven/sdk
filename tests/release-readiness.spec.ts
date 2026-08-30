import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import {
  readReleaseConfig,
  validateReleaseReadiness,
} from '../scripts/release-readiness.mjs';
import type {
  NativeConformancePlatforms,
  ReleaseConfig,
} from '../scripts/release-readiness.d.mts';
import { createReleaseArtifacts } from '../scripts/create-release-artifacts.mjs';
import {
  createNpmPublishArgs,
  publishReleaseArtifacts,
} from '../scripts/publish-release-artifacts.mjs';
import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures: string[] = [];
const artifactRoots: string[] = [];

interface MutablePackageManifest {
  dependencies: Record<string, string>;
  engines: {
    node: string;
  };
  private: boolean;
  version: string;
}

type MutableReleaseConfig = Omit<
  ReleaseConfig,
  | 'githubEnvironment'
  | 'nativeConformancePlatforms'
  | 'npmAccess'
  | 'npmDistTag'
  | 'packages'
  | 'schemaVersion'
  | 'supportedNode'
  | 'tagPrefix'
> & {
  githubEnvironment: string;
  npmAccess: string;
  npmDistTag: string;
  packages: string[];
  publishingEnabled: boolean;
  schemaVersion: number;
  supportedNode: {
    major: number;
    minimum: string;
  };
  nativeConformancePlatforms?: string[];
  tagPrefix: string;
  unexpected?: boolean;
};

type MutableReleaseConfigMissingRequiredField = Omit<
  MutableReleaseConfig,
  'nativeConformancePlatforms' | 'tagPrefix'
> & {
  nativeConformancePlatforms?: string[];
  tagPrefix?: string;
};

const SUPPORTED_PLATFORMS: NativeConformancePlatforms = [
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
];
const SUBSTITUTED_PLATFORM_MATRIX: MutableReleaseConfig['nativeConformancePlatforms'] = [
  'darwin-arm64',
  'linux-arm64',
  'win32-x64',
];
const REORDERED_PLATFORM_MATRIX: MutableReleaseConfig['nativeConformancePlatforms'] = [
  'win32-x64',
  'linux-x64',
  'darwin-arm64',
];
const MISSING_PLATFORM_MATRIX: MutableReleaseConfig['nativeConformancePlatforms'] = [
  'darwin-arm64',
  'linux-x64',
];
const DUPLICATE_PLATFORM_MATRIX: MutableReleaseConfig['nativeConformancePlatforms'] = [
  'darwin-arm64',
  'linux-x64',
  'linux-x64',
];
const EXTRA_PLATFORM_MATRIX: MutableReleaseConfig['nativeConformancePlatforms'] = [
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
  'linux-arm64',
];

function createReleaseFixture(): string {
  const fixture = mkdtempSync(resolve(tmpdir(), 'opencoven-release-readiness-'));
  fixtures.push(fixture);

  cpSync(
    resolve(workspaceRoot, 'release.config.json'),
    resolve(fixture, 'release.config.json'),
  );
  mkdirSync(resolve(fixture, '.github/workflows'), { recursive: true });
  cpSync(
    resolve(workspaceRoot, '.github/workflows/release.yml'),
    resolve(fixture, '.github/workflows/release.yml'),
  );

  for (const packageMetadata of PUBLIC_PACKAGES) {
    const sourceDirectory = resolve(
      workspaceRoot,
      'packages',
      packageMetadata.workspaceDirectory,
    );
    const fixtureDirectory = resolve(
      fixture,
      'packages',
      packageMetadata.workspaceDirectory,
    );
    cpSync(sourceDirectory, fixtureDirectory, {
      recursive: true,
      filter(source) {
        return (
          source === sourceDirectory ||
          source.endsWith('package.json') ||
          source.endsWith('CHANGELOG.md')
        );
      },
    });
  }

  return fixture;
}

function updateJson<T extends object>(path: string, update: (value: T) => void): void {
  const value = JSON.parse(readFileSync(path, 'utf8')) as T;
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
  for (const artifactRoot of artifactRoots.splice(0)) {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

function createUnlockedArtifactRoot(): string {
  const outputRoot = mkdtempSync(
    resolve(tmpdir(), 'opencoven-release-readiness-unlock-'),
  );
  artifactRoots.push(outputRoot);
  createReleaseArtifacts({
    root: workspaceRoot,
    outputRoot,
    build: false,
  });
  return outputRoot;
}

describe('release readiness contract', () => {
  test('reflects the reviewed unlock of the repository publication lock', () => {
    const config = readReleaseConfig(workspaceRoot);

    // The 0.1.0 release-unlock change opens the repository lock deliberately.
    // Publication still requires the second, independent deployment lock: the
    // protected `npm-release` environment approval, reached only through the
    // release workflow's tag-verified publish job.
    expect(config.publishingEnabled).toBe(true);
    expect(
      validateReleaseReadiness({
        root: workspaceRoot,
        mode: 'publish',
        version: '0.1.0',
        tag: 'sdk-v0.1.0',
      }),
    ).toEqual({
      version: '0.1.0',
      publishingEnabled: true,
      packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    });
  });

  test('requires fixed versions and exact internal ranges', () => {
    const fixture = createReleaseFixture();
    const manifestPath = resolve(fixture, 'packages/sdk/package.json');
    updateJson<MutablePackageManifest>(manifestPath, (manifest) => {
      manifest.dependencies['@opencoven/sdk-core'] = 'workspace:*';
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      '@opencoven/sdk dependency @opencoven/sdk-core must be workspace:0.1.0',
    );
  });

  test('rejects version and tag disagreement', () => {
    expect(() =>
      validateReleaseReadiness({
        root: workspaceRoot,
        version: '0.2.0',
        tag: 'sdk-v0.1.0',
      }),
    ).toThrow('Release tag sdk-v0.1.0 does not match version 0.2.0');
  });

  test('rejects unknown and missing release config fields', () => {
    const unknownFieldFixture = createReleaseFixture();
    const unknownFieldConfigPath = resolve(
      unknownFieldFixture,
      'release.config.json',
    );
    updateJson<MutableReleaseConfig>(unknownFieldConfigPath, (config) => {
      config.unexpected = true;
    });

    expect(() => readReleaseConfig(unknownFieldFixture)).toThrow(
      'release.config.json contains unknown field unexpected',
    );

    const missingNativeConformancePlatformsFixture = createReleaseFixture();
    const missingNativeConformancePlatformsConfigPath = resolve(
      missingNativeConformancePlatformsFixture,
      'release.config.json',
    );
    updateJson<MutableReleaseConfig>(
      missingNativeConformancePlatformsConfigPath,
      (config) => {
        delete config.nativeConformancePlatforms;
      },
    );

    expect(() => readReleaseConfig(missingNativeConformancePlatformsFixture)).toThrow(
      'release.config.json is missing required field nativeConformancePlatforms',
    );

    const missingTagPrefixFixture = createReleaseFixture();
    const missingTagPrefixConfigPath = resolve(
      missingTagPrefixFixture,
      'release.config.json',
    );
    updateJson<MutableReleaseConfigMissingRequiredField>(
      missingTagPrefixConfigPath,
      (config) => {
        delete config.tagPrefix;
      },
    );

    expect(() => readReleaseConfig(missingTagPrefixFixture)).toThrow(
      'release.config.json is missing required field tagPrefix',
    );
  });

  test('requires the canonical native conformance platform matrix', () => {
    expect(readReleaseConfig(workspaceRoot).schemaVersion).toBe(2);
    expect(readReleaseConfig(workspaceRoot).nativeConformancePlatforms).toEqual(
      SUPPORTED_PLATFORMS,
    );

    const fixture = createReleaseFixture();
    const configPath = resolve(fixture, 'release.config.json');
    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.nativeConformancePlatforms = SUBSTITUTED_PLATFORM_MATRIX;
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'release.config.json nativeConformancePlatforms must match the canonical 0.1 native conformance matrix',
    );

    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.nativeConformancePlatforms = REORDERED_PLATFORM_MATRIX;
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'release.config.json nativeConformancePlatforms must match the canonical 0.1 native conformance matrix',
    );

    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.nativeConformancePlatforms = MISSING_PLATFORM_MATRIX;
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'release.config.json nativeConformancePlatforms must match the canonical 0.1 native conformance matrix',
    );

    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.nativeConformancePlatforms = DUPLICATE_PLATFORM_MATRIX;
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'release.config.json nativeConformancePlatforms must match the canonical 0.1 native conformance matrix',
    );

    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.nativeConformancePlatforms = EXTRA_PLATFORM_MATRIX;
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'release.config.json nativeConformancePlatforms must match the canonical 0.1 native conformance matrix',
    );
  });

  test('requires canonical package ordering and supported engines', () => {
    const fixture = createReleaseFixture();
    const configPath = resolve(fixture, 'release.config.json');
    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.packages.reverse();
    });

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'release.config.json packages must match the canonical public package order',
    );

    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.packages.reverse();
    });
    updateJson<MutablePackageManifest>(
      resolve(fixture, 'packages/core/package.json'),
      (manifest) => {
        manifest.engines.node = '>=24 <25';
      },
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      '@opencoven/sdk-core engines.node must be >=24.18.0 <25',
    );
  });

  test('requires package versions and changelog versions to match', () => {
    const fixture = createReleaseFixture();
    updateJson<MutablePackageManifest>(
      resolve(fixture, 'packages/cave/package.json'),
      (manifest) => {
        manifest.version = '0.1.1';
      },
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'All release package versions must match 0.1.0',
    );

    updateJson<MutablePackageManifest>(
      resolve(fixture, 'packages/cave/package.json'),
      (manifest) => {
        manifest.version = '0.1.0';
      },
    );
    writeFileSync(
      resolve(fixture, 'packages/cave/CHANGELOG.md'),
      '# @opencoven/cave-client\n',
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      '@opencoven/cave-client CHANGELOG.md must contain ## 0.1.0',
    );
  });

  test('enforces package privacy on both sides of the publishing lock', () => {
    const fixture = createReleaseFixture();
    const configPath = resolve(fixture, 'release.config.json');

    // The reviewed base state is unlocked and publishable. Closing the lock
    // while the manifests stay publishable must fail closed.
    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.publishingEnabled = false;
    });
    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      '@opencoven/sdk-core must remain private while publishing is disabled',
    );

    // Re-opening the lock while any release manifest is private must fail.
    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.publishingEnabled = true;
    });
    updateJson<MutablePackageManifest>(
      resolve(fixture, 'packages/cave/package.json'),
      (manifest) => {
        manifest.private = true;
      },
    );
    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      '@opencoven/cave-client must be non-private while publishing is enabled',
    );
  });

  test('validates strict SemVer and optional tag requirements', () => {
    expect(() =>
      validateReleaseReadiness({ root: workspaceRoot, version: 'v0.1.0' }),
    ).toThrow('Release version v0.1.0 must be strict SemVer');
    expect(() =>
      validateReleaseReadiness({
        root: workspaceRoot,
        version: '0.1.0',
        requireTag: true,
      }),
    ).toThrow('Release tag is required');
  });

  test('returns the canonical unlocked release summary', () => {
    expect(validateReleaseReadiness({ root: workspaceRoot })).toEqual({
      version: '0.1.0',
      publishingEnabled: true,
      packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    });
  });

  test('constructs provenance-enabled exact-tarball npm arguments', () => {
    expect(
      createNpmPublishArgs({
        tarball: '/tmp/pkg.tgz',
        access: 'public',
        distTag: 'latest',
      }),
    ).toEqual([
      'publish',
      '/tmp/pkg.tgz',
      '--access',
      'public',
      '--tag',
      'latest',
      '--provenance',
    ]);
  });

  test('keeps npm uninvoked until the reviewed release artifacts verify', () => {
    expect(() =>
      publishReleaseArtifacts({
        root: workspaceRoot,
        artifactRoot: resolve(
          tmpdir(),
          'opencoven-release-readiness-missing-artifacts',
        ),
        version: '0.1.0',
        env: { OPENCOVEN_RELEASE_AUTHORIZATION: 'publish' },
        execute: () => {
          throw new Error('must not execute before artifacts verify');
        },
      }),
    ).toThrow(/release-manifest\.json/);
  });

  test('forbids token-based npm authentication on the publish path', () => {
    const outputRoot = createUnlockedArtifactRoot();

    for (const tokenVariable of ['NPM_TOKEN', 'NODE_AUTH_TOKEN']) {
      expect(() =>
        publishReleaseArtifacts({
          root: workspaceRoot,
          artifactRoot: outputRoot,
          version: '0.1.0',
          env: {
            OPENCOVEN_RELEASE_AUTHORIZATION: 'publish',
            [tokenVariable]: 'synthetic-not-a-real-credential',
          },
          execute: () => {
            throw new Error('npm must not run');
          },
        }),
      ).toThrow('Token-based npm authentication is forbidden for regular releases');
    }
  }, 30_000);

  test('reaches the publish step only after artifact verification and authorization', () => {
    const outputRoot = createUnlockedArtifactRoot();

    // The repository lock is open, so the only remaining independent control is
    // the protected `npm-release` environment approval in the release workflow.
    // This spy proves the npm invocation is reached — and can only be reached —
    // after readiness, artifact digests, and the authorization env var pass.
    expect(() =>
      publishReleaseArtifacts({
        root: workspaceRoot,
        artifactRoot: outputRoot,
        version: '0.1.0',
        env: { OPENCOVEN_RELEASE_AUTHORIZATION: 'publish' },
        execute: () => {
          throw new Error('publish step reached with verified artifacts');
        },
      }),
    ).toThrow('publish step reached with verified artifacts');
  }, 30_000);

  test('requires the release workflow identity and a tag on HEAD', () => {
    const fixture = createReleaseFixture();
    rmSync(resolve(fixture, '.github/workflows/release.yml'));

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Required release workflow is missing: .github/workflows/release.yml',
    );
    expect(() =>
      validateReleaseReadiness({
        root: workspaceRoot,
        version: '0.1.0',
        tag: 'sdk-v0.1.0',
        requireTag: true,
      }),
    ).toThrow('Release tag sdk-v0.1.0 is absent');
  });

  test('enforces the protected publish job in the release workflow contract', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const workflow = readFileSync(workflowPath, 'utf8').replace(
      'environment: npm-release',
      'environment: unprotected-release',
    );
    writeFileSync(workflowPath, workflow);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow publish job must use environment npm-release',
    );
  });
});
