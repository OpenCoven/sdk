export interface PublicationSecurityReview {
  issue: 'OpenCoven/sdk#40';
  commentId: string;
  reviewer: 'BunsDev';
  commit: string;
  tree: string;
  disposition: 'ship';
}

export function verifyPublicationSecurityReview(options: {
  publicationCandidate: {
    securityReviewIssue: 'OpenCoven/sdk#40';
    securityReviewCommentId: string;
    unlockCommit: string;
    securityReviewedCommit: string;
  };
  sourceTree: string;
  execute?: typeof import('node:child_process').execFileSync;
  env?: NodeJS.ProcessEnv;
}): PublicationSecurityReview;
