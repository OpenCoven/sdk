import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { devNull } from 'node:os';
import { resolve } from 'node:path';

import { PUBLIC_PACKAGES } from './repository-metadata.mjs';
import {
  assertEvidenceProducerCompatibility,
  parseFrozenConformanceLock,
  validateFrozenConformanceBindings,
} from './conformance-contract.mjs';

const CONFIG_FIELDS = Object.freeze([
  'schemaVersion',
  'publishingEnabled',
  'tagPrefix',
  'npmAccess',
  'npmDistTag',
  'githubEnvironment',
  'supportedNode',
  'nativeConformancePlatforms',
  'conformanceEvidence',
  'packages',
]);
const NODE_ENGINE = '>=24.18.0 <25';
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const SUPPORTED_PLATFORMS = Object.freeze([
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
]);
const CONFORMANCE_RESULTS_DIRECTORY =
  'docs/client-v1-cross-repository-results';
const CONFORMANCE_LOCK_PATH =
  'conformance/client-v1-cross-repository-lock.json';
const CONFORMANCE_REGISTRY_PATH =
  'conformance/client-v1-cross-repository-assertions.json';
const CONFORMANCE_SCHEMA_PATH =
  'conformance/client-v1-cross-repository-evidence.schema.json';
const CONFORMANCE_VERIFIER_PATH =
  'scripts/verify-committed-conformance-evidence.mjs';
const VALIDATOR_RUNTIME_PATHS = Object.freeze([
  '.github/workflows/release.yml',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/aggregate-client-v1-conformance.mjs',
  'scripts/conformance-contract.mjs',
  'scripts/create-release-artifacts.mjs',
  'scripts/owned-temp-directory.mjs',
  'scripts/package-artifacts.mjs',
  'scripts/publish-release-artifacts.mjs',
  'scripts/release-readiness.mjs',
  'scripts/repository-metadata.mjs',
  CONFORMANCE_VERIFIER_PATH,
  'scripts/verify-release-readiness.mjs',
]);
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function createReadinessGitEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_') && value !== undefined) {
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

function readCommittedBlob(root, commit, path) {
  return execFileSync(
    'git',
    ['-C', root, 'cat-file', 'blob', `${commit}:${path}`],
    {
      encoding: 'buffer',
      env: createReadinessGitEnvironment(),
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
}

function readCommittedRegularBlob(root, commit, path, label) {
  const entry = runReadinessGit(
    root,
    ['ls-tree', commit, '--', path],
  ).trim();
  const match = /^100(?:644|755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
  if (match === null || match[2] !== path) {
    throw new Error(`${label} is not a committed regular file`);
  }
  return runReadinessGit(
    root,
    ['cat-file', 'blob', match[1]],
    { encoding: 'buffer' },
  );
}

export function validateValidatorRuntimeFiles(
  root,
  validatorCommit,
  releaseCommit = 'HEAD',
) {
  for (const [value, label] of [
    [validatorCommit, 'validatorCommit'],
    [releaseCommit, 'releaseCommit'],
  ]) {
    if (
      typeof value !== 'string'
      || !/^(?:HEAD|[0-9a-f]{40})$/u.test(value)
    ) {
      throw new Error(`${label} must be HEAD or a full Git commit`);
    }
  }
  for (const path of VALIDATOR_RUNTIME_PATHS) {
    const validatorBytes = readCommittedRegularBlob(
      root,
      validatorCommit,
      path,
      `Validator runtime file ${path}`,
    );
    const releaseBytes = readCommittedRegularBlob(
      root,
      releaseCommit,
      path,
      `Release runtime file ${path}`,
    );
    if (!validatorBytes.equals(releaseBytes)) {
      throw new Error(
        `Validator runtime file ${path} differs from the recorded validator commit`,
      );
    }
    const workingPath = resolve(root, path);
    let stats;
    let workingBytes;
    try {
      stats = lstatSync(workingPath);
      workingBytes = readFileSync(workingPath);
    } catch (error) {
      throw new Error(
        `Validator runtime file ${path} does not match the release commit working tree`,
        { cause: error },
      );
    }
    const status = runReadinessGit(
      root,
      [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        path,
      ],
    );
    if (
      stats.isSymbolicLink()
      || !stats.isFile()
      || !workingBytes.equals(releaseBytes)
      || status.length !== 0
    ) {
      throw new Error(
        `Validator runtime file ${path} does not match the release commit working tree`,
      );
    }
  }
}

function runReadinessGit(
  root,
  arguments_,
  { encoding = 'utf8', stdio = ['ignore', 'pipe', 'ignore'] } = {},
) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.excludesFile=',
      '-c',
      `core.attributesFile=${devNull}`,
      '-c',
      'core.fsmonitor=false',
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
      env: createReadinessGitEnvironment(),
      maxBuffer: 32 * 1024 * 1024,
      stdio,
      timeout: 15_000,
      killSignal: 'SIGKILL',
    },
  );
}

function normalizeGitHubRepository(remote) {
  const trimmed = remote.trim();
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(
      trimmed,
    );
  return match?.[1] ?? null;
}

function inspectReleaseRepository(root) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch (error) {
    throw new Error('Release readiness root must be a readable Git checkout', {
      cause: error,
    });
  }
  let gitRoot;
  try {
    gitRoot = realpathSync(
      runReadinessGit(canonicalRoot, ['rev-parse', '--show-toplevel']).trim(),
    );
  } catch (error) {
    throw new Error('Release readiness root must be a readable Git checkout', {
      cause: error,
    });
  }
  if (gitRoot !== canonicalRoot) {
    throw new Error('Release readiness root must equal the Git top-level');
  }
  const repository = normalizeGitHubRepository(
    runReadinessGit(canonicalRoot, ['remote', 'get-url', 'origin']),
  );
  if (repository !== 'OpenCoven/sdk') {
    throw new Error('Release readiness checkout origin must be OpenCoven/sdk');
  }
  return {
    root: canonicalRoot,
    repository,
    commit: runReadinessGit(canonicalRoot, ['rev-parse', 'HEAD']).trim(),
    tree: runReadinessGit(
      canonicalRoot,
      ['rev-parse', 'HEAD^{tree}'],
    ).trim(),
  };
}

function readCommittedCleanFile(
  checkout,
  path,
  label,
  maximumBytes = 1_048_576,
) {
  if (
    typeof path !== 'string'
    || !/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9@._/-]+$/u.test(
      path,
    )
  ) {
    throw new Error(`${label} path is not canonical`);
  }
  const treeEntry = runReadinessGit(
    checkout.root,
    ['ls-tree', checkout.commit, '--', path],
  ).trim();
  const match = /^100(?:644|755) blob ([0-9a-f]{40})\t(.+)$/u.exec(treeEntry);
  if (match === null || match[2] !== path) {
    throw new Error(`${label} must be a committed tracked regular file`);
  }
  const committedBytes = runReadinessGit(
    checkout.root,
    ['cat-file', 'blob', match[1]],
    { encoding: 'buffer' },
  );
  if (committedBytes.byteLength > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`);
  }
  const workingPath = resolve(checkout.root, path);
  let stats;
  let workingBytes;
  try {
    stats = lstatSync(workingPath);
    workingBytes = readFileSync(workingPath);
  } catch (error) {
    throw new Error(`${label} must match its committed bytes`, {
      cause: error,
    });
  }
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.size !== committedBytes.byteLength
    || !workingBytes.equals(committedBytes)
  ) {
    throw new Error(`${label} must match its committed bytes`);
  }
  const status = runReadinessGit(
    checkout.root,
    [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      path,
    ],
  );
  if (status.length !== 0) {
    throw new Error(`${label} must match its committed bytes`);
  }
  return {
    path,
    blob: match[1],
    bytes: committedBytes,
    size: committedBytes.byteLength,
    sha256: createHash('sha256').update(committedBytes).digest('hex'),
  };
}

function verifyCommittedConformanceEvidence({
  checkout,
  aggregateRecord,
  indexRecord,
  caveAuthorityRoot,
}) {
  if (
    typeof caveAuthorityRoot !== 'string'
    || caveAuthorityRoot.length === 0
  ) {
    throw new Error(
      'OPENCOVEN_CAVE_AUTHORITY_ROOT must name the exact clean frozen Cave checkout',
    );
  }
  const output = execFileSync(
    process.execPath,
    [
      resolve(checkout.root, CONFORMANCE_VERIFIER_PATH),
      '--root',
      checkout.root,
      '--commit',
      checkout.commit,
      '--aggregate',
      aggregateRecord,
      '--index',
      indexRecord,
      '--cave-root',
      caveAuthorityRoot,
    ],
    {
      encoding: 'utf8',
      env: createReadinessGitEnvironment(),
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      killSignal: 'SIGKILL',
    },
  );
  const result = JSON.parse(output);
  if (
    !isRecord(result)
    || !isRecord(result.aggregate)
    || !isRecord(result.index)
  ) {
    throw new Error('Committed conformance evidence verifier returned invalid output');
  }
  return result;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactFields(value, expectedFields, context) {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }

  for (const field of expectedFields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${context} is missing required field ${field}`);
    }
  }

  for (const field of Object.keys(value)) {
    if (!expectedFields.includes(field)) {
      throw new Error(`${context} contains unknown field ${field}`);
    }
  }
}

function assertStrictSemVer(version) {
  if (typeof version !== 'string' || !STRICT_SEMVER.test(version)) {
    throw new Error(`Release version ${String(version)} must be strict SemVer`);
  }
}

function readManifest(root, packageMetadata) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, packageMetadata.manifestPath), 'utf8'),
  );

  if (!isRecord(manifest)) {
    throw new Error(`${packageMetadata.packageName} package.json must be an object`);
  }

  return manifest;
}

function validateConfigValues(config) {
  if (config.schemaVersion !== 2) {
    throw new Error('release.config.json schemaVersion must be 2');
  }
  if (typeof config.publishingEnabled !== 'boolean') {
    throw new Error('release.config.json publishingEnabled must be a boolean');
  }
  if (config.tagPrefix !== 'sdk-v') {
    throw new Error('release.config.json tagPrefix must be sdk-v');
  }
  if (config.npmAccess !== 'public') {
    throw new Error('release.config.json npmAccess must be public');
  }
  if (config.npmDistTag !== 'latest') {
    throw new Error('release.config.json npmDistTag must be latest');
  }
  if (config.githubEnvironment !== 'npm-release') {
    throw new Error('release.config.json githubEnvironment must be npm-release');
  }

  assertExactFields(
    config.supportedNode,
    ['minimum', 'major'],
    'release.config.json supportedNode',
  );
  if (
    config.supportedNode.minimum !== '24.18.0' ||
    config.supportedNode.major !== 24
  ) {
    throw new Error(
      'release.config.json supportedNode must specify minimum 24.18.0 and major 24',
    );
  }

  assertExactFields(
    config.conformanceEvidence,
    ['issue', 'candidateCommit', 'aggregateRecord'],
    'release.config.json conformanceEvidence',
  );
  if (
    config.conformanceEvidence.issue !== 'OpenCoven/sdk#38'
    || config.conformanceEvidence.candidateCommit
      !== 'acc38488f00860d246c3c553375634d64806eabb'
    || (
      config.conformanceEvidence.aggregateRecord !== null
      && typeof config.conformanceEvidence.aggregateRecord !== 'string'
    )
  ) {
    throw new Error(
      'release.config.json conformanceEvidence must bind SDK #38 to the frozen candidate',
    );
  }

  if (
    !Array.isArray(config.nativeConformancePlatforms) ||
    config.nativeConformancePlatforms.length !== SUPPORTED_PLATFORMS.length ||
    config.nativeConformancePlatforms.some(
      (platformId, index) => platformId !== SUPPORTED_PLATFORMS[index],
    )
  ) {
    throw new Error(
      'release.config.json nativeConformancePlatforms must match the canonical 0.1 native conformance matrix',
    );
  }

  const canonicalPackages = PUBLIC_PACKAGES.map(({ packageName }) => packageName);
  if (
    !Array.isArray(config.packages) ||
    config.packages.length !== canonicalPackages.length ||
    config.packages.some(
      (packageName, index) => packageName !== canonicalPackages[index],
    )
  ) {
    throw new Error(
      'release.config.json packages must match the canonical public package order',
    );
  }
}

function readWorkflowJob(workflow, jobName) {
  const lines = workflow.split('\n');
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/u.test(line));
  if (jobsIndex < 0) {
    throw new Error('Release workflow must define jobs');
  }
  const marker = `  ${jobName}:`;
  const jobIndex = lines.findIndex(
    (line, index) =>
      index > jobsIndex
      && line.replace(/\s+#.*$/u, '') === marker,
  );
  if (jobIndex < 0) {
    throw new Error(`Release workflow must define a ${jobName} job`);
  }
  let endIndex = lines.length;
  for (let index = jobIndex + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*(?:#.*)?$/u.test(lines[index])) {
      endIndex = index;
      break;
    }
  }
  return lines.slice(jobIndex + 1, endIndex);
}

function readWorkflowJobScalar(jobLines, key) {
  const pattern = new RegExp(
    `^ {4}${key}:\\s*([^#\\s][^#]*?)\\s*(?:#.*)?$`,
    'u',
  );
  const matches = jobLines
    .map((line) => pattern.exec(line)?.[1]?.trim())
    .filter((value) => value !== undefined);
  return matches.length === 1 ? matches[0] : null;
}

function readWorkflowJobMapping(jobLines, key) {
  const marker = `    ${key}:`;
  const mappingIndex = jobLines.findIndex(
    (line) => line.replace(/\s+#.*$/u, '') === marker,
  );
  if (mappingIndex < 0) return null;
  const mapping = {};
  for (let index = mappingIndex + 1; index < jobLines.length; index += 1) {
    const line = jobLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    if (/^ {0,4}\S/u.test(line)) break;
    const match =
      /^ {6}([A-Za-z0-9_-]+):\s*([^#\s][^#]*?)\s*(?:#.*)?$/u.exec(
        line,
      );
    if (match !== null) {
      mapping[match[1]] = match[2].trim();
    }
  }
  return mapping;
}

function validateReleaseWorkflow(root, config) {
  const workflowPath = resolve(root, RELEASE_WORKFLOW_PATH);
  if (!existsSync(workflowPath)) {
    throw new Error(`Required release workflow is missing: ${RELEASE_WORKFLOW_PATH}`);
  }

  // Normalised, because the marker below is anchored to newlines and a file
  // with CRLF endings would never match `publish:\n` -- the validator would
  // report a missing publish job on a workflow that has one.
  const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
  const publishJob = readWorkflowJob(workflow, 'publish');
  if (
    readWorkflowJobScalar(publishJob, 'environment')
      !== config.githubEnvironment
  ) {
    throw new Error(
      `Release workflow publish job must use environment ${config.githubEnvironment}`,
    );
  }
  if (readWorkflowJobScalar(publishJob, 'needs') !== 'preflight') {
    throw new Error(
      'Release workflow publish job must contain needs: preflight',
    );
  }
  const permissions = readWorkflowJobMapping(publishJob, 'permissions');
  for (const [permission, value] of [
    ['contents', 'read'],
    ['id-token', 'write'],
    ['attestations', 'write'],
  ]) {
    if (permissions?.[permission] !== value) {
      throw new Error(
        `Release workflow publish job must contain ${permission}: ${value}`,
      );
    }
  }
}

export function readReleaseConfig(root = process.cwd()) {
  const config = JSON.parse(readFileSync(resolve(root, 'release.config.json'), 'utf8'));
  assertExactFields(config, CONFIG_FIELDS, 'release.config.json');
  validateConfigValues(config);
  return config;
}

export function validateReleaseReadiness({
  root = process.cwd(),
  mode = 'verify',
  version,
  tag,
  requireTag = false,
  requireConformanceEvidence = false,
  caveAuthorityRoot = process.env.OPENCOVEN_CAVE_AUTHORITY_ROOT,
} = {}) {
  if (mode !== 'verify' && mode !== 'publish') {
    throw new Error(`Release mode must be verify or publish, received ${String(mode)}`);
  }
  if (typeof requireTag !== 'boolean') {
    throw new Error('requireTag must be a boolean');
  }
  if (typeof requireConformanceEvidence !== 'boolean') {
    throw new Error('requireConformanceEvidence must be a boolean');
  }
  if (version !== undefined) {
    assertStrictSemVer(version);
  }

  const config = readReleaseConfig(root);
  validateReleaseWorkflow(root, config);
  if (tag !== undefined) {
    if (typeof tag !== 'string' || tag.length === 0) {
      throw new Error('Release tag must be a non-empty string');
    }
    const comparedVersion = version ?? tag.slice(config.tagPrefix.length);
    if (tag !== `${config.tagPrefix}${comparedVersion}`) {
      throw new Error(`Release tag ${tag} does not match version ${comparedVersion}`);
    }
  } else if (requireTag) {
    throw new Error('Release tag is required');
  }

  if (requireTag) {
    let tagCommit;
    try {
      tagCommit = execFileSync(
        'git',
        ['-C', root, 'rev-parse', `refs/tags/${tag}^{commit}`],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
    } catch {
      throw new Error(`Release tag ${tag} is absent`);
    }
    const headCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (tagCommit !== headCommit) {
      throw new Error(`Release tag ${tag} does not point to HEAD`);
    }
  }

  const manifests = PUBLIC_PACKAGES.map((packageMetadata) => ({
    packageMetadata,
    manifest: readManifest(root, packageMetadata),
  }));
  const fixedVersion = manifests[0]?.manifest.version;
  assertStrictSemVer(fixedVersion);

  if (version !== undefined && version !== fixedVersion) {
    throw new Error(
      `Release version ${version} does not match package version ${fixedVersion}`,
    );
  }

  for (const { packageMetadata, manifest } of manifests) {
    const packageName = packageMetadata.packageName;
    if (manifest.name !== packageName) {
      throw new Error(`${packageMetadata.manifestPath} name must be ${packageName}`);
    }
    if (manifest.version !== fixedVersion) {
      throw new Error(`All release package versions must match ${fixedVersion}`);
    }
    if (manifest.engines?.node !== NODE_ENGINE) {
      throw new Error(`${packageName} engines.node must be ${NODE_ENGINE}`);
    }

    const changelog = readFileSync(
      resolve(root, 'packages', packageMetadata.workspaceDirectory, 'CHANGELOG.md'),
      'utf8',
    );
    if (!changelog.includes(`## ${fixedVersion}`)) {
      throw new Error(`${packageName} CHANGELOG.md must contain ## ${fixedVersion}`);
    }

    if (!config.publishingEnabled && manifest.private !== true) {
      throw new Error(
        `${packageName} must remain private while publishing is disabled`,
      );
    }
    if (config.publishingEnabled && manifest.private === true) {
      throw new Error(
        `${packageName} must be non-private while publishing is enabled`,
      );
    }

    for (const dependencyField of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      const dependencies = manifest[dependencyField];
      if (!isRecord(dependencies)) {
        continue;
      }

      for (const dependency of PUBLIC_PACKAGES) {
        if (
          Object.hasOwn(dependencies, dependency.packageName) &&
          dependencies[dependency.packageName] !== `workspace:${fixedVersion}`
        ) {
          throw new Error(
            `${packageName} dependency ${dependency.packageName} must be workspace:${fixedVersion}`,
          );
        }
      }
    }
  }

  const aggregateRecord = config.conformanceEvidence.aggregateRecord;
  let conformanceEvidenceRecord = null;
  if (aggregateRecord === null) {
    if (requireConformanceEvidence || mode === 'publish') {
      throw new Error(
        'release.config.json must name a passing SDK #38 aggregate record',
      );
    }
  } else if (requireConformanceEvidence || mode === 'publish') {
    const expectedRecord =
      `${CONFORMANCE_RESULTS_DIRECTORY}/${config.conformanceEvidence.candidateCommit}.json`;
    if (aggregateRecord !== expectedRecord) {
      throw new Error(
        `release.config.json conformanceEvidence.aggregateRecord must be ${expectedRecord}`,
      );
    }
    const evidenceIndexRecord = aggregateRecord.replace(/\.json$/u, '.index.json');
    const checkout = inspectReleaseRepository(root);
    readCommittedCleanFile(
      checkout,
      'release.config.json',
      'release.config.json',
    );
    const aggregateFile = readCommittedCleanFile(
      checkout,
      aggregateRecord,
      'release.config.json conformance evidence record',
    );
    readCommittedCleanFile(
      checkout,
      evidenceIndexRecord,
      'release.config.json conformance evidence index',
    );
    const frozenLockFile = readCommittedCleanFile(
      checkout,
      CONFORMANCE_LOCK_PATH,
      'Frozen conformance lock',
    );
    const assertionRegistryFile = readCommittedCleanFile(
      checkout,
      CONFORMANCE_REGISTRY_PATH,
      'Frozen assertion registry',
    );
    const schemaFile = readCommittedCleanFile(
      checkout,
      CONFORMANCE_SCHEMA_PATH,
      'Frozen evidence schema',
    );
    readCommittedCleanFile(
      checkout,
      CONFORMANCE_VERIFIER_PATH,
      'Committed conformance evidence verifier',
    );
    const frozenLock = parseFrozenConformanceLock(
      frozenLockFile.bytes.toString('utf8'),
      'committed frozen conformance lock',
    );
    const bindings = validateFrozenConformanceBindings(
      frozenLock,
      schemaFile.bytes.toString('utf8'),
      assertionRegistryFile.bytes.toString('utf8'),
    );
    assertEvidenceProducerCompatibility(bindings.lock);
    try {
      const aggregateEnvelope = JSON.parse(
        aggregateFile.bytes.toString('utf8'),
      );
      if (
        !isRecord(aggregateEnvelope)
        || !isRecord(aggregateEnvelope.validator)
        || typeof aggregateEnvelope.validator.commit !== 'string'
        || !/^[0-9a-f]{40}$/u.test(aggregateEnvelope.validator.commit)
      ) {
        throw new Error('aggregate validator commit is missing or invalid');
      }
      validateValidatorRuntimeFiles(
        checkout.root,
        aggregateEnvelope.validator.commit,
        checkout.commit,
      );
      const verified = verifyCommittedConformanceEvidence({
        checkout,
        aggregateRecord,
        indexRecord: evidenceIndexRecord,
        caveAuthorityRoot,
      });
      const aggregate = verified.aggregate;
      const validatorTree = runReadinessGit(
        checkout.root,
        ['rev-parse', `${aggregate.validator.commit}^{tree}`],
      ).trim();
      if (validatorTree !== aggregate.validator.tree) {
        throw new Error('aggregate validator tree does not match its commit');
      }
      const candidateTree = runReadinessGit(
        checkout.root,
        [
          'rev-parse',
          `${config.conformanceEvidence.candidateCommit}^{tree}`,
        ],
      ).trim();
      if (
        aggregate.candidate.provenance.commit
          !== config.conformanceEvidence.candidateCommit
        || aggregate.candidate.provenance.tree !== candidateTree
      ) {
        throw new Error(
          'aggregate candidate does not match the configured frozen candidate',
        );
      }
      runReadinessGit(
        checkout.root,
        [
          'merge-base',
          '--is-ancestor',
          config.conformanceEvidence.candidateCommit,
          aggregate.validator.commit,
        ],
        { stdio: 'ignore' },
      );
      runReadinessGit(
        checkout.root,
        [
          'merge-base',
          '--is-ancestor',
          aggregate.validator.commit,
          checkout.commit,
        ],
        { stdio: 'ignore' },
      );
      for (const metadata of [
        aggregate.validator.contract,
        aggregate.validator.schema,
      ]) {
        const bytes = readCommittedBlob(
          checkout.root,
          aggregate.validator.commit,
          metadata.path,
        );
        if (
          bytes.byteLength !== metadata.size
          || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256
        ) {
          throw new Error(
            `aggregate validator file ${metadata.path} does not match its committed bytes`,
          );
        }
      }
      for (const [path, currentFile] of [
        [CONFORMANCE_LOCK_PATH, frozenLockFile],
        [CONFORMANCE_REGISTRY_PATH, assertionRegistryFile],
        [CONFORMANCE_SCHEMA_PATH, schemaFile],
      ]) {
        const validatorBytes = readCommittedBlob(
          checkout.root,
          aggregate.validator.commit,
          path,
        );
        if (!validatorBytes.equals(currentFile.bytes)) {
          throw new Error(
            `aggregate validator file ${path} differs from the reviewed release contract`,
          );
        }
      }
      if (
        verified.index.aggregate.size !== aggregateFile.size
        || verified.index.aggregate.sha256 !== aggregateFile.sha256
      ) {
        throw new Error(
          'reviewed conformance evidence index does not bind the committed aggregate',
        );
      }
    } catch (error) {
      throw new Error(
        'release.config.json conformance evidence record is not a complete canonical aggregate',
        { cause: error },
      );
    }
    conformanceEvidenceRecord = aggregateRecord;
  }

  if (mode === 'publish' && !config.publishingEnabled) {
    throw new Error('Release publishing is disabled by release.config.json');
  }

  return {
    version: fixedVersion,
    publishingEnabled: config.publishingEnabled,
    packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    conformanceEvidenceRecord,
  };
}
