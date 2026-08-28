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

function readGitCommitFile(
  caveRoot,
  commit,
  path,
) {
  return execFileSync(
    'git',
    ['-C', caveRoot, 'show', `${commit}:${path}`],
    {
      maxBuffer: 16 * 1_024 * 1_024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

export function verifyCaveContractAuthority({
  caveRoot,
  expectedCommit,
  sourceCommit,
  resolveCommit = resolveGitCommit,
  readCommitFile = readGitCommitFile,
}) {
  const provenance = readProvenance();
  const pinnedCommit = expectedCommit ?? provenance.commit;

  if (pinnedCommit !== provenance.commit) {
    throw new Error(
      `Requested Cave authority commit ${pinnedCommit} does not match pinned provenance ${provenance.commit}.`,
    );
  }

  const actualCommit = resolveCommit(caveRoot);
  const authorityCommit = sourceCommit ?? actualCommit;
  if (authorityCommit !== pinnedCommit) {
    throw new Error(
      `Cave authority commit is ${authorityCommit}; expected ${pinnedCommit}.`,
    );
  }

  const fixture = readCommitFile(
    caveRoot,
    authorityCommit,
    provenance.fixturePath,
  );
  const digest = readCommitFile(
    caveRoot,
    authorityCommit,
    provenance.digestPath,
  ).toString('utf8');
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
    throw new Error('Vendored Cave fixture bytes differ from the pinned authority commit.');
  }
  const vector = readCommitFile(
    caveRoot,
    authorityCommit,
    provenance.vectorPath,
  );
  const vectorDigest = readCommitFile(
    caveRoot,
    authorityCommit,
    provenance.vectorDigestPath,
  ).toString('utf8');
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
      'Vendored Cave HPKE vector bytes differ from the pinned authority commit.',
    );
  }

  return {
    commit: pinnedCommit,
    checkoutCommit: actualCommit,
    sha256: actualDigest,
    vectorSha256: actualVectorDigest,
  };
}

export function parseCaveContractAuthorityArguments(argv) {
  if (argv[0] === '--') {
    argv = argv.slice(1);
  }

  const sourceCommit = argv[2] === '--commit' ? argv[3] : undefined;
  if (
    (argv.length !== 2 && argv.length !== 4) ||
    argv[0] !== '--cave-root' ||
    (argv.length === 4 && (
      argv[2] !== '--commit' ||
      typeof sourceCommit !== 'string' ||
      !/^[0-9a-f]{40}$/u.test(sourceCommit)
    ))
  ) {
    throw new Error(
      'usage: verify-cave-contract-authority.mjs --cave-root <path> [--commit <sha>]',
    );
  }

  return {
    caveRoot: resolve(argv[1]),
    sourceCommit,
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
    `Cave authority exact commit ${result.commit} verified from repository checkout ${result.checkoutCommit} (${result.sha256}; HPKE ${result.vectorSha256}).`,
  );
}
