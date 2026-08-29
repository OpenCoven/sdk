import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  assertAggregationHostPlatform,
  fsyncPublicationDirectory,
  inspectCaveAssertionEngine,
  loadCommittedCaveAssertionEngine,
} from '../scripts/aggregate-client-v1-conformance.mjs';

const roots: string[] = [];

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
});
