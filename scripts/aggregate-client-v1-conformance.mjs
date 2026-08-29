import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  aggregateConformanceEvidence,
  parseConformanceAggregationArgs,
  parseAssertionRegistry,
  parsePlatformEvidence,
} from './conformance-contract.mjs';
import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from './owned-temp-directory.mjs';
import { readReleaseConfig } from './release-readiness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assertionRegistryPath =
  'conformance/client-v1-cross-repository-assertions.json';
const aggregationHostPlatforms = new Set(['darwin', 'linux']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readTrackedHeadFileAtCommit(
  root,
  relativePath,
  label,
  capturedCommit,
) {
  const filePath = resolve(root, relativePath);
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  const treeEntry = execFileSync(
    'git',
    ['ls-tree', capturedCommit, '--', relativePath],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  const match = /^100(?:644|755) blob ([0-9a-f]{40,64})\t(.+)$/u.exec(treeEntry);
  if (match === null || match[2] !== relativePath) {
    throw new Error(`${label} is not tracked at HEAD`);
  }
  const blob = match[1];
  const committedBytes = execFileSync('git', ['cat-file', 'blob', blob], {
    cwd: root,
    encoding: 'buffer',
  });
  const bytes = readFileSync(filePath);
  if (!bytes.equals(committedBytes)) {
    throw new Error(`${label} bytes do not match the captured Git blob`);
  }
  return {
    blob,
    bytes: committedBytes,
    digest: sha256(committedBytes),
  };
}

export function inspectCaveAssertionEngine(caveRoot) {
  const resolvedRoot = realpathSync(caveRoot);
  const gitRoot = realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: resolvedRoot,
      encoding: 'utf8',
    }).trim(),
  );
  if (resolvedRoot !== gitRoot) {
    throw new Error('cave-root must equal the Git top-level');
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolvedRoot,
    encoding: 'utf8',
  }).trim();
  const inspected = readTrackedHeadFileAtCommit(
    resolvedRoot,
    'scripts/client-v1-conformance.mjs',
    'Cave assertion engine',
    commit,
  );
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: resolvedRoot, encoding: 'utf8' },
  ).trim();
  if (dirty.length > 0) {
    throw new Error('Cave assertion-engine checkout has tracked changes');
  }
  return {
    commit,
    blob: inspected.blob,
    digest: inspected.digest,
    sourceBytes: inspected.bytes,
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
      throw new Error('Materialized Cave assertion engine does not match the HEAD Git blob');
    }
    return await import(
      `${pathToFileURL(enginePath).href}?sha256=${inspected.digest}`
    );
  } finally {
    cleanupOwnedTempRoot(owned);
  }
}

export function fsyncPublicationDirectory(
  directoryPath,
  platform = process.platform,
) {
  assertAggregationHostPlatform(platform);
  let descriptor;
  try {
    descriptor = openSync(directoryPath, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    throw new Error(
      `Cannot fsync evidence parent directory on ${platform}`,
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function assertAggregationHostPlatform(platform = process.platform) {
  if (!aggregationHostPlatforms.has(platform)) {
    throw new Error(
      'Conformance aggregation is supported only on darwin and linux coordinators',
    );
  }
}

export function publishPreparedEvidence(
  temporaryPath,
  outputPath,
  syncDirectory = fsyncPublicationDirectory,
) {
  const parentPath = dirname(outputPath);
  syncDirectory(parentPath);
  linkSync(temporaryPath, outputPath);
  try {
    unlinkSync(temporaryPath);
    syncDirectory(parentPath);
  } catch (error) {
    try {
      unlinkSync(outputPath);
      syncDirectory(parentPath);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Evidence publication failed and rollback was incomplete',
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

export function publishEvidenceAtomically(
  outputPath,
  bytes,
  platform = process.platform,
) {
  assertAggregationHostPlatform(platform);
  const resolvedOutput = resolve(outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true, mode: 0o700 });
  const temporaryPath = resolve(
    dirname(resolvedOutput),
    `.${basename(resolvedOutput)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const descriptor = openSync(temporaryPath, 'wx', 0o600);
    try {
      writeFileSync(descriptor, bytes, { encoding: 'utf8' });
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    publishPreparedEvidence(
      temporaryPath,
      resolvedOutput,
      (directoryPath) => fsyncPublicationDirectory(directoryPath, platform),
    );
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (
        !(cleanupError instanceof Error)
        || !('code' in cleanupError)
        || cleanupError.code !== 'ENOENT'
      ) {
        throw cleanupError;
      }
    }
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'EEXIST'
    ) {
      throw new Error(`Refusing to overwrite existing evidence ${outputPath}`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function runConformanceAggregation(argv = process.argv.slice(2)) {
  assertAggregationHostPlatform();
  const options = parseConformanceAggregationArgs(argv);
  const resolvedSdkRoot = realpathSync(repositoryRoot);
  const sdkGitRoot = realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: resolvedSdkRoot,
      encoding: 'utf8',
    }).trim(),
  );
  if (resolvedSdkRoot !== sdkGitRoot) {
    throw new Error('SDK aggregator root must equal the Git top-level');
  }
  const sdkCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolvedSdkRoot,
    encoding: 'utf8',
  }).trim();
  const sdkDirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: resolvedSdkRoot, encoding: 'utf8' },
  ).trim();
  if (sdkDirty.length > 0) {
    throw new Error('SDK aggregator checkout has tracked changes');
  }
  const registryFile = readTrackedHeadFileAtCommit(
    resolvedSdkRoot,
    assertionRegistryPath,
    'Assertion registry',
    sdkCommit,
  );
  const registry = parseAssertionRegistry(
    registryFile.bytes.toString('utf8'),
    'committed assertion registry',
  );
  const releaseConfig = readReleaseConfig(repositoryRoot);
  const platformRecords = options.recordPaths.map((recordPath) =>
    parsePlatformEvidence(readFileSync(resolve(recordPath), 'utf8'), recordPath),
  );
  const cave = inspectCaveAssertionEngine(resolve(options.caveRoot));
  const expectedCaveCommit = platformRecords[0]?.commits.cave;
  if (expectedCaveCommit === undefined || cave.commit !== expectedCaveCommit) {
    throw new Error(
      'Loaded Cave assertion engine checkout does not match the platform evidence commit',
    );
  }
  const expectedSdkCommit = platformRecords[0]?.commits.sdk;
  if (expectedSdkCommit === undefined || sdkCommit !== expectedSdkCommit) {
    throw new Error(
      'Committed assertion registry checkout does not match the platform evidence SDK commit',
    );
  }
  const caveEngine = await loadCommittedCaveAssertionEngine(cave);
  const aggregate = aggregateConformanceEvidence({
    caveEngine,
    caveEngineSha256: cave.digest,
    assertionRegistrySha256: registryFile.digest,
    canonicalPlatforms: releaseConfig.nativeConformancePlatforms,
    registry,
    platformRecords,
  });
  const serialized = `${JSON.stringify(aggregate, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) {
    throw new Error('Aggregate evidence exceeds the 1048576-byte evidence limit');
  }
  publishEvidenceAtomically(options.outputPath, serialized);
  process.stdout.write(
    `client-v1 cross-repository conformance: passed (${aggregate.summary.platforms} platforms, ${aggregate.summary.caveAssertions + aggregate.summary.sdkAssertions + aggregate.summary.chatAssertions} assertions)\n`,
  );
  return aggregate;
}

const invokedDirectly =
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runConformanceAggregation().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`client-v1 cross-repository conformance: ${message}\n`);
    process.exitCode = 1;
  });
}
