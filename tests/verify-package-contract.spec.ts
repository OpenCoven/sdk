import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('packed package verifier contract', () => {
  test('checks source exclusion for all five public packages, including @opencoven/sdk', () => {
    const packageArtifacts = readFileSync(resolve(root, 'scripts/package-artifacts.mjs'), 'utf8');

    expect(PUBLIC_PACKAGES.map(({ packageName }) => packageName)).toEqual([
      '@opencoven/sdk-core',
      '@opencoven/cave-client',
      '@opencoven/coven-client',
      '@opencoven/sdk',
      '@opencoven/dev-cli',
    ]);
    expect(packageArtifacts).toContain(
      'for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES)',
    );
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

  test('tracks every installed public package directory without a special SDK exclusion', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain("sdk: 'sdk'");
    expect(verifier).not.toContain("packageDirectory === 'sdk'");
  });

  test('enforces the exact approved license contract in packed tarballs', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toMatch(
      /assertApprovedPackageLicense\(\s*manifest\.license,\s*selector,\s*[^)]+\)/,
    );
  });
});
