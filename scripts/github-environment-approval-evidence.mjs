#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { devNull } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPendingApprovalEvidence,
  createProtectedApprovalReceipt,
  createEnvironmentRulesDigest,
  parsePendingApprovalEvidence,
  parseCanonicalJson,
  parseProtectedApprovalReceipt,
  serializeCanonicalJson,
  serializePendingApprovalEvidence,
  serializeProtectedApprovalReceipt,
} from './github-environment-approval.mjs';
import {
  inspectReleaseRepository,
  readReleaseConfig,
  validateReleaseWorkflow,
} from './release-readiness.mjs';
import {
  resolveAuthenticatedReleaseRuntime,
} from './release-runtime-integrity.mjs';

const PENDING_APPROVAL_FILE = 'pending-approval.json';
const PROTECTED_APPROVAL_FILE = 'protected-approval.json';
const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;
const MAX_ATTEMPTS = 60;
const RETRY_DELAY_MS = 5_000;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function timestampSecond(value) {
  return Math.floor(Date.parse(value) / 1_000);
}

function apiEnvironment(env) {
  const result = {
    PATH: '/usr/bin:/bin',
    HOME: env.HOME ?? env.RUNNER_TEMP ?? '/tmp',
    TMPDIR: env.TMPDIR ?? env.RUNNER_TEMP ?? '/tmp',
    GH_HOST: 'github.com',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0) {
    result.GH_TOKEN = env.GH_TOKEN;
  }
  return result;
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
        env: apiEnvironment(env),
        maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    ),
    endpoint,
  );
}

function expectedApproval(config) {
  return {
    environment: config.protectedApproval.environment,
    environmentId: config.protectedApproval.environmentId,
    reviewer: { ...config.protectedApproval.reviewer },
    witnessJob: config.protectedApproval.witnessJob,
    witnessAttestationJob:
      config.protectedApproval.witnessAttestationJob,
    approvalJob: config.protectedApproval.approvalJob,
    approvalAttestationJob:
      config.protectedApproval.approvalAttestationJob,
    publishJob: config.protectedApproval.publishJob,
  };
}

function workflowContext(root, env) {
  const checkout = inspectReleaseRepository(root);
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (
    env.GITHUB_REPOSITORY !== 'OpenCoven/sdk'
    || env.GITHUB_SHA !== checkout.commit
    || env.GITHUB_WORKFLOW_SHA !== checkout.commit
    || env.GITHUB_WORKFLOW_REF
      !== 'OpenCoven/sdk/.github/workflows/release.yml@refs/heads/main'
    || env.GITHUB_REF !== 'refs/heads/main'
    || typeof env.GITHUB_RUN_ID !== 'string'
    || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ID)
    || !Number.isSafeInteger(runAttempt)
    || runAttempt < 1
  ) {
    throw new Error(
      'Protected environment approval evidence requires the exact release workflow run',
    );
  }
  return {
    source: {
      repository: 'OpenCoven/sdk',
      commit: checkout.commit,
      tree: checkout.tree,
    },
    workflow: {
      path: '.github/workflows/release.yml',
      commit: checkout.commit,
      ref: 'refs/heads/main',
      runId: env.GITHUB_RUN_ID,
      runAttempt,
    },
  };
}

function getRun(execute, context, env) {
  const run = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${context.workflow.runId}`,
    env,
  );
  if (
    !isRecord(run)
    || run.id !== Number(context.workflow.runId)
    || run.run_attempt !== context.workflow.runAttempt
    || run.event !== 'workflow_dispatch'
    || run.head_sha !== context.source.commit
    || run.head_branch !== 'main'
    || run.path !== context.workflow.path
    || !isRecord(run.repository)
    || run.repository.full_name !== 'OpenCoven/sdk'
    || !isRecord(run.head_repository)
    || run.head_repository.full_name !== 'OpenCoven/sdk'
  ) {
    throw new Error(
      'Protected environment approval evidence does not match the exact workflow run',
    );
  }
  return run;
}

function getRunJobs(execute, context, env) {
  const jobs = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${context.workflow.runId}/attempts/${context.workflow.runAttempt}/jobs?per_page=100`,
    env,
  );
  if (!isRecord(jobs) || !Array.isArray(jobs.jobs)) {
    throw new Error('Protected environment approval workflow jobs are invalid');
  }
  return jobs.jobs;
}

function isValidTimestamp(value) {
  return (
    typeof value === 'string'
    && Number.isFinite(Date.parse(value))
  );
}

function findExactJob(
  jobs,
  context,
  name,
  statuses,
  { requireStartedAt = true } = {},
) {
  const matches = jobs.filter(
    (job) =>
      isRecord(job)
      && job.name === name
      && job.run_id === Number(context.workflow.runId)
      && job.run_attempt === context.workflow.runAttempt
      && job.head_sha === context.source.commit
      && (!requireStartedAt || isValidTimestamp(job.started_at))
      && (
        job.status !== 'completed'
        || isValidTimestamp(job.completed_at)
      )
      && statuses.includes(job.status),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Protected environment approval requires exactly one ${name} job`,
    );
  }
  return {
    id: String(matches[0].id),
    name,
    startedAt: matches[0].started_at ?? null,
    completedAt: matches[0].completed_at,
    status: matches[0].status,
    conclusion: matches[0].conclusion,
  };
}

function getEnvironment(execute, environmentName, env) {
  return runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/environments/${encodeURIComponent(environmentName)}`,
    env,
  );
}

function getUniqueArtifact(execute, context, name, env) {
  const response = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/runs/${context.workflow.runId}/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
    env,
  );
  if (
    !isRecord(response)
    || response.total_count !== 1
    || !Array.isArray(response.artifacts)
    || response.artifacts.length !== 1
  ) {
    throw new Error(
      `Protected environment approval artifact ${name} must be unique`,
    );
  }
  const artifact = response.artifacts[0];
  if (
    !isRecord(artifact)
    || !Number.isSafeInteger(artifact.id)
    || artifact.id <= 0
    || artifact.name !== name
    || artifact.expired !== false
    || !isRecord(artifact.workflow_run)
    || artifact.workflow_run.id !== Number(context.workflow.runId)
    || artifact.workflow_run.head_sha !== context.source.commit
  ) {
    throw new Error(
      `Protected environment approval artifact ${name} is invalid`,
    );
  }
  return artifact;
}

function fileMetadata(path, file) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${file} must be a regular evidence file`);
  }
  const bytes = readFileSync(path);
  return {
    file,
    size: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function findApprovalDeployment(execute, context, approvalJob, expected, env) {
  const deployments = runGitHubApi(
    execute,
    [
      'repos/OpenCoven/sdk/deployments',
      `?sha=${context.source.commit}`,
      `&environment=${encodeURIComponent(expected.environment)}`,
      '&per_page=100',
    ].join(''),
    env,
  );
  if (!Array.isArray(deployments)) {
    throw new Error('Protected approval deployment response is invalid');
  }
  const jobUrl =
    `https://github.com/OpenCoven/sdk/actions/runs/${context.workflow.runId}`
    + `/job/${approvalJob.id}`;
  const matches = deployments.filter((deployment) => {
    if (
      !isRecord(deployment)
      || deployment.sha !== context.source.commit
      || deployment.environment !== expected.environment
      || !Number.isSafeInteger(deployment.id)
    ) {
      return false;
    }
    const statuses = runGitHubApi(
      execute,
      `repos/OpenCoven/sdk/deployments/${deployment.id}/statuses?per_page=100`,
      env,
    );
    return (
      Array.isArray(statuses)
      && statuses.some(
        (status) =>
          isRecord(status)
          && status.environment === expected.environment
          && status.log_url === jobUrl
          && status.target_url === jobUrl,
      )
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      'Protected approval receipt must bind the exact approval job deployment',
    );
  }
  return matches[0];
}

function verifyAttestation(execute, path, expectedSha256, context, env) {
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
      context.source.commit,
      '--source-digest',
      context.source.commit,
      '--source-ref',
      'refs/heads/main',
      '--predicate-type',
      'https://slsa.dev/provenance/v1',
      '--deny-self-hosted-runners',
      '--format',
      'json',
      '--hostname',
      'github.com',
    ],
    {
      encoding: 'utf8',
      env: apiEnvironment(env),
      maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      killSignal: 'SIGKILL',
    },
  );
  const entries = parseGitHubJson(output, `${path} GitHub attestation`);
  const invocation =
    `https://github.com/OpenCoven/sdk/actions/runs/${context.workflow.runId}`
    + `/attempts/${context.workflow.runAttempt}`;
  if (
    !Array.isArray(entries)
    || !entries.some((entry) => {
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
        && certificate.sourceRepositoryDigest === context.source.commit
        && certificate.sourceRepositoryRef === 'refs/heads/main'
        && certificate.buildSignerDigest === context.source.commit
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
      'Protected environment approval evidence is not attested by the exact workflow run',
    );
  }
}

function writeEvidence(outputRoot, file, text) {
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const path = resolve(outputRoot, file);
  writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
  return path;
}

export function capturePendingApprovalEvidence({
  root = process.cwd(),
  outputRoot,
  env = process.env,
  execute = execFileSync,
  resolveRuntime = resolveAuthenticatedReleaseRuntime,
  now = () => new Date(),
  sleep = (milliseconds) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
} = {}) {
  resolveRuntime({ env });
  const config = readReleaseConfig(root);
  validateReleaseWorkflow(root, config);
  const expected = expectedApproval(config);
  const context = workflowContext(root, env);
  getRun(execute, context, env);
  const jobs = getRunJobs(execute, context, env);
  const witnessJob = findExactJob(
    jobs,
    context,
    expected.witnessJob,
    ['in_progress', 'completed'],
  );
  let pendingDeployments = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    pendingDeployments = runGitHubApi(
      execute,
      `repos/OpenCoven/sdk/actions/runs/${context.workflow.runId}/pending_deployments`,
      env,
    );
    if (
      Array.isArray(pendingDeployments)
      && pendingDeployments.some(
        (entry) =>
          isRecord(entry)
          && isRecord(entry.environment)
          && String(entry.environment.id) === expected.environmentId
          && entry.environment.name === expected.environment,
      )
    ) {
      break;
    }
    if (attempt + 1 < MAX_ATTEMPTS) {
      sleep(RETRY_DELAY_MS);
    }
  }
  const environment = getEnvironment(execute, expected.environment, env);
  const evidence = createPendingApprovalEvidence({
    source: context.source,
    workflow: context.workflow,
    witnessJob,
    environment,
    pendingDeployments,
    observedAt: now().toISOString(),
    expected,
  });
  const text = serializePendingApprovalEvidence(evidence);
  const path = writeEvidence(outputRoot, PENDING_APPROVAL_FILE, text);
  return {
    evidence,
    path,
    text,
  };
}

export function captureProtectedApprovalReceipt({
  root = process.cwd(),
  pendingRoot,
  securityReviewPath,
  outputRoot,
  env = process.env,
  execute = execFileSync,
  now = () => new Date(),
  publishJobId = process.env.PUBLISH_JOB_ID,
} = {}) {
  resolveAuthenticatedReleaseRuntime({ env });
  const config = readReleaseConfig(root);
  validateReleaseWorkflow(root, config);
  const expected = expectedApproval(config);
  const context = workflowContext(root, env);
  getRun(execute, context, env);
  const jobs = getRunJobs(execute, context, env);
  const approvalJob = findExactJob(
    jobs,
    context,
    expected.approvalJob,
    ['in_progress', 'completed'],
  );
  const publishJob = findExactJob(
    jobs,
    context,
    expected.publishJob,
    ['queued', 'waiting', 'pending', 'in_progress'],
    { requireStartedAt: false },
  );
  if (
    typeof publishJobId !== 'string'
    || publishJob.id !== publishJobId
  ) {
    throw new Error(
      'Protected approval receipt must bind the exact final publishing job',
    );
  }
  const pendingPath = resolve(pendingRoot, PENDING_APPROVAL_FILE);
  const pendingText = readFileSync(pendingPath, 'utf8');
  const pendingEvidence = parsePendingApprovalEvidence(
    pendingText,
    PENDING_APPROVAL_FILE,
  );
  if (
    serializePendingApprovalEvidence(pendingEvidence)
      !== serializePendingApprovalEvidence({
        ...pendingEvidence,
        source: context.source,
        workflow: context.workflow,
      })
  ) {
    throw new Error(
      'Pending protected-environment approval evidence does not match the current run',
    );
  }
  const witnessJob = findExactJob(
    jobs,
    context,
    expected.witnessJob,
    ['completed'],
  );
  const witnessAttestationJob = findExactJob(
    jobs,
    context,
    expected.witnessAttestationJob,
    ['completed'],
  );
  if (
    witnessJob.id !== pendingEvidence.witnessJob.id
    || witnessJob.conclusion !== 'success'
    || witnessAttestationJob.conclusion !== 'success'
    || typeof witnessJob.completedAt !== 'string'
    || Date.parse(witnessAttestationJob.startedAt)
      < Date.parse(witnessJob.completedAt)
  ) {
    throw new Error(
      'Pending protected-environment approval witness did not complete successfully',
    );
  }
  const pendingArtifactName =
    `opencoven-sdk-pending-approval-${context.workflow.runId}`
    + `-${context.workflow.runAttempt}`;
  const pendingArtifact = getUniqueArtifact(
    execute,
    context,
    pendingArtifactName,
    env,
  );
  const pendingArtifactDetails = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/actions/artifacts/${pendingArtifact.id}`,
    env,
  );
  if (
    !isRecord(pendingArtifactDetails)
    || pendingArtifactDetails.id !== pendingArtifact.id
    || pendingArtifactDetails.name !== pendingArtifact.name
    || pendingArtifactDetails.expired !== false
    || !isRecord(pendingArtifactDetails.workflow_run)
    || pendingArtifactDetails.workflow_run.id
      !== Number(context.workflow.runId)
    || pendingArtifactDetails.workflow_run.head_sha
      !== context.source.commit
  ) {
    throw new Error(
      'Pending protected-environment approval artifact is invalid',
    );
  }
  const pendingMetadata = fileMetadata(
    pendingPath,
    PENDING_APPROVAL_FILE,
  );
  verifyAttestation(
    execute,
    pendingPath,
    pendingMetadata.sha256,
    context,
    env,
  );
  const environment = getEnvironment(execute, expected.environment, env);
  const deployment = findApprovalDeployment(
    execute,
    context,
    approvalJob,
    expected,
    env,
  );
  const securityReview = parseCanonicalJson(
    readFileSync(securityReviewPath, 'utf8'),
    'publication security review',
  );
  if (
    securityReview.source?.commit !== context.source.commit
    || securityReview.source?.tree !== context.source.tree
  ) {
    throw new Error(
      'Protected approval receipt security review must authorize the exact release source',
    );
  }
  const receipt = createProtectedApprovalReceipt({
    pendingEvidence,
    pendingEvidenceFile: {
      ...pendingMetadata,
      artifactId: String(pendingArtifact.id),
      artifactName: pendingArtifact.name,
    },
    approvalJob,
    publishJob: {
      id: publishJob.id,
      name: publishJob.name,
    },
    deployment,
    environment,
    securityReview: {
      commentId: securityReview.commentId,
      tag: securityReview.tag,
      reviewer: securityReview.reviewer,
    },
    createdAt: now().toISOString(),
    expected,
  });
  const text = serializeProtectedApprovalReceipt(receipt);
  const path = writeEvidence(outputRoot, PROTECTED_APPROVAL_FILE, text);
  return {
    receipt,
    path,
    text,
  };
}

export function verifyProtectedApprovalArtifacts({
  root = process.cwd(),
  pendingRoot,
  approvalRoot,
  securityReview,
  env = process.env,
  execute = execFileSync,
} = {}) {
  if (
    typeof pendingRoot !== 'string'
    || pendingRoot.length === 0
    || typeof approvalRoot !== 'string'
    || approvalRoot.length === 0
  ) {
    throw new Error(
      'Publication requires attested protected-environment approval evidence',
    );
  }
  const config = readReleaseConfig(root);
  validateReleaseWorkflow(root, config);
  const expected = expectedApproval(config);
  const context = workflowContext(root, env);
  const pendingPath = resolve(pendingRoot, PENDING_APPROVAL_FILE);
  const approvalPath = resolve(approvalRoot, PROTECTED_APPROVAL_FILE);
  const pendingText = readFileSync(pendingPath, 'utf8');
  const approvalText = readFileSync(approvalPath, 'utf8');
  const pendingEvidence = parsePendingApprovalEvidence(
    pendingText,
    PENDING_APPROVAL_FILE,
  );
  const receipt = parseProtectedApprovalReceipt(
    approvalText,
    PROTECTED_APPROVAL_FILE,
  );
  if (
    serializePendingApprovalEvidence(pendingEvidence)
      !== serializePendingApprovalEvidence({
        ...pendingEvidence,
        source: context.source,
        workflow: context.workflow,
      })
    || serializeProtectedApprovalReceipt(receipt)
      !== serializeProtectedApprovalReceipt({
        ...receipt,
        source: context.source,
        workflow: context.workflow,
      })
    || pendingEvidence.environment.id !== expected.environmentId
    || pendingEvidence.environment.name !== expected.environment
    || receipt.environment.id !== expected.environmentId
    || receipt.environment.name !== expected.environment
    || env.PUBLISH_JOB_ID !== receipt.publishJob.id
  ) {
    throw new Error(
      'Protected environment approval evidence does not match the current publish run',
    );
  }
  const pendingMetadata = fileMetadata(
    pendingPath,
    PENDING_APPROVAL_FILE,
  );
  if (
    receipt.pendingEvidence.file !== pendingMetadata.file
    || receipt.pendingEvidence.size !== pendingMetadata.size
    || receipt.pendingEvidence.sha256 !== pendingMetadata.sha256
  ) {
    throw new Error(
      'Protected approval receipt does not bind the exact pending evidence bytes',
    );
  }
  if (
    !isRecord(securityReview)
    || receipt.securityReview.commentId !== securityReview.commentId
    || serializeCanonicalJson(receipt.securityReview.tag)
      !== serializeCanonicalJson(securityReview.tag)
    || receipt.securityReview.reviewer.id
      !== config.protectedApproval.reviewer.id
    || receipt.securityReview.reviewer.id !== securityReview.reviewer?.id
    || receipt.securityReview.reviewer.authorAssociation
      !== config.protectedApproval.reviewer.authorAssociation
    || receipt.securityReview.reviewer.permission
      !== config.protectedApproval.reviewer.permission
    || receipt.securityReview.reviewer.roleName
      !== config.protectedApproval.reviewer.roleName
  ) {
    throw new Error(
      'Protected approval receipt does not bind the exact immutable security reviewer',
    );
  }
  const run = getRun(execute, context, env);
  if (run.status !== 'in_progress') {
    throw new Error(
      'Protected environment approval evidence must be verified during the active publish run',
    );
  }
  const jobs = getRunJobs(execute, context, env);
  const witnessJob = findExactJob(
    jobs,
    context,
    expected.witnessJob,
    ['completed'],
  );
  const approvalJob = findExactJob(
    jobs,
    context,
    expected.approvalJob,
    ['completed'],
  );
  const witnessAttestationJob = findExactJob(
    jobs,
    context,
    expected.witnessAttestationJob,
    ['completed'],
  );
  const approvalAttestationJob = findExactJob(
    jobs,
    context,
    expected.approvalAttestationJob,
    ['completed'],
  );
  const publishJob = findExactJob(
    jobs,
    context,
    expected.publishJob,
    ['in_progress'],
  );
  if (
    witnessJob.id !== pendingEvidence.witnessJob.id
    || Date.parse(witnessJob.startedAt)
      !== Date.parse(pendingEvidence.witnessJob.startedAt)
    || witnessJob.conclusion !== 'success'
    || witnessAttestationJob.conclusion !== 'success'
    || typeof witnessJob.completedAt !== 'string'
    || Date.parse(witnessAttestationJob.startedAt)
      < Date.parse(witnessJob.completedAt)
    || approvalJob.id !== receipt.approvalJob.id
    || Date.parse(approvalJob.startedAt)
      !== Date.parse(receipt.approvalJob.startedAt)
    || approvalJob.conclusion !== 'success'
    || approvalAttestationJob.conclusion !== 'success'
    || typeof approvalJob.completedAt !== 'string'
    || Date.parse(approvalAttestationJob.startedAt)
      < Date.parse(approvalJob.completedAt)
    || publishJob.id !== receipt.publishJob.id
    || publishJob.name !== receipt.publishJob.name
    || timestampSecond(receipt.createdAt)
      > timestampSecond(approvalJob.completedAt)
    || typeof approvalAttestationJob.completedAt !== 'string'
    || Date.parse(approvalAttestationJob.completedAt)
      > Date.parse(publishJob.startedAt)
  ) {
    throw new Error(
      'Protected environment approval evidence jobs did not complete successfully',
    );
  }
  const environment = getEnvironment(execute, expected.environment, env);
  const rulesDigest = createEnvironmentRulesDigest({
    environment,
    expected,
  });
  if (
    rulesDigest !== pendingEvidence.rulesDigest
    || rulesDigest !== receipt.rulesDigest
  ) {
    throw new Error(
      'Protected environment rules changed after the pending approval witness',
    );
  }
  const deployment = runGitHubApi(
    execute,
    `repos/OpenCoven/sdk/deployments/${receipt.deployment.id}`,
    env,
  );
  if (
    !isRecord(deployment)
    || deployment.sha !== receipt.deployment.sha
    || deployment.ref !== receipt.deployment.ref
    || deployment.environment !== receipt.deployment.environment
    || deployment.task !== receipt.deployment.task
    || deployment.transient_environment
      !== receipt.deployment.transient_environment
    || deployment.performed_via_github_app?.slug !== 'github-actions'
    || typeof deployment.created_at !== 'string'
    || new Date(deployment.created_at).toISOString()
      !== receipt.deployment.created_at
  ) {
    throw new Error(
      'Protected approval receipt deployment no longer matches GitHub',
    );
  }
  const pendingArtifact = getUniqueArtifact(
    execute,
    context,
    receipt.pendingEvidence.artifactName,
    env,
  );
  if (String(pendingArtifact.id) !== receipt.pendingEvidence.artifactId) {
    throw new Error(
      'Protected approval receipt does not bind the exact pending evidence artifact',
    );
  }
  const approvalArtifactName =
    `opencoven-sdk-protected-approval-${context.workflow.runId}`
    + `-${context.workflow.runAttempt}`;
  getUniqueArtifact(execute, context, approvalArtifactName, env);
  verifyAttestation(
    execute,
    pendingPath,
    pendingMetadata.sha256,
    context,
    env,
  );
  verifyAttestation(
    execute,
    approvalPath,
    sha256(approvalText),
    context,
    env,
  );
  return receipt;
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const key =
      argument === '--mode'
        ? 'mode'
        : argument === '--output'
          ? 'outputRoot'
          : argument === '--pending-root'
            ? 'pendingRoot'
            : argument === '--approval-root'
              ? 'approvalRoot'
              : argument === '--security-review'
                ? 'securityReviewPath'
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
  return options;
}

export function main(arguments_ = process.argv.slice(2)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const options = parseArguments(arguments_);
  const result =
    options.mode === 'witness'
      ? capturePendingApprovalEvidence({
          root,
          outputRoot: options.outputRoot,
        })
      : options.mode === 'receipt'
        ? captureProtectedApprovalReceipt({
            root,
            pendingRoot: options.pendingRoot,
            securityReviewPath: options.securityReviewPath,
            outputRoot: options.outputRoot,
          })
        : options.mode === 'verify'
          ? verifyProtectedApprovalArtifacts({
              root,
              pendingRoot: options.pendingRoot,
              approvalRoot: options.approvalRoot,
              securityReview: parseGitHubJson(
                readFileSync(options.securityReviewPath, 'utf8'),
                'publication security review',
              ),
            })
          : (() => {
              throw new Error('Mode must be witness, receipt, or verify');
            })();
  if (options.githubOutput !== undefined && result?.path !== undefined) {
    appendFileSync(
      options.githubOutput,
      `path=${result.path}\n`,
      { encoding: 'utf8' },
    );
  }
  process.stdout.write(
    `${JSON.stringify(result.receipt ?? result.evidence ?? result)}\n`,
  );
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
