import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { resolve } from 'node:path';

import { PUBLIC_PACKAGES } from './repository-metadata.mjs';
import { parseAggregatedConformanceEvidence } from './conformance-contract.mjs';

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

function validateReleaseWorkflow(root, config) {
  const workflowPath = resolve(root, RELEASE_WORKFLOW_PATH);
  if (!existsSync(workflowPath)) {
    throw new Error(`Required release workflow is missing: ${RELEASE_WORKFLOW_PATH}`);
  }

  // Normalised, because the marker below is anchored to newlines and a file
  // with CRLF endings would never match `publish:\n` -- the validator would
  // report a missing publish job on a workflow that has one.
  const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
  const publishJobMarker = '\n  publish:\n';
  const publishJobIndex = workflow.indexOf(publishJobMarker);
  if (publishJobIndex < 0) {
    throw new Error('Release workflow must define a publish job');
  }

  // Only the publish job, not everything after it.
  //
  // Slicing to the end of the file let any later job satisfy these
  // requirements: a publish job with no `environment` and no permissions block
  // passed as long as some other job further down happened to contain those
  // strings. That is the deployment lock reporting itself as present while
  // being absent, which is the one failure this check exists to prevent.
  const publishJobBody = workflow.slice(publishJobIndex + publishJobMarker.length);
  const nextJobIndex = publishJobBody.search(/\n {2}\S/);
  const publishJob =
    nextJobIndex < 0 ? publishJobBody : publishJobBody.slice(0, nextJobIndex);
  if (!publishJob.includes(`environment: ${config.githubEnvironment}`)) {
    throw new Error(
      `Release workflow publish job must use environment ${config.githubEnvironment}`,
    );
  }
  for (const requirement of [
    'needs: preflight',
    'contents: read',
    'id-token: write',
    'attestations: write',
  ]) {
    if (!publishJob.includes(requirement)) {
      throw new Error(
        `Release workflow publish job must contain ${requirement}`,
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

  if (mode === 'publish' && !config.publishingEnabled) {
    throw new Error('Release publishing is disabled by release.config.json');
  }

  const aggregateRecord = config.conformanceEvidence.aggregateRecord;
  let conformanceEvidenceRecord = null;
  if (aggregateRecord === null) {
    if (requireConformanceEvidence || mode === 'publish') {
      throw new Error(
        'release.config.json must name a passing SDK #38 aggregate record',
      );
    }
  } else {
    const expectedRecord =
      `${CONFORMANCE_RESULTS_DIRECTORY}/${config.conformanceEvidence.candidateCommit}.json`;
    if (aggregateRecord !== expectedRecord) {
      throw new Error(
        `release.config.json conformanceEvidence.aggregateRecord must be ${expectedRecord}`,
      );
    }
    const recordPath = resolve(root, aggregateRecord);
    let stats;
    try {
      stats = lstatSync(recordPath);
    } catch (error) {
      throw new Error(
        'release.config.json conformance evidence record does not exist',
        { cause: error },
      );
    }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 1_048_576) {
      throw new Error(
        'release.config.json conformance evidence record must be a bounded regular file',
      );
    }
    try {
      const aggregateText = readFileSync(recordPath, 'utf8');
      const envelope = JSON.parse(aggregateText);
      if (
        !isRecord(envelope)
        || !isRecord(envelope.validator)
        || typeof envelope.validator.commit !== 'string'
        || !/^[0-9a-f]{40}$/.test(envelope.validator.commit)
      ) {
        throw new Error('aggregate validator commit is missing or invalid');
      }
      const validatorCommit = envelope.validator.commit;
      const frozenLockBytes = readCommittedBlob(
        root,
        validatorCommit,
        CONFORMANCE_LOCK_PATH,
      );
      const assertionRegistryBytes = readCommittedBlob(
        root,
        validatorCommit,
        CONFORMANCE_REGISTRY_PATH,
      );
      const schemaBytes = readCommittedBlob(
        root,
        validatorCommit,
        CONFORMANCE_SCHEMA_PATH,
      );
      const aggregate = parseAggregatedConformanceEvidence(
        aggregateText,
        'release conformance aggregate',
        {
          frozenLockText: frozenLockBytes.toString('utf8'),
          assertionRegistryText: assertionRegistryBytes.toString('utf8'),
          schema: JSON.parse(schemaBytes.toString('utf8')),
        },
      );
      const validatorTree = execFileSync(
        'git',
        [
          '-C',
          root,
          'rev-parse',
          `${aggregate.validator.commit}^{tree}`,
        ],
        {
          encoding: 'utf8',
          env: createReadinessGitEnvironment(),
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
      if (validatorTree !== aggregate.validator.tree) {
        throw new Error('aggregate validator tree does not match its commit');
      }
      const candidateTree = execFileSync(
        'git',
        [
          '-C',
          root,
          'rev-parse',
          `${config.conformanceEvidence.candidateCommit}^{tree}`,
        ],
        {
          encoding: 'utf8',
          env: createReadinessGitEnvironment(),
          stdio: ['ignore', 'pipe', 'ignore'],
        },
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
      execFileSync(
        'git',
        [
          '-C',
          root,
          'merge-base',
          '--is-ancestor',
          config.conformanceEvidence.candidateCommit,
          aggregate.validator.commit,
        ],
        {
          env: createReadinessGitEnvironment(),
          stdio: 'ignore',
        },
      );
      execFileSync(
        'git',
        [
          '-C',
          root,
          'merge-base',
          '--is-ancestor',
          aggregate.validator.commit,
          'HEAD',
        ],
        {
          env: createReadinessGitEnvironment(),
          stdio: 'ignore',
        },
      );
      for (const metadata of [
        aggregate.validator.contract,
        aggregate.validator.schema,
      ]) {
        const bytes = readCommittedBlob(
          root,
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
    } catch (error) {
      throw new Error(
        'release.config.json conformance evidence record is not a complete canonical aggregate',
        { cause: error },
      );
    }
    conformanceEvidenceRecord = aggregateRecord;
  }

  return {
    version: fixedVersion,
    publishingEnabled: config.publishingEnabled,
    packages: PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    conformanceEvidenceRecord,
  };
}
