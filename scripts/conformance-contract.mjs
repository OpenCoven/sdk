import { readFileSync } from 'node:fs';

const MAX_EVIDENCE_BYTES = 1_048_576;
const MAX_STRING_BYTES = 16_384;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;
const CANONICAL_PLATFORMS = Object.freeze([
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
]);
const CANONICAL_OPERATING_SYSTEMS = Object.freeze(['darwin', 'linux', 'win32']);
const CANONICAL_ARCHITECTURES = Object.freeze(['arm64', 'x64']);
const COVERAGE_SCOPES = Object.freeze(['cave', 'coven', 'sdk', 'chat']);
const NOT_COVERED_SCOPE_IDS = Object.freeze([
  'cross-process-pairing',
  'oauth-ui',
  'remote-peer',
  'write-apis',
]);
const SDK_TARBALLS = Object.freeze([
  '@opencoven/sdk-core',
  '@opencoven/cave-client',
  '@opencoven/coven-client',
  '@opencoven/sdk',
]);
const ISOLATION_ROOTS = Object.freeze([
  'cave-home',
  'coven-home',
  'consumer-home',
  'native-credential-store',
]);
const OPERATOR_STATE = Object.freeze([
  'cave-home',
  'coven-home',
  'native-credential-store',
  'projects',
]);
const FORBIDDEN_FIELDS = new Set([
  'attachment',
  'attachments',
  'authorization',
  'bearer',
  'body',
  'commandoutput',
  'content',
  'credential',
  'credentialvalue',
  'message',
  'messagebody',
  'pairingsecret',
  'prompt',
  'requestbody',
  'responsebody',
  'secret',
  'sockethandle',
  'stderr',
  'stdout',
]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u,
  /\b(?:authorization|x-coven-pairing-secret|x-coven-cave-token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/iu,
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,})\b/u,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?:$|[^A-Za-z0-9_-])/u,
];
const PRIVATE_PATH_PATTERNS = [
  /(?:^|[\s"'(])\/(?:Users|home|root|private|tmp)(?:\/|$)/u,
  /(?:^|[\s"'(])\/var\/(?:folders|tmp)(?:\/|$)/u,
  /(?:^|[\s"'(])\/(?:Applications|Library|System|Volumes|dev|etc|opt|run|srv|usr)(?:\/|$)/u,
  /(?:^|[\s"'(])[A-Za-z]:[\\/]/u,
  /\\\\(?:[.?]\\)?[A-Za-z0-9$_.-]+\\/u,
];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoDuplicateJsonKeys(text, source) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/u.test(text[index] ?? '')) index += 1;
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
    while (
      index < text.length
      && !/[\s,\]}]/u.test(text[index] ?? '')
    ) {
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

function expectExactObject(value, requiredKeys, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const keys = Object.keys(value);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${label} is missing required field ${JSON.stringify(key)}`);
    }
  }
  const required = new Set(requiredKeys);
  for (const key of keys) {
    if (!required.has(key)) {
      throw new Error(`${label} has unexpected field ${JSON.stringify(key)}`);
    }
  }
  return value;
}

function expectString(value, label, { pattern = null, maxBytes = 1_024 } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  if (pattern !== null && !pattern.test(value)) {
    throw new Error(`${label} is not canonical`);
  }
  return value;
}

function expectBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function expectInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

function expectStringArray(value, label, { maxEntries = 1_000 } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (value.length > maxEntries) {
    throw new Error(`${label} exceeds the ${maxEntries}-entry limit`);
  }
  return value.map((entry, index) =>
    expectString(entry, `${label}[${index}]`, { maxBytes: 4_096 }),
  );
}

function expectSha256(value, label) {
  return expectString(value, label, { pattern: /^[0-9a-f]{64}$/u, maxBytes: 64 });
}

function expectCommit(value, label) {
  return expectString(value, label, { pattern: /^[0-9a-f]{40}$/u, maxBytes: 40 });
}

function expectTimestamp(value, label) {
  const timestamp = expectString(value, label, { maxBytes: 32 });
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 timestamp`);
  }
  return timestamp;
}

function expectCrossAssertion(value, label) {
  const object = expectExactObject(
    value,
    ['id', 'result', 'diagnosticId'],
    label,
  );
  const id = expectString(object.id, `${label}.id`, {
    pattern: /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u,
    maxBytes: 160,
  });
  const result = expectString(object.result, `${label}.result`, { maxBytes: 8 });
  if (result !== 'pass' && result !== 'fail' && result !== 'skip') {
    throw new Error(`${label}.result must be pass, fail, or skip`);
  }
  return {
    id,
    result,
    diagnosticId: expectString(object.diagnosticId, `${label}.diagnosticId`, {
      pattern: /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u,
      maxBytes: 192,
    }),
  };
}

function expectCaveAssertion(value, label) {
  const object = expectExactObject(value, ['id', 'result', 'detail'], label);
  const result = expectString(object.result, `${label}.result`, { maxBytes: 8 });
  if (result !== 'pass' && result !== 'fail' && result !== 'skip') {
    throw new Error(`${label}.result must be pass, fail, or skip`);
  }
  return {
    id: expectString(object.id, `${label}.id`, {
      pattern: /^[A-Za-z0-9](?:[A-Za-z0-9._/:=-]*[A-Za-z0-9])?$/u,
      maxBytes: 192,
    }),
    result,
    detail:
      typeof object.detail === 'string'
        ? object.detail
        : (() => {
            throw new Error(`${label}.detail must be a string`);
          })(),
  };
}

function expectAssertionArray(value, label, parser) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (value.length > 1_000) {
    throw new Error(`${label} exceeds the 1000-entry limit`);
  }
  return value.map((entry, index) => parser(entry, `${label}[${index}]`));
}

function expectTarballs(value, label) {
  if (!Array.isArray(value) || value.length !== SDK_TARBALLS.length) {
    throw new Error(`${label} must contain the four canonical SDK tarballs`);
  }
  return value.map((entry, index) => {
    const object = expectExactObject(
      entry,
      ['packageName', 'sha256'],
      `${label}[${index}]`,
    );
    const packageName = expectString(
      object.packageName,
      `${label}[${index}].packageName`,
      { maxBytes: 64 },
    );
    if (packageName !== SDK_TARBALLS[index]) {
      throw new Error(`${label} must use canonical package order`);
    }
    return {
      packageName,
      sha256: expectSha256(object.sha256, `${label}[${index}].sha256`),
    };
  });
}

function expectCoverage(value, label) {
  const object = expectExactObject(value, COVERAGE_SCOPES, label);
  const coverage = {};
  for (const scopeId of COVERAGE_SCOPES) {
    if (object[scopeId] !== true) {
      throw new Error(`${label}.${scopeId} must be true`);
    }
    coverage[scopeId] = true;
  }
  return coverage;
}

function expectNotCovered(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (value.length > NOT_COVERED_SCOPE_IDS.length) {
    throw new Error(`${label} exceeds the allowlisted scope count`);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const object = expectExactObject(
      entry,
      ['scopeId', 'diagnosticId'],
      `${label}[${index}]`,
    );
    const scopeId = expectString(
      object.scopeId,
      `${label}[${index}].scopeId`,
      { maxBytes: 64 },
    );
    if (!NOT_COVERED_SCOPE_IDS.includes(scopeId)) {
      throw new Error(`${label} scopeId ${JSON.stringify(scopeId)} is not allowlisted`);
    }
    if (seen.has(scopeId)) {
      throw new Error(`${label} contains duplicate scopeId ${JSON.stringify(scopeId)}`);
    }
    seen.add(scopeId);
    return {
      scopeId,
      diagnosticId: expectString(
        object.diagnosticId,
        `${label}[${index}].diagnosticId`,
        {
          pattern: /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u,
          maxBytes: 192,
        },
      ),
    };
  });
}

function expectCaveRecord(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function expectIsolation(value, label) {
  const object = expectExactObject(
    value,
    [
      'strategy',
      'network',
      'sourceCheckoutDependency',
      'workspaceLinkDependency',
      'retainedPrivatePaths',
      'retainedSocketHandles',
      'roots',
      'operatorState',
    ],
    label,
  );
  if (!Array.isArray(object.roots)) {
    throw new Error(`${label}.roots must be an array`);
  }
  if (!Array.isArray(object.operatorState)) {
    throw new Error(`${label}.operatorState must be an array`);
  }
  return {
    strategy: expectString(object.strategy, `${label}.strategy`, { maxBytes: 64 }),
    network: expectString(object.network, `${label}.network`, { maxBytes: 32 }),
    sourceCheckoutDependency: expectBoolean(
      object.sourceCheckoutDependency,
      `${label}.sourceCheckoutDependency`,
    ),
    workspaceLinkDependency: expectBoolean(
      object.workspaceLinkDependency,
      `${label}.workspaceLinkDependency`,
    ),
    retainedPrivatePaths: expectBoolean(
      object.retainedPrivatePaths,
      `${label}.retainedPrivatePaths`,
    ),
    retainedSocketHandles: expectBoolean(
      object.retainedSocketHandles,
      `${label}.retainedSocketHandles`,
    ),
    roots: object.roots.map((entry, index) => {
      const root = expectExactObject(
        entry,
        ['id', 'ownershipVerified', 'removedAfterRun'],
        `${label}.roots[${index}]`,
      );
      return {
        id: expectString(root.id, `${label}.roots[${index}].id`, {
          maxBytes: 64,
        }),
        ownershipVerified: expectBoolean(
          root.ownershipVerified,
          `${label}.roots[${index}].ownershipVerified`,
        ),
        removedAfterRun: expectBoolean(
          root.removedAfterRun,
          `${label}.roots[${index}].removedAfterRun`,
        ),
      };
    }),
    operatorState: object.operatorState.map((entry, index) => {
      const state = expectExactObject(
        entry,
        ['id', 'beforeSha256', 'afterSha256'],
        `${label}.operatorState[${index}]`,
      );
      return {
        id: expectString(state.id, `${label}.operatorState[${index}].id`, {
          maxBytes: 64,
        }),
        beforeSha256: expectSha256(
          state.beforeSha256,
          `${label}.operatorState[${index}].beforeSha256`,
        ),
        afterSha256: expectSha256(
          state.afterSha256,
          `${label}.operatorState[${index}].afterSha256`,
        ),
      };
    }),
  };
}

function validatePlatformEvidence(value, source) {
  const object = expectExactObject(
    value,
    [
      'schemaVersion',
      'issue',
      'platform',
      'ranAt',
      'environment',
      'releases',
      'commits',
      'digests',
      'caveRecord',
      'sdkAssertions',
      'chatAssertions',
      'coverage',
      'notCovered',
      'isolation',
    ],
    source,
  );
  if (object.schemaVersion !== 1) {
    throw new Error(`${source}.schemaVersion must be 1`);
  }
  if (object.issue !== 'OpenCoven/sdk#38') {
    throw new Error(`${source}.issue must be "OpenCoven/sdk#38"`);
  }
  const environment = expectExactObject(
    object.environment,
    ['os', 'arch', 'nodeVersion', 'packageManagerVersion'],
    `${source}.environment`,
  );
  const releases = expectExactObject(
    object.releases,
    ['cave', 'coven'],
    `${source}.releases`,
  );
  const commits = expectExactObject(
    object.commits,
    ['cave', 'coven', 'sdk', 'chat'],
    `${source}.commits`,
  );
  const digests = expectExactObject(
    object.digests,
    [
      'caveAssertionEngine',
      'caveContractFixture',
      'hpkeVectors',
      'consumerLock',
      'assertionRegistry',
      'sdkTarballs',
    ],
    `${source}.digests`,
  );
  const platform = expectString(object.platform, `${source}.platform`, {
    maxBytes: 32,
  });
  if (!CANONICAL_PLATFORMS.includes(platform)) {
    throw new Error(`${source}.platform is not a canonical platform id`);
  }
  const os = expectString(environment.os, `${source}.environment.os`, {
    maxBytes: 16,
  });
  if (!CANONICAL_OPERATING_SYSTEMS.includes(os)) {
    throw new Error(`${source}.environment.os is not canonical`);
  }
  const arch = expectString(environment.arch, `${source}.environment.arch`, {
    maxBytes: 16,
  });
  if (!CANONICAL_ARCHITECTURES.includes(arch)) {
    throw new Error(`${source}.environment.arch is not canonical`);
  }
  const record = {
    schemaVersion: 1,
    issue: 'OpenCoven/sdk#38',
    platform,
    ranAt: expectTimestamp(object.ranAt, `${source}.ranAt`),
    environment: {
      os,
      arch,
      nodeVersion: expectString(
        environment.nodeVersion,
        `${source}.environment.nodeVersion`,
        { pattern: /^v24\.\d+\.\d+$/u, maxBytes: 32 },
      ),
      packageManagerVersion: expectString(
        environment.packageManagerVersion,
        `${source}.environment.packageManagerVersion`,
        { pattern: /^pnpm@10\.34\.0$/u, maxBytes: 32 },
      ),
    },
    releases: {
      cave: expectString(releases.cave, `${source}.releases.cave`, {
        maxBytes: 64,
      }),
      coven: expectString(releases.coven, `${source}.releases.coven`, {
        maxBytes: 64,
      }),
    },
    commits: {
      cave: expectCommit(commits.cave, `${source}.commits.cave`),
      coven: expectCommit(commits.coven, `${source}.commits.coven`),
      sdk: expectCommit(commits.sdk, `${source}.commits.sdk`),
      chat: expectCommit(commits.chat, `${source}.commits.chat`),
    },
    digests: {
      caveAssertionEngine: expectSha256(
        digests.caveAssertionEngine,
        `${source}.digests.caveAssertionEngine`,
      ),
      caveContractFixture: expectSha256(
        digests.caveContractFixture,
        `${source}.digests.caveContractFixture`,
      ),
      hpkeVectors: expectSha256(
        digests.hpkeVectors,
        `${source}.digests.hpkeVectors`,
      ),
      consumerLock: expectSha256(
        digests.consumerLock,
        `${source}.digests.consumerLock`,
      ),
      assertionRegistry: expectSha256(
        digests.assertionRegistry,
        `${source}.digests.assertionRegistry`,
      ),
      sdkTarballs: expectTarballs(
        digests.sdkTarballs,
        `${source}.digests.sdkTarballs`,
      ),
    },
    caveRecord: expectCaveRecord(object.caveRecord, `${source}.caveRecord`),
    sdkAssertions: expectAssertionArray(
      object.sdkAssertions,
      `${source}.sdkAssertions`,
      expectCrossAssertion,
    ),
    chatAssertions: expectAssertionArray(
      object.chatAssertions,
      `${source}.chatAssertions`,
      expectCrossAssertion,
    ),
    coverage: expectCoverage(object.coverage, `${source}.coverage`),
    notCovered: expectNotCovered(object.notCovered, `${source}.notCovered`),
    isolation: expectIsolation(object.isolation, `${source}.isolation`),
  };
  scanConformanceEvidence(record);
  return record;
}

function expectValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseConformanceAggregationArgs(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let caveRoot = null;
  let outputPath = null;
  const recordPaths = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--cave-root') {
      if (caveRoot !== null) throw new Error('Duplicate option --cave-root');
      caveRoot = expectValue(args, index, flag);
      index += 1;
      continue;
    }
    if (flag === '--record') {
      recordPaths.push(expectValue(args, index, flag));
      index += 1;
      continue;
    }
    if (flag === '--out') {
      if (outputPath !== null) throw new Error('Duplicate option --out');
      outputPath = expectValue(args, index, flag);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option ${flag}`);
  }
  if (caveRoot === null) throw new Error('Missing required option --cave-root');
  if (recordPaths.length !== CANONICAL_PLATFORMS.length) {
    throw new Error('Conformance aggregation requires exactly three --record values');
  }
  if (outputPath === null) throw new Error('Missing required option --out');
  return { caveRoot, recordPaths, outputPath };
}

export function scanConformanceEvidence(value) {
  let nodes = 0;
  const visit = (entry, path, depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      throw new Error(`Evidence exceeds the ${MAX_JSON_NODES}-node limit`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`Evidence exceeds the ${MAX_JSON_DEPTH}-level depth limit`);
    }
    if (typeof entry === 'string') {
      if (Buffer.byteLength(entry, 'utf8') > MAX_STRING_BYTES) {
        throw new Error(`${path} string exceeds the ${MAX_STRING_BYTES}-byte evidence limit`);
      }
      if (SECRET_PATTERNS.some((pattern) => pattern.test(entry))) {
        throw new Error(`${path} contains a possible secret`);
      }
      if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(entry))) {
        throw new Error(`${path} contains a private filesystem path`);
      }
      return;
    }
    if (
      entry === null
      || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry))
    ) {
      return;
    }
    if (Array.isArray(entry)) {
      for (let index = 0; index < entry.length; index += 1) {
        visit(entry[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }
    if (!isPlainObject(entry)) {
      throw new Error(`${path} contains a non-JSON value`);
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (FORBIDDEN_FIELDS.has(key.toLowerCase())) {
        throw new Error(`forbidden evidence field ${JSON.stringify(key)}`);
      }
      visit(nested, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, 'evidence', 0);
}

export function parsePlatformEvidence(text, source = 'platform evidence') {
  if (Buffer.byteLength(text, 'utf8') > MAX_EVIDENCE_BYTES) {
    throw new Error(`${source} exceeds the ${MAX_EVIDENCE_BYTES}-byte evidence limit`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source} is not valid JSON: ${message}`, { cause: error });
  }
  assertNoDuplicateJsonKeys(text, source);
  return validatePlatformEvidence(parsed, source);
}

function validateAssertionIds(ids, label) {
  const parsed = expectStringArray(ids, label);
  const seen = new Set();
  for (const id of parsed) {
    if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u.test(id)) {
      throw new Error(`${label} contains non-canonical assertion id ${JSON.stringify(id)}`);
    }
    if (seen.has(id)) {
      throw new Error(`${label} contains duplicate assertion id ${JSON.stringify(id)}`);
    }
    seen.add(id);
  }
  return parsed;
}

function validateAssertionRegistry(value, label = 'assertion registry') {
  const object = expectExactObject(
    value,
    ['schemaVersion', 'cave', 'sdk', 'chat'],
    label,
  );
  if (object.schemaVersion !== 1) {
    throw new Error(`${label}.schemaVersion must be 1`);
  }
  const cave = expectExactObject(
    object.cave,
    ['engine', 'requireIncludeTtl', 'requireAuthorityTakeover'],
    `${label}.cave`,
  );
  if (cave.engine !== 'scripts/client-v1-conformance.mjs') {
    throw new Error(`${label}.cave.engine must name Cave's authoritative harness`);
  }
  if (cave.requireIncludeTtl !== true || cave.requireAuthorityTakeover !== true) {
    throw new Error(`${label}.cave must require TTL and authority-takeover assertions`);
  }
  const chat = expectExactObject(
    object.chat,
    ['common', 'platforms'],
    `${label}.chat`,
  );
  const platforms = expectExactObject(
    chat.platforms,
    CANONICAL_PLATFORMS,
    `${label}.chat.platforms`,
  );
  const common = validateAssertionIds(chat.common, `${label}.chat.common`);
  const parsedPlatforms = {};
  for (const platform of CANONICAL_PLATFORMS) {
    const platformIds = validateAssertionIds(
      platforms[platform],
      `${label}.chat.platforms.${platform}`,
    );
    const commonSet = new Set(common);
    for (const id of platformIds) {
      if (commonSet.has(id)) {
        throw new Error(`${label} repeats common Chat assertion ${JSON.stringify(id)} for ${platform}`);
      }
    }
    parsedPlatforms[platform] = platformIds;
  }
  return {
    schemaVersion: 1,
    cave: {
      engine: cave.engine,
      requireIncludeTtl: true,
      requireAuthorityTakeover: true,
    },
    sdk: validateAssertionIds(object.sdk, `${label}.sdk`),
    chat: {
      common,
      platforms: parsedPlatforms,
    },
  };
}

export function parseAssertionRegistry(text, source = 'assertion registry') {
  let parsed;
  try {
    parsed = JSON.parse(text);
    assertNoDuplicateJsonKeys(text, source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${source}: ${message}`, {
      cause: error,
    });
  }
  return validateAssertionRegistry(parsed, source);
}

export function readAssertionRegistry(path) {
  try {
    return parseAssertionRegistry(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read assertion registry ${path}: ${message}`, {
      cause: error,
    });
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function equalJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function requireExactOrder(entries, expected, label) {
  const ids = entries.map(({ id }) => id);
  if (!equalJson(ids, expected)) {
    throw new Error(`${label} assertion order does not match the authoritative registry`);
  }
}

function checkAssertionGroup(engine, entries, expected, label) {
  const coverage = engine.checkAssertionCoverage(entries, expected);
  if (!Array.isArray(coverage) || coverage.some((entry) => typeof entry !== 'string')) {
    throw new Error('Cave assertion engine returned an invalid coverage result');
  }
  if (coverage.length > 0) {
    throw new Error(`${label} assertion coverage: ${coverage.join('; ')}`);
  }
  requireExactOrder(entries, expected, label);
  for (const entry of entries) {
    if (entry.result !== 'pass') {
      throw new Error(`${label} assertion ${JSON.stringify(entry.id)} did not pass`);
    }
  }
  const summary = engine.summarizeConformance(entries);
  if (
    !isPlainObject(summary)
    || summary.failed !== 0
    || summary.skipped !== 0
    || summary.passed !== entries.length
  ) {
    throw new Error(`${label} assertion summary is not a complete pass`);
  }
  return summary;
}

function validateEngine(engine) {
  if (!isPlainObject(engine)) {
    throw new Error('Cave assertion engine must be a module namespace object');
  }
  for (const name of [
    'expectedAssertionIds',
    'checkAssertionCoverage',
    'summarizeConformance',
    'renderConformanceRecord',
  ]) {
    if (typeof engine[name] !== 'function') {
      throw new Error(`Cave assertion engine is missing export ${name}`);
    }
  }
  if (
    typeof engine.COVERAGE_ASSERTION_ID !== 'string'
    || !Array.isArray(engine.NOT_COVERED)
    || !Array.isArray(engine.FINDINGS)
  ) {
    throw new Error('Cave assertion engine has invalid record exports');
  }
}

function validatePlatforms(platformRecords, canonicalPlatforms) {
  if (!equalJson(canonicalPlatforms, CANONICAL_PLATFORMS)) {
    throw new Error('Canonical platforms must match darwin-arm64, linux-x64, and win32-x64');
  }
  const counts = new Map();
  for (const record of platformRecords) {
    counts.set(record.platform, (counts.get(record.platform) ?? 0) + 1);
  }
  for (const platform of counts.keys()) {
    if (!canonicalPlatforms.includes(platform)) {
      throw new Error(`unexpected platform ${JSON.stringify(platform)}`);
    }
  }
  for (const platform of canonicalPlatforms) {
    const count = counts.get(platform) ?? 0;
    if (count === 0) throw new Error(`missing platform ${JSON.stringify(platform)}`);
    if (count > 1) {
      throw new Error(`platform ${JSON.stringify(platform)} was recorded ${count} times`);
    }
  }
}

function validateIsolation(record) {
  const { platform, isolation } = record;
  if (isolation.strategy !== 'process-owned-temporary-roots') {
    throw new Error(`${platform} did not use process-owned temporary roots`);
  }
  if (isolation.network !== 'loopback-only') {
    throw new Error(`${platform} isolation network was not loopback-only`);
  }
  if (isolation.sourceCheckoutDependency) {
    throw new Error(`${platform} used a source-checkout dependency`);
  }
  if (isolation.workspaceLinkDependency) {
    throw new Error(`${platform} used a workspace-link dependency`);
  }
  if (isolation.retainedPrivatePaths) {
    throw new Error(`${platform} retained private filesystem paths`);
  }
  if (isolation.retainedSocketHandles) {
    throw new Error(`${platform} retained socket handles`);
  }
  requireExactOrder(isolation.roots, ISOLATION_ROOTS, `${platform} isolation roots`);
  for (const root of isolation.roots) {
    if (!root.ownershipVerified || !root.removedAfterRun) {
      throw new Error(`${platform} isolation root ${JSON.stringify(root.id)} was not owned and removed`);
    }
  }
  requireExactOrder(
    isolation.operatorState,
    OPERATOR_STATE,
    `${platform} operator state`,
  );
  for (const state of isolation.operatorState) {
    if (state.beforeSha256 !== state.afterSha256) {
      throw new Error(`${platform} operator state ${JSON.stringify(state.id)} changed`);
    }
  }
}

function validateCaveRecord(record, engine, expectedCaveIds) {
  const { platform, caveRecord } = record;
  const ranAt = expectTimestamp(caveRecord.ranAt, `${platform} Cave record ranAt`);
  const caveVersion = expectString(
    caveRecord.caveVersion,
    `${platform} Cave record caveVersion`,
    { maxBytes: 64 },
  );
  const commit = expectCommit(caveRecord.commit, `${platform} Cave record commit`);
  const recordPlatform = expectString(
    caveRecord.platform,
    `${platform} Cave record platform`,
    { maxBytes: 32 },
  );
  const nodeVersion = expectString(
    caveRecord.nodeVersion,
    `${platform} Cave record nodeVersion`,
    { pattern: /^v24\.\d+\.\d+$/u, maxBytes: 32 },
  );
  const includeTtl = expectBoolean(
    caveRecord.includeTtl,
    `${platform} Cave record includeTtl`,
  );
  const takeover = expectExactObject(
    caveRecord.authorityTakeover,
    ['authorityMode', 'discoveryVersion', 'mechanism'],
    `${platform} Cave record authorityTakeover`,
  );
  const authorityTakeover = {
    authorityMode: expectString(
      takeover.authorityMode,
      `${platform} Cave record authorityMode`,
      { maxBytes: 32 },
    ),
    discoveryVersion: expectInteger(
      takeover.discoveryVersion,
      `${platform} Cave record discoveryVersion`,
    ),
    mechanism: expectString(
      takeover.mechanism,
      `${platform} Cave record mechanism`,
      { maxBytes: 32 },
    ),
  };
  const assertions = expectAssertionArray(
    caveRecord.assertions,
    `${platform} Cave record assertions`,
    expectCaveAssertion,
  );
  if (
    ranAt !== record.ranAt
    || caveVersion !== record.releases.cave
    || commit !== record.commits.cave
    || recordPlatform !== platform
    || nodeVersion !== record.environment.nodeVersion
  ) {
    throw new Error(`${platform} Cave record does not match platform provenance`);
  }
  if (!includeTtl) {
    throw new Error(`${platform} Cave record did not include the TTL assertions`);
  }
  if (
    authorityTakeover.authorityMode !== 'enforce'
    || authorityTakeover.discoveryVersion !== 2
    || authorityTakeover.mechanism !== 'hpke-bound-v1'
  ) {
    throw new Error(`${platform} Cave record did not include the authority-takeover proof`);
  }
  const expectedWithCoverage = [
    ...expectedCaveIds,
    engine.COVERAGE_ASSERTION_ID,
  ];
  const coverage = engine.checkAssertionCoverage(
    assertions,
    expectedCaveIds,
  );
  if (!Array.isArray(coverage) || coverage.some((entry) => typeof entry !== 'string')) {
    throw new Error('Cave assertion engine returned an invalid coverage result');
  }
  if (coverage.length > 0) {
    throw new Error(`${platform} Cave assertion coverage: ${coverage.join('; ')}`);
  }
  requireExactOrder(
    assertions,
    expectedWithCoverage,
    `${platform} Cave`,
  );
  for (const entry of assertions) {
    if (entry.result !== 'pass') {
      throw new Error(`${platform} Cave assertion ${JSON.stringify(entry.id)} did not pass`);
    }
  }
  const summary = engine.summarizeConformance(assertions);
  if (
    !isPlainObject(summary)
    || summary.failed !== 0
    || summary.skipped !== 0
    || summary.passed !== assertions.length
  ) {
    throw new Error(`${platform} Cave assertion summary is not a complete pass`);
  }
  const authoritativeRecord = engine.renderConformanceRecord(assertions, {
    ranAt,
    caveVersion,
    commit,
    platform: recordPlatform,
    includeTtl,
    authorityTakeover,
    notCovered: engine.NOT_COVERED,
    findings: engine.FINDINGS,
  });
  if (!isPlainObject(authoritativeRecord)) {
    throw new Error('Cave assertion engine returned an invalid record');
  }
  const comparableRecord = {
    ...authoritativeRecord,
    nodeVersion,
  };
  if (!equalJson(caveRecord, comparableRecord)) {
    throw new Error(`${platform} Cave record does not match the authoritative renderer`);
  }
  return summary;
}

export function aggregateConformanceEvidence(input) {
  const registry = validateAssertionRegistry(input.registry);
  validateEngine(input.caveEngine);
  const caveEngineSha256 = expectSha256(
    input.caveEngineSha256,
    'loaded Cave assertion engine digest',
  );
  const assertionRegistrySha256 = expectSha256(
    input.assertionRegistrySha256,
    'committed assertion registry digest',
  );
  const normalizedRecords = input.platformRecords.map((record, index) =>
    validatePlatformEvidence(
      record,
      typeof record?.platform === 'string'
        ? record.platform
        : `platformRecords[${index}]`,
    ),
  );
  validatePlatforms(normalizedRecords, [...input.canonicalPlatforms]);
  const records = input.canonicalPlatforms.map((platform) => {
    const record = normalizedRecords.find((entry) => entry.platform === platform);
    if (record === undefined) throw new Error(`missing platform ${JSON.stringify(platform)}`);
    return record;
  });
  const baseline = records[0];
  if (baseline === undefined) throw new Error('No conformance records were provided');
  const expectedCaveIds = input.caveEngine.expectedAssertionIds(true, true);
  if (!Array.isArray(expectedCaveIds) || expectedCaveIds.length === 0) {
    throw new Error('Cave assertion engine returned no expected assertion ids');
  }

  let caveAssertions = 0;
  let sdkAssertions = 0;
  let chatAssertions = 0;
  for (const record of records) {
    const expectedPlatform = `${record.environment.os}-${record.environment.arch}`;
    if (record.platform !== expectedPlatform) {
      throw new Error(`${record.platform} does not match its OS and architecture`);
    }
    if (record.digests.caveAssertionEngine !== caveEngineSha256) {
      throw new Error(`${record.platform} Cave assertion engine digest does not match the loaded engine`);
    }
    if (record.digests.assertionRegistry !== assertionRegistrySha256) {
      throw new Error(`${record.platform} assertion registry digest does not match the committed registry`);
    }
    if (!equalJson(record.releases, baseline.releases)) {
      throw new Error(`${record.platform} releases do not match ${baseline.platform}`);
    }
    if (!equalJson(record.commits, baseline.commits)) {
      throw new Error(`${record.platform} commits do not match ${baseline.platform}`);
    }
    if (!equalJson(record.digests, baseline.digests)) {
      throw new Error(`${record.platform} digests do not match ${baseline.platform}`);
    }
    caveAssertions += validateCaveRecord(
      record,
      input.caveEngine,
      expectedCaveIds,
    ).passed;
    sdkAssertions += checkAssertionGroup(
      input.caveEngine,
      record.sdkAssertions,
      registry.sdk,
      `${record.platform} SDK`,
    ).passed;
    const expectedChatIds = [
      ...registry.chat.common,
      ...registry.chat.platforms[record.platform],
    ];
    chatAssertions += checkAssertionGroup(
      input.caveEngine,
      record.chatAssertions,
      expectedChatIds,
      `${record.platform} Chat`,
    ).passed;
    validateIsolation(record);
  }

  const aggregate = {
    schemaVersion: 1,
    issue: 'OpenCoven/sdk#38',
    kind: 'client-v1-cross-repository-conformance',
    canonicalPlatforms: [...input.canonicalPlatforms],
    caveAssertionAuthority: {
      repository: 'OpenCoven/coven-cave',
      path: registry.cave.engine,
      commit: baseline.commits.cave,
      sha256: caveEngineSha256,
    },
    assertionRegistryAuthority: {
      path: 'conformance/client-v1-cross-repository-assertions.json',
      commit: baseline.commits.sdk,
      sha256: assertionRegistrySha256,
    },
    candidate: {
      releases: baseline.releases,
      commits: baseline.commits,
      digests: baseline.digests,
    },
    platforms: records,
    summary: {
      status: 'passed',
      platforms: records.length,
      caveAssertions,
      sdkAssertions,
      chatAssertions,
      failed: 0,
      skipped: 0,
    },
  };
  scanConformanceEvidence(aggregate);
  return aggregate;
}
