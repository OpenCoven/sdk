import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, test } from 'vitest';

import {
  serializeReleaseManifest,
} from '../scripts/create-release-artifacts.mjs';
import {
  createPublicationAuthorizationRecord as createRawPublicationAuthorizationRecord,
  resolvePublicationSecurityReview,
} from '../scripts/github-release-authorization.mjs';
import {
  publishReleaseArtifacts,
} from '../scripts/publish-release-artifacts.mjs';
import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';
import { serializeCanonicalJson } from '../scripts/conformance-contract.mjs';

const workspaceRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const fixtures: string[] = [];
const VERSION = '0.1.0';
const NPM_REGISTRY = 'https://registry.npmjs.org/';
const NPM_VERSION = '11.5.1';

type PublicationAuthorizationOptions = Parameters<
  typeof createRawPublicationAuthorizationRecord
>[0];

function createPublicationAuthorizationRecord(
  options: Omit<
    PublicationAuthorizationOptions,
    'deploymentId' | 'environmentId'
  > & Partial<
    Pick<
      PublicationAuthorizationOptions,
      'deploymentId' | 'environmentId'
    >
  >,
) {
  return createRawPublicationAuthorizationRecord({
    deploymentId: '40000',
    environmentId: '50000',
    ...options,
  });
}

interface PublicationManifest {
  schemaVersion: 5;
  artifactSet: 'publication-candidate';
  version: string;
  source: {
    repository: 'OpenCoven/sdk';
    commit: string;
    tree: string;
    npmConfigFiles: Array<{
      path: string;
      size: number;
      sha256: string;
    }>;
  };
  toolchain: {
    nodeVersion: 'v24.18.1';
    pnpmVersion: 'pnpm@10.34.0';
    npmVersion: '11.5.1';
    packCommand: 'corepack pnpm@10.34.0 pack --ignore-scripts';
  };
  publisher: {
    path: 'scripts/publish-release-artifacts.mjs';
    size: number;
    sha256: string;
  };
  provenance: {
    repository: 'OpenCoven/sdk';
    workflow: '.github/workflows/release.yml';
    workflowCommit: string;
    sourceRef: 'refs/heads/main';
    runId: string;
    runAttempt: number;
    job: 'publication-candidate';
    environment: 'publication-candidate';
    artifactName: string;
  };
  packages: Array<{
    name: string;
    version: string;
    file: string;
    size: number;
    sha256: string;
  }>;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(root: string, arguments_: string[]): string {
  return execFileSync('git', arguments_, {
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

function createReleaseFixture({
  installedNpm = true,
}: {
  installedNpm?: boolean;
} = {}): string {
  const root = mkdtempSync(resolve(tmpdir(), 'opencoven-publication-security-'));
  fixtures.push(root);
  git(root, ['init', '--quiet']);
  git(root, [
    'fetch',
    '--quiet',
    workspaceRoot,
    'acc38488f00860d246c3c553375634d64806eabb',
  ]);
  git(root, ['checkout', '--quiet', '-b', 'main', 'FETCH_HEAD']);
  git(root, ['config', 'user.name', 'Publication Security Test']);
  git(root, ['config', 'user.email', 'publication-security@example.invalid']);
  git(root, [
    'remote',
    'add',
    'origin',
    'https://github.com/OpenCoven/sdk.git',
  ]);
  mkdirSync(resolve(root, '.github/workflows'), { recursive: true });
  cpSync(
    resolve(workspaceRoot, '.github/workflows/release.yml'),
    resolve(root, '.github/workflows/release.yml'),
  );
  cpSync(resolve(workspaceRoot, '.npmrc'), resolve(root, '.npmrc'));
  cpSync(resolve(workspaceRoot, 'package.json'), resolve(root, 'package.json'));
  cpSync(resolve(workspaceRoot, 'pnpm-lock.yaml'), resolve(root, 'pnpm-lock.yaml'));

  const config = JSON.parse(
    readFileSync(resolve(workspaceRoot, 'release.config.json'), 'utf8'),
  ) as Record<string, unknown>;
  config.schemaVersion = 5;
  config.publishingEnabled = true;
  config.npmCliVersion = NPM_VERSION;
  config.npmRegistry = NPM_REGISTRY;
  config.publicationCandidate = {
    artifactSet: 'publication-candidate',
    environment: 'publication-candidate',
    securityReviewIssue: 'OpenCoven/sdk#40',
    workflow: '.github/workflows/release.yml',
    job: 'publication-candidate',
  };
  writeFileSync(
    resolve(root, 'release.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  if (installedNpm) {
    const npmRoot = resolve(root, 'node_modules/npm');
    mkdirSync(resolve(npmRoot, 'bin'), { recursive: true });
    writeFileSync(
      resolve(npmRoot, 'package.json'),
      `${JSON.stringify({ name: 'npm', version: NPM_VERSION }, null, 2)}\n`,
    );
    writeFileSync(resolve(npmRoot, 'bin/npm-cli.js'), '#!/usr/bin/env node\n');
  }

  git(root, [
    'add',
    '.npmrc',
    '.github/workflows/release.yml',
    'package.json',
    'pnpm-lock.yaml',
    'release.config.json',
  ]);
  if (installedNpm) {
    git(root, ['add', '--force', 'node_modules/npm']);
  }
  git(root, ['commit', '--quiet', '-m', 'authorized release source']);
  return root;
}

function createTarArchive(
  name: string,
  scripts?: Record<string, string>,
): Buffer {
  const root = mkdtempSync(resolve(tmpdir(), 'opencoven-package-tar-'));
  try {
    mkdirSync(resolve(root, 'package'));
    writeFileSync(
      resolve(root, 'package/package.json'),
      `${JSON.stringify({
        name,
        version: VERSION,
        private: false,
        ...(scripts === undefined ? {} : { scripts }),
      }, null, 2)}\n`,
    );
    const archive = resolve(root, 'package.tar');
    execFileSync('tar', ['-cf', archive, '-C', root, 'package']);
    return readFileSync(archive);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePublicationArtifacts(
  sourceRoot: string,
  artifactRoot: string,
  options: {
    compressionLevel?: number;
    lifecyclePackage?: string;
    uncompressedTarballs?: Map<string, Buffer>;
  } = {},
): {
  manifest: PublicationManifest;
  manifestText: string;
  uncompressedTarballs: Map<string, Buffer>;
} {
  mkdirSync(artifactRoot, { recursive: true });
  const compressionLevel = options.compressionLevel ?? 1;
  const uncompressedTarballs = new Map<string, Buffer>();
  const packages = PUBLIC_PACKAGES.map(
    ({ packageName, workspaceDirectory }) => {
      const tar = options.uncompressedTarballs?.get(packageName)
        ?? createTarArchive(
          packageName,
          packageName === options.lifecyclePackage
            ? { prepublishOnly: 'node steal-secrets.mjs' }
            : undefined,
        );
      uncompressedTarballs.set(packageName, tar);
      const file =
        `tarballs/${workspaceDirectory}/`
        + `${packageName.slice(1).replace('/', '-')}-${VERSION}.tgz`;
      const path = resolve(artifactRoot, file);
      mkdirSync(dirname(path), { recursive: true });
      const bytes = gzipSync(tar, { level: compressionLevel });
      writeFileSync(path, bytes);
      return {
        name: packageName,
        version: VERSION,
        file,
        size: bytes.byteLength,
        sha256: sha256(bytes),
      };
    },
  );
  const commit = git(sourceRoot, ['rev-parse', 'HEAD']);
  const tree = git(sourceRoot, ['rev-parse', 'HEAD^{tree}']);
  const npmrcBytes = readFileSync(resolve(sourceRoot, '.npmrc'));
  const publisherPath = 'scripts/publish-release-artifacts.mjs';
  const publisherBytes = readFileSync(resolve(sourceRoot, publisherPath));
  const artifactName = `opencoven-sdk-publication-${commit}-${VERSION}`;
  const manifest: PublicationManifest = {
    schemaVersion: 5,
    artifactSet: 'publication-candidate',
    version: VERSION,
    source: {
      repository: 'OpenCoven/sdk',
      commit,
      tree,
      npmConfigFiles: [
        {
          path: '.npmrc',
          size: npmrcBytes.byteLength,
          sha256: sha256(npmrcBytes),
        },
      ],
    },
    toolchain: {
      nodeVersion: 'v24.18.1',
      pnpmVersion: 'pnpm@10.34.0',
      npmVersion: NPM_VERSION,
      packCommand: 'corepack pnpm@10.34.0 pack --ignore-scripts',
    },
    publisher: {
      path: publisherPath,
      size: publisherBytes.byteLength,
      sha256: sha256(publisherBytes),
    },
    provenance: {
      repository: 'OpenCoven/sdk',
      workflow: '.github/workflows/release.yml',
      workflowCommit: commit,
      sourceRef: 'refs/heads/main',
      runId: '10000',
      runAttempt: 1,
      job: 'publication-candidate',
      environment: 'publication-candidate',
      artifactName,
    },
    packages,
  };
  const manifestText = serializeReleaseManifest(manifest as never);
  writeFileSync(resolve(artifactRoot, 'release-manifest.json'), manifestText);
  return { manifest, manifestText, uncompressedTarballs };
}

function createGitHubExecute(
  authorization: ReturnType<typeof createPublicationAuthorizationRecord>,
) {
  return (command: string, arguments_: string[]): string => {
    expect(command).toBe('gh');
    if (
      arguments_[0] === 'attestation'
      && arguments_[1] === 'verify'
    ) {
      const path = arguments_[2];
      if (path === undefined) {
        throw new Error('Missing mocked attestation verification path');
      }
      return JSON.stringify([
        {
          verificationResult: {
            signature: {
              certificate: {
                runInvocationURI:
                  'https://github.com/OpenCoven/sdk/actions/runs/10000/attempts/1',
                runnerEnvironment: 'github-hosted',
                sourceRepositoryURI: 'https://github.com/OpenCoven/sdk',
                sourceRepositoryDigest: authorization.source.commit,
                sourceRepositoryRef: 'refs/heads/main',
                buildSignerDigest: authorization.source.commit,
              },
            },
            statement: {
              predicateType: 'https://slsa.dev/provenance/v1',
              subject: [
                {
                  digest: {
                    sha256: sha256(readFileSync(path)),
                  },
                },
              ],
            },
          },
        },
      ]);
    }
    const endpoint = arguments_.at(-1) ?? '';
    if (endpoint === 'repos/OpenCoven/sdk/issues/40') {
      return JSON.stringify({
        number: 40,
        state: 'closed',
        state_reason: 'completed',
        locked: true,
      });
    }
    if (endpoint === 'repos/OpenCoven/sdk/issues/comments/4001') {
      return JSON.stringify({
        id: 4001,
        issue_url: 'https://api.github.com/repos/OpenCoven/sdk/issues/40',
        body: serializeCanonicalJson(authorization),
        created_at: '2026-08-29T04:00:00Z',
        updated_at: '2026-08-29T04:00:00Z',
        author_association: 'OWNER',
        user: { login: 'BunsDev' },
      });
    }
    if (endpoint === 'repos/OpenCoven/sdk/actions/runs/10000') {
      return JSON.stringify({
        id: 10000,
        name: 'release',
        event: 'workflow_dispatch',
        run_attempt: 1,
        head_sha: authorization.source.commit,
        head_branch: 'main',
        path: authorization.provenance.workflow,
        status: 'completed',
        conclusion: 'success',
        repository: { full_name: 'OpenCoven/sdk' },
        head_repository: { full_name: 'OpenCoven/sdk' },
      });
    }
    if (
      endpoint
        === 'repos/OpenCoven/sdk/actions/runs/10000/attempts/1/jobs?per_page=100'
    ) {
      return JSON.stringify({
        total_count: 1,
        jobs: [
          {
            id: 20000,
            run_id: 10000,
            run_attempt: 1,
            head_sha: authorization.source.commit,
            html_url:
              'https://github.com/OpenCoven/sdk/actions/runs/10000/job/20000',
            name: 'publication-candidate',
            workflow_name: 'release',
            labels: ['ubuntu-latest'],
            status: 'completed',
            conclusion: 'success',
          },
        ],
      });
    }
    if (
      endpoint === 'repos/OpenCoven/sdk/environments/publication-candidate'
    ) {
      return JSON.stringify({
        id: 50000,
        name: 'publication-candidate',
      });
    }
    if (endpoint === 'repos/OpenCoven/sdk/deployments/40000') {
      return JSON.stringify({
        id: 40000,
        sha: authorization.source.commit,
        ref: 'main',
        task: 'deploy',
        environment: 'publication-candidate',
        transient_environment: false,
        statuses_url:
          'https://api.github.com/repos/OpenCoven/sdk/deployments/40000/statuses',
        repository_url: 'https://api.github.com/repos/OpenCoven/sdk',
        performed_via_github_app: {
          slug: 'github-actions',
        },
      });
    }
    if (
      endpoint
        === 'repos/OpenCoven/sdk/deployments/40000/statuses?per_page=100'
    ) {
      const jobUrl =
        'https://github.com/OpenCoven/sdk/actions/runs/10000/job/20000';
      return JSON.stringify([
        {
          state: 'in_progress',
          environment: 'publication-candidate',
          log_url: jobUrl,
          target_url: jobUrl,
        },
        {
          state: 'success',
          environment: 'publication-candidate',
          log_url: jobUrl,
          target_url: jobUrl,
        },
      ]);
    }
    if (endpoint === 'repos/OpenCoven/sdk/actions/artifacts/30000') {
      return JSON.stringify({
        id: 30000,
        name: authorization.artifact.name,
        expired: false,
        workflow_run: {
          id: 10000,
          head_sha: authorization.source.commit,
        },
      });
    }
    if (
      endpoint.startsWith(
        'repos/OpenCoven/sdk/actions/runs/10000/artifacts?',
      )
    ) {
      return JSON.stringify({
        total_count: 1,
        artifacts: [
          {
            id: 30000,
            name: authorization.artifact.name,
            expired: false,
            workflow_run: {
              id: 10000,
              head_sha: authorization.source.commit,
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected GitHub endpoint ${endpoint}`);
  };
}

function createNpmExecute(publishCalls: Array<{
  arguments_: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}>) {
  return (
    command: string,
    arguments_: string[],
    options: {
      cwd: string;
      env: Record<string, string | undefined>;
      encoding?: string;
      stdio: unknown;
    },
  ): string => {
    expect(command).toBe(process.execPath);
    if (arguments_.at(-1) === '--version') {
      return `${NPM_VERSION}\n`;
    }
    if (arguments_.includes('config') && arguments_.includes('list')) {
      expect(
        readFileSync(options.env.NPM_CONFIG_USERCONFIG ?? '', 'utf8'),
      ).toBe(`registry=${NPM_REGISTRY}\n`);
      expect(
        readFileSync(options.env.NPM_CONFIG_GLOBALCONFIG ?? '', 'utf8'),
      ).toBe(`registry=${NPM_REGISTRY}\n`);
      return JSON.stringify({
        registry: NPM_REGISTRY,
        userconfig: options.env.NPM_CONFIG_USERCONFIG,
        globalconfig: options.env.NPM_CONFIG_GLOBALCONFIG,
        cache: options.env.NPM_CONFIG_CACHE,
      });
    }
    if (arguments_.includes('publish')) {
      publishCalls.push({
        arguments_: [...arguments_],
        cwd: options.cwd,
        env: { ...options.env },
      });
      return '';
    }
    throw new Error(`Unexpected npm command ${arguments_.join(' ')}`);
  };
}

function publicationEnvironment(
  sourceRoot: string,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    OPENCOVEN_RELEASE_AUTHORIZATION: 'publish',
    OPENCOVEN_SECURITY_REVIEW_COMMENT_ID: '4001',
    ACTIONS_ID_TOKEN_REQUEST_URL:
      'https://vstoken.actions.githubusercontent.com/test',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'short-lived-oidc-request-token',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'OpenCoven/sdk',
    GITHUB_WORKFLOW_REF:
      'OpenCoven/sdk/.github/workflows/release.yml@refs/heads/main',
    GITHUB_WORKFLOW_SHA: git(sourceRoot, ['rev-parse', 'HEAD']),
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: git(sourceRoot, ['rev-parse', 'HEAD']),
    GITHUB_JOB: 'publish',
    GITHUB_RUN_ID: '11000',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY_ID: '1337664127',
    GITHUB_REPOSITORY_OWNER_ID: '270919577',
    RUNNER_ENVIRONMENT: 'github-hosted',
    ...overrides,
  };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('publication security', { timeout: 30_000 }, () => {
  test('binds the authorization to the exact candidate environment and deployment', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-candidate-deployment-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const manifest = structuredClone(candidate.manifest);
    const manifestText = serializeReleaseManifest(manifest as never);

    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      deploymentId: '40000',
      environmentId: '50000',
      jobId: '20000',
      manifest: manifest as never,
      manifestText,
    });

    expect(authorization.provenance).toMatchObject({
      runId: '10000',
      runAttempt: 1,
      job: 'publication-candidate',
      jobId: '20000',
      environment: 'publication-candidate',
      environmentId: '50000',
      deploymentId: '40000',
    });
  });

  test('binds the reviewed sterile publisher runtime path and digest', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-publisher-runtime-binding-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const publisherPath = 'scripts/publish-release-artifacts.mjs';
    const publisherBytes = readFileSync(resolve(sourceRoot, publisherPath));
    const manifest = {
      ...candidate.manifest,
      publisher: {
        path: publisherPath,
        size: publisherBytes.byteLength,
        sha256: sha256(publisherBytes),
      },
    };
    const manifestText = serializeReleaseManifest(manifest as never);

    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: manifest as never,
      manifestText,
    });

    expect(authorization).toMatchObject({
      publisher: {
        path: publisherPath,
        size: publisherBytes.byteLength,
        sha256: sha256(publisherBytes),
      },
    });
  });

  test('verifies the candidate environment and deployment against the exact job attempt', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-candidate-job-binding-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const endpoints: string[] = [];
    const execute = createGitHubExecute(authorization);

    expect(
      resolvePublicationSecurityReview({
        root: sourceRoot,
        commentId: '4001',
        execute: (command: string, arguments_: string[]) => {
          endpoints.push(arguments_.at(-1) ?? '');
          return execute(command, arguments_);
        },
        env: { GH_TOKEN: 'github-token' },
      } as never),
    ).toMatchObject({
      provenance: {
        runId: '10000',
        runAttempt: 1,
        jobId: '20000',
        environment: 'publication-candidate',
        environmentId: '50000',
        deploymentId: '40000',
      },
    });
    expect(endpoints).toContain(
      'repos/OpenCoven/sdk/environments/publication-candidate',
    );
    expect(endpoints).toContain('repos/OpenCoven/sdk/deployments/40000');
    expect(endpoints).toContain(
      'repos/OpenCoven/sdk/deployments/40000/statuses?per_page=100',
    );
  });

  test('rejects a candidate deployment bound to a sibling job', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-sibling-candidate-job-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const execute = createGitHubExecute(authorization);

    expect(() =>
      resolvePublicationSecurityReview({
        root: sourceRoot,
        commentId: '4001',
        execute: (command: string, arguments_: string[]) => {
          const endpoint = arguments_.at(-1) ?? '';
          if (
            endpoint
              === 'repos/OpenCoven/sdk/deployments/40000/statuses?per_page=100'
          ) {
            return JSON.stringify([
              {
                state: 'success',
                environment: 'publication-candidate',
                log_url:
                  'https://github.com/OpenCoven/sdk/actions/runs/10000/job/29999',
                target_url:
                  'https://github.com/OpenCoven/sdk/actions/runs/10000/job/29999',
              },
            ]);
          }
          return execute(command, arguments_);
        },
        env: { GH_TOKEN: 'github-token' },
      } as never),
    ).toThrow(
      'GitHub security review deployment does not belong to the exact candidate job',
    );
  });

  test('rejects a substituted publication candidate environment identity', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-substituted-candidate-environment-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const execute = createGitHubExecute(authorization);

    expect(() =>
      resolvePublicationSecurityReview({
        root: sourceRoot,
        commentId: '4001',
        execute: (command: string, arguments_: string[]) => {
          const endpoint = arguments_.at(-1) ?? '';
          if (
            endpoint
              === 'repos/OpenCoven/sdk/environments/publication-candidate'
          ) {
            return JSON.stringify({
              id: 59999,
              name: 'publication-candidate',
            });
          }
          return execute(command, arguments_);
        },
        env: { GH_TOKEN: 'github-token' },
      } as never),
    ).toThrow(
      'GitHub security review does not bind the exact publication candidate environment',
    );
  });

  test('verifies attestations for every downloaded candidate file from the exact run attempt', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-candidate-attestations-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const apiExecute = createGitHubExecute(authorization);
    const attestationCalls: string[][] = [];
    const publishCalls: Array<{
      arguments_: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    }> = [];

    publishReleaseArtifacts({
      root: sourceRoot,
      artifactRoot,
      version: VERSION,
      env: publicationEnvironment(sourceRoot),
      execute: createNpmExecute(publishCalls),
      githubExecute: (command: string, arguments_: string[]) => {
        if (
          arguments_[0] === 'attestation'
          && arguments_[1] === 'verify'
        ) {
          attestationCalls.push([...arguments_]);
          const path = arguments_[2];
          if (path === undefined) {
            throw new Error('Missing attestation verification path');
          }
          return JSON.stringify([
            {
              verificationResult: {
                signature: {
                  certificate: {
                    runInvocationURI:
                      'https://github.com/OpenCoven/sdk/actions/runs/10000/attempts/1',
                    runnerEnvironment: 'github-hosted',
                    sourceRepositoryURI: 'https://github.com/OpenCoven/sdk',
                    sourceRepositoryDigest: authorization.source.commit,
                    sourceRepositoryRef: 'refs/heads/main',
                    buildSignerDigest: authorization.source.commit,
                  },
                },
                statement: {
                  predicateType: 'https://slsa.dev/provenance/v1',
                  subject: [
                    {
                      digest: {
                        sha256: sha256(readFileSync(path)),
                      },
                    },
                  ],
                },
              },
            },
          ]);
        }
        return apiExecute(command, arguments_);
      },
    } as never);

    expect(attestationCalls).toHaveLength(5);
    expect(
      attestationCalls.every(
        (arguments_) =>
          arguments_.includes('--signer-workflow')
          && arguments_.includes(
            'OpenCoven/sdk/.github/workflows/release.yml',
          )
          && arguments_.includes('--signer-digest')
          && arguments_.includes(authorization.source.commit)
          && arguments_.includes('--source-ref')
          && arguments_.includes('refs/heads/main')
          && arguments_.includes('--deny-self-hosted-runners'),
      ),
    ).toBe(true);
    expect(publishCalls).toHaveLength(4);
  });

  test('publishes only the exact gzip bytes authorized by #40', () => {
    const sourceRoot = createReleaseFixture();
    const authorizedRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-authorized-publication-'),
    );
    const repackedRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-repacked-publication-'),
    );
    fixtures.push(authorizedRoot, repackedRoot);
    const authorized = writePublicationArtifacts(
      sourceRoot,
      authorizedRoot,
      { compressionLevel: 1 },
    );
    const repacked = writePublicationArtifacts(
      sourceRoot,
      repackedRoot,
      {
        compressionLevel: 9,
        uncompressedTarballs: authorized.uncompressedTarballs,
      },
    );
    for (const packageName of PUBLIC_PACKAGES.map(
      ({ packageName }) => packageName,
    )) {
      expect(
        repacked.uncompressedTarballs.get(packageName),
      ).toEqual(authorized.uncompressedTarballs.get(packageName));
    }
    expect(repacked.manifest.packages[0]?.sha256).not.toBe(
      authorized.manifest.packages[0]?.sha256,
    );

    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: authorized.manifest as never,
      manifestText: authorized.manifestText,
    });
    const githubExecute = createGitHubExecute(authorization);
    const publishCalls: Array<{
      arguments_: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    }> = [];

    expect(
      publishReleaseArtifacts({
        root: sourceRoot,
        artifactRoot: authorizedRoot,
        version: VERSION,
        env: publicationEnvironment(sourceRoot),
        execute: createNpmExecute(publishCalls),
        githubExecute,
      } as never),
    ).toEqual(authorized.manifest);
    expect(publishCalls).toHaveLength(4);

    const repackedPublishCalls: typeof publishCalls = [];
    expect(() =>
      publishReleaseArtifacts({
        root: sourceRoot,
        artifactRoot: repackedRoot,
        version: VERSION,
        env: publicationEnvironment(sourceRoot),
        execute: createNpmExecute(repackedPublishCalls),
        githubExecute,
      } as never),
    ).toThrow(/raw publication manifest digest/u);
    expect(repackedPublishCalls).toHaveLength(0);
  });

  test('publishes from a sterile external directory with canonical npm config', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-sterile-publication-'),
    );
    const maliciousHome = mkdtempSync(
      resolve(tmpdir(), 'opencoven-malicious-home-'),
    );
    fixtures.push(artifactRoot, maliciousHome);
    writeFileSync(
      resolve(maliciousHome, '.npmrc'),
      [
        'registry=https://capture.example.invalid/',
        '//capture.example.invalid/:_authToken=long-lived',
        'always-auth=true',
        '',
      ].join('\n'),
    );
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const publishCalls: Array<{
      arguments_: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    }> = [];

    publishReleaseArtifacts({
      root: sourceRoot,
      artifactRoot,
      version: VERSION,
      env: publicationEnvironment(sourceRoot, {
        HOME: maliciousHome,
        GH_TOKEN: 'github-token',
        GITHUB_TOKEN: 'github-token',
        HTTP_PROXY: 'http://capture.example.invalid',
        HTTPS_PROXY: 'http://capture.example.invalid',
        ALL_PROXY: 'http://capture.example.invalid',
        NO_PROXY: 'registry.npmjs.org',
        NODE_EXTRA_CA_CERTS: resolve(maliciousHome, 'capture-ca.pem'),
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        NPM_CONFIG_REGISTRY: 'https://capture.example.invalid/',
        npm_config_userconfig: resolve(maliciousHome, '.npmrc'),
        npm_config_globalconfig: resolve(maliciousHome, '.npmrc'),
        'npm_config_//capture.example.invalid/:_authToken': 'long-lived',
      }),
      execute: createNpmExecute(publishCalls),
      githubExecute: createGitHubExecute(authorization),
    } as never);

    expect(publishCalls).toHaveLength(4);
    const ciInfoPath = require.resolve('ci-info', {
      paths: [resolve(workspaceRoot, 'node_modules/npm')],
    });
    expect(
      execFileSync(
        process.execPath,
        [
          '-e',
          'process.stdout.write(String(require(process.argv[1]).GITHUB_ACTIONS))',
          ciInfoPath,
        ],
        {
          encoding: 'utf8',
          env: publishCalls[0]?.env,
        },
      ),
    ).toBe('true');
    for (const call of publishCalls) {
      expect(call.cwd.startsWith(sourceRoot)).toBe(false);
      expect(
        call.arguments_.some(
          (argument) =>
            argument === `--registry=${NPM_REGISTRY}`
            || argument === '--registry'
            || argument === NPM_REGISTRY,
        ),
      ).toBe(true);
      expect(call.arguments_).toContain('--ignore-scripts');
      expect(call.env.HOME).not.toBe(maliciousHome);
      expect(call.env.GH_TOKEN).toBeUndefined();
      expect(call.env.GITHUB_TOKEN).toBeUndefined();
      expect(call.env.HTTP_PROXY).toBeUndefined();
      expect(call.env.HTTPS_PROXY).toBeUndefined();
      expect(call.env.ALL_PROXY).toBeUndefined();
      expect(call.env.NO_PROXY).toBeUndefined();
      expect(call.env.NODE_EXTRA_CA_CERTS).toBeUndefined();
      expect(call.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
      expect(call.env.NPM_TOKEN).toBeUndefined();
      expect(call.env.NODE_AUTH_TOKEN).toBeUndefined();
      expect(call.env.NPM_CONFIG_REGISTRY).toBe(NPM_REGISTRY);
      expect(call.env.GITHUB_ACTIONS).toBe('true');
      expect(call.env.GITHUB_SERVER_URL).toBe('https://github.com');
      expect(call.env.GITHUB_REPOSITORY).toBe('OpenCoven/sdk');
      expect(call.env.GITHUB_WORKFLOW_REF).toBe(
        'OpenCoven/sdk/.github/workflows/release.yml@refs/heads/main',
      );
      expect(call.env.GITHUB_REF).toBe('refs/heads/main');
      expect(call.env.GITHUB_SHA).toBe(candidate.manifest.source.commit);
      expect(call.env.GITHUB_RUN_ID).toBe('11000');
      expect(call.env.GITHUB_RUN_ATTEMPT).toBe('1');
      expect(call.env.GITHUB_EVENT_NAME).toBe('workflow_dispatch');
      expect(call.env.GITHUB_REPOSITORY_ID).toBe('1337664127');
      expect(call.env.GITHUB_REPOSITORY_OWNER_ID).toBe('270919577');
      expect(call.env.RUNNER_ENVIRONMENT).toBe('github-hosted');
      expect(call.env.ACTIONS_ID_TOKEN_REQUEST_URL).toBe(
        'https://vstoken.actions.githubusercontent.com/test',
      );
      expect(call.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBe(
        'short-lived-oidc-request-token',
      );
      expect(
        call.arguments_.some(
          (argument) => argument.includes('capture.example.invalid'),
        ),
      ).toBe(false);
    }
  });

  test('installs the exact reviewed npm CLI without exposing publish credentials', () => {
    const sourceRoot = createReleaseFixture({ installedNpm: false });
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-npm-cli-publication-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const publishCalls: Array<{
      arguments_: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    }> = [];
    const npmExecute = createNpmExecute(publishCalls);
    let installCalls = 0;

    publishReleaseArtifacts({
      root: sourceRoot,
      artifactRoot,
      version: VERSION,
      env: publicationEnvironment(sourceRoot, {
        GH_TOKEN: 'github-token',
        NPM_CONFIG_REGISTRY: 'https://capture.example.invalid/',
        HTTPS_PROXY: 'http://capture.example.invalid',
      }),
      execute: (
        command: string,
        arguments_: string[],
        options: {
          cwd: string;
          env: Record<string, string | undefined>;
          encoding?: string;
          stdio: unknown;
        },
      ) => {
        if (command === 'pnpm') {
          installCalls += 1;
          expect(arguments_).toContain('--frozen-lockfile');
          expect(arguments_).toContain('--ignore-scripts');
          expect(arguments_).toContain(
            '--config.registry=https://registry.npmjs.org/',
          );
          expect(options.env.GH_TOKEN).toBeUndefined();
          expect(options.env.HTTPS_PROXY).toBeUndefined();
          expect(options.env.ACTIONS_ID_TOKEN_REQUEST_URL).toBeUndefined();
          expect(options.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
          expect(options.env.NPM_CONFIG_REGISTRY).toBe(NPM_REGISTRY);
          const npmRoot = resolve(sourceRoot, 'node_modules/npm');
          mkdirSync(resolve(npmRoot, 'bin'), { recursive: true });
          writeFileSync(
            resolve(npmRoot, 'package.json'),
            `${JSON.stringify({
              name: 'npm',
              version: NPM_VERSION,
            }, null, 2)}\n`,
          );
          writeFileSync(
            resolve(npmRoot, 'bin/npm-cli.js'),
            '#!/usr/bin/env node\n',
          );
          return '';
        }
        return npmExecute(command, arguments_, options);
      },
      githubExecute: createGitHubExecute(authorization),
    } as never);

    expect(installCalls).toBe(1);
    expect(publishCalls).toHaveLength(4);
  });

  test.each(['NPM_TOKEN', 'NODE_AUTH_TOKEN'])(
    'rejects long-lived authentication fallback through %s',
    (variable) => {
      const sourceRoot = createReleaseFixture();
      const artifactRoot = mkdtempSync(
        resolve(tmpdir(), 'opencoven-token-publication-'),
      );
      fixtures.push(artifactRoot);
      const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
      const authorization = createPublicationAuthorizationRecord({
        artifactId: '30000',
        jobId: '20000',
        manifest: candidate.manifest as never,
        manifestText: candidate.manifestText,
      });

      expect(() =>
        publishReleaseArtifacts({
          root: sourceRoot,
          artifactRoot,
          version: VERSION,
          env: publicationEnvironment(sourceRoot, {
            [variable]: 'long-lived-token',
          }),
          execute: createNpmExecute([]),
          githubExecute: createGitHubExecute(authorization),
        } as never),
      ).toThrow(/Token-based npm authentication is forbidden/u);
    },
  );

  test('rejects alternate resolved registries before invoking publish', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-registry-publication-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });
    const publishCalls: string[][] = [];
    const execute = createNpmExecute([]);

    expect(() =>
      publishReleaseArtifacts({
        root: sourceRoot,
        artifactRoot,
        version: VERSION,
        env: publicationEnvironment(sourceRoot),
        execute: (
          command: string,
          arguments_: string[],
          options: never,
        ) => {
          if (arguments_.includes('config') && arguments_.includes('list')) {
            return JSON.stringify({
              registry: 'https://capture.example.invalid/',
            });
          }
          if (arguments_.includes('publish')) {
            publishCalls.push([...arguments_]);
          }
          return execute(command, arguments_, options);
        },
        githubExecute: createGitHubExecute(authorization),
      } as never),
    ).toThrow(/Resolved npm registry must be https:\/\/registry\.npmjs\.org\//u);
    expect(publishCalls).toHaveLength(0);
  });

  test.each([
    ['//registry.npmjs.org/:_authToken', 'long-lived-token'],
    ['always-auth', true],
    ['proxy', 'http://capture.example.invalid'],
    ['strict-ssl', false],
  ])(
    'rejects resolved npm fallback config %s',
    (key, value) => {
      const sourceRoot = createReleaseFixture();
      const artifactRoot = mkdtempSync(
        resolve(tmpdir(), 'opencoven-config-fallback-publication-'),
      );
      fixtures.push(artifactRoot);
      const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
      const authorization = createPublicationAuthorizationRecord({
        artifactId: '30000',
        jobId: '20000',
        manifest: candidate.manifest as never,
        manifestText: candidate.manifestText,
      });
      const execute = createNpmExecute([]);

      expect(() =>
        publishReleaseArtifacts({
          root: sourceRoot,
          artifactRoot,
          version: VERSION,
          env: publicationEnvironment(sourceRoot),
          execute: (
            command: string,
            arguments_: string[],
            options: {
              cwd: string;
              env: Record<string, string | undefined>;
              encoding?: string;
              stdio: unknown;
            },
          ) => {
            if (
              arguments_.includes('config')
              && arguments_.includes('list')
            ) {
              return JSON.stringify({
                registry: NPM_REGISTRY,
                userconfig: options.env.NPM_CONFIG_USERCONFIG,
                globalconfig: options.env.NPM_CONFIG_GLOBALCONFIG,
                cache: options.env.NPM_CONFIG_CACHE,
                [key]: value,
              });
            }
            return execute(command, arguments_, options);
          },
          githubExecute: createGitHubExecute(authorization),
        } as never),
      ).toThrow(
        /Resolved npm configuration contains authentication or transport fallback/u,
      );
    },
  );

  test('rejects descendant commits and repository npm config drift', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-descendant-publication-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot);
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });

    writeFileSync(resolve(sourceRoot, 'descendant.txt'), 'descendant\n');
    git(sourceRoot, ['add', 'descendant.txt']);
    git(sourceRoot, ['commit', '--quiet', '-m', 'descendant']);
    expect(() =>
      publishReleaseArtifacts({
        root: sourceRoot,
        artifactRoot,
        version: VERSION,
        env: publicationEnvironment(sourceRoot),
        execute: createNpmExecute([]),
        githubExecute: createGitHubExecute(authorization),
      } as never),
    ).toThrow(/must equal the exact #40-authorized release commit and tree/u);

    const configRoot = createReleaseFixture();
    const configArtifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-config-publication-'),
    );
    fixtures.push(configArtifactRoot);
    writeFileSync(
      resolve(configRoot, '.npmrc'),
      'registry=https://capture.example.invalid/\n',
    );
    git(configRoot, ['add', '.npmrc']);
    git(configRoot, ['commit', '--quiet', '-m', 'malicious npm config']);
    const configCandidate = writePublicationArtifacts(
      configRoot,
      configArtifactRoot,
    );
    const configAuthorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: configCandidate.manifest as never,
      manifestText: configCandidate.manifestText,
    });
    expect(() =>
      publishReleaseArtifacts({
        root: configRoot,
        artifactRoot: configArtifactRoot,
        version: VERSION,
        env: publicationEnvironment(configRoot),
        execute: createNpmExecute([]),
        githubExecute: createGitHubExecute(configAuthorization),
      } as never),
    ).toThrow(/repository npm configuration is not canonical/u);

    const descendantConfigRoot = createReleaseFixture();
    const descendantArtifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-descendant-config-publication-'),
    );
    fixtures.push(descendantArtifactRoot);
    writeFileSync(
      resolve(descendantConfigRoot, 'packages/core/.npmrc'),
      'registry=https://capture.example.invalid/\n',
    );
    git(descendantConfigRoot, ['add', 'packages/core/.npmrc']);
    git(descendantConfigRoot, [
      'commit',
      '--quiet',
      '-m',
      'malicious descendant npm config',
    ]);
    const descendantConfigCandidate = writePublicationArtifacts(
      descendantConfigRoot,
      descendantArtifactRoot,
    );
    const descendantConfigAuthorization =
      createPublicationAuthorizationRecord({
        artifactId: '30000',
        jobId: '20000',
        manifest: descendantConfigCandidate.manifest as never,
        manifestText: descendantConfigCandidate.manifestText,
      });
    expect(() =>
      publishReleaseArtifacts({
        root: descendantConfigRoot,
        artifactRoot: descendantArtifactRoot,
        version: VERSION,
        env: publicationEnvironment(descendantConfigRoot),
        execute: createNpmExecute([]),
        githubExecute: createGitHubExecute(
          descendantConfigAuthorization,
        ),
      } as never),
    ).toThrow(/repository npm configuration is not canonical/u);
  });

  test('rejects publish lifecycle scripts even when #40 names those bytes', () => {
    const sourceRoot = createReleaseFixture();
    const artifactRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-lifecycle-publication-'),
    );
    fixtures.push(artifactRoot);
    const candidate = writePublicationArtifacts(sourceRoot, artifactRoot, {
      lifecyclePackage: '@opencoven/sdk-core',
    });
    const authorization = createPublicationAuthorizationRecord({
      artifactId: '30000',
      jobId: '20000',
      manifest: candidate.manifest as never,
      manifestText: candidate.manifestText,
    });

    expect(() =>
      publishReleaseArtifacts({
        root: sourceRoot,
        artifactRoot,
        version: VERSION,
        env: publicationEnvironment(sourceRoot),
        execute: createNpmExecute([]),
        githubExecute: createGitHubExecute(authorization),
      } as never),
    ).toThrow(/must not contain publish lifecycle scripts/u);
  });
});
