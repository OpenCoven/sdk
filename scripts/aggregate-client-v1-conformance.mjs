import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { devNull } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  aggregateConformanceEvidence,
  assertEvidenceProducerCompatibility,
  parseConformanceAggregationArgs,
  parseFrozenConformanceLock,
  parsePlatformEvidence,
  serializeCanonicalJson,
  validateFrozenConformanceBindings,
} from './conformance-contract.mjs';
import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import {
  createGitHubTokenFreeEnvironment,
  runWithGitHubTokensScrubbed,
} from './release-runtime-integrity.mjs';
import {
  assertFrozenNodeRuntime,
  readReleaseConfig,
} from './release-readiness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frozenLockPath =
  'conformance/client-v1-cross-repository-lock.json';
const assertionRegistryPath =
  'conformance/client-v1-cross-repository-assertions.json';
const evidenceSchemaPath =
  'conformance/client-v1-cross-repository-evidence.schema.json';
const contractPath = 'scripts/conformance-contract.mjs';
const aggregationHostPlatforms = new Set(['darwin', 'linux']);
const fixedArtifactRoot = resolve(repositoryRoot, '.artifacts');
const fixedOutputRoot = resolve(
  fixedArtifactRoot,
  'client-v1-cross-repository-results',
);
const gitConfigurationOverrides = [
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
  '-c',
  `core.askPass=${devNull}`,
  '-c',
  `core.sshCommand=${devNull}`,
  '-c',
  'http.proxy=',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'core.checkStat=default',
  '-c',
  'core.trustctime=true',
  '-c',
  'core.symlinks=true',
  '-c',
  `core.fileMode=${process.platform === 'win32' ? 'false' : 'true'}`,
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createGitEnvironment(inheritedEnvironment = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(
    createGitHubTokenFreeEnvironment(inheritedEnvironment),
  )) {
    if (!key.toUpperCase().startsWith('GIT_') && value !== undefined) {
      environment[key] = value;
    }
  }
  environment.GIT_ATTR_NOSYSTEM = '1';
  environment.GIT_ATTR_SOURCE = 'HEAD';
  environment.GIT_ALLOW_PROTOCOL = '';
  environment.GIT_ASKPASS = devNull;
  environment.GIT_CONFIG_GLOBAL = devNull;
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_NO_LAZY_FETCH = '1';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_SSH = devNull;
  environment.GIT_SSH_COMMAND = devNull;
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.SSH_ASKPASS = devNull;
  return environment;
}

function runGit(root, args, label, { encoding = 'utf8', input } = {}) {
  try {
    return execFileSync(
      'git',
      [
        ...gitConfigurationOverrides,
        '-C',
        root,
        `--work-tree=${root}`,
        ...args,
      ],
      {
        encoding,
        env: createGitEnvironment(),
        input,
        maxBuffer: 32 * 1024 * 1024,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        timeout: 15_000,
        killSignal: 'SIGKILL',
      },
    );
  } catch (error) {
    throw new Error(`${label} is not a readable Git checkout`, {
      cause: error,
    });
  }
}

function countLocalExcludeRules(root, label) {
  const gitPath = runGit(
    root,
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    label,
  ).trim();
  let contents;
  try {
    contents = readFileSync(gitPath, 'utf8');
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return 0;
    }
    throw new Error(`${label} has unreadable local exclude metadata`, {
      cause: error,
    });
  }
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0 && !line.startsWith('#')).length;
}

function countReplacementRefs(root, label) {
  const output = runGit(
    root,
    ['for-each-ref', '--count=101', '--format=1', 'refs/replace'],
    label,
  ).trim();
  return output.length === 0 ? 0 : output.split('\n').length;
}

function countHiddenIndexEntries(root, label) {
  const output = runGit(root, ['ls-files', '--cached', '-v', '-z'], label);
  let count = 0;
  for (const record of output.split('\0')) {
    if (['h', 's', 'S'].includes(record[0] ?? '')) {
      count += 1;
    }
  }
  return count;
}

function countSubmodules(root, label) {
  const output = runGit(
    root,
    ['ls-files', '--cached', '--stage', '-z'],
    label,
  );
  let count = 0;
  for (const record of output.split('\0')) {
    if (record.startsWith('160000 ')) count += 1;
  }
  return count;
}

function summarizeStatus(output) {
  const summary = { staged: 0, unstaged: 0, untracked: 0, ignored: 0 };
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    if (indexStatus === '?' && worktreeStatus === '?') {
      summary.untracked += 1;
      continue;
    }
    if (indexStatus === '!' && worktreeStatus === '!') {
      summary.ignored += 1;
      continue;
    }
    if (indexStatus !== ' ' && indexStatus !== '?') summary.staged += 1;
    if (worktreeStatus !== ' ' && worktreeStatus !== '?') summary.unstaged += 1;
    if (
      ['R', 'C'].includes(indexStatus)
      || ['R', 'C'].includes(worktreeStatus)
    ) {
      index += 1;
    }
  }
  return summary;
}

function formatCount(count, singular, plural) {
  return `${count > 100 ? '100+' : count} ${count === 1 ? singular : plural}`;
}

function formatDirtySummary(summary) {
  const parts = [];
  if (summary.staged > 0) {
    parts.push(formatCount(summary.staged, 'staged change', 'staged changes'));
  }
  if (summary.unstaged > 0) {
    parts.push(
      formatCount(summary.unstaged, 'unstaged change', 'unstaged changes'),
    );
  }
  if (summary.untracked > 0) {
    parts.push(
      formatCount(summary.untracked, 'untracked item', 'untracked items'),
    );
  }
  if (summary.ignored > 0) {
    parts.push(
      formatCount(
        summary.ignored,
        'ignored untracked item',
        'ignored untracked items',
      ),
    );
  }
  return parts.join(', ');
}

function normalizeGitHubRepository(remote) {
  const trimmed = remote.trim();
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(
      trimmed,
    );
  return match?.[1] ?? null;
}

function validateExpectedIdentity(expected, label) {
  if (
    expected === null
    || typeof expected !== 'object'
    || Array.isArray(expected)
    || typeof expected.repository !== 'string'
  ) {
    throw new Error(`${label} expected identity is invalid`);
  }
  if (
    expected.commit !== undefined
    && !/^[0-9a-f]{40}$/u.test(expected.commit)
  ) {
    throw new Error(`${label} expected commit is invalid`);
  }
  if (
    expected.tree !== undefined
    && !/^[0-9a-f]{40}$/u.test(expected.tree)
  ) {
    throw new Error(`${label} expected tree is invalid`);
  }
}

export function inspectRepositoryCheckout(root, expected, label) {
  validateExpectedIdentity(expected, label);
  let metadata;
  let resolvedRoot;
  try {
    metadata = lstatSync(root);
    resolvedRoot = realpathSync(root);
  } catch (error) {
    throw new Error(`${label} is not a readable Git checkout`, { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} root must be a non-symlink directory`);
  }
  const gitRoot = realpathSync(
    runGit(resolvedRoot, ['rev-parse', '--show-toplevel'], label).trim(),
  );
  if (gitRoot !== resolvedRoot) {
    throw new Error(`${label} root must equal the Git top-level`);
  }
  const localExcludeCount = countLocalExcludeRules(resolvedRoot, label);
  if (localExcludeCount > 0) {
    throw new Error(
      `${label} has ${formatCount(
        localExcludeCount,
        'local exclude rule',
        'local exclude rules',
      )}`,
    );
  }
  const replacementCount = countReplacementRefs(resolvedRoot, label);
  if (replacementCount > 0) {
    throw new Error(
      `${label} has ${formatCount(
        replacementCount,
        'replacement ref',
        'replacement refs',
      )}`,
    );
  }
  const hiddenCount = countHiddenIndexEntries(resolvedRoot, label);
  if (hiddenCount > 0) {
    throw new Error(
      `${label} has ${formatCount(
        hiddenCount,
        'hidden index entry',
        'hidden index entries',
      )}`,
    );
  }
  const submoduleCount = countSubmodules(resolvedRoot, label);
  if (submoduleCount > 0) {
    throw new Error(
      `${label} has ${formatCount(
        submoduleCount,
        'submodule entry',
        'submodule entries',
      )}`,
    );
  }
  const dirty = summarizeStatus(
    runGit(
      resolvedRoot,
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignored=matching',
        '--ignore-submodules=none',
      ],
      label,
    ),
  );
  if (
    dirty.staged !== 0
    || dirty.unstaged !== 0
    || dirty.untracked !== 0
    || dirty.ignored !== 0
  ) {
    throw new Error(`${label} is dirty (${formatDirtySummary(dirty)})`);
  }
  const repository = normalizeGitHubRepository(
    runGit(resolvedRoot, ['remote', 'get-url', 'origin'], label),
  );
  if (repository !== expected.repository) {
    throw new Error(`${label} origin does not match expected repository`);
  }
  const commit = runGit(resolvedRoot, ['rev-parse', 'HEAD'], label).trim();
  if (expected.commit !== undefined && commit !== expected.commit) {
    throw new Error(`${label} HEAD does not match expected commit`);
  }
  const tree = runGit(resolvedRoot, ['rev-parse', 'HEAD^{tree}'], label).trim();
  if (expected.tree !== undefined && tree !== expected.tree) {
    throw new Error(`${label} committed tree does not match expected tree`);
  }
  return {
    root: resolvedRoot,
    repository,
    commit,
    tree,
  };
}

export function readTrackedFileAtCommit(
  root,
  relativePath,
  label,
  capturedCommit,
) {
  if (
    typeof relativePath !== 'string'
    || !/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9@._/-]+$/u.test(
      relativePath,
    )
  ) {
    throw new Error(`${label} path is not canonical`);
  }
  const treeEntry = runGit(
    root,
    ['ls-tree', capturedCommit, '--', relativePath],
    label,
  ).trim();
  const match = /^100(?:644|755) blob ([0-9a-f]{40})\t(.+)$/u.exec(treeEntry);
  if (match === null || match[2] !== relativePath) {
    throw new Error(`${label} is not a tracked regular file at the captured commit`);
  }
  const blob = match[1];
  const bytes = runGit(root, ['cat-file', 'blob', blob], label, {
    encoding: 'buffer',
  });
  return {
    blob,
    bytes,
    size: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function assertCommittedFileMetadata(root, commit, expected, label) {
  const file = readTrackedFileAtCommit(root, expected.path, label, commit);
  if (file.size !== expected.size || file.sha256 !== expected.sha256) {
    throw new Error(`${label} does not match the frozen file metadata`);
  }
  return file;
}

export function inspectCaveAssertionEngine(caveRoot, expectedIdentity) {
  const checkout = inspectRepositoryCheckout(
    caveRoot,
    expectedIdentity ?? { repository: 'OpenCoven/coven-cave' },
    'Cave checkout',
  );
  const file = readTrackedFileAtCommit(
    checkout.root,
    'scripts/client-v1-conformance.mjs',
    'Cave assertion engine',
    checkout.commit,
  );
  return {
    ...checkout,
    blob: file.blob,
    digest: file.sha256,
    size: file.size,
    sourceBytes: file.bytes,
  };
}

export async function loadCommittedCaveAssertionEngine(inspected) {
  const owned = createOwnedTempDirectory({
    prefix: 'opencoven-cave-assertion-engine',
    childSegments: ['scripts'],
  });
  const enginePath = resolve(owned.path, 'client-v1-conformance.mjs');
  try {
    writeFileSync(enginePath, inspected.sourceBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    const materializedBytes = readFileSync(enginePath);
    if (
      !materializedBytes.equals(inspected.sourceBytes)
      || sha256(materializedBytes) !== inspected.digest
    ) {
      throw new Error(
        'Materialized Cave assertion engine does not match the committed Git blob',
      );
    }
    return await import(
      `${pathToFileURL(enginePath).href}?sha256=${inspected.digest}`
    );
  } finally {
    cleanupOwnedTempRoot(owned);
  }
}

export function assertAggregationHostPlatform(platform = process.platform) {
  if (!aggregationHostPlatforms.has(platform)) {
    throw new Error(
      'Conformance aggregation is supported only on darwin and linux coordinators',
    );
  }
}

function inspectPrivateDirectory(path, label) {
  let stats;
  let canonicalPath;
  try {
    stats = lstatSync(path);
    canonicalPath = realpathSync(path);
  } catch (error) {
    throw new Error(`${label} must exist before publication`, { cause: error });
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  if (canonicalPath !== resolve(path)) {
    throw new Error(`${label} must not contain symlink path components`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`${label} must be owner-private`);
  }
  if (
    typeof process.getuid === 'function'
    && stats.uid !== process.getuid()
  ) {
    throw new Error(`${label} must be owned by the current user`);
  }
  return {
    path: canonicalPath,
    dev: stats.dev,
    ino: stats.ino,
  };
}

function assertDirectoryIdentity(identity, label) {
  const current = inspectPrivateDirectory(identity.path, label);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new Error(`${label} identity changed during publication`);
  }
  return current;
}

function assertCurrentDirectoryIdentity(identity, label) {
  const current = lstatSync('.');
  if (
    !current.isDirectory()
    || current.dev !== identity.dev
    || current.ino !== identity.ino
  ) {
    throw new Error(`${label} identity changed during publication`);
  }
}

function assertRelativeDirectoryIdentity(path, identity, label) {
  const current = lstatSync(path);
  if (
    !current.isDirectory()
    || current.isSymbolicLink()
    || current.dev !== identity.dev
    || current.ino !== identity.ino
  ) {
    throw new Error(`${label} identity changed during publication`);
  }
}

function ensurePrivateDirectory(path, label) {
  if (!existsSync(path)) {
    try {
      mkdirSync(path, { mode: 0o700 });
      chmodSync(path, 0o700);
    } catch (error) {
      if (
        !(error instanceof Error)
        || !('code' in error)
        || error.code !== 'EEXIST'
      ) {
        throw error;
      }
    }
  }
  return inspectPrivateDirectory(path, label);
}

export function fsyncPublicationDirectory(
  directoryPath,
  platform = process.platform,
  expectedIdentity,
) {
  assertAggregationHostPlatform(platform);
  let descriptor;
  try {
    descriptor = openSync(
      directoryPath,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isDirectory()
      || (
        expectedIdentity !== undefined
        && (
          opened.dev !== expectedIdentity.dev
          || opened.ino !== expectedIdentity.ino
        )
      )
    ) {
      throw new Error('directory identity changed');
    }
    fsyncSync(descriptor);
  } catch (error) {
    throw new Error(
      `Cannot fsync evidence directory on ${platform}`,
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function unlinkIfExact(path, expectedStats) {
  try {
    const current = lstatSync(path);
    if (
      current.dev === expectedStats.dev
      && current.ino === expectedStats.ino
    ) {
      unlinkSync(path);
      return true;
    }
    return false;
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return true;
    }
    throw error;
  }
}

function readDescriptorBytes(descriptor, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const read = readSync(
      descriptor,
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    );
    if (read === 0) break;
    offset += read;
  }
  return bytes.subarray(0, offset);
}

function assertDescriptorContent(descriptor, expectedBytes, message) {
  const stats = fstatSync(descriptor);
  if (
    !stats.isFile()
    || stats.size !== expectedBytes.byteLength
    || !readDescriptorBytes(descriptor, stats.size).equals(expectedBytes)
  ) {
    throw new Error(message);
  }
  return stats;
}

function assertPathIdentity(path, expectedStats, message, onMismatch) {
  const stats = lstatSync(path);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || stats.dev !== expectedStats.dev
    || stats.ino !== expectedStats.ino
  ) {
    onMismatch?.(stats);
    throw new Error(message);
  }
  return stats;
}

function removeDirectoryIfExact(path, expectedIdentity) {
  try {
    const current = lstatSync(path);
    if (
      !current.isDirectory()
      || current.isSymbolicLink()
      || current.dev !== expectedIdentity.dev
      || current.ino !== expectedIdentity.ino
    ) {
      return false;
    }
    rmdirSync(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return true;
    }
    throw error;
  }
}

export function publishEvidenceAtomically(
  outputRoot,
  outputName,
  bytes,
  options = {},
) {
  const platform = options.platform ?? process.platform;
  assertAggregationHostPlatform(platform);
  if (
    typeof outputName !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{0,126}\.json$/u.test(outputName)
    || outputName.includes('..')
  ) {
    throw new Error('Evidence output name must be a canonical JSON filename');
  }
  if (typeof bytes !== 'string') {
    throw new Error('Evidence publication bytes must be a UTF-8 string');
  }
  const expectedBytes = Buffer.from(bytes, 'utf8');
  const outputIdentity = inspectPrivateDirectory(outputRoot, 'output root');
  const outputPath = resolve(outputIdentity.path, outputName);
  const lockName = '.publication-lock';
  const temporaryPath =
    `.${outputName}.${process.pid}.${randomUUID()}.tmp`;
  let lockIdentity;
  let lockDescriptor;
  let temporaryDescriptor;
  let outputDescriptor;
  let temporaryStats;
  let publishedStats;
  let temporaryPathStats;
  let linked = false;
  let temporaryUnlinked = false;
  const previousCwd = process.cwd();
  let cwdAnchored = false;
  try {
    process.chdir(outputIdentity.path);
    cwdAnchored = true;
    assertCurrentDirectoryIdentity(outputIdentity, 'output root');
    if (existsSync(outputName)) {
      throw new Error(`Refusing to overwrite existing evidence ${outputName}`);
    }
    try {
      mkdirSync(lockName, { mode: 0o700 });
      chmodSync(lockName, 0o700);
    } catch (error) {
      if (
        error instanceof Error
        && 'code' in error
        && error.code === 'EEXIST'
      ) {
        throw new Error('Evidence publication lock is already held', {
          cause: error,
        });
      }
      throw error;
    }
    lockIdentity = inspectPrivateDirectory(
      resolve(outputIdentity.path, lockName),
      'publication lock',
    );
    lockDescriptor = openSync(
      lockName,
      constants.O_RDONLY
        | (constants.O_DIRECTORY ?? 0)
        | (constants.O_NOFOLLOW ?? 0),
    );
    const openedLock = fstatSync(lockDescriptor);
    if (
      !openedLock.isDirectory()
      || openedLock.dev !== lockIdentity.dev
      || openedLock.ino !== lockIdentity.ino
    ) {
      throw new Error('Publication lock identity changed');
    }
    fsyncPublicationDirectory('.', platform, outputIdentity);
    temporaryDescriptor = openSync(
      temporaryPath,
      constants.O_RDWR
        | constants.O_CREAT
        | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(temporaryDescriptor, expectedBytes);
    fsyncSync(temporaryDescriptor);
    temporaryStats = fstatSync(temporaryDescriptor);
    if (
      !temporaryStats.isFile()
      || temporaryStats.nlink !== 1
      || (temporaryStats.mode & 0o077) !== 0
      || (
        typeof process.getuid === 'function'
        && temporaryStats.uid !== process.getuid()
      )
    ) {
      throw new Error('Prepared evidence file is not an owner-private regular file');
    }
    options.afterTempFsyncBeforeCommit?.();
    options.beforeLink?.();
    assertDirectoryIdentity(outputIdentity, 'output root');
    assertCurrentDirectoryIdentity(outputIdentity, 'output root');
    assertRelativeDirectoryIdentity(
      lockName,
      lockIdentity,
      'publication lock',
    );
    temporaryStats = assertDescriptorContent(
      temporaryDescriptor,
      expectedBytes,
      'Prepared evidence content changed before publication',
    );
    temporaryPathStats = assertPathIdentity(
      temporaryPath,
      temporaryStats,
      'Prepared evidence path no longer names the prepared descriptor',
      (stats) => {
        temporaryPathStats = stats;
      },
    );
    fchmodSync(temporaryDescriptor, 0o400);
    fsyncSync(temporaryDescriptor);
    options.afterPreparedVerifyBeforeLink?.();
    temporaryStats = assertDescriptorContent(
      temporaryDescriptor,
      expectedBytes,
      'Prepared evidence content changed before publication',
    );
    temporaryPathStats = assertPathIdentity(
      temporaryPath,
      temporaryStats,
      'Prepared evidence path no longer names the prepared descriptor',
      (stats) => {
        temporaryPathStats = stats;
      },
    );
    fchmodSync(temporaryDescriptor, 0o400);
    fsyncSync(temporaryDescriptor);
    try {
      linkSync(temporaryPath, outputName);
      linked = true;
    } catch (error) {
      if (
        error instanceof Error
        && 'code' in error
        && error.code === 'EEXIST'
      ) {
        throw new Error(`Refusing to overwrite existing evidence ${outputName}`, {
          cause: error,
        });
      }
      throw error;
    }
    publishedStats = lstatSync(outputName);
    options.afterLinkBeforeVerify?.();
    assertDirectoryIdentity(outputIdentity, 'output root');
    assertCurrentDirectoryIdentity(outputIdentity, 'output root');
    assertRelativeDirectoryIdentity(
      lockName,
      lockIdentity,
      'publication lock',
    );
    outputDescriptor = openSync(
      outputName,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedOutput = fstatSync(outputDescriptor);
    if (
      !openedOutput.isFile()
      || openedOutput.dev !== temporaryStats.dev
      || openedOutput.ino !== temporaryStats.ino
    ) {
      throw new Error(
        'Published evidence inode does not match the prepared descriptor',
      );
    }
    assertPathIdentity(
      outputName,
      openedOutput,
      'Published evidence path identity changed during publication',
    );
    const preparedAfterLink = assertDescriptorContent(
      temporaryDescriptor,
      expectedBytes,
      'Published evidence content changed during publication',
    );
    const publishedAfterLink = assertDescriptorContent(
      outputDescriptor,
      expectedBytes,
      'Published evidence content changed during publication',
    );
    if (
      preparedAfterLink.nlink !== 2
      || publishedAfterLink.nlink !== 2
    ) {
      throw new Error('Published evidence has an unexpected hard-link count');
    }
    options.afterLink?.();
    fsyncSync(outputDescriptor);
    unlinkSync(temporaryPath);
    temporaryUnlinked = true;
    options.afterTempUnlinkBeforeFinalVerify?.();
    assertCurrentDirectoryIdentity(outputIdentity, 'output root');
    assertDirectoryIdentity(outputIdentity, 'output root');
    assertRelativeDirectoryIdentity(
      lockName,
      lockIdentity,
      'publication lock',
    );
    const preparedFinal = assertDescriptorContent(
      temporaryDescriptor,
      expectedBytes,
      'Published evidence content changed during publication',
    );
    const publishedFinal = assertDescriptorContent(
      outputDescriptor,
      expectedBytes,
      'Published evidence content changed during publication',
    );
    if (
      preparedFinal.dev !== publishedFinal.dev
      || preparedFinal.ino !== publishedFinal.ino
      || preparedFinal.nlink !== 1
      || publishedFinal.nlink !== 1
    ) {
      throw new Error('Published evidence retains an unexpected inode alias');
    }
    assertPathIdentity(
      outputName,
      publishedFinal,
      'Published evidence path identity changed during publication',
    );
    fsyncSync(outputDescriptor);
    fsyncPublicationDirectory('.', platform, outputIdentity);
    if (!removeDirectoryIfExact(lockName, lockIdentity)) {
      throw new Error('Publication lock identity changed');
    }
    lockIdentity = undefined;
    fsyncPublicationDirectory('.', platform, outputIdentity);
  } catch (error) {
    const rollbackErrors = [];
    if (linked && publishedStats !== undefined) {
      try {
        if (!unlinkIfExact(outputName, publishedStats)) {
          rollbackErrors.push(
            new Error('Refused to remove a non-matching publication destination'),
          );
        } else {
          fsyncPublicationDirectory(
            '.',
            platform,
            outputIdentity,
          );
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (!temporaryUnlinked && temporaryStats !== undefined) {
      try {
        const cleanupStats =
          publishedStats !== undefined
          && (
            publishedStats.dev !== temporaryStats.dev
            || publishedStats.ino !== temporaryStats.ino
          )
            ? publishedStats
            : temporaryPathStats ?? temporaryStats;
        if (!unlinkIfExact(temporaryPath, cleanupStats)) {
          rollbackErrors.push(
            new Error('Refused to remove a non-matching publication temporary'),
          );
        }
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError);
      }
    }
    if (lockIdentity !== undefined) {
      try {
        if (!removeDirectoryIfExact(lockName, lockIdentity)) {
          rollbackErrors.push(
            new Error('Refused to remove a non-matching publication lock'),
          );
        } else {
          lockIdentity = undefined;
        }
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError);
      }
    }
    try {
      fsyncPublicationDirectory('.', platform, outputIdentity);
    } catch (cleanupError) {
      rollbackErrors.push(cleanupError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Evidence publication failed and rollback was incomplete',
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (outputDescriptor !== undefined) closeSync(outputDescriptor);
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    if (cwdAnchored) process.chdir(previousCwd);
  }
  return outputPath;
}

function ensureFixedPublicationRoot() {
  if (!existsSync(fixedArtifactRoot)) {
    try {
      mkdirSync(fixedArtifactRoot, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error)
        || !('code' in error)
        || error.code !== 'EEXIST'
      ) {
        throw error;
      }
    }
  }
  const artifactStats = lstatSync(fixedArtifactRoot);
  if (
    !artifactStats.isDirectory()
    || artifactStats.isSymbolicLink()
    || (artifactStats.mode & 0o022) !== 0
    || (
      typeof process.getuid === 'function'
      && artifactStats.uid !== process.getuid()
    )
  ) {
    throw new Error('SDK .artifacts root is not a safe owned directory');
  }
  return ensurePrivateDirectory(fixedOutputRoot, 'output root').path;
}

function fileMetadata(path, file) {
  return {
    path,
    size: file.size,
    sha256: file.sha256,
  };
}

function readEvidenceFile(path) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Platform evidence input must be a regular non-symlink file');
  }
  if (metadata.size > 1_048_576) {
    throw new Error('Platform evidence input exceeds the 1048576-byte limit');
  }
  return readFileSync(path, 'utf8');
}

async function runConformanceAggregationWithScrubbedEnvironment(argv) {
  assertAggregationHostPlatform();
  const options = parseConformanceAggregationArgs(argv);
  const validatorCheckout = inspectRepositoryCheckout(
    repositoryRoot,
    { repository: 'OpenCoven/sdk' },
    'SDK validator checkout',
  );
  const validatorLockFile = readTrackedFileAtCommit(
    validatorCheckout.root,
    frozenLockPath,
    'Frozen conformance lock',
    validatorCheckout.commit,
  );
  const validatorRegistryFile = readTrackedFileAtCommit(
    validatorCheckout.root,
    assertionRegistryPath,
    'Assertion registry',
    validatorCheckout.commit,
  );
  const validatorSchemaFile = readTrackedFileAtCommit(
    validatorCheckout.root,
    evidenceSchemaPath,
    'Evidence JSON Schema',
    validatorCheckout.commit,
  );
  const validatorContractFile = readTrackedFileAtCommit(
    validatorCheckout.root,
    contractPath,
    'Evidence contract',
    validatorCheckout.commit,
  );
  const frozenLock = parseFrozenConformanceLock(
    validatorLockFile.bytes.toString('utf8'),
    'committed frozen conformance lock',
  );
  if (
    assertFrozenNodeRuntime(repositoryRoot)
      !== frozenLock.toolchain.nodeVersion
  ) {
    throw new Error(
      'Frozen conformance lock Node version does not match .node-version',
    );
  }
  const bindings = validateFrozenConformanceBindings(
    frozenLock,
    validatorSchemaFile.bytes.toString('utf8'),
    validatorRegistryFile.bytes.toString('utf8'),
  );
  const registry = bindings.registry;
  const evidenceSchema = bindings.schema;
  const evidenceProducer = assertEvidenceProducerCompatibility(frozenLock);
  const platformRecords = options.recordPaths.map((recordPath) =>
    parsePlatformEvidence(
      readEvidenceFile(resolve(recordPath)),
      'platform evidence input',
      evidenceSchema,
    ),
  );
  const baseline = platformRecords[0];
  if (baseline === undefined) {
    throw new Error('No platform evidence records were supplied');
  }
  if (
    baseline.harness.name !== evidenceProducer.harness.path
    || baseline.harness.version !== evidenceProducer.harness.version
    || baseline.harness.repository !== evidenceProducer.repository
    || baseline.harness.commit !== evidenceProducer.commit
    || baseline.harness.tree !== evidenceProducer.tree
  ) {
    throw new Error(
      'Platform evidence harness does not match the frozen harness contract',
    );
  }
  const expectedValidator = {
    repository: validatorCheckout.repository,
    commit: validatorCheckout.commit,
    tree: validatorCheckout.tree,
    contract: fileMetadata(contractPath, validatorContractFile),
    schema: fileMetadata(evidenceSchemaPath, validatorSchemaFile),
  };
  for (const record of platformRecords) {
    if (
      JSON.stringify(record.provenance.validator)
      !== JSON.stringify(expectedValidator)
    ) {
      throw new Error(
        `${record.platform} validator provenance does not match this committed validator checkout`,
      );
    }
    if (
      record.artifacts.frozenLock.size !== validatorLockFile.size
      || record.artifacts.frozenLock.sha256 !== validatorLockFile.sha256
      || record.artifacts.assertionRegistry.size !== validatorRegistryFile.size
      || record.artifacts.assertionRegistry.sha256 !== validatorRegistryFile.sha256
    ) {
      throw new Error(
        `${record.platform} validator artifact metadata does not match this checkout`,
      );
    }
  }
  const candidateCheckout = inspectRepositoryCheckout(
    resolve(options.candidateRoot),
    {
      repository: frozenLock.candidate.repository,
      commit: frozenLock.candidate.commit,
      tree: frozenLock.candidate.tree,
    },
    'SDK candidate checkout',
  );
  const caveCheckout = inspectRepositoryCheckout(
    resolve(options.caveRoot),
    {
      repository: frozenLock.sources.cave.repository,
      commit: frozenLock.sources.cave.commit,
      tree: frozenLock.sources.cave.tree,
    },
    'Cave checkout',
  );
  inspectRepositoryCheckout(
    resolve(options.covenRoot),
    {
      repository: frozenLock.sources.coven.repository,
      commit: frozenLock.sources.coven.commit,
      tree: frozenLock.sources.coven.tree,
    },
    'Coven checkout',
  );
  const chatCheckout = inspectRepositoryCheckout(
    resolve(options.chatRoot),
    {
      repository: frozenLock.sources.chat.repository,
      commit: frozenLock.sources.chat.commit,
      tree: frozenLock.sources.chat.tree,
    },
    'Chat checkout',
  );
  const harnessCheckout = inspectRepositoryCheckout(
    resolve(options.harnessRoot),
    {
      repository: evidenceProducer.repository,
      commit: evidenceProducer.commit,
      tree: evidenceProducer.tree,
    },
    'Chat harness checkout',
  );
  for (const expected of frozenLock.candidate.cavePackageFiles) {
    assertCommittedFileMetadata(
      candidateCheckout.root,
      candidateCheckout.commit,
      expected,
      'SDK candidate Cave package file',
    );
  }
  let caveEngineFile;
  for (const expected of frozenLock.sources.cave.files) {
    const file = assertCommittedFileMetadata(
      caveCheckout.root,
      caveCheckout.commit,
      expected,
      'Cave authority file',
    );
    if (expected.path === 'scripts/client-v1-conformance.mjs') {
      caveEngineFile = file;
    }
  }
  assertCommittedFileMetadata(
    chatCheckout.root,
    chatCheckout.commit,
    frozenLock.sources.chat.consumerLock,
    'Chat consumer lock',
  );
  for (const expected of frozenLock.sources.chat.vendorFiles) {
    assertCommittedFileMetadata(
      chatCheckout.root,
      chatCheckout.commit,
      expected,
      'Chat vendored SDK package',
    );
  }
  assertCommittedFileMetadata(
    harnessCheckout.root,
    harnessCheckout.commit,
    evidenceProducer.packageManifest,
    'Chat conformance producer package manifest',
  );
  assertCommittedFileMetadata(
    harnessCheckout.root,
    harnessCheckout.commit,
    evidenceProducer.harness,
    'Chat conformance harness',
  );
  if (caveEngineFile === undefined) {
    throw new Error('Frozen Cave assertion engine metadata is missing');
  }
  const caveEngine = await loadCommittedCaveAssertionEngine({
    digest: caveEngineFile.sha256,
    sourceBytes: caveEngineFile.bytes,
  });
  const releaseConfig = readReleaseConfig(repositoryRoot);
  const aggregate = aggregateConformanceEvidence({
    caveEngine,
    caveEngineSha256: caveEngineFile.sha256,
    assertionRegistrySha256: validatorRegistryFile.sha256,
    frozenLockSha256: validatorLockFile.sha256,
    frozenLockSize: validatorLockFile.size,
    frozenLock,
    canonicalPlatforms: releaseConfig.nativeConformancePlatforms,
    registry,
    platformRecords,
  });
  const serialized = serializeCanonicalJson(aggregate);
  if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) {
    throw new Error('Aggregate evidence exceeds the 1048576-byte evidence limit');
  }
  const outputRoot = ensureFixedPublicationRoot();
  const outputPath = publishEvidenceAtomically(
    outputRoot,
    options.outputName,
    serialized,
  );
  process.stdout.write(
    `client-v1 aggregate validated and written to .artifacts/client-v1-cross-repository-results/${basename(outputPath)}\n`,
  );
  return aggregate;
}

export async function runConformanceAggregation(argv = process.argv.slice(2)) {
  return runWithGitHubTokensScrubbed(
    process.env,
    () => runConformanceAggregationWithScrubbedEnvironment(argv),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runConformanceAggregation().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`client-v1 cross-repository aggregation: ${message}\n`);
    process.exitCode = 1;
  });
}
