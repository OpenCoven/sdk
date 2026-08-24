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

import { cleanupMergedBranch } from '../scripts/cleanup-merged-branch.mjs';

const roots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitStatus(cwd: string, args: string[]): number {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status ?? 1;
}

function createRepository() {
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
  git(repository, ['merge', '--squash', 'feature/merged']);
  git(repository, ['commit', '-m', 'squash feature']);
  git(repository, ['push', 'origin', 'main']);

  const mergeCommit = git(repository, ['rev-parse', 'HEAD']);
  const runCommand = (command: string, args: string[], cwd: string) => {
    if (command === 'gh') {
      return {
        status: 0,
        stdout: JSON.stringify({
          baseRefName: 'main',
          headRefName: 'feature/merged',
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

  return { featureWorktree, repository, runCommand };
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
    expect(readme).toContain('refuses dirty worktrees');
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
        runCommand: fixture.runCommand,
      });

      expect(result.removedWorktrees).toEqual([featureWorktree]);
      expect(result.deletedLocalBranch).toBe(true);
      expect(result.deletedRemoteBranch).toBe(true);
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
    20_000,
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
          runCommand: fixture.runCommand,
        }),
      ).toThrow(/dirty/i);

      expect(git(fixture.repository, ['rev-parse', '--verify', 'feature/merged'])).not.toBe('');
    },
    20_000,
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
          runCommand: fixture.runCommand,
        }),
      ).toThrow(/does not match/i);

      expect(git(fixture.repository, ['rev-parse', '--verify', 'feature/merged'])).not.toBe('');
    },
    20_000,
  );
});
