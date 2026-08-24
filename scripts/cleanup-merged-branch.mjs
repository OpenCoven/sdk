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
      const entries = new Map(
        block
          .split('\n')
          .filter((line) => line.includes(' '))
          .map((line) => {
            const separator = line.indexOf(' ');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );

      return {
        branch: entries.get('branch'),
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
  runCommand = defaultRunCommand,
}) {
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error('A branch name is required.');
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    throw new Error('A positive PR number is required.');
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

  runChecked(runCommand, 'git', ['fetch', '--prune', remote], repositoryRoot);

  const pullRequest = parsePullRequest(
    runChecked(
      runCommand,
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'baseRefName,headRefName,mergeCommit,mergedAt,number,state',
      ],
      repositoryRoot,
    ),
    branch,
    prNumber,
  );
  const mergeCommit = pullRequest.mergeCommit.oid;
  const baseRef = `refs/remotes/${remote}/${pullRequest.baseRefName}`;
  const branchRef = `refs/heads/${branch}`;
  const remoteBranchRef = `refs/remotes/${remote}/${branch}`;

  runChecked(runCommand, 'git', ['rev-parse', '--verify', branchRef], repositoryRoot);
  runChecked(runCommand, 'git', ['rev-parse', '--verify', baseRef], repositoryRoot);

  if (
    runStatus(
      runCommand,
      'git',
      ['merge-base', '--is-ancestor', mergeCommit, baseRef],
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

  const remoteBranchExists =
    runStatus(
      runCommand,
      'git',
      ['show-ref', '--verify', '--quiet', remoteBranchRef],
      repositoryRoot,
    ) === 0;
  if (remoteBranchExists) {
    const remoteTip = runChecked(
      runCommand,
      'git',
      ['rev-parse', '--verify', remoteBranchRef],
      repositoryRoot,
    );
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

  if (deleteRemote && remoteBranchExists) {
    runChecked(
      runCommand,
      'git',
      ['push', remote, '--delete', branch],
      repositoryRoot,
    );
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
    ['branch', '-D', '--', branch],
    repositoryRoot,
  );
  runChecked(runCommand, 'git', ['worktree', 'prune'], repositoryRoot);

  return result;
}

function parseArguments(arguments_) {
  const options = {
    deleteRemote: false,
    dryRun: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === '--delete-remote') {
      options.deleteRemote = true;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--branch') {
      options.branch = arguments_[index + 1];
      index += 1;
    } else if (argument === '--pr') {
      options.prNumber = Number(arguments_[index + 1]);
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
    printResult(cleanupMergedBranch(parseArguments(process.argv.slice(2))));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
