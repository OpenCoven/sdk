import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  aggregateConformanceEvidence,
  parseConformanceAggregationArgs,
  parsePlatformEvidence,
  readAssertionRegistry,
} from './conformance-contract.mjs';
import { readReleaseConfig } from './release-readiness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readCaveEngine(caveRoot) {
  const resolvedRoot = realpathSync(caveRoot);
  const enginePath = resolve(resolvedRoot, 'scripts/client-v1-conformance.mjs');
  const metadata = lstatSync(enginePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Cave assertion engine must be a regular non-symlink file');
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolvedRoot,
    encoding: 'utf8',
  }).trim();
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: resolvedRoot, encoding: 'utf8' },
  ).trim();
  if (dirty.length > 0) {
    throw new Error('Cave assertion-engine checkout has tracked changes');
  }
  const bytes = readFileSync(enginePath);
  return {
    commit,
    digest: sha256(bytes),
    moduleUrl: `${pathToFileURL(enginePath).href}?sha256=${sha256(bytes)}`,
  };
}

function writeNewEvidence(outputPath, bytes) {
  const resolvedOutput = resolve(outputPath);
  if (existsSync(resolvedOutput)) {
    throw new Error(`Refusing to overwrite existing evidence ${outputPath}`);
  }
  mkdirSync(dirname(resolvedOutput), { recursive: true, mode: 0o700 });
  const temporaryPath = resolve(
    dirname(resolvedOutput),
    `.${basename(resolvedOutput)}.${process.pid}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, resolvedOutput);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

export async function runConformanceAggregation(argv = process.argv.slice(2)) {
  const options = parseConformanceAggregationArgs(argv);
  const registry = readAssertionRegistry(
    options.registryPath === null
      ? resolve(
          repositoryRoot,
          'conformance/client-v1-cross-repository-assertions.json',
        )
      : resolve(options.registryPath),
  );
  const releaseConfig = readReleaseConfig(repositoryRoot);
  const platformRecords = options.recordPaths.map((recordPath) =>
    parsePlatformEvidence(readFileSync(resolve(recordPath), 'utf8'), recordPath),
  );
  const cave = readCaveEngine(resolve(options.caveRoot));
  const expectedCaveCommit = platformRecords[0]?.commits.cave;
  if (expectedCaveCommit === undefined || cave.commit !== expectedCaveCommit) {
    throw new Error(
      'Loaded Cave assertion engine checkout does not match the platform evidence commit',
    );
  }
  const caveEngine = await import(cave.moduleUrl);
  const aggregate = aggregateConformanceEvidence({
    caveEngine,
    caveEngineSha256: cave.digest,
    canonicalPlatforms: releaseConfig.nativeConformancePlatforms,
    registry,
    platformRecords,
  });
  const serialized = `${JSON.stringify(aggregate, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) {
    throw new Error('Aggregate evidence exceeds the 1048576-byte evidence limit');
  }
  writeNewEvidence(options.outputPath, serialized);
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
