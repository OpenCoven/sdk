import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import {
  assertAggregationHostPlatform,
  fsyncPublicationDirectory,
  inspectCaveAssertionEngine,
  loadCommittedCaveAssertionEngine,
} from '../scripts/aggregate-client-v1-conformance.mjs';
import {
  resolveAuthenticatedGitRuntime,
} from '../scripts/release-runtime-integrity.mjs';

const roots: string[] = [];
const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false',
    },
  }).trim();
}

function createCaveRepository(): {
  enginePath: string;
  identity: { repository: string; commit: string; tree: string };
  root: string;
} {
  const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-engine-'));
  roots.push(root);
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  const enginePath = resolve(root, 'scripts/client-v1-conformance.mjs');
  writeFileSync(enginePath, "export const marker = 'committed';\n", 'utf8');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Conformance Test']);
  git(root, ['config', 'user.email', 'conformance@example.invalid']);
  git(root, [
    'remote',
    'add',
    'origin',
    'https://github.com/OpenCoven/coven-cave.git',
  ]);
  git(root, ['add', 'scripts/client-v1-conformance.mjs']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return {
    enginePath,
    identity: {
      repository: 'OpenCoven/coven-cave',
      commit: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    },
    root,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('conformance CLI security boundaries', () => {
  test('allows Unix aggregation coordinators and fails closed on win32', () => {
    expect(() => assertAggregationHostPlatform('darwin')).not.toThrow();
    expect(() => assertAggregationHostPlatform('linux')).not.toThrow();
    expect(() => assertAggregationHostPlatform('win32')).toThrow(
      'Conformance aggregation is supported only on darwin and linux coordinators',
    );
  });

  test('materializes and executes the captured committed Cave blob only', async () => {
    const fixture = createCaveRepository();
    const inspected = inspectCaveAssertionEngine(
      fixture.root,
      fixture.identity,
    );
    writeFileSync(fixture.enginePath, "export const marker = 'mutated';\n");

    const engine = await loadCommittedCaveAssertionEngine(inspected);

    expect(engine.marker).toBe('committed');
  });

  test('does not attempt directory durability on an unsupported host', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-fsync-gate-'));
    roots.push(root);
    expect(() => fsyncPublicationDirectory(root, 'win32')).toThrow(
      'Conformance aggregation is supported only on darwin and linux coordinators',
    );
  });

  test.runIf(process.platform === 'darwin' || process.platform === 'linux')(
    'rejects a PATH-prepended fake Git executable for committed evidence reads',
    () => {
      const root = mkdtempSync(resolve(tmpdir(), 'opencoven-fake-git-path-'));
      roots.push(root);
      const fakeBin = resolve(root, 'fake-bin');
      const fakeGit = resolve(fakeBin, 'git');
      const markerPath = resolve(root, 'fake-git-ran');
      mkdirSync(fakeBin);
      writeFileSync(resolve(root, 'README.md'), 'fixture\n');
      git(root, ['init', '--quiet']);
      git(root, ['config', 'user.name', 'Conformance Test']);
      git(root, ['config', 'user.email', 'conformance@example.invalid']);
      git(root, ['add', 'README.md']);
      git(root, ['commit', '--quiet', '-m', 'fixture']);
      writeFileSync(
        fakeGit,
        `#!/bin/sh
printf 'ran\n' > ${JSON.stringify(markerPath)}
exit 97
`,
      );
      chmodSync(fakeGit, 0o700);
      const commit = git(root, ['rev-parse', 'HEAD']);

      const result = execFileSync(
        process.execPath,
        [
          '-e',
          `
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, process.argv.slice(1), {
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: ${JSON.stringify(`${fakeBin}${delimiter}${process.env.PATH ?? ''}`)},
  },
});
process.stdout.write(JSON.stringify({
  status: result.status,
  stdout: result.stdout,
  stderr: result.stderr,
}));
`,
          resolve(
            workspaceRoot,
            'scripts/verify-committed-conformance-evidence.mjs',
          ),
          '--root',
          root,
          '--commit',
          commit,
          '--aggregate',
          'aggregate.json',
          '--index',
          'aggregate.index.json',
          '--cave-root',
          root,
        ],
        {
          encoding: 'utf8',
          cwd: workspaceRoot,
        },
      );
      const invocation = JSON.parse(result) as {
        status: number;
        stdout: string;
        stderr: string;
      };

      expect(invocation.status).toBe(1);
      expect(invocation.stdout).toBe('');
      expect(invocation.stderr).toContain(
        'Frozen conformance lock is not a committed regular file',
      );
      expect(existsSync(markerPath)).toBe(false);
    },
  );

  test.runIf(process.platform === 'darwin' || process.platform === 'linux')(
    'keeps authenticated Git bound through Cave checkout inspection',
    () => {
      const fixture = createCaveRepository();
      const fakeRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-fake-cave-git-'));
      roots.push(fakeRoot);
      const fakeGit = resolve(fakeRoot, 'git');
      const markerPath = resolve(fakeRoot, 'fake-git-ran');
      writeFileSync(
        fakeGit,
        `#!/bin/sh
printf 'ran\n' > ${JSON.stringify(markerPath)}
exit 97
`,
      );
      chmodSync(fakeGit, 0o700);
      const originalPath = process.env.PATH;
      process.env.PATH = `${fakeRoot}${delimiter}${originalPath ?? ''}`;

      try {
        const gitRuntime = resolveAuthenticatedGitRuntime();
        expect(() =>
          inspectCaveAssertionEngine(
            fixture.root,
            fixture.identity,
            {
              gitExecutable: gitRuntime.gitPath,
              gitEnvironment: {
                PATH: '/usr/bin:/bin',
                HOME: fixture.root,
                LANG: 'C',
                LC_ALL: 'C',
                TZ: 'UTC',
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_NOSYSTEM: '1',
              },
            },
          ),
        ).not.toThrow();
        expect(existsSync(markerPath)).toBe(false);
      } finally {
        process.env.PATH = originalPath;
      }
    },
  );
});
