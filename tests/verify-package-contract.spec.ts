import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { SCAFFOLD_TEMPLATES as CLI_SCAFFOLD_TEMPLATES } from '@opencoven/dev-cli';

import { PUBLIC_PACKAGES, SCAFFOLD_TEMPLATES } from '../scripts/repository-metadata.mjs';

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
    expect(verifier).toContain(
      "const binary = resolve(fixtureRoot, 'node_modules', '.bin', 'opencoven');",
    );
    expect(verifier).toContain(
      'assertPackedCliJsonHelp(binary, fixtureRoot, packedCliVersion);',
    );
  });

  test('compiles and runs every scaffold against the packed tarballs', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(SCAFFOLD_TEMPLATES).toEqual(CLI_SCAFFOLD_TEMPLATES);
    expect(verifier).toContain('createPackedScaffolds({');
    expect(verifier).toContain(
      '...SCAFFOLD_TEMPLATES.map((template) => resolve(scaffoldRoot, template)),',
    );
    expect(verifier).toContain('for (const template of SCAFFOLD_TEMPLATES) {');
    expect(verifier).toContain("runPnpm(['--ignore-workspace', 'run', 'build'], destinationDirectory);");
    expect(verifier).toContain("runPnpm(['--ignore-workspace', 'run', 'start'], destinationDirectory);");
    expect(verifier).toContain('assertPackedCliScaffold(binary, fixtureRoot, referenceRoot);');
  });

  test('proves the packed binary generates the same scaffold and still refuses to overwrite', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    // The set of files compared is read off the pristine reference tree rather
    // than listed here, so a template that grows a file cannot quietly fall out
    // of the byte comparison.
    expect(verifier).toContain('const generatedPaths = scaffoldFilePaths(destination);');
    expect(verifier).toContain(
      'const referencePaths = scaffoldFilePaths(referenceDirectory);',
    );
    expect(verifier).toContain('referencePaths.length === 0');
    expect(verifier).toContain('!isDeepStrictEqual(generatedPaths, referencePaths)');
    expect(verifier).toContain('for (const relativePath of referencePaths) {');
    expect(verifier).toContain(
      "does not match the workspace CLI output",
    );
    expect(verifier).toContain("refused.status !== 1");
    expect(verifier).toContain(
      "!refused.stderr.startsWith('Refusing to overwrite existing files:')",
    );
    expect(verifier).toContain('did not refuse an unsafe overwrite');
  });

  test('applies a hard deadline and clear diagnostics to every packed CLI probe', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');
    const probeCalls = verifier.match(/runPackedCliProbe\(/g);

    expect(verifier).toContain('const packedCliTimeoutMs = 5_000;');
    expect(probeCalls).toHaveLength(6);
    expect(verifier).toContain('timeout: packedCliTimeoutMs');
    expect(verifier).toContain("killSignal: 'SIGKILL'");
    expect(verifier).toContain("result.error?.code === 'ETIMEDOUT'");
    expect(verifier).toContain('timed out after ${packedCliTimeoutMs}ms');
    expect(verifier).toContain('terminated by signal ${result.signal}');
  });

  test('validates the exact captured packed JSON help contract', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain("import { isDeepStrictEqual } from 'node:util';");
    expect(verifier).toContain(
      "const result = runPackedCliProbe(binary, ['--json', '--help'], cwd, 'JSON help');",
    );
    expect(verifier).toContain("result.stderr !== ''");
    expect(verifier).toContain("command: 'help'");
    expect(verifier).toContain("data: { name: 'opencoven' }");
    expect(verifier).toContain('ok: true');
    expect(verifier).toContain('version: expectedVersion');
    expect(verifier).toContain('!isDeepStrictEqual(jsonOutput, expectedOutput)');
  });

  test('checks both packed binary failure output modes', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');

    expect(verifier).toContain(
      "runPackedCliProbe(binary, ['status'], cwd, 'human failure')",
    );
    expect(verifier).toContain(
      "runPackedCliProbe(binary, ['--json', 'status'], cwd, 'JSON failure')",
    );
    expect(verifier).toContain("humanFailure.status !== 1");
    expect(verifier).toContain("humanFailure.stdout !== ''");
    expect(verifier).toContain(
      "humanFailure.stderr !== 'This command is reserved for a future operational task.\\n'",
    );
    expect(verifier).toContain("jsonFailure.status !== 1");
    expect(verifier).toContain("jsonFailure.stderr !== ''");
    expect(verifier).toContain("jsonOutput?.error?.code !== 'not_implemented'");
    expect(verifier).toContain("jsonOutput?.command !== 'status'");
    expect(verifier).toContain('jsonOutput?.ok !== false');
  });

  test('invokes packed binary failure checks before reporting verification success', () => {
    const verifier = readFileSync(resolve(root, 'scripts/verify-package.mjs'), 'utf8');
    const invocation = 'assertPackedCliFailurePaths(binary, fixtureRoot);';
    const invocationMatches = verifier.match(
      /assertPackedCliFailurePaths\(binary, fixtureRoot\);/g,
    );

    expect(invocationMatches).toHaveLength(1);
    expect(verifier.indexOf(invocation)).toBeGreaterThan(
      verifier.indexOf('assertPackedCliJsonHelp(binary, fixtureRoot, packedCliVersion);'),
    );
    expect(verifier.indexOf(invocation)).toBeLessThan(
      verifier.indexOf("process.stdout.write('Packed package verification passed.\\n');"),
    );
  });
});
