import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testFaultEnv = 'OPENCOVEN_IMPORT_CONTRACT_FIXTURES_TEST_FAULT';
const testFault = parseTestFault(process.env[testFaultEnv]);

const defaultCaveRoot = resolve(root, '..', 'coven-cave', '.worktrees', 'client-v1-contract');
const defaultCovenRoot = resolve(root, '..', 'coven', '.worktrees', 'coven-client');

function parseArgs(args) {
  const options = {
    caveRoot: defaultCaveRoot,
    covenRoot: defaultCovenRoot,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];

    if (argument === '--cave-root' && typeof next === 'string') {
      options.caveRoot = resolve(next);
      index += 1;
      continue;
    }

    if (argument === '--coven-root' && typeof next === 'string') {
      options.covenRoot = resolve(next);
      index += 1;
      continue;
    }

    throw new Error(
      'usage: import-contract-fixtures.mjs [--cave-root <path>] [--coven-root <path>]',
    );
  }

  return options;
}

function requireFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing authority fixture file: ${path}`);
  }

  return readFileSync(path);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseTestFault(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const [phase, indexText, ...unexpected] = value.split(':');
  const validPhase =
    phase === 'stage-write' || phase === 'backup-rename' || phase === 'commit-rename';

  if (unexpected.length > 0 || !validPhase || !/^(0|[1-9]\d*)$/.test(indexText)) {
    throw new Error(
      `Invalid ${testFaultEnv} value "${value}". Expected <stage-write|backup-rename|commit-rename>:<index>.`,
    );
  }

  return {
    phase,
    index: Number(indexText),
  };
}

function maybeInjectTestFault(phase, index, path) {
  if (testFault?.phase !== phase || testFault.index !== index) {
    return;
  }

  throw new Error(
    `[test-only] injected ${phase} failure for ${path} via ${testFaultEnv}.`,
  );
}

function buildCopyPlan(caveRoot, covenRoot) {
  const cave = verifyCaveAuthority(caveRoot);

  return [
    {
      sourcePath: cave.fixturePath,
      destinationPath: resolve(root, 'packages', 'cave', 'fixtures', 'contract-fixture.json'),
      bytes: cave.fixture,
    },
    {
      sourcePath: cave.digestPath,
      destinationPath: resolve(root, 'packages', 'cave', 'fixtures', 'contract-fixture.sha256'),
      bytes: cave.digest,
    },
    {
      sourcePath: resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'health.json'),
      destinationPath: resolve(root, 'packages', 'coven', 'fixtures', 'health.json'),
      bytes: requireFile(resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'health.json')),
    },
    {
      sourcePath: resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'error.json'),
      destinationPath: resolve(root, 'packages', 'coven', 'fixtures', 'error.json'),
      bytes: requireFile(resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'error.json')),
    },
  ];
}

function verifyCaveAuthority(caveRoot) {
  const fixturePath = resolve(
    caveRoot,
    'src',
    'lib',
    'server',
    'client-v1',
    'contract-fixture.json',
  );
  const digestPath = resolve(
    caveRoot,
    'src',
    'lib',
    'server',
    'client-v1',
    'contract-fixture.sha256',
  );

  const fixture = requireFile(fixturePath);
  const digest = requireFile(digestPath);
  const expectedDigest = `${sha256(fixture)}\n`;

  if (digest.toString('utf8') !== expectedDigest) {
    throw new Error(
      `Authority Cave fixture digest mismatch at ${digestPath}: expected ${expectedDigest.trim()}, received ${digest.toString('utf8').trim()}.`,
    );
  }

  return {
    fixturePath,
    digestPath,
    fixture,
    digest,
  };
}

function prepareAtomicCopy(plan) {
  const token = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;

  return plan.map((entry, index) => ({
    ...entry,
    planIndex: index,
    hadOriginal: existsSync(entry.destinationPath),
    tempPath: `${entry.destinationPath}.importing-${token}-${index}.tmp`,
    backupPath: `${entry.destinationPath}.importing-${token}-${index}.bak`,
    staged: false,
    backedUp: false,
    installed: false,
  }));
}

function rollbackAtomicCopy(plan, originalError) {
  const rollbackErrors = [];

  for (const entry of [...plan].reverse()) {
    try {
      if (entry.installed && existsSync(entry.destinationPath)) {
        rmSync(entry.destinationPath, { force: true });
      }

      if (entry.backedUp && existsSync(entry.backupPath)) {
        renameSync(entry.backupPath, entry.destinationPath);
      }
    } catch (error) {
      rollbackErrors.push(
        `Failed to restore ${entry.destinationPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const cleanupPath of [entry.tempPath, entry.backupPath]) {
      try {
        rmSync(cleanupPath, { force: true });
      } catch (error) {
        rollbackErrors.push(
          `Failed to clean up ${cleanupPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (rollbackErrors.length > 0) {
    throw new Error(
      `${originalError instanceof Error ? originalError.message : String(originalError)}\nRollback failed:\n${rollbackErrors.join('\n')}`,
    );
  }
}

function copyAllOrNothing(plan) {
  const atomicPlan = prepareAtomicCopy(plan);

  try {
    for (const entry of atomicPlan) {
      mkdirSync(dirname(entry.destinationPath), { recursive: true });
      maybeInjectTestFault('stage-write', entry.planIndex, entry.tempPath);
      writeFileSync(entry.tempPath, entry.bytes, { flag: 'wx' });
      entry.staged = true;
    }

    for (const entry of atomicPlan) {
      if (!entry.hadOriginal) {
        continue;
      }

      maybeInjectTestFault('backup-rename', entry.planIndex, entry.destinationPath);
      renameSync(entry.destinationPath, entry.backupPath);
      entry.backedUp = true;
    }

    for (const entry of atomicPlan) {
      maybeInjectTestFault('commit-rename', entry.planIndex, entry.destinationPath);
      renameSync(entry.tempPath, entry.destinationPath);
      entry.installed = true;
    }
  } catch (error) {
    rollbackAtomicCopy(atomicPlan, error);
    throw error;
  }

  for (const entry of atomicPlan) {
    rmSync(entry.backupPath, { force: true });
  }
}

function main() {
  const { caveRoot, covenRoot } = parseArgs(process.argv.slice(2));
  const plan = buildCopyPlan(caveRoot, covenRoot);

  copyAllOrNothing(plan);

  process.stdout.write('Authority fixtures synchronized.\n');
}

main();
