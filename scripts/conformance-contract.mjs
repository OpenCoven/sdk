import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCK_PATH = resolve(
  repositoryRoot,
  'conformance/client-v1-cross-repository-lock.json',
);
const DEFAULT_REGISTRY_PATH = resolve(
  repositoryRoot,
  'conformance/client-v1-cross-repository-assertions.json',
);
const DEFAULT_SCHEMA_PATH = resolve(
  repositoryRoot,
  'conformance/client-v1-cross-repository-evidence.schema.json',
);
const EVIDENCE_SCHEMA_ID =
  'urn:opencoven:schema:client-v1-cross-repository-platform-evidence:2';
const EVIDENCE_SCHEMA_PATH =
  'conformance/client-v1-cross-repository-evidence.schema.json';
const MAX_EVIDENCE_BYTES = 1_048_576;
const MAX_STRING_BYTES = 16_384;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;
const CANONICAL_PLATFORMS = Object.freeze([
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
]);
const PROTECTED_WORKFLOW_RUNNER_LABELS = Object.freeze({
  'darwin-arm64': Object.freeze(['macos-14']),
  'linux-x64': Object.freeze(['ubuntu-24.04']),
  'win32-x64': Object.freeze(['windows-2025']),
});
const REQUIRED_SUBJECTS = Object.freeze(['cave', 'coven', 'sdk', 'chat']);
const SDK_PACKAGE_NAMES = Object.freeze([
  '@opencoven/sdk-core',
  '@opencoven/cave-client',
  '@opencoven/coven-client',
  '@opencoven/sdk',
]);
const CANDIDATE_CAVE_FILE_PATHS = Object.freeze([
  'packages/cave/fixtures/contract-fixture.json',
  'packages/cave/fixtures/contract-fixture.sha256',
  'packages/cave/fixtures/contract-fixture.provenance.json',
  'packages/cave/fixtures/hpke-bound-v1-vectors.json',
  'packages/cave/fixtures/hpke-bound-v1-vectors.sha256',
]);
const CAVE_AUTHORITY_FILE_PATHS = Object.freeze([
  'scripts/client-v1-conformance.mjs',
  'src/lib/server/client-v1/contract-fixture.json',
  'src/lib/server/client-v1/contract-fixture.sha256',
  'src/lib/server/client-v1/hpke-bound-v1-vectors.json',
  'src/lib/server/client-v1/hpke-bound-v1-vectors.sha256',
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
const COMPLETE_NOT_COVERED = Object.freeze([
  Object.freeze({
    scopeId: 'cross-process-pairing',
    diagnosticId: 'phase1.scope.cross-process-pairing.not-covered',
  }),
  Object.freeze({
    scopeId: 'oauth-ui',
    diagnosticId: 'phase1.scope.oauth-ui.not-covered',
  }),
  Object.freeze({
    scopeId: 'remote-peer',
    diagnosticId: 'phase1.scope.remote-peer.not-covered',
  }),
  Object.freeze({
    scopeId: 'write-apis',
    diagnosticId: 'phase1.scope.write-apis.not-covered',
  }),
]);
const PLATFORM_ENVIRONMENT = Object.freeze({
  'darwin-arm64': Object.freeze({
    os: 'darwin',
    arch: 'arm64',
    nativeCustody: 'macos-keychain',
    covenIdentity: 'unix-peer-credentials',
  }),
  'linux-x64': Object.freeze({
    os: 'linux',
    arch: 'x64',
    nativeCustody: 'linux-keyring',
    covenIdentity: 'unix-peer-credentials',
  }),
  'win32-x64': Object.freeze({
    os: 'win32',
    arch: 'x64',
    nativeCustody: 'windows-credential-manager',
    covenIdentity: 'windows-named-pipe-client-identity',
  }),
});
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u;
const CAVE_ASSERTION_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._/:=-]*[A-Za-z0-9])?$/u;
const RELATIVE_PATH_PATTERN =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9@._/-]+$/u;
const FORBIDDEN_KEY_PARTS = Object.freeze([
  'pairingsecret',
  'authorization',
  'bearer',
  'token',
  'password',
  'credential',
  'privatekey',
  'apikey',
  'prompt',
  'message',
  'content',
  'attachment',
  'commandoutput',
  'privatecause',
  'header',
  'url',
  'sockethandle',
  'pipehandle',
  'rawdiagnostic',
  'requestbody',
  'responsebody',
  'stdout',
  'stderr',
]);
const FORBIDDEN_KEY_EXCEPTIONS = new Set([
  'diagnosticid',
  'operatorstate',
  'nativecustody',
  'covenidentity',
  'invocationid',
  'opaqueid',
  'retainedsockethandles',
]);
const SECRET_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u,
  /\b(?:authorization|x-coven-pairing-secret|x-coven-cave-token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/iu,
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,})\b/u,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?:$|[^A-Za-z0-9_-])/u,
]);
const PRIVATE_VALUE_PATTERNS = Object.freeze([
  /(?:^|[^A-Za-z0-9])\/{1,2}[^\s"'()]*/u,
  /(?:^|[^A-Za-z0-9])~\//u,
  /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/u,
  /(?:^|[^A-Za-z0-9])\\\\/u,
  /(?:^|[^A-Za-z0-9])\\\?\?\\/u,
  /(?:^|[^A-Za-z0-9])(?:npipe|pipe):/iu,
  /(?:^|[^A-Za-z0-9])file:/iu,
  /(?:^|[^A-Za-z0-9])@[A-Za-z0-9._-]+(?:$|[^A-Za-z0-9._-])/u,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:user(?:name)?|operator|hostname|computername|machineid)\s*[:=]\s*\S+/iu,
]);
const CAVE_ROUTE_TEXT_PATH =
  /^evidence(?:\.platforms\[\d+\])?\.caveRecord\.(?:notCovered\[\d+\]|findings\[\d+\]\.(?:where|says|measured|why))$/u;
const CAVE_ROUTE_LITERALS = Object.freeze([
  '/api/client/v1',
  '/familiars',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
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

export function parseJsonText(
  text,
  source,
  maxBytes = MAX_EVIDENCE_BYTES,
) {
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
  return parsed;
}

function expectExactObject(value, requiredKeys, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${label} is missing required field ${JSON.stringify(key)}`);
    }
  }
  const required = new Set(requiredKeys);
  for (const key of Object.keys(value)) {
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

function expectOptionalString(value, label, { maxBytes = 4_096 } = {}) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  return value;
}

function expectBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function expectInteger(
  value,
  label,
  { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function expectSha256(value, label) {
  return expectString(value, label, {
    pattern: /^[0-9a-f]{64}$/u,
    maxBytes: 64,
  });
}

function expectGitOid(value, label) {
  return expectString(value, label, {
    pattern: /^[0-9a-f]{40}$/u,
    maxBytes: 40,
  });
}

function expectTimestamp(value, label) {
  const timestamp = expectString(value, label, { maxBytes: 32 });
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 timestamp`);
  }
  return timestamp;
}

function expectRelativePath(value, label) {
  return expectString(value, label, {
    pattern: RELATIVE_PATH_PATTERN,
    maxBytes: 256,
  });
}

function expectRepository(value, label) {
  return expectString(value, label, {
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    maxBytes: 64,
  });
}

function expectFileMetadata(value, label, expectedPath = null) {
  const object = expectExactObject(value, ['path', 'size', 'sha256'], label);
  const path = expectRelativePath(object.path, `${label}.path`);
  if (expectedPath !== null && path !== expectedPath) {
    throw new Error(`${label}.path must be ${expectedPath}`);
  }
  return {
    path,
    size: expectInteger(object.size, `${label}.size`, {
      minimum: 1,
      maximum: 16_777_216,
    }),
    sha256: expectSha256(object.sha256, `${label}.sha256`),
  };
}

function expectIdentity(value, label, expectedRepository = null) {
  const object = expectExactObject(value, ['repository', 'commit', 'tree'], label);
  const repository = expectRepository(object.repository, `${label}.repository`);
  if (expectedRepository !== null && repository !== expectedRepository) {
    throw new Error(`${label}.repository must be ${expectedRepository}`);
  }
  return {
    repository,
    commit: expectGitOid(object.commit, `${label}.commit`),
    tree: expectGitOid(object.tree, `${label}.tree`),
  };
}

function expectOrderedArray(value, expectedLength, label, parser) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(`${label} must contain exactly ${expectedLength} entries`);
  }
  return value.map((entry, index) => parser(entry, index));
}

function expectReleaseManifest(value, label) {
  const object = expectExactObject(
    value,
    ['file', 'version', 'size', 'sha256'],
    label,
  );
  return {
    file: expectString(object.file, `${label}.file`, { maxBytes: 64 }),
    version: expectString(object.version, `${label}.version`, { maxBytes: 32 }),
    size: expectInteger(object.size, `${label}.size`, {
      minimum: 1,
      maximum: MAX_EVIDENCE_BYTES,
    }),
    sha256: expectSha256(object.sha256, `${label}.sha256`),
  };
}

function expectSdkPackages(value, label) {
  return expectOrderedArray(
    value,
    SDK_PACKAGE_NAMES.length,
    label,
    (entry, index) => {
      const object = expectExactObject(
        entry,
        ['packageName', 'version', 'releaseFile', 'vendorPath', 'size', 'sha256'],
        `${label}[${index}]`,
      );
      const packageName = expectString(
        object.packageName,
        `${label}[${index}].packageName`,
        { maxBytes: 64 },
      );
      if (packageName !== SDK_PACKAGE_NAMES[index]) {
        throw new Error(`${label} must use canonical package order`);
      }
      return {
        packageName,
        version: expectString(object.version, `${label}[${index}].version`, {
          maxBytes: 32,
        }),
        releaseFile: expectRelativePath(
          object.releaseFile,
          `${label}[${index}].releaseFile`,
        ),
        vendorPath: expectRelativePath(
          object.vendorPath,
          `${label}[${index}].vendorPath`,
        ),
        size: expectInteger(object.size, `${label}[${index}].size`, {
          minimum: 1,
          maximum: 16_777_216,
        }),
        sha256: expectSha256(
          object.sha256,
          `${label}[${index}].sha256`,
        ),
      };
    },
  );
}

function expectVendorFiles(value, label) {
  return expectOrderedArray(
    value,
    SDK_PACKAGE_NAMES.length,
    label,
    (entry, index) => {
      const object = expectExactObject(
        entry,
        ['packageName', 'path', 'size', 'sha256'],
        `${label}[${index}]`,
      );
      const packageName = expectString(
        object.packageName,
        `${label}[${index}].packageName`,
        { maxBytes: 64 },
      );
      if (packageName !== SDK_PACKAGE_NAMES[index]) {
        throw new Error(`${label} must use canonical package order`);
      }
      return {
        packageName,
        path: expectRelativePath(object.path, `${label}[${index}].path`),
        size: expectInteger(object.size, `${label}[${index}].size`, {
          minimum: 1,
          maximum: 16_777_216,
        }),
        sha256: expectSha256(
          object.sha256,
          `${label}[${index}].sha256`,
        ),
      };
    },
  );
}

function expectFixedPathFiles(value, paths, label) {
  return expectOrderedArray(value, paths.length, label, (entry, index) =>
    expectFileMetadata(entry, `${label}[${index}]`, paths[index]),
  );
}

function expectEvidenceSchemaMetadata(value, label) {
  const object = expectExactObject(
    value,
    ['identity', 'path', 'version', 'size', 'sha256'],
    label,
  );
  const metadata = {
    identity: expectString(object.identity, `${label}.identity`, {
      maxBytes: 128,
    }),
    path: expectRelativePath(object.path, `${label}.path`),
    version: expectInteger(object.version, `${label}.version`, {
      minimum: 1,
      maximum: 1_000,
    }),
    size: expectInteger(object.size, `${label}.size`, {
      minimum: 1,
      maximum: MAX_EVIDENCE_BYTES,
    }),
    sha256: expectSha256(object.sha256, `${label}.sha256`),
  };
  if (
    metadata.identity !== EVIDENCE_SCHEMA_ID
    || metadata.path !== EVIDENCE_SCHEMA_PATH
    || metadata.version !== 2
  ) {
    throw new Error(`${label} must identify the immutable schema-v2 contract`);
  }
  return metadata;
}

function expectRunnerLabelList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error(`${label} must be a non-empty bounded array`);
  }
  const labels = value.map((entry, index) =>
    expectString(entry, `${label}[${index}]`, {
      pattern: IDENTIFIER_PATTERN,
      maxBytes: 64,
    }),
  );
  if (
    new Set(labels).size !== labels.length
    || labels.includes('self-hosted')
  ) {
    throw new Error(`${label} must identify unique GitHub-hosted runner labels`);
  }
  return labels;
}

function expectRunnerLabels(value, label) {
  const object = expectExactObject(value, CANONICAL_PLATFORMS, label);
  return Object.fromEntries(
    CANONICAL_PLATFORMS.map((platform) => [
      platform,
      expectRunnerLabelList(object[platform], `${label}.${platform}`),
    ]),
  );
}

function expectWorkflowArtifacts(value, label) {
  if (!Array.isArray(value) || value.length !== CANONICAL_PLATFORMS.length) {
    throw new Error(`${label} must identify every canonical platform artifact`);
  }
  return value.map((entry, index) => {
    const artifactLabel = `${label}[${index}]`;
    const object = expectExactObject(
      entry,
      ['platform', 'name', 'recordPath'],
      artifactLabel,
    );
    const platform = expectString(
      object.platform,
      `${artifactLabel}.platform`,
      { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
    );
    const expectedPlatform = CANONICAL_PLATFORMS[index];
    const artifact = {
      platform,
      name: expectString(object.name, `${artifactLabel}.name`, {
        pattern: IDENTIFIER_PATTERN,
        maxBytes: 192,
      }),
      recordPath: expectRelativePath(
        object.recordPath,
        `${artifactLabel}.recordPath`,
      ),
    };
    if (
      platform !== expectedPlatform
      || artifact.name !== `client-v1-conformance-${platform}`
      || artifact.recordPath
        !== `.artifacts/client-v1-conformance-${platform}.json`
    ) {
      throw new Error(`${artifactLabel} does not identify the static platform artifact`);
    }
    return artifact;
  });
}

function expectPinnedAction(value, label) {
  return expectString(value, label, {
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u,
    maxBytes: 192,
  });
}

function expectEvidenceProducer(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (value.status === 'blocked') {
    const object = expectExactObject(
      value,
      [
        'status',
        'blockerId',
        'repository',
        'commit',
        'tree',
        'packageManifest',
        'availableHarness',
        'availableCommand',
        'requiredRecordSchemaVersion',
      ],
      label,
    );
    const producer = {
      status: 'blocked',
      blockerId: expectString(object.blockerId, `${label}.blockerId`, {
        pattern: IDENTIFIER_PATTERN,
        maxBytes: 192,
      }),
      repository: expectRepository(
        object.repository,
        `${label}.repository`,
      ),
      commit: expectGitOid(object.commit, `${label}.commit`),
      tree: expectGitOid(object.tree, `${label}.tree`),
      packageManifest: expectFileMetadata(
        object.packageManifest,
        `${label}.packageManifest`,
        'package.json',
      ),
      availableHarness: expectFileMetadata(
        object.availableHarness,
        `${label}.availableHarness`,
        'scripts/contract-canary.mjs',
      ),
      availableCommand: expectString(
        object.availableCommand,
        `${label}.availableCommand`,
        { maxBytes: 64 },
      ),
      requiredRecordSchemaVersion: expectInteger(
        object.requiredRecordSchemaVersion,
        `${label}.requiredRecordSchemaVersion`,
        { minimum: 1, maximum: 1_000 },
      ),
    };
    if (
      producer.blockerId
        !== 'frozen-chat-commit-has-no-platform-evidence-producer'
      || producer.repository !== 'OpenCoven/chat'
      || producer.availableCommand !== 'test:contract-canary'
      || producer.requiredRecordSchemaVersion !== 2
    ) {
      throw new Error(`${label} does not describe the reviewed Chat blocker`);
    }
    return producer;
  }
  if (value.status === 'compatible') {
    const object = expectExactObject(
      value,
      [
        'status',
        'repository',
        'commit',
        'tree',
        'packageManifest',
        'harness',
        'command',
        'recordSchemaVersion',
        'workflow',
      ],
      label,
    );
    const workflow = expectExactObject(
      object.workflow,
      [
        'name',
        'path',
        'size',
        'sha256',
        'job',
        'jobNameTemplate',
        'aggregationJob',
        'aggregationJobName',
        'aggregationRunnerLabels',
        'validationJob',
        'validationJobName',
        'attestationJob',
        'attestationJobName',
        'environment',
        'environmentId',
        'artifactNameTemplate',
        'recordPathTemplate',
        'artifacts',
        'downloadArtifactAction',
        'attestationAction',
        'windowsBootstrapScriptSha256',
        'validatorRevisionScriptSha256',
        'phase1RevisionsScriptSha256',
        'linuxKeyringSetupScriptSha256',
        'unixSupervisorPreparationScriptSha256',
        'unixProductionScriptSha256',
        'unixValidationScriptSha256',
        'validationScriptSha256',
        'attestationScriptSha256',
        'validatorRevisionEnvironment',
        'sourceRef',
        'runnerLabels',
        'signerWorkflow',
        'signerDigest',
        'sourceDigest',
        'predicateType',
        'denySelfHostedRunners',
      ],
      `${label}.workflow`,
    );
    const producer = {
      status: 'compatible',
      repository: expectRepository(
        object.repository,
        `${label}.repository`,
      ),
      commit: expectGitOid(object.commit, `${label}.commit`),
      tree: expectGitOid(object.tree, `${label}.tree`),
      packageManifest: expectFileMetadata(
        object.packageManifest,
        `${label}.packageManifest`,
        'package.json',
      ),
      harness: (() => {
        const harness = expectExactObject(
          object.harness,
          ['path', 'version', 'size', 'sha256'],
          `${label}.harness`,
        );
        return {
          path: expectRelativePath(
            harness.path,
            `${label}.harness.path`,
          ),
          version: expectString(
            harness.version,
            `${label}.harness.version`,
            { maxBytes: 32 },
          ),
          size: expectInteger(harness.size, `${label}.harness.size`, {
            minimum: 1,
            maximum: 16_777_216,
          }),
          sha256: expectSha256(
            harness.sha256,
            `${label}.harness.sha256`,
          ),
        };
      })(),
      command: expectString(object.command, `${label}.command`, {
        maxBytes: 64,
      }),
      recordSchemaVersion: expectInteger(
        object.recordSchemaVersion,
        `${label}.recordSchemaVersion`,
        { minimum: 1, maximum: 1_000 },
      ),
      workflow: {
        name: expectString(
          workflow.name,
          `${label}.workflow.name`,
          { maxBytes: 128 },
        ),
        path: expectRelativePath(
          workflow.path,
          `${label}.workflow.path`,
        ),
        size: expectInteger(
          workflow.size,
          `${label}.workflow.size`,
          { minimum: 1, maximum: 4 * 1024 * 1024 },
        ),
        sha256: expectSha256(
          workflow.sha256,
          `${label}.workflow.sha256`,
        ),
        job: expectString(workflow.job, `${label}.workflow.job`, {
          pattern: IDENTIFIER_PATTERN,
          maxBytes: 64,
        }),
        jobNameTemplate: expectString(
          workflow.jobNameTemplate,
          `${label}.workflow.jobNameTemplate`,
          { maxBytes: 192 },
        ),
        aggregationJob: expectString(
          workflow.aggregationJob,
          `${label}.workflow.aggregationJob`,
          { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
        ),
        aggregationJobName: expectString(
          workflow.aggregationJobName,
          `${label}.workflow.aggregationJobName`,
          { maxBytes: 192 },
        ),
        aggregationRunnerLabels: expectRunnerLabelList(
          workflow.aggregationRunnerLabels,
          `${label}.workflow.aggregationRunnerLabels`,
        ),
        validationJob: expectString(
          workflow.validationJob,
          `${label}.workflow.validationJob`,
          { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
        ),
        validationJobName: expectString(
          workflow.validationJobName,
          `${label}.workflow.validationJobName`,
          { maxBytes: 192 },
        ),
        attestationJob: expectString(
          workflow.attestationJob,
          `${label}.workflow.attestationJob`,
          { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
        ),
        attestationJobName: expectString(
          workflow.attestationJobName,
          `${label}.workflow.attestationJobName`,
          { maxBytes: 192 },
        ),
        environment: expectString(
          workflow.environment,
          `${label}.workflow.environment`,
          { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
        ),
        environmentId: expectString(
          workflow.environmentId,
          `${label}.workflow.environmentId`,
          { pattern: /^[1-9]\d*$/u, maxBytes: 32 },
        ),
        artifactNameTemplate: expectString(
          workflow.artifactNameTemplate,
          `${label}.workflow.artifactNameTemplate`,
          { maxBytes: 192 },
        ),
        recordPathTemplate: expectString(
          workflow.recordPathTemplate,
          `${label}.workflow.recordPathTemplate`,
          { maxBytes: 256 },
        ),
        artifacts: expectWorkflowArtifacts(
          workflow.artifacts,
          `${label}.workflow.artifacts`,
        ),
        downloadArtifactAction: expectPinnedAction(
          workflow.downloadArtifactAction,
          `${label}.workflow.downloadArtifactAction`,
        ),
        attestationAction: expectPinnedAction(
          workflow.attestationAction,
          `${label}.workflow.attestationAction`,
        ),
        windowsBootstrapScriptSha256: expectSha256(
          workflow.windowsBootstrapScriptSha256,
          `${label}.workflow.windowsBootstrapScriptSha256`,
        ),
        validatorRevisionScriptSha256: expectSha256(
          workflow.validatorRevisionScriptSha256,
          `${label}.workflow.validatorRevisionScriptSha256`,
        ),
        phase1RevisionsScriptSha256: expectSha256(
          workflow.phase1RevisionsScriptSha256,
          `${label}.workflow.phase1RevisionsScriptSha256`,
        ),
        linuxKeyringSetupScriptSha256: expectSha256(
          workflow.linuxKeyringSetupScriptSha256,
          `${label}.workflow.linuxKeyringSetupScriptSha256`,
        ),
        unixSupervisorPreparationScriptSha256: expectSha256(
          workflow.unixSupervisorPreparationScriptSha256,
          `${label}.workflow.unixSupervisorPreparationScriptSha256`,
        ),
        unixProductionScriptSha256: expectSha256(
          workflow.unixProductionScriptSha256,
          `${label}.workflow.unixProductionScriptSha256`,
        ),
        unixValidationScriptSha256: expectSha256(
          workflow.unixValidationScriptSha256,
          `${label}.workflow.unixValidationScriptSha256`,
        ),
        validationScriptSha256: expectSha256(
          workflow.validationScriptSha256,
          `${label}.workflow.validationScriptSha256`,
        ),
        attestationScriptSha256: expectSha256(
          workflow.attestationScriptSha256,
          `${label}.workflow.attestationScriptSha256`,
        ),
        validatorRevisionEnvironment: expectString(
          workflow.validatorRevisionEnvironment,
          `${label}.workflow.validatorRevisionEnvironment`,
          { pattern: /^[A-Z][A-Z0-9_]*$/u, maxBytes: 128 },
        ),
        sourceRef: expectString(
          workflow.sourceRef,
          `${label}.workflow.sourceRef`,
          {
            pattern:
              /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u,
            maxBytes: 256,
          },
        ),
        runnerLabels: expectRunnerLabels(
          workflow.runnerLabels,
          `${label}.workflow.runnerLabels`,
        ),
        signerWorkflow: expectString(
          workflow.signerWorkflow,
          `${label}.workflow.signerWorkflow`,
          { maxBytes: 256 },
        ),
        signerDigest: expectGitOid(
          workflow.signerDigest,
          `${label}.workflow.signerDigest`,
        ),
        sourceDigest: expectGitOid(
          workflow.sourceDigest,
          `${label}.workflow.sourceDigest`,
        ),
        predicateType: expectString(
          workflow.predicateType,
          `${label}.workflow.predicateType`,
          { maxBytes: 128 },
        ),
        denySelfHostedRunners: expectBoolean(
          workflow.denySelfHostedRunners,
          `${label}.workflow.denySelfHostedRunners`,
        ),
      },
    };
    if (
      producer.repository !== 'OpenCoven/chat'
      || producer.command !== 'test:phase1-conformance'
      || producer.recordSchemaVersion !== 2
      || producer.harness.path !== 'scripts/phase1-conformance.mjs'
      || producer.workflow.name !== 'client-v1 conformance'
      || producer.workflow.path
        !== '.github/workflows/client-v1-conformance.yml'
      || producer.workflow.job !== 'platform-conformance'
      || producer.workflow.jobNameTemplate
        !== 'platform-conformance ({platform})'
      || producer.workflow.aggregationJob !== 'aggregate-conformance'
      || producer.workflow.aggregationJob === producer.workflow.job
      || producer.workflow.aggregationJobName !== 'aggregate-conformance'
      || JSON.stringify(producer.workflow.aggregationRunnerLabels)
        !== JSON.stringify(['ubuntu-24.04'])
      || producer.workflow.validationJob
        !== 'validate-conformance-artifacts'
      || producer.workflow.validationJobName
        !== 'validate-conformance-artifacts'
      || producer.workflow.attestationJob
        !== 'attest-conformance-artifacts'
      || producer.workflow.attestationJobName
        !== 'attest-conformance-artifacts'
      || producer.workflow.environment !== 'client-v1-conformance'
      || producer.workflow.artifactNameTemplate
        !== 'client-v1-conformance-{platform}'
      || producer.workflow.recordPathTemplate
        !== '.artifacts/client-v1-conformance-{platform}.json'
      || producer.workflow.downloadArtifactAction
        !== 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'
      || producer.workflow.attestationAction
        !== 'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8'
      || producer.workflow.validatorRevisionEnvironment
        !== 'CLIENT_V1_CONFORMANCE_VALIDATOR_REVISION'
      || producer.workflow.sourceRef !== 'refs/heads/main'
      || JSON.stringify(producer.workflow.runnerLabels)
        !== JSON.stringify(PROTECTED_WORKFLOW_RUNNER_LABELS)
      || producer.workflow.signerWorkflow
        !== `${producer.repository}/${producer.workflow.path}`
      || producer.workflow.signerDigest !== producer.commit
      || producer.workflow.sourceDigest !== producer.commit
      || producer.workflow.predicateType
        !== 'https://slsa.dev/provenance/v1'
      || producer.workflow.denySelfHostedRunners !== true
    ) {
      throw new Error(`${label} does not identify a schema-v2 Chat producer`);
    }
    return producer;
  }
  throw new Error(`${label}.status must be blocked or compatible`);
}

function validateFrozenConformanceLock(value, label) {
  const object = expectExactObject(
    value,
    [
      'schemaVersion',
      'issue',
      'platformMatrix',
      'evidenceSchema',
      'candidate',
      'sources',
      'evidenceProducer',
      'toolchain',
      'scanners',
      'assertionRegistry',
    ],
    label,
  );
  if (object.schemaVersion !== 2) {
    throw new Error(`${label}.schemaVersion must be 2`);
  }
  if (object.issue !== 'OpenCoven/sdk#38') {
    throw new Error(`${label}.issue must be "OpenCoven/sdk#38"`);
  }
  if (!equalJson(object.platformMatrix, CANONICAL_PLATFORMS)) {
    throw new Error(`${label}.platformMatrix must use the canonical platform order`);
  }
  const evidenceSchema = expectEvidenceSchemaMetadata(
    object.evidenceSchema,
    `${label}.evidenceSchema`,
  );
  const candidateObject = expectExactObject(
    object.candidate,
    [
      'repository',
      'commit',
      'tree',
      'releaseManifest',
      'sdkPackages',
      'cavePackageFiles',
    ],
    `${label}.candidate`,
  );
  const candidate = {
    repository: expectRepository(
      candidateObject.repository,
      `${label}.candidate.repository`,
    ),
    commit: expectGitOid(candidateObject.commit, `${label}.candidate.commit`),
    tree: expectGitOid(candidateObject.tree, `${label}.candidate.tree`),
    releaseManifest: expectReleaseManifest(
      candidateObject.releaseManifest,
      `${label}.candidate.releaseManifest`,
    ),
    sdkPackages: expectSdkPackages(
      candidateObject.sdkPackages,
      `${label}.candidate.sdkPackages`,
    ),
    cavePackageFiles: expectFixedPathFiles(
      candidateObject.cavePackageFiles,
      CANDIDATE_CAVE_FILE_PATHS,
      `${label}.candidate.cavePackageFiles`,
    ),
  };
  if (candidate.repository !== 'OpenCoven/sdk') {
    throw new Error(`${label}.candidate.repository must be OpenCoven/sdk`);
  }
  const manifestBytes = `${JSON.stringify(
    {
      schemaVersion: 1,
      version: candidate.releaseManifest.version,
      packages: candidate.sdkPackages.map((entry) => ({
        name: entry.packageName,
        version: entry.version,
        file: entry.releaseFile,
        size: entry.size,
        sha256: entry.sha256,
      })),
    },
    null,
    2,
  )}\n`;
  if (
    candidate.releaseManifest.file !== 'release-manifest.json'
    || Buffer.byteLength(manifestBytes, 'utf8') !== candidate.releaseManifest.size
    || sha256(manifestBytes) !== candidate.releaseManifest.sha256
  ) {
    throw new Error(`${label} release manifest metadata is not canonical`);
  }
  for (const entry of candidate.sdkPackages) {
    if (entry.version !== candidate.releaseManifest.version) {
      throw new Error(`${label} SDK package versions must match the release manifest`);
    }
  }

  const sourcesObject = expectExactObject(
    object.sources,
    ['cave', 'coven', 'chat'],
    `${label}.sources`,
  );
  const caveObject = expectExactObject(
    sourcesObject.cave,
    ['repository', 'commit', 'tree', 'releaseVersion', 'files'],
    `${label}.sources.cave`,
  );
  const cave = {
    repository: expectRepository(
      caveObject.repository,
      `${label}.sources.cave.repository`,
    ),
    commit: expectGitOid(caveObject.commit, `${label}.sources.cave.commit`),
    tree: expectGitOid(caveObject.tree, `${label}.sources.cave.tree`),
    releaseVersion: expectString(
      caveObject.releaseVersion,
      `${label}.sources.cave.releaseVersion`,
      { maxBytes: 32 },
    ),
    files: expectFixedPathFiles(
      caveObject.files,
      CAVE_AUTHORITY_FILE_PATHS,
      `${label}.sources.cave.files`,
    ),
  };
  if (cave.repository !== 'OpenCoven/coven-cave') {
    throw new Error(`${label}.sources.cave.repository must be OpenCoven/coven-cave`);
  }
  const covenObject = expectExactObject(
    sourcesObject.coven,
    ['repository', 'commit', 'tree', 'releaseVersion'],
    `${label}.sources.coven`,
  );
  const coven = {
    repository: expectRepository(
      covenObject.repository,
      `${label}.sources.coven.repository`,
    ),
    commit: expectGitOid(covenObject.commit, `${label}.sources.coven.commit`),
    tree: expectGitOid(covenObject.tree, `${label}.sources.coven.tree`),
    releaseVersion: expectString(
      covenObject.releaseVersion,
      `${label}.sources.coven.releaseVersion`,
      { maxBytes: 32 },
    ),
  };
  if (coven.repository !== 'OpenCoven/coven') {
    throw new Error(`${label}.sources.coven.repository must be OpenCoven/coven`);
  }
  const chatObject = expectExactObject(
    sourcesObject.chat,
    ['repository', 'commit', 'tree', 'consumerLock', 'vendorFiles'],
    `${label}.sources.chat`,
  );
  const chat = {
    repository: expectRepository(
      chatObject.repository,
      `${label}.sources.chat.repository`,
    ),
    commit: expectGitOid(chatObject.commit, `${label}.sources.chat.commit`),
    tree: expectGitOid(chatObject.tree, `${label}.sources.chat.tree`),
    consumerLock: expectFileMetadata(
      chatObject.consumerLock,
      `${label}.sources.chat.consumerLock`,
      'pnpm-lock.yaml',
    ),
    vendorFiles: expectVendorFiles(
      chatObject.vendorFiles,
      `${label}.sources.chat.vendorFiles`,
    ),
  };
  if (chat.repository !== 'OpenCoven/chat') {
    throw new Error(`${label}.sources.chat.repository must be OpenCoven/chat`);
  }
  for (let index = 0; index < candidate.sdkPackages.length; index += 1) {
    const sdkPackage = candidate.sdkPackages[index];
    const vendorFile = chat.vendorFiles[index];
    if (
      vendorFile.path !== sdkPackage.vendorPath
      || vendorFile.size !== sdkPackage.size
      || vendorFile.sha256 !== sdkPackage.sha256
    ) {
      throw new Error(`${label} Chat vendor metadata must match frozen SDK packages`);
    }
  }
  const evidenceProducer = expectEvidenceProducer(
    object.evidenceProducer,
    `${label}.evidenceProducer`,
  );
  if (
    evidenceProducer.status === 'blocked'
    && (
      evidenceProducer.repository !== chat.repository
      || evidenceProducer.commit !== chat.commit
      || evidenceProducer.tree !== chat.tree
    )
  ) {
    throw new Error(
      `${label}.evidenceProducer blocker must match the frozen Chat source`,
    );
  }

  const toolchainObject = expectExactObject(
    object.toolchain,
    ['nodeVersion', 'pnpmVersion', 'rustVersion', 'tauriVersion'],
    `${label}.toolchain`,
  );
  const toolchain = {
    nodeVersion: expectString(
      toolchainObject.nodeVersion,
      `${label}.toolchain.nodeVersion`,
      { pattern: /^v\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    pnpmVersion: expectString(
      toolchainObject.pnpmVersion,
      `${label}.toolchain.pnpmVersion`,
      { pattern: /^pnpm@\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    rustVersion: expectString(
      toolchainObject.rustVersion,
      `${label}.toolchain.rustVersion`,
      { pattern: /^\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    tauriVersion: expectString(
      toolchainObject.tauriVersion,
      `${label}.toolchain.tauriVersion`,
      { pattern: /^\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
  };
  const scannersObject = expectExactObject(
    object.scanners,
    ['redaction', 'retainedEvidence'],
    `${label}.scanners`,
  );
  const parseScanner = (value, scannerLabel) => {
    const scanner = expectExactObject(value, ['name', 'version'], scannerLabel);
    return {
      name: expectString(scanner.name, `${scannerLabel}.name`, {
        pattern: IDENTIFIER_PATTERN,
        maxBytes: 64,
      }),
      version: expectString(scanner.version, `${scannerLabel}.version`, {
        pattern: /^\d+(?:\.\d+){0,2}$/u,
        maxBytes: 32,
      }),
    };
  };
  const scanners = {
    redaction: parseScanner(
      scannersObject.redaction,
      `${label}.scanners.redaction`,
    ),
    retainedEvidence: parseScanner(
      scannersObject.retainedEvidence,
      `${label}.scanners.retainedEvidence`,
    ),
  };
  const assertionRegistry = expectFileMetadata(
    object.assertionRegistry,
    `${label}.assertionRegistry`,
    'conformance/client-v1-cross-repository-assertions.json',
  );
  return {
    schemaVersion: 2,
    issue: 'OpenCoven/sdk#38',
    platformMatrix: [...CANONICAL_PLATFORMS],
    evidenceSchema,
    candidate,
    sources: { cave, coven, chat },
    evidenceProducer,
    toolchain,
    scanners,
    assertionRegistry,
  };
}

export function parseFrozenConformanceLock(
  text,
  source = 'frozen conformance lock',
) {
  return validateFrozenConformanceLock(parseJsonText(text, source), source);
}

export function readFrozenConformanceLock(path = DEFAULT_LOCK_PATH) {
  try {
    return parseFrozenConformanceLock(
      readFileSync(path, 'utf8'),
      'frozen conformance lock',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read frozen conformance lock: ${message}`, {
      cause: error,
    });
  }
}

export function validateFrozenConformanceBindings(
  lockValue,
  schemaText,
  assertionRegistryText,
) {
  const lock = validateFrozenConformanceLock(
    lockValue,
    'frozen conformance lock',
  );
  if (typeof schemaText !== 'string') {
    throw new Error('Evidence schema bytes must be supplied as UTF-8 text');
  }
  if (typeof assertionRegistryText !== 'string') {
    throw new Error('Assertion registry bytes must be supplied as UTF-8 text');
  }
  if (
    Buffer.byteLength(schemaText, 'utf8') !== lock.evidenceSchema.size
    || sha256(schemaText) !== lock.evidenceSchema.sha256
  ) {
    throw new Error('Evidence schema bytes do not match the frozen lock');
  }
  if (
    Buffer.byteLength(assertionRegistryText, 'utf8')
      !== lock.assertionRegistry.size
    || sha256(assertionRegistryText) !== lock.assertionRegistry.sha256
  ) {
    throw new Error('Assertion registry bytes do not match the frozen lock');
  }
  const schema = parseJsonText(
    schemaText,
    'frozen platform evidence JSON Schema',
  );
  if (!isPlainObject(schema) || schema.$id !== lock.evidenceSchema.identity) {
    throw new Error('Evidence schema identity does not match the frozen lock');
  }
  const binding = expectExactObject(
    schema['x-opencoven-frozen-contract'],
    ['schemaVersion', 'platformMatrix', 'assertionRegistry'],
    'Evidence schema frozen contract binding',
  );
  if (
    binding.schemaVersion !== lock.evidenceSchema.version
    || !equalJson(binding.platformMatrix, lock.platformMatrix)
    || !equalJson(binding.assertionRegistry, lock.assertionRegistry)
  ) {
    throw new Error(
      'Evidence schema frozen contract binding does not match the frozen lock',
    );
  }
  const schemaProperties = isPlainObject(schema.properties)
    ? schema.properties
    : null;
  const platformSchema =
    schemaProperties !== null && isPlainObject(schemaProperties.platform)
      ? schemaProperties.platform
      : null;
  if (
    platformSchema === null
    || !equalJson(platformSchema.enum, lock.platformMatrix)
  ) {
    throw new Error(
      'Evidence schema platform enum does not match the frozen lock',
    );
  }
  const registry = parseAssertionRegistry(
    assertionRegistryText,
    'frozen assertion registry',
  );
  return { lock, schema, registry };
}

export function assertEvidenceProducerCompatibility(lockValue) {
  const lock = validateFrozenConformanceLock(
    lockValue,
    'frozen conformance lock',
  );
  if (lock.evidenceProducer.status !== 'compatible') {
    throw new Error(
      `Frozen Chat commit ${lock.evidenceProducer.commit} has no schema-v2 platform evidence producer`,
    );
  }
  return lock.evidenceProducer;
}

function validateAssertionIds(ids, label, pattern = IDENTIFIER_PATTERN) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1_000) {
    throw new Error(`${label} must be a non-empty bounded array`);
  }
  const seen = new Set();
  return ids.map((value, index) => {
    const id = expectString(value, `${label}[${index}]`, {
      pattern,
      maxBytes: 192,
    });
    if (seen.has(id)) {
      throw new Error(`${label} contains duplicate assertion id ${JSON.stringify(id)}`);
    }
    seen.add(id);
    return id;
  });
}

function validateCompleteNotCovered(value, label) {
  if (!Array.isArray(value) || value.length !== COMPLETE_NOT_COVERED.length) {
    throw new Error(`${label} must equal the complete frozen exclusion set`);
  }
  return value.map((entry, index) => {
    const object = expectExactObject(
      entry,
      ['scopeId', 'diagnosticId'],
      `${label}[${index}]`,
    );
    const expected = COMPLETE_NOT_COVERED[index];
    if (
      object.scopeId !== expected.scopeId
      || object.diagnosticId !== expected.diagnosticId
    ) {
      throw new Error(`${label} must equal the complete frozen exclusion set`);
    }
    return { ...expected };
  });
}

function validateAssertionRegistry(value, label = 'assertion registry') {
  const object = expectExactObject(
    value,
    [
      'schemaVersion',
      'provenance',
      'requiredSubjects',
      'assertions',
      'notCovered',
    ],
    label,
  );
  if (object.schemaVersion !== 2) {
    throw new Error(`${label}.schemaVersion must be 2`);
  }
  const provenanceObject = expectExactObject(
    object.provenance,
    [
      'repository',
      'commit',
      'tree',
      'engine',
      'includeTtl',
      'includeAuthorityTakeover',
    ],
    `${label}.provenance`,
  );
  const provenance = {
    repository: expectRepository(
      provenanceObject.repository,
      `${label}.provenance.repository`,
    ),
    commit: expectGitOid(
      provenanceObject.commit,
      `${label}.provenance.commit`,
    ),
    tree: expectGitOid(provenanceObject.tree, `${label}.provenance.tree`),
    engine: expectFileMetadata(
      provenanceObject.engine,
      `${label}.provenance.engine`,
      'scripts/client-v1-conformance.mjs',
    ),
    includeTtl: provenanceObject.includeTtl,
    includeAuthorityTakeover: provenanceObject.includeAuthorityTakeover,
  };
  if (
    provenance.repository !== 'OpenCoven/coven-cave'
    || provenance.includeTtl !== true
    || provenance.includeAuthorityTakeover !== true
  ) {
    throw new Error(`${label}.provenance does not name the frozen Cave engine`);
  }
  if (!equalJson(object.requiredSubjects, REQUIRED_SUBJECTS)) {
    throw new Error(`${label}.requiredSubjects must cover cave, coven, sdk, and chat`);
  }
  const assertionsObject = expectExactObject(
    object.assertions,
    ['cave', 'sdk', 'chat'],
    `${label}.assertions`,
  );
  const cave = validateAssertionIds(
    assertionsObject.cave,
    `${label}.assertions.cave`,
    CAVE_ASSERTION_PATTERN,
  );
  if (cave.at(-1) !== 'harness.assertion-coverage') {
    throw new Error(
      `${label}.assertions.cave must end with harness.assertion-coverage`,
    );
  }
  const chatObject = expectExactObject(
    assertionsObject.chat,
    ['common', 'platforms'],
    `${label}.assertions.chat`,
  );
  const chatPlatforms = expectExactObject(
    chatObject.platforms,
    CANONICAL_PLATFORMS,
    `${label}.assertions.chat.platforms`,
  );
  const common = validateAssertionIds(
    chatObject.common,
    `${label}.assertions.chat.common`,
  );
  const commonSet = new Set(common);
  const platforms = {};
  for (const platform of CANONICAL_PLATFORMS) {
    const ids = validateAssertionIds(
      chatPlatforms[platform],
      `${label}.assertions.chat.platforms.${platform}`,
    );
    if (ids.some((id) => commonSet.has(id))) {
      throw new Error(
        `${label} repeats a common Chat assertion for ${platform}`,
      );
    }
    platforms[platform] = ids;
  }
  return {
    schemaVersion: 2,
    provenance,
    requiredSubjects: [...REQUIRED_SUBJECTS],
    assertions: {
      cave,
      sdk: validateAssertionIds(
        assertionsObject.sdk,
        `${label}.assertions.sdk`,
      ),
      chat: { common, platforms },
    },
    notCovered: validateCompleteNotCovered(
      object.notCovered,
      `${label}.notCovered`,
    ),
  };
}

export function parseAssertionRegistry(text, source = 'assertion registry') {
  try {
    return validateAssertionRegistry(parseJsonText(text, source), source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${source}: ${message}`, { cause: error });
  }
}

export function readAssertionRegistry(path = DEFAULT_REGISTRY_PATH) {
  try {
    return parseAssertionRegistry(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read assertion registry ${path}: ${message}`, {
      cause: error,
    });
  }
}

function resolveLocalSchemaReference(root, reference, label) {
  if (!reference.startsWith('#/')) {
    throw new Error(`${label} uses unsupported JSON Schema reference ${reference}`);
  }
  let current = root;
  for (const encodedSegment of reference.slice(2).split('/')) {
    const segment = encodedSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      throw new Error(`${label} contains unresolved JSON Schema reference ${reference}`);
    }
    current = current[segment];
  }
  if (!isPlainObject(current)) {
    throw new Error(`${label} JSON Schema reference ${reference} is not an object`);
  }
  return current;
}

export function validateJsonSchemaValue(
  value,
  schema,
  label = 'JSON value',
) {
  if (!isPlainObject(schema)) {
    throw new Error(`${label} schema must be a JSON object`);
  }
  const visit = (entry, node, path, depth) => {
    if (!isPlainObject(node)) {
      throw new Error(`${label} schema node at ${path} must be an object`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`${label} schema exceeds the supported reference depth`);
    }
    if (typeof node.$ref === 'string') {
      visit(
        entry,
        resolveLocalSchemaReference(schema, node.$ref, label),
        path,
        depth + 1,
      );
    }
    if (Object.hasOwn(node, 'const') && !equalJson(entry, node.const)) {
      throw new Error(`${path} does not match its JSON Schema const`);
    }
    if (
      Array.isArray(node.enum)
      && !node.enum.some((candidate) => equalJson(entry, candidate))
    ) {
      throw new Error(`${path} does not match its JSON Schema enum`);
    }
    if (typeof node.type === 'string') {
      const matchesType =
        (node.type === 'object' && isPlainObject(entry))
        || (node.type === 'array' && Array.isArray(entry))
        || (node.type === 'string' && typeof entry === 'string')
        || (node.type === 'integer' && Number.isSafeInteger(entry))
        || (node.type === 'number' && typeof entry === 'number' && Number.isFinite(entry))
        || (node.type === 'boolean' && typeof entry === 'boolean')
        || (node.type === 'null' && entry === null);
      if (!matchesType) {
        throw new Error(`${path} does not match JSON Schema type ${node.type}`);
      }
    }
    if (typeof entry === 'string') {
      if (Number.isInteger(node.minLength) && entry.length < node.minLength) {
        throw new Error(`${path} is shorter than its JSON Schema minimum`);
      }
      if (Number.isInteger(node.maxLength) && entry.length > node.maxLength) {
        throw new Error(`${path} exceeds its JSON Schema maximum`);
      }
      if (typeof node.pattern === 'string' && !new RegExp(node.pattern, 'u').test(entry)) {
        throw new Error(`${path} does not match its JSON Schema pattern`);
      }
    }
    if (typeof entry === 'number') {
      if (typeof node.minimum === 'number' && entry < node.minimum) {
        throw new Error(`${path} is below its JSON Schema minimum`);
      }
      if (typeof node.maximum === 'number' && entry > node.maximum) {
        throw new Error(`${path} exceeds its JSON Schema maximum`);
      }
    }
    if (Array.isArray(entry)) {
      if (Number.isInteger(node.minItems) && entry.length < node.minItems) {
        throw new Error(`${path} has fewer items than its JSON Schema minimum`);
      }
      if (Number.isInteger(node.maxItems) && entry.length > node.maxItems) {
        throw new Error(`${path} has more items than its JSON Schema maximum`);
      }
      if (node.uniqueItems === true) {
        const canonical = entry.map((item) => JSON.stringify(canonicalize(item)));
        if (new Set(canonical).size !== canonical.length) {
          throw new Error(`${path} violates JSON Schema uniqueItems`);
        }
      }
      if (isPlainObject(node.items)) {
        entry.forEach((item, index) =>
          visit(item, node.items, `${path}[${index}]`, depth + 1),
        );
      }
    }
    if (isPlainObject(entry)) {
      const properties = isPlainObject(node.properties) ? node.properties : {};
      if (Array.isArray(node.required)) {
        for (const key of node.required) {
          if (typeof key !== 'string' || !Object.hasOwn(entry, key)) {
            throw new Error(`${path} is missing JSON Schema property ${JSON.stringify(key)}`);
          }
        }
      }
      for (const [key, nested] of Object.entries(entry)) {
        if (Object.hasOwn(properties, key)) {
          visit(nested, properties[key], `${path}.${key}`, depth + 1);
        } else if (node.additionalProperties === false) {
          throw new Error(`${path} has additional property ${JSON.stringify(key)}`);
        } else if (isPlainObject(node.additionalProperties)) {
          visit(
            nested,
            node.additionalProperties,
            `${path}.${key}`,
            depth + 1,
          );
        }
      }
    }
  };
  visit(value, schema, label, 0);
  return value;
}

function expectCrossAssertion(value, label) {
  const object = expectExactObject(value, ['id', 'result', 'diagnosticId'], label);
  const result = expectString(object.result, `${label}.result`, { maxBytes: 8 });
  if (!['pass', 'fail', 'skip'].includes(result)) {
    throw new Error(`${label}.result must be pass, fail, or skip`);
  }
  return {
    id: expectString(object.id, `${label}.id`, {
      pattern: IDENTIFIER_PATTERN,
      maxBytes: 192,
    }),
    result,
    diagnosticId: expectString(object.diagnosticId, `${label}.diagnosticId`, {
      pattern: IDENTIFIER_PATTERN,
      maxBytes: 192,
    }),
  };
}

function expectCaveAssertion(value, label) {
  const object = expectExactObject(value, ['id', 'result', 'detail'], label);
  const result = expectString(object.result, `${label}.result`, { maxBytes: 8 });
  if (!['pass', 'fail', 'skip'].includes(result)) {
    throw new Error(`${label}.result must be pass, fail, or skip`);
  }
  return {
    id: expectString(object.id, `${label}.id`, {
      pattern: CAVE_ASSERTION_PATTERN,
      maxBytes: 192,
    }),
    result,
    detail: expectOptionalString(object.detail, `${label}.detail`),
  };
}

function expectAssertionArray(value, label, parser) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) {
    throw new Error(`${label} must be a non-empty bounded array`);
  }
  return value.map((entry, index) => parser(entry, `${label}[${index}]`));
}

function expectSummary(value, label) {
  const object = expectExactObject(
    value,
    ['total', 'passed', 'failed', 'skipped', 'status'],
    label,
  );
  const status = expectString(object.status, `${label}.status`, { maxBytes: 16 });
  if (!['passed', 'failed'].includes(status)) {
    throw new Error(`${label}.status must be passed or failed`);
  }
  return {
    total: expectInteger(object.total, `${label}.total`, {
      minimum: 0,
      maximum: 1_000,
    }),
    passed: expectInteger(object.passed, `${label}.passed`, {
      minimum: 0,
      maximum: 1_000,
    }),
    failed: expectInteger(object.failed, `${label}.failed`, {
      minimum: 0,
      maximum: 1_000,
    }),
    skipped: expectInteger(object.skipped, `${label}.skipped`, {
      minimum: 0,
      maximum: 1_000,
    }),
    status,
  };
}

function expectCaveFinding(value, label) {
  const object = expectExactObject(
    value,
    ['id', 'where', 'says', 'measured', 'severity', 'why'],
    label,
  );
  return {
    id: expectString(object.id, `${label}.id`, { maxBytes: 192 }),
    where: expectString(object.where, `${label}.where`, { maxBytes: 4_096 }),
    says: expectString(object.says, `${label}.says`, { maxBytes: 4_096 }),
    measured: expectString(object.measured, `${label}.measured`, {
      maxBytes: 4_096,
    }),
    severity: expectString(object.severity, `${label}.severity`, {
      maxBytes: 64,
    }),
    why: expectString(object.why, `${label}.why`, { maxBytes: 4_096 }),
  };
}

function expectCaveRecord(value, label) {
  const object = expectExactObject(
    value,
    [
      'harness',
      'issues',
      'scope',
      'ranAt',
      'caveVersion',
      'commit',
      'platform',
      'nodeVersion',
      'includeTtl',
      'authorityTakeover',
      'notCovered',
      'findings',
      'summary',
      'assertions',
    ],
    label,
  );
  if (!Array.isArray(object.issues) || object.issues.length === 0) {
    throw new Error(`${label}.issues must be a non-empty array`);
  }
  if (!Array.isArray(object.notCovered) || object.notCovered.length === 0) {
    throw new Error(`${label}.notCovered must be a non-empty array`);
  }
  if (!Array.isArray(object.findings)) {
    throw new Error(`${label}.findings must be an array`);
  }
  const takeover = expectExactObject(
    object.authorityTakeover,
    ['authorityMode', 'discoveryVersion', 'mechanism'],
    `${label}.authorityTakeover`,
  );
  return {
    harness: expectRelativePath(object.harness, `${label}.harness`),
    issues: object.issues.map((entry, index) =>
      expectString(entry, `${label}.issues[${index}]`, { maxBytes: 128 }),
    ),
    scope: expectString(object.scope, `${label}.scope`, { maxBytes: 64 }),
    ranAt: expectTimestamp(object.ranAt, `${label}.ranAt`),
    caveVersion: expectString(object.caveVersion, `${label}.caveVersion`, {
      maxBytes: 32,
    }),
    commit: expectGitOid(object.commit, `${label}.commit`),
    platform: expectString(object.platform, `${label}.platform`, {
      maxBytes: 32,
    }),
    nodeVersion: expectString(object.nodeVersion, `${label}.nodeVersion`, {
      maxBytes: 32,
    }),
    includeTtl: expectBoolean(object.includeTtl, `${label}.includeTtl`),
    authorityTakeover: {
      authorityMode: expectString(
        takeover.authorityMode,
        `${label}.authorityTakeover.authorityMode`,
        { maxBytes: 32 },
      ),
      discoveryVersion: expectInteger(
        takeover.discoveryVersion,
        `${label}.authorityTakeover.discoveryVersion`,
      ),
      mechanism: expectString(
        takeover.mechanism,
        `${label}.authorityTakeover.mechanism`,
        { maxBytes: 32 },
      ),
    },
    notCovered: object.notCovered.map((entry, index) =>
      expectString(entry, `${label}.notCovered[${index}]`, {
        maxBytes: 4_096,
      }),
    ),
    findings: object.findings.map((entry, index) =>
      expectCaveFinding(entry, `${label}.findings[${index}]`),
    ),
    summary: expectSummary(object.summary, `${label}.summary`),
    assertions: expectAssertionArray(
      object.assertions,
      `${label}.assertions`,
      expectCaveAssertion,
    ),
  };
}

function expectCoverage(value, label) {
  const object = expectExactObject(value, REQUIRED_SUBJECTS, label);
  const result = {};
  for (const subject of REQUIRED_SUBJECTS) {
    if (object[subject] !== true) {
      throw new Error(`${label}.${subject} must be true`);
    }
    result[subject] = true;
  }
  return result;
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
  const roots = expectOrderedArray(
    object.roots,
    ISOLATION_ROOTS.length,
    `${label}.roots`,
    (entry, index) => {
      const root = expectExactObject(
        entry,
        ['id', 'opaqueId', 'ownershipVerified', 'removedAfterRun'],
        `${label}.roots[${index}]`,
      );
      if (root.id !== ISOLATION_ROOTS[index]) {
        throw new Error(`${label}.roots must use canonical order`);
      }
      return {
        id: root.id,
        opaqueId: expectString(
          root.opaqueId,
          `${label}.roots[${index}].opaqueId`,
          { pattern: /^[0-9a-f]{32}$/u, maxBytes: 32 },
        ),
        ownershipVerified: expectBoolean(
          root.ownershipVerified,
          `${label}.roots[${index}].ownershipVerified`,
        ),
        removedAfterRun: expectBoolean(
          root.removedAfterRun,
          `${label}.roots[${index}].removedAfterRun`,
        ),
      };
    },
  );
  if (new Set(roots.map(({ opaqueId }) => opaqueId)).size !== roots.length) {
    throw new Error(`${label}.roots opaque IDs must be unique`);
  }
  const operatorState = expectOrderedArray(
    object.operatorState,
    OPERATOR_STATE.length,
    `${label}.operatorState`,
    (entry, index) => {
      const state = expectExactObject(
        entry,
        ['id', 'beforeSha256', 'afterSha256'],
        `${label}.operatorState[${index}]`,
      );
      if (state.id !== OPERATOR_STATE[index]) {
        throw new Error(`${label}.operatorState must use canonical order`);
      }
      return {
        id: state.id,
        beforeSha256: expectSha256(
          state.beforeSha256,
          `${label}.operatorState[${index}].beforeSha256`,
        ),
        afterSha256: expectSha256(
          state.afterSha256,
          `${label}.operatorState[${index}].afterSha256`,
        ),
      };
    },
  );
  return {
    strategy: expectString(object.strategy, `${label}.strategy`, {
      maxBytes: 64,
    }),
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
    roots,
    operatorState,
  };
}

function expectScan(value, label) {
  const object = expectExactObject(value, ['status', 'scanner', 'version'], label);
  return {
    status: expectString(object.status, `${label}.status`, { maxBytes: 16 }),
    scanner: expectString(object.scanner, `${label}.scanner`, {
      pattern: IDENTIFIER_PATTERN,
      maxBytes: 64,
    }),
    version: expectString(object.version, `${label}.version`, {
      pattern: /^\d+(?:\.\d+){0,2}$/u,
      maxBytes: 32,
    }),
  };
}

function expectArtifacts(value, label) {
  const object = expectExactObject(
    value,
    [
      'frozenLock',
      'assertionRegistry',
      'releaseManifest',
      'sdkPackages',
      'candidateCaveFiles',
      'caveAuthorityFiles',
      'consumerLock',
      'chatVendorFiles',
    ],
    label,
  );
  return {
    frozenLock: expectFileMetadata(
      object.frozenLock,
      `${label}.frozenLock`,
      'conformance/client-v1-cross-repository-lock.json',
    ),
    assertionRegistry: expectFileMetadata(
      object.assertionRegistry,
      `${label}.assertionRegistry`,
      'conformance/client-v1-cross-repository-assertions.json',
    ),
    releaseManifest: expectReleaseManifest(
      object.releaseManifest,
      `${label}.releaseManifest`,
    ),
    sdkPackages: expectSdkPackages(
      object.sdkPackages,
      `${label}.sdkPackages`,
    ),
    candidateCaveFiles: expectFixedPathFiles(
      object.candidateCaveFiles,
      CANDIDATE_CAVE_FILE_PATHS,
      `${label}.candidateCaveFiles`,
    ),
    caveAuthorityFiles: expectFixedPathFiles(
      object.caveAuthorityFiles,
      CAVE_AUTHORITY_FILE_PATHS,
      `${label}.caveAuthorityFiles`,
    ),
    consumerLock: expectFileMetadata(
      object.consumerLock,
      `${label}.consumerLock`,
      'pnpm-lock.yaml',
    ),
    chatVendorFiles: expectVendorFiles(
      object.chatVendorFiles,
      `${label}.chatVendorFiles`,
    ),
  };
}

function validatePlatformEvidence(value, source) {
  const object = expectExactObject(
    value,
    [
      'schemaVersion',
      'issue',
      'platform',
      'timing',
      'environment',
      'releases',
      'provenance',
      'harness',
      'artifacts',
      'caveRecord',
      'sdkAssertions',
      'chatAssertions',
      'coverage',
      'notCovered',
      'isolation',
      'scans',
    ],
    source,
  );
  if (object.schemaVersion !== 2) {
    throw new Error(`${source}.schemaVersion must be 2`);
  }
  if (object.issue !== 'OpenCoven/sdk#38') {
    throw new Error(`${source}.issue must be "OpenCoven/sdk#38"`);
  }
  const platform = expectString(object.platform, `${source}.platform`, {
    maxBytes: 32,
  });
  if (!CANONICAL_PLATFORMS.includes(platform)) {
    throw new Error(`${source}.platform is not a canonical platform id`);
  }
  const timingObject = expectExactObject(
    object.timing,
    ['startedAt', 'completedAt', 'durationMs'],
    `${source}.timing`,
  );
  const startedAt = expectTimestamp(
    timingObject.startedAt,
    `${source}.timing.startedAt`,
  );
  const completedAt = expectTimestamp(
    timingObject.completedAt,
    `${source}.timing.completedAt`,
  );
  const durationMs = expectInteger(
    timingObject.durationMs,
    `${source}.timing.durationMs`,
    { minimum: 0, maximum: 86_400_000 },
  );
  if (new Date(completedAt).valueOf() - new Date(startedAt).valueOf() !== durationMs) {
    throw new Error(`${source}.timing.durationMs does not match the observed interval`);
  }
  const environmentObject = expectExactObject(
    object.environment,
    [
      'os',
      'arch',
      'nodeVersion',
      'pnpmVersion',
      'rustVersion',
      'tauriVersion',
      'nativeCustody',
      'covenIdentity',
    ],
    `${source}.environment`,
  );
  const nativeCustodyObject = expectExactObject(
    environmentObject.nativeCustody,
    ['backend', 'available'],
    `${source}.environment.nativeCustody`,
  );
  const covenIdentityObject = expectExactObject(
    environmentObject.covenIdentity,
    ['backend', 'available'],
    `${source}.environment.covenIdentity`,
  );
  const expectedEnvironment = PLATFORM_ENVIRONMENT[platform];
  const environment = {
    os: expectString(environmentObject.os, `${source}.environment.os`, {
      maxBytes: 16,
    }),
    arch: expectString(environmentObject.arch, `${source}.environment.arch`, {
      maxBytes: 16,
    }),
    nodeVersion: expectString(
      environmentObject.nodeVersion,
      `${source}.environment.nodeVersion`,
      { pattern: /^v\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    pnpmVersion: expectString(
      environmentObject.pnpmVersion,
      `${source}.environment.pnpmVersion`,
      { pattern: /^pnpm@\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    rustVersion: expectString(
      environmentObject.rustVersion,
      `${source}.environment.rustVersion`,
      { pattern: /^\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    tauriVersion: expectString(
      environmentObject.tauriVersion,
      `${source}.environment.tauriVersion`,
      { pattern: /^\d+\.\d+\.\d+$/u, maxBytes: 32 },
    ),
    nativeCustody: {
      backend: expectString(
        nativeCustodyObject.backend,
        `${source}.environment.nativeCustody.backend`,
        { maxBytes: 64 },
      ),
      available: expectBoolean(
        nativeCustodyObject.available,
        `${source}.environment.nativeCustody.available`,
      ),
    },
    covenIdentity: {
      backend: expectString(
        covenIdentityObject.backend,
        `${source}.environment.covenIdentity.backend`,
        { maxBytes: 64 },
      ),
      available: expectBoolean(
        covenIdentityObject.available,
        `${source}.environment.covenIdentity.available`,
      ),
    },
  };
  if (
    environment.os !== expectedEnvironment.os
    || environment.arch !== expectedEnvironment.arch
    || environment.nativeCustody.backend !== expectedEnvironment.nativeCustody
    || environment.nativeCustody.available !== true
    || environment.covenIdentity.backend !== expectedEnvironment.covenIdentity
    || environment.covenIdentity.available !== true
  ) {
    throw new Error(`${source}.environment does not match ${platform}`);
  }
  const releasesObject = expectExactObject(
    object.releases,
    ['cave', 'coven'],
    `${source}.releases`,
  );
  const provenanceObject = expectExactObject(
    object.provenance,
    ['candidate', 'validator', 'cave', 'coven', 'chat'],
    `${source}.provenance`,
  );
  const validatorObject = expectExactObject(
    provenanceObject.validator,
    ['repository', 'commit', 'tree', 'contract', 'schema'],
    `${source}.provenance.validator`,
  );
  const validator = {
    repository: expectRepository(
      validatorObject.repository,
      `${source}.provenance.validator.repository`,
    ),
    commit: expectGitOid(
      validatorObject.commit,
      `${source}.provenance.validator.commit`,
    ),
    tree: expectGitOid(
      validatorObject.tree,
      `${source}.provenance.validator.tree`,
    ),
    contract: expectFileMetadata(
      validatorObject.contract,
      `${source}.provenance.validator.contract`,
      'scripts/conformance-contract.mjs',
    ),
    schema: expectFileMetadata(
      validatorObject.schema,
      `${source}.provenance.validator.schema`,
      'conformance/client-v1-cross-repository-evidence.schema.json',
    ),
  };
  if (validator.repository !== 'OpenCoven/sdk') {
    throw new Error(`${source}.provenance.validator.repository must be OpenCoven/sdk`);
  }
  const harnessObject = expectExactObject(
    object.harness,
    ['name', 'version', 'repository', 'commit', 'tree', 'invocationId'],
    `${source}.harness`,
  );
  const harness = {
    name: expectRelativePath(harnessObject.name, `${source}.harness.name`),
    version: expectString(harnessObject.version, `${source}.harness.version`, {
      maxBytes: 32,
    }),
    repository: expectRepository(
      harnessObject.repository,
      `${source}.harness.repository`,
    ),
    commit: expectGitOid(harnessObject.commit, `${source}.harness.commit`),
    tree: expectGitOid(harnessObject.tree, `${source}.harness.tree`),
    invocationId: expectString(
      harnessObject.invocationId,
      `${source}.harness.invocationId`,
      {
        pattern:
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        maxBytes: 36,
      },
    ),
  };
  const scansObject = expectExactObject(
    object.scans,
    ['redaction', 'retainedEvidence'],
    `${source}.scans`,
  );
  const record = {
    schemaVersion: 2,
    issue: 'OpenCoven/sdk#38',
    platform,
    timing: { startedAt, completedAt, durationMs },
    environment,
    releases: {
      cave: expectString(releasesObject.cave, `${source}.releases.cave`, {
        maxBytes: 32,
      }),
      coven: expectString(releasesObject.coven, `${source}.releases.coven`, {
        maxBytes: 32,
      }),
    },
    provenance: {
      candidate: expectIdentity(
        provenanceObject.candidate,
        `${source}.provenance.candidate`,
        'OpenCoven/sdk',
      ),
      validator,
      cave: expectIdentity(
        provenanceObject.cave,
        `${source}.provenance.cave`,
        'OpenCoven/coven-cave',
      ),
      coven: expectIdentity(
        provenanceObject.coven,
        `${source}.provenance.coven`,
        'OpenCoven/coven',
      ),
      chat: expectIdentity(
        provenanceObject.chat,
        `${source}.provenance.chat`,
        'OpenCoven/chat',
      ),
    },
    harness,
    artifacts: expectArtifacts(object.artifacts, `${source}.artifacts`),
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
    notCovered: validateCompleteNotCovered(
      object.notCovered,
      `${source}.notCovered`,
    ),
    isolation: expectIsolation(object.isolation, `${source}.isolation`),
    scans: {
      redaction: expectScan(scansObject.redaction, `${source}.scans.redaction`),
      retainedEvidence: expectScan(
        scansObject.retainedEvidence,
        `${source}.scans.retainedEvidence`,
      ),
    },
  };
  scanConformanceEvidence(record);
  return record;
}

function readDefaultSchema() {
  return parseJsonText(
    readFileSync(DEFAULT_SCHEMA_PATH, 'utf8'),
    'platform evidence JSON Schema',
  );
}

export function parsePlatformEvidence(
  text,
  source = 'platform evidence',
  schema = readDefaultSchema(),
) {
  const parsed = parseJsonText(text, source);
  validateJsonSchemaValue(parsed, schema, source);
  return validatePlatformEvidence(parsed, source);
}

function normalizeEvidenceKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isForbiddenEvidenceKey(key) {
  const normalized = normalizeEvidenceKey(key);
  if (FORBIDDEN_KEY_EXCEPTIONS.has(normalized)) return false;
  return FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part));
}

function isExplicitlySafeEvidenceValue(path, value) {
  if (
    /^evidence(?:\.platforms\[\d+\])?\.caveRecord\.assertions\[\d+\]\.detail$/u.test(
      path,
    )
    && /^\/api\/client\/v1(?:\/[A-Za-z0-9._~:@%+-]+)*$/u.test(value)
  ) {
    return true;
  }
  if (
    /^evidence(?:(?:\.platforms\[\d+\])?\.artifacts\.(?:sdkPackages|chatVendorFiles)|\.candidate\.sdkPackages)\[\d+\]\.packageName$/u.test(
      path,
    )
    && SDK_PACKAGE_NAMES.includes(value)
  ) {
    return true;
  }
  return false;
}

function privateScanValue(path, value) {
  if (!CAVE_ROUTE_TEXT_PATH.test(path)) return value;

  let scanValue = value;
  for (const route of CAVE_ROUTE_LITERALS) {
    scanValue = scanValue.replaceAll(route, '<reviewed-api-route>');
  }
  return scanValue.replace(/(["'])\/\1/gu, '$1<reviewed-api-root>$1');
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
      const scannedEntry = privateScanValue(path, entry);
      if (
        !isExplicitlySafeEvidenceValue(path, entry)
        && (
          scannedEntry.includes('\0')
          || PRIVATE_VALUE_PATTERNS.some((pattern) => pattern.test(scannedEntry))
        )
      ) {
        throw new Error(`${path} contains a private path, handle, URL, or operator identifier`);
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
      if (isForbiddenEvidenceKey(key)) {
        throw new Error(`forbidden evidence field ${JSON.stringify(key)}`);
      }
      visit(nested, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, 'evidence', 0);
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
  const values = {
    candidateRoot: null,
    caveRoot: null,
    covenRoot: null,
    chatRoot: null,
    harnessRoot: null,
    outputName: null,
  };
  const recordPaths = [];
  const flags = {
    '--candidate-root': 'candidateRoot',
    '--cave-root': 'caveRoot',
    '--coven-root': 'covenRoot',
    '--chat-root': 'chatRoot',
    '--harness-root': 'harnessRoot',
    '--out': 'outputName',
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--record') {
      recordPaths.push(expectValue(args, index, flag));
      index += 1;
      continue;
    }
    const key = flags[flag];
    if (key === undefined) {
      throw new Error(`Unknown option ${flag}`);
    }
    if (values[key] !== null) {
      throw new Error(`Duplicate option ${flag}`);
    }
    values[key] = expectValue(args, index, flag);
    index += 1;
  }
  for (const [key, flag] of [
    ['candidateRoot', '--candidate-root'],
    ['caveRoot', '--cave-root'],
    ['covenRoot', '--coven-root'],
    ['chatRoot', '--chat-root'],
    ['harnessRoot', '--harness-root'],
    ['outputName', '--out'],
  ]) {
    if (values[key] === null) {
      throw new Error(`Missing required option ${flag}`);
    }
  }
  if (recordPaths.length !== CANONICAL_PLATFORMS.length) {
    throw new Error('Conformance aggregation requires exactly three --record values');
  }
  if (
    !/^[a-z0-9][a-z0-9._-]{0,126}\.json$/u.test(values.outputName)
    || values.outputName.includes('..')
  ) {
    throw new Error('--out must be a canonical JSON filename, not a path');
  }
  return {
    candidateRoot: values.candidateRoot,
    caveRoot: values.caveRoot,
    covenRoot: values.covenRoot,
    chatRoot: values.chatRoot,
    harnessRoot: values.harnessRoot,
    recordPaths,
    outputName: values.outputName,
  };
}

function validateEngine(engine) {
  if (!isPlainObject(engine)) {
    throw new Error('Cave assertion engine must be a module namespace object');
  }
  for (const name of [
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

function requireExactOrder(entries, expected, label) {
  if (!equalJson(entries.map(({ id }) => id), expected)) {
    throw new Error(`${label} assertion order does not match the frozen registry`);
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

function validatePlatforms(records, canonicalPlatforms) {
  if (!equalJson(canonicalPlatforms, CANONICAL_PLATFORMS)) {
    throw new Error('Canonical platforms must match darwin-arm64, linux-x64, and win32-x64');
  }
  const counts = new Map();
  for (const record of records) {
    counts.set(record.platform, (counts.get(record.platform) ?? 0) + 1);
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
  if (
    isolation.strategy !== 'process-owned-temporary-roots'
    || isolation.network !== 'loopback-only'
    || isolation.sourceCheckoutDependency
    || isolation.workspaceLinkDependency
    || isolation.retainedPrivatePaths
    || isolation.retainedSocketHandles
  ) {
    throw new Error(`${platform} isolation proof is incomplete`);
  }
  for (const root of isolation.roots) {
    if (!root.ownershipVerified || !root.removedAfterRun) {
      throw new Error(`${platform} isolation root ${JSON.stringify(root.id)} was not owned and removed`);
    }
  }
  for (const state of isolation.operatorState) {
    if (state.beforeSha256 !== state.afterSha256) {
      throw new Error(`${platform} operator state ${JSON.stringify(state.id)} changed`);
    }
  }
}

function validateCaveRecord(record, engine, expectedCaveIds) {
  const { platform, caveRecord } = record;
  const coverageId = expectedCaveIds.at(-1);
  if (
    coverageId !== 'harness.assertion-coverage'
    || engine.COVERAGE_ASSERTION_ID !== coverageId
  ) {
    throw new Error('Cave coverage assertion does not match the frozen registry');
  }
  if (
    caveRecord.ranAt < record.timing.startedAt
    || caveRecord.ranAt > record.timing.completedAt
    || caveRecord.caveVersion !== record.releases.cave
    || caveRecord.commit !== record.provenance.cave.commit
    || caveRecord.platform !== platform
    || caveRecord.nodeVersion !== record.environment.nodeVersion
  ) {
    throw new Error(`${platform} Cave record does not match platform provenance`);
  }
  if (
    caveRecord.harness !== 'scripts/client-v1-conformance.mjs'
    || !caveRecord.includeTtl
    || caveRecord.authorityTakeover.authorityMode !== 'enforce'
    || caveRecord.authorityTakeover.discoveryVersion !== 2
    || caveRecord.authorityTakeover.mechanism !== 'hpke-bound-v1'
  ) {
    throw new Error(`${platform} Cave record does not contain the required authority proof`);
  }
  const expectedWithoutCoverage = expectedCaveIds.slice(0, -1);
  const coverage = engine.checkAssertionCoverage(
    caveRecord.assertions,
    expectedWithoutCoverage,
  );
  if (!Array.isArray(coverage) || coverage.some((entry) => typeof entry !== 'string')) {
    throw new Error('Cave assertion engine returned an invalid coverage result');
  }
  if (coverage.length > 0) {
    throw new Error(`${platform} Cave assertion coverage: ${coverage.join('; ')}`);
  }
  requireExactOrder(caveRecord.assertions, expectedCaveIds, `${platform} Cave`);
  for (const entry of caveRecord.assertions) {
    if (entry.result !== 'pass') {
      throw new Error(`${platform} Cave assertion ${JSON.stringify(entry.id)} did not pass`);
    }
  }
  const summary = engine.summarizeConformance(caveRecord.assertions);
  if (
    !isPlainObject(summary)
    || summary.failed !== 0
    || summary.skipped !== 0
    || summary.passed !== caveRecord.assertions.length
  ) {
    throw new Error(`${platform} Cave assertion summary is not a complete pass`);
  }
  const authoritativeRecord = engine.renderConformanceRecord(
    caveRecord.assertions,
    {
      ranAt: caveRecord.ranAt,
      caveVersion: caveRecord.caveVersion,
      commit: caveRecord.commit,
      platform: caveRecord.platform,
      includeTtl: caveRecord.includeTtl,
      authorityTakeover: caveRecord.authorityTakeover,
      notCovered: engine.NOT_COVERED,
      findings: engine.FINDINGS,
    },
  );
  if (!isPlainObject(authoritativeRecord)) {
    throw new Error('Cave assertion engine returned an invalid record');
  }
  if (!equalJson(caveRecord, { ...authoritativeRecord, nodeVersion: caveRecord.nodeVersion })) {
    throw new Error(`${platform} Cave record does not match the authoritative renderer`);
  }
  return summary;
}

function expectedLockArtifact(frozenLockSha256, frozenLockSize) {
  return {
    path: 'conformance/client-v1-cross-repository-lock.json',
    size: expectInteger(
      frozenLockSize,
      'committed frozen conformance lock size',
      { minimum: 1, maximum: MAX_EVIDENCE_BYTES },
    ),
    sha256: frozenLockSha256,
  };
}

function validateRecordAgainstFrozenLock(
  record,
  lock,
  registry,
  frozenLockMetadata,
  assertionRegistrySha256,
) {
  const { platform } = record;
  const evidenceProducer = assertEvidenceProducerCompatibility(lock);
  if (
    record.provenance.validator.commit === record.provenance.candidate.commit
    || record.provenance.validator.tree === record.provenance.candidate.tree
  ) {
    throw new Error(
      `${platform} validator provenance must be distinct from the packed SDK candidate`,
    );
  }
  const expectedIdentities = {
    candidate: {
      repository: lock.candidate.repository,
      commit: lock.candidate.commit,
      tree: lock.candidate.tree,
    },
    cave: {
      repository: lock.sources.cave.repository,
      commit: lock.sources.cave.commit,
      tree: lock.sources.cave.tree,
    },
    coven: {
      repository: lock.sources.coven.repository,
      commit: lock.sources.coven.commit,
      tree: lock.sources.coven.tree,
    },
    chat: {
      repository: lock.sources.chat.repository,
      commit: lock.sources.chat.commit,
      tree: lock.sources.chat.tree,
    },
  };
  for (const [key, expected] of Object.entries(expectedIdentities)) {
    if (!equalJson(record.provenance[key], expected)) {
      throw new Error(`${platform} ${key} provenance does not match the frozen lock`);
    }
  }
  if (
    record.releases.cave !== lock.sources.cave.releaseVersion
    || record.releases.coven !== lock.sources.coven.releaseVersion
  ) {
    throw new Error(`${platform} release versions do not match the frozen lock`);
  }
  if (
    record.environment.nodeVersion !== lock.toolchain.nodeVersion
    || record.environment.pnpmVersion !== lock.toolchain.pnpmVersion
    || record.environment.rustVersion !== lock.toolchain.rustVersion
    || record.environment.tauriVersion !== lock.toolchain.tauriVersion
  ) {
    throw new Error(`${platform} toolchain does not match the frozen lock`);
  }
  if (
    record.harness.name !== evidenceProducer.harness.path
    || record.harness.version !== evidenceProducer.harness.version
    || record.harness.repository !== evidenceProducer.repository
    || record.harness.commit !== evidenceProducer.commit
    || record.harness.tree !== evidenceProducer.tree
  ) {
    throw new Error(`${platform} harness contract does not match the frozen lock`);
  }
  if (
    !equalJson(record.provenance.validator.schema, {
      path: lock.evidenceSchema.path,
      size: lock.evidenceSchema.size,
      sha256: lock.evidenceSchema.sha256,
    })
  ) {
    throw new Error(
      `${platform} validator schema metadata does not match the frozen lock`,
    );
  }
  if (
    record.scans.redaction.status !== 'passed'
    || record.scans.redaction.scanner !== lock.scanners.redaction.name
    || record.scans.redaction.version !== lock.scanners.redaction.version
    || record.scans.retainedEvidence.status !== 'passed'
    || record.scans.retainedEvidence.scanner !== lock.scanners.retainedEvidence.name
    || record.scans.retainedEvidence.version !== lock.scanners.retainedEvidence.version
  ) {
    throw new Error(`${platform} evidence scans do not match the frozen contract`);
  }
  if (!equalJson(record.notCovered, registry.notCovered)) {
    throw new Error(`${platform}.notCovered must equal the complete frozen exclusion set`);
  }
  const expectedArtifacts = {
    frozenLock: frozenLockMetadata,
    assertionRegistry: lock.assertionRegistry,
    releaseManifest: lock.candidate.releaseManifest,
    sdkPackages: lock.candidate.sdkPackages,
    candidateCaveFiles: lock.candidate.cavePackageFiles,
    caveAuthorityFiles: lock.sources.cave.files,
    consumerLock: lock.sources.chat.consumerLock,
    chatVendorFiles: lock.sources.chat.vendorFiles,
  };
  if (!equalJson(record.artifacts.releaseManifest, expectedArtifacts.releaseManifest)) {
    throw new Error(`${platform} release manifest metadata does not match the frozen lock`);
  }
  if (!equalJson(record.artifacts.sdkPackages, expectedArtifacts.sdkPackages)) {
    throw new Error(`${platform} frozen SDK package metadata does not match the frozen lock`);
  }
  if (
    !equalJson(
      record.artifacts.candidateCaveFiles,
      expectedArtifacts.candidateCaveFiles,
    )
  ) {
    throw new Error(`${platform} candidate Cave fixture metadata does not match the frozen lock`);
  }
  if (
    !equalJson(
      record.artifacts.caveAuthorityFiles,
      expectedArtifacts.caveAuthorityFiles,
    )
  ) {
    throw new Error(`${platform} Cave authority metadata does not match the frozen lock`);
  }
  if (!equalJson(record.artifacts.consumerLock, expectedArtifacts.consumerLock)) {
    throw new Error(`${platform} consumer lock metadata does not match the frozen lock`);
  }
  if (!equalJson(record.artifacts.chatVendorFiles, expectedArtifacts.chatVendorFiles)) {
    throw new Error(`${platform} Chat vendor metadata does not match the frozen lock`);
  }
  if (!equalJson(record.artifacts.frozenLock, expectedArtifacts.frozenLock)) {
    throw new Error(`${platform} frozen lock metadata does not match the loaded lock`);
  }
  if (
    record.artifacts.assertionRegistry.path !== lock.assertionRegistry.path
    || record.artifacts.assertionRegistry.size !== lock.assertionRegistry.size
    || record.artifacts.assertionRegistry.sha256 !== assertionRegistrySha256
    || assertionRegistrySha256 !== lock.assertionRegistry.sha256
  ) {
    throw new Error(`${platform} assertion registry metadata does not match the frozen lock`);
  }
  if (
    !equalJson(registry.provenance, {
      repository: lock.sources.cave.repository,
      commit: lock.sources.cave.commit,
      tree: lock.sources.cave.tree,
      engine: lock.sources.cave.files[0],
      includeTtl: true,
      includeAuthorityTakeover: true,
    })
  ) {
    throw new Error('Assertion registry provenance does not match the frozen Cave source');
  }
}

export function aggregateConformanceEvidence(input) {
  const lock = validateFrozenConformanceLock(
    input.frozenLock,
    'frozen conformance lock',
  );
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
  const frozenLockSha256 = expectSha256(
    input.frozenLockSha256,
    'committed frozen conformance lock digest',
  );
  if (
    caveEngineSha256 !== lock.sources.cave.files[0].sha256
    || caveEngineSha256 !== registry.provenance.engine.sha256
  ) {
    throw new Error('Loaded Cave assertion engine does not match the frozen authority');
  }
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
  const frozenLockMetadata = expectedLockArtifact(
    frozenLockSha256,
    input.frozenLockSize,
  );
  let caveAssertions = 0;
  let sdkAssertions = 0;
  let chatAssertions = 0;
  for (const record of records) {
    validateRecordAgainstFrozenLock(
      record,
      lock,
      registry,
      frozenLockMetadata,
      assertionRegistrySha256,
    );
    if (!equalJson(record.provenance.validator, baseline.provenance.validator)) {
      throw new Error(`${record.platform} validator provenance does not match ${baseline.platform}`);
    }
    const comparableHarness = (value) => ({
      name: value.name,
      version: value.version,
      repository: value.repository,
      commit: value.commit,
      tree: value.tree,
    });
    if (
      !equalJson(
        comparableHarness(record.harness),
        comparableHarness(baseline.harness),
      )
    ) {
      throw new Error(`${record.platform} harness provenance does not match ${baseline.platform}`);
    }
    caveAssertions += validateCaveRecord(
      record,
      input.caveEngine,
      registry.assertions.cave,
    ).passed;
    sdkAssertions += checkAssertionGroup(
      input.caveEngine,
      record.sdkAssertions,
      registry.assertions.sdk,
      `${record.platform} SDK`,
    ).passed;
    chatAssertions += checkAssertionGroup(
      input.caveEngine,
      record.chatAssertions,
      [
        ...registry.assertions.chat.common,
        ...registry.assertions.chat.platforms[record.platform],
      ],
      `${record.platform} Chat`,
    ).passed;
    validateIsolation(record);
  }
  const aggregate = {
    schemaVersion: 2,
    issue: 'OpenCoven/sdk#38',
    kind: 'client-v1-cross-repository-conformance',
    canonicalPlatforms: [...input.canonicalPlatforms],
    contract: {
      frozenLock: frozenLockMetadata,
      assertionRegistry: lock.assertionRegistry,
    },
    candidate: {
      provenance: baseline.provenance.candidate,
      releaseManifest: lock.candidate.releaseManifest,
      sdkPackages: lock.candidate.sdkPackages,
      cavePackageFiles: lock.candidate.cavePackageFiles,
    },
    validator: baseline.provenance.validator,
    authorities: {
      cave: baseline.provenance.cave,
      coven: baseline.provenance.coven,
      chat: baseline.provenance.chat,
      harness: {
        name: baseline.harness.name,
        version: baseline.harness.version,
        repository: baseline.harness.repository,
        commit: baseline.harness.commit,
        tree: baseline.harness.tree,
      },
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
  return canonicalize(aggregate);
}

function validateStoredAssertionResults(entries, expected, label) {
  requireExactOrder(entries, expected, label);
  for (const entry of entries) {
    if (entry.result !== 'pass') {
      throw new Error(`${label} assertion ${JSON.stringify(entry.id)} did not pass`);
    }
  }
}

function expectAggregateHarness(value, label) {
  const object = expectExactObject(
    value,
    ['name', 'version', 'repository', 'commit', 'tree'],
    label,
  );
  return {
    name: expectRelativePath(object.name, `${label}.name`),
    version: expectString(object.version, `${label}.version`, {
      maxBytes: 32,
    }),
    repository: expectRepository(object.repository, `${label}.repository`),
    commit: expectGitOid(object.commit, `${label}.commit`),
    tree: expectGitOid(object.tree, `${label}.tree`),
  };
}

function expectAggregateSummary(value, label) {
  const object = expectExactObject(
    value,
    [
      'status',
      'platforms',
      'caveAssertions',
      'sdkAssertions',
      'chatAssertions',
      'failed',
      'skipped',
    ],
    label,
  );
  return {
    status: expectString(object.status, `${label}.status`, { maxBytes: 16 }),
    platforms: expectInteger(object.platforms, `${label}.platforms`, {
      minimum: 0,
      maximum: 16,
    }),
    caveAssertions: expectInteger(
      object.caveAssertions,
      `${label}.caveAssertions`,
      { minimum: 0, maximum: 10_000 },
    ),
    sdkAssertions: expectInteger(
      object.sdkAssertions,
      `${label}.sdkAssertions`,
      { minimum: 0, maximum: 10_000 },
    ),
    chatAssertions: expectInteger(
      object.chatAssertions,
      `${label}.chatAssertions`,
      { minimum: 0, maximum: 10_000 },
    ),
    failed: expectInteger(object.failed, `${label}.failed`, {
      minimum: 0,
      maximum: 10_000,
    }),
    skipped: expectInteger(object.skipped, `${label}.skipped`, {
      minimum: 0,
      maximum: 10_000,
    }),
  };
}

export function parseAggregatedConformanceEvidence(
  text,
  source = 'aggregate evidence',
  {
    frozenLockText = readFileSync(DEFAULT_LOCK_PATH, 'utf8'),
    assertionRegistryText = readFileSync(DEFAULT_REGISTRY_PATH, 'utf8'),
    schemaText = readFileSync(DEFAULT_SCHEMA_PATH, 'utf8'),
    caveEngine,
  } = {},
) {
  const parsed = parseJsonText(text, source);
  if (serializeCanonicalJson(parsed) !== text) {
    throw new Error(
      `${source} must use canonical UTF-8 JSON with LF and one trailing newline`,
    );
  }
  const object = expectExactObject(
    parsed,
    [
      'schemaVersion',
      'issue',
      'kind',
      'canonicalPlatforms',
      'contract',
      'candidate',
      'validator',
      'authorities',
      'platforms',
      'summary',
    ],
    source,
  );
  if (
    object.schemaVersion !== 2
    || object.issue !== 'OpenCoven/sdk#38'
    || object.kind !== 'client-v1-cross-repository-conformance'
  ) {
    throw new Error(`${source} does not identify the SDK #38 aggregate contract`);
  }
  if (!equalJson(object.canonicalPlatforms, CANONICAL_PLATFORMS)) {
    throw new Error(`${source}.canonicalPlatforms is not the frozen platform matrix`);
  }
  const lock = parseFrozenConformanceLock(
    frozenLockText,
    `${source} frozen conformance lock`,
  );
  const bindings = validateFrozenConformanceBindings(
    lock,
    schemaText,
    assertionRegistryText,
  );
  const registry = bindings.registry;
  const schema = bindings.schema;
  validateEngine(caveEngine);
  const frozenLockMetadata = {
    path: 'conformance/client-v1-cross-repository-lock.json',
    size: Buffer.byteLength(frozenLockText, 'utf8'),
    sha256: sha256(frozenLockText),
  };
  const assertionRegistryMetadata = {
    path: 'conformance/client-v1-cross-repository-assertions.json',
    size: Buffer.byteLength(assertionRegistryText, 'utf8'),
    sha256: sha256(assertionRegistryText),
  };
  if (!equalJson(assertionRegistryMetadata, lock.assertionRegistry)) {
    throw new Error(`${source} assertion registry bytes do not match the frozen lock`);
  }
  const contractObject = expectExactObject(
    object.contract,
    ['frozenLock', 'assertionRegistry'],
    `${source}.contract`,
  );
  if (
    !equalJson(contractObject.frozenLock, frozenLockMetadata)
    || !equalJson(
      contractObject.assertionRegistry,
      assertionRegistryMetadata,
    )
  ) {
    throw new Error(`${source}.contract does not match the committed lock and registry`);
  }
  const candidateObject = expectExactObject(
    object.candidate,
    ['provenance', 'releaseManifest', 'sdkPackages', 'cavePackageFiles'],
    `${source}.candidate`,
  );
  if (
    !equalJson(candidateObject.provenance, {
      repository: lock.candidate.repository,
      commit: lock.candidate.commit,
      tree: lock.candidate.tree,
    })
    || !equalJson(candidateObject.releaseManifest, lock.candidate.releaseManifest)
    || !equalJson(candidateObject.sdkPackages, lock.candidate.sdkPackages)
    || !equalJson(
      candidateObject.cavePackageFiles,
      lock.candidate.cavePackageFiles,
    )
  ) {
    throw new Error(`${source}.candidate does not match the frozen SDK candidate`);
  }
  const authoritiesObject = expectExactObject(
    object.authorities,
    ['cave', 'coven', 'chat', 'harness'],
    `${source}.authorities`,
  );
  const expectedAuthorities = {
    cave: {
      repository: lock.sources.cave.repository,
      commit: lock.sources.cave.commit,
      tree: lock.sources.cave.tree,
    },
    coven: {
      repository: lock.sources.coven.repository,
      commit: lock.sources.coven.commit,
      tree: lock.sources.coven.tree,
    },
    chat: {
      repository: lock.sources.chat.repository,
      commit: lock.sources.chat.commit,
      tree: lock.sources.chat.tree,
    },
  };
  for (const [key, expected] of Object.entries(expectedAuthorities)) {
    if (!equalJson(authoritiesObject[key], expected)) {
      throw new Error(`${source}.authorities.${key} does not match the frozen source`);
    }
  }
  const aggregateHarness = expectAggregateHarness(
    authoritiesObject.harness,
    `${source}.authorities.harness`,
  );
  const evidenceProducer = assertEvidenceProducerCompatibility(lock);
  if (
    aggregateHarness.name !== evidenceProducer.harness.path
    || aggregateHarness.version !== evidenceProducer.harness.version
    || aggregateHarness.repository !== evidenceProducer.repository
    || aggregateHarness.commit !== evidenceProducer.commit
    || aggregateHarness.tree !== evidenceProducer.tree
  ) {
    throw new Error(`${source}.authorities.harness does not match the frozen harness contract`);
  }
  if (!Array.isArray(object.platforms) || object.platforms.length !== 3) {
    throw new Error(`${source}.platforms must contain exactly three records`);
  }
  const records = object.platforms.map((record, index) => {
    validateJsonSchemaValue(
      record,
      schema,
      `${source}.platforms[${index}]`,
    );
    return validatePlatformEvidence(
      record,
      `${source}.platforms[${index}]`,
    );
  });
  if (!equalJson(records.map(({ platform }) => platform), CANONICAL_PLATFORMS)) {
    throw new Error(`${source}.platforms must use canonical platform order`);
  }
  const validator = records[0]?.provenance.validator;
  if (validator === undefined || !equalJson(object.validator, validator)) {
    throw new Error(`${source}.validator does not match the platform records`);
  }
  if (
    validator.commit === lock.candidate.commit
    || validator.tree === lock.candidate.tree
  ) {
    throw new Error(
      `${source}.validator must be distinct from the packed SDK candidate`,
    );
  }
  let caveAssertions = 0;
  let sdkAssertions = 0;
  let chatAssertions = 0;
  for (const record of records) {
    validateRecordAgainstFrozenLock(
      record,
      lock,
      registry,
      frozenLockMetadata,
      assertionRegistryMetadata.sha256,
    );
    if (!equalJson(record.provenance.validator, validator)) {
      throw new Error(`${source} platform validator provenance differs`);
    }
    if (
      !equalJson(record.provenance.cave, expectedAuthorities.cave)
      || !equalJson(record.provenance.coven, expectedAuthorities.coven)
      || !equalJson(record.provenance.chat, expectedAuthorities.chat)
    ) {
      throw new Error(`${source} platform source provenance differs`);
    }
    if (
      !equalJson(
        {
          name: record.harness.name,
          version: record.harness.version,
          repository: record.harness.repository,
          commit: record.harness.commit,
          tree: record.harness.tree,
        },
        aggregateHarness,
      )
    ) {
      throw new Error(`${source} platform harness provenance differs`);
    }
    caveAssertions += validateCaveRecord(
      record,
      caveEngine,
      registry.assertions.cave,
    ).passed;
    validateStoredAssertionResults(
      record.sdkAssertions,
      registry.assertions.sdk,
      `${source} ${record.platform} SDK`,
    );
    validateStoredAssertionResults(
      record.chatAssertions,
      [
        ...registry.assertions.chat.common,
        ...registry.assertions.chat.platforms[record.platform],
      ],
      `${source} ${record.platform} Chat`,
    );
    validateIsolation(record);
    sdkAssertions += record.sdkAssertions.length;
    chatAssertions += record.chatAssertions.length;
  }
  const summary = expectAggregateSummary(object.summary, `${source}.summary`);
  if (
    summary.status !== 'passed'
    || summary.platforms !== records.length
    || summary.caveAssertions !== caveAssertions
    || summary.sdkAssertions !== sdkAssertions
    || summary.chatAssertions !== chatAssertions
    || summary.failed !== 0
    || summary.skipped !== 0
  ) {
    throw new Error(`${source}.summary does not match the complete platform records`);
  }
  scanConformanceEvidence(parsed);
  return canonicalize(parsed);
}

export function parseReviewedEvidenceIndex(
  text,
  source = 'reviewed evidence index',
  {
    frozenLock,
    aggregatePath,
    aggregateText,
  } = {},
) {
  const parsed = parseJsonText(text, source);
  if (serializeCanonicalJson(parsed) !== text) {
    throw new Error(
      `${source} must use canonical UTF-8 JSON with LF and one trailing newline`,
    );
  }
  const lock = validateFrozenConformanceLock(
    frozenLock,
    `${source} frozen conformance lock`,
  );
  const producer = assertEvidenceProducerCompatibility(lock);
  if (typeof aggregatePath !== 'string') {
    throw new Error(`${source} aggregate path must be supplied`);
  }
  if (typeof aggregateText !== 'string') {
    throw new Error(`${source} aggregate bytes must be supplied`);
  }
  const object = expectExactObject(
    parsed,
    [
      'schemaVersion',
      'issue',
      'kind',
      'candidate',
      'validator',
      'aggregate',
      'producer',
      'platforms',
    ],
    source,
  );
  if (
    object.schemaVersion !== 1
    || object.issue !== 'OpenCoven/sdk#38'
    || object.kind !== 'client-v1-cross-repository-evidence-index'
  ) {
    throw new Error(`${source} does not identify the reviewed evidence index`);
  }
  const candidate = expectIdentity(
    object.candidate,
    `${source}.candidate`,
    'OpenCoven/sdk',
  );
  if (
    !equalJson(candidate, {
      repository: lock.candidate.repository,
      commit: lock.candidate.commit,
      tree: lock.candidate.tree,
    })
  ) {
    throw new Error(`${source}.candidate does not match the frozen candidate`);
  }
  const validator = expectIdentity(
    object.validator,
    `${source}.validator`,
    'OpenCoven/sdk',
  );
  const aggregateMetadata = expectFileMetadata(
    object.aggregate,
    `${source}.aggregate`,
    aggregatePath,
  );
  if (
    aggregateMetadata.size !== Buffer.byteLength(aggregateText, 'utf8')
    || aggregateMetadata.sha256 !== sha256(aggregateText)
  ) {
    throw new Error(`${source} aggregate digest does not match the committed aggregate`);
  }
  const producerObject = expectExactObject(
    object.producer,
    ['repository', 'commit', 'tree', 'harness', 'workflow'],
    `${source}.producer`,
  );
  const producerHarness = expectExactObject(
    producerObject.harness,
    ['path', 'version', 'size', 'sha256'],
    `${source}.producer.harness`,
  );
  const producerWorkflow = expectExactObject(
    producerObject.workflow,
    [
      'name',
      'path',
      'size',
      'sha256',
      'job',
      'jobNameTemplate',
      'aggregationJob',
      'aggregationJobName',
      'aggregationRunnerLabels',
      'validationJob',
      'validationJobName',
      'attestationJob',
      'attestationJobName',
      'environment',
      'environmentId',
      'artifactNameTemplate',
      'recordPathTemplate',
      'artifacts',
      'downloadArtifactAction',
      'attestationAction',
      'windowsBootstrapScriptSha256',
      'validatorRevisionScriptSha256',
      'phase1RevisionsScriptSha256',
      'linuxKeyringSetupScriptSha256',
      'unixSupervisorPreparationScriptSha256',
      'unixProductionScriptSha256',
      'unixValidationScriptSha256',
      'validationScriptSha256',
      'attestationScriptSha256',
      'validatorRevisionEnvironment',
      'sourceRef',
      'runnerLabels',
      'signerWorkflow',
      'signerDigest',
      'sourceDigest',
      'predicateType',
      'denySelfHostedRunners',
    ],
    `${source}.producer.workflow`,
  );
  const indexedProducer = {
    repository: expectRepository(
      producerObject.repository,
      `${source}.producer.repository`,
    ),
    commit: expectGitOid(
      producerObject.commit,
      `${source}.producer.commit`,
    ),
    tree: expectGitOid(producerObject.tree, `${source}.producer.tree`),
    harness: {
      path: expectRelativePath(
        producerHarness.path,
        `${source}.producer.harness.path`,
      ),
      version: expectString(
        producerHarness.version,
        `${source}.producer.harness.version`,
        { maxBytes: 32 },
      ),
      size: expectInteger(
        producerHarness.size,
        `${source}.producer.harness.size`,
        { minimum: 1, maximum: 16_777_216 },
      ),
      sha256: expectSha256(
        producerHarness.sha256,
        `${source}.producer.harness.sha256`,
      ),
    },
    workflow: {
      name: expectString(
        producerWorkflow.name,
        `${source}.producer.workflow.name`,
        { maxBytes: 128 },
      ),
      path: expectRelativePath(
        producerWorkflow.path,
        `${source}.producer.workflow.path`,
      ),
      size: expectInteger(
        producerWorkflow.size,
        `${source}.producer.workflow.size`,
        { minimum: 1, maximum: 4 * 1024 * 1024 },
      ),
      sha256: expectSha256(
        producerWorkflow.sha256,
        `${source}.producer.workflow.sha256`,
      ),
      job: expectString(
        producerWorkflow.job,
        `${source}.producer.workflow.job`,
        { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
      ),
      jobNameTemplate: expectString(
        producerWorkflow.jobNameTemplate,
        `${source}.producer.workflow.jobNameTemplate`,
        { maxBytes: 192 },
      ),
      aggregationJob: expectString(
        producerWorkflow.aggregationJob,
        `${source}.producer.workflow.aggregationJob`,
        { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
      ),
      aggregationJobName: expectString(
        producerWorkflow.aggregationJobName,
        `${source}.producer.workflow.aggregationJobName`,
        { maxBytes: 192 },
      ),
      aggregationRunnerLabels: expectRunnerLabelList(
        producerWorkflow.aggregationRunnerLabels,
        `${source}.producer.workflow.aggregationRunnerLabels`,
      ),
      validationJob: expectString(
        producerWorkflow.validationJob,
        `${source}.producer.workflow.validationJob`,
        { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
      ),
      validationJobName: expectString(
        producerWorkflow.validationJobName,
        `${source}.producer.workflow.validationJobName`,
        { maxBytes: 192 },
      ),
      attestationJob: expectString(
        producerWorkflow.attestationJob,
        `${source}.producer.workflow.attestationJob`,
        { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
      ),
      attestationJobName: expectString(
        producerWorkflow.attestationJobName,
        `${source}.producer.workflow.attestationJobName`,
        { maxBytes: 192 },
      ),
      environment: expectString(
        producerWorkflow.environment,
        `${source}.producer.workflow.environment`,
        { pattern: IDENTIFIER_PATTERN, maxBytes: 64 },
      ),
      environmentId: expectString(
        producerWorkflow.environmentId,
        `${source}.producer.workflow.environmentId`,
        { pattern: /^[1-9]\d*$/u, maxBytes: 32 },
      ),
      artifactNameTemplate: expectString(
        producerWorkflow.artifactNameTemplate,
        `${source}.producer.workflow.artifactNameTemplate`,
        { maxBytes: 192 },
      ),
      recordPathTemplate: expectString(
        producerWorkflow.recordPathTemplate,
        `${source}.producer.workflow.recordPathTemplate`,
        { maxBytes: 256 },
      ),
      artifacts: expectWorkflowArtifacts(
        producerWorkflow.artifacts,
        `${source}.producer.workflow.artifacts`,
      ),
      downloadArtifactAction: expectPinnedAction(
        producerWorkflow.downloadArtifactAction,
        `${source}.producer.workflow.downloadArtifactAction`,
      ),
      attestationAction: expectPinnedAction(
        producerWorkflow.attestationAction,
        `${source}.producer.workflow.attestationAction`,
      ),
      windowsBootstrapScriptSha256: expectSha256(
        producerWorkflow.windowsBootstrapScriptSha256,
        `${source}.producer.workflow.windowsBootstrapScriptSha256`,
      ),
      validatorRevisionScriptSha256: expectSha256(
        producerWorkflow.validatorRevisionScriptSha256,
        `${source}.producer.workflow.validatorRevisionScriptSha256`,
      ),
      phase1RevisionsScriptSha256: expectSha256(
        producerWorkflow.phase1RevisionsScriptSha256,
        `${source}.producer.workflow.phase1RevisionsScriptSha256`,
      ),
      linuxKeyringSetupScriptSha256: expectSha256(
        producerWorkflow.linuxKeyringSetupScriptSha256,
        `${source}.producer.workflow.linuxKeyringSetupScriptSha256`,
      ),
      unixSupervisorPreparationScriptSha256: expectSha256(
        producerWorkflow.unixSupervisorPreparationScriptSha256,
        `${source}.producer.workflow.unixSupervisorPreparationScriptSha256`,
      ),
      unixProductionScriptSha256: expectSha256(
        producerWorkflow.unixProductionScriptSha256,
        `${source}.producer.workflow.unixProductionScriptSha256`,
      ),
      unixValidationScriptSha256: expectSha256(
        producerWorkflow.unixValidationScriptSha256,
        `${source}.producer.workflow.unixValidationScriptSha256`,
      ),
      validationScriptSha256: expectSha256(
        producerWorkflow.validationScriptSha256,
        `${source}.producer.workflow.validationScriptSha256`,
      ),
      attestationScriptSha256: expectSha256(
        producerWorkflow.attestationScriptSha256,
        `${source}.producer.workflow.attestationScriptSha256`,
      ),
      validatorRevisionEnvironment: expectString(
        producerWorkflow.validatorRevisionEnvironment,
        `${source}.producer.workflow.validatorRevisionEnvironment`,
        { pattern: /^[A-Z][A-Z0-9_]*$/u, maxBytes: 128 },
      ),
      sourceRef: expectString(
        producerWorkflow.sourceRef,
        `${source}.producer.workflow.sourceRef`,
        {
          pattern:
            /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u,
          maxBytes: 256,
        },
      ),
      runnerLabels: expectRunnerLabels(
        producerWorkflow.runnerLabels,
        `${source}.producer.workflow.runnerLabels`,
      ),
      signerWorkflow: expectString(
        producerWorkflow.signerWorkflow,
        `${source}.producer.workflow.signerWorkflow`,
        { maxBytes: 256 },
      ),
      signerDigest: expectGitOid(
        producerWorkflow.signerDigest,
        `${source}.producer.workflow.signerDigest`,
      ),
      sourceDigest: expectGitOid(
        producerWorkflow.sourceDigest,
        `${source}.producer.workflow.sourceDigest`,
      ),
      predicateType: expectString(
        producerWorkflow.predicateType,
        `${source}.producer.workflow.predicateType`,
        { maxBytes: 128 },
      ),
      denySelfHostedRunners: expectBoolean(
        producerWorkflow.denySelfHostedRunners,
        `${source}.producer.workflow.denySelfHostedRunners`,
      ),
    },
  };
  if (
    !equalJson(indexedProducer, {
      repository: producer.repository,
      commit: producer.commit,
      tree: producer.tree,
      harness: producer.harness,
      workflow: producer.workflow,
    })
  ) {
    throw new Error(`${source}.producer does not match the frozen producer`);
  }
  if (
    !Array.isArray(object.platforms)
    || object.platforms.length !== lock.platformMatrix.length
  ) {
    throw new Error(`${source}.platforms must match the frozen platform matrix`);
  }
  const platforms = object.platforms.map((entry, index) => {
    const label = `${source}.platforms[${index}]`;
    const platformObject = expectExactObject(
      entry,
      ['platform', 'record', 'protectedJob'],
      label,
    );
    const platform = expectString(
      platformObject.platform,
      `${label}.platform`,
      { maxBytes: 32 },
    );
    if (platform !== lock.platformMatrix[index]) {
      throw new Error(`${source}.platforms must use the frozen platform order`);
    }
    const recordObject = expectExactObject(
      platformObject.record,
      ['size', 'sha256'],
      `${label}.record`,
    );
    const record = {
      size: expectInteger(recordObject.size, `${label}.record.size`, {
        minimum: 1,
        maximum: MAX_EVIDENCE_BYTES,
      }),
      sha256: expectSha256(
        recordObject.sha256,
        `${label}.record.sha256`,
      ),
    };
    const jobObject = expectExactObject(
      platformObject.protectedJob,
      [
        'runId',
        'runAttempt',
        'jobId',
        'deploymentId',
        'artifactName',
        'artifactSha256',
        'attestationSubjectSha256',
        'attestationBundleSha256',
      ],
      `${label}.protectedJob`,
    );
    const protectedJob = {
      runId: expectString(
        jobObject.runId,
        `${label}.protectedJob.runId`,
        { pattern: /^[1-9]\d*$/u, maxBytes: 32 },
      ),
      runAttempt: expectInteger(
        jobObject.runAttempt,
        `${label}.protectedJob.runAttempt`,
        { minimum: 1, maximum: 1_000 },
      ),
      jobId: expectString(
        jobObject.jobId,
        `${label}.protectedJob.jobId`,
        { pattern: /^[1-9]\d*$/u, maxBytes: 32 },
      ),
      deploymentId: expectString(
        jobObject.deploymentId,
        `${label}.protectedJob.deploymentId`,
        { pattern: /^[1-9]\d*$/u, maxBytes: 32 },
      ),
      artifactName: expectString(
        jobObject.artifactName,
        `${label}.protectedJob.artifactName`,
        { pattern: IDENTIFIER_PATTERN, maxBytes: 192 },
      ),
      artifactSha256: expectSha256(
        jobObject.artifactSha256,
        `${label}.protectedJob.artifactSha256`,
      ),
      attestationSubjectSha256: expectSha256(
        jobObject.attestationSubjectSha256,
        `${label}.protectedJob.attestationSubjectSha256`,
      ),
      attestationBundleSha256: expectSha256(
        jobObject.attestationBundleSha256,
        `${label}.protectedJob.attestationBundleSha256`,
      ),
    };
    if (
      protectedJob.artifactSha256 !== record.sha256
      || protectedJob.attestationSubjectSha256 !== record.sha256
    ) {
      throw new Error(
        `${source} ${platform} artifact and attestation digests must match the indexed record bytes`,
      );
    }
    if (
      protectedJob.attestationSubjectSha256
        !== protectedJob.artifactSha256
    ) {
      throw new Error(
        `${source} ${platform} attestation subject does not match the artifact digest`,
      );
    }
    if (
      protectedJob.artifactName
        !== producer.workflow.artifactNameTemplate.replace(
          '{platform}',
          platform,
        )
    ) {
      throw new Error(
        `${source} ${platform} artifact name does not match its platform`,
      );
    }
    return { platform, record, protectedJob };
  });
  const protectedJobIdentities = platforms.map(({ protectedJob }) =>
    [
      protectedJob.runId,
      protectedJob.runAttempt,
      protectedJob.jobId,
      protectedJob.deploymentId,
    ].join(':'),
  );
  if (
    new Set(protectedJobIdentities).size !== protectedJobIdentities.length
  ) {
    throw new Error(
      `${source} protected job provenance must be unique per platform`,
    );
  }
  const jobIds = platforms.map(({ protectedJob }) => protectedJob.jobId);
  const deploymentIds = platforms.map(
    ({ protectedJob }) => protectedJob.deploymentId,
  );
  if (
    new Set(jobIds).size !== jobIds.length
    || new Set(deploymentIds).size !== deploymentIds.length
  ) {
    throw new Error(
      `${source} protected job and deployment ids must be unique per platform`,
    );
  }
  const runIdentities = new Set(
    platforms.map(({ protectedJob }) =>
      `${protectedJob.runId}:${protectedJob.runAttempt}`,
    ),
  );
  if (runIdentities.size !== 1) {
    throw new Error(
      `${source} protected matrix jobs must come from one exact workflow run attempt`,
    );
  }
  return canonicalize({
    schemaVersion: 1,
    issue: 'OpenCoven/sdk#38',
    kind: 'client-v1-cross-repository-evidence-index',
    candidate,
    validator,
    aggregate: aggregateMetadata,
    producer: indexedProducer,
    platforms,
  });
}
