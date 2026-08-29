import { execFileSync } from 'node:child_process';

import { serializeCanonicalJson } from './conformance-contract.mjs';

const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGitHubJson(text, label) {
  if (
    typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error(`${label} response is not bounded UTF-8 JSON`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} response is not valid JSON`, { cause: error });
  }
}

function runGitHubApi(execute, endpoint, env) {
  return parseGitHubJson(
    execute(
      'gh',
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        endpoint,
      ],
      {
        encoding: 'utf8',
        env,
        maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    ),
    endpoint,
  );
}

export function verifyPublicationSecurityReview({
  publicationCandidate,
  sourceTree,
  execute = execFileSync,
  env = process.env,
} = {}) {
  if (
    !isRecord(publicationCandidate)
    || publicationCandidate.securityReviewIssue !== 'OpenCoven/sdk#40'
    || typeof publicationCandidate.securityReviewCommentId !== 'string'
    || !/^[1-9]\d*$/u.test(publicationCandidate.securityReviewCommentId)
    || typeof publicationCandidate.unlockCommit !== 'string'
    || !/^[0-9a-f]{40}$/u.test(publicationCandidate.unlockCommit)
    || publicationCandidate.securityReviewedCommit
      !== publicationCandidate.unlockCommit
    || typeof sourceTree !== 'string'
    || !/^[0-9a-f]{40}$/u.test(sourceTree)
  ) {
    throw new Error('Publication security review input is invalid');
  }

  const issue = runGitHubApi(
    execute,
    'repos/OpenCoven/sdk/issues/40',
    env,
  );
  if (
    !isRecord(issue)
    || issue.number !== 40
    || issue.state !== 'closed'
    || issue.state_reason !== 'completed'
    || issue.locked !== true
  ) {
    throw new Error(
      'OpenCoven/sdk#40 must be closed, completed, and locked before publication',
    );
  }

  const comment = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/issues/comments/${publicationCandidate.securityReviewCommentId}`,
    env,
  );
  const expectedBody = serializeCanonicalJson({
    schemaVersion: 1,
    kind: 'opencoven-sdk-publication-security-review',
    issue: 'OpenCoven/sdk#40',
    disposition: 'ship',
    commit: publicationCandidate.unlockCommit,
    tree: sourceTree,
  });
  if (
    !isRecord(comment)
    || comment.id !== Number(publicationCandidate.securityReviewCommentId)
    || comment.issue_url
      !== 'https://api.github.com/repos/OpenCoven/sdk/issues/40'
    || comment.body !== expectedBody
    || comment.created_at !== comment.updated_at
    || !['OWNER', 'MEMBER'].includes(comment.author_association)
    || !isRecord(comment.user)
    || comment.user.login !== 'BunsDev'
  ) {
    throw new Error(
      'GitHub security review comment does not authorize the exact publication source',
    );
  }

  return {
    issue: 'OpenCoven/sdk#40',
    commentId: publicationCandidate.securityReviewCommentId,
    reviewer: 'BunsDev',
    commit: publicationCandidate.unlockCommit,
    tree: sourceTree,
    disposition: 'ship',
  };
}
