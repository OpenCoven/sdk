import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const lockPath = resolve(root, 'conformance/automations-v1-artifact-lock.json');
const scriptPath = resolve(root, 'scripts/verify-automations-v1-artifact-evidence.mjs');
const workflowPath = resolve(root, '.github/workflows/ci.yml');
const scratchRoots: string[] = [];
const servers: Server[] = [];

interface ArtifactEvidenceLock {
  schemaVersion: number;
  issue: string;
  parentIssue: string;
  producer: {
    repository: string;
    repositoryId: number;
    sourceCommit: string;
    sourceTree: string;
    workflow: {
      id: number;
      name: string;
      path: string;
      runId: number;
      runAttempt: number;
      event: string;
      headBranch: string;
      size: number;
      sha256: string;
    };
    job: {
      id: number;
      name: string;
      runnerLabels: string[];
    };
  };
  artifact: {
    id: number;
    name: string;
    archiveSize: number;
    archiveSha256: string;
    bundle: {
      path: string;
      size: number;
      sha256: string;
    };
    manifest: {
      path: string;
      size: number;
      sha256: string;
    };
  };
  contract: {
    profile: string;
    contentSha256: string;
    manifestFiles: number;
  };
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readLock(): ArtifactEvidenceLock {
  return JSON.parse(readFileSync(lockPath, 'utf8')) as ArtifactEvidenceLock;
}

function writeLock(lock: ArtifactEvidenceLock): string {
  const scratch = mkdtempSync(resolve(tmpdir(), 'opencoven-automations-evidence-spec-'));
  scratchRoots.push(scratch);
  const path = resolve(scratch, 'lock.json');
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return path;
}

async function startApi(
  lock: ArtifactEvidenceLock,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const workflowBytes = Buffer.from('name: pinned producer workflow\n', 'utf8');
  lock.producer.workflow.size = workflowBytes.length;
  lock.producer.workflow.sha256 = sha256(workflowBytes);

  const responses: Record<string, unknown> = {
    repository: {
      id: lock.producer.repositoryId,
      full_name: lock.producer.repository,
      private: false,
      archived: false,
    },
    commit: {
      sha: lock.producer.sourceCommit,
      tree: {
        sha: lock.producer.sourceTree,
      },
    },
    artifact: {
      id: lock.artifact.id,
      name: lock.artifact.name,
      size_in_bytes: lock.artifact.archiveSize,
      digest: `sha256:${lock.artifact.archiveSha256}`,
      expired: false,
      workflow_run: {
        id: lock.producer.workflow.runId,
        repository_id: lock.producer.repositoryId,
        head_repository_id: lock.producer.repositoryId,
        head_branch: lock.producer.workflow.headBranch,
        head_sha: lock.producer.sourceCommit,
      },
    },
    run: {
      id: lock.producer.workflow.runId,
      name: lock.producer.workflow.name,
      path: lock.producer.workflow.path,
      event: lock.producer.workflow.event,
      status: 'completed',
      conclusion: 'success',
      head_sha: lock.producer.sourceCommit,
      head_branch: lock.producer.workflow.headBranch,
      run_attempt: lock.producer.workflow.runAttempt,
      workflow_id: lock.producer.workflow.id,
    },
    jobs: {
      total_count: 1,
      jobs: [
        {
          id: lock.producer.job.id,
          name: lock.producer.job.name,
          status: 'completed',
          conclusion: 'success',
          labels: lock.producer.job.runnerLabels,
        },
      ],
    },
    workflow: {
      type: 'file',
      encoding: 'base64',
      size: workflowBytes.length,
      content: workflowBytes.toString('base64'),
    },
    ...overrides,
  };

  const routes = new Map<string, unknown>([
    [`/repositories/${lock.producer.repositoryId}`, responses.repository],
    [
      `/repos/${lock.producer.repository}/git/commits/${lock.producer.sourceCommit}`,
      responses.commit,
    ],
    [
      `/repos/${lock.producer.repository}/actions/artifacts/${lock.artifact.id}`,
      responses.artifact,
    ],
    [
      `/repos/${lock.producer.repository}/actions/runs/${lock.producer.workflow.runId}`,
      responses.run,
    ],
    [
      `/repos/${lock.producer.repository}/actions/runs/${lock.producer.workflow.runId}/jobs?per_page=100`,
      responses.jobs,
    ],
    [
      `/repos/${lock.producer.repository}/contents/${lock.producer.workflow.path}?ref=${lock.producer.sourceCommit}`,
      responses.workflow,
    ],
  ]);

  const server = createServer((request, response) => {
    const body = routes.get(request.url ?? '');
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"message":"not found"}\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(`${JSON.stringify(body)}\n`);
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP test server.');
  }
  return `http://127.0.0.1:${address.port}`;
}

function runEvidence(
  lock: ArtifactEvidenceLock,
  apiUrl: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const path = writeLock(lock);
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath, '--lock', path], {
      cwd: root,
      env: {
        ...process.env,
        OPENCOVEN_AUTOMATIONS_EVIDENCE_TEST_API_URL: apiUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (status) => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error === undefined) {
              resolveClose();
            } else {
              rejectClose(error);
            }
          });
        }),
    ),
  );
  for (const scratch of scratchRoots.splice(0)) {
    rmSync(scratch, { force: true, recursive: true });
  }
});

describe('Automations v1 artifact evidence', () => {
  test('pins the exact producer run, job, artifact, and contract identities', () => {
    const lock = readLock();

    expect(lock).toMatchObject({
      schemaVersion: 1,
      issue: 'OpenCoven/sdk#80',
      parentIssue: 'OpenCoven/coven#855',
      producer: {
        repository: 'OpenCoven/coven',
        repositoryId: 1222160568,
        sourceCommit: '8a796807b37d4ad33eaeca37498debf1ca55dd49',
        sourceTree: 'bf0261a187139773ce87d97c880669b4532e53c9',
        workflow: {
          id: 267192017,
          name: 'CI',
          path: '.github/workflows/ci.yml',
          runId: 33798101313,
          runAttempt: 1,
          event: 'push',
          headBranch: 'main',
          size: 25064,
          sha256: 'c8061bd914b31e0fd77cf73f1301ae8a04a127f68783fa7fbbc41c92f92bac14',
        },
        job: {
          id: 100790644364,
          name: 'Automations v1 protocol bundle',
          runnerLabels: ['ubuntu-latest'],
        },
      },
      artifact: {
        id: 9909975069,
        name: 'coven-automations-v1-contract-8a796807b37d4ad33eaeca37498debf1ca55dd49',
        archiveSize: 36232,
        archiveSha256: '6f2e239a4694a1f11223a9dc72f5f31971ead0a1b94ff3137fb39b75611a95ac',
        bundle: {
          path: 'coven-automations-v1-contract-8a796807b37d4ad33eaeca37498debf1ca55dd49.tar.gz',
          size: 34712,
          sha256: '512460db71d4257d7a4d33ea306578e66d9ac499d9384eb9c2b8e2b4e2e32363',
        },
        manifest: {
          path: 'manifest.json',
          size: 2964,
          sha256: '449d79f0a47fd299d0c560bf4a5f63be383e9825067d3ac992cb97ce067c86d2',
        },
      },
      contract: {
        profile: 'coven.automations.v1',
        contentSha256: '3c145eb92a93426ed64631f6487a8cd12903b0a49a6e752269f594ac50a779f5',
        manifestFiles: 17,
      },
    });
  });

  test('authenticates the live GitHub repository, workflow, run, job, and artifact metadata', async () => {
    const lock = readLock();
    const apiUrl = await startApi(lock);

    const result = await runEvidence(lock, apiUrl);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'Automations v1 artifact evidence verified: artifactId=9909975069',
    );
    expect(result.stdout).toContain(
      'sourceCommit=8a796807b37d4ad33eaeca37498debf1ca55dd49',
    );
    expect(result.stdout).toContain(
      'bundleSha256=512460db71d4257d7a4d33ea306578e66d9ac499d9384eb9c2b8e2b4e2e32363',
    );
  });

  test('accepts the live producer job runner labels in any order', async () => {
    const lock = readLock();
    lock.producer.job.runnerLabels = ['ubuntu-latest', 'x64'];
    const apiUrl = await startApi(lock, {
      jobs: {
        total_count: 1,
        jobs: [
          {
            id: lock.producer.job.id,
            name: lock.producer.job.name,
            status: 'completed',
            conclusion: 'success',
            labels: ['x64', 'ubuntu-latest'],
          },
        ],
      },
    });

    const result = await runEvidence(lock, apiUrl);

    expect(result.status, result.stderr).toBe(0);
  });

  test('rejects live artifact archive digest drift', async () => {
    const lock = readLock();
    const artifact = {
      id: lock.artifact.id,
      name: lock.artifact.name,
      size_in_bytes: lock.artifact.archiveSize,
      digest: `sha256:${'0'.repeat(64)}`,
      expired: false,
      workflow_run: {
        id: lock.producer.workflow.runId,
        repository_id: lock.producer.repositoryId,
        head_repository_id: lock.producer.repositoryId,
        head_branch: lock.producer.workflow.headBranch,
        head_sha: lock.producer.sourceCommit,
      },
    };
    const apiUrl = await startApi(lock, { artifact });

    const result = await runEvidence(lock, apiUrl);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/artifact archive digest does not match the lock/u);
  });

  test('rejects producer workflow byte drift', async () => {
    const lock = readLock();
    const apiUrl = await startApi(lock);
    lock.producer.workflow.sha256 = '0'.repeat(64);

    const result = await runEvidence(lock, apiUrl);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/producer workflow SHA-256 does not match the lock/u);
  });

  test('wires durable exact-byte reproduction into the exact-runtime CI path', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.['verify:automations-v1-evidence']).toBe(
      'node ./scripts/verify-automations-v1-artifact-evidence.mjs',
    );
    expect(workflow).toContain('repository: OpenCoven/coven');
    expect(workflow).toContain(
      'ref: 8a796807b37d4ad33eaeca37498debf1ca55dd49',
    );
    expect(workflow).toContain('path: .artifacts/coven-automations-authority');
    expect(workflow).toContain('- name: Reproduce and verify pinned Automations v1 artifact');
    expect(workflow).toContain("if: matrix.node == '24.18.1'");
    expect(workflow).toContain(
      'node ./.artifacts/coven-automations-authority/scripts/package-automations-protocol.mjs',
    );
    expect(workflow).toContain(
      '--bundle-sha256 512460db71d4257d7a4d33ea306578e66d9ac499d9384eb9c2b8e2b4e2e32363',
    );
    expect(workflow).toContain(
      '--content-sha256 3c145eb92a93426ed64631f6487a8cd12903b0a49a6e752269f594ac50a779f5',
    );
    expect(workflow).not.toContain(
      'run: corepack pnpm@10.34.0 verify:automations-v1-evidence',
    );
    expect(workflow.indexOf('Reproduce and verify pinned Automations v1 artifact')).toBeLessThan(
      workflow.indexOf('Verify exact release runtime'),
    );
  });
});
