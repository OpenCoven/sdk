export interface CleanupCommandResult {
  status: number;
  stderr: string;
  stdout: string;
}

export type CleanupRunCommand = (
  command: string,
  args: string[],
  cwd: string,
) => CleanupCommandResult;

export interface CleanupMergedBranchOptions {
  branch: string;
  cwd?: string;
  deleteRemote?: boolean;
  dryRun?: boolean;
  prNumber: number;
  remote?: string;
  repository?: string;
  runCommand?: CleanupRunCommand;
}

export interface CleanupMergedBranchResult {
  deletedLocalBranch: boolean;
  deletedRemoteBranch: boolean;
  dryRun: boolean;
  removedWorktrees: string[];
}

export function cleanupMergedBranch(
  options: CleanupMergedBranchOptions,
): CleanupMergedBranchResult;

export function parseCleanupArguments(arguments_: string[]): {
  branch?: string;
  deleteRemote: boolean;
  dryRun: boolean;
  prNumber?: number;
  repository?: string;
};
