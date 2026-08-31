import type { ReleaseConfig } from './release-readiness.mjs';

export interface ReleaseEnvironmentPolicyRepository {
  id: '1337664127';
  nodeId: 'R_kgDOT7sifw';
  name: 'sdk';
  fullName: 'OpenCoven/sdk';
  private: false;
  defaultBranch: 'main';
  owner: {
    id: '270919577';
    login: 'OpenCoven';
    type: 'Organization';
  };
}

export interface ReleaseEnvironmentPolicy {
  id: string;
  nodeId: string;
  name: 'publication-candidate' | 'npm-release' | 'npm-publish';
  canAdminsBypass: false;
  createdAt: string;
  updatedAt: string;
  waitTimer: 0;
  preventSelfReview: boolean;
  requiredReviewerIds: number[];
  deploymentBranchPolicy: {
    protectedBranches: true;
    customBranchPolicies: false;
  };
  protectionRules: Array<
    | { type: 'branch_policy' }
    | {
        type: 'required_reviewers';
        preventSelfReview: true;
        reviewerIds: [68980965];
      }
  >;
  policyDigest: string;
}

export interface ReleaseEnvironmentPolicyReceipt {
  schemaVersion: 1;
  kind: 'opencoven-sdk-release-environment-policy';
  verifiedAt: string;
  repository: ReleaseEnvironmentPolicyRepository;
  environments: [
    ReleaseEnvironmentPolicy,
    ReleaseEnvironmentPolicy,
    ReleaseEnvironmentPolicy,
  ];
  policyDigest: string;
}

export function createReleaseEnvironmentPolicyReceipt(options: {
  repository: Record<string, unknown>;
  environments: Array<Record<string, unknown>>;
  verifiedAt?: string;
  config?: ReleaseConfig;
}): ReleaseEnvironmentPolicyReceipt;

export function serializeReleaseEnvironmentPolicyReceipt(
  receipt: ReleaseEnvironmentPolicyReceipt,
): string;

export function parseReleaseEnvironmentPolicyReceipt(
  text: string,
  source?: string,
): ReleaseEnvironmentPolicyReceipt;

export function normalizeReleaseEnvironmentPolicyReceipt(
  receipt: unknown,
  label?: string,
): ReleaseEnvironmentPolicyReceipt;

export function assertReleaseEnvironmentPolicyReceiptCurrent(
  authorizedReceipt: unknown,
  currentReceipt: unknown,
): ReleaseEnvironmentPolicyReceipt;

export function verifyLiveReleaseEnvironmentPolicies(options: {
  config: ReleaseConfig;
  execute?: (
    command: string,
    arguments_: string[],
    options?: Record<string, unknown>,
  ) => string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): ReleaseEnvironmentPolicyReceipt;
