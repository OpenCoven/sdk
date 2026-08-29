export interface ApprovalSource {
  repository: 'OpenCoven/sdk';
  commit: string;
  tree: string;
}

export interface ApprovalWorkflow {
  path: '.github/workflows/release.yml';
  commit: string;
  ref: 'refs/heads/main';
  runId: string;
  runAttempt: number;
}

export interface ExpectedProtectedEnvironment {
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
  publishJob: string;
}

export interface ApprovalReviewer {
  id: number;
  login: string;
}

export interface EnvironmentRulesReviewer {
  type: 'User';
  reviewer: {
    id: number;
    login?: string;
    type: 'User';
  };
}

export interface EnvironmentRulesSnapshot {
  can_admins_bypass: false;
  updated_at: string;
  deployment_branch_policy: {
    protected_branches: true;
    custom_branch_policies: false;
  };
  protection_rules: [
    { type: 'branch_policy' },
    {
      type: 'required_reviewers';
      prevent_self_review: true;
      reviewers: [EnvironmentRulesReviewer];
    },
  ];
}

export interface PendingApprovalEvidence {
  schemaVersion: 1;
  kind: 'opencoven-sdk-pending-environment-approval';
  source: ApprovalSource;
  workflow: ApprovalWorkflow;
  witnessJob: {
    id: string;
    name: string;
    startedAt: string;
    observedAt: string;
  };
  environment: {
    id: string;
    name: string;
    rulesUpdatedAt: string;
  };
  reviewer: ApprovalReviewer;
  rules: EnvironmentRulesSnapshot;
  rulesDigest: string;
  pendingDeployment: {
    environment: {
      id: string;
      name: string;
      rulesUpdatedAt: string;
    };
    reviewers: [EnvironmentRulesReviewer];
    wait_timer: 0;
  };
}

export interface ProtectedApprovalReceipt {
  schemaVersion: 1;
  kind: 'opencoven-sdk-protected-environment-approval';
  source: ApprovalSource;
  workflow: ApprovalWorkflow;
  environment: {
    id: string;
    name: string;
  };
  reviewer: {
    id: number;
    login: string;
    authorAssociation: string;
    permission: string;
    roleName: string;
  };
  rulesDigest: string;
  pendingEvidence: {
    kind: 'opencoven-sdk-pending-environment-approval';
    file: string;
    size: number;
    sha256: string;
    artifactId: string;
    artifactName: string;
    observedAt: string;
    witnessJob: {
      id: string;
      name: string;
    };
  };
  approvalJob: {
    id: string;
    name: string;
    startedAt: string;
  };
  publishJob: {
    id: string;
    name: string;
  };
  deployment: {
    id: string;
    sha: string;
    ref: string;
    task: 'deploy';
    environment: string;
    transient_environment: false;
    performed_via_github_app: {
      slug: 'github-actions';
    };
    created_at: string;
  };
  securityReview: {
    commentId: string;
    reviewer: {
      id: number;
      login: string;
      authorAssociation: string;
      permission: string;
      roleName: string;
    };
  };
  createdAt: string;
}

export function serializeCanonicalJson(value: unknown): string;
export function parseCanonicalJson<T = unknown>(
  text: string,
  source?: string,
  maxBytes?: number,
): T;

export function createEnvironmentRulesDigest(options: {
  environment: Record<string, unknown>;
  expected: ExpectedProtectedEnvironment;
}): string;

export function digestEnvironmentRules(options: {
  environment: Record<string, unknown>;
  expected: ExpectedProtectedEnvironment;
}): string;

export function createPendingApprovalEvidence(options: {
  source: ApprovalSource;
  workflow: ApprovalWorkflow;
  witnessJob: {
    id: string;
    name: string;
    startedAt: string;
  };
  environment: Record<string, unknown>;
  pendingDeployments: unknown[];
  observedAt: string;
  expected: ExpectedProtectedEnvironment;
}): PendingApprovalEvidence;

export function serializePendingApprovalEvidence(
  evidence: PendingApprovalEvidence,
): string;

export function parsePendingApprovalEvidence(
  text: string,
  source?: string,
  maxBytes?: number,
): PendingApprovalEvidence;

export function createProtectedApprovalReceipt(options: {
  pendingEvidence: PendingApprovalEvidence;
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
  publishJob: {
    id: string;
    name: string;
  };
  deployment: Record<string, unknown>;
  environment: Record<string, unknown>;
  securityReview: {
    commentId: string;
    reviewer: {
      id: number;
      login: string;
      authorAssociation: string;
      permission: string;
      roleName: string;
    };
  };
  createdAt: string;
  expected: ExpectedProtectedEnvironment;
}): ProtectedApprovalReceipt;

export function serializeProtectedApprovalReceipt(
  receipt: ProtectedApprovalReceipt,
): string;

export function parseProtectedApprovalReceipt(
  text: string,
  source?: string,
  maxBytes?: number,
): ProtectedApprovalReceipt;
