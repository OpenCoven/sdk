import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const provenancePath = resolve(
  root,
  'packages/cave/fixtures/contract-fixture.provenance.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readProvenance() {
  return JSON.parse(readFileSync(provenancePath, 'utf8'));
}

function resolveGitCommit(caveRoot) {
  return execFileSync('git', ['-C', caveRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function verifyCaveContractAuthority({
  caveRoot,
  expectedCommit,
  resolveCommit = resolveGitCommit,
}) {
  const provenance = readProvenance();
  const pinnedCommit = expectedCommit ?? provenance.commit;

  if (pinnedCommit !== provenance.commit) {
    throw new Error(
      `Requested Cave authority commit ${pinnedCommit} does not match pinned provenance ${provenance.commit}.`,
    );
  }

  const actualCommit = resolveCommit(caveRoot);
  if (actualCommit !== pinnedCommit) {
    throw new Error(
      `Cave authority checkout is at ${actualCommit}; expected ${pinnedCommit}.`,
    );
  }

  const fixture = readFileSync(resolve(caveRoot, provenance.fixturePath));
  const digest = readFileSync(resolve(caveRoot, provenance.digestPath), 'utf8');
  const actualDigest = sha256(fixture);

  if (digest !== `${actualDigest}\n`) {
    throw new Error('Cave authority fixture digest file does not match its fixture bytes.');
  }

  if (actualDigest !== provenance.sha256) {
    throw new Error(
      `Cave authority fixture digest is ${actualDigest}; expected ${provenance.sha256}.`,
    );
  }

  const vendoredFixture = readFileSync(
    resolve(root, 'packages/cave/fixtures/contract-fixture.json'),
  );
  if (!fixture.equals(vendoredFixture)) {
    throw new Error('Vendored Cave fixture bytes differ from the pinned authority checkout.');
  }
  const vector = readFileSync(resolve(caveRoot, provenance.vectorPath));
  const vectorDigest = readFileSync(
    resolve(caveRoot, provenance.vectorDigestPath),
    'utf8',
  );
  const actualVectorDigest = sha256(vector);
  if (vectorDigest !== `${actualVectorDigest}\n`) {
    throw new Error(
      'Cave authority HPKE vector digest file does not match its vector bytes.',
    );
  }
  if (actualVectorDigest !== provenance.vectorSha256) {
    throw new Error(
      `Cave authority HPKE vector digest is ${actualVectorDigest}; expected ${provenance.vectorSha256}.`,
    );
  }
  const vendoredVector = readFileSync(
    resolve(root, 'packages/cave/fixtures/hpke-bound-v1-vectors.json'),
  );
  if (!vector.equals(vendoredVector)) {
    throw new Error(
      'Vendored Cave HPKE vector bytes differ from the pinned authority checkout.',
    );
  }

  return {
    commit: actualCommit,
    sha256: actualDigest,
    vectorSha256: actualVectorDigest,
  };
}

export function parseCaveContractAuthorityArguments(argv) {
  if (argv[0] === '--') {
    argv = argv.slice(1);
  }

  if (argv.length !== 2 || argv[0] !== '--cave-root') {
    throw new Error('usage: verify-cave-contract-authority.mjs --cave-root <path>');
  }

  return {
    caveRoot: resolve(argv[1]),
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = verifyCaveContractAuthority(
    parseCaveContractAuthorityArguments(process.argv.slice(2)),
  );
  console.log(
    `Cave authority verified at ${result.commit} (${result.sha256}; HPKE ${result.vectorSha256}).`,
  );
}
