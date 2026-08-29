#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devNull } from 'node:os';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import { packPublicPackages } from './package-artifacts.mjs';
import {
  parseFrozenConformanceLock,
  parseJsonText,
  validateJsonSchemaValue,
} from './conformance-contract.mjs';
import {
  PUBLIC_PACKAGES,
  readPackedPackageManifest,
} from './repository-metadata.mjs';
import {
  inspectReleaseRepository,
  readReleaseConfig,
  validateReleaseReadiness,
} from './release-readiness.mjs';
import {
  applyPublicationMetadataTransform,
  createPublicationSourceManifest,
  serializePublicationSourceManifest,
  verifyPublicationSourceIdentity,
} from './publication-source-identity.mjs';
import {
  AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256,
  AUTHENTICATED_NPM_CLI_TREE_SHA256,
  AUTHENTICATED_NPM_TARBALL_INTEGRITY,
  AUTHENTICATED_NPM_TARBALL_URL,
  AUTHENTICATED_COREPACK_TREE_SHA256,
  AUTHENTICATED_COREPACK_VERSION,
  AUTHENTICATED_NODE_LINUX_X64_PATH,
  AUTHENTICATED_NODE_LINUX_X64_SIZE,
  AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256,
  assertNoReleaseRuntimeShadows,
  createSterileReleaseEnvironment,
  protectedPnpmArguments,
  resolveAuthenticatedReleaseRuntime,
} from './release-runtime-integrity.mjs';

const RELEASE_MANIFEST_NAME = 'release-manifest.json';
const PUBLICATION_SOURCE_MANIFEST_NAME = 'publication-source-manifest.json';
const RELEASE_MANIFEST_SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../conformance/release-artifact-manifest.schema.json',
);
const PUBLISHER_PATH = 'scripts/publish-release-artifacts.mjs';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PUBLICATION_PACK_COMMAND =
  'sanitize package manifests; node <authenticated-corepack> pnpm@10.34.0 --config.pnpmfile=/dev/null --config.global-pnpmfile=/dev/null pack';
const CANONICAL_REPOSITORY_NPMRC = [
  'engine-strict=true',
  'save-exact=true',
  'shared-workspace-lockfile=true',
  'prefer-workspace-packages=true',
  'link-workspace-packages=true',
  '',
].join('\n');

function createPublicationToolchain(runtime) {
  return {
    nodeVersion: runtime.nodeVersion,
    nodePath: runtime.nodePath,
    nodeSize: runtime.nodeSize,
    nodeSha256: runtime.nodeSha256,
    corepackVersion: runtime.corepackVersion,
    corepackTreeSha256: runtime.corepackTreeSha256,
    pnpmVersion: 'pnpm@10.34.0',
    npmVersion: '11.5.1',
    npmTarball: AUTHENTICATED_NPM_TARBALL_URL,
    npmIntegrity: AUTHENTICATED_NPM_TARBALL_INTEGRITY,
    npmTreeSha256: AUTHENTICATED_NPM_CLI_TREE_SHA256,
    npmEntrypointSha256: AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256,
    packCommand: PUBLICATION_PACK_COMMAND,
  };
}

const EXPECTED_PUBLICATION_TOOLCHAIN = Object.freeze(
  createPublicationToolchain({
    nodeVersion: 'v24.18.1',
    nodePath: AUTHENTICATED_NODE_LINUX_X64_PATH,
    nodeSize: AUTHENTICATED_NODE_LINUX_X64_SIZE,
    nodeSha256: AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256,
    corepackVersion: AUTHENTICATED_COREPACK_VERSION,
    corepackTreeSha256: AUTHENTICATED_COREPACK_TREE_SHA256,
  }),
);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readCommittedReleaseJson(root, commit, path, label) {
  try {
    return JSON.parse(
      runReleaseProcess(
        'git',
        ['show', `${commit}:${path}`],
        root,
      ),
    );
  } catch (error) {
    throw new Error(`${label} is not valid committed JSON`, { cause: error });
  }
}

function createReleaseProcessEnvironment(include = {}) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    ...include,
  };
}

function runReleaseProcess(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    env: options.env ?? createReleaseProcessEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
    killSignal: 'SIGKILL',
  });
}

function createCommittedReleaseSource(
  root,
  commit,
  {
    releaseCommit,
    version,
    env = process.env,
  } = {},
) {
  if (
    typeof commit !== 'string'
    || !/^[0-9a-f]{40}$/u.test(commit)
  ) {
    throw new Error('Committed release source requires a full Git commit');
  }
  const status = runReleaseProcess(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    root,
  );
  if (status.length !== 0) {
    throw new Error(
      'Canonical release artifacts require a clean committed source checkout',
    );
  }
  const owned = createOwnedTempDirectory({
    prefix: 'opencoven-sdk-release-source',
    childSegments: ['repository'],
  });
  try {
    runReleaseProcess(
      '/usr/bin/git',
      [
        'clone',
        '--quiet',
        '--no-checkout',
        '--no-local',
        '--no-hardlinks',
        root,
        owned.path,
      ],
      root,
    );
    runReleaseProcess(
      '/usr/bin/git',
      ['checkout', '--quiet', '--detach', commit],
      owned.path,
    );
    const clonedCommit = runReleaseProcess(
      'git',
      ['rev-parse', 'HEAD'],
      owned.path,
    ).trim();
    if (clonedCommit !== commit) {
      throw new Error('Committed release source clone changed commit identity');
    }
    if (releaseCommit !== undefined) {
      applyPublicationMetadataTransform({
        releaseRoot: root,
        releaseCommit,
        candidateRoot: owned.path,
        version,
      });
    }
    const runtime = resolveAuthenticatedReleaseRuntime({ env });
    const home = resolve(owned.rootPath, 'home');
    const temporary = resolve(owned.rootPath, 'tmp');
    const corepackHome = resolve(owned.rootPath, 'corepack');
    for (const directory of [home, temporary, corepackHome]) {
      mkdirSync(directory, { mode: 0o700 });
    }
    const processEnvironment = {
      ...createSterileReleaseEnvironment({
        authenticatedNodePath: runtime.nodePath,
        home,
        temporary,
        corepackHome,
        include: {
          CI: 'true',
        },
      }),
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    };
    runReleaseProcess(
      runtime.nodePath,
      [
        runtime.corepackPath,
        ...protectedPnpmArguments('install', [
        '--frozen-lockfile',
        '--ignore-scripts',
        ]),
      ],
      owned.path,
      {
        timeout: 300_000,
        env: processEnvironment,
      },
    );
    assertNoReleaseRuntimeShadows(owned.path);
    return {
      ...owned,
      runtime,
      processEnvironment,
    };
  } catch (error) {
    cleanupOwnedTempRoot(owned);
    throw error;
  }
}

function assertRecord(value, context) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
}

function assertExactFields(value, fields, context) {
  assertRecord(value, context);
  const actualFields = Object.keys(value);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${context} is missing field ${field}`);
    }
  }
  for (const field of actualFields) {
    if (!fields.includes(field)) {
      throw new Error(`${context} contains unexpected field ${field}`);
    }
  }
}

export function serializeReleaseManifest(manifest) {
  const canonicalManifest =
    manifest.schemaVersion === 1
      ? {
          schemaVersion: 1,
          version: manifest.version,
          packages: manifest.packages.map((entry) => ({
            name: entry.name,
            version: entry.version,
            file: entry.file,
            size: entry.size,
            sha256: entry.sha256,
          })),
        }
      : manifest.schemaVersion === 6
        ? {
            schemaVersion: 6,
            artifactSet: manifest.artifactSet,
            version: manifest.version,
            source: {
              repository: manifest.source.repository,
              commit: manifest.source.commit,
              tree: manifest.source.tree,
              runtimeManifest: {
                file: manifest.source.runtimeManifest.file,
                size: manifest.source.runtimeManifest.size,
                sha256: manifest.source.runtimeManifest.sha256,
                runtimeSha256:
                  manifest.source.runtimeManifest.runtimeSha256,
                candidateCommit:
                  manifest.source.runtimeManifest.candidateCommit,
                candidateTree:
                  manifest.source.runtimeManifest.candidateTree,
              },
              npmConfigFiles: manifest.source.npmConfigFiles.map((entry) => ({
                path: entry.path,
                size: entry.size,
                sha256: entry.sha256,
              })),
            },
            toolchain: {
              nodeVersion: manifest.toolchain.nodeVersion,
              nodePath: manifest.toolchain.nodePath,
              nodeSize: manifest.toolchain.nodeSize,
              nodeSha256: manifest.toolchain.nodeSha256,
              corepackVersion: manifest.toolchain.corepackVersion,
              corepackTreeSha256:
                manifest.toolchain.corepackTreeSha256,
              pnpmVersion: manifest.toolchain.pnpmVersion,
              npmVersion: manifest.toolchain.npmVersion,
              npmTarball: manifest.toolchain.npmTarball,
              npmIntegrity: manifest.toolchain.npmIntegrity,
              npmTreeSha256: manifest.toolchain.npmTreeSha256,
              npmEntrypointSha256:
                manifest.toolchain.npmEntrypointSha256,
              packCommand: manifest.toolchain.packCommand,
            },
            publisher: {
              path: manifest.publisher.path,
              size: manifest.publisher.size,
              sha256: manifest.publisher.sha256,
            },
            provenance: {
              repository: manifest.provenance.repository,
              workflow: manifest.provenance.workflow,
              workflowCommit: manifest.provenance.workflowCommit,
              sourceRef: manifest.provenance.sourceRef,
              runId: manifest.provenance.runId,
              runAttempt: manifest.provenance.runAttempt,
              job: manifest.provenance.job,
              environment: manifest.provenance.environment,
              artifactName: manifest.provenance.artifactName,
            },
            packages: manifest.packages.map((entry) => ({
              name: entry.name,
              version: entry.version,
              file: entry.file,
              size: entry.size,
              sha256: entry.sha256,
            })),
          }
        : null;
  if (canonicalManifest === null) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} schemaVersion must be 1 or 6`,
    );
  }
  return `${JSON.stringify(
    canonicalManifest,
    null,
    2,
  )}\n`;
}

export function assertFrozenConformanceArtifacts(manifest, frozenLock) {
  const expectedPackages = frozenLock.candidate.sdkPackages;
  if (manifest.packages.length !== expectedPackages.length) {
    throw new Error(
      'Conformance artifacts do not match the frozen SDK candidate',
    );
  }
  for (let index = 0; index < expectedPackages.length; index += 1) {
    const actual = manifest.packages[index];
    const expected = expectedPackages[index];
    if (
      actual.name !== expected.packageName
      || actual.version !== expected.version
      || actual.file !== expected.releaseFile
      || actual.size !== expected.size
      || actual.sha256 !== expected.sha256
    ) {
      throw new Error(
        `Conformance artifact ${actual.name} does not match the frozen SDK candidate`,
      );
    }
  }
  const manifestText = serializeReleaseManifest(manifest);
  if (
    Buffer.byteLength(manifestText, 'utf8')
      !== frozenLock.candidate.releaseManifest.size
    || digest(manifestText)
      !== frozenLock.candidate.releaseManifest.sha256
  ) {
    throw new Error(
      'Conformance manifest does not match the frozen SDK candidate',
    );
  }
}

function resolveArtifactFile(artifactRoot, file, context) {
  if (
    typeof file !== 'string' ||
    file.length === 0 ||
    isAbsolute(file) ||
    file.split('/').includes('..') ||
    file.includes('\\')
  ) {
    throw new Error(`${context} file must be a relative artifact path`);
  }

  const resolvedRoot = resolve(artifactRoot);
  const resolvedFile = resolve(resolvedRoot, file);
  if (
    resolvedFile === resolvedRoot ||
    !resolvedFile.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error(`${context} file escapes the artifact root`);
  }
  return resolvedFile;
}

function readReleaseManifest(artifactRoot) {
  const manifestPath = resolve(artifactRoot, RELEASE_MANIFEST_NAME);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = parseJsonText(
    manifestText,
    RELEASE_MANIFEST_NAME,
  );
  validateJsonSchemaValue(
    manifest,
    parseJsonText(
      readFileSync(RELEASE_MANIFEST_SCHEMA_PATH, 'utf8'),
      'release artifact manifest schema',
    ),
    RELEASE_MANIFEST_NAME,
  );
  if (manifest.schemaVersion === 1) {
    assertExactFields(
      manifest,
      ['schemaVersion', 'version', 'packages'],
      RELEASE_MANIFEST_NAME,
    );
  } else if (manifest.schemaVersion === 6) {
    assertExactFields(
      manifest,
      [
        'schemaVersion',
        'artifactSet',
        'version',
        'source',
        'toolchain',
        'publisher',
        'provenance',
        'packages',
      ],
      RELEASE_MANIFEST_NAME,
    );
  } else {
    throw new Error(`${RELEASE_MANIFEST_NAME} schemaVersion must be 1 or 6`);
  }
  if (!Array.isArray(manifest.packages)) {
    throw new Error(`${RELEASE_MANIFEST_NAME} packages must be an array`);
  }
  if (serializeReleaseManifest(manifest) !== manifestText) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} must use canonical UTF-8 JSON with LF and one trailing newline`,
    );
  }
  return { manifest, manifestPath, manifestText };
}

export function assertPublishablePackedManifest(manifest, packageName) {
  assertRecord(manifest, `${packageName} packed manifest`);
  if (manifest.private === true) {
    throw new Error(
      `${packageName} publication artifact must not contain private: true`,
    );
  }
  const publishLifecycleScripts = [
    'prepublish',
    'prepare',
    'prepublishOnly',
    'prepack',
    'postpack',
    'publish',
    'postpublish',
  ];
  if (
    typeof manifest.scripts === 'object'
    && manifest.scripts !== null
    && !Array.isArray(manifest.scripts)
    && publishLifecycleScripts.some((name) =>
      Object.hasOwn(manifest.scripts, name),
    )
  ) {
    throw new Error(
      `${packageName} publication artifact must not contain publish lifecycle scripts`,
    );
  }
  if (manifest.publishConfig !== undefined) {
    throw new Error(
      `${packageName} publication artifact must not contain publishConfig overrides`,
    );
  }
}

function verifyArtifactPackages({
  artifactRoot,
  manifest,
  version,
  requirePublishable,
  env,
}) {
  if (manifest.packages.length !== PUBLIC_PACKAGES.length) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} must contain exactly ${PUBLIC_PACKAGES.length} packages`,
    );
  }

  const names = new Set();
  for (const [index, packageMetadata] of PUBLIC_PACKAGES.entries()) {
    const entry = manifest.packages[index];
    assertExactFields(
      entry,
      ['name', 'version', 'file', 'size', 'sha256'],
      `${RELEASE_MANIFEST_NAME} package ${index}`,
    );
    if (names.has(entry.name)) {
      throw new Error(
        `${RELEASE_MANIFEST_NAME} contains duplicate package ${entry.name}`,
      );
    }
    names.add(entry.name);
    if (entry.name !== packageMetadata.packageName) {
      throw new Error(
        `${RELEASE_MANIFEST_NAME} package ${index} must be ${packageMetadata.packageName}`,
      );
    }
    if (entry.version !== version) {
      throw new Error(`${entry.name} artifact version must be ${version}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(
        `${entry.name} artifact size must be a non-negative integer`,
      );
    }
    if (
      typeof entry.sha256 !== 'string'
      || !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw new Error(
        `${entry.name} artifact sha256 must be 64 lowercase hex characters`,
      );
    }

    const tarballPath = resolveArtifactFile(
      artifactRoot,
      entry.file,
      entry.name,
    );
    const expectedDirectory = resolve(
      artifactRoot,
      'tarballs',
      packageMetadata.workspaceDirectory,
    );
    if (
      dirname(tarballPath) !== expectedDirectory
      || !basename(tarballPath).endsWith('.tgz')
    ) {
      throw new Error(
        `${entry.name} artifact file must use its canonical tarball directory`,
      );
    }

    const stats = lstatSync(tarballPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${entry.name} artifact must be a regular file`);
    }
    const bytes = readFileSync(tarballPath);
    if (bytes.byteLength !== entry.size) {
      throw new Error(
        `${entry.name} size does not match ${RELEASE_MANIFEST_NAME}`,
      );
    }
    if (digest(bytes) !== entry.sha256) {
      throw new Error(
        `${entry.name} digest does not match ${RELEASE_MANIFEST_NAME}`,
      );
    }

    const packedManifest = readPackedPackageManifest(tarballPath, { env });
    if (
      packedManifest.name !== entry.name
      || packedManifest.version !== entry.version
    ) {
      throw new Error(
        `${entry.name} packed manifest does not match release metadata`,
      );
    }
    if (requirePublishable) {
      assertPublishablePackedManifest(packedManifest, entry.name);
    }
  }
}

function packArtifactEntries({
  packageRoot,
  artifactRoot,
  build,
  version,
  requirePublishable,
  sanitizePublishManifests = false,
  env,
  nodePath,
  corepackPath,
}) {
  const tarballs = packPublicPackages({
    root: packageRoot,
    destinationRoot: resolve(artifactRoot, 'tarballs'),
    build,
    sanitizePublishManifests,
    env,
    nodePath,
    corepackPath,
  });
  return PUBLIC_PACKAGES.map(({ packageName, workspaceDirectory }) => {
    const tarballPath = tarballs[workspaceDirectory];
    if (typeof tarballPath !== 'string') {
      throw new Error(`Missing packed tarball for ${packageName}`);
    }

    const packedManifest = readPackedPackageManifest(tarballPath, { env });
    if (
      packedManifest.name !== packageName
      || packedManifest.version !== version
    ) {
      throw new Error(
        `Packed manifest for ${packageName} must use version ${version}`,
      );
    }
    if (requirePublishable) {
      assertPublishablePackedManifest(packedManifest, packageName);
    }

    const bytes = readFileSync(tarballPath);
    return {
      name: packageName,
      version,
      file: relative(artifactRoot, tarballPath).split(sep).join('/'),
      size: bytes.byteLength,
      sha256: digest(bytes),
    };
  });
}

export function createConformanceArtifacts({
  root = process.cwd(),
  outputRoot,
  build = true,
  version,
  requireConformanceEvidence = true,
} = {}) {
  if (typeof build !== 'boolean') {
    throw new Error('build must be a boolean');
  }
  if (typeof requireConformanceEvidence !== 'boolean') {
    throw new Error('requireConformanceEvidence must be a boolean');
  }
  const releaseCommit = requireConformanceEvidence
    ? runReleaseProcess('git', ['rev-parse', 'HEAD'], root).trim()
    : undefined;

  const readiness = validateReleaseReadiness({
    root,
    version,
    requireConformanceEvidence,
  });
  if (requireConformanceEvidence && !build) {
    throw new Error(
      'Frozen conformance artifacts must build from the committed candidate checkout',
    );
  }
  const ownedDirectory =
    outputRoot === undefined
      ? createOwnedTempDirectory({
          prefix: 'opencoven-sdk-conformance-artifacts',
        })
      : undefined;
  const artifactRoot = resolve(outputRoot ?? ownedDirectory.rootPath);
  const manifestPath = resolve(artifactRoot, RELEASE_MANIFEST_NAME);
  const committedReleaseConfig =
    releaseCommit === undefined
      ? undefined
      : readCommittedReleaseJson(
          root,
          releaseCommit,
          'release.config.json',
          'Committed release configuration',
        );
  const candidateCommit =
    committedReleaseConfig?.conformanceEvidence?.candidateCommit;
  const committedSource = requireConformanceEvidence
    ? createCommittedReleaseSource(
        root,
        candidateCommit,
      )
    : undefined;
  const packageRoot = committedSource?.path ?? root;

  try {
    if (existsSync(manifestPath)) {
      throw new Error(`Release manifest already exists: ${manifestPath}`);
    }
    mkdirSync(resolve(artifactRoot, 'tarballs'), { recursive: true });

    const packages = packArtifactEntries({
      packageRoot,
      artifactRoot,
      build,
      version: readiness.version,
      requirePublishable: false,
    });
    const manifest = {
      schemaVersion: 1,
      version: readiness.version,
      packages,
    };
    if (requireConformanceEvidence) {
      const frozenLock = parseFrozenConformanceLock(
        runReleaseProcess(
          'git',
          [
            'show',
            `${releaseCommit}:conformance/client-v1-cross-repository-lock.json`,
          ],
          root,
        ),
        'committed frozen conformance lock',
      );
      assertFrozenConformanceArtifacts(
        manifest,
        frozenLock,
      );
      if (
        runReleaseProcess('git', ['rev-parse', 'HEAD'], root).trim()
          !== releaseCommit
      ) {
        throw new Error(
          'Conformance checkout changed commit during artifact creation',
        );
      }
    }

    writeFileSync(manifestPath, serializeReleaseManifest(manifest), {
      flag: 'wx',
    });

    verifyConformanceArtifacts({
      root,
      artifactRoot,
      version: readiness.version,
      requireConformanceEvidence,
    });
    return {
      artifactRoot,
      artifactSet: requireConformanceEvidence
        ? 'conformance-candidate'
        : 'local-verification',
      manifestPath,
      manifest,
      ownedDirectory,
    };
  } finally {
    if (committedSource !== undefined) {
      cleanupOwnedTempRoot(committedSource);
    }
  }
}

export function verifyConformanceArtifacts({
  root = process.cwd(),
  artifactRoot,
  version,
  requireConformanceEvidence = true,
} = {}) {
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) {
    throw new Error('artifactRoot is required');
  }

  if (typeof requireConformanceEvidence !== 'boolean') {
    throw new Error('requireConformanceEvidence must be a boolean');
  }
  const releaseCommit = requireConformanceEvidence
    ? runReleaseProcess('git', ['rev-parse', 'HEAD'], root).trim()
    : undefined;
  const readiness = validateReleaseReadiness({
    root,
    version,
    requireConformanceEvidence,
  });
  const { manifest } = readReleaseManifest(artifactRoot);
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} must identify the conformance artifact set`,
    );
  }
  if (manifest.version !== readiness.version) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} version must be ${readiness.version}`,
    );
  }
  verifyArtifactPackages({
    artifactRoot,
    manifest,
    version: readiness.version,
    requirePublishable: false,
  });
  if (releaseCommit !== undefined) {
    const frozenLock = parseFrozenConformanceLock(
      runReleaseProcess(
        'git',
        [
          'show',
          `${releaseCommit}:conformance/client-v1-cross-repository-lock.json`,
        ],
        root,
      ),
      'committed frozen conformance lock',
    );
    assertFrozenConformanceArtifacts(manifest, frozenLock);
    if (
      runReleaseProcess('git', ['rev-parse', 'HEAD'], root).trim()
        !== releaseCommit
    ) {
      throw new Error(
        'Conformance checkout changed commit during artifact verification',
      );
    }
  }

  return manifest;
}

export function inspectRepositoryNpmConfiguration(root) {
  const trackedConfigPaths = runReleaseProcess(
    'git',
    ['ls-files', '-z'],
    root,
  )
    .split('\0')
    .filter((path) => {
      const name = basename(path);
      return name === '.npmrc' || name === 'npmrc';
    });
  if (
    trackedConfigPaths.length !== 1
    || trackedConfigPaths[0] !== '.npmrc'
  ) {
    throw new Error(
      'Release repository npm configuration is not canonical',
    );
  }
  const path = resolve(root, '.npmrc');
  const stats = lstatSync(path);
  const bytes = readFileSync(path);
  const committedBytes = runReleaseProcess(
    'git',
    ['show', 'HEAD:.npmrc'],
    root,
    { encoding: 'buffer' },
  );
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || !bytes.equals(committedBytes)
    || bytes.toString('utf8') !== CANONICAL_REPOSITORY_NPMRC
  ) {
    throw new Error(
      'Release repository npm configuration is not canonical',
    );
  }
  return [
    {
      path: '.npmrc',
      size: bytes.byteLength,
      sha256: digest(bytes),
    },
  ];
}

function inspectPublicationSource(root, config) {
  if (config.publishingEnabled !== true) {
    throw new Error('Release publishing is disabled by release.config.json');
  }
  const checkout = inspectReleaseRepository(root);
  const status = runReleaseProcess(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    checkout.root,
  );
  if (status.length !== 0) {
    throw new Error(
      'Publication artifacts require a clean exact release commit checkout',
    );
  }
  const runtimeManifest = createPublicationSourceManifest({
    root: checkout.root,
    commit: config.conformanceEvidence.candidateCommit,
  });
  if (
    runtimeManifest.runtimeSha256
      !== config.conformanceEvidence.runtimeManifestSha256
  ) {
    throw new Error(
      'Frozen publication source manifest digest does not match release.config.json',
    );
  }
  verifyPublicationSourceIdentity({
    root: checkout.root,
    releaseCommit: checkout.commit,
    manifest: runtimeManifest,
  });
  const runtimeManifestText =
    serializePublicationSourceManifest(runtimeManifest);
  return {
    releaseCommit: checkout.commit,
    sourceCommit: checkout.commit,
    sourceTree: checkout.tree,
    runtimeManifest,
    runtimeManifestText,
    runtimeManifestMetadata: {
      file: PUBLICATION_SOURCE_MANIFEST_NAME,
      size: Buffer.byteLength(runtimeManifestText, 'utf8'),
      sha256: digest(runtimeManifestText),
      runtimeSha256: runtimeManifest.runtimeSha256,
      candidateCommit: runtimeManifest.candidate.commit,
      candidateTree: runtimeManifest.candidate.tree,
    },
    npmConfigFiles: inspectRepositoryNpmConfiguration(checkout.root),
    publisher: inspectCommittedPublisher(checkout.root, checkout.commit),
  };
}

function inspectCommittedPublisher(root, commit) {
  const path = resolve(root, PUBLISHER_PATH);
  const stats = lstatSync(path);
  const entry = runReleaseProcess(
    'git',
    ['ls-tree', commit, '--', PUBLISHER_PATH],
    root,
  ).trim();
  const match = /^100(?:644|755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
  if (
    match === null
    || match[2] !== PUBLISHER_PATH
    || stats.isSymbolicLink()
    || !stats.isFile()
  ) {
    throw new Error(
      'Sterile publisher runtime must be the exact committed regular file',
    );
  }
  const bytes = readFileSync(path);
  const committedBytes = runReleaseProcess(
    'git',
    ['cat-file', 'blob', match[1]],
    root,
    { encoding: 'buffer' },
  );
  if (!bytes.equals(committedBytes)) {
    throw new Error(
      'Sterile publisher runtime must be the exact committed regular file',
    );
  }
  return {
    path: PUBLISHER_PATH,
    size: bytes.byteLength,
    sha256: digest(bytes),
  };
}

function readPublicationProvenance(env, source, config, version) {
  const workflowRefPrefix =
    `${source.repository ?? 'OpenCoven/sdk'}/`
    + `${config.publicationCandidate.workflow}@`;
  const workflowRef = env.GITHUB_WORKFLOW_REF;
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  const expectedArtifactName =
    `opencoven-sdk-publication-${source.sourceCommit}-${version}`;
  if (
    env.GITHUB_REPOSITORY !== 'OpenCoven/sdk'
    || env.GITHUB_SHA !== source.sourceCommit
    || env.GITHUB_WORKFLOW_SHA !== source.sourceCommit
    || typeof workflowRef !== 'string'
    || !workflowRef.startsWith(workflowRefPrefix)
    || workflowRef.slice(workflowRefPrefix.length) !== 'refs/heads/main'
    || env.GITHUB_JOB !== config.publicationCandidate.job
    || env.OPENCOVEN_PUBLICATION_ENVIRONMENT
      !== config.publicationCandidate.environment
    || typeof env.GITHUB_RUN_ID !== 'string'
    || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ID)
    || !Number.isSafeInteger(runAttempt)
    || runAttempt < 1
    || runAttempt > 1_000
    || env.OPENCOVEN_PUBLICATION_ARTIFACT_NAME !== expectedArtifactName
  ) {
    throw new Error(
      'Publication candidate requires exact GitHub workflow provenance for the release commit',
    );
  }
  return {
    repository: 'OpenCoven/sdk',
    workflow: config.publicationCandidate.workflow,
    workflowCommit: source.sourceCommit,
    sourceRef: 'refs/heads/main',
    runId: env.GITHUB_RUN_ID,
    runAttempt,
    job: config.publicationCandidate.job,
    environment: config.publicationCandidate.environment,
    artifactName: expectedArtifactName,
  };
}

function listArtifactFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new Error('Publication artifact set must not contain symbolic links');
    }
    if (entry.isDirectory()) {
      files.push(...listArtifactFiles(root, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error('Publication artifact set must contain only regular files');
    }
    files.push(relative(root, path).split(sep).join('/'));
  }
  return files.sort();
}

function verifyPublicationArtifactSet({
  root,
  artifactRoot,
  version,
  expectedProvenance,
}) {
  const config = readReleaseConfig(root);
  const source = inspectPublicationSource(root, config);
  const { manifest } = readReleaseManifest(artifactRoot);
  if (
    manifest.schemaVersion !== 6
    || manifest.artifactSet !== 'publication-candidate'
  ) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} must identify the publication-candidate artifact set`,
    );
  }
  assertExactFields(
    manifest.source,
    ['repository', 'commit', 'tree', 'runtimeManifest', 'npmConfigFiles'],
    `${RELEASE_MANIFEST_NAME} source`,
  );
  assertExactFields(
    manifest.source.runtimeManifest,
    [
      'file',
      'size',
      'sha256',
      'runtimeSha256',
      'candidateCommit',
      'candidateTree',
    ],
    `${RELEASE_MANIFEST_NAME} source.runtimeManifest`,
  );
  assertExactFields(
    manifest.toolchain,
    [
      'nodeVersion',
      'nodePath',
      'nodeSize',
      'nodeSha256',
      'corepackVersion',
      'corepackTreeSha256',
      'pnpmVersion',
      'npmVersion',
      'npmTarball',
      'npmIntegrity',
      'npmTreeSha256',
      'npmEntrypointSha256',
      'packCommand',
    ],
    `${RELEASE_MANIFEST_NAME} toolchain`,
  );
  assertExactFields(
    manifest.publisher,
    ['path', 'size', 'sha256'],
    `${RELEASE_MANIFEST_NAME} publisher`,
  );
  assertExactFields(
    manifest.provenance,
    [
      'repository',
      'workflow',
      'workflowCommit',
      'sourceRef',
      'runId',
      'runAttempt',
      'job',
      'environment',
      'artifactName',
    ],
    `${RELEASE_MANIFEST_NAME} provenance`,
  );
  const expectedArtifactName =
    `opencoven-sdk-publication-${source.sourceCommit}-${manifest.version}`;
  const runtimeManifestPath = resolveArtifactFile(
    artifactRoot,
    manifest.source.runtimeManifest.file,
    'Publication source manifest',
  );
  const runtimeManifestStats = lstatSync(runtimeManifestPath);
  const runtimeManifestBytes = readFileSync(runtimeManifestPath);
  const runtimeManifestText = runtimeManifestBytes.toString('utf8');
  if (
    manifest.source.repository !== 'OpenCoven/sdk'
    || manifest.source.commit !== source.sourceCommit
    || manifest.source.tree !== source.sourceTree
    || JSON.stringify(manifest.source.npmConfigFiles)
      !== JSON.stringify(source.npmConfigFiles)
    || runtimeManifestStats.isSymbolicLink()
    || !runtimeManifestStats.isFile()
    || manifest.source.runtimeManifest.file
      !== PUBLICATION_SOURCE_MANIFEST_NAME
    || manifest.source.runtimeManifest.size
      !== runtimeManifestBytes.byteLength
    || manifest.source.runtimeManifest.sha256
      !== digest(runtimeManifestBytes)
    || manifest.source.runtimeManifest.runtimeSha256
      !== source.runtimeManifest.runtimeSha256
    || manifest.source.runtimeManifest.candidateCommit
      !== source.runtimeManifest.candidate.commit
    || manifest.source.runtimeManifest.candidateTree
      !== source.runtimeManifest.candidate.tree
    || runtimeManifestText !== source.runtimeManifestText
    || JSON.stringify(manifest.toolchain)
      !== JSON.stringify(EXPECTED_PUBLICATION_TOOLCHAIN)
    || JSON.stringify(manifest.publisher)
      !== JSON.stringify(source.publisher)
    || manifest.toolchain.npmVersion !== config.npmCliVersion
    || manifest.provenance.repository !== 'OpenCoven/sdk'
    || manifest.provenance.workflow
      !== config.publicationCandidate.workflow
    || manifest.provenance.workflowCommit !== source.sourceCommit
    || manifest.provenance.sourceRef !== 'refs/heads/main'
    || manifest.provenance.job !== config.publicationCandidate.job
    || manifest.provenance.environment
      !== config.publicationCandidate.environment
    || manifest.provenance.artifactName !== expectedArtifactName
    || typeof manifest.provenance.runId !== 'string'
    || !/^[1-9]\d*$/u.test(manifest.provenance.runId)
    || !Number.isSafeInteger(manifest.provenance.runAttempt)
    || manifest.provenance.runAttempt < 1
  ) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} publication source and provenance must match the exact release commit`,
    );
  }
  if (
    expectedProvenance !== undefined
    && JSON.stringify(manifest.provenance)
      !== JSON.stringify(expectedProvenance)
  ) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} provenance does not match the expected workflow run`,
    );
  }
  if (version !== undefined && manifest.version !== version) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} version must be ${version}`,
    );
  }
  verifyArtifactPackages({
    artifactRoot,
    manifest,
    version: manifest.version,
    requirePublishable: true,
    env: createReleaseProcessEnvironment(),
  });
  const expectedFiles = [
    RELEASE_MANIFEST_NAME,
    PUBLICATION_SOURCE_MANIFEST_NAME,
    ...manifest.packages.map(({ file }) => file),
  ].sort();
  if (
    JSON.stringify(listArtifactFiles(artifactRoot))
      !== JSON.stringify(expectedFiles)
  ) {
    throw new Error(
      'Publication artifact set contains unexpected or missing files',
    );
  }
  if (
    runReleaseProcess('git', ['rev-parse', 'HEAD'], root).trim()
      !== source.releaseCommit
    || runReleaseProcess('git', ['rev-parse', 'HEAD^{tree}'], root).trim()
      !== source.sourceTree
  ) {
    throw new Error(
      'Release checkout changed commit during publication artifact verification',
    );
  }
  return manifest;
}

export function createPublicationArtifacts({
  root = process.cwd(),
  outputRoot,
  build = true,
  version,
  env = process.env,
} = {}) {
  if (typeof build !== 'boolean') {
    throw new Error('build must be a boolean');
  }
  const config = readReleaseConfig(root);
  const source = inspectPublicationSource(root, config);
  if (!build) {
    throw new Error(
      'Publication artifacts must build from the committed release source',
    );
  }
  const readiness = validateReleaseReadiness({
    root,
    mode: 'verify',
    version,
    requireConformanceEvidence: true,
  });
  const provenance = readPublicationProvenance(
    env,
    source,
    config,
    readiness.version,
  );
  const ownedDirectory =
    outputRoot === undefined
      ? createOwnedTempDirectory({
          prefix: 'opencoven-sdk-publication-artifacts',
        })
      : undefined;
  const artifactRoot = resolve(outputRoot ?? ownedDirectory.rootPath);
  const manifestPath = resolve(artifactRoot, RELEASE_MANIFEST_NAME);
  const committedSource = createCommittedReleaseSource(
    root,
    source.runtimeManifest.candidate.commit,
    {
      releaseCommit: source.releaseCommit,
      version: readiness.version,
      env,
    },
  );

  try {
    if (existsSync(manifestPath)) {
      throw new Error(`Release manifest already exists: ${manifestPath}`);
    }
    mkdirSync(resolve(artifactRoot, 'tarballs'), { recursive: true });
    writeFileSync(
      resolve(artifactRoot, PUBLICATION_SOURCE_MANIFEST_NAME),
      source.runtimeManifestText,
      { flag: 'wx' },
    );
    const packages = packArtifactEntries({
      packageRoot: committedSource.path,
      artifactRoot,
      build,
      version: readiness.version,
      requirePublishable: true,
      sanitizePublishManifests: true,
      env: committedSource.processEnvironment,
      nodePath: committedSource.runtime.nodePath,
      corepackPath: committedSource.runtime.corepackPath,
    });
    const manifest = {
      schemaVersion: 6,
      artifactSet: 'publication-candidate',
      version: readiness.version,
      source: {
        repository: 'OpenCoven/sdk',
        commit: source.sourceCommit,
        tree: source.sourceTree,
        runtimeManifest: source.runtimeManifestMetadata,
        npmConfigFiles: source.npmConfigFiles,
      },
      toolchain: createPublicationToolchain(committedSource.runtime),
      publisher: source.publisher,
      provenance,
      packages,
    };
    writeFileSync(manifestPath, serializeReleaseManifest(manifest), {
      flag: 'wx',
    });
    verifyPublicationArtifactSet({
      root,
      artifactRoot,
      version: readiness.version,
      expectedProvenance: provenance,
    });
    return {
      artifactRoot,
      artifactSet: 'publication-candidate',
      manifestPath,
      manifest,
      ownedDirectory,
    };
  } finally {
    cleanupOwnedTempRoot(committedSource);
  }
}

export function verifyPublicationArtifacts({
  root = process.cwd(),
  artifactRoot,
  version,
  expectedProvenance,
} = {}) {
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) {
    throw new Error('artifactRoot is required');
  }
  return verifyPublicationArtifactSet({
    root,
    artifactRoot,
    version,
    expectedProvenance,
  });
}

export function parseReleaseArtifactArguments(arguments_) {
  const options = { build: true };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (index === 0 && argument === '--') {
      continue;
    }
    if (argument === '--skip-build') {
      options.build = false;
      continue;
    }
    const key = argument === '--output' ? 'outputRoot' : argument === '--version' ? 'version' : undefined;
    if (key === undefined) {
      throw new Error(`Unknown option ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new Error(`Option ${argument} may only be provided once`);
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

export function main(arguments_ = process.argv.slice(2)) {
  const result = createPublicationArtifacts({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    ...parseReleaseArtifactArguments(arguments_),
  });
  process.stdout.write(
    `${JSON.stringify({
      artifactRoot: result.artifactRoot,
      manifestPath: result.manifestPath,
      manifest: result.manifest,
    })}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
