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
import {
  AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256,
  AUTHENTICATED_NPM_CLI_TREE_SHA256,
  AUTHENTICATED_NPM_TARBALL_INTEGRITY,
  AUTHENTICATED_NPM_TARBALL_URL,
  createGitHubTokenFreeEnvironment,
} from './release-runtime-integrity.mjs';
import {
  verifyLiveReleaseEnvironmentPolicies,
} from './github-environment-policy.mjs';

const CONFIG_FIELDS = Object.freeze([
  'schemaVersion',
  'publishingEnabled',
  'tagPrefix',
  'npmAccess',
  'npmDistTag',
  'npmCliVersion',
  'npmRegistry',
  'npmCliDistribution',
  'githubEnvironment',
  'npmTrustedPublisher',
  'supportedNode',
  'nativeConformancePlatforms',
  'conformanceEvidence',
  'publicationCandidate',
  'protectedApproval',
  'packages',
]);
const NODE_ENGINE = '>=24.18.0 <25';
const FROZEN_NODE_VERSION = 'v24.18.1';
const NODE_VERSION_PATH = '.node-version';
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const ATTEST_ACTION =
  'actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d';
const DOWNLOAD_ARTIFACT_ACTION =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
const PUBLICATION_ARTIFACT_NAME =
  'opencoven-sdk-publication-${{ github.sha }}-${{ inputs.version }}';
const PUBLICATION_ATTESTATION_ARTIFACT_NAME =
  'opencoven-sdk-publication-attestation-${{ github.sha }}-${{ inputs.version }}';
const UPLOAD_ARTIFACT_ACTION =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const PREFLIGHT_JOB_SHA256 =
  '07281236fd24c6ff0c4a1755798798f37ccd38e2e72712e121a1199de6f2a9b4';
const REPOSITORY_VERIFICATION_JOB_SHA256 =
  'e9a1e8dbfb25f4a4ecd3a8bcdbbdf081da958c1df411aeb27abd4a344d695398';
const PUBLICATION_CANDIDATE_JOB_SHA256 =
  'f87f40a0b7e5b9d57d59c7dc9b87d2647443ceb5e066a900feba7f98fcbdddb1';
const PUBLICATION_CANDIDATE_ATTESTATION_JOB_SHA256 =
  'c71d5252333f4641ab2407ab5e872adf61f74d8ee02dad1c8d51fea99c158d41';
const APPROVAL_WITNESS_JOB_SHA256 =
  'baf9668fa031de06a7c8afda619759af4183120282a98be666b235057dd847fa';
const APPROVAL_WITNESS_ATTESTATION_JOB_SHA256 =
  'edc0d5c8f815b749fad361deda8fbe52943f53665f98c4fce18a4fe55475772d';
const APPROVAL_EVIDENCE_JOB_SHA256 =
  '6b29bd05f534ef08ed8c9b8490e893bb87a0447bbff948f9c3513a5397724940';
const APPROVAL_EVIDENCE_ATTESTATION_JOB_SHA256 =
  '35a45193f8540e64648b9332a26f6247aedabfcace9f34af51cce79c5f07ec5e';
const PUBLISH_JOB_SHA256 =
  'ff5743fef786dc09498fb5b40ec3aabcf76eea801180aedbb9b0c4780d7776fd';
const EXPECTED_RELEASE_CONTROLS = Object.freeze({
  name: 'release',
  on: {
    workflow_dispatch: {
      inputs: {
        mode: {
          description:
            'Create reviewable candidate bytes or publish reviewed bytes',
          required: true,
          type: 'choice',
          options: ['verify', 'publish'],
        },
        version: {
          description: 'Exact fixed SDK version',
          required: true,
          type: 'string',
        },
        'security-review-comment-id': {
          description: 'Immutable',
          required: false,
          type: 'string',
        },
      },
    },
  },
  permissions: {
    contents: 'read',
  },
  concurrency: {
    group: 'release-${{ inputs.version }}',
    'cancel-in-progress': false,
  },
});
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
  NODE_VERSION_PATH,
  '.npmrc',
  '.github/workflows/release.yml',
  'conformance/release-artifact-manifest.schema.json',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/aggregate-client-v1-conformance.mjs',
  'scripts/conformance-contract.mjs',
  'scripts/create-release-artifacts.mjs',
  'scripts/github-conformance-evidence.mjs',
  'scripts/github-environment-policy.mjs',
  'scripts/github-environment-approval-evidence.mjs',
  'scripts/github-environment-approval.mjs',
  'scripts/github-release-authorization.mjs',
  'scripts/owned-temp-directory.mjs',
  'scripts/package-artifacts.mjs',
  'scripts/publication-source-identity.mjs',
  'scripts/publish-release-artifacts.mjs',
  'scripts/release-readiness.mjs',
  'scripts/release-runtime-integrity.mjs',
  'scripts/repository-metadata.mjs',
  CONFORMANCE_VERIFIER_PATH,
  'scripts/verify-github-environment-policies.mjs',
  'scripts/verify-release-readiness.mjs',
]);
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function createReadinessGitEnvironment(source = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(
    createGitHubTokenFreeEnvironment(source),
  )) {
    const normalizedKey = key.toUpperCase();
    if (
      !normalizedKey.startsWith('GIT_')
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

export function assertFrozenNodeRuntime(
  root = process.cwd(),
  actualVersion = process.version,
) {
  const versionBytes = readFileSync(resolve(root, NODE_VERSION_PATH), 'utf8');
  if (versionBytes !== `${FROZEN_NODE_VERSION.slice(1)}\n`) {
    throw new Error(
      `${NODE_VERSION_PATH} must contain ${FROZEN_NODE_VERSION.slice(1)} with one trailing newline`,
    );
  }
  if (actualVersion !== FROZEN_NODE_VERSION) {
    throw new Error(
      `Release and conformance verification require Node ${FROZEN_NODE_VERSION}, received ${actualVersion}`,
    );
  }
  return FROZEN_NODE_VERSION;
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

export function inspectReleaseRepository(root) {
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

export function inspectAnnotatedReleaseTag(root, tag) {
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('Release tag must be a non-empty string');
  }
  const reference = `refs/tags/${tag}`;
  let objectId;
  try {
    objectId = runReadinessGit(
      root,
      ['rev-parse', '--verify', `${reference}^{tag}`],
    ).trim();
  } catch {
    try {
      runReadinessGit(root, ['rev-parse', '--verify', reference]);
    } catch {
      throw new Error(`Release tag ${tag} is absent`);
    }
    throw new Error(`Release tag ${tag} must be an annotated tag object`);
  }
  return {
    name: tag,
    ref: reference,
    objectId,
    commit: runReadinessGit(
      root,
      ['rev-parse', '--verify', `${reference}^{commit}`],
    ).trim(),
    tree: runReadinessGit(
      root,
      ['rev-parse', '--verify', `${reference}^{tree}`],
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
  env,
}) {
  if (
    typeof caveAuthorityRoot !== 'string'
    || caveAuthorityRoot.length === 0
  ) {
    throw new Error(
      'OPENCOVEN_CAVE_AUTHORITY_ROOT must name the exact clean frozen Cave checkout',
    );
  }
  const verifierEnvironment = createReadinessGitEnvironment(env);
  if (typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0) {
    verifierEnvironment.GH_TOKEN = env.GH_TOKEN;
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
      env: verifierEnvironment,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
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
  if (config.schemaVersion !== 7) {
    throw new Error('release.config.json schemaVersion must be 7');
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
  if (config.npmCliVersion !== '11.5.1') {
    throw new Error('release.config.json npmCliVersion must be 11.5.1');
  }
  if (config.npmRegistry !== 'https://registry.npmjs.org/') {
    throw new Error(
      'release.config.json npmRegistry must be https://registry.npmjs.org/',
    );
  }
  assertExactFields(
    config.npmCliDistribution,
    ['tarball', 'integrity', 'treeSha256', 'entrypointSha256'],
    'release.config.json npmCliDistribution',
  );
  if (
    config.npmCliDistribution.tarball !== AUTHENTICATED_NPM_TARBALL_URL
    || config.npmCliDistribution.integrity
      !== AUTHENTICATED_NPM_TARBALL_INTEGRITY
    || config.npmCliDistribution.treeSha256
      !== AUTHENTICATED_NPM_CLI_TREE_SHA256
    || config.npmCliDistribution.entrypointSha256
      !== AUTHENTICATED_NPM_CLI_ENTRYPOINT_SHA256
  ) {
    throw new Error(
      'release.config.json npmCliDistribution must bind the authenticated npm 11.5.1 distribution',
    );
  }
  if (config.githubEnvironment !== 'npm-release') {
    throw new Error('release.config.json githubEnvironment must be npm-release');
  }
  assertExactFields(
    config.npmTrustedPublisher,
    ['repository', 'workflow', 'environment', 'job'],
    'release.config.json npmTrustedPublisher',
  );
  if (
    config.npmTrustedPublisher.repository !== 'OpenCoven/sdk'
    || config.npmTrustedPublisher.workflow !== 'release.yml'
    || config.npmTrustedPublisher.environment !== 'npm-publish'
    || config.npmTrustedPublisher.job !== 'publish'
  ) {
    throw new Error(
      'release.config.json npmTrustedPublisher must bind the exact final publish workflow environment and job',
    );
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
    [
      'issue',
      'artifactSet',
      'candidateCommit',
      'runtimeManifestSha256',
      'aggregateRecord',
    ],
    'release.config.json conformanceEvidence',
  );
  if (
    config.conformanceEvidence.issue !== 'OpenCoven/sdk#38'
    || config.conformanceEvidence.artifactSet !== 'conformance-candidate'
    || config.conformanceEvidence.candidateCommit
      !== 'acc38488f00860d246c3c553375634d64806eabb'
    || config.conformanceEvidence.runtimeManifestSha256
      !== '1cf387f4f53f456c87a51ab09ab68f7ff7291480f9a7cd3a4fe3bb70f907e56a'
    || (
      config.conformanceEvidence.aggregateRecord !== null
      && typeof config.conformanceEvidence.aggregateRecord !== 'string'
    )
  ) {
    throw new Error(
      'release.config.json conformanceEvidence must bind SDK #38 to the frozen candidate',
    );
  }

  assertExactFields(
    config.protectedApproval,
    [
      'environment',
      'environmentId',
      'witnessJob',
      'witnessAttestationJob',
      'approvalJob',
      'approvalAttestationJob',
      'publishJob',
      'reviewer',
    ],
    'release.config.json protectedApproval',
  );
  assertExactFields(
    config.protectedApproval.reviewer,
    ['id', 'authorAssociation', 'permission', 'roleName'],
    'release.config.json protectedApproval.reviewer',
  );
  if (
    config.protectedApproval.environment !== config.githubEnvironment
    || config.protectedApproval.environmentId !== '20778492972'
    || config.protectedApproval.witnessJob !== 'approval-witness'
    || config.protectedApproval.witnessAttestationJob
      !== 'approval-witness-attestation'
    || config.protectedApproval.approvalJob !== 'approval-evidence'
    || config.protectedApproval.approvalAttestationJob
      !== 'approval-evidence-attestation'
    || config.protectedApproval.publishJob !== 'publish'
    || config.protectedApproval.reviewer.id !== 68980965
    || config.protectedApproval.reviewer.authorAssociation !== 'MEMBER'
    || config.protectedApproval.reviewer.permission !== 'admin'
    || config.protectedApproval.reviewer.roleName !== 'admin'
  ) {
    throw new Error(
      'release.config.json protectedApproval must bind the exact protected environment and immutable reviewer identity',
    );
  }

  assertExactFields(
    config.publicationCandidate,
    [
      'artifactSet',
      'environment',
      'securityReviewIssue',
      'workflow',
      'job',
      'attestationJob',
    ],
    'release.config.json publicationCandidate',
  );
  if (
    config.publicationCandidate.artifactSet !== 'publication-candidate'
    || config.publicationCandidate.environment !== 'publication-candidate'
    || config.publicationCandidate.securityReviewIssue !== 'OpenCoven/sdk#40'
    || config.publicationCandidate.workflow !== RELEASE_WORKFLOW_PATH
    || config.publicationCandidate.job !== 'publication-candidate'
    || config.publicationCandidate.attestationJob
      !== 'publication-candidate-attestation'
  ) {
    throw new Error(
      'release.config.json publicationCandidate must identify the dedicated #40-reviewed candidate job',
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

function readWorkflowStep(jobLines, stepName) {
  const marker = `      - name: ${stepName}`;
  const stepIndex = jobLines.findIndex(
    (line) => line.replace(/\s+#.*$/u, '') === marker,
  );
  if (stepIndex < 0) {
    throw new Error(`Release workflow must define step ${stepName}`);
  }
  let endIndex = jobLines.length;
  for (let index = stepIndex + 1; index < jobLines.length; index += 1) {
    if (/^ {6}-\s/u.test(jobLines[index])) {
      endIndex = index;
      break;
    }
  }
  return jobLines.slice(stepIndex + 1, endIndex);
}

function readWorkflowStepMapping(stepLines, key) {
  const marker = `        ${key}:`;
  const mappingIndex = stepLines.findIndex(
    (line) => line.replace(/\s+#.*$/u, '') === marker,
  );
  if (mappingIndex < 0) return null;
  const mapping = {};
  for (let index = mappingIndex + 1; index < stepLines.length; index += 1) {
    const line = stepLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    if (/^ {0,8}\S/u.test(line)) break;
    const match =
      /^ {10}([A-Za-z0-9_-]+):\s*([^#\s][^#]*?)\s*(?:#.*)?$/u.exec(
        line,
      );
    if (match !== null) {
      mapping[match[1]] = match[2].trim();
    }
  }
  return mapping;
}

function workflowYamlError(message, lineIndex) {
  return new Error(
    `Release workflow must be valid unambiguous YAML: ${message} on line ${lineIndex + 1}`,
  );
}

function workflowYamlIndirectionError() {
  return new Error(
    'Release workflow must not use YAML anchors, aliases, or merge keys',
  );
}

function workflowIndent(line, lineIndex) {
  const indentation = /^ */u.exec(line)?.[0].length ?? 0;
  if (line.slice(0, indentation + 1).includes('\t')) {
    throw workflowYamlError('tab indentation is forbidden', lineIndex);
  }
  return indentation;
}

function stripWorkflowYamlComment(value) {
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (doubleQuoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (singleQuoted) {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      continue;
    }
    if (
      character === '#'
      && (index === 0 || /\s/u.test(value[index - 1]))
    ) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function workflowLine(lines, index) {
  const raw = lines[index];
  const indent = workflowIndent(raw, index);
  return {
    indent,
    content: stripWorkflowYamlComment(raw.slice(indent)),
  };
}

function nextWorkflowYamlContent(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = workflowLine(lines, index);
    if (line.content.trim().length > 0) {
      return { ...line, index };
    }
  }
  return null;
}

function assertNoWorkflowYamlIndirection(value) {
  if (
    /(?:^|\s)[&*][A-Za-z0-9_-]+(?=\s|$|[\],])/u.test(value)
    || /^<<\s*:/u.test(value)
  ) {
    throw workflowYamlIndirectionError();
  }
}

function splitWorkflowFlowSequence(value, lineIndex) {
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) return [];
  const entries = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (doubleQuoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (singleQuoted) {
      if (character === "'" && inner[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
    } else if (character === "'") {
      singleQuoted = true;
    } else if (character === ',') {
      entries.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (singleQuoted || doubleQuoted) {
    throw workflowYamlError('unterminated flow sequence string', lineIndex);
  }
  entries.push(inner.slice(start).trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw workflowYamlError('empty flow sequence entry', lineIndex);
  }
  return entries;
}

function parseWorkflowYamlScalar(value, lineIndex) {
  const scalar = value.trim();
  if (scalar.length === 0) {
    throw workflowYamlError('empty scalar', lineIndex);
  }
  if (scalar.startsWith('"')) {
    if (!scalar.endsWith('"')) {
      throw workflowYamlError('unterminated double-quoted scalar', lineIndex);
    }
    try {
      return JSON.parse(scalar);
    } catch (error) {
      throw workflowYamlError(
        `invalid double-quoted scalar: ${String(error)}`,
        lineIndex,
      );
    }
  }
  if (scalar.startsWith("'")) {
    if (!scalar.endsWith("'")) {
      throw workflowYamlError('unterminated single-quoted scalar', lineIndex);
    }
    return scalar.slice(1, -1).replaceAll("''", "'");
  }
  assertNoWorkflowYamlIndirection(scalar);
  if (scalar === '{}') return {};
  if (scalar.startsWith('!') || scalar.startsWith('{')) {
    throw workflowYamlError('unsupported YAML scalar syntax', lineIndex);
  }
  if (scalar.startsWith('[')) {
    if (!scalar.endsWith(']')) {
      throw workflowYamlError('unterminated flow sequence', lineIndex);
    }
    return splitWorkflowFlowSequence(scalar, lineIndex).map((entry) =>
      parseWorkflowYamlScalar(entry, lineIndex),
    );
  }
  if (scalar === 'true') return true;
  if (scalar === 'false') return false;
  if (scalar === 'null' || scalar === '~') return null;
  if (/^-?(?:0|[1-9]\d*)$/u.test(scalar)) {
    const number = Number(scalar);
    if (!Number.isSafeInteger(number)) {
      throw workflowYamlError('integer is outside the safe range', lineIndex);
    }
    return number;
  }
  return scalar;
}

function foldWorkflowYamlLines(lines) {
  let value = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    value += line;
    if (index === lines.length - 1) continue;
    const next = lines[index + 1];
    value += (
      line.length === 0
      || next.length === 0
      || line.startsWith(' ')
      || next.startsWith(' ')
    )
      ? '\n'
      : ' ';
  }
  return value;
}

function parseWorkflowYamlBlock(lines, startIndex, parentIndent, indicator) {
  const contentLines = [];
  let contentIndent;
  let index = startIndex;
  for (; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().length === 0) {
      contentLines.push('');
      continue;
    }
    const indent = workflowIndent(raw, index);
    if (indent <= parentIndent) break;
    contentIndent ??= indent;
    if (indent < contentIndent) {
      throw workflowYamlError('invalid block scalar indentation', index);
    }
    contentLines.push(raw.slice(contentIndent));
  }
  let value = indicator.startsWith('>')
    ? foldWorkflowYamlLines(contentLines)
    : contentLines.join('\n');
  if (indicator.endsWith('-')) {
    value = value.replace(/\n+$/u, '');
  } else if (!indicator.endsWith('+')) {
    value = `${value.replace(/\n+$/u, '')}\n`;
  }
  return { value, nextIndex: index };
}

function parseWorkflowYamlPair(lines, lineIndex, keyIndent, pairText) {
  if (/^<<\s*:/u.test(pairText)) {
    throw workflowYamlIndirectionError();
  }
  const match = /^([A-Za-z0-9_-]+):(.*)$/u.exec(pairText);
  if (match === null) {
    throw workflowYamlError('expected a simple mapping entry', lineIndex);
  }
  const [, key, rawValue] = match;
  const value = rawValue.trim();
  if (/^[|>][+-]?$/u.test(value)) {
    const block = parseWorkflowYamlBlock(
      lines,
      lineIndex + 1,
      keyIndent,
      value,
    );
    return { key, value: block.value, nextIndex: block.nextIndex };
  }
  if (value.length > 0) {
    return {
      key,
      value: parseWorkflowYamlScalar(value, lineIndex),
      nextIndex: lineIndex + 1,
    };
  }
  const child = nextWorkflowYamlContent(lines, lineIndex + 1);
  if (child === null || child.indent <= keyIndent) {
    return { key, value: null, nextIndex: lineIndex + 1 };
  }
  if (child.indent !== keyIndent + 2) {
    throw workflowYamlError('invalid nested indentation', child.index);
  }
  const parsed = child.content.startsWith('- ')
    ? parseWorkflowYamlSequence(lines, lineIndex + 1, child.indent)
    : parseWorkflowYamlMapping(lines, lineIndex + 1, child.indent);
  return { key, value: parsed.value, nextIndex: parsed.nextIndex };
}

function parseWorkflowYamlMapping(lines, startIndex, indent) {
  const value = Object.create(null);
  let index = startIndex;
  for (; index < lines.length;) {
    const line = workflowLine(lines, index);
    if (line.content.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.indent < indent) break;
    if (line.indent !== indent || line.content.startsWith('- ')) {
      throw workflowYamlError('invalid mapping indentation', index);
    }
    const pair = parseWorkflowYamlPair(
      lines,
      index,
      indent,
      line.content,
    );
    if (Object.hasOwn(value, pair.key)) {
      throw workflowYamlError(`duplicate key ${pair.key}`, index);
    }
    value[pair.key] = pair.value;
    index = pair.nextIndex;
  }
  return { value, nextIndex: index };
}

function parseWorkflowYamlSequence(lines, startIndex, indent) {
  const value = [];
  let index = startIndex;
  for (; index < lines.length;) {
    const line = workflowLine(lines, index);
    if (line.content.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.content.startsWith('- ')) {
      throw workflowYamlError('invalid sequence indentation', index);
    }
    const itemText = line.content.slice(2).trimStart();
    if (itemText.length === 0) {
      const child = nextWorkflowYamlContent(lines, index + 1);
      if (child === null || child.indent !== indent + 2) {
        throw workflowYamlError('sequence item requires a value', index);
      }
      const parsed = child.content.startsWith('- ')
        ? parseWorkflowYamlSequence(lines, index + 1, child.indent)
        : parseWorkflowYamlMapping(lines, index + 1, child.indent);
      value.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    if (/^[A-Za-z0-9_-]+:/u.test(itemText) || /^<<\s*:/u.test(itemText)) {
      const firstPair = parseWorkflowYamlPair(
        lines,
        index,
        indent + 2,
        itemText,
      );
      const item = Object.create(null);
      item[firstPair.key] = firstPair.value;
      const continuation = parseWorkflowYamlMapping(
        lines,
        firstPair.nextIndex,
        indent + 2,
      );
      for (const [key, entry] of Object.entries(continuation.value)) {
        if (Object.hasOwn(item, key)) {
          throw workflowYamlError(`duplicate key ${key}`, index);
        }
        item[key] = entry;
      }
      value.push(item);
      index = continuation.nextIndex;
      continue;
    }
    value.push(parseWorkflowYamlScalar(itemText, index));
    index += 1;
  }
  return { value, nextIndex: index };
}

export function parseReleaseWorkflowDocument(workflow) {
  const lines = workflow.split('\n');
  const parsed = parseWorkflowYamlMapping(lines, 0, 0);
  const remaining = nextWorkflowYamlContent(lines, parsed.nextIndex);
  if (remaining !== null) {
    throw workflowYamlError('unexpected trailing content', remaining.index);
  }
  if (!isRecord(parsed.value) || !isRecord(parsed.value.jobs)) {
    throw new Error('Release workflow must define a jobs mapping');
  }
  return parsed.value;
}

function readStructuredWorkflowJob(workflow, jobName) {
  const job = workflow.jobs[jobName];
  if (!isRecord(job)) {
    throw new Error(`Release workflow must define a ${jobName} job`);
  }
  return job;
}

function readStructuredWorkflowSteps(job, jobName) {
  if (
    !Array.isArray(job.steps)
    || job.steps.some((step) => !isRecord(step))
  ) {
    throw new Error(`Release workflow ${jobName} job must define explicit steps`);
  }
  return job.steps;
}

function countStringOccurrences(value, expected) {
  if (typeof value === 'string') {
    return value.split(expected).length - 1;
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (count, entry) => count + countStringOccurrences(entry, expected),
      0,
    );
  }
  if (isRecord(value)) {
    return Object.values(value).reduce(
      (count, entry) => count + countStringOccurrences(entry, expected),
      0,
    );
  }
  return 0;
}

function structuredWorkflowDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function validateWorkflowActionIndirection(workflow) {
  for (const job of Object.values(workflow.jobs)) {
    if (!isRecord(job)) continue;
    if (Object.hasOwn(job, 'uses')) {
      throw new Error(
        'Release workflow must use the exact frozen release job and step graph',
      );
    }
    if (!Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (!isRecord(step)) continue;
      if (
        Object.hasOwn(step, 'uses')
        && (
          typeof step.uses !== 'string'
          || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u.test(
            step.uses,
          )
        )
      ) {
        throw new Error(
          'Release workflow must use the exact frozen release job and step graph',
        );
      }
      if (
        typeof step.run === 'string'
        && /\b(?:curl|gh)\b[\s\S]*\bactions\/(?:artifacts|runs\/[^\s"'`]+\/artifacts)\b/iu
          .test(step.run)
      ) {
        throw new Error(
          'Release workflow must use the exact frozen release job and step graph',
        );
      }
    }
  }
}

function validateIsolatedAttestationJob(job, jobName, expectedActions) {
  const permissions = isRecord(job.permissions) ? job.permissions : null;
  if (
    permissions === null
    || JSON.stringify(permissions) !== JSON.stringify({
      actions: 'read',
      attestations: 'write',
      contents: 'read',
      'id-token': 'write',
    })
    || Object.hasOwn(job, 'environment')
    || Object.hasOwn(job, 'uses')
    || Object.hasOwn(job, 'container')
    || Object.hasOwn(job, 'services')
    || Object.hasOwn(job, 'defaults')
    || Object.hasOwn(job, 'env')
  ) {
    throw new Error(
      `Release workflow ${jobName} must be a checkout-free isolated OIDC attestation job`,
    );
  }
  const steps = readStructuredWorkflowSteps(job, jobName);
  if (
    steps.length !== expectedActions.length
    || steps.some(
      (step, index) =>
        Object.hasOwn(step, 'run')
        || Object.hasOwn(step, 'shell')
        || Object.hasOwn(step, 'env')
        || step.uses !== expectedActions[index],
    )
  ) {
    throw new Error(
      `Release workflow ${jobName} must use only the exact pinned official artifact and attestation actions`,
    );
  }
}

export function validateReleaseWorkflow(root, config) {
  const workflowPath = resolve(root, RELEASE_WORKFLOW_PATH);
  if (!existsSync(workflowPath)) {
    throw new Error(`Required release workflow is missing: ${RELEASE_WORKFLOW_PATH}`);
  }

  // Normalised, because the marker below is anchored to newlines and a file
  // with CRLF endings would never match `publish:\n` -- the validator would
  // report a missing publish job on a workflow that has one.
  const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
  if (/[\r\u0085\u2028\u2029]/u.test(workflow)) {
    throw new Error(
      'Release workflow must use LF or CRLF line endings only',
    );
  }
  if (/[^\n\x20-\x7e]/u.test(workflow)) {
    throw new Error('Release workflow must contain ASCII text only');
  }
  const structuredWorkflow = parseReleaseWorkflowDocument(workflow);
  const workflowControls = { ...structuredWorkflow };
  delete workflowControls.jobs;
  if (
    JSON.stringify(workflowControls)
      !== JSON.stringify(EXPECTED_RELEASE_CONTROLS)
  ) {
    throw new Error(
      'Release workflow must use only the exact reviewed dispatch controls',
    );
  }
  const preflightJob = readWorkflowJob(workflow, 'preflight');
  const structuredPreflightJob = readStructuredWorkflowJob(
    structuredWorkflow,
    'preflight',
  );
  const preflightPermissions = readWorkflowJobMapping(
    preflightJob,
    'permissions',
  );
  for (const [permission, value] of [
    ['actions', 'read'],
    ['attestations', 'read'],
    ['contents', 'read'],
    ['deployments', 'read'],
    ['issues', 'read'],
  ]) {
    if (preflightPermissions?.[permission] !== value) {
      throw new Error(
        `Release workflow preflight job must contain ${permission}: ${value}`,
      );
    }
  }
  if (Object.keys(preflightPermissions ?? {}).length !== 5) {
    throw new Error(
      'Release workflow preflight job must use only reviewed read permissions',
    );
  }
  for (const stepName of [
    'Verify authoritative conformance evidence',
    'Verify publish gates and release tag',
  ]) {
    const environment = readWorkflowStepMapping(
      readWorkflowStep(preflightJob, stepName),
      'env',
    );
    if (environment?.GH_TOKEN !== '${{ github.token }}') {
      throw new Error(
        `Release workflow step ${stepName} must use the standard GitHub workflow token`,
      );
    }
  }
  const repositoryVerificationJob = readWorkflowJob(
    workflow,
    'repository-verification',
  );
  const structuredRepositoryVerificationJob = readStructuredWorkflowJob(
    structuredWorkflow,
    'repository-verification',
  );
  const repositoryPermissions = readWorkflowJobMapping(
    repositoryVerificationJob,
    'permissions',
  );
  if (
    Object.keys(repositoryPermissions ?? {}).length !== 1
    || repositoryPermissions?.contents !== 'read'
  ) {
    throw new Error(
      'Release workflow repository-verification job must use only contents: read',
    );
  }
  const installEnvironment = readWorkflowStepMapping(
    readWorkflowStep(repositoryVerificationJob, 'Install dependencies'),
    'env',
  );
  if (installEnvironment?.GH_TOKEN !== undefined) {
    throw new Error(
      'Release workflow dependency installation must not receive GH_TOKEN',
    );
  }
  const verificationEnvironment = readWorkflowStepMapping(
    readWorkflowStep(repositoryVerificationJob, 'Verify repository'),
    'env',
  );
  if (verificationEnvironment?.GH_TOKEN !== undefined) {
    throw new Error(
      'Release workflow repository verification must not receive GH_TOKEN',
    );
  }
  const candidateJob = readWorkflowJob(workflow, 'publication-candidate');
  const structuredCandidateJob = readStructuredWorkflowJob(
    structuredWorkflow,
    'publication-candidate',
  );
  const structuredCandidateSteps = readStructuredWorkflowSteps(
    structuredCandidateJob,
    'publication-candidate',
  );
  const candidateCreationSteps = structuredCandidateSteps.filter(
    (step) => step.name === 'Create immutable publication candidate',
  );
  if (
    candidateCreationSteps.length !== 1
    || Object.hasOwn(candidateCreationSteps[0], 'if')
  ) {
    throw new Error(
      'Release workflow candidate creation must be active and unconditional',
    );
  }
  const candidateUploadSteps = structuredCandidateSteps.filter(
    (step) => step.uses === UPLOAD_ARTIFACT_ACTION,
  );
  if (
    candidateUploadSteps.length !== 1
    || Object.hasOwn(candidateUploadSteps[0], 'if')
  ) {
    throw new Error(
      'Release workflow candidate upload must be active and unconditional',
    );
  }
  const candidateCreationIndex = structuredCandidateSteps.indexOf(
    candidateCreationSteps[0],
  );
  const candidateUploadIndex = structuredCandidateSteps.indexOf(
    candidateUploadSteps[0],
  );
  if (candidateCreationIndex >= candidateUploadIndex) {
    throw new Error(
      'Release workflow candidate steps must use the exact reviewed order',
    );
  }
  if (
    readWorkflowJobScalar(candidateJob, 'if') !== "inputs.mode == 'verify'"
    || readWorkflowJobScalar(candidateJob, 'needs')
      !== '[preflight, repository-verification]'
    || readWorkflowJobScalar(candidateJob, 'environment')
      !== config.publicationCandidate.environment
    || readWorkflowJobScalar(candidateJob, 'name')
      !== config.publicationCandidate.job
  ) {
    throw new Error(
      'Release workflow publication-candidate job must be verify-only and require both verification jobs',
    );
  }
  const candidatePermissions = readWorkflowJobMapping(
    candidateJob,
    'permissions',
  );
  for (const [permission, value] of [
    ['actions', 'read'],
    ['attestations', 'read'],
    ['contents', 'read'],
    ['deployments', 'read'],
    ['issues', 'read'],
  ]) {
    if (candidatePermissions?.[permission] !== value) {
      throw new Error(
        `Release workflow publication-candidate job must contain ${permission}: ${value}`,
      );
    }
  }
  if (Object.keys(candidatePermissions ?? {}).length !== 5) {
    throw new Error(
      'Release workflow publication-candidate job must not receive unreviewed permissions',
    );
  }
  if (
    JSON.stringify(structuredCandidateJob.outputs) !== JSON.stringify({
      'artifact-id': '${{ steps.upload.outputs.artifact-id }}',
      'artifact-digest': '${{ steps.upload.outputs.artifact-digest }}',
    })
    || JSON.stringify(structuredCandidateJob)
      .includes('ACTIONS_ID_TOKEN_REQUEST_')
  ) {
    throw new Error(
      'Release workflow publication-candidate job must expose only immutable artifact outputs and no OIDC capability',
    );
  }
  const candidateEnvironment = readWorkflowStepMapping(
    readWorkflowStep(candidateJob, 'Create immutable publication candidate'),
    'env',
  );
  if (candidateEnvironment?.GH_TOKEN !== '${{ github.token }}') {
    throw new Error(
      'Release workflow publication candidate must use the standard GitHub workflow token',
    );
  }
  if (
    !candidateJob.some(
      (line) =>
        line.trim()
          === `OPENCOVEN_PUBLICATION_ARTIFACT_NAME: ${PUBLICATION_ARTIFACT_NAME}`,
    )
    || !candidateJob.some(
      (line) =>
        line.trim()
          === `name: ${PUBLICATION_ARTIFACT_NAME}`,
    )
  ) {
    throw new Error(
      'Release workflow publication candidate artifact name must derive from the exact commit and version',
    );
  }
  if (
    countStringOccurrences(structuredWorkflow.jobs, PUBLICATION_ARTIFACT_NAME)
      !== 2
  ) {
    throw new Error(
      'Release workflow must contain only the reviewed publication candidate artifact-name bindings',
    );
  }
  if (
    structuredWorkflowDigest(structuredCandidateJob)
      !== PUBLICATION_CANDIDATE_JOB_SHA256
  ) {
    throw new Error(
      'Release workflow publication-candidate job must use only the exact reviewed ordered steps',
    );
  }
  const candidateAttestationJob = readWorkflowJob(
    workflow,
    config.publicationCandidate.attestationJob,
  );
  const structuredCandidateAttestationJob = readStructuredWorkflowJob(
    structuredWorkflow,
    config.publicationCandidate.attestationJob,
  );
  if (
    readWorkflowJobScalar(candidateAttestationJob, 'if')
      !== "inputs.mode == 'verify'"
    || readWorkflowJobScalar(candidateAttestationJob, 'needs')
      !== config.publicationCandidate.job
    || readWorkflowJobScalar(candidateAttestationJob, 'name')
      !== config.publicationCandidate.attestationJob
  ) {
    throw new Error(
      'Release workflow candidate attestation must run only after the unprivileged producer',
    );
  }
  validateIsolatedAttestationJob(
    structuredCandidateAttestationJob,
    config.publicationCandidate.attestationJob,
    [DOWNLOAD_ARTIFACT_ACTION, ATTEST_ACTION, UPLOAD_ARTIFACT_ACTION],
  );
  if (
    countStringOccurrences(
      structuredCandidateAttestationJob,
      '${{ needs.publication-candidate.outputs.artifact-id }}',
    ) !== 1
    || countStringOccurrences(
      structuredCandidateAttestationJob,
      PUBLICATION_ATTESTATION_ARTIFACT_NAME,
    ) !== 1
  ) {
    throw new Error(
      'Release workflow candidate attestation must consume the exact producer artifact and upload one reviewable bundle',
    );
  }
  if (
    structuredWorkflowDigest(structuredCandidateAttestationJob)
      !== PUBLICATION_CANDIDATE_ATTESTATION_JOB_SHA256
  ) {
    throw new Error(
      'Release workflow candidate-attestation job must use only the exact reviewed ordered steps',
    );
  }
  const publishJob = readWorkflowJob(workflow, 'publish');
  const structuredPublishJob = readStructuredWorkflowJob(
    structuredWorkflow,
    'publish',
  );
  const approvalWitnessJob = readWorkflowJob(
    workflow,
    config.protectedApproval.witnessJob,
  );
  const structuredApprovalWitnessJob = readStructuredWorkflowJob(
    structuredWorkflow,
    config.protectedApproval.witnessJob,
  );
  const approvalWitnessAttestationJob = readWorkflowJob(
    workflow,
    config.protectedApproval.witnessAttestationJob,
  );
  const structuredApprovalWitnessAttestationJob =
    readStructuredWorkflowJob(
      structuredWorkflow,
      config.protectedApproval.witnessAttestationJob,
    );
  const approvalEvidenceJob = readWorkflowJob(
    workflow,
    config.protectedApproval.approvalJob,
  );
  const structuredApprovalEvidenceJob = readStructuredWorkflowJob(
    structuredWorkflow,
    config.protectedApproval.approvalJob,
  );
  const approvalEvidenceAttestationJob = readWorkflowJob(
    workflow,
    config.protectedApproval.approvalAttestationJob,
  );
  const structuredApprovalEvidenceAttestationJob =
    readStructuredWorkflowJob(
      structuredWorkflow,
      config.protectedApproval.approvalAttestationJob,
    );
  if (
    readWorkflowJobScalar(approvalWitnessJob, 'if') !== "inputs.mode == 'publish'"
    || readWorkflowJobScalar(approvalWitnessJob, 'needs')
      !== '[preflight, repository-verification]'
    || readWorkflowJobScalar(approvalWitnessAttestationJob, 'if')
      !== "inputs.mode == 'publish'"
    || readWorkflowJobScalar(approvalWitnessAttestationJob, 'needs')
      !== config.protectedApproval.witnessJob
    || readWorkflowJobScalar(approvalEvidenceJob, 'if')
      !== "inputs.mode == 'publish'"
    || readWorkflowJobScalar(approvalEvidenceJob, 'needs')
      !== '[preflight, repository-verification]'
    || readWorkflowJobScalar(approvalEvidenceJob, 'environment')
      !== config.protectedApproval.environment
    || readWorkflowJobScalar(approvalEvidenceAttestationJob, 'if')
      !== "inputs.mode == 'publish'"
    || readWorkflowJobScalar(approvalEvidenceAttestationJob, 'needs')
      !== config.protectedApproval.approvalJob
  ) {
    throw new Error(
      'Release workflow must create pending and protected approval evidence before publication',
    );
  }
  if (
    JSON.stringify(structuredApprovalWitnessJob.permissions)
      !== JSON.stringify({
        actions: 'read',
        contents: 'read',
        deployments: 'read',
      })
    || JSON.stringify(structuredApprovalEvidenceJob.permissions)
      !== JSON.stringify({
        actions: 'read',
        attestations: 'read',
        contents: 'read',
        deployments: 'read',
        issues: 'read',
      })
  ) {
    throw new Error(
      'Release workflow approval producers must not receive OIDC or attestation-write permissions',
    );
  }
  const jobsSource = workflow.slice(workflow.indexOf('\njobs:\n') + 7);
  const workflowJobIds = [
    ...jobsSource.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/gmu),
  ].map((match) => match[1]);
  if (
    JSON.stringify(workflowJobIds)
      !== JSON.stringify([
        'preflight',
        'repository-verification',
        'publication-candidate',
        'publication-candidate-attestation',
        'approval-witness',
        'approval-witness-attestation',
        'approval-evidence',
        'approval-evidence-attestation',
        'publish',
      ])
  ) {
    throw new Error('Release workflow must use the exact frozen release job graph');
  }
  const expectedStepCounts = {
    preflight: 9,
    'repository-verification': 7,
    'publication-candidate': 6,
    'publication-candidate-attestation': 3,
    'approval-witness': 5,
    'approval-witness-attestation': 2,
    'approval-evidence': 8,
    'approval-evidence-attestation': 2,
    publish: 10,
  };
  if (
    Object.entries(expectedStepCounts).some(([jobName, stepCount]) =>
      readStructuredWorkflowSteps(
        readStructuredWorkflowJob(structuredWorkflow, jobName),
        jobName,
      ).length !== stepCount,
    )
  ) {
    throw new Error(
      'Release workflow must use the exact frozen release job and step graph',
    );
  }
  if (
    structuredWorkflowDigest(structuredPreflightJob)
      !== PREFLIGHT_JOB_SHA256
    || structuredWorkflowDigest(structuredRepositoryVerificationJob)
      !== REPOSITORY_VERIFICATION_JOB_SHA256
  ) {
    throw new Error(
      'Release workflow must use the exact frozen release job and step graph',
    );
  }
  if (
    structuredWorkflowDigest(structuredApprovalWitnessJob)
      !== APPROVAL_WITNESS_JOB_SHA256
    || structuredWorkflowDigest(structuredApprovalWitnessAttestationJob)
      !== APPROVAL_WITNESS_ATTESTATION_JOB_SHA256
    || structuredWorkflowDigest(structuredApprovalEvidenceJob)
      !== APPROVAL_EVIDENCE_JOB_SHA256
    || structuredWorkflowDigest(structuredApprovalEvidenceAttestationJob)
      !== APPROVAL_EVIDENCE_ATTESTATION_JOB_SHA256
  ) {
    throw new Error(
      'Release workflow approval jobs must use only the exact reviewed ordered steps',
    );
  }
  const candidateUploadCount = candidateJob.filter((line) =>
    line.includes('actions/upload-artifact@'),
  ).length;
  const totalUploadCount =
    workflow.match(/actions\/upload-artifact@[0-9a-f]{40}/gu)?.length ?? 0;
  if (candidateUploadCount !== 1 || totalUploadCount !== 4) {
    throw new Error(
      'Release workflow must contain exactly one publication candidate upload',
    );
  }
  const uploadArtifactOwners = [
    ['preflight', preflightJob],
    ['repository-verification', repositoryVerificationJob],
    ['publication-candidate', candidateJob],
    ['publication-candidate-attestation', candidateAttestationJob],
    ['approval-witness', approvalWitnessJob],
    ['approval-witness-attestation', approvalWitnessAttestationJob],
    ['approval-evidence', approvalEvidenceJob],
    ['approval-evidence-attestation', approvalEvidenceAttestationJob],
    ['publish', publishJob],
  ].filter(([, lines]) =>
    lines.some((line) => line.includes('actions/upload-artifact@')),
  );
  if (
    JSON.stringify(uploadArtifactOwners.map(([name]) => name))
      !== JSON.stringify([
        'publication-candidate',
        'publication-candidate-attestation',
        'approval-witness',
        'approval-evidence',
      ])
  ) {
    throw new Error(
      'Only the candidate, candidate-attestation, and approval-evidence jobs may upload release evidence',
    );
  }
  if (
    structuredPublishJob.environment
      !== config.npmTrustedPublisher.environment
  ) {
    throw new Error(
      'Release workflow publish job must use the exact npm trusted-publisher environment',
    );
  }
  if (
    readWorkflowJobScalar(publishJob, 'needs')
      !== '[preflight, repository-verification, approval-witness, approval-witness-attestation, approval-evidence, approval-evidence-attestation]'
  ) {
    throw new Error(
      'Release workflow publish job must require verification and both isolated approval-attestation jobs',
    );
  }
  const permissions = readWorkflowJobMapping(publishJob, 'permissions');
  for (const [permission, value] of [
    ['actions', 'read'],
    ['contents', 'read'],
    ['deployments', 'read'],
    ['id-token', 'write'],
    ['attestations', 'read'],
    ['issues', 'read'],
  ]) {
    if (permissions?.[permission] !== value) {
      throw new Error(
        `Release workflow publish job must contain ${permission}: ${value}`,
      );
    }
  }
  if (Object.keys(permissions ?? {}).length !== 6) {
    throw new Error(
      'Release workflow publish job must use only reviewed publication permissions',
    );
  }
  validateIsolatedAttestationJob(
    structuredApprovalWitnessAttestationJob,
    config.protectedApproval.witnessAttestationJob,
    [DOWNLOAD_ARTIFACT_ACTION, ATTEST_ACTION],
  );
  validateIsolatedAttestationJob(
    structuredApprovalEvidenceAttestationJob,
    config.protectedApproval.approvalAttestationJob,
    [DOWNLOAD_ARTIFACT_ACTION, ATTEST_ACTION],
  );
  const candidateAttestationCount = candidateAttestationJob.filter((line) =>
    line.includes('actions/attest@'),
  ).length;
  const publishAttestationCount = publishJob.filter((line) =>
    line.includes('actions/attest@'),
  ).length;
  const approvalWitnessAttestationCount =
    approvalWitnessAttestationJob.filter((line) =>
      line.includes('actions/attest@'),
    ).length;
  const approvalEvidenceAttestationCount =
    approvalEvidenceAttestationJob.filter((line) =>
      line.includes('actions/attest@'),
    ).length;
  const totalAttestationCount =
    workflow.match(
      /actions\/attest@[0-9a-f]{40}/gu,
    )?.length ?? 0;
  if (
    candidateAttestationCount !== 1
    || approvalWitnessAttestationCount !== 1
    || approvalEvidenceAttestationCount !== 1
    || publishAttestationCount !== 0
    || totalAttestationCount !== 3
  ) {
    throw new Error(
      'Release workflow must attest only candidate and approval evidence bytes',
    );
  }
  const oidcJobIds = Object.entries(structuredWorkflow.jobs)
    .filter(([, job]) =>
      isRecord(job)
      && isRecord(job.permissions)
      && job.permissions['id-token'] === 'write',
    )
    .map(([jobName]) => jobName);
  if (
    JSON.stringify(oidcJobIds) !== JSON.stringify([
      config.publicationCandidate.attestationJob,
      config.protectedApproval.witnessAttestationJob,
      config.protectedApproval.approvalAttestationJob,
      config.npmTrustedPublisher.job,
    ])
  ) {
    throw new Error(
      'Release workflow must grant OIDC only to isolated attesters and the final publisher',
    );
  }
  for (const stepName of [
    'Resolve exact publication authorization',
    'Verify exact reviewed publication bytes',
    'Publish exact reviewed release artifacts',
  ]) {
    const environment = readWorkflowStepMapping(
      readWorkflowStep(publishJob, stepName),
      'env',
    );
    if (environment?.GH_TOKEN !== '${{ github.token }}') {
      throw new Error(
        `Release workflow step ${stepName} must use the standard GitHub workflow token`,
      );
    }
  }
  if (
    publishJob.some((line) => line.includes('actions/upload-artifact@'))
    || publishJob.some((line) =>
      /\b(?:npm|pnpm)\s+pack\b/u.test(line),
    )
    || !publishJob.some((line) =>
      line.trim() === 'run-id: ${{ steps.authorization.outputs.run-id }}',
    )
    || !publishJob.some((line) =>
      line.trim()
        === 'artifact-ids: ${{ steps.authorization.outputs.artifact-id }}',
    )
    || !publishJob.some((line) =>
      line.trim()
        === 'artifact-ids: ${{ steps.authorization.outputs.attestation-bundle-artifact-id }}',
    )
  ) {
    throw new Error(
      'Release workflow publish job must download and consume only the exact #40-reviewed candidate artifact',
    );
  }
  if (
    structuredWorkflowDigest(structuredPublishJob)
      !== PUBLISH_JOB_SHA256
  ) {
    throw new Error(
      'Release workflow publish job must use only the exact reviewed ordered steps',
    );
  }
  validateWorkflowActionIndirection(structuredWorkflow);
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
  requireFrozenRuntime = false,
  requireConformanceEvidence = false,
  requireLiveEnvironmentPolicy = false,
  caveAuthorityRoot = process.env.OPENCOVEN_CAVE_AUTHORITY_ROOT,
  githubExecute = execFileSync,
  env = process.env,
  environmentPolicyNow = () => new Date(),
} = {}) {
  if (mode !== 'verify' && mode !== 'publish') {
    throw new Error(`Release mode must be verify or publish, received ${String(mode)}`);
  }
  if (typeof requireTag !== 'boolean') {
    throw new Error('requireTag must be a boolean');
  }
  if (typeof requireFrozenRuntime !== 'boolean') {
    throw new Error('requireFrozenRuntime must be a boolean');
  }
  if (typeof requireConformanceEvidence !== 'boolean') {
    throw new Error('requireConformanceEvidence must be a boolean');
  }
  if (typeof requireLiveEnvironmentPolicy !== 'boolean') {
    throw new Error('requireLiveEnvironmentPolicy must be a boolean');
  }
  if (version !== undefined) {
    assertStrictSemVer(version);
  }
  if (
    requireFrozenRuntime
    || requireConformanceEvidence
    || requireLiveEnvironmentPolicy
    || requireTag
    || tag !== undefined
    || mode === 'publish'
  ) {
    assertFrozenNodeRuntime(root);
  }

  const config = readReleaseConfig(root);
  validateReleaseWorkflow(root, config);
  if (requireLiveEnvironmentPolicy) {
    verifyLiveReleaseEnvironmentPolicies({
      config,
      execute: githubExecute,
      env,
      now: environmentPolicyNow,
    });
  }
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
    const releaseTag = inspectAnnotatedReleaseTag(root, tag);
    const checkout = inspectReleaseRepository(root);
    if (releaseTag.commit !== checkout.commit) {
      throw new Error(`Release tag ${tag} does not point to HEAD`);
    }
    if (releaseTag.tree !== checkout.tree) {
      throw new Error(`Release tag ${tag} does not resolve to the HEAD tree`);
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
        env,
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
