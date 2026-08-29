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

function verifyProtectedWorkflow(text, producer) {
  if (
    typeof text !== 'string'
    || Buffer.byteLength(text, 'utf8') > MAX_GITHUB_RESPONSE_BYTES
  ) {
    throw new Error('Frozen Chat workflow response is not bounded UTF-8 text');
  }
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  const jobsIndex = lines.findIndex((line) => line === 'jobs:');
  const jobMarker = `  ${producer.workflow.job}:`;
  const jobIndex = lines.findIndex(
    (line, index) => index > jobsIndex && line === jobMarker,
  );
  if (jobsIndex < 0 || jobIndex < 0) {
    throw new Error(
      'Frozen Chat workflow does not define the protected evidence job',
    );
  }
  let jobEnd = lines.length;
  for (let index = jobIndex + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*(?:#.*)?$/u.test(lines[index])) {
      jobEnd = index;
      break;
    }
  }
  const environmentLine =
    `    environment: ${producer.workflow.environment}`;
  if (
    lines.slice(jobIndex + 1, jobEnd).filter(
      (line) => line.replace(/\s+#.*$/u, '') === environmentLine,
    ).length !== 1
  ) {
    throw new Error(
      'Frozen Chat workflow evidence job is not bound to the protected environment',
    );
  }
}

function expectSuccessfulRun(value, expected, label) {
  if (
    !isRecord(value)
    || value.id !== Number(expected.runId)
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
    || value.head_sha !== expected.producer.commit
    || value.name !== expectedName
    || value.status !== 'completed'
    || value.conclusion !== 'success'
    || !Array.isArray(value.labels)
    || JSON.stringify(value.labels) !== JSON.stringify(expectedLabels)
    || value.labels.includes('self-hosted')
  ) {
    throw new Error(`${label} does not match the frozen successful GitHub job id`);
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
    const records = [];
    const receiptPlatforms = [];
    for (const indexedPlatform of index.platforms) {
      const platform = indexedPlatform.platform;
      const protectedJob = indexedPlatform.protectedJob;
      const expected = {
        platform,
        producer,
        runId: protectedJob.runId,
        runAttempt: protectedJob.runAttempt,
        jobId: protectedJob.jobId,
        artifactName: protectedJob.artifactName,
      };
      const run = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/actions/runs/${protectedJob.runId}`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub run`,
      );
      expectSuccessfulRun(run, expected, `${platform} GitHub run`);

      const job = parseGitHubJson(
        runGh(
          execute,
          [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            `repos/${producer.repository}/actions/jobs/${protectedJob.jobId}`,
          ],
          { cwd: owned.rootPath, env },
        ),
        `${platform} GitHub job`,
      );
      expectSuccessfulJob(job, expected, `${platform} GitHub job`);

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
