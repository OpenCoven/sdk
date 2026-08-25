import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('packed package verifier contract', () => {
  test('checks source exclusion for the four public 0.1 packages', () => {
    const packageArtifacts = readFileSync(resolve(root, 'scripts/package-artifacts.mjs'), 'utf8');

    expect(PUBLIC_PACKAGES.map(({ packageName }) => packageName)).toEqual([
      '@opencoven/sdk-core',
      '@opencoven/cave-client',
      '@opencoven/coven-client',
      '@opencoven/sdk',
    ]);
    expect(packageArtifacts).toContain(
      'for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES)',
    );
    expect(packageArtifacts).not.toContain("'./packages/*'");
    expect(packageArtifacts).not.toMatch(/packageName.*@opencoven\/sdk.*continue/);
  });

  test('proves dependency visibility separately for every packed consumer', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).not.toContain('pnpm-workspace.yaml');
    expect(verifier).toContain('const consumerRoots = [');
    expect(verifier).toContain('await installIsolatedConsumersOfflineAfterWarming(consumerRoots);');
    expect(verifier).toContain('assertConsumerDependencyIsolation(fixtureRoot);');
    expect(verifier).toContain('assertConsumerDependencyIsolation(destinationDirectory);');
  });

  test('tracks every installed public package directory without private CLI entries', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain("sdk: 'sdk'");
    expect(verifier).not.toContain("cli: 'dev-cli'");
    expect(verifier).not.toContain("packageDirectory === 'sdk'");
  });

  test('verifies exact packed root export maps and direct dependencies', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain('const rootPackageExports = {');
    expect(verifier).toContain('function expectedPackedDependencies(workspaceDirectory, version)');
    expect(verifier).toContain('function assertPackedPackageContracts(tarballs)');
    expect(verifier).toContain("manifest.main !== './dist/index.js'");
    expect(verifier).toContain("manifest.types !== './dist/index.d.ts'");
    expect(verifier).toContain('function expectedPackageExports(workspaceDirectory)');
    expect(verifier).toContain("workspaceDirectory === 'cave'");
    expect(verifier).toContain("'./managed': {");
    expect(verifier).toContain(
      '!isJsonOrderEqual(manifest.exports, expectedPackageExports(workspaceDirectory))',
    );
    expect(verifier).toContain(
      'const expectedDependencies = expectedPackedDependencies(workspaceDirectory, manifest.version);',
    );
    expect(verifier).toContain(
      '!isDeepStrictEqual(manifest.dependencies ?? {}, expectedDependencies)',
    );
    expect(verifier).toContain('assertPackedPackageContracts(tarballs);');
  });

  test('compares packed declarations and exports to committed API baselines', () => {
    const verifier = readFileSync(
      resolve(root, 'scripts/verify-package.mjs'),
      'utf8',
    );

    expect(verifier).toContain('async function assertPackedApiBaselines');
    expect(verifier).toContain('readPackedApiSurfaces({');
    expect(verifier).toContain('readApiBaseline(root, workspaceDirectory)');
    expect(verifier).toContain('assertApiBaseline(');
    expect(verifier).toContain('await assertPackedApiBaselines(');
  });

  test('enforces the exact approved license contract in packed tarballs', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toMatch(
      /assertApprovedPackageLicense\(\s*manifest\.license,\s*selector,\s*[^)]+\)/,
    );
  });

  test('verifies every packed package changelog in the dedicated matrix command', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain('function assertPackedChangelogs(tarballs)');
    expect(verifier).toContain(
      "readTarballFile(tarballs[workspaceDirectory], 'CHANGELOG.md')",
    );
    expect(verifier).toContain('assertPackedChangelogs(tarballs);');
  });

  test('keeps complete release verification in the dedicated matrix command', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const packedPackageTests = readFileSync(resolve(root, 'tests/packed-package.spec.ts'), 'utf8');
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(manifest.scripts['verify-package']).toBe('node ./scripts/verify-package.mjs');
    expect(packedPackageTests).not.toContain('verify-package.mjs');
    expect(verifier).toContain('const tarballs = packPublicPackages({');
    expect(verifier).toContain('await installIsolatedConsumersOfflineAfterWarming(consumerRoots);');
    expect(verifier).toContain(
      "runPnpm(['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'], fixtureRoot);",
    );
    expect(verifier).toContain('assertPackedPackagesExcludeSources(fixtureRoot);');
    expect(verifier).toContain("runPnpm(['--ignore-workspace', 'run', 'build'], destinationDirectory);");
    expect(verifier).toContain("runPnpm(['--ignore-workspace', 'run', 'start'], destinationDirectory);");
    expect(verifier).toContain('assertPackedPackagesExcludeSources(destinationDirectory);');
    expect(verifier).toContain("run(process.execPath, ['verify.mjs'], fixtureRoot);");
    expect(verifier).not.toContain('@opencoven/dev-cli');
    expect(verifier).not.toContain("node_modules', '.bin', 'opencoven");
  });

  test('verifies bounded Cave iterators in the isolated packed consumer', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain(
      `import {
  CaveClient,
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveProject,
} from '@opencoven/cave-client';`,
    );
    expect(verifier).toContain('type BoundedPageOptions,');
    expect(verifier).toContain('const boundedPageOptions: BoundedPageOptions = { maxPages: 1 };');
    expect(verifier).toContain('cave.iterateFamiliars(boundedPageOptions)');
    expect(verifier).toContain('cave.iterateProjects(boundedPageOptions)');
    expect(verifier).toContain('cave.iterateConversations(boundedPageOptions)');
    expect(verifier).toContain(
      "cave.iterateConversationMessages('conversation-1', boundedPageOptions)",
    );
    expect(verifier).toContain('const caveIterators: [');
    expect(verifier).toContain('AsyncGenerator<CaveCanonicalFamiliar>');
    expect(verifier).toContain('AsyncGenerator<CaveProject>');
    expect(verifier).toContain('AsyncGenerator<CaveConversation>');
    expect(verifier).toContain('AsyncGenerator<CaveConversationMessage>');
    expect(verifier).toContain('const iteratorClient = new CaveClient({');
    expect(verifier).toContain('iteratorClient.iterateFamiliars({ maxPages: 1 })');
    expect(verifier).toContain('iteratorClient.iterateProjects({ maxPages: 1 })');
    expect(verifier).toContain('iteratorClient.iterateConversations({ maxPages: 1 })');
    expect(verifier).toContain(
      "iteratorClient.iterateConversationMessages('conversation-1', { maxPages: 1 })",
    );
    expect(verifier).toContain("typeof iterator.next !== 'function'");
    expect(verifier).toContain(
      "throw new Error('Packed Cave iterator methods are unavailable.');",
    );
  });

  test('executes and bundles the managed browser subpath from its packed tarball', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain('function createManagedBrowserFixture(fixtureRoot, tarballs)');
    expect(verifier).toContain("'@opencoven/cave-client/managed'");
    expect(verifier).toContain('types: []');
    expect(verifier).toContain("platform: 'browser'");
    expect(verifier).toContain('Packed managed browser lifecycle passed.');
    expect(verifier).toContain('managedBrowserFixtureRoot');
    expect(verifier).toContain("run(process.execPath, ['verify.mjs'], managedBrowserFixtureRoot);");
  });

});
