import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { devNull } from 'node:os';

import {
  parseJsonText,
  serializeCanonicalJson,
} from './conformance-contract.mjs';

const MAX_GITHUB_RESPONSE_BYTES = 1_048_576;
const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_KIND = 'opencoven-sdk-release-environment-policy';
const REPOSITORY_IDENTITY = Object.freeze({
  id: '1337664127',
  nodeId: 'R_kgDOT7sifw',
  name: 'sdk',
  fullName: 'OpenCoven/sdk',
  private: false,
  defaultBranch: 'main',
  owner: Object.freeze({
    id: '270919577',
    login: 'OpenCoven',
    type: 'Organization',
  }),
});
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function expectExactFields(value, fields, label) {
  const record = expectRecord(value, label);
  const expected = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) {
      throw new Error(`${label} is missing field ${field}`);
    }
  }
  for (const field of Object.keys(record)) {
    if (!expected.has(field)) {
      throw new Error(`${label} contains unexpected field ${field}`);
    }
  }
  return record;
}

function normalizePositiveId(value, label) {
  const text = typeof value === 'number' ? String(value) : value;
  if (
    typeof text !== 'string'
    || !POSITIVE_ID_PATTERN.test(text)
    || (
      typeof value === 'number'
      && (!Number.isSafeInteger(value) || value <= 0)
    )
  ) {
    throw new Error(`${label} must be a positive GitHub id`);
  }
  return text;
}

function normalizeNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function normalizeTimestamp(value, label) {
  const text = normalizeNonEmptyString(value, label);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return new Date(milliseconds).toISOString();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function githubEnvironment(source) {
  if (typeof source.GH_TOKEN !== 'string' || source.GH_TOKEN.length === 0) {
    throw new Error(
      'GH_TOKEN is required for authoritative GitHub environment verification',
    );
  }
  return {
    PATH: '/usr/bin:/bin',
    HOME: source.HOME ?? source.RUNNER_TEMP ?? '/tmp',
    TMPDIR: source.TMPDIR ?? source.RUNNER_TEMP ?? '/tmp',
    GH_HOST: 'github.com',
    GH_TOKEN: source.GH_TOKEN,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
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

function githubExecutable(env) {
  const path = env.OPENCOVEN_GH_PATH ?? '/usr/bin/gh';
  if (
    typeof path !== 'string'
    || !/^\/(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+$/u.test(path)
  ) {
    throw new Error('OPENCOVEN_GH_PATH must be an absolute executable path');
  }
  return path;
}

function runGitHubApi(execute, executable, endpoint, env, label) {
  const apiEnvironment = githubEnvironment(env);
  let text;
  try {
    text = execute(
      executable,
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        'X-GitHub-Api-Version: 2026-03-10',
        endpoint,
      ],
      {
        encoding: 'utf8',
        env: apiEnvironment,
        maxBuffer: MAX_GITHUB_RESPONSE_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    );
  } catch (error) {
    throw new Error(`${label} is missing or unreadable`, { cause: error });
  }
  return parseGitHubJson(text, label);
}

function expectedEnvironmentPolicies(config) {
  const reviewerId = config?.protectedApproval?.reviewer?.id;
  if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0) {
    throw new Error(
      'Release configuration must contain the immutable protected approval reviewer id',
    );
  }
  return [
    {
      name: config.publicationCandidate.environment,
      environmentId: null,
      requiredReviewerIds: [],
      preventSelfReview: false,
    },
    {
      name: config.protectedApproval.environment,
      environmentId: config.protectedApproval.environmentId,
      requiredReviewerIds: [reviewerId],
      preventSelfReview: true,
    },
    {
      name: config.npmTrustedPublisher.environment,
      environmentId: null,
      requiredReviewerIds: [],
      preventSelfReview: false,
    },
  ];
}

function fixedExpectedEnvironmentPolicies() {
  return [
    {
      name: 'publication-candidate',
      environmentId: null,
      requiredReviewerIds: [],
      preventSelfReview: false,
    },
    {
      name: 'npm-release',
      environmentId: '20778492972',
      requiredReviewerIds: [68980965],
      preventSelfReview: true,
    },
    {
      name: 'npm-publish',
      environmentId: null,
      requiredReviewerIds: [],
      preventSelfReview: false,
    },
  ];
}

function normalizeRepository(value) {
  const repository = expectRecord(value, 'GitHub repository');
  const owner = expectRecord(repository.owner, 'GitHub repository owner');
  const normalized = {
    id: normalizePositiveId(repository.id, 'GitHub repository.id'),
    nodeId: normalizeNonEmptyString(
      repository.node_id,
      'GitHub repository.node_id',
    ),
    name: normalizeNonEmptyString(repository.name, 'GitHub repository.name'),
    fullName: normalizeNonEmptyString(
      repository.full_name,
      'GitHub repository.full_name',
    ),
    private: repository.private,
    defaultBranch: normalizeNonEmptyString(
      repository.default_branch,
      'GitHub repository.default_branch',
    ),
    owner: {
      id: normalizePositiveId(owner.id, 'GitHub repository.owner.id'),
      login: normalizeNonEmptyString(
        owner.login,
        'GitHub repository.owner.login',
      ),
      type: normalizeNonEmptyString(
        owner.type,
        'GitHub repository.owner.type',
      ),
    },
  };
  if (
    serializeCanonicalJson(normalized)
      !== serializeCanonicalJson(REPOSITORY_IDENTITY)
  ) {
    throw new Error(
      'GitHub environment verification must use the exact OpenCoven/sdk repository identity',
    );
  }
  return normalized;
}

function normalizeReviewerRule(rule, expected, environmentName) {
  if (
    rule.prevent_self_review !== expected.preventSelfReview
    || !Array.isArray(rule.reviewers)
  ) {
    throw new Error(
      `${environmentName} required-reviewer self-review policy is not exact`,
    );
  }
  const reviewerIds = rule.reviewers.map((entry, index) => {
    const reviewerEntry = expectRecord(
      entry,
      `${environmentName} reviewer ${index}`,
    );
    const reviewer = expectRecord(
      reviewerEntry.reviewer,
      `${environmentName} reviewer ${index}.reviewer`,
    );
    if (reviewerEntry.type !== 'User' || reviewer.type !== 'User') {
      throw new Error(
        `${environmentName} required reviewers must be exact GitHub users`,
      );
    }
    return Number(
      normalizePositiveId(
        reviewer.id,
        `${environmentName} reviewer ${index}.id`,
      ),
    );
  });
  if (
    reviewerIds.length !== expected.requiredReviewerIds.length
    || reviewerIds.some(
      (reviewerId, index) =>
        reviewerId !== expected.requiredReviewerIds[index],
    )
  ) {
    throw new Error(
      `${environmentName} required reviewers must use the exact immutable reviewer ids`,
    );
  }
  return {
    type: 'required_reviewers',
    preventSelfReview: expected.preventSelfReview,
    reviewerIds,
  };
}

function normalizeEnvironment(value, expected) {
  const environment = expectRecord(
    value,
    `GitHub environment ${expected.name}`,
  );
  if (environment.name !== expected.name) {
    throw new Error(
      `Required GitHub release environment ${expected.name} has the wrong identity`,
    );
  }
  const environmentId = normalizePositiveId(
    environment.id,
    `${expected.name}.id`,
  );
  if (
    expected.environmentId !== null
    && environmentId !== expected.environmentId
  ) {
    throw new Error(
      `${expected.name} must use environment id ${expected.environmentId}`,
    );
  }
  if (environment.can_admins_bypass !== false) {
    throw new Error(
      `${expected.name} must disable administrator bypass`,
    );
  }
  if (!isRecord(environment.deployment_branch_policy)) {
    throw new Error(
      `${expected.name} must allow protected branches only`,
    );
  }
  const deploymentBranchPolicy = environment.deployment_branch_policy;
  if (
    deploymentBranchPolicy.protected_branches !== true
    || deploymentBranchPolicy.custom_branch_policies !== false
  ) {
    throw new Error(
      `${expected.name} must allow protected branches only`,
    );
  }
  if (!Array.isArray(environment.protection_rules)) {
    throw new Error(`${expected.name}.protection_rules must be an array`);
  }

  let branchRuleCount = 0;
  let reviewerRule = null;
  const protectionRules = [];
  for (const [index, value_] of environment.protection_rules.entries()) {
    const rule = expectRecord(
      value_,
      `${expected.name}.protection_rules[${index}]`,
    );
    if (rule.type === 'branch_policy') {
      branchRuleCount += 1;
      protectionRules.push({ type: 'branch_policy' });
      continue;
    }
    if (rule.type === 'required_reviewers') {
      if (reviewerRule !== null) {
        throw new Error(
          `${expected.name} has an unexpected protection rule`,
        );
      }
      reviewerRule = normalizeReviewerRule(rule, expected, expected.name);
      protectionRules.push(reviewerRule);
      continue;
    }
    if (rule.type === 'wait_timer') {
      throw new Error(
        `${expected.name} has an unexpected protection rule: wait_timer must equal 0 minutes`,
      );
    }
    throw new Error(`${expected.name} has an unexpected protection rule`);
  }
  if (branchRuleCount !== 1) {
    throw new Error(
      `${expected.name} must contain exactly one branch policy protection rule`,
    );
  }
  if (
    expected.requiredReviewerIds.length === 0
      ? reviewerRule !== null
      : reviewerRule === null
  ) {
    throw new Error(
      `${expected.name} required reviewers must use the exact immutable reviewer ids`,
    );
  }
  protectionRules.sort((left, right) =>
    left.type.localeCompare(right.type),
  );

  const normalized = {
    id: environmentId,
    nodeId: normalizeNonEmptyString(
      environment.node_id,
      `${expected.name}.node_id`,
    ),
    name: expected.name,
    canAdminsBypass: false,
    createdAt: normalizeTimestamp(
      environment.created_at,
      `${expected.name}.created_at`,
    ),
    updatedAt: normalizeTimestamp(
      environment.updated_at,
      `${expected.name}.updated_at`,
    ),
    waitTimer: 0,
    preventSelfReview: expected.preventSelfReview,
    requiredReviewerIds: [...expected.requiredReviewerIds],
    deploymentBranchPolicy: {
      protectedBranches: true,
      customBranchPolicies: false,
    },
    protectionRules,
  };
  return {
    ...normalized,
    policyDigest: sha256(serializeCanonicalJson(normalized)),
  };
}

function normalizeReceiptRepository(value) {
  const repository = expectExactFields(
    value,
    ['defaultBranch', 'fullName', 'id', 'name', 'nodeId', 'owner', 'private'],
    'Environment policy receipt repository',
  );
  const owner = expectExactFields(
    repository.owner,
    ['id', 'login', 'type'],
    'Environment policy receipt repository.owner',
  );
  return normalizeRepository({
    id: repository.id,
    node_id: repository.nodeId,
    name: repository.name,
    full_name: repository.fullName,
    private: repository.private,
    default_branch: repository.defaultBranch,
    owner: {
      id: owner.id,
      login: owner.login,
      type: owner.type,
    },
  });
}

function normalizeReceiptEnvironment(value, expected, index) {
  const label = `Environment policy receipt environments[${index}]`;
  const environment = expectExactFields(
    value,
    [
      'canAdminsBypass',
      'createdAt',
      'deploymentBranchPolicy',
      'id',
      'name',
      'nodeId',
      'policyDigest',
      'preventSelfReview',
      'protectionRules',
      'requiredReviewerIds',
      'updatedAt',
      'waitTimer',
    ],
    label,
  );
  if (
    environment.name !== expected.name
    || (
      expected.environmentId !== null
      && environment.id !== expected.environmentId
    )
    || environment.canAdminsBypass !== false
    || environment.waitTimer !== 0
    || environment.preventSelfReview !== expected.preventSelfReview
    || !Array.isArray(environment.requiredReviewerIds)
    || environment.requiredReviewerIds.length
      !== expected.requiredReviewerIds.length
    || environment.requiredReviewerIds.some(
      (reviewerId, reviewerIndex) =>
        reviewerId !== expected.requiredReviewerIds[reviewerIndex],
    )
  ) {
    throw new Error(`${label} does not match the exact governed policy`);
  }
  const branchPolicy = expectExactFields(
    environment.deploymentBranchPolicy,
    ['customBranchPolicies', 'protectedBranches'],
    `${label}.deploymentBranchPolicy`,
  );
  if (
    branchPolicy.protectedBranches !== true
    || branchPolicy.customBranchPolicies !== false
  ) {
    throw new Error(`${label} does not match the exact governed policy`);
  }
  const expectedProtectionRules = [
    { type: 'branch_policy' },
    ...(expected.requiredReviewerIds.length === 0
      ? []
      : [
          {
            type: 'required_reviewers',
            preventSelfReview: expected.preventSelfReview,
            reviewerIds: [...expected.requiredReviewerIds],
          },
        ]),
  ];
  if (
    serializeCanonicalJson(environment.protectionRules)
      !== serializeCanonicalJson(expectedProtectionRules)
  ) {
    throw new Error(`${label} contains unexpected protection rules`);
  }
  const normalized = {
    id: normalizePositiveId(environment.id, `${label}.id`),
    nodeId: normalizeNonEmptyString(environment.nodeId, `${label}.nodeId`),
    name: expected.name,
    canAdminsBypass: false,
    createdAt: normalizeTimestamp(environment.createdAt, `${label}.createdAt`),
    updatedAt: normalizeTimestamp(environment.updatedAt, `${label}.updatedAt`),
    waitTimer: 0,
    preventSelfReview: expected.preventSelfReview,
    requiredReviewerIds: [...expected.requiredReviewerIds],
    deploymentBranchPolicy: {
      protectedBranches: true,
      customBranchPolicies: false,
    },
    protectionRules: expectedProtectionRules,
  };
  const policyDigest = normalizeNonEmptyString(
    environment.policyDigest,
    `${label}.policyDigest`,
  );
  if (
    !SHA256_PATTERN.test(policyDigest)
    || policyDigest !== sha256(serializeCanonicalJson(normalized))
  ) {
    throw new Error(`${label}.policyDigest is invalid`);
  }
  return {
    ...normalized,
    policyDigest,
  };
}

function normalizeReceipt(value, label = 'release environment policy receipt') {
  const receipt = expectExactFields(
    value,
    [
      'environments',
      'kind',
      'policyDigest',
      'repository',
      'schemaVersion',
      'verifiedAt',
    ],
    label,
  );
  if (
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION
    || receipt.kind !== RECEIPT_KIND
  ) {
    throw new Error(`${label} has an invalid schema identity`);
  }
  if (
    !Array.isArray(receipt.environments)
    || receipt.environments.length !== 3
  ) {
    throw new Error(`${label} must contain exactly three environments`);
  }
  const repository = normalizeReceiptRepository(receipt.repository);
  const expectedPolicies = fixedExpectedEnvironmentPolicies();
  const environments = receipt.environments.map((environment, index) =>
    normalizeReceiptEnvironment(
      environment,
      expectedPolicies[index],
      index,
    ),
  );
  const verifiedAt = normalizeTimestamp(
    receipt.verifiedAt,
    `${label}.verifiedAt`,
  );
  const policyDigest = normalizeNonEmptyString(
    receipt.policyDigest,
    `${label}.policyDigest`,
  );
  const policy = { repository, environments };
  if (
    !SHA256_PATTERN.test(policyDigest)
    || policyDigest !== sha256(serializeCanonicalJson(policy))
  ) {
    throw new Error(`${label}.policyDigest is invalid`);
  }
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    verifiedAt,
    repository,
    environments,
    policyDigest,
  };
}

export function createReleaseEnvironmentPolicyReceipt({
  repository,
  environments,
  verifiedAt = new Date().toISOString(),
  config,
}) {
  const expectedPolicies =
    config === undefined
      ? fixedExpectedEnvironmentPolicies()
      : expectedEnvironmentPolicies(config);
  if (!Array.isArray(environments) || environments.length !== 3) {
    throw new Error(
      'Release environment policy verification requires exactly three environments',
    );
  }
  const normalizedRepository = normalizeRepository(repository);
  const normalizedEnvironments = environments.map((entry, index) => {
    const record = expectRecord(
      entry,
      `Release environment policy input ${index}`,
    );
    return normalizeEnvironment(record, expectedPolicies[index]);
  });
  const normalizedVerifiedAt = normalizeTimestamp(
    verifiedAt,
    'Release environment policy verifiedAt',
  );
  const policy = {
    repository: normalizedRepository,
    environments: normalizedEnvironments,
  };
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    verifiedAt: normalizedVerifiedAt,
    ...policy,
    policyDigest: sha256(serializeCanonicalJson(policy)),
  };
}

export function serializeReleaseEnvironmentPolicyReceipt(receipt) {
  return serializeCanonicalJson(normalizeReceipt(receipt));
}

export function parseReleaseEnvironmentPolicyReceipt(
  text,
  source = 'release environment policy receipt',
) {
  const parsed = parseJsonText(text, source, MAX_GITHUB_RESPONSE_BYTES);
  const normalized = normalizeReceipt(parsed, source);
  if (text !== serializeCanonicalJson(normalized)) {
    throw new Error(`${source} is not canonical JSON`);
  }
  return normalized;
}

export function normalizeReleaseEnvironmentPolicyReceipt(
  receipt,
  label = 'release environment policy receipt',
) {
  return normalizeReceipt(receipt, label);
}

export function assertReleaseEnvironmentPolicyReceiptCurrent(
  authorizedReceipt,
  currentReceipt,
) {
  const authorized = normalizeReceipt(
    authorizedReceipt,
    'authorized release environment policy receipt',
  );
  const current = normalizeReceipt(
    currentReceipt,
    'current release environment policy receipt',
  );
  const authorizedPolicy = {
    repository: authorized.repository,
    environments: authorized.environments,
    policyDigest: authorized.policyDigest,
  };
  const currentPolicy = {
    repository: current.repository,
    environments: current.environments,
    policyDigest: current.policyDigest,
  };
  if (
    serializeCanonicalJson(authorizedPolicy)
      !== serializeCanonicalJson(currentPolicy)
  ) {
    throw new Error(
      'Live GitHub release environment policy does not match the authorized receipt',
    );
  }
  return current;
}

export function verifyLiveReleaseEnvironmentPolicies({
  config,
  execute = execFileSync,
  env = process.env,
  now = () => new Date(),
} = {}) {
  const expectedPolicies = expectedEnvironmentPolicies(config);
  const executable = githubExecutable(env);
  const repository = runGitHubApi(
    execute,
    executable,
    'repos/OpenCoven/sdk',
    env,
    'Required GitHub repository OpenCoven/sdk',
  );
  const environments = expectedPolicies.map((expected) => {
    let environment;
    try {
      environment = runGitHubApi(
        execute,
        executable,
        `repos/OpenCoven/sdk/environments/${encodeURIComponent(expected.name)}`,
        env,
        `Required GitHub release environment ${expected.name}`,
      );
    } catch (error) {
      throw new Error(
        `Required GitHub release environment ${expected.name} is missing or unreadable`,
        { cause: error },
      );
    }
    return environment;
  });
  return createReleaseEnvironmentPolicyReceipt({
    repository,
    environments,
    verifiedAt: now().toISOString(),
    config,
  });
}
