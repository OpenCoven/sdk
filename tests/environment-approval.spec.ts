import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import {
  capturePendingApprovalEvidence,
} from '../scripts/github-environment-approval-evidence.mjs';

const approvalModule = await import(
  '../scripts/github-environment-approval.mjs'
).catch(() => null);

interface ApprovalModule {
  createPendingApprovalEvidence(options: {
    source: {
      repository: string;
      commit: string;
      tree: string;
    };
    workflow: {
      path: string;
      commit: string;
      ref: string;
      runId: string;
      runAttempt: number;
    };
    witnessJob: {
      id: string;
      name: string;
      startedAt: string;
    };
    environment: Record<string, unknown>;
    pendingDeployments: unknown[];
    observedAt: string;
    expected: {
      environment: string;
      environmentId: string;
      reviewer: {
        id: number;
        authorAssociation: string;
        permission: string;
        roleName: string;
      };
      witnessJob: string;
      approvalJob: string;
    };
  }): Record<string, unknown>;
  createProtectedApprovalReceipt(options: {
    pendingEvidence: Record<string, unknown>;
    pendingEvidenceFile: {
      file: string;
      size: number;
      sha256: string;
      artifactId: string;
      artifactName: string;
    };
    approvalJob: {
      id: string;
      name: string;
      startedAt: string;
    };
    deployment: Record<string, unknown>;
    environment: Record<string, unknown>;
    securityReview: {
      commentId: string;
      tag: {
        name: string;
        ref: string;
        objectId: string;
        commit: string;
        tree: string;
      };
      reviewer: {
        id: number;
        login: string;
        authorAssociation: string;
        permission: string;
        roleName: string;
      };
    };
    createdAt: string;
    publishJob: {
      id: string;
      name: string;
    };
    expected: {
      environment: string;
      environmentId: string;
      reviewer: {
        id: number;
        authorAssociation: string;
        permission: string;
        roleName: string;
      };
      witnessJob: string;
      approvalJob: string;
    };
  }): Record<string, unknown>;
}

function approval(): ApprovalModule {
  expect(approvalModule).not.toBeNull();
  if (approvalModule === null) {
    throw new Error('GitHub environment approval module is missing');
  }
  return approvalModule as unknown as ApprovalModule;
}

const expected = {
  environment: 'npm-release',
  environmentId: '20778492972',
  reviewer: {
    id: 68980965,
    authorAssociation: 'MEMBER',
    permission: 'admin',
    roleName: 'admin',
  },
  witnessJob: 'approval-witness',
  witnessAttestationJob: 'approval-witness-attestation',
  approvalJob: 'approval-evidence',
  approvalAttestationJob: 'approval-evidence-attestation',
  publishJob: 'publish',
};

const source = {
  repository: 'OpenCoven/sdk',
  commit: 'a'.repeat(40),
  tree: 'b'.repeat(40),
};

const workflow = {
  path: '.github/workflows/release.yml',
  commit: source.commit,
  ref: 'refs/heads/main',
  runId: '11000',
  runAttempt: 1,
};

const releaseTag = {
  name: 'sdk-v0.1.0',
  ref: 'refs/tags/sdk-v0.1.0',
  objectId: 'c'.repeat(40),
  commit: source.commit,
  tree: source.tree,
};

const environment = {
  id: 20778492972,
  name: 'npm-release',
  can_admins_bypass: false,
  protection_rules: [
    {
      type: 'required_reviewers',
      prevent_self_review: true,
      reviewers: [
        {
          type: 'User',
          reviewer: {
            id: 68980965,
            login: 'BunsDev',
            type: 'User',
          },
        },
      ],
    },
    {
      type: 'branch_policy',
    },
  ],
  deployment_branch_policy: {
    protected_branches: true,
    custom_branch_policies: false,
  },
  created_at: '2026-08-28T10:00:00Z',
  updated_at: '2026-08-28T10:00:00Z',
};

const pendingDeployments = [
  {
    environment: {
      id: 20778492972,
      name: 'npm-release',
    },
    wait_timer: 0,
    wait_timer_started_at: null,
    current_user_can_approve: false,
    reviewers: [
      {
        type: 'User',
        reviewer: {
          id: 68980965,
          login: 'BunsDev',
          type: 'User',
        },
      },
    ],
  },
];

describe('protected environment approval evidence', () => {
  test('snapshots environment rules only after the pending deployment is observed', () => {
    const root = resolve(import.meta.dirname, '..');
    const outputRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-pending-snapshot-'),
    );
    const commit = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    let pendingObserved = false;
    let environmentReads = 0;

    try {
      const result = capturePendingApprovalEvidence({
        root,
        outputRoot,
        env: {
          GH_TOKEN: 'github-token',
          GITHUB_REPOSITORY: 'OpenCoven/sdk',
          GITHUB_SHA: commit,
          GITHUB_WORKFLOW_SHA: commit,
          GITHUB_WORKFLOW_REF:
            'OpenCoven/sdk/.github/workflows/release.yml@refs/heads/main',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_RUN_ID: '11000',
          GITHUB_RUN_ATTEMPT: '1',
        },
        resolveRuntime: () => undefined,
        now: () => new Date('2026-08-29T16:00:02Z'),
        sleep: () => undefined,
        execute: (
          command: string,
          arguments_: string[],
        ): string => {
          expect(command).toBe('/usr/bin/gh');
          const endpoint = arguments_.at(-1);
          if (endpoint === 'repos/OpenCoven/sdk/actions/runs/11000') {
            return JSON.stringify({
              id: 11000,
              event: 'workflow_dispatch',
              run_attempt: 1,
              head_sha: commit,
              head_branch: 'main',
              path: '.github/workflows/release.yml',
              repository: { full_name: 'OpenCoven/sdk' },
              head_repository: { full_name: 'OpenCoven/sdk' },
            });
          }
          if (
            endpoint
              === 'repos/OpenCoven/sdk/actions/runs/11000/attempts/1/jobs?per_page=100'
          ) {
            return JSON.stringify({
              jobs: [
                {
                  id: 21000,
                  name: 'approval-witness',
                  run_id: 11000,
                  run_attempt: 1,
                  head_sha: commit,
                  started_at: '2026-08-29T16:00:00Z',
                  completed_at: null,
                  status: 'in_progress',
                  conclusion: null,
                },
              ],
            });
          }
          if (
            endpoint
              === 'repos/OpenCoven/sdk/actions/runs/11000/pending_deployments'
          ) {
            pendingObserved = true;
            return JSON.stringify(pendingDeployments);
          }
          if (endpoint === 'repos/OpenCoven/sdk/environments/npm-release') {
            environmentReads += 1;
            return JSON.stringify({
              ...environment,
              updated_at: pendingObserved
                ? '2026-08-29T16:00:01Z'
                : '2026-08-29T15:00:00Z',
            });
          }
          throw new Error(`Unexpected endpoint ${endpoint}`);
        },
      } as never);

      expect(environmentReads).toBe(1);
      expect(result.evidence.environment.rulesUpdatedAt).toBe(
        '2026-08-29T16:00:01.000Z',
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test('fails closed when current rules exist but no pending deployment was witnessed', () => {
    expect(() =>
      approval().createPendingApprovalEvidence({
        source,
        workflow,
        witnessJob: {
          id: '21000',
          name: 'approval-witness',
          startedAt: '2026-08-29T16:00:00Z',
        },
        environment,
        pendingDeployments: [],
        observedAt: '2026-08-29T16:00:01Z',
        expected,
      }),
    ).toThrow(/pending protected-environment approval/u);
  });

  test('rejects retrospective protection changes and admin bypass', () => {
    expect(() =>
      approval().createPendingApprovalEvidence({
        source,
        workflow,
        witnessJob: {
          id: '21000',
          name: 'approval-witness',
          startedAt: '2026-08-29T16:00:00Z',
        },
        environment: {
          ...environment,
          can_admins_bypass: true,
        },
        pendingDeployments,
        observedAt: '2026-08-29T16:00:01Z',
        expected,
      }),
    ).toThrow(/administrators must not be able to bypass/u);
  });

  test('rejects protection rules enabled after the pending observation', () => {
    expect(() =>
      approval().createPendingApprovalEvidence({
        source,
        workflow,
        witnessJob: {
          id: '21000',
          name: 'approval-witness',
          startedAt: '2026-08-29T16:00:00Z',
        },
        environment: {
          ...environment,
          updated_at: '2026-08-29T16:00:02Z',
        },
        pendingDeployments,
        observedAt: '2026-08-29T16:00:01Z',
        expected,
      }),
    ).toThrow(/protection rules must predate the pending witness/u);
  });

  test('binds a witnessed pending deployment to the exact immutable reviewer id', () => {
    const evidence = approval().createPendingApprovalEvidence({
      source,
      workflow,
      witnessJob: {
        id: '21000',
        name: 'approval-witness',
        startedAt: '2026-08-29T16:00:00Z',
      },
      environment,
      pendingDeployments,
      observedAt: '2026-08-29T16:00:01Z',
      expected,
    });

    expect(evidence).toMatchObject({
      kind: 'opencoven-sdk-pending-environment-approval',
      environment: {
        id: '20778492972',
        name: 'npm-release',
      },
      reviewer: {
        id: 68980965,
      },
    });
  });

  test('rejects a protected receipt created before the pending witness', () => {
    const pendingEvidence = approval().createPendingApprovalEvidence({
      source,
      workflow,
      witnessJob: {
        id: '21000',
        name: 'approval-witness',
        startedAt: '2026-08-29T16:00:00Z',
      },
      environment,
      pendingDeployments,
      observedAt: '2026-08-29T16:00:02Z',
      expected,
    });

    expect(() =>
      approval().createProtectedApprovalReceipt({
        pendingEvidence,
        pendingEvidenceFile: {
          file: 'pending-approval.json',
          size: 100,
          sha256: 'c'.repeat(64),
          artifactId: '31000',
          artifactName: 'opencoven-sdk-pending-approval-11000-1',
        },
        approvalJob: {
          id: '22000',
          name: 'approval-evidence',
          startedAt: '2026-08-29T16:00:01Z',
        },
        deployment: {
          id: 41000,
          sha: source.commit,
          ref: 'main',
          task: 'deploy',
          environment: 'npm-release',
          transient_environment: false,
          performed_via_github_app: {
            slug: 'github-actions',
          },
          created_at: '2026-08-29T16:00:00Z',
        },
        environment,
        securityReview: {
          commentId: '4001',
          tag: releaseTag,
          reviewer: {
            id: 68980965,
            login: 'BunsDev',
            authorAssociation: 'MEMBER',
            permission: 'admin',
            roleName: 'admin',
          },
        },
        createdAt: '2026-08-29T16:00:03Z',
        publishJob: {
          id: '23000',
          name: 'publish',
        },
        expected,
      }),
    ).toThrow(/must start after the pending approval witness/u);
  });

  test('accepts a protected job reported in the same second as the pending witness', () => {
    const pendingEvidence = approval().createPendingApprovalEvidence({
      source,
      workflow,
      witnessJob: {
        id: '21000',
        name: 'approval-witness',
        startedAt: '2026-08-29T16:00:00Z',
      },
      environment,
      pendingDeployments,
      observedAt: '2026-08-29T16:00:01.500Z',
      expected,
    });

    const receipt = approval().createProtectedApprovalReceipt({
        pendingEvidence,
        pendingEvidenceFile: {
          file: 'pending-approval.json',
          size: 100,
          sha256: 'c'.repeat(64),
          artifactId: '31000',
          artifactName: 'opencoven-sdk-pending-approval-11000-1',
        },
        approvalJob: {
          id: '22000',
          name: 'approval-evidence',
          startedAt: '2026-08-29T16:00:01Z',
        },
        publishJob: {
          id: '23000',
          name: 'publish',
        },
        deployment: {
          id: 41000,
          sha: source.commit,
          ref: 'main',
          task: 'deploy',
          environment: 'npm-release',
          transient_environment: false,
          performed_via_github_app: {
            slug: 'github-actions',
          },
          created_at: '2026-08-29T16:00:01Z',
        },
        environment,
        securityReview: {
          commentId: '4001',
          tag: releaseTag,
          reviewer: {
            id: 68980965,
            login: 'BunsDev',
            authorAssociation: 'MEMBER',
            permission: 'admin',
            roleName: 'admin',
          },
        },
        createdAt: '2026-08-29T16:00:01.750Z',
        expected,
      });

    expect(receipt).toMatchObject({
      schemaVersion: 2,
      securityReview: {
        commentId: '4001',
        tag: releaseTag,
      },
    });
  });

  test('rejects a pending reviewer login with a substituted immutable id', () => {
    const substitutedPending = structuredClone(pendingDeployments);
    (
      substitutedPending[0] as {
        reviewers: Array<{
          reviewer: {
            id: number;
          };
        }>;
      }
    ).reviewers[0]!.reviewer.id = 99999999;

    expect(() =>
      approval().createPendingApprovalEvidence({
        source,
        workflow,
        witnessJob: {
          id: '21000',
          name: 'approval-witness',
          startedAt: '2026-08-29T16:00:00Z',
        },
        environment,
        pendingDeployments: substitutedPending,
        observedAt: '2026-08-29T16:00:01Z',
        expected,
      }),
    ).toThrow(/immutable reviewer id/u);
  });

  test('rejects a receipt that is not bound to the final publishing job', () => {
    const pendingEvidence = approval().createPendingApprovalEvidence({
      source,
      workflow,
      witnessJob: {
        id: '21000',
        name: 'approval-witness',
        startedAt: '2026-08-29T16:00:00Z',
      },
      environment,
      pendingDeployments,
      observedAt: '2026-08-29T16:00:01Z',
      expected,
    });

    expect(() =>
      approval().createProtectedApprovalReceipt({
        pendingEvidence,
        pendingEvidenceFile: {
          file: 'pending-approval.json',
          size: 100,
          sha256: 'c'.repeat(64),
          artifactId: '31000',
          artifactName: 'opencoven-sdk-pending-approval-11000-1',
        },
        approvalJob: {
          id: '22000',
          name: 'approval-evidence',
          startedAt: '2026-08-29T16:00:02Z',
        },
        publishJob: {
          id: '22999',
          name: 'not-publish',
        },
        deployment: {
          id: 41000,
          sha: source.commit,
          ref: 'main',
          task: 'deploy',
          environment: 'npm-release',
          transient_environment: false,
          performed_via_github_app: {
            slug: 'github-actions',
          },
          created_at: '2026-08-29T16:00:00Z',
        },
        environment,
        securityReview: {
          commentId: '4001',
          tag: releaseTag,
          reviewer: {
            id: 68980965,
            login: 'BunsDev',
            authorAssociation: 'MEMBER',
            permission: 'admin',
            roleName: 'admin',
          },
        },
        createdAt: '2026-08-29T16:00:03Z',
        expected,
      }),
    ).toThrow(/publishJob must use the exact expected name/u);
  });
});
