import { execFileSync, spawnSync } from 'node:child_process';
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
import * as releaseReadinessModule from '../scripts/release-readiness.mjs';
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
  | 'conformanceEvidence'
  | 'nativeConformancePlatforms'
  | 'npmAccess'
  | 'npmDistTag'
  | 'packages'
  | 'schemaVersion'
  | 'supportedNode'
  | 'tagPrefix'
> & {
  conformanceEvidence: {
    aggregateRecord: string | null;
    candidateCommit: string;
    issue: string;
  };
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
const VALIDATOR_RUNTIME_PATHS = [
  '.github/workflows/release.yml',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/aggregate-client-v1-conformance.mjs',
  'scripts/conformance-contract.mjs',
  'scripts/create-release-artifacts.mjs',
  'scripts/owned-temp-directory.mjs',
  'scripts/package-artifacts.mjs',
  'scripts/publish-release-artifacts.mjs',
  'scripts/release-readiness.mjs',
  'scripts/repository-metadata.mjs',
  'scripts/verify-committed-conformance-evidence.mjs',
  'scripts/verify-release-readiness.mjs',
] as const;

function createReleaseFixture(): string {
  const fixture = mkdtempSync(resolve(tmpdir(), 'opencoven-release-readiness-'));
  fixtures.push(fixture);

  cpSync(
    resolve(workspaceRoot, 'release.config.json'),
    resolve(fixture, 'release.config.json'),
  );
  cpSync(
    resolve(workspaceRoot, 'conformance'),
    resolve(fixture, 'conformance'),
    { recursive: true },
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

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false',
    },
  }).trim();
}

function initializeReleaseFixtureRepository(root: string): void {
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Release Readiness Test']);
  git(root, ['config', 'user.email', 'release-readiness@example.invalid']);
  git(root, [
    'remote',
    'add',
    'origin',
    'https://github.com/OpenCoven/sdk.git',
  ]);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('release readiness contract', () => {
  test('requires conformance evidence even when the CLI flag is omitted', () => {
    const result = spawnSync(
      process.execPath,
      ['./scripts/verify-release-readiness.mjs'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'release.config.json must name a passing SDK #38 aggregate record',
    );
  });

  test('wires the non-optional evidence gate into every canonical release path', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const workflow = readFileSync(
      resolve(workspaceRoot, '.github/workflows/release.yml'),
      'utf8',
    );

    expect(manifest.scripts['verify:release']).toBe(
      'node ./scripts/verify-release-readiness.mjs --require-conformance-evidence',
    );
    expect(manifest.scripts.verify).toContain('verify:release');
    expect(workflow).toContain('run: corepack pnpm@10.34.0 verify');
    expect(
      workflow.match(/--require-conformance-evidence/gu),
    ).toHaveLength(2);
    const publishJobIndex = workflow.indexOf('\n  publish:\n');
    expect(publishJobIndex).toBeGreaterThan(0);
    const preflightJob = workflow.slice(0, publishJobIndex);
    const publishJob = workflow.slice(publishJobIndex);
    expect(
      preflightJob.indexOf('name: Pin reviewed release runtime'),
    ).toBeLessThan(preflightJob.indexOf('name: Install dependencies'));
    expect(publishJob).toContain('name: Pin reviewed release runtime');
    expect(publishJob).not.toContain('name: Install dependencies');
  });

  test('blocks candidate advancement until a named passing aggregate exists', () => {
    const config = readReleaseConfig(workspaceRoot);
    expect(config.conformanceEvidence).toEqual({
      issue: 'OpenCoven/sdk#38',
      candidateCommit: 'acc38488f00860d246c3c553375634d64806eabb',
      aggregateRecord: null,
    });
    expect(() =>
      validateReleaseReadiness({
        root: workspaceRoot,
        requireConformanceEvidence: true,
      }),
    ).toThrow('release.config.json must name a passing SDK #38 aggregate record');
  });

  test('rejects a fabricated untracked aggregate at the configured path', () => {
    const fixture = createReleaseFixture();
    const recordPath =
      'docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json';
    updateJson<MutableReleaseConfig>(
      resolve(fixture, 'release.config.json'),
      (config) => {
        config.conformanceEvidence.aggregateRecord = recordPath;
      },
    );
    initializeReleaseFixtureRepository(fixture);
    mkdirSync(resolve(fixture, dirname(recordPath)), { recursive: true });
    writeFileSync(
      resolve(fixture, recordPath),
      '{"summary":{"status":"passed"}}\n',
    );

    expect(() =>
      validateReleaseReadiness({
        root: fixture,
        requireConformanceEvidence: true,
      }),
    ).toThrow(
      'release.config.json conformance evidence record must be a committed tracked regular file',
    );
  });

  test('rejects working-tree drift in a configured committed aggregate', () => {
    const fixture = createReleaseFixture();
    const recordPath =
      'docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json';
    mkdirSync(resolve(fixture, dirname(recordPath)), { recursive: true });
    writeFileSync(resolve(fixture, recordPath), '{}\n');
    updateJson<MutableReleaseConfig>(
      resolve(fixture, 'release.config.json'),
      (config) => {
        config.conformanceEvidence.aggregateRecord = recordPath;
      },
    );
    initializeReleaseFixtureRepository(fixture);
    writeFileSync(
      resolve(fixture, recordPath),
      '{"summary":{"status":"passed"}}\n',
    );

    expect(() =>
      validateReleaseReadiness({
        root: fixture,
        requireConformanceEvidence: true,
      }),
    ).toThrow(
      'release.config.json conformance evidence record must match its committed bytes',
    );
  });

  test('keeps explicit non-release verification usable after evidence is configured', () => {
    const fixture = createReleaseFixture();
    const recordPath =
      'docs/client-v1-cross-repository-results/acc38488f00860d246c3c553375634d64806eabb.json';
    updateJson<MutableReleaseConfig>(
      resolve(fixture, 'release.config.json'),
      (config) => {
        config.conformanceEvidence.aggregateRecord = recordPath;
      },
    );

    expect(
      validateReleaseReadiness({
        root: fixture,
        requireConformanceEvidence: false,
      }),
    ).toEqual({
      version: '0.1.0',
      publishingEnabled: false,
      packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
      conformanceEvidenceRecord: null,
    });
  });

  test('requires every verifier runtime dependency to match the recorded validator commit', () => {
    const fixture = createReleaseFixture();
    for (const path of VALIDATOR_RUNTIME_PATHS) {
      mkdirSync(resolve(fixture, dirname(path)), { recursive: true });
      cpSync(resolve(workspaceRoot, path), resolve(fixture, path));
    }
    initializeReleaseFixtureRepository(fixture);
    const validatorCommit = git(fixture, ['rev-parse', 'HEAD']);
    writeFileSync(
      resolve(fixture, 'scripts/conformance-contract.mjs'),
      'export const drifted = true;\n',
    );
    git(fixture, ['add', 'scripts/conformance-contract.mjs']);
    git(fixture, ['commit', '--quiet', '-m', 'drift verifier']);
    const releaseCommit = git(fixture, ['rev-parse', 'HEAD']);
    const validateValidatorRuntimeFiles = (
      releaseReadinessModule as unknown as Record<string, unknown>
    ).validateValidatorRuntimeFiles;

    expect(
      validateValidatorRuntimeFiles,
      'validateValidatorRuntimeFiles must be exported',
    ).toBeTypeOf('function');
    expect(() =>
      (
        validateValidatorRuntimeFiles as (
          root: string,
          validatorCommit: string,
          releaseCommit: string,
        ) => void
      )(fixture, validatorCommit, releaseCommit),
    ).toThrow(
      'Validator runtime file scripts/conformance-contract.mjs differs from the recorded validator commit',
    );
  });

  test('rejects uncommitted verifier runtime drift before executing it', () => {
    const fixture = createReleaseFixture();
    for (const path of VALIDATOR_RUNTIME_PATHS) {
      mkdirSync(resolve(fixture, dirname(path)), { recursive: true });
      cpSync(resolve(workspaceRoot, path), resolve(fixture, path));
    }
    initializeReleaseFixtureRepository(fixture);
    const commit = git(fixture, ['rev-parse', 'HEAD']);
    writeFileSync(
      resolve(fixture, 'scripts/conformance-contract.mjs'),
      'export const worktreeDrift = true;\n',
    );

    expect(() =>
      releaseReadinessModule.validateValidatorRuntimeFiles(
        fixture,
        commit,
        commit,
      ),
    ).toThrow(
      'Validator runtime file scripts/conformance-contract.mjs does not match the release commit working tree',
    );
  });

  test('pins release artifact and workflow entrypoints to the validator commit', () => {
    const fixture = createReleaseFixture();
    for (const path of VALIDATOR_RUNTIME_PATHS) {
      mkdirSync(resolve(fixture, dirname(path)), { recursive: true });
      cpSync(resolve(workspaceRoot, path), resolve(fixture, path));
    }
    initializeReleaseFixtureRepository(fixture);
    const validatorCommit = git(fixture, ['rev-parse', 'HEAD']);
    writeFileSync(
      resolve(fixture, 'scripts/create-release-artifacts.mjs'),
      'export const substitutedBuilder = true;\n',
    );
    git(fixture, ['add', 'scripts/create-release-artifacts.mjs']);
    git(fixture, ['commit', '--quiet', '-m', 'substitute release builder']);
    const releaseCommit = git(fixture, ['rev-parse', 'HEAD']);

    expect(() =>
      releaseReadinessModule.validateValidatorRuntimeFiles(
        fixture,
        validatorCommit,
        releaseCommit,
      ),
    ).toThrow(
      'Validator runtime file scripts/create-release-artifacts.mjs differs from the recorded validator commit',
    );
  });

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
    ).toThrow('release.config.json must name a passing SDK #38 aggregate record');
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
      conformanceEvidenceRecord: null,
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
    ).toThrow('release.config.json must name a passing SDK #38 aggregate record');
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

  test('does not accept publish protections copied into a run block', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const original = readFileSync(workflowPath, 'utf8');
    const publishMarker = '\n  publish:\n';
    const publishIndex = original.indexOf(publishMarker);
    expect(publishIndex).toBeGreaterThan(0);
    const workflow = `${original.slice(0, publishIndex)}${publishMarker}${[
      "    if: inputs.mode == 'publish'",
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: Decoy publish protections',
      '        run: |',
      '          echo "needs: preflight"',
      '          echo "environment: npm-release"',
      '          echo "contents: read"',
      '          echo "id-token: write"',
      '          echo "attestations: write"',
      '',
    ].join('\n')}`;
    writeFileSync(workflowPath, workflow);
    expect(
      [
        'needs: preflight',
        'environment: npm-release',
        'contents: read',
        'id-token: write',
        'attestations: write',
      ].every((value) => workflow.includes(value)),
    ).toBe(true);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow publish job must use environment npm-release',
    );
  });
});
