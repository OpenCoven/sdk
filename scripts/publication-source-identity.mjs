import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const GIT_EXECUTABLE = '/usr/bin/git';
const CANONICAL_REPOSITORY = 'OpenCoven/sdk';
const SCHEMA_VERSION = 1;
const PUBLIC_PACKAGE_DIRECTORIES = Object.freeze([
  'packages/core',
  'packages/cave',
  'packages/coven',
  'packages/sdk',
]);
const API_BASELINES_DIRECTORY = 'api-baselines';
const EXACT_RUNTIME_FILES = Object.freeze([
  '.node-version',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);
const PUBLIC_PACKAGE_MANIFESTS = new Set(
  PUBLIC_PACKAGE_DIRECTORIES.map((directory) => `${directory}/package.json`),
);
const PUBLIC_PACKAGE_CHANGELOGS = new Set(
  PUBLIC_PACKAGE_DIRECTORIES.map((directory) => `${directory}/CHANGELOG.md`),
);
const ROOT_PACKAGE_FIELDS = Object.freeze([
  'packageManager',
  'engines',
  'pnpm',
  'dependencies',
  'devDependencies',
]);
const DEPENDENCY_FIELDS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const REGULAR_GIT_FILE_MODES = new Set(['100644', '100755']);
const SEMVER_PATTERN =
  '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)'
  + '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?'
  + '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const WORKSPACE_EXACT_SEMVER_PATTERN = new RegExp(
  `^workspace:${SEMVER_PATTERN}$`,
  'u',
);
const PNPM_LOCK_WORKSPACE_SPECIFIER_PATTERN = new RegExp(
  `(^\\s*specifier:\\s*)(['"]?)workspace:${SEMVER_PATTERN}\\2(\\s*$)`,
  'gmu',
);
const IGNORED_CHANGELOG_BYTES = Buffer.from('', 'utf8');
const IGNORED_PACKAGE_PRIVATE = false;
const IGNORED_PACKAGE_VERSION = '0.0.0-publication-source';
const IGNORED_WORKSPACE_RANGE = 'workspace:<release-metadata>';
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function createIdentityError(detail, cause) {
  return new Error(
    `Release commit does not preserve the conformance-tested publication source identity: ${detail}`,
    cause === undefined ? undefined : { cause },
  );
}

function createPnpmHookError(detail) {
  return new Error(`Forbidden pnpm hook config for publication source identity: ${detail}`);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function serializeCanonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function digestSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createSterileGitEnvironment(root) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: root,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function runGit(
  root,
  arguments_,
  {
    encoding = 'utf8',
    maxBuffer = 32 * 1024 * 1024,
    stdio = 'pipe',
  } = {},
) {
  return execFileSync(
    GIT_EXECUTABLE,
    [
      '-c',
      'core.pager=cat',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'credential.helper=',
      '-C',
      root,
      ...arguments_,
    ],
    {
      encoding,
      env: createSterileGitEnvironment(root),
      killSignal: 'SIGKILL',
      maxBuffer,
      stdio,
      timeout: 15_000,
    },
  );
}

function inspectCheckoutRoot(root) {
  let canonicalRoot;

  try {
    canonicalRoot = realpathSync(root);
  } catch (error) {
    throw createIdentityError('root must be a readable Git checkout', error);
  }

  let gitRoot;

  try {
    gitRoot = realpathSync(
      runGit(canonicalRoot, ['rev-parse', '--show-toplevel']).trim(),
    );
  } catch (error) {
    throw createIdentityError('root must be a readable Git checkout', error);
  }

  if (gitRoot !== canonicalRoot) {
    throw createIdentityError('root must equal the Git top-level checkout');
  }

  return canonicalRoot;
}

function resolveCommit(root, revision, context) {
  if (typeof revision !== 'string' || revision.trim().length === 0) {
    throw createIdentityError(`${context} must be a non-empty Git revision`);
  }

  let commit;
  let tree;

  try {
    commit = runGit(root, ['rev-parse', `${revision}^{commit}`]).trim();
    tree = runGit(root, ['rev-parse', `${commit}^{tree}`]).trim();
  } catch (error) {
    throw createIdentityError(`${context} must resolve to a readable Git commit`, error);
  }

  if (!/^[0-9a-f]{40}$/u.test(commit) || !/^[0-9a-f]{40}$/u.test(tree)) {
    throw createIdentityError(`${context} did not resolve to canonical Git object ids`);
  }

  return { commit, tree };
}

function assertReleaseDescendsFromCandidate(root, candidateCommit, releaseCommit) {
  try {
    runGit(
      root,
      ['merge-base', '--is-ancestor', candidateCommit, releaseCommit],
      { stdio: 'ignore', maxBuffer: 1_024 },
    );
  } catch (error) {
    throw createIdentityError(
      `release commit ${releaseCommit} must descend from candidate ${candidateCommit}`,
      error,
    );
  }
}

function assertValidTrackedPath(path) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').includes('..')
  ) {
    throw createIdentityError(`tracked path ${JSON.stringify(path)} is not canonical`);
  }
}

function parseLsTreeEntries(output) {
  const entries = [];

  for (const record of output.split('\0')) {
    if (record.length === 0) {
      continue;
    }

    const tabIndex = record.indexOf('\t');

    if (tabIndex <= 0) {
      throw createIdentityError('git ls-tree output was malformed');
    }

    const header = record.slice(0, tabIndex).split(' ');

    if (header.length !== 3) {
      throw createIdentityError('git ls-tree header was malformed');
    }

    const [mode, type, objectId] = header;
    const path = record.slice(tabIndex + 1);
    assertValidTrackedPath(path);

    entries.push({
      mode,
      objectId,
      path,
      type,
    });
  }

  entries.sort((left, right) => compareAscii(left.path, right.path));
  return entries;
}

function readTrackedEntries(root, revision) {
  const output = runGit(
    root,
    [
      'ls-tree',
      '-rz',
      '--full-tree',
      revision,
      '--',
      ...PUBLIC_PACKAGE_DIRECTORIES,
      API_BASELINES_DIRECTORY,
      ...EXACT_RUNTIME_FILES,
      '.pnpmfile.cjs',
      '.pnpmfile.mjs',
      'pnpmfile.cjs',
      'pnpmfile.mjs',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  return parseLsTreeEntries(output);
}

function basename(path) {
  const lastSlashIndex = path.lastIndexOf('/');
  return lastSlashIndex === -1 ? path : path.slice(lastSlashIndex + 1);
}

function assertNoTrackedPnpmHooks(entries) {
  for (const entry of entries) {
    const name = basename(entry.path);

    if (
      name === '.pnpmfile.cjs'
      || name === '.pnpmfile.mjs'
      || name === 'pnpmfile.cjs'
      || name === 'pnpmfile.mjs'
    ) {
      throw createPnpmHookError(`tracked hook file ${entry.path} is forbidden`);
    }
  }
}

function assertRequiredRuntimeFilesPresent(entries) {
  const present = new Set(entries.map((entry) => entry.path));

  for (const path of EXACT_RUNTIME_FILES) {
    if (!present.has(path)) {
      throw createIdentityError(`required runtime file ${path} is not tracked`);
    }
  }
}

function readBlobBytesBatch(root, entries) {
  const input = `${entries.map(({ objectId }) => objectId).join('\n')}\n`;
  const output = execFileSync(
    GIT_EXECUTABLE,
    [
      '-c',
      'core.pager=cat',
      '-C',
      root,
      'cat-file',
      '--batch',
    ],
    {
      encoding: undefined,
      env: createSterileGitEnvironment(root),
      input,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    },
  );
  const result = new Map();
  let offset = 0;
  for (const entry of entries) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) {
      throw createIdentityError('git cat-file --batch output was truncated');
    }
    const header = output.subarray(offset, newline).toString('utf8').split(' ');
    if (
      header.length !== 3
      || header[0] !== entry.objectId
      || header[1] !== 'blob'
      || !/^\d+$/u.test(header[2])
    ) {
      throw createIdentityError('git cat-file --batch output was malformed');
    }
    const size = Number(header[2]);
    const start = newline + 1;
    const end = start + size;
    if (end >= output.length || output[end] !== 0x0a) {
      throw createIdentityError('git cat-file --batch blob was truncated');
    }
    result.set(entry.objectId, output.subarray(start, end));
    offset = end + 1;
  }
  if (offset !== output.length) {
    throw createIdentityError('git cat-file --batch returned unexpected bytes');
  }
  return result;
}

function readCommittedPath(root, commit, path) {
  return runGit(root, ['cat-file', 'blob', `${commit}:${path}`], {
    encoding: undefined,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseJsonObject(bytes, context) {
  let parsed;

  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw createIdentityError(`${context} must be valid UTF-8 JSON`, error);
  }

  if (!isPlainObject(parsed)) {
    throw createIdentityError(`${context} must be a JSON object`);
  }

  return parsed;
}

function assertNoManifestPnpmHookConfig(manifest, context) {
  for (const key of Object.keys(manifest)) {
    const normalized = key.toLowerCase().replaceAll('-', '');
    if (normalized.includes('pnpmfile') || normalized === 'hooks') {
      throw createPnpmHookError(
        `${context} must not declare package-manager hooks`,
      );
    }
  }

  if (Object.hasOwn(manifest, 'pnpm')) {
    const pnpmConfig = manifest.pnpm;

    if (!isPlainObject(pnpmConfig)) {
      throw createIdentityError(`${context}.pnpm must be an object`);
    }

    if (
      Object.keys(pnpmConfig).some((key) => {
        const normalized = key.toLowerCase().replaceAll('-', '');
        return normalized.includes('pnpmfile') || normalized === 'hooks';
      })
    ) {
      throw createPnpmHookError(
        `${context}.pnpm must not declare package-manager hooks`,
      );
    }
  }
}

function normalizeDependencyMap(value, context) {
  if (!isPlainObject(value)) {
    throw createIdentityError(`${context} must be an object`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([dependency, specifier]) => {
      if (typeof specifier !== 'string' || specifier.length === 0) {
        throw createIdentityError(`${context}.${dependency} must be a non-empty string`);
      }

      return [
        dependency,
        dependency.startsWith('@opencoven/')
        && WORKSPACE_EXACT_SEMVER_PATTERN.test(specifier)
          ? IGNORED_WORKSPACE_RANGE
          : specifier,
      ];
    }),
  );
}

function normalizeRootPackageManifest(bytes) {
  const manifest = parseJsonObject(bytes, 'package.json');
  assertNoManifestPnpmHookConfig(manifest, 'package.json');

  const normalized = {};

  for (const field of ROOT_PACKAGE_FIELDS) {
    if (!Object.hasOwn(manifest, field)) {
      continue;
    }

    const value = manifest[field];

    normalized[field] =
      DEPENDENCY_FIELDS.has(field)
        ? normalizeDependencyMap(value, `package.json.${field}`)
        : value;
  }

  return Buffer.from(serializeCanonicalJson(normalized), 'utf8');
}

function normalizePublicPackageManifest(bytes, path) {
  const manifest = parseJsonObject(bytes, path);
  assertNoManifestPnpmHookConfig(manifest, path);

  const normalized = {};

  for (const [field, value] of Object.entries(manifest)) {
    if (field === 'private') {
      if (typeof value !== 'boolean') {
        throw createIdentityError(`${path}.private must be a boolean`);
      }

      normalized[field] = IGNORED_PACKAGE_PRIVATE;
      continue;
    }

    if (field === 'version') {
      if (typeof value !== 'string' || value.length === 0) {
        throw createIdentityError(`${path}.version must be a non-empty string`);
      }

      normalized[field] = IGNORED_PACKAGE_VERSION;
      continue;
    }

    normalized[field] = DEPENDENCY_FIELDS.has(field)
      ? normalizeDependencyMap(value, `${path}.${field}`)
      : value;
  }

  return Buffer.from(serializeCanonicalJson(normalized), 'utf8');
}

function normalizePnpmLock(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  const normalized = text.replace(
    PNPM_LOCK_WORKSPACE_SPECIFIER_PATTERN,
    (_match, prefix, quote, suffix) =>
      `${prefix}${quote}workspace:<release-metadata>${quote}${suffix}`,
  );

  return Buffer.from(normalized, 'utf8');
}

function normalizeTrackedEntryBytes(entry, bytes) {
  if (!REGULAR_GIT_FILE_MODES.has(entry.mode)) {
    throw createIdentityError(
      `${entry.path} must be a regular tracked file, received git mode ${entry.mode}`,
    );
  }

  if (entry.type !== 'blob') {
    throw createIdentityError(
      `${entry.path} must resolve to a blob, received git type ${entry.type}`,
    );
  }

  if (entry.path === 'package.json') {
    return normalizeRootPackageManifest(bytes);
  }

  if (entry.path === 'pnpm-lock.yaml') {
    return normalizePnpmLock(bytes);
  }

  if (PUBLIC_PACKAGE_MANIFESTS.has(entry.path)) {
    return normalizePublicPackageManifest(bytes, entry.path);
  }

  if (PUBLIC_PACKAGE_CHANGELOGS.has(entry.path)) {
    return IGNORED_CHANGELOG_BYTES;
  }

  return Buffer.from(bytes);
}

function buildRuntimeEntries(root, revision) {
  const entries = readTrackedEntries(root, revision);
  assertNoTrackedPnpmHooks(entries);
  assertRequiredRuntimeFilesPresent(entries);
  const blobs = readBlobBytesBatch(root, entries);

  return entries.map((entry) => {
    const normalizedBytes = normalizeTrackedEntryBytes(
      entry,
      blobs.get(entry.objectId),
    );

    return {
      mode: entry.mode,
      path: entry.path,
      sha256: digestSha256(normalizedBytes),
      size: normalizedBytes.length,
    };
  });
}

function computeRuntimeSha256(entries) {
  return digestSha256(Buffer.from(serializeCanonicalJson(entries), 'utf8'));
}

function normalizeManifestRecord(manifest, context) {
  if (!isPlainObject(manifest)) {
    throw createIdentityError(`${context} must be an object`);
  }

  if (manifest.repository !== CANONICAL_REPOSITORY) {
    throw createIdentityError(`${context}.repository must equal ${CANONICAL_REPOSITORY}`);
  }

  if (!isPlainObject(manifest.candidate)) {
    throw createIdentityError(`${context}.candidate must be an object`);
  }

  const { candidate } = manifest;

  if (
    typeof candidate.commit !== 'string'
    || !/^[0-9a-f]{40}$/u.test(candidate.commit)
    || typeof candidate.tree !== 'string'
    || !/^[0-9a-f]{40}$/u.test(candidate.tree)
  ) {
    throw createIdentityError(`${context}.candidate must contain canonical Git ids`);
  }

  if (
    typeof manifest.runtimeSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(manifest.runtimeSha256)
  ) {
    throw createIdentityError(`${context}.runtimeSha256 must be a SHA-256 hex digest`);
  }

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw createIdentityError(`${context}.schemaVersion must equal ${SCHEMA_VERSION}`);
  }

  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw createIdentityError(`${context}.entries must be a non-empty array`);
  }

  const entries = manifest.entries.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw createIdentityError(`${context}.entries[${index}] must be an object`);
    }

    const { mode, path, sha256, size } = entry;

    if (
      typeof path !== 'string'
      || typeof mode !== 'string'
      || typeof sha256 !== 'string'
      || !Number.isInteger(size)
      || size < 0
    ) {
      throw createIdentityError(`${context}.entries[${index}] was malformed`);
    }

    assertValidTrackedPath(path);

    if (!REGULAR_GIT_FILE_MODES.has(mode)) {
      throw createIdentityError(`${context}.entries[${index}] has unsupported git mode ${mode}`);
    }

    if (!/^[0-9a-f]{64}$/u.test(sha256)) {
      throw createIdentityError(`${context}.entries[${index}].sha256 must be a SHA-256 hex digest`);
    }

    return { mode, path, sha256, size };
  });

  const sortedEntries = [...entries].sort(
    (left, right) => compareAscii(left.path, right.path),
  );

  for (let index = 0; index < sortedEntries.length; index += 1) {
    if (sortedEntries[index].path !== entries[index].path) {
      throw createIdentityError(`${context}.entries must use canonical path order`);
    }

    if (
      index > 0
      && sortedEntries[index - 1].path === sortedEntries[index].path
    ) {
      throw createIdentityError(`${context}.entries must not repeat tracked paths`);
    }
  }

  const normalized = {
    candidate: {
      commit: candidate.commit,
      tree: candidate.tree,
    },
    entries,
    repository: CANONICAL_REPOSITORY,
    runtimeSha256: manifest.runtimeSha256,
    schemaVersion: SCHEMA_VERSION,
  };

  if (computeRuntimeSha256(normalized.entries) !== normalized.runtimeSha256) {
    throw createIdentityError(`${context}.runtimeSha256 did not match its canonical entries`);
  }

  return normalized;
}

function createRuntimeSnapshot(root, revision, context) {
  const resolved = resolveCommit(root, revision, context);
  const entries = buildRuntimeEntries(root, resolved.commit);

  return {
    candidate: resolved,
    entries,
    repository: CANONICAL_REPOSITORY,
    runtimeSha256: computeRuntimeSha256(entries),
    schemaVersion: SCHEMA_VERSION,
  };
}

function describeEntryDifference(expectedEntries, actualEntries) {
  const actualByPath = new Map(actualEntries.map((entry) => [entry.path, entry]));

  for (const expected of expectedEntries) {
    const actual = actualByPath.get(expected.path);

    if (actual === undefined) {
      return `${expected.path} was deleted from the runtime scope`;
    }

    actualByPath.delete(expected.path);

    if (expected.mode !== actual.mode) {
      return `${expected.path} changed git mode from ${expected.mode} to ${actual.mode}`;
    }

    if (expected.size !== actual.size || expected.sha256 !== actual.sha256) {
      return `${expected.path} changed normalized runtime bytes`;
    }
  }

  const [unexpectedPath] = [...actualByPath.keys()].sort(compareAscii);

  if (unexpectedPath !== undefined) {
    return `${unexpectedPath} was added to the runtime scope`;
  }

  return 'runtime scope changed unexpectedly';
}

export function createPublicationSourceManifest({ root, commit }) {
  const checkoutRoot = inspectCheckoutRoot(root);
  return createRuntimeSnapshot(checkoutRoot, commit, 'candidate commit');
}

export function serializePublicationSourceManifest(manifest) {
  return serializeCanonicalJson(
    normalizeManifestRecord(manifest, 'publication source manifest'),
  );
}

export function parsePublicationSourceManifest(input) {
  if (typeof input === 'string') {
    let parsed;

    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw createIdentityError('publication source manifest must be valid JSON', error);
    }

    return normalizeManifestRecord(parsed, 'publication source manifest');
  }

  return normalizeManifestRecord(input, 'publication source manifest');
}

export function verifyPublicationSourceIdentity({
  root,
  releaseCommit,
  manifest,
}) {
  const checkoutRoot = inspectCheckoutRoot(root);
  const expectedManifest = parsePublicationSourceManifest(manifest);
  const release = resolveCommit(checkoutRoot, releaseCommit, 'release commit');

  assertReleaseDescendsFromCandidate(
    checkoutRoot,
    expectedManifest.candidate.commit,
    release.commit,
  );

  const candidateTree = resolveCommit(
    checkoutRoot,
    expectedManifest.candidate.commit,
    'manifest candidate commit',
  ).tree;

  if (candidateTree !== expectedManifest.candidate.tree) {
    throw createIdentityError(
      `candidate ${expectedManifest.candidate.commit} did not match manifest tree ${expectedManifest.candidate.tree}`,
    );
  }

  const actualManifest = createRuntimeSnapshot(
    checkoutRoot,
    release.commit,
    'release commit',
  );

  if (actualManifest.runtimeSha256 !== expectedManifest.runtimeSha256) {
    throw createIdentityError(
      describeEntryDifference(expectedManifest.entries, actualManifest.entries),
    );
  }
}

function assertTransformDestination(root, path) {
  const canonicalRoot = realpathSync(root);
  const destination = resolve(canonicalRoot, path);
  if (!destination.startsWith(`${canonicalRoot}${sep}`)) {
    throw createIdentityError(`${path} escapes the candidate checkout`);
  }
  const parent = realpathSync(dirname(destination));
  if (
    parent !== canonicalRoot
    && !parent.startsWith(`${canonicalRoot}${sep}`)
  ) {
    throw createIdentityError(`${path} parent escapes the candidate checkout`);
  }
  const stats = lstatSync(destination);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw createIdentityError(`${path} must be a regular candidate file`);
  }
  return destination;
}

function assertReleasePackageManifest(manifest, path, version) {
  if (manifest.private !== false || manifest.version !== version) {
    throw createIdentityError(
      `${path} must contain the exact unlocked version ${version}`,
    );
  }
  for (const field of DEPENDENCY_FIELDS) {
    if (!Object.hasOwn(manifest, field)) {
      continue;
    }
    const dependencies = manifest[field];
    if (!isPlainObject(dependencies)) {
      throw createIdentityError(`${path}.${field} must be an object`);
    }
    for (const [name, range] of Object.entries(dependencies)) {
      if (
        name.startsWith('@opencoven/')
        && range !== `workspace:${version}`
      ) {
        throw createIdentityError(
          `${path}.${field}.${name} must be workspace:${version}`,
        );
      }
    }
  }
}

export function applyPublicationMetadataTransform({
  releaseRoot,
  releaseCommit,
  candidateRoot,
  version,
}) {
  if (typeof version !== 'string' || !STRICT_SEMVER.test(version)) {
    throw createIdentityError('publication metadata version must be strict SemVer');
  }
  const canonicalReleaseRoot = inspectCheckoutRoot(releaseRoot);
  const canonicalCandidateRoot = inspectCheckoutRoot(candidateRoot);
  const release = resolveCommit(
    canonicalReleaseRoot,
    releaseCommit,
    'release commit',
  );

  for (const path of PUBLIC_PACKAGE_MANIFESTS) {
    const candidateBytes = readFileFromCheckout(canonicalCandidateRoot, path);
    const releaseBytes = readCommittedPath(
      canonicalReleaseRoot,
      release.commit,
      path,
    );
    if (
      !normalizePublicPackageManifest(candidateBytes, path).equals(
        normalizePublicPackageManifest(releaseBytes, path),
      )
    ) {
      throw createIdentityError(`${path} changed outside the metadata allowlist`);
    }
    assertReleasePackageManifest(
      parseJsonObject(releaseBytes, path),
      path,
      version,
    );
    writeFileSync(
      assertTransformDestination(canonicalCandidateRoot, path),
      releaseBytes,
    );
  }

  for (const path of PUBLIC_PACKAGE_CHANGELOGS) {
    writeFileSync(
      assertTransformDestination(canonicalCandidateRoot, path),
      readCommittedPath(canonicalReleaseRoot, release.commit, path),
    );
  }

  const candidateLock = readFileFromCheckout(
    canonicalCandidateRoot,
    'pnpm-lock.yaml',
  );
  const releaseLock = readCommittedPath(
    canonicalReleaseRoot,
    release.commit,
    'pnpm-lock.yaml',
  );
  if (!normalizePnpmLock(candidateLock).equals(normalizePnpmLock(releaseLock))) {
    throw createIdentityError(
      'pnpm-lock.yaml changed outside exact workspace version metadata',
    );
  }
  writeFileSync(
    assertTransformDestination(canonicalCandidateRoot, 'pnpm-lock.yaml'),
    releaseLock,
  );
}

function readFileFromCheckout(root, path) {
  assertTransformDestination(root, path);
  return runGit(root, ['show', `HEAD:${path}`], {
    encoding: undefined,
    maxBuffer: 16 * 1024 * 1024,
  });
}
