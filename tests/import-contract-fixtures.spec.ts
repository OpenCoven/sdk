import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifactRoot = resolve(root, '.artifacts', 'import-contract-fixtures-spec');

const destinationFiles = [
  'packages/cave/fixtures/contract-fixture.json',
  'packages/cave/fixtures/contract-fixture.sha256',
  'packages/coven/fixtures/health.json',
  'packages/coven/fixtures/error.json',
] as const;

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function writeBinary(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function readWorkspaceFixtures(workspaceRoot: string): Record<string, Buffer> {
  return Object.fromEntries(
    destinationFiles.map((relativePath) => [relativePath, readFileSync(resolve(workspaceRoot, relativePath))]),
  );
}

function findImportTemps(workspaceRoot: string): string[] {
  const matches: string[] = [];

  for (const relativePath of destinationFiles) {
    const directory = dirname(resolve(workspaceRoot, relativePath));

    if (!existsSync(directory)) {
      continue;
    }

    for (const entry of readdirSync(directory)) {
      if (entry.includes('.importing-')) {
        matches.push(resolve(directory, entry));
      }
    }
  }

  return matches;
}

function createWorkspace(): string {
  const workspaceRoot = resolve(artifactRoot, 'workspace');
  rmSync(workspaceRoot, { force: true, recursive: true });
  mkdirSync(resolve(workspaceRoot, 'scripts'), { recursive: true });
  cpSync(
    resolve(root, 'scripts', 'import-contract-fixtures.mjs'),
    resolve(workspaceRoot, 'scripts', 'import-contract-fixtures.mjs'),
  );

  for (const relativePath of destinationFiles) {
    writeBinary(resolve(workspaceRoot, relativePath), readFileSync(resolve(root, relativePath)));
  }

  return workspaceRoot;
}

function createAuthorityRoots(workspaceRoot: string) {
  return {
    caveRoot: resolve(workspaceRoot, 'authority', 'cave'),
    covenRoot: resolve(workspaceRoot, 'authority', 'coven'),
  };
}

function stageCaveAuthority(caveRoot: string, fixture: Buffer): void {
  const caveFixturePath = resolve(
    caveRoot,
    'src',
    'lib',
    'server',
    'client-v1',
    'contract-fixture.json',
  );
  const caveDigestPath = resolve(
    caveRoot,
    'src',
    'lib',
    'server',
    'client-v1',
    'contract-fixture.sha256',
  );

  writeBinary(caveFixturePath, fixture);
  writeBinary(caveDigestPath, Buffer.from(`${sha256(fixture)}\n`, 'utf8'));
}

function stageCovenAuthority(covenRoot: string, fixtures: { health: Buffer; error?: Buffer }): void {
  writeBinary(
    resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'health.json'),
    fixtures.health,
  );

  if (fixtures.error !== undefined) {
    writeBinary(
      resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'error.json'),
      fixtures.error,
    );
  }
}

function runImporter(workspaceRoot: string, caveRoot: string, covenRoot: string) {
  return spawnSync(
    process.execPath,
    [
      resolve(workspaceRoot, 'scripts', 'import-contract-fixtures.mjs'),
      '--cave-root',
      caveRoot,
      '--coven-root',
      covenRoot,
    ],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  );
}

afterEach(() => {
  rmSync(artifactRoot, { force: true, recursive: true });
});

describe('import contract fixtures script', () => {
  test('syncs all destination fixtures when every authority source is readable', () => {
    const workspaceRoot = createWorkspace();
    const { caveRoot, covenRoot } = createAuthorityRoots(workspaceRoot);
    const caveFixture = Buffer.from(
      JSON.stringify(
        {
          contract: {
            identityKinds: ['alternate'],
          },
          examples: {
            replacement: true,
          },
        },
        null,
        2,
      ),
    );
    const healthFixture = Buffer.from('{"ok":true,"source":"test-health"}\n', 'utf8');
    const errorFixture = Buffer.from('{"error":{"code":"test-error"}}\n', 'utf8');

    stageCaveAuthority(caveRoot, caveFixture);
    stageCovenAuthority(covenRoot, {
      health: healthFixture,
      error: errorFixture,
    });

    const result = runImporter(workspaceRoot, caveRoot, covenRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('Authority fixtures synchronized.\n');
    expect(readWorkspaceFixtures(workspaceRoot)).toEqual({
      'packages/cave/fixtures/contract-fixture.json': caveFixture,
      'packages/cave/fixtures/contract-fixture.sha256': Buffer.from(`${sha256(caveFixture)}\n`, 'utf8'),
      'packages/coven/fixtures/health.json': healthFixture,
      'packages/coven/fixtures/error.json': errorFixture,
    });
    expect(findImportTemps(workspaceRoot)).toEqual([]);
  });

  test('leaves every destination fixture unchanged when a later Coven source is missing', () => {
    const workspaceRoot = createWorkspace();
    const before = readWorkspaceFixtures(workspaceRoot);
    const { caveRoot, covenRoot } = createAuthorityRoots(workspaceRoot);

    stageCaveAuthority(
      caveRoot,
      Buffer.from(
        JSON.stringify(
          {
            contract: {
              identityKinds: ['changed-before-failure'],
            },
            examples: {
              rollback: true,
            },
          },
          null,
          2,
        ),
      ),
    );
    stageCovenAuthority(covenRoot, {
      health: Buffer.from('{"ok":true,"source":"late-failure-health"}\n', 'utf8'),
    });

    const result = runImporter(workspaceRoot, caveRoot, covenRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing authority fixture file:');
    expect(result.stderr).toContain(
      resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'error.json'),
    );
    expect(readWorkspaceFixtures(workspaceRoot)).toEqual(before);
    expect(findImportTemps(workspaceRoot)).toEqual([]);
  });
});
