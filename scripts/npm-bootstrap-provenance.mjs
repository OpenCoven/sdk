import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readdirSync,
  readSync, realpathSync, writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { inflateRawSync, crc32 } from 'node:zlib';

import { parseJsonText, serializeCanonicalJson } from './conformance-contract.mjs';
import { PUBLIC_PACKAGES } from './repository-metadata.mjs';
import { createGitHubCliEnvironment } from './release-runtime-integrity.mjs';
import { createOwnedTempDirectory, cleanupOwnedTempRoot } from './owned-temp-directory.mjs';

export const MAX_NPM_PROVENANCE_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA512 = /^[0-9a-f]{128}$/u;
const ID = /^[1-9]\d*$/u;
const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const REPOSITORY = 'https://github.com/OpenCoven/sdk';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, fields, label) {
  if (
    !record(value)
    || Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} must contain exactly ${fields.join(', ')}`);
  }
}

export function normalizeNpmProvenance(entries, { packages, version, commit, artifactIds }) {
  if (
    !Array.isArray(entries) || entries.length !== 4
    || !Array.isArray(packages) || packages.length !== 4
    || typeof version !== 'string' || !STRICT_SEMVER.test(version)
    || typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)
    || !Array.isArray(artifactIds) || artifactIds.length !== 2
    || artifactIds.some(id => typeof id !== 'string' || !ID.test(id) || !Number.isSafeInteger(Number(id)))
    || new Set(artifactIds).size !== 2
  ) {
    throw new Error('npm provenance requires four canonical packages and disjoint artifact identities');
  }
  const ids = new Set(artifactIds);
  return PUBLIC_PACKAGES.map(({ packageName: name }, index) => {
    const entry = entries[index];
    exact(entry, ['packageName', 'subjectName', 'sha512', 'bundle'], 'npm provenance entry');
    exact(entry.bundle, ['artifactId', 'artifactName', 'artifactDigest', 'file', 'size', 'sha256'], 'npm provenance bundle');
    const bundle = entry.bundle;
    if (
      packages[index].name !== name || packages[index].version !== version
      || entry.packageName !== name
      || entry.subjectName !== `pkg:npm/${name.replace(/^@/u, '%40')}@${version}`
      || typeof entry.sha512 !== 'string' || !SHA512.test(entry.sha512)
      || entry.sha512 !== packages[index].sha512
      || typeof bundle.artifactId !== 'string' || !ID.test(bundle.artifactId)
      || !Number.isSafeInteger(Number(bundle.artifactId))
      || ids.has(bundle.artifactId)
      || bundle.artifactName !== `opencoven-sdk-npm-provenance-${index}-${commit}-${version}`
      || typeof bundle.artifactDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(bundle.artifactDigest)
      || bundle.file !== 'attestation.json'
      || !Number.isSafeInteger(bundle.size) || bundle.size <= 0 || bundle.size > MAX_NPM_PROVENANCE_BYTES
      || typeof bundle.sha256 !== 'string' || !SHA256.test(bundle.sha256)
    ) {
      throw new Error(`npm provenance entry ${index} does not bind the exact canonical package and artifact`);
    }
    ids.add(bundle.artifactId);
    return { packageName: name, subjectName: entry.subjectName, sha512: entry.sha512, bundle: { ...bundle } };
  });
}

function npmPredicate(identity, facts) {
  return {
    buildDefinition: {
      buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
      externalParameters: {
        workflow: {
          ref: identity.provenance.sourceRef,
          repository: REPOSITORY,
          path: '.github/workflows/release.yml',
        },
      },
      internalParameters: {
        github: {
          event_name: facts.eventName,
          repository_id: facts.repositoryId,
          repository_owner_id: facts.repositoryOwnerId,
        },
      },
      resolvedDependencies: [{
        uri: `git+${REPOSITORY}@${identity.provenance.sourceRef}`,
        digest: { gitCommit: identity.source.commit },
      }],
    },
    runDetails: {
      builder: { id: 'https://github.com/actions/runner/github-hosted' },
      metadata: {
        invocationId: `${REPOSITORY}/actions/runs/${identity.provenance.runId}/attempts/${identity.provenance.runAttempt}`,
      },
    },
  };
}

function base64(value, label) {
  if (
    typeof value !== 'string' || value.length === 0
    || Buffer.from(value, 'base64').toString('base64') !== value
  ) {
    throw new Error(`${label} must be canonical nonempty base64`);
  }
  return Buffer.from(value, 'base64');
}

export function parseNpmProvenanceBundle(bytes, entry, identity, facts) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_NPM_PROVENANCE_BYTES) {
    throw new Error('npm provenance bundle must be bounded bytes');
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const bundle = parseJsonText(text, 'npm provenance bundle', MAX_NPM_PROVENANCE_BYTES);
  exact(bundle, ['mediaType', 'verificationMaterial', 'dsseEnvelope'], 'Bare npm Sigstore bundle');
  if (bundle.mediaType !== 'application/vnd.dev.sigstore.bundle.v0.3+json') {
    throw new Error('npm provenance requires the pinned attester Sigstore v0.3 bundle');
  }
  const envelope = bundle.dsseEnvelope;
  exact(envelope, ['payloadType', 'payload', 'signatures'], 'npm DSSE envelope');
  if (
    envelope.payloadType !== 'application/vnd.in-toto+json'
    || !Array.isArray(envelope.signatures) || envelope.signatures.length !== 1
    || !record(envelope.signatures[0])
    || !record(bundle.verificationMaterial)
    || !record(bundle.verificationMaterial.certificate)
    || !Array.isArray(bundle.verificationMaterial.tlogEntries)
    || bundle.verificationMaterial.tlogEntries.length === 0
    || Object.hasOwn(bundle.verificationMaterial, 'x509CertificateChain')
  ) {
    throw new Error('npm provenance requires one signed in-toto DSSE envelope and certificate/transparency material');
  }
  base64(envelope.signatures[0].sig, 'npm DSSE signature');
  base64(bundle.verificationMaterial.certificate.rawBytes, 'npm certificate');
  const statement = parseJsonText(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(base64(envelope.payload, 'npm DSSE payload')),
    'npm provenance signed statement',
    MAX_NPM_PROVENANCE_BYTES,
  );
  const expected = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: entry.subjectName, digest: { sha512: entry.sha512 } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: npmPredicate(identity, facts),
  };
  if (serializeCanonicalJson(statement) !== serializeCanonicalJson(expected)) {
    throw new Error('npm provenance statement must exactly match the singleton package and authenticated run/source predicate');
  }
  return { bundle, statement };
}

// gh trusted-root obtains these targets through its authenticated TUF clients.
// Select only public-good material; --custom-trusted-root disables gh's default
// dual (GitHub/private + public-good) verifiers. Never accept a caller's root.
export function selectPublicGoodTrustRoot(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_NPM_PROVENANCE_BYTES) {
    throw new Error('Authenticated TUF roots must be bounded JSONL');
  }
  const roots = text.trim().split('\n').map(line => parseJsonText(line, 'Authenticated TUF root', MAX_NPM_PROVENANCE_BYTES));
  const selected = roots.filter(root => (
    record(root) && Array.isArray(root.certificateAuthorities)
    && root.certificateAuthorities.some(ca => ca.uri === 'https://fulcio.sigstore.dev')
  ));
  if (selected.length !== 1) {
    throw new Error('Authenticated TUF output must contain exactly one public-good root');
  }
  const root = selected[0];
  if (
    root.mediaType !== 'application/vnd.dev.sigstore.trustedroot+json;version=0.1'
    || !Array.isArray(root.tlogs) || root.tlogs.length === 0
    || !Array.isArray(root.ctlogs) || root.ctlogs.length === 0
    || root.certificateAuthorities.some(ca => (
      ca.uri !== 'https://fulcio.sigstore.dev'
      || ca.subject?.organization !== 'sigstore.dev'
      || !Array.isArray(ca.certChain?.certificates) || ca.certChain.certificates.length === 0
      || ca.certChain.certificates.some(cert => {
        const certificate = new X509Certificate(base64(cert.rawBytes, 'Public-good CA'));
        return !certificate.ca
          || certificate.issuer.split('\n').filter(part => part.startsWith('O=')).join('\n') !== 'O=sigstore.dev';
      })
    ))
  ) {
    throw new Error('Authenticated TUF root is not exclusively public-good Sigstore material');
  }
  return `${JSON.stringify(root)}\n`;
}

function regularRoot(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('npm provenance verification requires explicit artifact roots');
  }
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('npm provenance artifact root must be a regular directory');
  }
  return realpathSync(path);
}

function boundedFile(root, name, maximum) {
  if (regularRoot(root) !== root) {
    throw new Error('npm provenance artifact root changed identity');
  }
  const parts = name.split('/');
  if (parts.some(part => part.length === 0 || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('npm provenance file path must remain within its artifact root');
  }
  let path = root;
  for (const part of parts.slice(0, -1)) {
    path = resolve(path, part);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('npm provenance artifact path must not contain symlinks');
    }
  }
  path = resolve(path, parts.at(-1));
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error('npm provenance file escaped its artifact root');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximum) {
      throw new Error('npm provenance input must be a bounded regular file');
    }
    const buffer = Buffer.alloc(stats.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== stats.size) {
      throw new Error('npm provenance input changed while reading');
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function jsonOutput(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_NPM_PROVENANCE_BYTES) {
    throw new Error(`${label} must be bounded JSON`);
  }
  return parseJsonText(value, label, MAX_NPM_PROVENANCE_BYTES);
}

function authenticatedFacts(authorization, api) {
  const repository = api('repos/OpenCoven/sdk');
  const expectedRepository = authorization.environmentPolicy.repository;
  if (
    !record(repository) || repository.full_name !== 'OpenCoven/sdk' || repository.private !== false
      || !Number.isSafeInteger(repository.id) || String(repository.id) !== expectedRepository.id
      || !record(repository.owner) || !Number.isSafeInteger(repository.owner.id)
      || String(repository.owner.id) !== expectedRepository.owner.id
      || repository.owner.login !== 'OpenCoven' || repository.owner.type !== 'Organization'
  ) {
    throw new Error('npm provenance requires the authenticated public source and owner identities');
  }
  const run = api(`repos/OpenCoven/sdk/actions/runs/${authorization.provenance.runId}`);
  if (
    !record(run) || String(run.id) !== authorization.provenance.runId
      || run.run_attempt !== authorization.provenance.runAttempt
      || run.name !== 'release' || run.event !== 'workflow_dispatch'
      || run.status !== 'completed' || run.conclusion !== 'success'
      || run.path !== '.github/workflows/release.yml'
      || run.head_sha !== authorization.source.commit
      || `refs/heads/${run.head_branch}` !== authorization.provenance.sourceRef
      || [run.repository, run.head_repository].some(repo => (
        !record(repo) || repo.id !== repository.id || repo.full_name !== repository.full_name
        || repo.owner?.id !== repository.owner.id
      ))
  ) {
    throw new Error('npm provenance requires the authenticated exact successful run/source/ref/attempt');
  }
  const jobs = api(`repos/OpenCoven/sdk/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!record(jobs) || !Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length) {
    throw new Error('npm provenance requires the complete authenticated producer and attester job graph');
  }
  for (const expected of [authorization.provenance, authorization.attestation]) {
    const matches = jobs.jobs.filter(job => record(job) && String(job.id) === expected.jobId);
    if (matches.length !== 1) {
      throw new Error('npm provenance producer or attester job identity changed');
    }
    const job = matches[0];
    if (
      job.name !== expected.job || job.run_id !== run.id || job.run_attempt !== run.run_attempt
        || job.head_sha !== run.head_sha || job.status !== 'completed' || job.conclusion !== 'success'
        || !Array.isArray(job.labels) || job.labels.length === 0 || job.labels.includes('self-hosted')
    ) {
      throw new Error('npm provenance producer or attester is not the authorized successful hosted job');
    }
  }
  return {
    eventName: run.event,
    repositoryId: String(repository.id),
    repositoryOwnerId: String(repository.owner.id),
  };
}

function verifySignatureOutput(output, parsed, authorization, facts) {
  const results = jsonOutput(output, 'npm cryptographic verification');
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error('npm provenance requires exactly one cryptographically verified bundle');
  }
  const result = results[0];
  const verification = result?.verificationResult;
  const certificate = verification?.signature?.certificate;
  const invocation = `${REPOSITORY}/actions/runs/${authorization.provenance.runId}/attempts/${authorization.provenance.runAttempt}`;
  if (
    !record(certificate)
      || certificate.runInvocationURI !== invocation
      || certificate.runnerEnvironment !== 'github-hosted'
      || certificate.buildTrigger !== facts.eventName
      || certificate.sourceRepositoryVisibilityAtSigning !== 'public'
      || certificate.sourceRepositoryURI !== REPOSITORY
      || certificate.sourceRepositoryDigest !== authorization.source.commit
      || certificate.sourceRepositoryRef !== authorization.provenance.sourceRef
      || certificate.sourceRepositoryIdentifier !== facts.repositoryId
      || certificate.sourceRepositoryOwnerIdentifier !== facts.repositoryOwnerId
      || certificate.sourceRepositoryOwnerURI !== 'https://github.com/OpenCoven'
      || certificate.buildSignerDigest !== authorization.source.commit
      || certificate.buildSignerURI !== `${REPOSITORY}/.github/workflows/release.yml@${authorization.provenance.sourceRef}`
      || serializeCanonicalJson(result.attestation?.bundle) !== serializeCanonicalJson(parsed.bundle)
      || serializeCanonicalJson(verification.statement) !== serializeCanonicalJson(parsed.statement)
  ) {
    throw new Error('npm provenance cryptographic result does not bind the raw bundle and authenticated certificate/run/source identities');
  }
}

/** Additional verification only: the manual entry point must first require the full SHIP review. */
export function verifyNpmProvenanceBundles({
  authorization, artifactRoot, npmProvenanceRoot, execute = execFileSync, env = process.env,
}) {
  const entries = normalizeNpmProvenance(authorization.npmProvenance, {
    packages: authorization.packages,
    version: authorization.version,
    commit: authorization.source.commit,
    artifactIds: [authorization.artifact.id, authorization.attestation.bundle.artifactId],
  });
  const candidateRoot = regularRoot(artifactRoot);
  const provenanceRoot = regularRoot(npmProvenanceRoot);
  if (readdirSync(provenanceRoot).sort().join(',') !== '0,1,2,3') {
    throw new Error('npm provenance root must contain exactly directories 0, 1, 2, 3');
  }
  const call = (args, binary = false) => execute('/usr/bin/gh', args, {
    encoding: binary ? 'buffer' : 'utf8',
    env: createGitHubCliEnvironment(env),
    maxBuffer: 2 * MAX_NPM_PROVENANCE_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  const api = endpoint => jsonOutput(
    call(['api', '--hostname', 'github.com', '--method', 'GET', endpoint]), endpoint,
  );
  const facts = authenticatedFacts(authorization, api);
  const owned = createOwnedTempDirectory({ prefix: 'opencoven-npm-provenance' });
  const snapshots = [];
  try {
    const trust = selectPublicGoodTrustRoot(call(['attestation', 'trusted-root', '--hostname', 'github.com']));
    const trustPath = resolve(owned.path, 'public-good-trusted-root.jsonl');
    writeFileSync(trustPath, trust, { flag: 'wx', mode: 0o600 });
    for (const [index, entry] of entries.entries()) {
      const bundleRoot = regularRoot(resolve(provenanceRoot, String(index)));
      if (readdirSync(bundleRoot).join(',') !== 'attestation.json') {
        throw new Error('Each npm provenance artifact must contain exactly attestation.json');
      }
      const raw = boundedFile(bundleRoot, 'attestation.json', MAX_NPM_PROVENANCE_BYTES);
      if (raw.length !== entry.bundle.size || createHash('sha256').update(raw).digest('hex') !== entry.bundle.sha256) {
        throw new Error('npm provenance raw bundle bytes differ from the SHIP authorization');
      }
      const packageEntry = authorization.packages[index];
      const tarball = boundedFile(candidateRoot, packageEntry.file, 64 * 1024 * 1024);
      if (
        tarball.length !== packageEntry.size
          || createHash('sha256').update(tarball).digest('hex') !== packageEntry.sha256
          || createHash('sha512').update(tarball).digest('hex') !== entry.sha512
      ) {
        throw new Error('npm provenance tarball must match the reviewed exact SHA256 and SHA512 bytes');
      }
      const parsed = parseNpmProvenanceBundle(raw, entry, authorization, facts);
      const artifact = api(`repos/OpenCoven/sdk/actions/artifacts/${entry.bundle.artifactId}`);
      if (
        !record(artifact) || String(artifact.id) !== entry.bundle.artifactId
          || artifact.name !== entry.bundle.artifactName || artifact.digest !== entry.bundle.artifactDigest
          || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes)
          || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > 2 * MAX_NPM_PROVENANCE_BYTES
          || String(artifact.workflow_run?.id) !== authorization.provenance.runId
          || artifact.workflow_run?.head_sha !== authorization.source.commit
      ) {
        throw new Error('npm provenance immutable GitHub artifact identity differs from authorization');
      }
      const archive = call([
        'api', '--hostname', 'github.com', '--method', 'GET',
        `repos/OpenCoven/sdk/actions/artifacts/${entry.bundle.artifactId}/zip`,
      ], true);
      if (!Buffer.isBuffer(archive) || archive.length !== artifact.size_in_bytes) {
        throw new Error('npm provenance artifact archive size differs from immutable GitHub metadata');
      }
      verifyNpmProvenanceArchive(archive, raw, entry.bundle);
      const bundlePath = resolve(owned.path, `${index}-attestation.json`);
      const tarballPath = resolve(owned.path, `${index}.tgz`);
      writeFileSync(bundlePath, raw, { flag: 'wx', mode: 0o600 });
      writeFileSync(tarballPath, tarball, { flag: 'wx', mode: 0o600 });
      const output = call([
        'attestation', 'verify', tarballPath,
        '--digest-alg', 'sha512',
        '--repo', 'OpenCoven/sdk',
        '--cert-identity', `${REPOSITORY}/.github/workflows/release.yml@${authorization.provenance.sourceRef}`,
        '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
        '--signer-digest', authorization.source.commit,
        '--source-digest', authorization.source.commit,
        '--source-ref', authorization.provenance.sourceRef,
        '--predicate-type', 'https://slsa.dev/provenance/v1',
        '--deny-self-hosted-runners',
        '--bundle', bundlePath,
        '--custom-trusted-root', trustPath,
        '--format', 'json', '--hostname', 'github.com',
      ]);
      verifySignatureOutput(output, parsed, authorization, facts);
      if (
        !boundedFile(owned.path, `${index}-attestation.json`, MAX_NPM_PROVENANCE_BYTES).equals(raw)
          || !boundedFile(owned.path, `${index}.tgz`, 64 * 1024 * 1024).equals(tarball)
          || !boundedFile(owned.path, 'public-good-trusted-root.jsonl', MAX_NPM_PROVENANCE_BYTES).equals(Buffer.from(trust))
      ) {
        throw new Error('Frozen npm verification inputs changed during cryptographic verification');
      }
      snapshots.push({ bundleRoot, raw, tarball, file: packageEntry.file });
    }
    for (const snapshot of snapshots) {
      if (
        !boundedFile(snapshot.bundleRoot, 'attestation.json', MAX_NPM_PROVENANCE_BYTES).equals(snapshot.raw)
          || !boundedFile(candidateRoot, snapshot.file, 64 * 1024 * 1024).equals(snapshot.tarball)
          || readdirSync(snapshot.bundleRoot).join(',') !== 'attestation.json'
      ) {
        throw new Error('npm provenance inputs changed during verification');
      }
    }
    if (readdirSync(provenanceRoot).sort().join(',') !== '0,1,2,3') {
      throw new Error('npm provenance artifact roots changed during verification');
    }
    return entries;
  } finally {
    cleanupOwnedTempRoot(owned);
  }
}
export function verifyNpmProvenanceArchive(archive, bundleBytes, expected) {
  if (
    !Buffer.isBuffer(archive) || archive.length > 2 * MAX_NPM_PROVENANCE_BYTES
    || `sha256:${createHash('sha256').update(archive).digest('hex')}` !== expected.artifactDigest
  ) {
    throw new Error('npm provenance artifact archive digest does not match immutable GitHub metadata');
  }
  // A bounded singleton ZIP needs no extraction and cannot write outside a root.
  // Reject ZIP64, comments, encryption, extra entries, symlinks and prefix data.
  const end = archive.length - 22;
  if (
    end < 0 || archive.readUInt32LE(end) !== 0x06054b50
    || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0
    || archive.readUInt16LE(end + 8) !== 1 || archive.readUInt16LE(end + 10) !== 1
    || archive.readUInt16LE(end + 20) !== 0
  ) {
    throw new Error('npm provenance artifact must be a singleton standard ZIP');
  }
  const central = archive.readUInt32LE(end + 16);
  const centralSize = archive.readUInt32LE(end + 12);
  if (central < 30 || central + centralSize !== end || centralSize < 46
    || archive.readUInt32LE(central) !== 0x02014b50) {
    throw new Error('npm provenance artifact ZIP directory is invalid');
  }
  const flags = archive.readUInt16LE(central + 8);
  const method = archive.readUInt16LE(central + 10);
  const checksum = archive.readUInt32LE(central + 16);
  const compressedSize = archive.readUInt32LE(central + 20);
  const size = archive.readUInt32LE(central + 24);
  const nameSize = archive.readUInt16LE(central + 28);
  const extraSize = archive.readUInt16LE(central + 30);
  const commentSize = archive.readUInt16LE(central + 32);
  const mode = archive.readUInt32LE(central + 38) >>> 16;
  const name = archive.subarray(central + 46, central + 46 + nameSize);
  if (
    centralSize !== 46 + nameSize + extraSize + commentSize
    || name.toString('utf8') !== 'attestation.json'
    || (flags & ~0x0808) !== 0 || ![0, 8].includes(method)
    || (mode !== 0 && (mode & 0xf000) !== 0x8000)
    || archive.readUInt16LE(central + 34) !== 0
    || archive.readUInt32LE(central + 42) !== 0
    || size !== expected.size || size > MAX_NPM_PROVENANCE_BYTES
    || archive.readUInt32LE(0) !== 0x04034b50
    || archive.readUInt16LE(6) !== flags || archive.readUInt16LE(8) !== method
    || archive.readUInt16LE(26) !== nameSize
    || !archive.subarray(30, 30 + nameSize).equals(name)
  ) {
    throw new Error('npm provenance artifact ZIP entry is not the exact regular bundle');
  }
  const start = 30 + nameSize + archive.readUInt16LE(28);
  const dataEnd = start + compressedSize;
  const descriptor = (flags & 8) !== 0;
  if (dataEnd > central || (descriptor ? ![12, 16].includes(central - dataEnd) : dataEnd !== central)) {
    throw new Error('npm provenance artifact ZIP data bounds are invalid');
  }
  let checkOffset = 14;
  if (descriptor) {
    checkOffset = dataEnd;
    if (central - dataEnd === 16) {
      if (archive.readUInt32LE(checkOffset) !== 0x08074b50) {
        throw new Error('npm provenance artifact ZIP descriptor is invalid');
      }
      checkOffset += 4;
    }
  }
  if (archive.readUInt32LE(checkOffset) !== checksum
    || archive.readUInt32LE(checkOffset + 4) !== compressedSize
    || archive.readUInt32LE(checkOffset + 8) !== size) {
    throw new Error('npm provenance artifact ZIP local metadata does not match');
  }
  const compressed = archive.subarray(start, dataEnd);
  const decoded = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_NPM_PROVENANCE_BYTES });
  if (
    decoded.length !== size || crc32(decoded) !== checksum
    || !decoded.equals(bundleBytes)
    || createHash('sha256').update(decoded).digest('hex') !== expected.sha256
  ) {
    throw new Error('npm provenance artifact does not contain the reviewed raw bundle bytes');
  }
}
