import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  installIsolatedOfflineAfterWarming,
  tarballSpecifier,
} from './package-artifacts.mjs';

export const API_BASELINE_VERSION = 2;

const MAX_DECLARATION_BYTES = 2 * 1024 * 1024;
const MAX_DECLARATION_FILES = 128;
const MAX_EXPORTED_ENTRYPOINTS = 64;

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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEntrypoints(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const names = Object.keys(value).sort();
  if (names.length === 0 || names.length > MAX_EXPORTED_ENTRYPOINTS) {
    throw new Error(`${label} must contain a bounded set of entrypoints.`);
  }

  return Object.fromEntries(
    names.map((name) => {
      const entrypoint = value[name];
      if (!isRecord(entrypoint) || !isRecord(entrypoint.runtimeExports)) {
        throw new Error(`${label}.${name} was malformed.`);
      }
      const runtimeTargets = Object.keys(entrypoint.runtimeExports).sort();
      return [
        name,
        {
          declarationFiles: sortedUniqueStrings(
            entrypoint.declarationFiles,
            `${label}.${name}.declarationFiles`,
          ),
          runtimeExports: Object.fromEntries(
            runtimeTargets.map((target) => [
              target,
              sortedUniqueStrings(
                entrypoint.runtimeExports[target],
                `${label}.${name}.runtimeExports.${target}`,
              ),
            ]),
          ),
        },
      ];
    }),
  );
}

export function createApiBaseline({
  declaration,
  entrypoints,
  packageExports,
  packageName,
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
    entrypoints: normalizeEntrypoints(entrypoints, 'Entrypoints'),
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
      'entrypoints',
      'packageExports',
      'packageName',
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

  const expectedEntrypoints = normalizeEntrypoints(
    expected.entrypoints,
    'Baseline entrypoints',
  );
  const actualEntrypoints = normalizeEntrypoints(
    actual.entrypoints,
    'Packed entrypoints',
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
  if (!isDeepStrictEqual(actualEntrypoints, expectedEntrypoints)) {
    throw new Error(
      `${expected.packageName} packed entrypoint baseline changed.`,
    );
  }
  if (!isJsonOrderEqual(actual.packageExports, expected.packageExports)) {
    throw new Error(
      `${expected.packageName} packed package export baseline changed.`,
    );
  }
}

function relativePackagePath(packageRoot, filePath) {
  const relativePath = relative(packageRoot, filePath);
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Packed API baseline path escaped its package: ${filePath}.`);
  }
  return relativePath.split('\\').join('/');
}

function packageFile(packageRoot, target, label) {
  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new Error(`${label} must be a package-relative path.`);
  }
  const filePath = resolve(packageRoot, target);
  relativePackagePath(packageRoot, filePath);
  if (!existsSync(filePath)) {
    throw new Error(`${label} was missing from the packed package: ${target}.`);
  }
  return filePath;
}

function collectExportTargets(value, kind) {
  if (typeof value === 'string') {
    return kind === 'runtime' ? [value] : [];
  }
  if (!isRecord(value)) {
    return [];
  }

  const targets = [];
  for (const [condition, target] of Object.entries(value)) {
    if (condition === 'types') {
      if (kind === 'types' && typeof target === 'string') {
        targets.push(target);
      }
      continue;
    }
    if (kind === 'runtime') {
      targets.push(...collectExportTargets(target, kind));
    }
  }
  return [...new Set(targets)].sort();
}

function exportedEntrypointTargets(manifest) {
  if (!isRecord(manifest.exports)) {
    return {
      '.': {
        declarations: manifest.types === undefined ? [] : [manifest.types],
        runtime: manifest.main === undefined ? [] : [manifest.main],
      },
    };
  }

  const entrypoints = {};
  for (const [entrypoint, definition] of Object.entries(manifest.exports)) {
    if (entrypoint === './package.json') {
      continue;
    }
    const declarations = collectExportTargets(definition, 'types');
    entrypoints[entrypoint] = {
      declarations:
        entrypoint === '.' &&
        declarations.length === 0 &&
        typeof manifest.types === 'string'
          ? [manifest.types]
          : declarations,
      runtime: collectExportTargets(definition, 'runtime'),
    };
  }
  const names = Object.keys(entrypoints);
  if (names.length === 0 || names.length > MAX_EXPORTED_ENTRYPOINTS) {
    throw new Error('Packed package exports must contain bounded entrypoints.');
  }
  return Object.fromEntries(names.sort().map((name) => [name, entrypoints[name]]));
}

function declarationImportCandidates(filePath, specifier) {
  const direct = resolve(filePath, '..', specifier);
  const candidates = [];
  if (specifier.endsWith('.js')) {
    candidates.push(`${direct.slice(0, -3)}.d.ts`, `${direct.slice(0, -3)}.d.mts`);
  } else if (specifier.endsWith('.mjs')) {
    candidates.push(`${direct.slice(0, -4)}.d.mts`);
  } else if (specifier.endsWith('.cjs')) {
    candidates.push(`${direct.slice(0, -4)}.d.cts`);
  } else {
    candidates.push(direct, `${direct}.d.ts`, resolve(direct, 'index.d.ts'));
  }
  return [...new Set(candidates)];
}

function declarationSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) {
    specifiers.add(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) {
    specifiers.add(match[1]);
  }
  return [...specifiers].sort();
}

function readDeclarationGraph(packageRoot, targets, entrypoint) {
  const pending = targets.map((target) =>
    packageFile(packageRoot, target, `Type export ${entrypoint}`),
  );
  const files = new Map();
  let totalBytes = 0;

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (filePath === undefined) {
      continue;
    }
    const relativePath = relativePackagePath(packageRoot, filePath);
    if (files.has(relativePath)) {
      continue;
    }
    if (files.size >= MAX_DECLARATION_FILES) {
      throw new Error(`Type export ${entrypoint} exceeded the declaration file limit.`);
    }

    let source;
    try {
      source = readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(`Type export ${entrypoint} referenced a missing declaration: ${relativePath}.`);
    }
    totalBytes += Buffer.byteLength(source, 'utf8');
    if (totalBytes > MAX_DECLARATION_BYTES) {
      throw new Error(`Type export ${entrypoint} exceeded the declaration byte limit.`);
    }
    files.set(relativePath, source);

    for (const specifier of declarationSpecifiers(source)) {
      const candidate = declarationImportCandidates(filePath, specifier).find((path) =>
        existsSync(path) && /\.d\.(?:ts|mts|cts)$/u.test(path),
      );
      if (candidate === undefined) {
        throw new Error(
          `Type export ${entrypoint} referenced a missing declaration import ${specifier}.`,
        );
      }
      relativePackagePath(packageRoot, candidate);
      pending.push(candidate);
    }
  }

  return Object.fromEntries([...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ));
}

function serializeDeclarations(declarations) {
  return Object.entries(declarations)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([entrypoint, files]) =>
      Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([filePath, source]) => [
          `// Entrypoint: ${entrypoint}\n`,
          `// Declaration: ${filePath}\n`,
          source.endsWith('\n') ? source : `${source}\n`,
        ]),
    )
    .join('');
}

export async function readPackageApiSurface({
  packageName,
  packageRoot,
}) {
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
  );
  const targets = exportedEntrypointTargets(manifest);
  const declarations = {};
  const entrypoints = {};

  for (const [entrypoint, entrypointTargets] of Object.entries(targets)) {
    const files = readDeclarationGraph(
      packageRoot,
      entrypointTargets.declarations,
      entrypoint,
    );
    declarations[entrypoint] = files;
    const runtimeExports = {};
    for (const target of entrypointTargets.runtime) {
      const filePath = packageFile(packageRoot, target, `Runtime export ${entrypoint}`);
      const runtime = await import(
        `${pathToFileURL(filePath).href}?api-baseline=${encodeURIComponent(
          `${packageName}:${entrypoint}:${target}`,
        )}`
      );
      runtimeExports[relativePackagePath(packageRoot, filePath)] = Object.keys(runtime).sort();
    }
    entrypoints[entrypoint] = {
      declarationFiles: Object.keys(files),
      runtimeExports,
    };
  }

  return createApiBaseline({
    declaration: serializeDeclarations(declarations),
    entrypoints,
    packageExports: manifest.exports,
    packageName,
  });
}

export async function readPackedApiSurfaces({
  artifactRoot,
  packages,
  tarballs,
}) {
  mkdirSync(artifactRoot, { recursive: true });
  const packedDependencies = Object.fromEntries(
    packages.map(({ packageName, workspaceDirectory }) => [
      packageName,
      tarballSpecifier(tarballs, workspaceDirectory),
    ]),
  );
  writeFileSync(
    resolve(artifactRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: 'pnpm@10.34.0',
        dependencies: packedDependencies,
        pnpm: {
          overrides: packedDependencies,
        },
      },
      null,
      2,
    )}\n`,
  );
  installIsolatedOfflineAfterWarming(artifactRoot);

  const scopeRoot = resolve(
    artifactRoot,
    'node_modules',
    '@opencoven',
  );

  const surfaces = {};
  for (const { packageName, workspaceDirectory } of packages) {
    const packageRoot = resolve(scopeRoot, packageName.split('/')[1]);
    surfaces[workspaceDirectory] = await readPackageApiSurface({
      packageName,
      packageRoot,
    });
  }
  return surfaces;
}
