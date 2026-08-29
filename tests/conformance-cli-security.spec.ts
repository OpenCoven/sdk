import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
  inspectCaveAssertionEngine,
  loadCommittedCaveAssertionEngine,
  publishEvidenceAtomically,
  publishPreparedEvidence,
  readTrackedHeadFileAtCommit,
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
      'Cave assertion engine bytes do not match the captured Git blob',
    );

    const untracked = createCaveRepository({ trackEngine: false });
    expect(() => inspectCaveAssertionEngine(untracked.root)).toThrow(
      'Cave assertion engine is not tracked at HEAD',
    );
  });

  test('binds tree and blob lookup to the captured commit when HEAD changes', () => {
    const fixture = createCaveRepository();
    const capturedCommit = git(fixture.root, ['rev-parse', 'HEAD']);
    writeFileSync(fixture.enginePath, "export const marker = 'new-head';\n", 'utf8');
    git(fixture.root, ['add', 'scripts/client-v1-conformance.mjs']);
    git(fixture.root, ['commit', '--quiet', '-m', 'move head']);

    expect(() =>
      readTrackedHeadFileAtCommit(
        fixture.root,
        'scripts/client-v1-conformance.mjs',
        'Cave assertion engine',
        capturedCommit,
      ),
    ).toThrow('Cave assertion engine bytes do not match the captured Git blob');
  });

  test('executes the committed Git blob even if the working file changes', async () => {
    const fixture = createCaveRepository();
    const inspected = inspectCaveAssertionEngine(fixture.root);
    writeFileSync(fixture.enginePath, "export const marker = 'mutated';\n", 'utf8');

    const engine = await loadCommittedCaveAssertionEngine(inspected);

    expect(engine.marker).toBe('tracked');
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

  test('fsyncs the parent directory after link and temporary unlink', () => {
    const root = mkdtempSync(resolve(artifactRoot, 'conformance-fsync-order-'));
    temporaryRoots.push(root);
    const temporaryPath = resolve(root, '.evidence.tmp');
    const outputPath = resolve(root, 'evidence.json');
    writeFileSync(temporaryPath, '{"candidate":"durable"}\n', 'utf8');
    const observations: Array<{
      outputExists: boolean;
      temporaryExists: boolean;
    }> = [];

    publishPreparedEvidence(temporaryPath, outputPath, () => {
      observations.push({
        outputExists: existsSync(outputPath),
        temporaryExists: existsSync(temporaryPath),
      });
    });

    expect(observations).toEqual([
      { outputExists: false, temporaryExists: true },
      { outputExists: true, temporaryExists: false },
    ]);
  });

  test('allows exactly one concurrent publisher without overwrite', async () => {
    const root = mkdtempSync(resolve(artifactRoot, 'conformance-race-'));
    temporaryRoots.push(root);
    const outputPath = resolve(root, 'evidence.json');
    const startPath = resolve(root, 'start');
    const moduleUrl = pathToFileURL(
      resolve(workspaceRoot, 'scripts/aggregate-client-v1-conformance.mjs'),
    ).href;
    const publishers = ['a', 'b'].map((marker) => {
      const readyPath = resolve(root, `ready-${marker}`);
      const script = `
        import { existsSync, writeFileSync } from 'node:fs';
        import { setTimeout as delay } from 'node:timers/promises';
        import { publishEvidenceAtomically } from ${JSON.stringify(moduleUrl)};
        writeFileSync(${JSON.stringify(readyPath)}, '');
        while (!existsSync(${JSON.stringify(startPath)})) await delay(2);
        try {
          publishEvidenceAtomically(
            ${JSON.stringify(outputPath)},
            ${JSON.stringify(marker)}.repeat(16 * 1024 * 1024),
          );
          process.exit(0);
        } catch (error) {
          if (error instanceof Error && error.message.includes('Refusing to overwrite')) {
            process.exit(2);
          }
          throw error;
        }
      `;
      return {
        marker,
        readyPath,
        child: spawn(process.execPath, ['--input-type=module', '--eval', script], {
          stdio: 'ignore',
        }),
      };
    });
    while (publishers.some(({ readyPath }) => !existsSync(readyPath))) {
      await delay(5);
    }
    writeFileSync(startPath, '');
    const exitCodes = await Promise.all(
      publishers.map(
        ({ child }) =>
          new Promise<number | null>((resolveCode, reject) => {
            child.once('error', reject);
            child.once('exit', resolveCode);
          }),
      ),
    );

    expect(exitCodes.toSorted()).toEqual([0, 2]);
    const output = readFileSync(outputPath, 'utf8');
    expect(output.length).toBe(16 * 1024 * 1024);
    expect(output === 'a'.repeat(output.length) || output === 'b'.repeat(output.length))
      .toBe(true);
  }, 15_000);
});
