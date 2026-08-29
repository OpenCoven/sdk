#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devNull } from 'node:os';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import {
  verifyPublicationSecurityReview,
} from './github-release-authorization.mjs';
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
  readReleaseConfig,
  validateReleaseReadiness,
} from './release-readiness.mjs';

const RELEASE_MANIFEST_NAME = 'release-manifest.json';
const RELEASE_MANIFEST_SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../conformance/release-artifact-manifest.schema.json',
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function createReleaseProcessEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    const normalizedKey = key.toUpperCase();
    if (
      !normalizedKey.startsWith('GIT_')
      && normalizedKey !== 'GH_TOKEN'
      && normalizedKey !== 'GITHUB_TOKEN'
      && value !== undefined
    ) {
      environment[key] = value;
    }
  }
  environment.GIT_CONFIG_GLOBAL = devNull;
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_TERMINAL_PROMPT = '0';
  return environment;
}

function runReleaseProcess(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    env: createReleaseProcessEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
    killSignal: 'SIGKILL',
  });
}

function createCommittedReleaseSource(root, commit) {
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
      'git',
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
      'git',
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
    runReleaseProcess(
      'corepack',
      ['pnpm@10.34.0', 'install', '--frozen-lockfile'],
      owned.path,
      { timeout: 300_000 },
    );
    return owned;
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
      : manifest.schemaVersion === 2
        ? {
            schemaVersion: 2,
            artifactSet: manifest.artifactSet,
            version: manifest.version,
            source: {
              repository: manifest.source.repository,
              commit: manifest.source.commit,
              tree: manifest.source.tree,
            },
            securityReview: {
              issue: manifest.securityReview.issue,
              commentId: manifest.securityReview.commentId,
              reviewer: manifest.securityReview.reviewer,
              reviewedCommit: manifest.securityReview.reviewedCommit,
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
      `${RELEASE_MANIFEST_NAME} schemaVersion must be 1 or 2`,
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
  } else if (manifest.schemaVersion === 2) {
    assertExactFields(
      manifest,
      [
        'schemaVersion',
        'artifactSet',
        'version',
        'source',
        'securityReview',
        'packages',
      ],
      RELEASE_MANIFEST_NAME,
    );
  } else {
    throw new Error(`${RELEASE_MANIFEST_NAME} schemaVersion must be 1 or 2`);
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
  env,
}) {
  const tarballs = packPublicPackages({
    root: packageRoot,
    destinationRoot: resolve(artifactRoot, 'tarballs'),
    build,
    env,
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

function requireUnlockedPublicationCandidate(config) {
  const publication = config.publicationCandidate;
  if (
    config.publishingEnabled !== true
    || typeof publication.unlockCommit !== 'string'
    || publication.securityReviewedCommit !== publication.unlockCommit
  ) {
    throw new Error(
      'release.config.json publicationCandidate must be unlocked and security-reviewed before publication artifacts are created',
    );
  }
  return publication;
}

function inspectPublicationSource(root, config) {
  const publication = requireUnlockedPublicationCandidate(config);
  const releaseCommit = runReleaseProcess(
    'git',
    ['rev-parse', 'HEAD'],
    root,
  ).trim();
  runReleaseProcess(
    'git',
    ['cat-file', '-e', `${publication.unlockCommit}^{commit}`],
    root,
  );
  runReleaseProcess(
    'git',
    ['merge-base', '--is-ancestor', publication.unlockCommit, releaseCommit],
    root,
  );
  runReleaseProcess(
    'git',
    [
      'merge-base',
      '--is-ancestor',
      config.conformanceEvidence.candidateCommit,
      publication.unlockCommit,
    ],
    root,
  );
  const sourceTree = runReleaseProcess(
    'git',
    ['rev-parse', `${publication.unlockCommit}^{tree}`],
    root,
  ).trim();
  const securityReview = verifyPublicationSecurityReview({
    publicationCandidate: publication,
    sourceTree,
  });
  return {
    releaseCommit,
    sourceCommit: publication.unlockCommit,
    sourceTree,
    securityReview,
  };
}

function verifyPublicationArtifactSet({
  root,
  artifactRoot,
  version,
}) {
  const config = readReleaseConfig(root);
  const source = inspectPublicationSource(root, config);
  const { manifest } = readReleaseManifest(artifactRoot);
  if (
    manifest.schemaVersion !== 2
    || manifest.artifactSet !== 'publication-candidate'
  ) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} must identify the publication-candidate artifact set`,
    );
  }
  assertExactFields(
    manifest.source,
    ['repository', 'commit', 'tree'],
    `${RELEASE_MANIFEST_NAME} source`,
  );
  assertExactFields(
    manifest.securityReview,
    ['issue', 'commentId', 'reviewer', 'reviewedCommit'],
    `${RELEASE_MANIFEST_NAME} securityReview`,
  );
  if (
    manifest.source.repository !== 'OpenCoven/sdk'
    || manifest.source.commit !== source.sourceCommit
    || manifest.source.tree !== source.sourceTree
    || manifest.securityReview.issue !== source.securityReview.issue
    || manifest.securityReview.commentId !== source.securityReview.commentId
    || manifest.securityReview.reviewer !== source.securityReview.reviewer
    || manifest.securityReview.reviewedCommit
      !== source.securityReview.commit
  ) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} publication source must match the exact #40-reviewed unlock commit`,
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
  if (
    runReleaseProcess('git', ['rev-parse', 'HEAD'], root).trim()
      !== source.releaseCommit
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
} = {}) {
  if (typeof build !== 'boolean') {
    throw new Error('build must be a boolean');
  }
  const config = readReleaseConfig(root);
  const source = inspectPublicationSource(root, config);
  if (!build) {
    throw new Error(
      'Publication artifacts must build from the committed unlock source',
    );
  }
  const readiness = validateReleaseReadiness({
    root,
    mode: 'publish',
    version,
    requireConformanceEvidence: true,
  });
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
    source.sourceCommit,
  );

  try {
    if (existsSync(manifestPath)) {
      throw new Error(`Release manifest already exists: ${manifestPath}`);
    }
    mkdirSync(resolve(artifactRoot, 'tarballs'), { recursive: true });
    const packages = packArtifactEntries({
      packageRoot: committedSource.path,
      artifactRoot,
      build,
      version: readiness.version,
      requirePublishable: true,
      env: createReleaseProcessEnvironment(),
    });
    const manifest = {
      schemaVersion: 2,
      artifactSet: 'publication-candidate',
      version: readiness.version,
      source: {
        repository: 'OpenCoven/sdk',
        commit: source.sourceCommit,
        tree: source.sourceTree,
      },
      securityReview: {
        issue: source.securityReview.issue,
        commentId: source.securityReview.commentId,
        reviewer: source.securityReview.reviewer,
        reviewedCommit: source.securityReview.commit,
      },
      packages,
    };
    writeFileSync(manifestPath, serializeReleaseManifest(manifest), {
      flag: 'wx',
    });
    verifyPublicationArtifactSet({
      root,
      artifactRoot,
      version: readiness.version,
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
} = {}) {
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) {
    throw new Error('artifactRoot is required');
  }
  const manifest = verifyPublicationArtifactSet({
    root,
    artifactRoot,
    version,
  });
  const readiness = validateReleaseReadiness({
    root,
    mode: 'publish',
    version: manifest.version,
    requireConformanceEvidence: true,
  });
  if (readiness.version !== manifest.version) {
    throw new Error(
      `${RELEASE_MANIFEST_NAME} version must be ${readiness.version}`,
    );
  }
  return manifest;
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
