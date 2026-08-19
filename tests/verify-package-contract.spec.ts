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
    expect(verifier).toContain('assertPackedPackagesExcludeSources(destinationDirectory);');
    expect(verifier).toContain("run(process.execPath, ['verify.mjs'], fixtureRoot);");
    expect(verifier).toContain(
      "run(resolve(fixtureRoot, 'node_modules', '.bin', 'opencoven'), ['--json', '--help'], fixtureRoot);",
    );
  });
});
