import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  aggregateConformanceEvidence,
  assertEvidenceProducerCompatibility,
  parseFrozenConformanceLock,
  parsePlatformEvidence,
  parseReviewedEvidenceIndex,
  serializeCanonicalJson,
  validateFrozenConformanceBindings,
} from './conformance-contract.mjs';
import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';

const MAX_GITHUB_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ATTESTATION_BUNDLE_BYTES = 16 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function runGh(execute, args, { cwd = process.cwd(), env = process.env } = {}) {
  return execute('gh', args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
}

function expectedBranch(sourceRef) {
  const prefix = 'refs/heads/';
  if (!sourceRef.startsWith(prefix)) {
    throw new Error('Frozen Chat producer sourceRef must name a branch');
  }
  return sourceRef.slice(prefix.length);
}

function workflowLine(line) {
  return line.replace(/\s+#.*$/u, '').replace(/\s+$/u, '');
}

function exactWorkflowLineCount(lines, expected) {
  return lines.filter((line) => workflowLine(line) === expected).length;
}

function extractWorkflowJobs(lines) {
  const jobsIndexes = lines
    .map((line, index) => (workflowLine(line) === 'jobs:' ? index : -1))
    .filter((index) => index >= 0);
  if (jobsIndexes.length !== 1) {
    throw new Error('Frozen Chat workflow must define one exact jobs graph');
  }
  const jobsIndex = jobsIndexes[0];
  const markers = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = workflowLine(lines[index]);
    if (line.length === 0) {
      continue;
    }
    if (/^\S/u.test(line)) {
      throw new Error(
        'Frozen Chat evidence workflow must be dedicated to its exact jobs graph',
      );
    }
    const marker = /^ {2}([a-z0-9][a-z0-9_-]*):$/u.exec(line);
    if (marker !== null) {
      markers.push({ id: marker[1], index });
      continue;
    }
    if (/^ {2}\S/u.test(line)) {
      throw new Error('Frozen Chat workflow contains a non-canonical job key');
    }
  }
  const jobs = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const end = markers[index + 1]?.index ?? lines.length;
    if (jobs.has(marker.id)) {
      throw new Error('Frozen Chat workflow contains a duplicate job key');
    }
    jobs.set(marker.id, {
      id: marker.id,
      start: marker.index,
      end,
      lines: lines.slice(marker.index, end),
    });
  }
  return jobs;
}

function actionStepLines(job, action) {
  const pattern = new RegExp(
    `^ {6}- uses: ${action.replace('/', '\\/')}@[0-9a-f]{40}$`,
    'u',
  );
  const indexes = job.lines
    .map((line, index) =>
      pattern.test(workflowLine(line)) ? index : -1,
    )
    .filter((index) => index >= 0);
  if (indexes.length !== 1) {
    throw new Error(
      `Frozen Chat protected evidence job must use ${action} exactly once`,
    );
  }
  const start = indexes[0];
  let end = job.lines.length;
  for (let index = start + 1; index < job.lines.length; index += 1) {
    if (/^ {6}-\s/u.test(workflowLine(job.lines[index]))) {
      end = index;
      break;
    }
  }
  return job.lines.slice(start, end);
}

function verifyProtectedWorkflow(text, producer) {
  if (
    typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error('Frozen Chat workflow response is not bounded UTF-8 text');
  }
  const workflowBytes = Buffer.from(text, 'utf8');
  if (
    workflowBytes.byteLength !== producer.workflow.size
    || sha256(workflowBytes) !== producer.workflow.sha256
  ) {
    throw new Error(
      'Frozen Chat workflow bytes do not match the reviewed workflow digest',
    );
  }
  if (text.includes('\r') || text.includes('\t')) {
    throw new Error('Frozen Chat workflow must use canonical LF YAML indentation');
  }
  const lines = text.split('\n');
  if (
    exactWorkflowLineCount(lines, `name: ${producer.workflow.name}`) !== 1
  ) {
    throw new Error('Frozen Chat workflow name does not match the frozen identity');
  }
  const jobs = extractWorkflowJobs(lines);
  const protectedJob = jobs.get(producer.workflow.job);
  const aggregationJob = jobs.get(producer.workflow.aggregationJob);
  if (protectedJob === undefined) {
    throw new Error(
      'Frozen Chat workflow does not define the protected evidence job',
    );
  }
  if (aggregationJob === undefined) {
    throw new Error(
      'Frozen Chat workflow does not define the non-artifact aggregation job',
    );
  }

  const restrictedActions = [
    'actions/upload-artifact',
    'actions/attest-build-provenance',
  ];
  for (const job of jobs.values()) {
    for (const line of job.lines) {
      const normalized = workflowLine(line);
      for (const action of restrictedActions) {
        if (
          normalized.includes(action)
          && (
            job.id !== producer.workflow.job
            || !new RegExp(
              `^ {6}- uses: ${action.replace('/', '\\/')}@[0-9a-f]{40}$`,
              'u',
            ).test(normalized)
          )
        ) {
          throw new Error(
            'Frozen Chat workflow requires that only the protected evidence job may upload or attest expected platform artifacts',
          );
        }
      }
    }
  }

  if (
    jobs.size !== 2
    || !jobs.has(producer.workflow.job)
    || !jobs.has(producer.workflow.aggregationJob)
  ) {
    throw new Error('Frozen Chat workflow does not match the exact frozen job graph');
  }

  const protectedLines = protectedJob.lines;
  if (
    exactWorkflowLineCount(
      protectedLines,
      `    name: ${producer.workflow.jobNameTemplate.replace(
        '{platform}',
        '${{ matrix.platform }}',
      )}`,
    ) !== 1
    || exactWorkflowLineCount(
      protectedLines,
      '    runs-on: ${{ matrix.runner }}',
    ) !== 1
    || exactWorkflowLineCount(
      protectedLines,
      `    environment: ${producer.workflow.environment}`,
    ) !== 1
  ) {
    throw new Error(
      'Frozen Chat workflow evidence job is not bound to the protected environment',
    );
  }

  const writePermissionLines = [
    '      attestations: write',
    '      id-token: write',
  ];
  for (const permissionLine of writePermissionLines) {
    if (exactWorkflowLineCount(protectedLines, permissionLine) !== 1) {
      throw new Error(
        'Frozen Chat protected evidence job lacks exact attestation permissions',
      );
    }
    for (const job of jobs.values()) {
      if (
        job.id !== producer.workflow.job
        && exactWorkflowLineCount(job.lines, permissionLine) !== 0
      ) {
        throw new Error(
          'Frozen Chat workflow grants artifact attestation authority outside the protected evidence job',
        );
      }
    }
  }
  const jobsStart = Math.min(...[...jobs.values()].map(({ start }) => start));
  if (
    lines.slice(0, jobsStart).some((line) =>
      writePermissionLines.includes(workflowLine(line)),
    )
  ) {
    throw new Error(
      'Frozen Chat workflow grants artifact attestation authority outside the protected evidence job',
    );
  }

  const matrixEntries = [];
  for (let index = 0; index < protectedLines.length; index += 1) {
    const match = /^ {10}- platform: ([a-z0-9-]+)$/u.exec(
      workflowLine(protectedLines[index]),
    );
    if (match === null) {
      continue;
    }
    const runnerMatch = /^ {12}runner: ([a-z0-9.-]+)$/u.exec(
      workflowLine(protectedLines[index + 1] ?? ''),
    );
    if (runnerMatch === null) {
      throw new Error(
        'Frozen Chat workflow matrix does not bind each platform to one runner',
      );
    }
    matrixEntries.push({
      platform: match[1],
      runner: runnerMatch[1],
    });
  }
  const expectedMatrix = producer.workflow.runnerLabels
    ? Object.entries(producer.workflow.runnerLabels).map(
        ([platform, labels]) => ({
          platform,
          runner: labels[0],
        }),
      )
    : [];
  if (JSON.stringify(matrixEntries) !== JSON.stringify(expectedMatrix)) {
    throw new Error(
      'Frozen Chat workflow matrix does not match the exact platform job graph',
    );
  }

  const artifactName = producer.workflow.artifactNameTemplate.replace(
    '{platform}',
    '${{ matrix.platform }}',
  );
  const recordPath = producer.workflow.recordPathTemplate.replace(
    '{platform}',
    '${{ matrix.platform }}',
  );
  const attestStep = actionStepLines(
    protectedJob,
    'actions/attest-build-provenance',
  );
  const uploadStep = actionStepLines(
    protectedJob,
    'actions/upload-artifact',
  );
  if (
    exactWorkflowLineCount(
      attestStep,
      `          subject-path: ${recordPath}`,
    ) !== 1
    || exactWorkflowLineCount(
      uploadStep,
      `          name: ${artifactName}`,
    ) !== 1
    || exactWorkflowLineCount(
      uploadStep,
      `          path: ${recordPath}`,
    ) !== 1
  ) {
    throw new Error(
      'Frozen Chat protected evidence job does not attest and upload the exact platform-derived record',
    );
  }

  const aggregationLines = aggregationJob.lines
    .map(workflowLine)
    .filter((line) => line.length > 0);
  const expectedAggregationLines = [
    `  ${producer.workflow.aggregationJob}:`,
    `    name: ${producer.workflow.aggregationJobName}`,
    `    needs: ${producer.workflow.job}`,
    `    runs-on: ${producer.workflow.aggregationRunnerLabels[0]}`,
    '    permissions: {}',
    '    steps:',
    '      - name: Confirm protected evidence matrix',
    '        run: echo "protected evidence matrix completed"',
  ];
  if (
    JSON.stringify(aggregationLines)
      !== JSON.stringify(expectedAggregationLines)
  ) {
    throw new Error(
      'Frozen Chat workflow must use the exact non-artifact aggregation job',
    );
  }
}

function expectSuccessfulRun(value, expected, label) {
  if (
    !isRecord(value)
    || value.id !== Number(expected.runId)
    || value.name !== expected.producer.workflow.name
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.head_branch !== expectedBranch(expected.producer.workflow.sourceRef)
    || value.path !== expected.producer.workflow.path
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !isRecord(value.repository)
    || value.repository.full_name !== expected.producer.repository
    || !isRecord(value.head_repository)
    || value.head_repository.full_name !== expected.producer.repository
  ) {
    throw new Error(`${label} does not match the frozen successful workflow run`);
  }
}

function expectedJobUrl(expected) {
  return (
    `https://github.com/${expected.producer.repository}/actions/runs/`
    + `${expected.runId}/job/${expected.jobId}`
  );
}

function expectSuccessfulJob(value, expected, label) {
  const expectedName = expected.producer.workflow.jobNameTemplate.replace(
    '{platform}',
    expected.platform,
  );
  const expectedLabels =
    expected.producer.workflow.runnerLabels[expected.platform];
  if (
    !isRecord(value)
    || value.id !== Number(expected.jobId)
    || value.run_id !== Number(expected.runId)
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.html_url !== expectedJobUrl(expected)
    || value.name !== expectedName
    || value.workflow_name !== expected.producer.workflow.name
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels) !== JSON.stringify(expectedLabels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the frozen successful GitHub job id`);
  }
  return value;
}

function expectSuccessfulAggregationJob(value, expected, label) {
  const labels = expected.producer.workflow.aggregationRunnerLabels;
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.id)
    || value.id <= 0
    || value.run_id !== Number(expected.runId)
    || value.run_attempt !== expected.runAttempt
    || value.head_sha !== expected.producer.commit
    || value.html_url
      !== (
        `https://github.com/${expected.producer.repository}/actions/runs/`
        + `${expected.runId}/job/${value.id}`
      )
    || value.name !== expected.producer.workflow.aggregationJobName
    || value.workflow_name !== expected.producer.workflow.name
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels) !== JSON.stringify(labels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the frozen successful aggregation job`);
  }
  return value;
}

function expectAttemptJobGraph(value, expectedByPlatform, label) {
  if (
    !isRecord(value)
    || value.total_count !== expectedByPlatform.length + 1
    || !Array.isArray(value.jobs)
    || value.jobs.length !== expectedByPlatform.length + 1
  ) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const jobsById = new Map();
  for (const job of value.jobs) {
    if (!isRecord(job) || !Number.isSafeInteger(job.id) || jobsById.has(job.id)) {
      throw new Error(`${label} does not match the exact frozen workflow job graph`);
    }
    jobsById.set(job.id, job);
  }
  const protectedJobs = expectedByPlatform.map((expected) => {
    const job = jobsById.get(Number(expected.jobId));
    if (job === undefined) {
      throw new Error(
        `${label} does not contain the reviewed GitHub job id in the exact frozen workflow job graph`,
      );
    }
    return expectSuccessfulJob(
      job,
      expected,
      `${expected.platform} GitHub job`,
    );
  });
  const protectedIds = new Set(
    expectedByPlatform.map(({ jobId }) => Number(jobId)),
  );
  const aggregationJobs = value.jobs.filter(
    (job) => isRecord(job) && !protectedIds.has(job.id),
  );
  if (aggregationJobs.length !== 1) {
    throw new Error(`${label} does not match the exact frozen workflow job graph`);
  }
  const aggregationJob = expectSuccessfulAggregationJob(
    aggregationJobs[0],
    expectedByPlatform[0],
    `${label} aggregation job`,
  );
  return { protectedJobs, aggregationJob };
}

function expectProtectedEnvironment(value, producer) {
  const requiredReviewers = isRecord(value) && Array.isArray(value.protection_rules)
    ? value.protection_rules.find(
        (rule) =>
          isRecord(rule)
          && rule.type === 'required_reviewers'
          && rule.prevent_self_review === true
          && Array.isArray(rule.reviewers)
          && rule.reviewers.length > 0,
      )
    : undefined;
  if (
    !isRecord(value)
    || value.id !== Number(producer.workflow.environmentId)
    || value.name !== producer.workflow.environment
    || requiredReviewers === undefined
    || !isRecord(value.deployment_branch_policy)
    || value.deployment_branch_policy.protected_branches !== true
    || value.deployment_branch_policy.custom_branch_policies !== false
  ) {
    throw new Error(
      'Frozen Chat evidence environment must retain required reviewer and protected-branch rules',
    );
  }
  return value;
}

function expectJobDeployment(value, expected, label) {
  const deploymentId = Number(expected.deploymentId);
  if (
    !isRecord(value)
    || value.id !== deploymentId
    || value.sha !== expected.producer.commit
    || value.ref !== expectedBranch(expected.producer.workflow.sourceRef)
    || value.task !== 'deploy'
    || value.environment !== expected.producer.workflow.environment
    || value.transient_environment !== false
    || value.statuses_url
      !== (
        `https://api.github.com/repos/${expected.producer.repository}/`
        + `deployments/${deploymentId}/statuses`
      )
    || value.repository_url
      !== `https://api.github.com/repos/${expected.producer.repository}`
    || !isRecord(value.performed_via_github_app)
    || value.performed_via_github_app.slug !== 'github-actions'
  ) {
    throw new Error(`${label} does not match the exact protected deployment`);
  }
  return value;
}

function expectJobDeploymentStatuses(value, expected, label) {
  const jobUrl = expectedJobUrl(expected);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} does not belong to the exact protected job`);
  }
  const states = new Set();
  for (const status of value) {
    if (
      !isRecord(status)
      || status.environment !== expected.producer.workflow.environment
      || status.log_url !== jobUrl
      || status.target_url !== jobUrl
      || typeof status.state !== 'string'
    ) {
      throw new Error(`${label} does not belong to the exact protected job`);
    }
    states.add(status.state);
  }
  if (
    (!states.has('waiting') && !states.has('pending'))
    || !states.has('success')
  ) {
    throw new Error(
      `${label} does not prove protected environment approval and success`,
    );
  }
}

function expectArtifact(value, expected, label) {
  if (
    !isRecord(value)
    || value.total_count !== 1
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== 1
  ) {
    throw new Error(`${label} must resolve exactly one GitHub Actions artifact`);
  }
  const artifact = value.artifacts[0];
  if (
    !isRecord(artifact)
    || !Number.isSafeInteger(artifact.id)
    || artifact.id <= 0
    || artifact.name !== expected.artifactName
    || artifact.expired !== false
    || !isRecord(artifact.workflow_run)
    || artifact.workflow_run.id !== Number(expected.runId)
    || artifact.workflow_run.head_sha !== expected.producer.commit
  ) {
    throw new Error(`${label} is not bound to the frozen workflow run`);
  }
  return artifact;
}

function readSingleArtifactFile(directory, label) {
  const entries = readdirSync(directory);
  if (entries.length !== 1) {
    throw new Error(`${label} must contain exactly one primary record file`);
  }
  const path = resolve(directory, entries[0]);
  const stats = lstatSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.size === 0
    || stats.size > 1_048_576
  ) {
    throw new Error(`${label} primary record must be a bounded regular file`);
  }
  return {
    name: entries[0],
    path,
    bytes: readFileSync(path),
  };
}

function readDownloadedBundle(directory, recordName, label) {
  const entries = readdirSync(directory).filter(
    (entry) => entry !== recordName,
  );
  if (entries.length !== 1 || !entries[0].endsWith('.jsonl')) {
    throw new Error(`${label} must produce exactly one JSONL bundle`);
  }
  const path = resolve(directory, entries[0]);
  const stats = lstatSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.size === 0
    || stats.size > MAX_ATTESTATION_BUNDLE_BYTES
  ) {
    throw new Error(`${label} bundle must be a bounded regular file`);
  }
  return {
    path,
    bytes: readFileSync(path),
  };
}

function verifyAttestationOutput(text, expected, label) {
  const results = parseGitHubJson(text, label);
  const invocation =
    `https://github.com/${expected.producer.repository}/actions/runs/`
    + `${expected.runId}/attempts/${expected.runAttempt}`;
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
          === `https://github.com/${expected.producer.repository}`
        && certificate.sourceRepositoryDigest === expected.producer.commit
        && certificate.sourceRepositoryRef
          === expected.producer.workflow.sourceRef
        && certificate.buildSignerDigest === expected.producer.commit
        && statement.predicateType === expected.producer.workflow.predicateType
        && subjects.some(
          (subject) =>
            isRecord(subject)
            && isRecord(subject.digest)
            && subject.digest.sha256 === expected.recordSha256,
        )
      );
    })
  ) {
    throw new Error(
      `${label} does not cryptographically bind the downloaded record to the frozen run`,
    );
  }
}

function sameIdentity(left, right) {
  return (
    left?.repository === right?.repository
    && left?.commit === right?.commit
    && left?.tree === right?.tree
  );
}

export function verifyGitHubConformanceEvidence({
  frozenLockText,
  assertionRegistryText,
  schemaText,
  aggregatePath,
  aggregateText,
  indexText,
  caveEngine,
  execute = execFileSync,
  env = process.env,
} = {}) {
  const lockValue = parseFrozenConformanceLock(
    frozenLockText,
    'committed frozen conformance lock',
  );
  const bindings = validateFrozenConformanceBindings(
    lockValue,
    schemaText,
    assertionRegistryText,
  );
  const lock = bindings.lock;
  const producer = assertEvidenceProducerCompatibility(lock);
  const index = parseReviewedEvidenceIndex(
    indexText,
    'release conformance evidence index',
    {
      frozenLock: lock,
      aggregatePath,
      aggregateText,
    },
  );
  const owned = createOwnedTempDirectory({
    prefix: 'opencoven-github-conformance-evidence',
  });

  try {
    const workflowText = runGh(
      execute,
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '--header',
        'Accept: application/vnd.github.raw+json',
        `repos/${producer.repository}/contents/${producer.workflow.path}?ref=${producer.commit}`,
      ],
      { cwd: owned.rootPath, env },
    );
    verifyProtectedWorkflow(workflowText, producer);
    const environment = parseGitHubJson(
      runGh(
        execute,
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          'GET',
          `repos/${producer.repository}/environments/${encodeURIComponent(producer.workflow.environment)}`,
        ],
        { cwd: owned.rootPath, env },
      ),
      'GitHub protected evidence environment',
    );
    expectProtectedEnvironment(environment, producer);
    const expectedByPlatform = index.platforms.map((indexedPlatform) => ({
      platform: indexedPlatform.platform,
      producer,
      runId: indexedPlatform.protectedJob.runId,
      runAttempt: indexedPlatform.protectedJob.runAttempt,
      jobId: indexedPlatform.protectedJob.jobId,
      deploymentId: indexedPlatform.protectedJob.deploymentId,
      artifactName: indexedPlatform.protectedJob.artifactName,
    }));
    const firstExpected = expectedByPlatform[0];
    if (
      firstExpected === undefined
      || expectedByPlatform.some(
        ({ runId, runAttempt }) =>
          runId !== firstExpected.runId
          || runAttempt !== firstExpected.runAttempt,
      )
    ) {
      throw new Error(
        'Reviewed evidence index must name one exact workflow run attempt',
      );
    }
    const run = parseGitHubJson(
      runGh(
        execute,
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          'GET',
          `repos/${producer.repository}/actions/runs/${firstExpected.runId}`,
        ],
        { cwd: owned.rootPath, env },
      ),
      'GitHub evidence workflow run',
    );
    expectSuccessfulRun(run, firstExpected, 'GitHub evidence workflow run');
    const jobsResponse = parseGitHubJson(
      runGh(
        execute,
        [
          'api',
          '--hostname',
          'github.com',
          '--method',
          'GET',
          `repos/${producer.repository}/actions/runs/${firstExpected.runId}/attempts/${firstExpected.runAttempt}/jobs?per_page=100`,
        ],
        { cwd: owned.rootPath, env },
      ),
      'GitHub evidence workflow jobs',
    );
    const jobGraph = expectAttemptJobGraph(
      jobsResponse,
      expectedByPlatform,
      'GitHub evidence workflow jobs',
    );
    const records = [];
    const receiptPlatforms = [];
    for (const [platformIndex, indexedPlatform] of index.platforms.entries()) {
      const platform = indexedPlatform.platform;
      const protectedJob = indexedPlatform.protectedJob;
      const expected = expectedByPlatform[platformIndex];
      const job = jobGraph.protectedJobs[platformIndex];
      if (expected === undefined || job === undefined) {
        throw new Error(
          'GitHub evidence workflow jobs do not match the frozen platform order',
        );
      }
      const deployment = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/deployments/${protectedJob.deploymentId}`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub deployment`,
      );
      expectJobDeployment(
        deployment,
        expected,
        `${platform} GitHub deployment`,
      );
      const deploymentStatuses = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/deployments/${protectedJob.deploymentId}/statuses?per_page=100`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub deployment statuses`,
      );
      expectJobDeploymentStatuses(
        deploymentStatuses,
        expected,
        `${platform} GitHub deployment`,
      );

      const artifactResponse = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/actions/runs/${protectedJob.runId}/artifacts?name=${encodeURIComponent(protectedJob.artifactName)}&per_page=100`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub artifact`,
      );
      const artifact = expectArtifact(
        artifactResponse,
        expected,
        `${platform} GitHub artifact`,
      );

      const platformRoot = resolve(owned.rootPath, platform);
      mkdirSync(platformRoot, { mode: 0o700 });
      runGh(
        execute,
        [
          'run',
          'download',
          protectedJob.runId,
          '--repo',
          `github.com/${producer.repository}`,
          '--name',
          protectedJob.artifactName,
          '--dir',
          platformRoot,
        ],
        { cwd: owned.rootPath, env },
      );
      const artifactFile = readSingleArtifactFile(
        platformRoot,
        `${platform} downloaded artifact`,
      );
      const recordText = artifactFile.bytes.toString('utf8');
      const recordSha256 = sha256(artifactFile.bytes);
      if (
        artifactFile.bytes.byteLength !== indexedPlatform.record.size
        || recordSha256 !== indexedPlatform.record.sha256
        || recordSha256 !== protectedJob.artifactSha256
      ) {
        throw new Error(
          `${platform} downloaded artifact digest does not match the reviewed index`,
        );
      }
      const record = parsePlatformEvidence(
        recordText,
        `${platform} downloaded platform record`,
        bindings.schema,
      );
      if (
        record.platform !== platform
        || serializeCanonicalJson(record) !== recordText
        || !sameIdentity(record.harness, producer)
        || !sameIdentity(record.provenance.validator, index.validator)
      ) {
        throw new Error(
          `${platform} downloaded platform record does not match the frozen identities`,
        );
      }

      runGh(
        execute,
        [
          'attestation',
          'download',
          artifactFile.path,
          '--repo',
          producer.repository,
          '--predicate-type',
          producer.workflow.predicateType,
          '--limit',
          '30',
          '--hostname',
          'github.com',
        ],
        { cwd: platformRoot, env },
      );
      const bundle = readDownloadedBundle(
        platformRoot,
        artifactFile.name,
        `${platform} attestation download`,
      );
      if (sha256(bundle.bytes) !== protectedJob.attestationBundleSha256) {
        throw new Error(
          `${platform} downloaded attestation bundle digest does not match the reviewed index`,
        );
      }
      const attestationOutput = runGh(
        execute,
        [
          'attestation',
          'verify',
          artifactFile.path,
          '--repo',
          producer.repository,
          '--signer-workflow',
          producer.workflow.signerWorkflow,
          '--signer-digest',
          producer.workflow.signerDigest,
          '--source-digest',
          producer.workflow.sourceDigest,
          '--source-ref',
          producer.workflow.sourceRef,
          '--predicate-type',
          producer.workflow.predicateType,
          '--deny-self-hosted-runners',
          '--bundle',
          bundle.path,
          '--format',
          'json',
          '--hostname',
          'github.com',
        ],
        { cwd: platformRoot, env },
      );
      verifyAttestationOutput(
        attestationOutput,
        {
          ...expected,
          recordSha256,
        },
        `${platform} GitHub attestation verification`,
      );

      records.push(record);
      receiptPlatforms.push({
        platform,
        record: {
          file: artifactFile.name,
          size: artifactFile.bytes.byteLength,
          sha256: recordSha256,
        },
        run: {
          id: protectedJob.runId,
          attempt: protectedJob.runAttempt,
          workflow: producer.workflow.path,
          sourceRef: producer.workflow.sourceRef,
          commit: producer.commit,
        },
        job: {
          id: protectedJob.jobId,
          name: job.name,
          runnerLabels: [...job.labels],
          environment: producer.workflow.environment,
          environmentId: producer.workflow.environmentId,
          deploymentId: protectedJob.deploymentId,
        },
        artifact: {
          id: String(artifact.id),
          name: artifact.name,
        },
        attestation: {
          subjectSha256: recordSha256,
          bundleSha256: sha256(bundle.bytes),
          verificationOutputSha256: sha256(attestationOutput),
        },
      });
    }

    const aggregate = aggregateConformanceEvidence({
      caveEngine,
      caveEngineSha256: lock.sources.cave.files[0].sha256,
      assertionRegistrySha256: sha256(assertionRegistryText),
      frozenLockSha256: sha256(frozenLockText),
      frozenLockSize: Buffer.byteLength(frozenLockText, 'utf8'),
      frozenLock: lock,
      canonicalPlatforms: lock.platformMatrix,
      registry: bindings.registry,
      platformRecords: records,
    });
    const generatedAggregateText = serializeCanonicalJson(aggregate);
    if (generatedAggregateText !== aggregateText) {
      throw new Error(
        'Committed aggregate was not generated from the downloaded platform artifact bytes',
      );
    }
    if (!sameIdentity(aggregate.validator, index.validator)) {
      throw new Error(
        'Reviewed evidence index validator does not match the downloaded records',
      );
    }

    return {
      aggregate,
      index,
      receipt: {
        schemaVersion: 1,
        issue: 'OpenCoven/sdk#38',
        kind: 'client-v1-github-evidence-verification',
        producer: {
          repository: producer.repository,
          commit: producer.commit,
          tree: producer.tree,
          workflow: producer.workflow,
          workflowSha256: sha256(workflowText),
        },
        aggregate: {
          path: aggregatePath,
          size: Buffer.byteLength(aggregateText, 'utf8'),
          sha256: sha256(aggregateText),
        },
        platforms: receiptPlatforms,
      },
    };
  } finally {
    cleanupOwnedTempRoot(owned);
  }
}
