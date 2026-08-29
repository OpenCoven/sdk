import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures: string[] = [];
const sourceIdentityModule = await import(
  '../scripts/publication-source-identity.mjs'
).catch(() => null);

interface PublicationSourceManifest {
  candidate: {
    commit: string;
    tree: string;
  };
  runtimeSha256: string;
}

interface PublicationSourceIdentityModule {
  createPublicationSourceManifest(options: {
    root: string;
    commit: string;
  }): PublicationSourceManifest;
  applyPublicationMetadataTransform(options: {
    releaseRoot: string;
    releaseCommit: string;
    candidateRoot: string;
    version: string;
  }): void;
  verifyPublicationSourceIdentity(options: {
    root: string;
    releaseCommit: string;
    manifest: PublicationSourceManifest;
  }): void;
}

function sourceIdentity(): PublicationSourceIdentityModule {
  expect(sourceIdentityModule).not.toBeNull();
  if (sourceIdentityModule === null) {
    throw new Error('publication source identity module is missing');
  }
  return sourceIdentityModule as unknown as PublicationSourceIdentityModule;
}

function git(root: string, args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: tmpdir(),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false',
    },
  }).trim();
}

function createFixture(): {
  root: string;
  candidateCommit: string;
  manifest: PublicationSourceManifest;
} {
  const root = mkdtempSync(resolve(tmpdir(), 'opencoven-source-identity-'));
  fixtures.push(root);
  execFileSync(
    '/usr/bin/git',
    ['clone', '--quiet', '--no-local', workspaceRoot, root],
    {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: tmpdir(),
      },
    },
  );
  git(root, ['config', 'user.name', 'Source Identity Test']);
  git(root, ['config', 'user.email', 'source-identity@example.invalid']);
  const candidateCommit = git(root, ['rev-parse', 'HEAD']);
  return {
    root,
    candidateCommit,
    manifest: sourceIdentity().createPublicationSourceManifest({
      root,
      commit: candidateCommit,
    }),
  };
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('publication source identity', { timeout: 30_000 }, () => {
  test('rejects a descendant package source mutation', () => {
    const { root, manifest } = createFixture();
    const sourcePath = resolve(root, 'packages/core/src/index.ts');
    writeFileSync(
      sourcePath,
      `${readFileSync(sourcePath, 'utf8')}\nexport const bypass = true;\n`,
    );
    const releaseCommit = commitAll(root, 'mutate public package source');

    expect(() =>
      sourceIdentity().verifyPublicationSourceIdentity({
        root,
        releaseCommit,
        manifest,
      }),
    ).toThrow(/conformance-tested publication source identity/u);
  });

  test('rejects descendant dependency, build-config, and pnpm hook changes', () => {
    for (const mutation of [
      {
        name: 'dependency lock',
        path: 'pnpm-lock.yaml',
        update: (text: string) => `${text}\n# substituted dependency graph\n`,
      },
      {
        name: 'package build config',
        path: 'packages/core/tsup.config.ts',
        update: (text: string) => `${text}\n// substituted build\n`,
      },
      {
        name: 'repository pnpm hook',
        path: '.pnpmfile.cjs',
        update: () =>
          'require("node:fs").writeFileSync("/tmp/pnpm-hook-ran", "yes");\n',
      },
      {
        name: 'repository ESM pnpm hook',
        path: '.pnpmfile.mjs',
        update: () =>
          'import { writeFileSync } from "node:fs"; writeFileSync("/tmp/pnpm-hook-ran", "yes");\n',
      },
    ]) {
      const { root, manifest } = createFixture();
      const path = resolve(root, mutation.path);
      const original = mutation.path.startsWith('.pnpmfile.')
        ? ''
        : readFileSync(path, 'utf8');
      writeFileSync(path, mutation.update(original));
      const releaseCommit = commitAll(root, mutation.name);

      expect(() =>
        sourceIdentity().verifyPublicationSourceIdentity({
          root,
          releaseCommit,
          manifest,
        }),
      ).toThrow(/conformance-tested publication source identity|pnpm hook/u);
    }
  });

  test('permits only the reviewed metadata unlock transform', () => {
    const { root, manifest } = createFixture();
    for (const workspace of ['core', 'cave', 'coven', 'sdk']) {
      const manifestPath = resolve(root, 'packages', workspace, 'package.json');
      const packageManifest = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as {
        private: boolean;
        version: string;
        dependencies?: Record<string, string>;
      };
      packageManifest.private = false;
      packageManifest.version = '0.1.1';
      for (const dependency of Object.keys(packageManifest.dependencies ?? {})) {
        if (dependency.startsWith('@opencoven/')) {
          packageManifest.dependencies![dependency] = 'workspace:0.1.1';
        }
      }
      writeFileSync(
        manifestPath,
        `${JSON.stringify(packageManifest, null, 2)}\n`,
      );
      const changelogPath = resolve(root, 'packages', workspace, 'CHANGELOG.md');
      writeFileSync(
        changelogPath,
        `${readFileSync(changelogPath, 'utf8')}\n## 0.1.1\n\n- Release metadata.\n`,
      );
    }
    const lockPath = resolve(root, 'pnpm-lock.yaml');
    writeFileSync(
      lockPath,
      readFileSync(lockPath, 'utf8').replaceAll(
        'specifier: workspace:0.1.0',
        'specifier: workspace:0.1.1',
      ),
    );
    writeFileSync(
      resolve(root, '.changeset/final-release.md'),
      '---\n"@opencoven/sdk": patch\n---\n\nRelease metadata.\n',
    );
    const configPath = resolve(root, 'release.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      publishingEnabled: boolean;
    };
    config.publishingEnabled = true;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const releaseCommit = commitAll(root, 'apply release metadata');

    expect(() =>
      sourceIdentity().verifyPublicationSourceIdentity({
        root,
        releaseCommit,
        manifest,
      }),
    ).not.toThrow();
  });

  test('rejects non-allowlisted package manifest changes', () => {
    const { root, manifest } = createFixture();
    const manifestPath = resolve(root, 'packages/core/package.json');
    const packageManifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as { description: string };
    packageManifest.description = 'Substituted runtime package';
    writeFileSync(
      manifestPath,
      `${JSON.stringify(packageManifest, null, 2)}\n`,
    );
    const releaseCommit = commitAll(root, 'mutate package metadata');

    expect(() =>
      sourceIdentity().verifyPublicationSourceIdentity({
        root,
        releaseCommit,
        manifest,
      }),
    ).toThrow(/conformance-tested publication source identity/u);
  });

  test('applies only release metadata to an exact candidate checkout', () => {
    const { root, candidateCommit, manifest } = createFixture();
    const candidateRoot = mkdtempSync(
      resolve(tmpdir(), 'opencoven-candidate-transform-'),
    );
    fixtures.push(candidateRoot);
    execFileSync(
      '/usr/bin/git',
      ['clone', '--quiet', '--no-local', root, candidateRoot],
      {
        env: {
          PATH: '/usr/bin:/bin',
          HOME: tmpdir(),
        },
      },
    );
    git(candidateRoot, ['checkout', '--quiet', '--detach', candidateCommit]);
    const candidateSource = readFileSync(
      resolve(candidateRoot, 'packages/core/src/index.ts'),
      'utf8',
    );

    for (const workspace of ['core', 'cave', 'coven', 'sdk']) {
      const manifestPath = resolve(root, 'packages', workspace, 'package.json');
      const packageManifest = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as {
        private: boolean;
        version: string;
        dependencies?: Record<string, string>;
      };
      packageManifest.private = false;
      packageManifest.version = '0.1.1';
      for (const dependency of Object.keys(packageManifest.dependencies ?? {})) {
        if (dependency.startsWith('@opencoven/')) {
          packageManifest.dependencies![dependency] = 'workspace:0.1.1';
        }
      }
      writeFileSync(
        manifestPath,
        `${JSON.stringify(packageManifest, null, 2)}\n`,
      );
      writeFileSync(
        resolve(root, 'packages', workspace, 'CHANGELOG.md'),
        `# ${workspace}\n\n## 0.1.1\n`,
      );
    }
    const lockPath = resolve(root, 'pnpm-lock.yaml');
    writeFileSync(
      lockPath,
      readFileSync(lockPath, 'utf8').replaceAll(
        'specifier: workspace:0.1.0',
        'specifier: workspace:0.1.1',
      ),
    );
    const releaseCommit = commitAll(root, 'prepare release metadata');
    sourceIdentity().verifyPublicationSourceIdentity({
      root,
      releaseCommit,
      manifest,
    });

    sourceIdentity().applyPublicationMetadataTransform({
      releaseRoot: root,
      releaseCommit,
      candidateRoot,
      version: '0.1.1',
    });

    expect(
      readFileSync(resolve(candidateRoot, 'packages/core/src/index.ts'), 'utf8'),
    ).toBe(candidateSource);
    expect(
      JSON.parse(
        readFileSync(resolve(candidateRoot, 'packages/core/package.json'), 'utf8'),
      ),
    ).toMatchObject({
      private: false,
      version: '0.1.1',
    });
    expect(
      readFileSync(resolve(candidateRoot, 'packages/core/CHANGELOG.md'), 'utf8'),
    ).toBe('# core\n\n## 0.1.1\n');
    expect(readFileSync(resolve(candidateRoot, 'pnpm-lock.yaml'), 'utf8')).toContain(
      'specifier: workspace:0.1.1',
    );
  });
});
