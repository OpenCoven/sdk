import { createHash } from 'node:crypto';

const SCHEMA_VERSION = 1;
const SOURCE_REPOSITORY = 'OpenCoven/sdk';
const WORKFLOW_PATH = '.github/workflows/release.yml';
const WORKFLOW_REF = 'refs/heads/main';
const PENDING_APPROVAL_KIND = 'opencoven-sdk-pending-environment-approval';
const PROTECTED_APPROVAL_KIND = 'opencoven-sdk-protected-environment-approval';
const MAX_CANONICAL_JSON_BYTES = 1_048_576;
const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const POSITIVE_INTEGER_STRING_PATTERN = /^[1-9]\d*$/u;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function assertNoDuplicateJsonKeys(text, source) {
  let index = 0;

  const skipWhitespace = () => {
    while (/\s/u.test(text[index] ?? '')) {
      index += 1;
    }
  };

  const parseStringToken = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      index += 1;
      if (character === '"') {
        return JSON.parse(text.slice(start, index));
      }
    }
    throw new Error(`${source} contains an unterminated JSON string`);
  };

  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === '{') {
      parseObject();
      return;
    }
    if (character === '[') {
      parseArray();
      return;
    }
    if (character === '"') {
      parseStringToken();
      return;
    }
    while (index < text.length && !/[\s,\]}]/u.test(text[index] ?? '')) {
      index += 1;
    }
  };

  const parseArray = () => {
    index += 1;
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      index += 1;
    }
  };

  const parseObject = () => {
    index += 1;
    skipWhitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set();
    while (index < text.length) {
      const key = parseStringToken();
      if (keys.has(key)) {
        throw new Error(
          `${source} contains duplicate JSON object key ${JSON.stringify(key)}`,
        );
      }
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ':') {
        throw new Error(`${source} contains malformed JSON object syntax`);
      }
      index += 1;
      parseValue();
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      index += 1;
      skipWhitespace();
    }
  };

  parseValue();
}

export function parseCanonicalJson(
  text,
  source = 'canonical JSON',
  maxBytes = MAX_CANONICAL_JSON_BYTES,
) {
  if (typeof text !== 'string') {
    throw new Error(`${source} must be a UTF-8 JSON string`);
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`${source} exceeds the ${maxBytes}-byte limit`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source} is not valid JSON: ${message}`, { cause: error });
  }

  assertNoDuplicateJsonKeys(text, source);

  if (text !== serializeCanonicalJson(parsed)) {
    throw new Error(`${source} is not canonical JSON`);
  }

  return parsed;
}

function expectRecord(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function expectExactFields(value, fields, label) {
  const record = expectRecord(value, label);
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) {
      throw new Error(`${label} is missing field ${field}`);
    }
  }
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw new Error(`${label} contains unexpected field ${field}`);
    }
  }
  return record;
}

function expectNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function expectFileName(value, label) {
  const file = expectNonEmptyString(value, label);
  if (file.includes('/') || file.includes('\\')) {
    throw new Error(`${label} must be a canonical filename`);
  }
  return file;
}

function normalizeTimestamp(value, label) {
  const text = expectNonEmptyString(value, label);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return new Date(milliseconds).toISOString();
}

function timestampSecond(value) {
  return Math.floor(Date.parse(value) / 1_000);
}

function normalizeGitObjectId(value, label) {
  const text = expectNonEmptyString(value, label);
  if (!GIT_OBJECT_ID_PATTERN.test(text)) {
    throw new Error(`${label} must be a lowercase 40-character Git object id`);
  }
  return text;
}

function normalizePositiveIdString(value, label) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive GitHub id`);
    }
    return String(value);
  }
  const text = expectNonEmptyString(value, label);
  if (!POSITIVE_INTEGER_STRING_PATTERN.test(text)) {
    throw new Error(`${label} must be a positive GitHub id`);
  }
  return text;
}

function normalizeReviewerId(value, label) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive numeric reviewer id`);
    }
    return value;
  }
  const text = expectNonEmptyString(value, label);
  if (!POSITIVE_INTEGER_STRING_PATTERN.test(text)) {
    throw new Error(`${label} must be a positive numeric reviewer id`);
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive numeric reviewer id`);
  }
  return parsed;
}

function normalizeSha256(value, label) {
  const text = expectNonEmptyString(value, label);
  if (!SHA256_PATTERN.test(text)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return text;
}

function normalizeRunAttempt(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeExpected(options, label = 'expected') {
  const expected = expectRecord(options, label);
  return {
    environment: expectNonEmptyString(
      expected.environment,
      `${label}.environment`,
    ),
    environmentId: normalizePositiveIdString(
      expected.environmentId,
      `${label}.environmentId`,
    ),
    reviewer: {
      id: normalizeReviewerId(expected.reviewer?.id, `${label}.reviewer.id`),
      authorAssociation: expectNonEmptyString(
        expected.reviewer?.authorAssociation,
        `${label}.reviewer.authorAssociation`,
      ),
      permission: expectNonEmptyString(
        expected.reviewer?.permission,
        `${label}.reviewer.permission`,
      ),
      roleName: expectNonEmptyString(
        expected.reviewer?.roleName,
        `${label}.reviewer.roleName`,
      ),
    },
    witnessJob: expectNonEmptyString(expected.witnessJob, `${label}.witnessJob`),
    witnessAttestationJob: expectNonEmptyString(
      expected.witnessAttestationJob,
      `${label}.witnessAttestationJob`,
    ),
    approvalJob: expectNonEmptyString(
      expected.approvalJob,
      `${label}.approvalJob`,
    ),
    approvalAttestationJob: expectNonEmptyString(
      expected.approvalAttestationJob,
      `${label}.approvalAttestationJob`,
    ),
    publishJob: expectNonEmptyString(
      expected.publishJob,
      `${label}.publishJob`,
    ),
  };
}

function normalizeSource(source, label = 'source') {
  const record = expectRecord(source, label);
  if (record.repository !== SOURCE_REPOSITORY) {
    throw new Error(
      'Protected environment approval evidence must bind the exact OpenCoven/sdk source repository',
    );
  }
  return {
    repository: SOURCE_REPOSITORY,
    commit: normalizeGitObjectId(record.commit, `${label}.commit`),
    tree: normalizeGitObjectId(record.tree, `${label}.tree`),
  };
}

function normalizeWorkflow(workflow, source, label = 'workflow') {
  const record = expectRecord(workflow, label);
  const commit = normalizeGitObjectId(record.commit, `${label}.commit`);
  if (
    record.path !== WORKFLOW_PATH
    || record.ref !== WORKFLOW_REF
    || commit !== source.commit
  ) {
    throw new Error(
      'Protected environment approval evidence must bind the exact OpenCoven/sdk release workflow',
    );
  }
  return {
    path: WORKFLOW_PATH,
    commit,
    ref: WORKFLOW_REF,
    runId: normalizePositiveIdString(record.runId, `${label}.runId`),
    runAttempt: normalizeRunAttempt(record.runAttempt, `${label}.runAttempt`),
  };
}

function normalizeNamedJob(job, expectedName, label) {
  const record = expectRecord(job, label);
  const id = normalizePositiveIdString(record.id, `${label}.id`);
  const name = expectNonEmptyString(record.name, `${label}.name`);
  if (name !== expectedName) {
    throw new Error(
      `${label} must use the exact expected name ${JSON.stringify(expectedName)}`,
    );
  }

  return {
    id,
    name,
    startedAt: normalizeTimestamp(record.startedAt, `${label}.startedAt`),
  };
}

function normalizeNamedJobReference(job, expectedName, label) {
  const record = expectExactFields(job, ['id', 'name'], label);
  const id = normalizePositiveIdString(record.id, `${label}.id`);
  const name = expectNonEmptyString(record.name, `${label}.name`);
  if (name !== expectedName) {
    throw new Error(
      `${label} must use the exact expected name ${JSON.stringify(expectedName)}`,
    );
  }
  return { id, name };
}

function normalizePendingReviewerEntry(
  value,
  expectedReviewerId,
  label,
  { requireLogin = true } = {},
) {
  const record = expectRecord(value, label);
  const type = expectNonEmptyString(record.type, `${label}.type`);
  if (type !== 'User') {
    throw new Error(`${label} must identify exactly one User reviewer`);
  }
  const reviewer = expectRecord(record.reviewer, `${label}.reviewer`);
  const reviewerId = normalizeReviewerId(reviewer.id, `${label}.reviewer.id`);
  if (reviewerId !== expectedReviewerId) {
    throw new Error(
      'Protected environment approval must bind the immutable reviewer id',
    );
  }
  const reviewerType = expectNonEmptyString(
    reviewer.type,
    `${label}.reviewer.type`,
  );
  if (reviewerType !== 'User') {
    throw new Error(`${label}.reviewer.type must equal "User"`);
  }
  const login =
    typeof reviewer.login === 'string' && reviewer.login.length > 0
      ? reviewer.login
      : undefined;
  if (requireLogin && login === undefined) {
    throw new Error(`${label}.reviewer.login must be a non-empty string`);
  }
  return {
    type: 'User',
    reviewer: {
      id: reviewerId,
      ...(login === undefined ? {} : { login }),
      type: 'User',
    },
  };
}

function normalizeEnvironmentSummary(environment, expected, label) {
  const record = expectRecord(environment, label);
  const id = normalizePositiveIdString(record.id, `${label}.id`);
  const name = expectNonEmptyString(record.name, `${label}.name`);
  if (id !== expected.environmentId || name !== expected.environment) {
    throw new Error(
      'Protected environment approval evidence must bind the exact expected environment id and name',
    );
  }
  return { id, name };
}

function normalizeEnvironmentRules(environment, expected, label = 'environment') {
  const record = expectRecord(environment, label);
  const environmentSummary = normalizeEnvironmentSummary(record, expected, label);
  const rulesUpdatedAt = normalizeTimestamp(
    record.updated_at,
    `${label}.updated_at`,
  );

  if (record.can_admins_bypass !== false) {
    throw new Error(
      'Protected environment administrators must not be able to bypass approval',
    );
  }

  const branchPolicy = expectRecord(
    record.deployment_branch_policy,
    `${label}.deployment_branch_policy`,
  );
  if (
    branchPolicy.protected_branches !== true
    || branchPolicy.custom_branch_policies !== false
  ) {
    throw new Error(
      'Protected environment deployment_branch_policy must require protected_branches true and custom_branch_policies false',
    );
  }

  if (!Array.isArray(record.protection_rules)) {
    throw new Error(`${label}.protection_rules must be an array`);
  }
  if (record.protection_rules.length !== 2) {
    throw new Error(
      'Protected environment protection_rules must contain exactly required_reviewers and branch_policy',
    );
  }

  let branchRule = null;
  let reviewerRule = null;

  for (const [index, ruleValue] of record.protection_rules.entries()) {
    const rule = expectRecord(ruleValue, `${label}.protection_rules[${index}]`);
    const type = expectNonEmptyString(rule.type, `${label}.protection_rules[${index}].type`);
    if (type === 'branch_policy') {
      if (branchRule !== null) {
        throw new Error(
          'Protected environment protection_rules must contain exactly required_reviewers and branch_policy',
        );
      }
      branchRule = { type: 'branch_policy' };
      continue;
    }
    if (type === 'required_reviewers') {
      if (reviewerRule !== null) {
        throw new Error(
          'Protected environment protection_rules must contain exactly required_reviewers and branch_policy',
        );
      }
      if (rule.prevent_self_review !== true) {
        throw new Error(
          'Protected environment required_reviewers must set prevent_self_review true',
        );
      }
      if (!Array.isArray(rule.reviewers) || rule.reviewers.length !== 1) {
        throw new Error(
          'Protected environment required_reviewers must contain exactly one User reviewer',
        );
      }
      const normalizedReviewer = normalizePendingReviewerEntry(
        rule.reviewers[0],
        expected.reviewer.id,
        `${label}.protection_rules[${index}].reviewers[0]`,
        { requireLogin: false },
      );
      reviewerRule = {
        type: 'required_reviewers',
        prevent_self_review: true,
        reviewers: [
          {
            type: 'User',
            reviewer: {
              id: normalizedReviewer.reviewer.id,
              type: 'User',
            },
          },
        ],
      };
      continue;
    }
    throw new Error(
      'Protected environment protection_rules must contain exactly required_reviewers and branch_policy',
    );
  }

  if (branchRule === null || reviewerRule === null) {
    throw new Error(
      'Protected environment protection_rules must contain exactly required_reviewers and branch_policy',
    );
  }

  const rules = {
    can_admins_bypass: false,
    updated_at: rulesUpdatedAt,
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
    protection_rules: [branchRule, reviewerRule],
  };

  return {
    environment: environmentSummary,
    rulesUpdatedAt,
    reviewer: {
      id: reviewerRule.reviewers[0].reviewer.id,
    },
    rules: canonicalize(rules),
    rulesDigest: sha256(serializeCanonicalJson(rules)),
  };
}

export function createEnvironmentRulesDigest({
  environment,
  expected,
}) {
  return normalizeEnvironmentRules(environment, normalizeExpected(expected)).rulesDigest;
}

export const digestEnvironmentRules = createEnvironmentRulesDigest;

function candidatePendingEnvironmentId(value) {
  if (!isRecord(value) || !isRecord(value.environment)) {
    return null;
  }
  try {
    return normalizePositiveIdString(value.environment.id, 'pending environment id');
  } catch {
    return null;
  }
}

function candidatePendingEnvironmentName(value) {
  if (!isRecord(value) || !isRecord(value.environment)) {
    return null;
  }
  const name = value.environment.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function normalizePendingDeployment(deployment, expected, label) {
  const record = expectRecord(deployment, label);
  const environment = normalizeEnvironmentSummary(
    record.environment,
    expected,
    `${label}.environment`,
  );
  if (record.wait_timer !== 0 || record.wait_timer_started_at !== null) {
    throw new Error(
      'Pending protected-environment approval must not include a wait timer',
    );
  }
  if (!Array.isArray(record.reviewers) || record.reviewers.length !== 1) {
    throw new Error(
      'Pending protected-environment approval must contain exactly one matching reviewer',
    );
  }
  const reviewer = normalizePendingReviewerEntry(
    record.reviewers[0],
    expected.reviewer.id,
    `${label}.reviewers[0]`,
  );
  return {
    environment,
    reviewers: [reviewer],
    wait_timer: 0,
  };
}

function normalizePendingEvidenceRecord(
  evidence,
  label = 'pendingEvidence',
  expected = null,
) {
  const record = expectExactFields(
    evidence,
    [
      'environment',
      'kind',
      'pendingDeployment',
      'reviewer',
      'rules',
      'rulesDigest',
      'schemaVersion',
      'source',
      'witnessJob',
      'workflow',
    ],
    label,
  );
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must equal ${SCHEMA_VERSION}`);
  }
  if (record.kind !== PENDING_APPROVAL_KIND) {
    throw new Error(`${label}.kind must equal ${JSON.stringify(PENDING_APPROVAL_KIND)}`);
  }

  const source = normalizeSource(record.source, `${label}.source`);
  const workflow = normalizeWorkflow(record.workflow, source, `${label}.workflow`);

  const evidenceExpected = expected === null
    ? {
        environment: expectNonEmptyString(
          record.environment?.name,
          `${label}.environment.name`,
        ),
        environmentId: normalizePositiveIdString(
          record.environment?.id,
          `${label}.environment.id`,
        ),
        reviewer: {
          id: normalizeReviewerId(record.reviewer?.id, `${label}.reviewer.id`),
          authorAssociation: 'MEMBER',
          permission: 'admin',
          roleName: 'admin',
        },
        witnessJob: expectNonEmptyString(
          record.witnessJob?.name,
          `${label}.witnessJob.name`,
        ),
        approvalJob: 'approval-evidence',
        publishJob: 'publish',
      }
    : expected;

  const environmentRecord = expectExactFields(
    record.environment,
    ['id', 'name', 'rulesUpdatedAt'],
    `${label}.environment`,
  );
  const environment = normalizeEnvironmentSummary(
    environmentRecord,
    evidenceExpected,
    `${label}.environment`,
  );
  environment.rulesUpdatedAt = normalizeTimestamp(
    environmentRecord.rulesUpdatedAt,
    `${label}.environment.rulesUpdatedAt`,
  );

  const witnessJob = expectExactFields(
    record.witnessJob,
    ['id', 'name', 'observedAt', 'startedAt'],
    `${label}.witnessJob`,
  );
  const normalizedWitness = {
    id: normalizePositiveIdString(
      witnessJob.id,
      `${label}.witnessJob.id`,
    ),
    name: expectNonEmptyString(
      witnessJob.name,
      `${label}.witnessJob.name`,
    ),
    startedAt: normalizeTimestamp(
      witnessJob.startedAt,
      `${label}.witnessJob.startedAt`,
    ),
    observedAt: normalizeTimestamp(
      witnessJob.observedAt,
      `${label}.witnessJob.observedAt`,
    ),
  };
  if (expected !== null && normalizedWitness.name !== expected.witnessJob) {
    throw new Error(
      `${label}.witnessJob must use the exact expected name ${JSON.stringify(expected.witnessJob)}`,
    );
  }
  if (
    Date.parse(normalizedWitness.observedAt)
    < Date.parse(normalizedWitness.startedAt)
  ) {
    throw new Error(
      'Pending approval observedAt must be at or after witness job startedAt',
    );
  }

  const reviewerRecord = expectExactFields(
    record.reviewer,
    ['id', 'login'],
    `${label}.reviewer`,
  );
  const reviewer = {
    id: normalizeReviewerId(reviewerRecord.id, `${label}.reviewer.id`),
    login: expectNonEmptyString(reviewerRecord.login, `${label}.reviewer.login`),
  };
  if (reviewer.id !== evidenceExpected.reviewer.id) {
    throw new Error(
      'Protected environment approval must bind the immutable reviewer id',
    );
  }

  const rules = expectExactFields(
    record.rules,
    [
      'can_admins_bypass',
      'updated_at',
      'deployment_branch_policy',
      'protection_rules',
    ],
    `${label}.rules`,
  );
  const normalizedRules = normalizeEnvironmentRules(
    {
      ...environment,
      updated_at: environment.rulesUpdatedAt,
      can_admins_bypass: rules.can_admins_bypass,
      deployment_branch_policy: rules.deployment_branch_policy,
      protection_rules: rules.protection_rules,
    },
    evidenceExpected,
    `${label}.rules`,
  );

  const rulesDigest = normalizeSha256(record.rulesDigest, `${label}.rulesDigest`);
  if (rulesDigest !== normalizedRules.rulesDigest) {
    throw new Error(`${label}.rulesDigest does not match the canonical environment rules`);
  }

  const pendingDeployment = expectExactFields(
    record.pendingDeployment,
    ['environment', 'reviewers', 'wait_timer'],
    `${label}.pendingDeployment`,
  );
  const normalizedPendingDeployment = normalizePendingDeployment(
    {
      ...pendingDeployment,
      wait_timer_started_at: null,
    },
    evidenceExpected,
    `${label}.pendingDeployment`,
  );

  if (
    normalizedPendingDeployment.reviewers[0].reviewer.id !== reviewer.id
    || normalizedRules.reviewer.id !== reviewer.id
  ) {
    throw new Error(
      'Protected environment approval must bind the immutable reviewer id',
    );
  }

  return canonicalize({
    schemaVersion: SCHEMA_VERSION,
    kind: PENDING_APPROVAL_KIND,
    source,
    workflow,
    witnessJob: normalizedWitness,
    environment,
    reviewer,
    rules: normalizedRules.rules,
    rulesDigest,
    pendingDeployment: normalizedPendingDeployment,
  });
}

function normalizePendingEvidenceFile(file, pendingEvidence, label = 'pendingEvidenceFile') {
  const record = expectExactFields(
    file,
    ['artifactId', 'artifactName', 'file', 'sha256', 'size'],
    label,
  );
  const artifactName = expectNonEmptyString(record.artifactName, `${label}.artifactName`);
  const expectedArtifactName =
    `opencoven-sdk-pending-approval-${pendingEvidence.workflow.runId}`
    + `-${pendingEvidence.workflow.runAttempt}`;
  if (artifactName !== expectedArtifactName) {
    throw new Error(
      `${label}.artifactName must equal ${JSON.stringify(expectedArtifactName)}`,
    );
  }
  if (!Number.isSafeInteger(record.size) || record.size <= 0) {
    throw new Error(`${label}.size must be a positive integer`);
  }
  return {
    file: expectFileName(record.file, `${label}.file`),
    size: record.size,
    sha256: normalizeSha256(record.sha256, `${label}.sha256`),
    artifactId: normalizePositiveIdString(record.artifactId, `${label}.artifactId`),
    artifactName,
  };
}

function normalizeDeployment(deployment, source, workflow, expected, label = 'deployment') {
  const record = expectRecord(deployment, label);
  const id = normalizePositiveIdString(record.id, `${label}.id`);
  const sha = normalizeGitObjectId(record.sha, `${label}.sha`);
  if (sha !== source.commit) {
    throw new Error(`${label}.sha must equal the witnessed source commit`);
  }
  const rawRef = expectNonEmptyString(record.ref, `${label}.ref`);
  const branch = workflow.ref.slice('refs/heads/'.length);
  if (rawRef !== branch && rawRef !== workflow.ref) {
    throw new Error(`${label}.ref must equal the witnessed workflow branch`);
  }
  const task = expectNonEmptyString(record.task, `${label}.task`);
  if (task !== 'deploy') {
    throw new Error(`${label}.task must equal "deploy"`);
  }
  if (record.transient_environment !== false) {
    throw new Error(`${label}.transient_environment must be false`);
  }
  const environment = expectNonEmptyString(record.environment, `${label}.environment`);
  if (environment !== expected.environment) {
    throw new Error(`${label}.environment must equal the expected protected environment`);
  }
  const app = expectRecord(
    record.performed_via_github_app,
    `${label}.performed_via_github_app`,
  );
  const slug = expectNonEmptyString(app.slug, `${label}.performed_via_github_app.slug`);
  if (slug !== 'github-actions') {
    throw new Error(
      `${label}.performed_via_github_app.slug must equal "github-actions"`,
    );
  }
  const createdAt = normalizeTimestamp(
    record.created_at,
    `${label}.created_at`,
  );
  return {
    id,
    sha,
    ref: branch,
    task: 'deploy',
    environment,
    transient_environment: false,
    performed_via_github_app: {
      slug: 'github-actions',
    },
    created_at: createdAt,
  };
}

function normalizeSecurityReview(securityReview, expected, label = 'securityReview') {
  const record = expectRecord(securityReview, label);
  const reviewer = expectRecord(record.reviewer, `${label}.reviewer`);
  const normalized = {
    commentId: normalizePositiveIdString(record.commentId, `${label}.commentId`),
    reviewer: {
      id: normalizeReviewerId(reviewer.id, `${label}.reviewer.id`),
      login: expectNonEmptyString(reviewer.login, `${label}.reviewer.login`),
      authorAssociation: expectNonEmptyString(
        reviewer.authorAssociation,
        `${label}.reviewer.authorAssociation`,
      ),
      permission: expectNonEmptyString(
        reviewer.permission,
        `${label}.reviewer.permission`,
      ),
      roleName: expectNonEmptyString(
        reviewer.roleName,
        `${label}.reviewer.roleName`,
      ),
    },
  };
  if (
    normalized.reviewer.id !== expected.reviewer.id
    || normalized.reviewer.authorAssociation !== expected.reviewer.authorAssociation
    || normalized.reviewer.permission !== expected.reviewer.permission
    || normalized.reviewer.roleName !== expected.reviewer.roleName
  ) {
    throw new Error(
      'Protected environment approval must bind the immutable reviewer id and exact reviewer authorization from the security review',
    );
  }
  return normalized;
}

export function createPendingApprovalEvidence(options) {
  const record = expectRecord(options, 'options');
  const expected = normalizeExpected(record.expected);
  const source = normalizeSource(record.source);
  const workflow = normalizeWorkflow(record.workflow, source);
  const witnessJob = normalizeNamedJob(
    record.witnessJob,
    expected.witnessJob,
    'witnessJob',
  );
  const observedAt = normalizeTimestamp(record.observedAt, 'observedAt');
  if (Date.parse(observedAt) < Date.parse(witnessJob.startedAt)) {
    throw new Error(
      'Pending approval observedAt must be at or after witness job startedAt',
    );
  }

  const normalizedEnvironment = normalizeEnvironmentRules(
    record.environment,
    expected,
  );
  if (
    Date.parse(normalizedEnvironment.rulesUpdatedAt)
      > Date.parse(observedAt)
  ) {
    throw new Error(
      'Protected environment protection rules must predate the pending witness',
    );
  }

  if (!Array.isArray(record.pendingDeployments)) {
    throw new Error('pendingDeployments must be an array');
  }
  const matchingDeployments = record.pendingDeployments.filter(
    (entry) =>
      candidatePendingEnvironmentId(entry) === expected.environmentId
      && candidatePendingEnvironmentName(entry) === expected.environment,
  );
  if (matchingDeployments.length !== 1) {
    throw new Error(
      'Expected pending protected-environment approval was not witnessed exactly once',
    );
  }

  const pendingDeployment = normalizePendingDeployment(
    matchingDeployments[0],
    expected,
    'pendingDeployments[match]',
  );

  return canonicalize({
    schemaVersion: SCHEMA_VERSION,
    kind: PENDING_APPROVAL_KIND,
    source,
    workflow,
    witnessJob: {
      ...witnessJob,
      observedAt,
    },
    environment: {
      ...normalizedEnvironment.environment,
      rulesUpdatedAt: normalizedEnvironment.rulesUpdatedAt,
    },
    reviewer: {
      id: pendingDeployment.reviewers[0].reviewer.id,
      login: pendingDeployment.reviewers[0].reviewer.login,
    },
    rules: normalizedEnvironment.rules,
    rulesDigest: normalizedEnvironment.rulesDigest,
    pendingDeployment,
  });
}

export function serializePendingApprovalEvidence(evidence) {
  return serializeCanonicalJson(
    normalizePendingEvidenceRecord(evidence, 'pending approval evidence'),
  );
}

export function parsePendingApprovalEvidence(
  text,
  source = 'pending approval evidence',
  maxBytes = MAX_CANONICAL_JSON_BYTES,
) {
  return normalizePendingEvidenceRecord(parseCanonicalJson(text, source, maxBytes), source);
}

function normalizeProtectedApprovalReceiptRecord(
  receipt,
  label = 'protected approval receipt',
) {
  const record = expectExactFields(
    receipt,
    [
      'approvalJob',
      'createdAt',
      'deployment',
      'environment',
      'kind',
      'pendingEvidence',
      'reviewer',
      'rulesDigest',
      'schemaVersion',
      'securityReview',
      'source',
      'publishJob',
      'workflow',
    ],
    label,
  );
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must equal ${SCHEMA_VERSION}`);
  }
  if (record.kind !== PROTECTED_APPROVAL_KIND) {
    throw new Error(`${label}.kind must equal ${JSON.stringify(PROTECTED_APPROVAL_KIND)}`);
  }
  const source = normalizeSource(record.source, `${label}.source`);
  const workflow = normalizeWorkflow(record.workflow, source, `${label}.workflow`);
  const reviewer = expectExactFields(
    record.reviewer,
    ['authorAssociation', 'id', 'login', 'permission', 'roleName'],
    `${label}.reviewer`,
  );
  const expected = {
    environment: expectNonEmptyString(
      record.environment?.name,
      `${label}.environment.name`,
    ),
    environmentId: normalizePositiveIdString(
      record.environment?.id,
      `${label}.environment.id`,
    ),
    reviewer: {
      id: normalizeReviewerId(reviewer.id, `${label}.reviewer.id`),
      authorAssociation: expectNonEmptyString(
        reviewer.authorAssociation,
        `${label}.reviewer.authorAssociation`,
      ),
      permission: expectNonEmptyString(
        reviewer.permission,
        `${label}.reviewer.permission`,
      ),
      roleName: expectNonEmptyString(
        reviewer.roleName,
        `${label}.reviewer.roleName`,
      ),
    },
    witnessJob: expectNonEmptyString(
      record.pendingEvidence?.witnessJob?.name,
      `${label}.pendingEvidence.witnessJob.name`,
    ),
    approvalJob: expectNonEmptyString(
      record.approvalJob?.name,
      `${label}.approvalJob.name`,
    ),
    publishJob: expectNonEmptyString(
      record.publishJob?.name,
      `${label}.publishJob.name`,
    ),
  };
  const environmentRecord = expectExactFields(
    record.environment,
    ['id', 'name', 'rulesUpdatedAt'],
    `${label}.environment`,
  );
  const environment = normalizeEnvironmentSummary(
    environmentRecord,
    expected,
    `${label}.environment`,
  );
  environment.rulesUpdatedAt = normalizeTimestamp(
    environmentRecord.rulesUpdatedAt,
    `${label}.environment.rulesUpdatedAt`,
  );
  const pendingEvidenceRecord = expectExactFields(
    record.pendingEvidence,
    [
      'artifactId',
      'artifactName',
      'file',
      'kind',
      'observedAt',
      'sha256',
      'size',
      'witnessJob',
    ],
    `${label}.pendingEvidence`,
  );
  if (pendingEvidenceRecord.kind !== PENDING_APPROVAL_KIND) {
    throw new Error(
      `${label}.pendingEvidence.kind must equal ${JSON.stringify(PENDING_APPROVAL_KIND)}`,
    );
  }
  const pendingWitness = expectExactFields(
    pendingEvidenceRecord.witnessJob,
    ['id', 'name'],
    `${label}.pendingEvidence.witnessJob`,
  );
  const approvalJob = normalizeNamedJob(
    record.approvalJob,
    expected.approvalJob,
    `${label}.approvalJob`,
  );
  const publishJob = normalizeNamedJobReference(
    record.publishJob,
    expected.publishJob,
    `${label}.publishJob`,
  );
  const createdAt = normalizeTimestamp(record.createdAt, `${label}.createdAt`);
  if (Date.parse(createdAt) < Date.parse(approvalJob.startedAt)) {
    throw new Error(
      'Protected approval receipt createdAt must be at or after approval job startedAt',
    );
  }
  return canonicalize({
    schemaVersion: SCHEMA_VERSION,
    kind: PROTECTED_APPROVAL_KIND,
    source,
    workflow,
    environment,
    reviewer: {
      id: expected.reviewer.id,
      login: expectNonEmptyString(reviewer.login, `${label}.reviewer.login`),
      authorAssociation: expected.reviewer.authorAssociation,
      permission: expected.reviewer.permission,
      roleName: expected.reviewer.roleName,
    },
    rulesDigest: normalizeSha256(record.rulesDigest, `${label}.rulesDigest`),
    pendingEvidence: {
      kind: PENDING_APPROVAL_KIND,
      file: expectFileName(pendingEvidenceRecord.file, `${label}.pendingEvidence.file`),
      size: (() => {
        if (!Number.isSafeInteger(pendingEvidenceRecord.size) || pendingEvidenceRecord.size <= 0) {
          throw new Error(`${label}.pendingEvidence.size must be a positive integer`);
        }
        return pendingEvidenceRecord.size;
      })(),
      sha256: normalizeSha256(
        pendingEvidenceRecord.sha256,
        `${label}.pendingEvidence.sha256`,
      ),
      artifactId: normalizePositiveIdString(
        pendingEvidenceRecord.artifactId,
        `${label}.pendingEvidence.artifactId`,
      ),
      artifactName: expectNonEmptyString(
        pendingEvidenceRecord.artifactName,
        `${label}.pendingEvidence.artifactName`,
      ),
      observedAt: normalizeTimestamp(
        pendingEvidenceRecord.observedAt,
        `${label}.pendingEvidence.observedAt`,
      ),
      witnessJob: {
        id: normalizePositiveIdString(
          pendingWitness.id,
          `${label}.pendingEvidence.witnessJob.id`,
        ),
        name: expectNonEmptyString(
          pendingWitness.name,
          `${label}.pendingEvidence.witnessJob.name`,
        ),
      },
    },
    approvalJob,
    publishJob,
    deployment: normalizeDeployment(
      record.deployment,
      source,
      workflow,
      expected,
      `${label}.deployment`,
    ),
    securityReview: (() => {
      const securityReview = expectExactFields(
        record.securityReview,
        ['commentId', 'reviewer'],
        `${label}.securityReview`,
      );
      const securityReviewer = expectExactFields(
        securityReview.reviewer,
        ['authorAssociation', 'id', 'login', 'permission', 'roleName'],
        `${label}.securityReview.reviewer`,
      );
      const reviewerId = normalizeReviewerId(
        securityReviewer.id,
        `${label}.securityReview.reviewer.id`,
      );
      const reviewerAssociation = expectNonEmptyString(
        securityReviewer.authorAssociation,
        `${label}.securityReview.reviewer.authorAssociation`,
      );
      const reviewerPermission = expectNonEmptyString(
        securityReviewer.permission,
        `${label}.securityReview.reviewer.permission`,
      );
      const reviewerRoleName = expectNonEmptyString(
        securityReviewer.roleName,
        `${label}.securityReview.reviewer.roleName`,
      );
      if (
        reviewerId !== expected.reviewer.id
        || reviewerAssociation !== expected.reviewer.authorAssociation
        || reviewerPermission !== expected.reviewer.permission
        || reviewerRoleName !== expected.reviewer.roleName
      ) {
        throw new Error(
          'Protected environment approval must bind the immutable reviewer id and exact reviewer authorization from the security review',
        );
      }
      return {
        commentId: normalizePositiveIdString(
          securityReview.commentId,
          `${label}.securityReview.commentId`,
        ),
        reviewer: {
          id: reviewerId,
          login: expectNonEmptyString(
            securityReviewer.login,
            `${label}.securityReview.reviewer.login`,
          ),
          authorAssociation: reviewerAssociation,
          permission: reviewerPermission,
          roleName: reviewerRoleName,
        },
      };
    })(),
    createdAt,
  });
}

export function createProtectedApprovalReceipt(options) {
  const record = expectRecord(options, 'options');
  const expected = normalizeExpected(record.expected);
  const pendingEvidence = normalizePendingEvidenceRecord(
    record.pendingEvidence,
    'pendingEvidence',
    expected,
  );
  const pendingEvidenceFile = normalizePendingEvidenceFile(
    record.pendingEvidenceFile,
    pendingEvidence,
  );
  const approvalJob = normalizeNamedJob(
    record.approvalJob,
    expected.approvalJob,
    'approvalJob',
  );
  const publishJob = normalizeNamedJobReference(
    record.publishJob,
    expected.publishJob,
    'publishJob',
  );
  if (
    timestampSecond(approvalJob.startedAt)
      < timestampSecond(pendingEvidence.witnessJob.observedAt)
  ) {
    throw new Error(
      'Protected approval job must start after the pending approval witness',
    );
  }

  const currentEnvironment = normalizeEnvironmentRules(
    record.environment,
    expected,
    'environment',
  );
  if (currentEnvironment.rulesDigest !== pendingEvidence.rulesDigest) {
    throw new Error(
      'Protected approval receipt must bind the exact same current environment rules digest as witnessed',
    );
  }

  const deployment = normalizeDeployment(
    record.deployment,
    pendingEvidence.source,
    pendingEvidence.workflow,
    expected,
  );
  if (
    Date.parse(deployment.created_at)
      < Date.parse(pendingEvidence.environment.rulesUpdatedAt)
    || Date.parse(deployment.created_at) > Date.parse(approvalJob.startedAt)
  ) {
    throw new Error(
      'Protected approval deployment must be created after the witnessed rules version and before the protected job starts',
    );
  }
  const securityReview = normalizeSecurityReview(
    record.securityReview,
    expected,
  );
  if (securityReview.reviewer.id !== pendingEvidence.reviewer.id) {
    throw new Error(
      'Protected environment approval must bind the immutable reviewer id',
    );
  }

  const createdAt = normalizeTimestamp(record.createdAt, 'createdAt');
  if (Date.parse(createdAt) < Date.parse(approvalJob.startedAt)) {
    throw new Error(
      'Protected approval receipt createdAt must be at or after approval job startedAt',
    );
  }

  return canonicalize({
    schemaVersion: SCHEMA_VERSION,
    kind: PROTECTED_APPROVAL_KIND,
    source: pendingEvidence.source,
    workflow: pendingEvidence.workflow,
    environment: pendingEvidence.environment,
    reviewer: securityReview.reviewer,
    rulesDigest: pendingEvidence.rulesDigest,
    pendingEvidence: {
      kind: pendingEvidence.kind,
      file: pendingEvidenceFile.file,
      size: pendingEvidenceFile.size,
      sha256: pendingEvidenceFile.sha256,
      artifactId: pendingEvidenceFile.artifactId,
      artifactName: pendingEvidenceFile.artifactName,
      observedAt: pendingEvidence.witnessJob.observedAt,
      witnessJob: {
        id: pendingEvidence.witnessJob.id,
        name: pendingEvidence.witnessJob.name,
      },
    },
    approvalJob,
    publishJob,
    deployment,
    securityReview: {
      commentId: securityReview.commentId,
      reviewer: securityReview.reviewer,
    },
    createdAt,
  });
}

export function serializeProtectedApprovalReceipt(receipt) {
  return serializeCanonicalJson(
    normalizeProtectedApprovalReceiptRecord(receipt),
  );
}

export function parseProtectedApprovalReceipt(
  text,
  source = 'protected approval receipt',
  maxBytes = MAX_CANONICAL_JSON_BYTES,
) {
  return normalizeProtectedApprovalReceiptRecord(
    parseCanonicalJson(text, source, maxBytes),
    source,
  );
}
