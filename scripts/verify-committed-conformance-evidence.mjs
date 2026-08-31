#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectCaveAssertionEngine,
  loadCommittedCaveAssertionEngine,
} from './aggregate-client-v1-conformance.mjs';
import {
  assertEvidenceProducerCompatibility,
  parseFrozenConformanceLock,
  validateFrozenConformanceBindings,
} from './conformance-contract.mjs';
import {
  verifyGitHubConformanceEvidence,
} from './github-conformance-evidence.mjs';
import { assertFrozenNodeRuntime } from './release-readiness.mjs';
import {
  resolveAuthenticatedGitRuntime,
  runWithGitHubTokensScrubbed,
} from './release-runtime-integrity.mjs';

const LOCK_PATH = 'conformance/client-v1-cross-repository-lock.json';
const REGISTRY_PATH =
  'conformance/client-v1-cross-repository-assertions.json';
const SCHEMA_PATH =
  'conformance/client-v1-cross-repository-evidence.schema.json';

function createGitEnvironment(root) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: root,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_ALLOW_PROTOCOL: '',
    GIT_ASKPASS: devNull,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_SSH: devNull,
    GIT_SSH_COMMAND: devNull,
    GIT_TERMINAL_PROMPT: '0',
    SSH_ASKPASS: devNull,
  };
}

function runGit(gitRuntime, root, args, { encoding = 'utf8' } = {}) {
  return execFileSync(
    gitRuntime.gitPath,
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
      ...args,
    ],
    {
      encoding,
      env: createGitEnvironment(root),
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
      killSignal: 'SIGKILL',
    },
  );
}

function readCommittedRegularBlob(gitRuntime, root, commit, path, label) {
  if (
    typeof path !== 'string'
    || !/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9@._/-]+$/u.test(
      path,
    )
  ) {
    throw new Error(`${label} path is not canonical`);
  }
  const entry = runGit(
    gitRuntime,
    root,
    ['ls-tree', commit, '--', path],
  ).trim();
  const match = /^100(?:644|755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
  if (match === null || match[2] !== path) {
    throw new Error(`${label} is not a committed regular file`);
  }
  const bytes = runGit(gitRuntime, root, ['cat-file', 'blob', match[1]], {
    encoding: 'buffer',
  });
  if (bytes.byteLength > 1_048_576) {
    throw new Error(`${label} exceeds the 1048576-byte limit`);
  }
  return bytes;
}

function parseArguments(argv) {
  const values = {
    root: null,
    commit: null,
    aggregate: null,
    index: null,
    caveRoot: null,
  };
  const names = {
    '--root': 'root',
    '--commit': 'commit',
    '--aggregate': 'aggregate',
    '--index': 'index',
    '--cave-root': 'caveRoot',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = names[argument];
    if (name === undefined) {
      throw new Error(`Unknown option ${argument}`);
    }
    if (values[name] !== null) {
      throw new Error(`Option ${argument} may only be provided once`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${argument} requires a value`);
    }
    values[name] = value;
    index += 1;
  }
  for (const [name, option] of Object.entries({
    root: '--root',
    commit: '--commit',
    aggregate: '--aggregate',
    index: '--index',
    caveRoot: '--cave-root',
  })) {
    if (values[name] === null) {
      throw new Error(`Missing required option ${option}`);
    }
  }
  if (!/^[0-9a-f]{40}$/u.test(values.commit)) {
    throw new Error('--commit must be a full Git commit');
  }
  return values;
}

async function verifyCommittedConformanceEvidenceWithScrubbedEnvironment(
  options,
  { execute, env, gitRuntime } = {},
) {
  const lockText = readCommittedRegularBlob(
    gitRuntime,
    options.root,
    options.commit,
    LOCK_PATH,
    'Frozen conformance lock',
  ).toString('utf8');
  const registryText = readCommittedRegularBlob(
    gitRuntime,
    options.root,
    options.commit,
    REGISTRY_PATH,
    'Frozen assertion registry',
  ).toString('utf8');
  const schemaText = readCommittedRegularBlob(
    gitRuntime,
    options.root,
    options.commit,
    SCHEMA_PATH,
    'Frozen evidence schema',
  ).toString('utf8');
  const aggregateText = readCommittedRegularBlob(
    gitRuntime,
    options.root,
    options.commit,
    options.aggregate,
    'Committed conformance aggregate',
  ).toString('utf8');
  const indexText = readCommittedRegularBlob(
    gitRuntime,
    options.root,
    options.commit,
    options.index,
    'Committed conformance evidence index',
  ).toString('utf8');
  const lock = parseFrozenConformanceLock(
    lockText,
    'committed frozen conformance lock',
  );
  if (assertFrozenNodeRuntime(options.root) !== lock.toolchain.nodeVersion) {
    throw new Error(
      'Frozen conformance lock Node version does not match .node-version',
    );
  }
  validateFrozenConformanceBindings(lock, schemaText, registryText);
  assertEvidenceProducerCompatibility(lock);
  const caveRoot = resolve(options.caveRoot);
  const inspectedCaveEngine = inspectCaveAssertionEngine(
    caveRoot,
    {
      repository: lock.sources.cave.repository,
      commit: lock.sources.cave.commit,
      tree: lock.sources.cave.tree,
    },
    {
      gitExecutable: gitRuntime.gitPath,
      gitEnvironment: createGitEnvironment(caveRoot),
    },
  );
  const expectedCaveEngine = lock.sources.cave.files[0];
  if (
    expectedCaveEngine === undefined
    || inspectedCaveEngine.size !== expectedCaveEngine.size
    || inspectedCaveEngine.digest !== expectedCaveEngine.sha256
  ) {
    throw new Error(
      'Cave assertion engine checkout does not match the frozen engine bytes',
    );
  }
  const caveEngine = await loadCommittedCaveAssertionEngine(
    inspectedCaveEngine,
  );
  return verifyGitHubConformanceEvidence({
    frozenLockText: lockText,
    assertionRegistryText: registryText,
    schemaText,
    aggregatePath: options.aggregate,
    aggregateText,
    indexText,
    caveEngine,
    ...(execute === undefined ? {} : { execute }),
    ...(env === undefined ? {} : { env }),
  });
}

export async function verifyCommittedConformanceEvidence(
  options,
  { execute, env = process.env } = {},
) {
  const githubEnvironment = { ...env };
  const gitRuntime = resolveAuthenticatedGitRuntime();
  const result = await runWithGitHubTokensScrubbed(
    process.env,
    () => verifyCommittedConformanceEvidenceWithScrubbedEnvironment(
      options,
      {
        ...(execute === undefined ? {} : { execute }),
        env: githubEnvironment,
        gitRuntime,
      },
    ),
  );
  return {
    ...result,
    runtime: {
      git: gitRuntime,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await verifyCommittedConformanceEvidence(
    parseArguments(argv),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
