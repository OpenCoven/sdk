import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

function copyBinary(sourcePath, destinationPath) {
  const bytes = requireFile(sourcePath);
  mkdirSync(dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, bytes);
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
  const digest = requireFile(digestPath).toString('utf8');
  const expectedDigest = `${sha256(fixture)}\n`;

  if (digest !== expectedDigest) {
    throw new Error(
      `Authority Cave fixture digest mismatch at ${digestPath}: expected ${expectedDigest.trim()}, received ${digest.trim()}.`,
    );
  }

  return {
    fixturePath,
    digestPath,
  };
}

function main() {
  const { caveRoot, covenRoot } = parseArgs(process.argv.slice(2));
  const cave = verifyCaveAuthority(caveRoot);

  copyBinary(
    cave.fixturePath,
    resolve(root, 'packages', 'cave', 'fixtures', 'contract-fixture.json'),
  );
  copyBinary(
    cave.digestPath,
    resolve(root, 'packages', 'cave', 'fixtures', 'contract-fixture.sha256'),
  );

  copyBinary(
    resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'health.json'),
    resolve(root, 'packages', 'coven', 'fixtures', 'health.json'),
  );
  copyBinary(
    resolve(covenRoot, 'crates', 'coven-client', 'fixtures', 'error.json'),
    resolve(root, 'packages', 'coven', 'fixtures', 'error.json'),
  );

  process.stdout.write('Authority fixtures synchronized.\n');
}

main();
