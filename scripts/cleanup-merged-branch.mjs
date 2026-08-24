import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{status: number, stdout: string, stderr: string}} CommandResult
 * @typedef {(command: string, args: string[], cwd: string) => CommandResult} RunCommand
 * @typedef {{
 *   branch: string,
 *   cwd?: string,
 *   deleteRemote?: boolean,
 *   dryRun?: boolean,
 *   prNumber: number,
 *   remote?: string,
 *   repository?: string,
 *   runCommand?: RunCommand,
 * }} CleanupMergedBranchOptions
 * @typedef {{
 *   deletedLocalBranch: boolean,
 *   deletedRemoteBranch: boolean,
 *   dryRun: boolean,
 *   removedWorktrees: string[],
 * }} CleanupMergedBranchResult
 */

function defaultRunCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function runChecked(runCommand, command, args, cwd) {
  const result = runCommand(command, args, cwd);

  if (result.status !== 0) {
    throw new Error(
      `${commandText(command, args)} failed: ${result.stderr.trim() || 'unknown error'}`,
    );
  }

  return result.stdout.trim();
}

function runStatus(runCommand, command, args, cwd) {
  const result = runCommand(command, args, cwd);

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `${commandText(command, args)} failed: ${result.stderr.trim() || 'unknown error'}`,
    );
  }

  return result.status;
}

function parseWorktrees(output) {
  return output
    .split(/\n\n+/u)
    .map((block) => {
      const entries = new Map();
      let locked = false;

      for (const line of block.split('\n')) {
        if (line === 'locked' || line.startsWith('locked ')) {
          locked = true;
        }
        if (line.includes(' ')) {
          const separator = line.indexOf(' ');
          entries.set(line.slice(0, separator), line.slice(separator + 1));
        }
      }

      return {
        branch: entries.get('branch'),
        locked,
        path: entries.get('worktree'),
      };
    })
    .filter((worktree) => worktree.path !== undefined);
}

function parsePullRequest(value, branch, prNumber) {
  let pullRequest;

  try {
    pullRequest = JSON.parse(value);
  } catch {
    throw new Error(`PR #${prNumber} returned invalid JSON.`);
  }

  if (
    pullRequest?.number !== prNumber ||
    pullRequest.state !== 'MERGED' ||
    typeof pullRequest.mergedAt !== 'string' ||
    pullRequest.headRefName !== branch ||
    typeof pullRequest.headRefOid !== 'string' ||
    pullRequest.headRefOid.length === 0 ||
    typeof pullRequest.baseRefName !== 'string' ||
    pullRequest.baseRefName.length === 0 ||
    typeof pullRequest.mergeCommit?.oid !== 'string' ||
    pullRequest.mergeCommit.oid.length === 0
  ) {
    throw new Error(
      `PR #${prNumber} is not merged evidence for branch ${branch}.`,
    );
  }

  return pullRequest;
}

function assertCleanWorktree(runCommand, path, label) {
  const status = runChecked(
    runCommand,
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    path,
  );

  if (status !== '') {
    throw new Error(`${label} worktree is dirty: ${path}`);
  }
}

function githubRepositoryFromRemote(remoteUrl) {
  const match = /^(?:(?:git\+)?https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/u.exec(
    remoteUrl,
  );

  if (match?.[1] === undefined) {
    throw new Error(
      'Could not derive a GitHub owner/repository from the remote URL; pass --repo.',
    );
  }

  return match[1];
}

function validRepository(repository) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository);
}

/**
 * @param {CleanupMergedBranchOptions} options
 * @returns {CleanupMergedBranchResult}
 */
export function cleanupMergedBranch({
  branch,
  cwd = process.cwd(),
  deleteRemote = false,
  dryRun = false,
  prNumber,
  remote = 'origin',
  repository,
  runCommand = defaultRunCommand,
}) {
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error('A branch name is required.');
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error('A positive PR number is required.');
  }
  if (repository !== undefined && !validRepository(repository)) {
    throw new Error('Repository must use the GitHub owner/name form.');
  }

  const repositoryRoot = runChecked(
    runCommand,
    'git',
    ['rev-parse', '--show-toplevel'],
    cwd,
  );
  runChecked(
    runCommand,
    'git',
    ['check-ref-format', '--branch', branch],
    repositoryRoot,
  );
  assertCleanWorktree(runCommand, repositoryRoot, 'Current');

  const currentBranch = runChecked(
    runCommand,
    'git',
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    repositoryRoot,
  );
  if (currentBranch === branch) {
    throw new Error(`Refusing to remove the currently checked out branch ${branch}.`);
  }

  const githubRepository =
    repository ??
    githubRepositoryFromRemote(
      runChecked(
        runCommand,
        'git',
        ['remote', 'get-url', remote],
        repositoryRoot,
      ),
    );
  const pullRequest = parsePullRequest(
    runChecked(
      runCommand,
      'gh',
      [
        'api',
        `repos/${githubRepository}/pulls/${prNumber}`,
        '--jq',
        '{baseRefName:.base.ref,headRefName:.head.ref,headRefOid:.head.sha,mergeCommit:{oid:.merge_commit_sha},mergedAt:.merged_at,number,state:(if .merged then "MERGED" else (.state|ascii_upcase) end)}',
      ],
      repositoryRoot,
    ),
    branch,
    prNumber,
  );
  const mergeCommit = pullRequest.mergeCommit.oid;
  const prHead = pullRequest.headRefOid;
  const branchRef = `refs/heads/${branch}`;

  runChecked(runCommand, 'git', ['rev-parse', '--verify', branchRef], repositoryRoot);
  runChecked(
    runCommand,
    'git',
    [
      'fetch',
      '--no-tags',
      remote,
      `refs/heads/${pullRequest.baseRefName}`,
    ],
    repositoryRoot,
  );

  if (
    runStatus(
      runCommand,
      'git',
      ['merge-base', '--is-ancestor', mergeCommit, 'FETCH_HEAD'],
      repositoryRoot,
    ) !== 0
  ) {
    throw new Error(
      `PR #${prNumber} merge commit is not contained in ${remote}/${pullRequest.baseRefName}.`,
    );
  }

  const branchTip = runChecked(
    runCommand,
    'git',
    ['rev-parse', '--verify', branchRef],
    repositoryRoot,
  );
  if (branchTip !== prHead) {
    throw new Error(
      `Branch ${branch} does not match PR #${prNumber}'s recorded PR head.`,
    );
  }
  const branchIsMerged =
    runStatus(
      runCommand,
      'git',
      ['merge-base', '--is-ancestor', branchTip, mergeCommit],
      repositoryRoot,
    ) === 0;
  const branchTree = runChecked(
    runCommand,
    'git',
    ['rev-parse', `${branchTip}^{tree}`],
    repositoryRoot,
  );
  const mergeTree = runChecked(
    runCommand,
    'git',
    ['rev-parse', `${mergeCommit}^{tree}`],
    repositoryRoot,
  );

  if (!branchIsMerged && branchTree !== mergeTree) {
    throw new Error(
      `Branch ${branch} does not match PR #${prNumber}'s recorded merge commit.`,
    );
  }

  const remoteBranchOutput = runChecked(
    runCommand,
    'git',
    ['ls-remote', '--heads', remote, `refs/heads/${branch}`],
    repositoryRoot,
  );
  const remoteTip = remoteBranchOutput === ''
    ? undefined
    : remoteBranchOutput.split(/\s+/u)[0];
  const remoteBranchExists = remoteTip !== undefined;
  if (remoteBranchExists) {
    if (remoteTip !== branchTip) {
      throw new Error(
        `Remote branch ${remote}/${branch} differs from the verified local branch.`,
      );
    }
  }

  const attachedWorktrees = parseWorktrees(
    runChecked(runCommand, 'git', ['worktree', 'list', '--porcelain'], repositoryRoot),
  ).filter((worktree) => worktree.branch === branchRef);

  for (const worktree of attachedWorktrees) {
    if (worktree.locked) {
      throw new Error(`Attached worktree is locked: ${worktree.path}`);
    }
    assertCleanWorktree(runCommand, worktree.path, 'Attached');
  }

  const result = {
    deletedLocalBranch: true,
    deletedRemoteBranch: deleteRemote && remoteBranchExists,
    dryRun,
    removedWorktrees: attachedWorktrees.map(({ path }) => path),
  };

  if (dryRun) {
    return result;
  }

  for (const worktree of attachedWorktrees) {
    runChecked(
      runCommand,
      'git',
      ['worktree', 'remove', '--', worktree.path],
      repositoryRoot,
    );
  }
  runChecked(
    runCommand,
    'git',
    ['update-ref', '-d', branchRef, branchTip],
    repositoryRoot,
  );
  if (deleteRemote && remoteBranchExists) {
    runChecked(
      runCommand,
      'git',
      [
        'push',
        remote,
        `--force-with-lease=refs/heads/${branch}:${branchTip}`,
        '--delete',
        branch,
      ],
      repositoryRoot,
    );
  }

  return result;
}

export function parseCleanupArguments(arguments_) {
  const options = {
    deleteRemote: false,
    dryRun: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === '--') {
      continue;
    } else if (argument === '--delete-remote') {
      options.deleteRemote = true;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--branch') {
      options.branch = arguments_[index + 1];
      index += 1;
    } else if (argument === '--pr') {
      options.prNumber = Number(arguments_[index + 1]);
      index += 1;
    } else if (argument === '--repo') {
      options.repository = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function printResult(result) {
  const prefix = result.dryRun ? 'Would remove' : 'Removed';
  process.stdout.write(
    `${prefix} ${result.removedWorktrees.length} worktree(s), local branch` +
      `${result.deletedRemoteBranch ? ', and remote branch' : ''}.\n`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    printResult(cleanupMergedBranch(parseCleanupArguments(process.argv.slice(2))));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
