import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const API_BASELINE_VERSION = 1;

export function isJsonOrderEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function apiBaselinePaths(root, workspaceDirectory) {
  const baselineRoot = resolve(root, 'api-baselines');
  return {
    declaration: resolve(baselineRoot, `${workspaceDirectory}.d.ts`),
    metadata: resolve(baselineRoot, `${workspaceDirectory}.json`),
  };
}

export function readApiBaseline(root, workspaceDirectory) {
  const paths = apiBaselinePaths(root, workspaceDirectory);
  return {
    ...JSON.parse(readFileSync(paths.metadata, 'utf8')),
    declaration: readFileSync(paths.declaration, 'utf8'),
  };
}

function sortedUniqueStrings(values, label) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error(`${label} must contain non-empty strings.`);
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return sorted;
}

export function createApiBaseline({
  declaration,
  packageExports,
  packageName,
  runtimeExports,
}) {
  if (
    typeof declaration !== 'string' ||
    declaration.length === 0 ||
    typeof packageName !== 'string' ||
    packageName.length === 0 ||
    typeof packageExports !== 'object' ||
    packageExports === null ||
    Array.isArray(packageExports)
  ) {
    throw new Error('API baseline input was malformed.');
  }

  return {
    version: API_BASELINE_VERSION,
    packageName,
    declaration,
    packageExports,
    runtimeExports: sortedUniqueStrings(
      runtimeExports,
      'Runtime exports',
    ),
  };
}

export function assertApiBaseline(expected, actual) {
  const expectedKeys =
    typeof expected === 'object' && expected !== null
      ? Object.keys(expected).sort()
      : [];
  if (
    typeof expected !== 'object' ||
    expected === null ||
    !isDeepStrictEqual(expectedKeys, [
      'declaration',
      'packageExports',
      'packageName',
      'runtimeExports',
      'version',
    ]) ||
    expected.version !== API_BASELINE_VERSION ||
    typeof expected.packageName !== 'string' ||
    expected.packageName.length === 0 ||
    typeof expected.declaration !== 'string' ||
    expected.declaration.length === 0 ||
    typeof expected.packageExports !== 'object' ||
    expected.packageExports === null ||
    Array.isArray(expected.packageExports)
  ) {
    throw new Error('API baseline metadata was malformed.');
  }

  const expectedRuntimeExports = sortedUniqueStrings(
    expected.runtimeExports,
    'Baseline runtime exports',
  );
  const actualRuntimeExports = sortedUniqueStrings(
    actual.runtimeExports,
    'Packed runtime exports',
  );

  if (actual.packageName !== expected.packageName) {
    throw new Error(
      `Packed package name ${String(actual.packageName)} did not match API baseline ${expected.packageName}.`,
    );
  }
  if (actual.declaration !== expected.declaration) {
    throw new Error(
      `${expected.packageName} packed declaration baseline changed.`,
    );
  }
  if (
    !isDeepStrictEqual(actualRuntimeExports, expectedRuntimeExports)
  ) {
    throw new Error(
      `${expected.packageName} packed runtime export baseline changed.`,
    );
  }
  if (!isJsonOrderEqual(actual.packageExports, expected.packageExports)) {
    throw new Error(
      `${expected.packageName} packed package export baseline changed.`,
    );
  }
}

export async function readPackedApiSurfaces({
  artifactRoot,
  packages,
  tarballs,
}) {
  const scopeRoot = resolve(
    artifactRoot,
    'node_modules',
    '@opencoven',
  );
  mkdirSync(scopeRoot, { recursive: true });

  for (const { packageName, workspaceDirectory } of packages) {
    const destination = resolve(scopeRoot, packageName.split('/')[1]);
    mkdirSync(destination, { recursive: true });
    execFileSync(
      'tar',
      [
        '-xzf',
        tarballs[workspaceDirectory],
        '-C',
        destination,
        '--strip-components=1',
      ],
      { stdio: 'ignore' },
    );
  }

  const surfaces = {};
  for (const { packageName, workspaceDirectory } of packages) {
    const packageRoot = resolve(scopeRoot, packageName.split('/')[1]);
    const manifest = JSON.parse(
      readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
    );
    const runtime = await import(
      `${pathToFileURL(resolve(packageRoot, 'dist', 'index.js')).href}?api-baseline=${workspaceDirectory}`
    );
    surfaces[workspaceDirectory] = createApiBaseline({
      declaration: readFileSync(
        resolve(packageRoot, 'dist', 'index.d.ts'),
        'utf8',
      ),
      packageExports: manifest.exports,
      packageName,
      runtimeExports: Object.keys(runtime),
    });
  }
  return surfaces;
}
