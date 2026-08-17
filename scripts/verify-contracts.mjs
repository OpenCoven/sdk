import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fixtureChecks = [
  {
    path: 'packages/cave/fixtures/contract-fixture.json',
    digest: '55a31888682b05068105a8e76cc675c85c35df4f5ad0d65c6ba9d2164f56bbf9',
  },
  {
    path: 'packages/coven/fixtures/health.json',
    digest: '6d339c0796df124579a01debf1f30ac82ad09bc2e68b734b935e3e0e6c19154f',
  },
  {
    path: 'packages/coven/fixtures/error.json',
    digest: '927bfe212e75d6e213780a79e1657033c577c68cdd4119f19ccec944337457c4',
  },
];

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

for (const check of fixtureChecks) {
  const path = resolve(root, check.path);
  const actual = digest(path);

  if (actual !== check.digest) {
    throw new Error(`${check.path} digest mismatch: expected ${check.digest}, received ${actual}`);
  }
}

const caveDigestPath = resolve(root, 'packages/cave/fixtures/contract-fixture.sha256');
const caveDigest = readFileSync(caveDigestPath, 'utf8');

if (caveDigest !== `${fixtureChecks[0].digest}\n`) {
  throw new Error('packages/cave/fixtures/contract-fixture.sha256 does not match the approved digest.');
}

process.stdout.write('Contract fixtures verified.\n');
