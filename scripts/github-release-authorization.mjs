#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { devNull } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  serializeCanonicalJson,
} from './conformance-contract.mjs';
import {
  verifyPublicationArtifacts,
} from './create-release-artifacts.mjs';
import {
  inspectReleaseRepository,
  readReleaseConfig,
  validateReleaseWorkflow,
} from './release-readiness.mjs';

const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;
const MAX_ATTESTATION_BUNDLE_BYTES = 16 * 1_048_576;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/u;
const REVIEWER_ID = 68980965;
const REVIEWER_AUTHORIZATION = Object.freeze({
  id: REVIEWER_ID,
  authorAssociation: 'MEMBER',
  permission: 'admin',
  roleName: 'admin',
});

function authorizationGitEnvironment(source = process.env) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: source.HOME ?? source.RUNNER_TEMP ?? '/tmp',
    TMPDIR: source.TMPDIR ?? source.RUNNER_TEMP ?? '/tmp',
    GH_HOST: 'github.com',
    ...(typeof source.GH_TOKEN === 'string'
      ? { GH_TOKEN: source.GH_TOKEN }
      : {}),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactFields(value, fields, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label} is missing field ${field}`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      throw new Error(`${label} contains unexpected field ${field}`);
    }
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseGitHubJson(text, label) {
  if (
    typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error(`${label} response is not bounded UTF-8 JSON`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} response is not valid JSON`, { cause: error });
  }
}

function runGitHubApi(execute, endpoint, env) {
  return parseGitHubJson(
    execute(
      '/usr/bin/gh',
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        endpoint,
      ],
      {
        encoding: 'utf8',
        env: authorizationGitEnvironment(env),
        maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    ),
    endpoint,
  );
}

function verifyCandidateAttestation(
  execute,
  path,
  expectedSha256,
  authorization,
  bundlePath,
  env,
) {
  const output = execute(
    '/usr/bin/gh',
    [
      'attestation',
      'verify',
      path,
      '--repo',
      'OpenCoven/sdk',
      '--signer-workflow',
      'OpenCoven/sdk/.github/workflows/release.yml',
      '--signer-digest',
      authorization.source.commit,
      '--source-digest',
      authorization.source.commit,
      '--source-ref',
      'refs/heads/main',
      '--predicate-type',
      'https://slsa.dev/provenance/v1',
      '--deny-self-hosted-runners',
      '--bundle',
      bundlePath,
      '--format',
      'json',
      '--hostname',
      'github.com',
    ],
    {
      encoding: 'utf8',
      env: authorizationGitEnvironment(env),
      maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      killSignal: 'SIGKILL',
    },
  );
  const results = parseGitHubJson(output, `${path} GitHub attestation`);
  const invocation =
    'https://github.com/OpenCoven/sdk/actions/runs/'
    + `${authorization.provenance.runId}/attempts/`
    + authorization.provenance.runAttempt;
  if (
    !Array.isArray(results)
    || !results.some((entry) => {
      const verification = isRecord(entry)
        ? entry.verificationResult
        : null;
      const signature = isRecord(verification)
        ? verification.signature
        : null;
      const certificate = isRecord(signature)
        ? signature.certificate
        : null;
      const statement = isRecord(verification)
        ? verification.statement
        : null;
      const subjects = isRecord(statement) && Array.isArray(statement.subject)
        ? statement.subject
        : [];
      return (
        isRecord(certificate)
        && certificate.runInvocationURI === invocation
        && certificate.runnerEnvironment === 'github-hosted'
        && certificate.sourceRepositoryURI
          === 'https://github.com/OpenCoven/sdk'
        && certificate.sourceRepositoryDigest === authorization.source.commit
        && certificate.sourceRepositoryRef === 'refs/heads/main'
        && certificate.buildSignerDigest === authorization.source.commit
        && statement.predicateType === 'https://slsa.dev/provenance/v1'
        && subjects.some(
          (subject) =>
            isRecord(subject)
            && isRecord(subject.digest)
            && subject.digest.sha256 === expectedSha256,
        )
      );
    })
  ) {
    throw new Error(
      'GitHub security review does not cryptographically bind the downloaded candidate bytes to the exact run attempt',
    );
  }
}

function canonicalPackageEntries(packages) {
  if (!Array.isArray(packages) || packages.length !== 4) {
    throw new Error('Publication authorization must bind exactly four packages');
  }
  return packages.map((entry, index) => {
    assertExactFields(
      entry,
      ['name', 'version', 'file', 'size', 'sha256'],
      `Publication authorization package ${index}`,
    );
    if (
      typeof entry.name !== 'string'
      || typeof entry.version !== 'string'
      || typeof entry.file !== 'string'
      || !Number.isSafeInteger(entry.size)
      || entry.size <= 0
      || typeof entry.sha256 !== 'string'
      || !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw new Error(
        `Publication authorization package ${index} is invalid`,
      );
    }
    return {
      name: entry.name,
      version: entry.version,
      file: entry.file,
      size: entry.size,
      sha256: entry.sha256,
    };
  });
}

export function createPublicationAuthorizationRecord({
  artifactId,
  artifactDigest,
  attestationJobId,
  attestationBundle,
  deploymentId,
  environmentId,
  jobId,
  manifest,
  manifestText,
}) {
  if (
    typeof artifactId !== 'string'
    || !POSITIVE_ID_PATTERN.test(artifactId)
    || typeof artifactDigest !== 'string'
    || !ARTIFACT_DIGEST_PATTERN.test(artifactDigest)
    || typeof attestationJobId !== 'string'
    || !POSITIVE_ID_PATTERN.test(attestationJobId)
    || !isRecord(attestationBundle)
    || typeof attestationBundle.artifactId !== 'string'
    || !POSITIVE_ID_PATTERN.test(attestationBundle.artifactId)
    || typeof attestationBundle.artifactDigest !== 'string'
    || !ARTIFACT_DIGEST_PATTERN.test(attestationBundle.artifactDigest)
    || attestationBundle.file !== 'attestation.json'
    || !Number.isSafeInteger(attestationBundle.size)
    || attestationBundle.size <= 0
    || attestationBundle.size > MAX_ATTESTATION_BUNDLE_BYTES
    || typeof attestationBundle.sha256 !== 'string'
    || !SHA256_PATTERN.test(attestationBundle.sha256)
    || typeof deploymentId !== 'string'
    || !POSITIVE_ID_PATTERN.test(deploymentId)
    || typeof environmentId !== 'string'
    || !POSITIVE_ID_PATTERN.test(environmentId)
    || typeof jobId !== 'string'
    || !POSITIVE_ID_PATTERN.test(jobId)
    || !isRecord(manifest)
    || manifest.schemaVersion !== 6
    || manifest.artifactSet !== 'publication-candidate'
    || typeof manifestText !== 'string'
  ) {
    throw new Error('Publication authorization input is invalid');
  }
  assertExactFields(
    attestationBundle,
    ['artifactId', 'artifactDigest', 'file', 'size', 'sha256'],
    'Publication authorization attestation bundle input',
  );
  assertExactFields(
    manifest.source,
    ['repository', 'commit', 'tree', 'runtimeManifest', 'npmConfigFiles'],
    'Publication candidate source',
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
    'Publication candidate toolchain',
  );
  assertExactFields(
    manifest.publisher,
    ['path', 'size', 'sha256'],
    'Publication candidate publisher',
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
    'Publication candidate provenance',
  );
  const attestationBundleArtifactName =
    `opencoven-sdk-publication-attestation-${manifest.source.commit}`
    + `-${manifest.version}`;
  return {
    schemaVersion: 6,
    kind: 'opencoven-sdk-publication-security-review',
    issue: 'OpenCoven/sdk#40',
    disposition: 'ship',
    reviewer: { ...REVIEWER_AUTHORIZATION },
    version: manifest.version,
    source: {
      repository: manifest.source.repository,
      commit: manifest.source.commit,
      tree: manifest.source.tree,
      runtimeManifest: {
        ...manifest.source.runtimeManifest,
      },
    },
    manifest: {
      file: 'release-manifest.json',
      size: Buffer.byteLength(manifestText, 'utf8'),
      sha256: sha256(manifestText),
    },
    packages: canonicalPackageEntries(manifest.packages),
    toolchain: {
      nodeVersion: manifest.toolchain.nodeVersion,
      nodePath: manifest.toolchain.nodePath,
      nodeSize: manifest.toolchain.nodeSize,
      nodeSha256: manifest.toolchain.nodeSha256,
      corepackVersion: manifest.toolchain.corepackVersion,
      corepackTreeSha256: manifest.toolchain.corepackTreeSha256,
      pnpmVersion: manifest.toolchain.pnpmVersion,
      npmVersion: manifest.toolchain.npmVersion,
      npmTarball: manifest.toolchain.npmTarball,
      npmIntegrity: manifest.toolchain.npmIntegrity,
      npmTreeSha256: manifest.toolchain.npmTreeSha256,
      npmEntrypointSha256: manifest.toolchain.npmEntrypointSha256,
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
      jobId,
      environment: manifest.provenance.environment,
      environmentId,
      deploymentId,
    },
    artifact: {
      id: artifactId,
      name: manifest.provenance.artifactName,
      digest: artifactDigest,
    },
    attestation: {
      job: 'publication-candidate-attestation',
      jobId: attestationJobId,
      bundle: {
        artifactId: attestationBundle.artifactId,
        artifactName: attestationBundleArtifactName,
        artifactDigest: attestationBundle.artifactDigest,
        file: attestationBundle.file,
        size: attestationBundle.size,
        sha256: attestationBundle.sha256,
      },
    },
  };
}

function parseAuthorizationBody(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error('GitHub security review comment body is not valid JSON', {
      cause: error,
    });
  }
  if (serializeCanonicalJson(value) !== text) {
    throw new Error(
      'GitHub security review comment must be canonical unedited JSON',
    );
  }
  assertExactFields(
    value,
    [
      'schemaVersion',
      'kind',
      'issue',
      'disposition',
      'reviewer',
      'version',
      'source',
      'manifest',
      'packages',
      'toolchain',
      'publisher',
      'provenance',
      'artifact',
      'attestation',
    ],
    'Publication authorization',
  );
  assertExactFields(
    value.reviewer,
    ['id', 'authorAssociation', 'permission', 'roleName'],
    'Publication authorization reviewer',
  );
  assertExactFields(
    value.source,
    ['repository', 'commit', 'tree', 'runtimeManifest'],
    'Publication authorization source',
  );
  assertExactFields(
    value.source.runtimeManifest,
    [
      'file',
      'size',
      'sha256',
      'runtimeSha256',
      'candidateCommit',
      'candidateTree',
    ],
    'Publication authorization source.runtimeManifest',
  );
  assertExactFields(
    value.manifest,
    ['file', 'size', 'sha256'],
    'Publication authorization manifest',
  );
  assertExactFields(
    value.toolchain,
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
    'Publication authorization toolchain',
  );
  assertExactFields(
    value.publisher,
    ['path', 'size', 'sha256'],
    'Publication authorization publisher',
  );
  assertExactFields(
    value.provenance,
    [
      'repository',
      'workflow',
      'workflowCommit',
      'sourceRef',
      'runId',
      'runAttempt',
      'job',
      'jobId',
      'environment',
      'environmentId',
      'deploymentId',
    ],
    'Publication authorization provenance',
  );
  assertExactFields(
    value.artifact,
    ['id', 'name', 'digest'],
    'Publication authorization artifact',
  );
  assertExactFields(
    value.attestation,
    ['job', 'jobId', 'bundle'],
    'Publication authorization attestation',
  );
  assertExactFields(
    value.attestation.bundle,
    [
      'artifactId',
      'artifactName',
      'artifactDigest',
      'file',
      'size',
      'sha256',
    ],
    'Publication authorization attestation bundle',
  );
  const packages = canonicalPackageEntries(value.packages);
  if (
    value.schemaVersion !== 6
    || value.kind !== 'opencoven-sdk-publication-security-review'
    || value.issue !== 'OpenCoven/sdk#40'
    || value.disposition !== 'ship'
    || value.reviewer.id !== REVIEWER_AUTHORIZATION.id
    || value.reviewer.authorAssociation
      !== REVIEWER_AUTHORIZATION.authorAssociation
    || value.reviewer.permission !== REVIEWER_AUTHORIZATION.permission
    || value.reviewer.roleName !== REVIEWER_AUTHORIZATION.roleName
    || typeof value.version !== 'string'
    || value.source.repository !== 'OpenCoven/sdk'
    || typeof value.source.commit !== 'string'
    || !GIT_OID_PATTERN.test(value.source.commit)
    || typeof value.source.tree !== 'string'
    || !GIT_OID_PATTERN.test(value.source.tree)
    || value.source.runtimeManifest.file
      !== 'publication-source-manifest.json'
    || !Number.isSafeInteger(value.source.runtimeManifest.size)
    || value.source.runtimeManifest.size <= 0
    || typeof value.source.runtimeManifest.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.source.runtimeManifest.sha256)
    || typeof value.source.runtimeManifest.runtimeSha256 !== 'string'
    || !SHA256_PATTERN.test(value.source.runtimeManifest.runtimeSha256)
    || typeof value.source.runtimeManifest.candidateCommit !== 'string'
    || !GIT_OID_PATTERN.test(
      value.source.runtimeManifest.candidateCommit,
    )
    || typeof value.source.runtimeManifest.candidateTree !== 'string'
    || !GIT_OID_PATTERN.test(value.source.runtimeManifest.candidateTree)
    || value.manifest.file !== 'release-manifest.json'
    || !Number.isSafeInteger(value.manifest.size)
    || value.manifest.size <= 0
    || typeof value.manifest.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.manifest.sha256)
    || value.toolchain.nodeVersion !== 'v24.18.1'
    || value.toolchain.nodePath
      !== '/opt/hostedtoolcache/node/24.18.1/x64/bin/node'
    || value.toolchain.nodeSize !== 123656816
    || value.toolchain.nodeSha256
      !== 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
    || value.toolchain.corepackVersion !== '0.35.0'
    || value.toolchain.corepackTreeSha256
      !== '469b918857ea32351ac6a0737597abc90330dd521005687543dbd6b142536b08'
    || value.toolchain.pnpmVersion !== 'pnpm@10.34.0'
    || value.toolchain.npmVersion !== '11.5.1'
    || value.toolchain.npmTarball
      !== 'https://registry.npmjs.org/npm/-/npm-11.5.1.tgz'
    || value.toolchain.npmIntegrity
      !== 'sha512-Iy5vXZ55m8tIaSCz6bqQf9+W5XbPfoyURsgWLjOkFglqHTep6RDZqRj2sfYGeRyZvGu2HuJWm0lux0rxPQ29lQ=='
    || value.toolchain.npmTreeSha256
      !== 'dbe97072240cb2048f84faade50f938bdca3ba04efa67719259f5528397f0f09'
    || value.toolchain.npmEntrypointSha256
      !== '8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7'
    || value.toolchain.packCommand
      !== 'sanitize package manifests; node <authenticated-corepack> pnpm@10.34.0 --config.pnpmfile=/dev/null --config.global-pnpmfile=/dev/null pack'
    || value.publisher.path !== 'scripts/publish-release-artifacts.mjs'
    || !Number.isSafeInteger(value.publisher.size)
    || value.publisher.size <= 0
    || typeof value.publisher.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.publisher.sha256)
    || value.provenance.repository !== 'OpenCoven/sdk'
    || value.provenance.workflow !== '.github/workflows/release.yml'
    || value.provenance.workflowCommit !== value.source.commit
    || value.provenance.sourceRef !== 'refs/heads/main'
    || typeof value.provenance.runId !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.provenance.runId)
    || !Number.isSafeInteger(value.provenance.runAttempt)
    || value.provenance.runAttempt < 1
    || value.provenance.runAttempt > 1_000
    || value.provenance.job !== 'publication-candidate'
    || typeof value.provenance.jobId !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.provenance.jobId)
    || value.provenance.environment !== 'publication-candidate'
    || typeof value.provenance.environmentId !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.provenance.environmentId)
    || typeof value.provenance.deploymentId !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.provenance.deploymentId)
    || typeof value.artifact.id !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.artifact.id)
    || typeof value.artifact.name !== 'string'
    || value.artifact.name
      !== `opencoven-sdk-publication-${value.source.commit}-${value.version}`
    || typeof value.artifact.digest !== 'string'
    || !ARTIFACT_DIGEST_PATTERN.test(value.artifact.digest)
    || value.attestation.job !== 'publication-candidate-attestation'
    || typeof value.attestation.jobId !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.attestation.jobId)
    || typeof value.attestation.bundle.artifactId !== 'string'
    || !POSITIVE_ID_PATTERN.test(value.attestation.bundle.artifactId)
    || value.attestation.bundle.artifactName
      !== (
        `opencoven-sdk-publication-attestation-${value.source.commit}`
        + `-${value.version}`
      )
    || typeof value.attestation.bundle.artifactDigest !== 'string'
    || !ARTIFACT_DIGEST_PATTERN.test(
      value.attestation.bundle.artifactDigest,
    )
    || value.attestation.bundle.file !== 'attestation.json'
    || !Number.isSafeInteger(value.attestation.bundle.size)
    || value.attestation.bundle.size <= 0
    || value.attestation.bundle.size > MAX_ATTESTATION_BUNDLE_BYTES
    || typeof value.attestation.bundle.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.attestation.bundle.sha256)
    || packages.some((entry) => entry.version !== value.version)
  ) {
    throw new Error('GitHub security review authorization record is invalid');
  }
  return {
    ...value,
    packages,
  };
}

function expectAuthorizedRun(value, authorization) {
  if (
    !isRecord(value)
    || value.id !== Number(authorization.provenance.runId)
    || value.name !== 'release'
    || value.event !== 'workflow_dispatch'
    || value.run_attempt !== authorization.provenance.runAttempt
    || value.head_sha !== authorization.source.commit
    || value.head_branch !== 'main'
    || value.path !== authorization.provenance.workflow
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !isRecord(value.repository)
    || value.repository.full_name !== 'OpenCoven/sdk'
    || !isRecord(value.head_repository)
    || value.head_repository.full_name !== 'OpenCoven/sdk'
  ) {
    throw new Error(
      'GitHub security review does not bind a successful exact candidate run',
    );
  }
}

function expectAuthorizedJob(value, authorization, expected) {
  if (
    !isRecord(value)
    || value.id !== Number(expected.id)
    || value.run_id !== Number(authorization.provenance.runId)
    || value.run_attempt !== authorization.provenance.runAttempt
    || value.head_sha !== authorization.source.commit
    || value.html_url
      !== (
        'https://github.com/OpenCoven/sdk/actions/runs/'
        + `${authorization.provenance.runId}/job/`
        + expected.id
      )
    || value.name !== expected.name
    || value.workflow_name !== 'release'
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || typeof value.started_at !== 'string'
    || !Number.isFinite(Date.parse(value.started_at))
    || typeof value.completed_at !== 'string'
    || !Number.isFinite(Date.parse(value.completed_at))
    || !Array.isArray(value.labels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(
      `GitHub security review does not bind the successful ${expected.label} job`,
    );
  }
  return {
    startedAt: value.started_at,
    completedAt: value.completed_at,
  };
}

function expectAuthorizedEnvironment(value, authorization) {
  if (
    !isRecord(value)
    || value.id !== Number(authorization.provenance.environmentId)
    || value.name !== authorization.provenance.environment
  ) {
    throw new Error(
      'GitHub security review does not bind the exact publication candidate environment',
    );
  }
}

function expectAuthorizedDeployment(value, authorization) {
  const deploymentId = Number(authorization.provenance.deploymentId);
  if (
    !isRecord(value)
    || value.id !== deploymentId
    || value.sha !== authorization.source.commit
    || value.ref !== 'main'
    || value.task !== 'deploy'
    || value.environment !== authorization.provenance.environment
    || value.transient_environment !== false
    || value.statuses_url
      !== (
        'https://api.github.com/repos/OpenCoven/sdk/deployments/'
        + `${deploymentId}/statuses`
      )
    || value.repository_url
      !== 'https://api.github.com/repos/OpenCoven/sdk'
    || !isRecord(value.performed_via_github_app)
    || value.performed_via_github_app.slug !== 'github-actions'
  ) {
    throw new Error(
      'GitHub security review does not bind the exact publication candidate deployment',
    );
  }
}

function expectAuthorizedDeploymentStatuses(value, authorization) {
  const jobUrl =
    'https://github.com/OpenCoven/sdk/actions/runs/'
    + `${authorization.provenance.runId}/job/`
    + authorization.provenance.jobId;
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some(
      (status) =>
        !isRecord(status)
        || status.environment !== authorization.provenance.environment
        || status.log_url !== jobUrl
        || status.target_url !== jobUrl
        || typeof status.state !== 'string',
    )
    || !value.some((status) => status.state === 'success')
  ) {
    throw new Error(
      'GitHub security review deployment does not belong to the exact candidate job',
    );
  }
}

function expectAuthorizedArtifact(value, authorization, expected, label) {
  if (
    !isRecord(value)
    || value.id !== Number(expected.id)
    || value.name !== expected.name
    || value.digest !== expected.digest
    || value.expired !== false
    || !isRecord(value.workflow_run)
    || value.workflow_run.id !== Number(authorization.provenance.runId)
    || value.workflow_run.head_sha !== authorization.source.commit
  ) {
    throw new Error(
      `GitHub security review does not bind the exact ${label} artifact`,
    );
  }
}

function readCandidateAttestationBundle(root, authorization) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error(
      'Publication requires the exact #40-authorized candidate attestation bundle',
    );
  }
  const entries = readdirSync(root);
  if (
    entries.length !== 1
    || entries[0] !== authorization.attestation.bundle.file
  ) {
    throw new Error(
      'Candidate attestation artifact must contain exactly the reviewed bundle',
    );
  }
  const path = resolve(root, entries[0]);
  const stats = lstatSync(path);
  const bytes = readFileSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || bytes.byteLength !== authorization.attestation.bundle.size
    || bytes.byteLength > MAX_ATTESTATION_BUNDLE_BYTES
    || sha256(bytes) !== authorization.attestation.bundle.sha256
  ) {
    throw new Error(
      'Candidate attestation bundle does not match the #40-authorized bytes',
    );
  }
  return path;
}

export function resolvePublicationSecurityReview({
  root = process.cwd(),
  commentId,
  allowedArtifactRoot,
  allowedArtifactRoots,
  execute = execFileSync,
  env = process.env,
} = {}) {
  if (
    typeof commentId !== 'string'
    || !POSITIVE_ID_PATTERN.test(commentId)
  ) {
    throw new Error('Publication security review comment id is invalid');
  }
  const config = readReleaseConfig(root);
  if (config.publishingEnabled !== true) {
    throw new Error('Release publishing is disabled by release.config.json');
  }
  validateReleaseWorkflow(root, config);
  const checkout = inspectReleaseRepository(root);
  const status = execFileSync(
    '/usr/bin/git',
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
      checkout.root,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ],
    {
      encoding: 'utf8',
      env: authorizationGitEnvironment(),
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const allowedRoots = [
    ...(typeof allowedArtifactRoot === 'string'
      ? [allowedArtifactRoot]
      : []),
    ...(Array.isArray(allowedArtifactRoots)
      ? allowedArtifactRoots.filter((path) => typeof path === 'string')
      : []),
  ];
  const allowedPaths = allowedRoots
    .map((path) => relative(checkout.root, resolve(path)))
    .filter(
      (path) =>
        path.length > 0
        && path !== '..'
        && !path.startsWith(`..${sep}`),
    )
    .map((path) => path.split(sep).join('/'));
  const unexpectedStatus = status
    .split('\n')
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (!line.startsWith('?? ')) {
        return true;
      }
      const path = line.slice(3).replaceAll('\\', '/');
      return !allowedPaths.some(
        (allowedPath) =>
          path === allowedPath || path.startsWith(`${allowedPath}/`),
      );
    });
  if (unexpectedStatus.length !== 0) {
    throw new Error(
      'Release checkout must equal the exact #40-authorized release commit and tree',
    );
  }
  const issue = runGitHubApi(
    execute,
    'repos/OpenCoven/sdk/issues/40',
    env,
  );
  if (
    !isRecord(issue)
    || issue.number !== 40
    || issue.state !== 'closed'
    || issue.state_reason !== 'completed'
    || issue.locked !== true
  ) {
    throw new Error(
      'OpenCoven/sdk#40 must be closed, completed, and locked before publication',
    );
  }
  const comment = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/issues/comments/${commentId}`,
    env,
  );
  if (
    !isRecord(comment)
    || comment.id !== Number(commentId)
    || comment.issue_url
      !== 'https://api.github.com/repos/OpenCoven/sdk/issues/40'
    || typeof comment.body !== 'string'
    || comment.created_at !== comment.updated_at
    || comment.author_association
      !== config.protectedApproval.reviewer.authorAssociation
    || !isRecord(comment.user)
    || comment.user.id !== config.protectedApproval.reviewer.id
    || comment.user.type !== 'User'
    || typeof comment.user.login !== 'string'
    || comment.user.login.length === 0
  ) {
    throw new Error(
      'GitHub security review comment does not match the immutable reviewer identity',
    );
  }
  const permission = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/collaborators/${encodeURIComponent(comment.user.login)}/permission`,
    env,
  );
  if (
    !isRecord(permission)
    || permission.permission !== config.protectedApproval.reviewer.permission
    || permission.role_name !== config.protectedApproval.reviewer.roleName
    || !isRecord(permission.user)
    || permission.user.id !== config.protectedApproval.reviewer.id
    || permission.user.login !== comment.user.login
    || permission.user.type !== 'User'
  ) {
    throw new Error(
      'GitHub security review reviewer does not have the exact required repository role',
    );
  }
  const authorization = parseAuthorizationBody(comment.body);
  if (
    authorization.source.commit !== checkout.commit
    || authorization.source.tree !== checkout.tree
  ) {
    throw new Error(
      'Release checkout must equal the exact #40-authorized release commit and tree',
    );
  }
  if (
    authorization.provenance.workflow
      !== config.publicationCandidate.workflow
    || authorization.provenance.job !== config.publicationCandidate.job
    || authorization.attestation.job
      !== config.publicationCandidate.attestationJob
    || authorization.provenance.environment
      !== config.publicationCandidate.environment
    || authorization.toolchain.npmVersion !== config.npmCliVersion
    || authorization.reviewer.id
      !== config.protectedApproval.reviewer.id
    || authorization.reviewer.authorAssociation
      !== config.protectedApproval.reviewer.authorAssociation
    || authorization.reviewer.permission
      !== config.protectedApproval.reviewer.permission
    || authorization.reviewer.roleName
      !== config.protectedApproval.reviewer.roleName
  ) {
    throw new Error(
      'GitHub security review authorization does not match release.config.json',
    );
  }
  const run = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${authorization.provenance.runId}`,
    env,
  );
  expectAuthorizedRun(run, authorization);
  const jobs = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${authorization.provenance.runId}/attempts/${authorization.provenance.runAttempt}/jobs?per_page=100`,
    env,
  );
  if (!isRecord(jobs) || !Array.isArray(jobs.jobs)) {
    throw new Error(
      'GitHub security review does not bind the candidate workflow job graph',
    );
  }
  const candidateJobs = jobs.jobs.filter(
    (job) =>
      isRecord(job)
      && job.id === Number(authorization.provenance.jobId),
  );
  const attestationJobs = jobs.jobs.filter(
    (job) =>
      isRecord(job)
      && job.id === Number(authorization.attestation.jobId),
  );
  if (candidateJobs.length !== 1 || attestationJobs.length !== 1) {
    throw new Error(
      'GitHub security review does not bind the candidate workflow job graph',
    );
  }
  const candidateJob = expectAuthorizedJob(
    candidateJobs[0],
    authorization,
    {
      id: authorization.provenance.jobId,
      name: authorization.provenance.job,
      label: 'candidate-producing',
    },
  );
  const attestationJob = expectAuthorizedJob(
    attestationJobs[0],
    authorization,
    {
      id: authorization.attestation.jobId,
      name: authorization.attestation.job,
      label: 'candidate-attestation',
    },
  );
  if (
    Date.parse(attestationJob.startedAt)
      < Date.parse(candidateJob.completedAt)
  ) {
    throw new Error(
      'GitHub security review candidate attestation job must start after the candidate producer completes',
    );
  }
  const environment = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/environments/${encodeURIComponent(authorization.provenance.environment)}`,
    env,
  );
  expectAuthorizedEnvironment(environment, authorization);
  const deployment = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/deployments/${authorization.provenance.deploymentId}`,
    env,
  );
  expectAuthorizedDeployment(deployment, authorization);
  const deploymentStatuses = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/deployments/${authorization.provenance.deploymentId}/statuses?per_page=100`,
    env,
  );
  expectAuthorizedDeploymentStatuses(deploymentStatuses, authorization);
  const artifact = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/artifacts/${authorization.artifact.id}`,
    env,
  );
  expectAuthorizedArtifact(
    artifact,
    authorization,
    {
      id: authorization.artifact.id,
      name: authorization.artifact.name,
      digest: authorization.artifact.digest,
    },
    'publication',
  );
  const artifacts = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${authorization.provenance.runId}/artifacts?name=${encodeURIComponent(authorization.artifact.name)}&per_page=100`,
    env,
  );
  if (
    !isRecord(artifacts)
    || artifacts.total_count !== 1
    || !Array.isArray(artifacts.artifacts)
    || artifacts.artifacts.length !== 1
  ) {
    throw new Error(
      'GitHub security review artifact name is not unique in the candidate run',
    );
  }
  expectAuthorizedArtifact(
    artifacts.artifacts[0],
    authorization,
    {
      id: authorization.artifact.id,
      name: authorization.artifact.name,
      digest: authorization.artifact.digest,
    },
    'publication',
  );
  const attestationBundleArtifact = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/artifacts/${authorization.attestation.bundle.artifactId}`,
    env,
  );
  expectAuthorizedArtifact(
    attestationBundleArtifact,
    authorization,
    {
      id: authorization.attestation.bundle.artifactId,
      name: authorization.attestation.bundle.artifactName,
      digest: authorization.attestation.bundle.artifactDigest,
    },
    'candidate attestation bundle',
  );
  const attestationBundleArtifacts = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${authorization.provenance.runId}/artifacts?name=${encodeURIComponent(authorization.attestation.bundle.artifactName)}&per_page=100`,
    env,
  );
  if (
    !isRecord(attestationBundleArtifacts)
    || attestationBundleArtifacts.total_count !== 1
    || !Array.isArray(attestationBundleArtifacts.artifacts)
    || attestationBundleArtifacts.artifacts.length !== 1
  ) {
    throw new Error(
      'GitHub security review attestation bundle name is not unique in the candidate run',
    );
  }
  expectAuthorizedArtifact(
    attestationBundleArtifacts.artifacts[0],
    authorization,
    {
      id: authorization.attestation.bundle.artifactId,
      name: authorization.attestation.bundle.artifactName,
      digest: authorization.attestation.bundle.artifactDigest,
    },
    'candidate attestation bundle',
  );
  return {
    ...authorization,
    commentId,
    reviewer: {
      ...authorization.reviewer,
      login: comment.user.login,
    },
  };
}

export function verifyPublicationSecurityReview({
  root = process.cwd(),
  artifactRoot,
  attestationRoot,
  commentId,
  allowedArtifactRoots,
  execute = execFileSync,
  env = process.env,
} = {}) {
  const authorization = resolvePublicationSecurityReview({
    root,
    commentId,
    allowedArtifactRoot: artifactRoot,
    allowedArtifactRoots: [
      attestationRoot,
      ...(Array.isArray(allowedArtifactRoots) ? allowedArtifactRoots : []),
    ],
    execute,
    env,
  });
  const manifest = verifyPublicationArtifacts({
    root,
    artifactRoot,
    version: authorization.version,
    expectedProvenance: {
      repository: authorization.provenance.repository,
      workflow: authorization.provenance.workflow,
      workflowCommit: authorization.provenance.workflowCommit,
      sourceRef: authorization.provenance.sourceRef,
      runId: authorization.provenance.runId,
      runAttempt: authorization.provenance.runAttempt,
      job: authorization.provenance.job,
      environment: authorization.provenance.environment,
      artifactName: authorization.artifact.name,
    },
  });
  const attestationBundlePath = readCandidateAttestationBundle(
    attestationRoot,
    authorization,
  );
  const manifestText = readFileSync(
    resolve(artifactRoot, 'release-manifest.json'),
    'utf8',
  );
  if (
    authorization.manifest.size !== Buffer.byteLength(manifestText, 'utf8')
    || authorization.manifest.sha256 !== sha256(manifestText)
  ) {
    throw new Error(
      'GitHub security review raw publication manifest digest does not match the downloaded bytes',
    );
  }
  for (const subject of [
    {
      path: resolve(artifactRoot, 'release-manifest.json'),
      sha256: authorization.manifest.sha256,
    },
    {
      path: resolve(
        artifactRoot,
        authorization.source.runtimeManifest.file,
      ),
      sha256: authorization.source.runtimeManifest.sha256,
    },
    ...authorization.packages.map((entry) => ({
      path: resolve(artifactRoot, entry.file),
      sha256: entry.sha256,
    })),
  ]) {
    verifyCandidateAttestation(
      execute,
      subject.path,
      subject.sha256,
      authorization,
      attestationBundlePath,
      env,
    );
  }
  const expected = createPublicationAuthorizationRecord({
    artifactId: authorization.artifact.id,
    artifactDigest: authorization.artifact.digest,
    attestationJobId: authorization.attestation.jobId,
    attestationBundle: {
      artifactId: authorization.attestation.bundle.artifactId,
      artifactDigest: authorization.attestation.bundle.artifactDigest,
      file: authorization.attestation.bundle.file,
      size: authorization.attestation.bundle.size,
      sha256: authorization.attestation.bundle.sha256,
    },
    deploymentId: authorization.provenance.deploymentId,
    environmentId: authorization.provenance.environmentId,
    jobId: authorization.provenance.jobId,
    manifest,
    manifestText,
  });
  const actualBody = {
    schemaVersion: authorization.schemaVersion,
    kind: authorization.kind,
    issue: authorization.issue,
    disposition: authorization.disposition,
    reviewer: {
      id: authorization.reviewer.id,
      authorAssociation: authorization.reviewer.authorAssociation,
      permission: authorization.reviewer.permission,
      roleName: authorization.reviewer.roleName,
    },
    version: authorization.version,
    source: authorization.source,
    manifest: authorization.manifest,
    packages: authorization.packages,
    toolchain: authorization.toolchain,
    publisher: authorization.publisher,
    provenance: authorization.provenance,
    artifact: authorization.artifact,
    attestation: authorization.attestation,
  };
  if (serializeCanonicalJson(actualBody) !== serializeCanonicalJson(expected)) {
    throw new Error(
      'GitHub security review does not authorize the exact publication candidate bytes',
    );
  }
  return { authorization, manifest };
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const key =
      argument === '--comment-id'
        ? 'commentId'
        : argument === '--artifact-root'
          ? 'artifactRoot'
          : argument === '--attestation-root'
            ? 'attestationRoot'
          : argument === '--github-output'
            ? 'githubOutput'
            : undefined;
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
  options.commentId ??= process.env.OPENCOVEN_SECURITY_REVIEW_COMMENT_ID;
  return options;
}

export function main(arguments_ = process.argv.slice(2)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const options = parseArguments(arguments_);
  const result = options.artifactRoot === undefined
    ? resolvePublicationSecurityReview({
        root,
        commentId: options.commentId,
      })
    : verifyPublicationSecurityReview({
        root,
        artifactRoot: options.artifactRoot,
        attestationRoot: options.attestationRoot,
        commentId: options.commentId,
      }).authorization;
  if (options.githubOutput !== undefined) {
    appendFileSync(
      options.githubOutput,
      [
        `run-id=${result.provenance.runId}`,
        `artifact-name=${result.artifact.name}`,
        `artifact-id=${result.artifact.id}`,
        `attestation-bundle-artifact-id=${result.attestation.bundle.artifactId}`,
        '',
      ].join('\n'),
      { encoding: 'utf8' },
    );
  }
  process.stdout.write(`${serializeCanonicalJson(result)}`);
  return result;
}

if (
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
