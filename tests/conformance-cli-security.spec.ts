import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
  inspectCaveAssertionEngine,
  publishEvidenceAtomically,
} from '../scripts/aggregate-client-v1-conformance.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = resolve(workspaceRoot, '.artifacts');
const temporaryRoots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false',
    },
  }).trim();
}

function createCaveRepository({ trackEngine = true } = {}): {
  enginePath: string;
  root: string;
} {
  const root = mkdtempSync(resolve(artifactRoot, 'conformance-cave-'));
  temporaryRoots.push(root);
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  const enginePath = resolve(root, 'scripts/client-v1-conformance.mjs');
  writeFileSync(enginePath, "export const marker = 'tracked';\n", 'utf8');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Conformance Test']);
  git(root, ['config', 'user.email', 'conformance@example.invalid']);
  if (trackEngine) {
    git(root, ['add', 'scripts/client-v1-conformance.mjs']);
  } else {
    writeFileSync(resolve(root, 'README.md'), 'fixture\n', 'utf8');
    git(root, ['add', 'README.md']);
  }
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return { enginePath, root };
}

beforeAll(() => {
  mkdirSync(artifactRoot, { recursive: true });
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('conformance aggregation filesystem trust', () => {
  test('requires cave-root to be the Git top-level', () => {
    const fixture = createCaveRepository();
    expect(() =>
      inspectCaveAssertionEngine(resolve(fixture.root, 'scripts')),
    ).toThrow('cave-root must equal the Git top-level');
  });

  test('requires the engine to be tracked at HEAD with identical bytes', () => {
    const fixture = createCaveRepository();
    const inspected = inspectCaveAssertionEngine(fixture.root);
    expect(inspected.commit).toBe(git(fixture.root, ['rev-parse', 'HEAD']));
    expect(inspected.blob).toMatch(/^[0-9a-f]{40,64}$/u);
    expect(inspected.digest).toMatch(/^[0-9a-f]{64}$/u);

    appendFileSync(fixture.enginePath, '// changed after commit\n', 'utf8');
    expect(() => inspectCaveAssertionEngine(fixture.root)).toThrow(
      'Cave assertion engine bytes do not match the HEAD Git blob',
    );

    const untracked = createCaveRepository({ trackEngine: false });
    expect(() => inspectCaveAssertionEngine(untracked.root)).toThrow(
      'Cave assertion engine is not tracked at HEAD',
    );
  });

  test('publishes a complete file without overwriting an existing destination', () => {
    const root = mkdtempSync(resolve(artifactRoot, 'conformance-publish-'));
    temporaryRoots.push(root);
    const outputPath = resolve(root, 'evidence.json');
    publishEvidenceAtomically(outputPath, '{"candidate":"first"}\n');
    expect(readFileSync(outputPath, 'utf8')).toBe('{"candidate":"first"}\n');
    expect(() =>
      publishEvidenceAtomically(outputPath, '{"candidate":"second"}\n'),
    ).toThrow('Refusing to overwrite existing evidence');
    expect(readFileSync(outputPath, 'utf8')).toBe('{"candidate":"first"}\n');
  });
});
