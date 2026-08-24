import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  cleanupMergedBranch,
  parseCleanupArguments,
} from '../scripts/cleanup-merged-branch.mjs';

const roots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitStatus(cwd: string, args: string[]): number {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status ?? 1;
}

function createRepository({ advanceBase = false } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cleanup-merged-'));
  const remote = resolve(root, 'remote.git');
  const repository = resolve(root, 'repository');
  const featureWorktree = resolve(root, 'feature-worktree');

  roots.push(root);
  git(root, ['init', '--bare', remote]);
  git(root, ['clone', remote, repository]);
  git(repository, ['config', 'user.name', 'Cleanup Test']);
  git(repository, ['config', 'user.email', 'cleanup@example.invalid']);
  writeFileSync(resolve(repository, 'base.txt'), 'base\n');
  git(repository, ['add', 'base.txt']);
  git(repository, ['commit', '-m', 'base']);
  git(repository, ['branch', '-M', 'main']);
  git(repository, ['push', '-u', 'origin', 'main']);
  git(repository, ['worktree', 'add', featureWorktree, '-b', 'feature/merged']);
  git(featureWorktree, ['config', 'user.name', 'Cleanup Test']);
  git(featureWorktree, ['config', 'user.email', 'cleanup@example.invalid']);
  writeFileSync(resolve(featureWorktree, 'feature.txt'), 'feature\n');
  git(featureWorktree, ['add', 'feature.txt']);
  git(featureWorktree, ['commit', '-m', 'feature']);
  git(featureWorktree, ['push', '-u', 'origin', 'feature/merged']);
  const featureTip = git(featureWorktree, ['rev-parse', 'HEAD']);
  if (advanceBase) {
    writeFileSync(resolve(repository, 'base-advance.txt'), 'new base work\n');
    git(repository, ['add', 'base-advance.txt']);
    git(repository, ['commit', '-m', 'advance base before merge']);
    git(repository, ['push', 'origin', 'main']);
  }
  git(repository, ['merge', '--squash', 'feature/merged']);
  git(repository, ['commit', '-m', 'squash feature']);
  git(repository, ['push', 'origin', 'main']);

  const mergeCommit = git(repository, ['rev-parse', 'HEAD']);
  const commands: Array<{ args: string[]; command: string; cwd: string }> = [];
  const runCommand = (command: string, args: string[], cwd: string) => {
    commands.push({ args, command, cwd });
    if (command === 'gh') {
      return {
        status: 0,
        stdout: JSON.stringify({
          baseRefName: 'main',
          headRefName: 'feature/merged',
          headRefOid: featureTip,
          mergeCommit: { oid: mergeCommit },
          mergedAt: '2026-08-24T00:00:00Z',
          number: 123,
          state: 'MERGED',
        }),
        stderr: '',
      };
    }

    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    return {
      status: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };

  return { commands, featureTip, featureWorktree, remote, repository, runCommand };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

describe('cleanup merged branch', () => {
  test('accepts the pnpm argument separator used by the documented command', () => {
    expect(
      parseCleanupArguments([
        '--',
        '--branch',
        'feature/merged',
        '--pr',
        '123',
        '--repo',
        'OpenCoven/sdk',
        '--dry-run',
      ]),
    ).toEqual({
      branch: 'feature/merged',
      deleteRemote: false,
      dryRun: true,
      prNumber: 123,
      repository: 'OpenCoven/sdk',
    });
  });

  test('exposes and documents the explicit cleanup command', () => {
    const root = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

    expect(manifest.scripts['cleanup:merged']).toBe(
      'node ./scripts/cleanup-merged-branch.mjs',
    );
    expect(readme).toContain(
      'pnpm cleanup:merged -- --branch <branch> --pr <number> --delete-remote',
    );
    expect(readme).toContain('refuses dirty or locked worktrees');
  });

  test(
    'removes a clean squash-merged worktree and its exact local and remote branch',
    () => {
      const fixture = createRepository();
      const featureWorktree = realpathSync(fixture.featureWorktree);

      const result = cleanupMergedBranch({
        branch: 'feature/merged',
        cwd: fixture.repository,
        deleteRemote: true,
        prNumber: 123,
        repository: 'OpenCoven/sdk',
        runCommand: fixture.runCommand,
      });

      expect(result.removedWorktrees).toEqual([featureWorktree]);
      expect(result.deletedLocalBranch).toBe(true);
      expect(result.deletedRemoteBranch).toBe(true);
      expect(
        fixture.commands.some(
          ({ args, command }) =>
            command === 'gh' &&
            args[0] === 'api' &&
            args[1] === 'repos/OpenCoven/sdk/pulls/123',
        ),
      ).toBe(true);
      expect(fixture.commands).toContainEqual({
        args: [
          'push',
          'origin',
          '--force-with-lease=refs/heads/feature/merged:' + fixture.featureTip,
          '--delete',
          'feature/merged',
        ],
        command: 'git',
        cwd: realpathSync(fixture.repository),
      });
      expect(fixture.commands).toContainEqual({
        args: [
          'update-ref',
          '-d',
          'refs/heads/feature/merged',
          fixture.featureTip,
        ],
        command: 'git',
        cwd: realpathSync(fixture.repository),
      });
      expect(
        gitStatus(fixture.repository, ['rev-parse', '--verify', 'feature/merged']),
      ).not.toBe(0);
      expect(
        gitStatus(fixture.repository, [
          'rev-parse',
          '--verify',
          'refs/remotes/origin/feature/merged',
        ]),
      ).not.toBe(0);
    },
    60_000,
  );

  test(
    'accepts an exact merged PR head when the base advanced before squash merge',
    () => {
      const fixture = createRepository({ advanceBase: true });

      expect(
        cleanupMergedBranch({
          branch: 'feature/merged',
          cwd: fixture.repository,
          dryRun: true,
          prNumber: 123,
          repository: 'OpenCoven/sdk',
          runCommand: fixture.runCommand,
        }),
      ).toMatchObject({
        deletedLocalBranch: true,
        dryRun: true,
      });
    },
    60_000,
  );

  test(
    'refuses to remove a dirty attached worktree',
    () => {
      const fixture = createRepository();
      writeFileSync(resolve(fixture.featureWorktree, 'dirty.txt'), 'keep me\n');

      expect(() =>
        cleanupMergedBranch({
          branch: 'feature/merged',
          cwd: fixture.repository,
          prNumber: 123,
          repository: 'OpenCoven/sdk',
          runCommand: fixture.runCommand,
        }),
      ).toThrow(/dirty/i);

      expect(git(fixture.repository, ['rev-parse', '--verify', 'feature/merged'])).not.toBe('');
    },
    60_000,
  );

  test(
    'refuses equal-tree commits made after the recorded PR head',
    () => {
      const fixture = createRepository();
      git(fixture.featureWorktree, ['commit', '--allow-empty', '-m', 'post-merge marker']);

      expect(() =>
        cleanupMergedBranch({
          branch: 'feature/merged',
          cwd: fixture.repository,
          prNumber: 123,
          repository: 'OpenCoven/sdk',
          runCommand: fixture.runCommand,
        }),
      ).toThrow(/recorded PR head/i);

      expect(git(fixture.repository, ['rev-parse', '--verify', 'feature/merged'])).not.toBe('');
    },
    60_000,
  );

  test(
    'refuses branch content that differs from the recorded merge commit',
    () => {
      const fixture = createRepository();
      writeFileSync(resolve(fixture.featureWorktree, 'after-merge.txt'), 'unique\n');
      git(fixture.featureWorktree, ['add', 'after-merge.txt']);
      git(fixture.featureWorktree, ['commit', '-m', 'unique work after merge']);

      expect(() =>
        cleanupMergedBranch({
          branch: 'feature/merged',
          cwd: fixture.repository,
          prNumber: 123,
          repository: 'OpenCoven/sdk',
          runCommand: fixture.runCommand,
        }),
      ).toThrow(/does not match/i);

      expect(git(fixture.repository, ['rev-parse', '--verify', 'feature/merged'])).not.toBe('');
    },
    60_000,
  );

  test(
    'refuses locked worktrees without deleting the remote branch',
    () => {
      const fixture = createRepository();
      git(fixture.repository, ['worktree', 'lock', fixture.featureWorktree]);

      expect(() =>
        cleanupMergedBranch({
          branch: 'feature/merged',
          cwd: fixture.repository,
          deleteRemote: true,
          prNumber: 123,
          repository: 'OpenCoven/sdk',
          runCommand: fixture.runCommand,
        }),
      ).toThrow(/locked/i);

      expect(
        git(fixture.repository, [
          'rev-parse',
          '--verify',
          'refs/remotes/origin/feature/merged',
        ]),
      ).not.toBe('');
    },
    60_000,
  );

  test(
    'does not prune unrelated stale remote-tracking refs during a dry run',
    () => {
      const fixture = createRepository();
      git(fixture.repository, ['branch', 'unrelated']);
      git(fixture.repository, ['push', 'origin', 'unrelated']);
      git(fixture.repository, ['branch', '-D', 'unrelated']);
      git(fixture.repository, [
        '--git-dir',
        fixture.remote,
        'update-ref',
        '-d',
        'refs/heads/unrelated',
      ]);

      cleanupMergedBranch({
        branch: 'feature/merged',
        cwd: fixture.repository,
        dryRun: true,
        prNumber: 123,
        repository: 'OpenCoven/sdk',
        runCommand: fixture.runCommand,
      });

      expect(
        git(fixture.repository, [
          'rev-parse',
          '--verify',
          'refs/remotes/origin/unrelated',
        ]),
      ).not.toBe('');
    },
    60_000,
  );
});
