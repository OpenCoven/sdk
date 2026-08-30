import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  createReleaseEnvironmentPolicyReceipt,
  parseReleaseEnvironmentPolicyReceipt,
  serializeReleaseEnvironmentPolicyReceipt,
  verifyLiveReleaseEnvironmentPolicies,
} from '../scripts/github-environment-policy.mjs';
import type {
  ReleaseEnvironmentPolicyReceipt,
} from '../scripts/github-environment-policy.mjs';
import {
  readReleaseConfig,
  validateReleaseReadiness,
} from '../scripts/release-readiness.mjs';

const root = resolve(import.meta.dirname, '..');
const REVIEWER_ID = 68980965;
const ENVIRONMENT_NAMES = [
  'publication-candidate',
  'npm-release',
  'npm-publish',
] as const;

type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface LivePolicyFixture {
  repository: Record<string, unknown>;
  environments: Record<EnvironmentName, Record<string, unknown>>;
}

function environment(
  name: EnvironmentName,
  id: number,
): Record<string, unknown> {
  const requiredReviewers =
    name === 'npm-release'
      ? [
          {
            id: id + 1,
            node_id: `reviewer-rule-${name}`,
            type: 'required_reviewers',
            prevent_self_review: true,
            reviewers: [
              {
                type: 'User',
                reviewer: {
                  id: REVIEWER_ID,
                  login: 'BunsDev',
                  type: 'User',
                },
              },
            ],
          },
        ]
      : [];
  return {
    id,
    node_id: `environment-${name}`,
    name,
    can_admins_bypass: false,
    protection_rules: [
      ...requiredReviewers,
      {
        id: id + 2,
        node_id: `branch-rule-${name}`,
        type: 'branch_policy',
      },
    ],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
    created_at: '2026-08-29T20:00:00Z',
    updated_at: '2026-08-29T20:05:00Z',
  };
}

function livePolicyFixture(): LivePolicyFixture {
  return {
    repository: {
      id: 1337664127,
      node_id: 'R_kgDOT7sifw',
      name: 'sdk',
      full_name: 'OpenCoven/sdk',
      private: false,
      default_branch: 'main',
      owner: {
        id: 270919577,
        login: 'OpenCoven',
        type: 'Organization',
      },
    },
    environments: {
      'publication-candidate': environment(
        'publication-candidate',
        51_000,
      ),
      'npm-release': environment('npm-release', 20_778_492_972),
      'npm-publish': environment('npm-publish', 53_000),
    },
  };
}

function createGitHubExecute(
  fixture: LivePolicyFixture,
  calls: string[] = [],
) {
  return (command: string, arguments_: string[]): string => {
    expect(command).toBe('/usr/bin/gh');
    const endpoint = arguments_.at(-1) ?? '';
    calls.push(endpoint);
    if (endpoint === 'repos/OpenCoven/sdk') {
      return JSON.stringify(fixture.repository);
    }
    for (const name of ENVIRONMENT_NAMES) {
      if (
        endpoint
          === `repos/OpenCoven/sdk/environments/${encodeURIComponent(name)}`
      ) {
        return JSON.stringify(fixture.environments[name]);
      }
    }
    throw new Error(`Unexpected GitHub endpoint ${endpoint}`);
  };
}

function verifyFixture(fixture = livePolicyFixture()) {
  return verifyLiveReleaseEnvironmentPolicies({
    config: readReleaseConfig(root),
    execute: createGitHubExecute(fixture),
    env: { GH_TOKEN: 'github-token' },
    now: () => new Date('2026-08-29T21:00:00Z'),
  });
}

describe('authoritative release environment policy', () => {
  test('rejects a missing environment instead of allowing GitHub to auto-create it unprotected', () => {
    const fixture = livePolicyFixture();
    const execute = createGitHubExecute(fixture);

    expect(() =>
      verifyLiveReleaseEnvironmentPolicies({
        config: readReleaseConfig(root),
        execute: (command: string, arguments_: string[]) => {
          const endpoint = arguments_.at(-1) ?? '';
          if (endpoint === 'repos/OpenCoven/sdk/environments/npm-publish') {
            throw new Error('HTTP 404: Not Found');
          }
          return execute(command, arguments_);
        },
        env: { GH_TOKEN: 'github-token' },
      }),
    ).toThrow(/required GitHub release environment npm-publish is missing/iu);
  });

  test('rejects an auto-created unprotected environment', () => {
    const fixture = livePolicyFixture();
    fixture.environments['npm-publish'] = {
      ...fixture.environments['npm-publish'],
      can_admins_bypass: false,
      protection_rules: [],
      deployment_branch_policy: null,
    };

    expect(() => verifyFixture(fixture)).toThrow(
      /npm-publish.*protected branches only/u,
    );
  });

  test('rejects an evil branch allowance through a custom deployment policy', () => {
    const fixture = livePolicyFixture();
    fixture.environments['npm-publish'].deployment_branch_policy = {
      protected_branches: false,
      custom_branch_policies: true,
    };

    expect(() => verifyFixture(fixture)).toThrow(
      /npm-publish.*protected branches only/u,
    );
  });

  test('rejects administrator bypass on every release environment', () => {
    const fixture = livePolicyFixture();
    fixture.environments['publication-candidate'].can_admins_bypass = true;

    expect(() => verifyFixture(fixture)).toThrow(
      /publication-candidate.*administrator bypass/u,
    );
  });

  test('rejects a substituted required reviewer immutable id', () => {
    const fixture = livePolicyFixture();
    const rules = fixture.environments['npm-release']
      .protection_rules as Array<Record<string, unknown>>;
    const reviewerRule = rules.find(
      (rule) => rule.type === 'required_reviewers',
    ) as {
      reviewers: Array<{
        reviewer: {
          id: number;
        };
      }>;
    };
    reviewerRule.reviewers[0]!.reviewer.id = REVIEWER_ID + 1;

    expect(() => verifyFixture(fixture)).toThrow(
      /npm-release.*immutable reviewer ids/u,
    );
  });

  test.each([
    [
      'wait timer',
      {
        id: 63_000,
        node_id: 'unexpected-wait-timer',
        type: 'wait_timer',
        wait_timer: 5,
      },
    ],
    [
      'deployment protection app',
      {
        id: 63_001,
        node_id: 'unexpected-protection-app',
        type: 'custom',
      },
    ],
  ])('rejects an unexpected %s protection rule', (_label, rule) => {
    const fixture = livePolicyFixture();
    (
      fixture.environments['npm-publish']
        .protection_rules as Array<Record<string, unknown>>
    ).push(rule);

    expect(() => verifyFixture(fixture)).toThrow(
      /npm-publish.*unexpected protection rule/u,
    );
  });

  test('accepts and canonically digests the exact three-environment policy', () => {
    const receipt = verifyFixture();
    const serialized = serializeReleaseEnvironmentPolicyReceipt(receipt);

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: 'opencoven-sdk-release-environment-policy',
      verifiedAt: '2026-08-29T21:00:00.000Z',
      repository: {
        id: '1337664127',
        nodeId: 'R_kgDOT7sifw',
        fullName: 'OpenCoven/sdk',
        owner: {
          id: '270919577',
          login: 'OpenCoven',
          type: 'Organization',
        },
      },
      environments: [
        {
          name: 'publication-candidate',
          waitTimer: 0,
          preventSelfReview: false,
          requiredReviewerIds: [],
          deploymentBranchPolicy: {
            protectedBranches: true,
            customBranchPolicies: false,
          },
        },
        {
          name: 'npm-release',
          waitTimer: 0,
          preventSelfReview: true,
          requiredReviewerIds: [REVIEWER_ID],
          deploymentBranchPolicy: {
            protectedBranches: true,
            customBranchPolicies: false,
          },
        },
        {
          name: 'npm-publish',
          waitTimer: 0,
          preventSelfReview: false,
          requiredReviewerIds: [],
          deploymentBranchPolicy: {
            protectedBranches: true,
            customBranchPolicies: false,
          },
        },
      ],
    });
    expect(receipt.policyDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(parseReleaseEnvironmentPolicyReceipt(serialized)).toEqual(receipt);
    expect(
      createReleaseEnvironmentPolicyReceipt({
        repository: fixtureRepository(receipt),
        environments: fixtureEnvironments(receipt),
        verifiedAt: receipt.verifiedAt,
      }),
    ).toEqual(receipt);
  });

  test('runs live environment verification before canonical readiness can pass', () => {
    const fixture = livePolicyFixture();
    const calls: string[] = [];

    expect(() =>
      validateReleaseReadiness({
        root,
        githubExecute: createGitHubExecute(fixture, calls),
        env: { GH_TOKEN: 'github-token' },
        environmentPolicyNow: () =>
          new Date('2026-08-29T21:00:00Z'),
      }),
    ).toThrow(
      'release.config.json must name a passing SDK #38 aggregate record',
    );
    expect(calls).toContain('repos/OpenCoven/sdk/environments/npm-publish');
  });

  test('wires the live policy gate into every canonical release path', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const workflow = readFileSync(
      resolve(root, '.github/workflows/release.yml'),
      'utf8',
    );
    const artifactBuilder = readFileSync(
      resolve(root, 'scripts/create-release-artifacts.mjs'),
      'utf8',
    );

    expect(manifest.scripts['verify:release-environments']).toBe(
      'node ./scripts/verify-github-environment-policies.mjs',
    );
    expect(manifest.scripts['verify:release']).toBe(
      'node ./scripts/verify-release-readiness.mjs',
    );
    expect(manifest.scripts['verify:development-release-configuration']).toBe(
      'node ./scripts/verify-development-release-configuration.mjs',
    );
    expect(workflow).not.toContain('--require-live-environment-policy');
    expect(artifactBuilder).toMatch(
      /export function createPublicationArtifacts[\s\S]*const readiness = validateReleaseReadiness\(/u,
    );
  });
});

function fixtureRepository(
  receipt: ReleaseEnvironmentPolicyReceipt,
): Record<string, unknown> {
  const repository = receipt.repository as {
    id: string;
    nodeId: string;
    name: string;
    fullName: string;
    private: boolean;
    defaultBranch: string;
    owner: {
      id: string;
      login: string;
      type: string;
    };
  };
  return {
    id: Number(repository.id),
    node_id: repository.nodeId,
    name: repository.name,
    full_name: repository.fullName,
    private: repository.private,
    default_branch: repository.defaultBranch,
    owner: {
      id: Number(repository.owner.id),
      login: repository.owner.login,
      type: repository.owner.type,
    },
  };
}

function fixtureEnvironments(
  receipt: ReleaseEnvironmentPolicyReceipt,
): Array<Record<string, unknown>> {
  return receipt.environments.map((environment) => {
    const value = environment as {
      id: string;
      nodeId: string;
      name: EnvironmentName;
      canAdminsBypass: boolean;
      createdAt: string;
      updatedAt: string;
      preventSelfReview: boolean;
      requiredReviewerIds: number[];
      deploymentBranchPolicy: {
        protectedBranches: boolean;
        customBranchPolicies: boolean;
      };
    };
    return {
      id: Number(value.id),
      node_id: value.nodeId,
      name: value.name,
      can_admins_bypass: value.canAdminsBypass,
      protection_rules: [
        ...(value.requiredReviewerIds.length === 0
          ? []
          : [
              {
                id: Number(value.id) + 1,
                node_id: `reviewer-rule-${value.name}`,
                type: 'required_reviewers',
                prevent_self_review: value.preventSelfReview,
                reviewers: value.requiredReviewerIds.map((id) => ({
                  type: 'User',
                  reviewer: {
                    id,
                    login: 'BunsDev',
                    type: 'User',
                  },
                })),
              },
            ]),
        {
          id: Number(value.id) + 2,
          node_id: `branch-rule-${value.name}`,
          type: 'branch_policy',
        },
      ],
      deployment_branch_policy: {
        protected_branches:
          value.deploymentBranchPolicy.protectedBranches,
        custom_branch_policies:
          value.deploymentBranchPolicy.customBranchPolicies,
      },
      created_at: value.createdAt,
      updated_at: value.updatedAt,
    };
  });
}
