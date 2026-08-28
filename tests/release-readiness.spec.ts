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
import {
  createNpmPublishArgs,
  publishReleaseArtifacts,
} from '../scripts/publish-release-artifacts.mjs';
import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures: string[] = [];

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
});

describe('release readiness contract', () => {
  test('keeps publication disabled while packages are private', () => {
    const config = readReleaseConfig(workspaceRoot);

    expect(config.publishingEnabled).toBe(false);
    expect(() =>
      validateReleaseReadiness({
        root: workspaceRoot,
        mode: 'publish',
        version: '0.1.0',
        tag: 'sdk-v0.1.0',
      }),
    ).toThrow('Release publishing is disabled by release.config.json');
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
    const fixture = createReleaseFixture();
    const configPath = resolve(fixture, 'release.config.json');
    updateJson<MutableReleaseConfig>(configPath, (config) => {
      config.unexpected = true;
    });

    expect(() => readReleaseConfig(fixture)).toThrow(
      'release.config.json contains unknown field unexpected',
    );

    updateJson<MutableReleaseConfig>(configPath, (config) => {
      delete config.unexpected;
      delete config.nativeConformancePlatforms;
    });

    expect(() => readReleaseConfig(fixture)).toThrow(
      'release.config.json is missing required field nativeConformancePlatforms',
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
    updateJson<MutablePackageManifest>(
      resolve(fixture, 'packages/core/package.json'),
      (manifest) => {
        manifest.private = false;
      },
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      '@opencoven/sdk-core must remain private while publishing is disabled',
    );

    updateJson<MutableReleaseConfig>(
      resolve(fixture, 'release.config.json'),
      (config) => {
        config.publishingEnabled = true;
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

  test('returns the canonical locked release summary', () => {
    expect(validateReleaseReadiness({ root: workspaceRoot })).toEqual({
      version: '0.1.0',
      publishingEnabled: false,
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

  test('never invokes npm while publication is locked', () => {
    expect(() =>
      publishReleaseArtifacts({
        root: workspaceRoot,
        artifactRoot: '/tmp/missing-artifacts',
        version: '0.1.0',
        env: { OPENCOVEN_RELEASE_AUTHORIZATION: 'publish' },
        execute: () => {
          throw new Error('must not execute while locked');
        },
      }),
    ).toThrow('Release publishing is disabled by release.config.json');
  });

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
