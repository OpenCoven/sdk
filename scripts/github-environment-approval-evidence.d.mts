import type {
  PendingApprovalEvidence,
  ProtectedApprovalReceipt,
} from './github-environment-approval.mjs';
import type {
  PublicationSecurityReview,
} from './github-release-authorization.mjs';

export function capturePendingApprovalEvidence(options?: {
  root?: string;
  outputRoot?: string;
  env?: NodeJS.ProcessEnv;
  execute?: typeof import('node:child_process').execFileSync;
  resolveRuntime?: (
    options: {
      env: NodeJS.ProcessEnv;
    },
  ) => unknown;
  now?: () => Date;
  publishJobId?: string;
  sleep?: (milliseconds: number) => unknown;
}): {
  evidence: PendingApprovalEvidence;
  path: string;
  text: string;
};

export function captureProtectedApprovalReceipt(options?: {
  root?: string;
  pendingRoot?: string;
  securityReviewPath?: string;
  outputRoot?: string;
  env?: NodeJS.ProcessEnv;
  execute?: typeof import('node:child_process').execFileSync;
  now?: () => Date;
}): {
  receipt: ProtectedApprovalReceipt;
  path: string;
  text: string;
};

export function verifyProtectedApprovalArtifacts(options?: {
  root?: string;
  pendingRoot?: string;
  approvalRoot?: string;
  securityReview?: PublicationSecurityReview;
  env?: NodeJS.ProcessEnv;
  execute?: typeof import('node:child_process').execFileSync;
}): ProtectedApprovalReceipt;

export function main(arguments_?: string[]): unknown;
