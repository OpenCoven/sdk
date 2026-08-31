import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import * as aggregator from '../scripts/aggregate-client-v1-conformance.mjs';

const roots: string[] = [];
const checkoutCases = [
  ['SDK candidate', 'OpenCoven/sdk'],
  ['SDK validator', 'OpenCoven/sdk'],
  ['Cave', 'OpenCoven/coven-cave'],
  ['Coven', 'OpenCoven/coven'],
  ['Chat', 'OpenCoven/chat'],
  ['Chat harness', 'OpenCoven/chat'],
] as const;

function requiredFunction(name: string): (...args: never[]) => unknown {
  const value = (aggregator as unknown as Record<string, unknown>)[name];
  expect(value, `${name} must be exported`).toBeTypeOf('function');
  return value as (...args: never[]) => unknown;
}

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

function createRepository(repository: string): {
  root: string;
  identity: { repository: string; commit: string; tree: string };
} {
  const root = mkdtempSync(resolve(tmpdir(), 'opencoven-conformance-checkout-'));
  roots.push(root);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Conformance Test']);
  git(root, ['config', 'user.email', 'conformance@example.invalid']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${repository}.git`]);
  writeFileSync(resolve(root, 'tracked.txt'), `${repository}\n`, 'utf8');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return {
    root,
    identity: {
      repository,
      commit: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    },
  };
}

function createPrivateDirectory(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  roots.push(root);
  chmodSync(root, 0o700);
  return realpathSync(root);
}

function findPublicationTemporaryPath(outputRoot: string): string {
  const rootTemporary = readdirSync(outputRoot).find((name) =>
    name.endsWith('.tmp'),
  );
  if (rootTemporary !== undefined) {
    return resolve(outputRoot, rootTemporary);
  }
  const legacyStagingRoot = resolve(outputRoot, '.publication-staging');
  const stagingTemporary = readdirSync(legacyStagingRoot).find((name) =>
    name.endsWith('.tmp'),
  );
  if (stagingTemporary === undefined) {
    throw new Error('Expected a publication temporary file.');
  }
  return resolve(legacyStagingRoot, stagingTemporary);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('conformance checkout verification', () => {
  test.each(checkoutCases)(
    'accepts the exact clean %s checkout identity',
    (label, repository) => {
      const fixture = createRepository(repository);
      const inspectRepositoryCheckout = requiredFunction(
        'inspectRepositoryCheckout',
      );

      expect(
        inspectRepositoryCheckout(
          fixture.root as never,
          fixture.identity as never,
          `${label} checkout` as never,
        ),
      ).toMatchObject(fixture.identity);
    },
  );

  test.each(checkoutCases)(
    'rejects a wrong %s commit without disclosing checkout paths',
    (label, repository) => {
      const fixture = createRepository(repository);
      const inspectRepositoryCheckout = requiredFunction(
        'inspectRepositoryCheckout',
      );
      let message = '';
      try {
        inspectRepositoryCheckout(
          fixture.root as never,
          { ...fixture.identity, commit: 'f'.repeat(40) } as never,
          `${label} checkout` as never,
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('HEAD does not match expected commit');
      expect(message).not.toContain(fixture.root);
    },
  );

  test.each(checkoutCases)(
    'rejects a wrong %s committed tree',
    (label, repository) => {
      const fixture = createRepository(repository);
      const inspectRepositoryCheckout = requiredFunction(
        'inspectRepositoryCheckout',
      );

      expect(() =>
        inspectRepositoryCheckout(
          fixture.root as never,
          { ...fixture.identity, tree: 'e'.repeat(40) } as never,
          `${label} checkout` as never,
        ),
      ).toThrow('committed tree does not match expected tree');
    },
  );

  test.each(checkoutCases)(
    'rejects untracked files in the %s checkout',
    (label, repository) => {
      const fixture = createRepository(repository);
      const inspectRepositoryCheckout = requiredFunction(
        'inspectRepositoryCheckout',
      );
      const privateName = 'operator-private-untracked.txt';
      writeFileSync(resolve(fixture.root, privateName), 'private\n', 'utf8');
      let message = '';
      try {
        inspectRepositoryCheckout(
          fixture.root as never,
          fixture.identity as never,
          `${label} checkout` as never,
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('is dirty (1 untracked item)');
      expect(message).not.toContain(privateName);
      expect(message).not.toContain(fixture.root);
    },
  );

  test('rejects staged, unstaged, hidden-index, and wrong-remote states', () => {
    const inspectRepositoryCheckout = requiredFunction(
      'inspectRepositoryCheckout',
    );

    const staged = createRepository('OpenCoven/coven-cave');
    writeFileSync(resolve(staged.root, 'staged.txt'), 'staged\n');
    git(staged.root, ['add', 'staged.txt']);
    expect(() =>
      inspectRepositoryCheckout(
        staged.root as never,
        staged.identity as never,
        'Cave checkout' as never,
      ),
    ).toThrow('1 staged change');

    const unstaged = createRepository('OpenCoven/coven');
    writeFileSync(resolve(unstaged.root, 'tracked.txt'), 'changed\n');
    expect(() =>
      inspectRepositoryCheckout(
        unstaged.root as never,
        unstaged.identity as never,
        'Coven checkout' as never,
      ),
    ).toThrow('1 unstaged change');

    const hidden = createRepository('OpenCoven/chat');
    git(hidden.root, ['update-index', '--skip-worktree', 'tracked.txt']);
    expect(() =>
      inspectRepositoryCheckout(
        hidden.root as never,
        hidden.identity as never,
        'Chat checkout' as never,
      ),
    ).toThrow('hidden index entry');

    const remote = createRepository('OpenCoven/sdk');
    git(remote.root, [
      'remote',
      'set-url',
      'origin',
      'https://github.com/example/substitute.git',
    ]);
    expect(() =>
      inspectRepositoryCheckout(
        remote.root as never,
        remote.identity as never,
        'SDK candidate checkout' as never,
      ),
    ).toThrow('origin does not match expected repository');
  });

  test('does not treat ignored untracked files as a clean checkout', () => {
    const fixture = createRepository('OpenCoven/sdk');
    writeFileSync(resolve(fixture.root, '.gitignore'), 'ignored-private.txt\n');
    git(fixture.root, ['add', '.gitignore']);
    git(fixture.root, ['commit', '--quiet', '-m', 'ignore fixture']);
    const identity = {
      ...fixture.identity,
      commit: git(fixture.root, ['rev-parse', 'HEAD']),
      tree: git(fixture.root, ['rev-parse', 'HEAD^{tree}']),
    };
    writeFileSync(
      resolve(fixture.root, 'ignored-private.txt'),
      'private ignored content\n',
    );
    const inspectRepositoryCheckout = requiredFunction(
      'inspectRepositoryCheckout',
    );

    expect(() =>
      inspectRepositoryCheckout(
        fixture.root as never,
        identity as never,
        'SDK validator checkout' as never,
      ),
    ).toThrow('is dirty (1 ignored untracked item)');
  });

  test('reads and returns only the committed blob bytes', () => {
    const fixture = createRepository('OpenCoven/coven-cave');
    const readTrackedFileAtCommit = requiredFunction(
      'readTrackedFileAtCommit',
    );
    writeFileSync(resolve(fixture.root, 'tracked.txt'), 'mutated\n');

    const result = readTrackedFileAtCommit(
      fixture.root as never,
      'tracked.txt' as never,
      'Cave authority file' as never,
      fixture.identity.commit as never,
    ) as { bytes: Buffer; size: number; sha256: string };

    expect(result.bytes.toString('utf8')).toBe('OpenCoven/coven-cave\n');
    expect(result.size).toBe(result.bytes.byteLength);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('conformance evidence publication', () => {
  test('publishes one complete owner-private file and rejects an existing destination', () => {
    const outputRoot = createPrivateDirectory('opencoven-conformance-output-');
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    publishEvidenceAtomically(
      outputRoot as never,
      'evidence.json' as never,
      '{"candidate":"first"}\n' as never,
    );
    expect(readFileSync(resolve(outputRoot, 'evidence.json'), 'utf8')).toBe(
      '{"candidate":"first"}\n',
    );
    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"candidate":"second"}\n' as never,
      ),
    ).toThrow('Refusing to overwrite existing evidence');
  });

  test('rejects a symlinked or group-readable output root', () => {
    const parent = createPrivateDirectory('opencoven-conformance-parent-');
    const realRoot = resolve(parent, 'real');
    const linkedRoot = resolve(parent, 'linked');
    mkdirSync(realRoot, { mode: 0o700 });
    symlinkSync(realRoot, linkedRoot, 'dir');
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        linkedRoot as never,
        'evidence.json' as never,
        '{}\n' as never,
      ),
    ).toThrow('output root must be a non-symlink directory');

    const unsafeRoot = resolve(parent, 'unsafe');
    mkdirSync(unsafeRoot, { mode: 0o755 });
    expect(() =>
      publishEvidenceAtomically(
        unsafeRoot as never,
        'evidence.json' as never,
        '{}\n' as never,
      ),
    ).toThrow('output root must be owner-private');
  });

  test('fails closed when the output root is replaced before publication', () => {
    const parent = createPrivateDirectory('opencoven-conformance-race-');
    const outputRoot = resolve(parent, 'output');
    const movedRoot = resolve(parent, 'moved');
    mkdirSync(outputRoot, { mode: 0o700 });
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"complete":true}\n' as never,
        {
          beforeLink() {
            renameSync(outputRoot, movedRoot);
            mkdirSync(outputRoot, { mode: 0o700 });
          },
        } as never,
      ),
    ).toThrow('output root identity changed during publication');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
    expect(existsSync(resolve(movedRoot, 'evidence.json'))).toBe(false);
    expect(
      readdirSync(parent).some((name) => name.endsWith('.tmp')),
    ).toBe(false);
  });

  test('removes its exact linked inode when the output root is replaced after link', () => {
    const parent = createPrivateDirectory(
      'opencoven-conformance-post-link-race-',
    );
    const outputRoot = resolve(parent, 'output');
    const movedRoot = resolve(parent, 'moved');
    mkdirSync(outputRoot, { mode: 0o700 });
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"complete":true}\n' as never,
        {
          afterLinkBeforeVerify() {
            renameSync(outputRoot, movedRoot);
            mkdirSync(outputRoot, { mode: 0o700 });
          },
        } as never,
      ),
    ).toThrow('output root identity changed during publication');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
    expect(existsSync(resolve(movedRoot, 'evidence.json'))).toBe(false);
  });

  test('does not overwrite a concurrent creator and cleans exact temporary files', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-concurrent-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );
    const outputPath = resolve(outputRoot, 'evidence.json');

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"ours":true}\n' as never,
        {
          beforeLink() {
            writeFileSync(outputPath, '{"other":true}\n', {
              flag: 'wx',
              mode: 0o600,
            });
          },
        } as never,
      ),
    ).toThrow('Refusing to overwrite existing evidence');
    expect(readFileSync(outputPath, 'utf8')).toBe('{"other":true}\n');
    expect(
      readdirSync(outputRoot).filter(
        (name) => name.endsWith('.tmp') || name.endsWith('.lock'),
      ),
    ).toEqual([]);
  });

  test('rejects a same-inode rewrite before publication', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-pre-link-rewrite-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"reviewed":true}\n' as never,
        {
          beforeLink() {
            writeFileSync(
              findPublicationTemporaryPath(outputRoot),
              '{"forged":true}\n',
            );
          },
        } as never,
      ),
    ).toThrow('Prepared evidence content changed before publication');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
  });

  test('rolls back a forged destination after the prepared path is replaced', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-path-replacement-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"reviewed":true}\n' as never,
        {
          afterPreparedVerifyBeforeLink() {
            const temporaryPath = findPublicationTemporaryPath(outputRoot);
            renameSync(temporaryPath, `${temporaryPath}.displaced`);
            writeFileSync(temporaryPath, '{"forged":true}\n', {
              flag: 'wx',
              mode: 0o600,
            });
          },
        } as never,
      ),
    ).toThrow('Prepared evidence path no longer names the prepared descriptor');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
  });

  test('does not expose a same-inode rewrite after the final pre-link hook', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-final-pre-link-rewrite-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"reviewed":true}\n' as never,
        {
          afterPreparedVerifyBeforeLink() {
            const temporaryPath = findPublicationTemporaryPath(outputRoot);
            chmodSync(temporaryPath, 0o600);
            writeFileSync(temporaryPath, '{"forged":true}\n');
            expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(
              false,
            );
          },
        } as never,
      ),
    ).toThrow('Prepared evidence content changed before publication');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
  });

  test('rejects a same-inode rewrite after linking the destination', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-post-link-rewrite-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"reviewed":true}\n' as never,
        {
          afterLinkBeforeVerify() {
            chmodSync(resolve(outputRoot, 'evidence.json'), 0o600);
            writeFileSync(
              resolve(outputRoot, 'evidence.json'),
              '{"forged":true}\n',
            );
          },
        } as never,
      ),
    ).toThrow('Published evidence content changed during publication');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
  });

  test('rejects a same-inode rewrite after removing the temporary link', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-final-rewrite-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"reviewed":true}\n' as never,
        {
          afterTempUnlinkBeforeFinalVerify() {
            const outputPath = resolve(outputRoot, 'evidence.json');
            chmodSync(outputPath, 0o600);
            writeFileSync(outputPath, '{"forged":true}\n');
          },
        } as never,
      ),
    ).toThrow('Published evidence content changed during publication');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
  });

  test('allows exactly one simultaneous CLI publisher to create the destination', async () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-simultaneous-',
    );
    const startPath = resolve(outputRoot, 'start');
    const moduleUrl = pathToFileURL(
      resolve(
        import.meta.dirname,
        '../scripts/aggregate-client-v1-conformance.mjs',
      ),
    ).href;
    const publishers = ['a', 'b'].map((marker) => {
      const readyPath = resolve(outputRoot, `ready-${marker}`);
      const script = `
        import { existsSync, writeFileSync } from 'node:fs';
        import { setTimeout as delay } from 'node:timers/promises';
        import { publishEvidenceAtomically } from ${JSON.stringify(moduleUrl)};
        writeFileSync(${JSON.stringify(readyPath)}, '');
        while (!existsSync(${JSON.stringify(startPath)})) await delay(2);
        try {
          publishEvidenceAtomically(
            ${JSON.stringify(outputRoot)},
            'evidence.json',
            ${JSON.stringify(marker)}.repeat(1024 * 1024),
          );
          process.exit(0);
        } catch (error) {
          if (
            error instanceof Error
            && (
              error.message.includes('Refusing to overwrite')
              || error.message.includes('publication lock')
            )
          ) {
            process.exit(2);
          }
          throw error;
        }
      `;
      return {
        marker,
        readyPath,
        child: spawn(
          process.execPath,
          ['--input-type=module', '--eval', script],
          { stdio: 'ignore' },
        ),
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
    const output = readFileSync(resolve(outputRoot, 'evidence.json'), 'utf8');
    expect(output.length).toBe(1024 * 1024);
    expect(
      output === 'a'.repeat(output.length)
      || output === 'b'.repeat(output.length),
    ).toBe(true);
  }, 15_000);

  test('rolls back only its own linked file when durability fails', () => {
    const outputRoot = createPrivateDirectory(
      'opencoven-conformance-rollback-',
    );
    const publishEvidenceAtomically = requiredFunction(
      'publishEvidenceAtomically',
    );

    expect(() =>
      publishEvidenceAtomically(
        outputRoot as never,
        'evidence.json' as never,
        '{"complete":true}\n' as never,
        {
          afterLink() {
            throw new Error('injected durability failure');
          },
        } as never,
      ),
    ).toThrow('injected durability failure');
    expect(existsSync(resolve(outputRoot, 'evidence.json'))).toBe(false);
    expect(readdirSync(outputRoot)).toEqual([]);
  });
});
