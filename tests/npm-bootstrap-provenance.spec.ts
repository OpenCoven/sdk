import type { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  normalizeNpmProvenance,
  parseNpmProvenanceBundle,
  selectPublicGoodTrustRoot,
  verifyNpmProvenanceArchive,
  verifyNpmProvenanceBundles,
} from '../scripts/npm-bootstrap-provenance.mjs';
import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';
import * as authorizationModule from '../scripts/github-release-authorization.mjs';
import * as readinessModule from '../scripts/release-readiness.mjs';
import { main as bootstrapMain, verifyBootstrapProvenance } from '../scripts/verify-bootstrap-provenance.mjs';
import publicGoodTrustRoot from './fixtures/sigstore-public-good-trusted-root.json' with { type: 'json' };

const commit = 'a'.repeat(40);
const version = '0.0.1';
const bytes = Buffer.from('unit fixture only, not a publication tarball');
const digest = (algorithm: string, value: string | Buffer) =>
  createHash(algorithm).update(value).digest('hex');
const packages = PUBLIC_PACKAGES.map(({ packageName, workspaceDirectory }) => ({
  name: packageName,
  version,
  file: `tarballs/${workspaceDirectory}/${packageName.slice(1).replace('/', '-')}-${version}.tgz`,
  size: bytes.length,
  sha256: digest('sha256', bytes),
  sha512: digest('sha512', bytes),
}));
const context = { packages, version, commit, artifactIds: ['1', '2'] };
const entries = () => packages.map((entry, index) => ({
  packageName: entry.name,
  subjectName: `pkg:npm/${entry.name.replace(/^@/u, '%40')}@${version}`,
  sha512: entry.sha512,
  bundle: {
    artifactId: String(index + 3),
    artifactName: `opencoven-sdk-npm-provenance-${index}-${commit}-${version}`,
    artifactDigest: `sha256:${String(index + 3).repeat(64)}`,
    file: 'attestation.json' as const,
    size: 100,
    sha256: 'b'.repeat(64),
  },
}));
const facts = {
  eventName: 'workflow_dispatch',
  repositoryId: '1337664127',
  repositoryOwnerId: '270919577',
};
const identity = {
  source: { commit },
  provenance: {
    sourceRef: 'refs/heads/main',
    runId: '10000',
    runAttempt: 1,
  },
};
function statement() {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: entries()[0]!.subjectName, digest: { sha512: packages[0]!.sha512 } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: {
            ref: identity.provenance.sourceRef,
            repository: 'https://github.com/OpenCoven/sdk',
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
          uri: `git+https://github.com/OpenCoven/sdk@${identity.provenance.sourceRef}`,
          digest: { gitCommit: commit },
        }],
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: { invocationId: 'https://github.com/OpenCoven/sdk/actions/runs/10000/attempts/1' },
      },
    },
  };
}
function bundle(payload = statement()) {
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { certificate: { rawBytes: 'dW5pdC1maXh0dXJl' }, tlogEntries: [{}] },
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(payload)).toString('base64'),
      signatures: [{ sig: 'dW5pdC1maXh0dXJl' }],
    },
  };
}
const parse = (value: unknown) => parseNpmProvenanceBundle(
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  entries()[0]!,
  identity,
  facts,
);

// Public trust data, not signed SDK evidence or a production trust source:
// sigstore/root-signing@7f8e64b070e6d81503fa132666cd4a0162766015 targets/trusted_root.json.
function publicRoot() {
  return structuredClone(publicGoodTrustRoot);
}

function zip(payload: Buffer, name = 'attestation.json') {
  const filename = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(crc32(payload), 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(crc32(payload), 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0x81a40000, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + payload.length, 16);
  return Buffer.concat([local, filename, payload, central, filename, end]);
}

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('manual bootstrap verifier required gates', () => {
  test('exposes only the verification entry point through the workspace command', () => {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest).toMatchObject({
      private: true,
      scripts: {
        'verify:bootstrap-provenance': 'node ./scripts/verify-bootstrap-provenance.mjs',
      },
    });
  });
  test.each(['0.0.1-rc.1', '0.0.1+reviewed'])('preserves existing release version syntax %s', releaseVersion => {
    const values = entries().map((entry, index) => ({
      ...entry,
      subjectName: `pkg:npm/${entry.packageName.replace(/^@/u, '%40')}@${releaseVersion}`,
      bundle: {
        ...entry.bundle,
        artifactName: `opencoven-sdk-npm-provenance-${index}-${commit}-${releaseVersion}`,
      },
    }));
    expect(normalizeNpmProvenance(values, {
      ...context,
      version: releaseVersion,
      packages: packages.map(entry => ({ ...entry, version: releaseVersion })),
    })).toEqual(values);
  });
  test.each([
    [],
    ['--comment-id', '4001'],
    ['--comment-id', '4001', '--artifact-root', '/tmp/candidate', '--attestation-root', '/tmp/six'],
    ['--comment-id', '4001', '--comment-id', '4002'],
    ['--npm-provenance-root'],
    ['--dry-run'],
    ['--provenance-file', '/tmp/bundle'],
  ].map(args => ({ args })))('rejects incomplete or unsupported CLI input $args', ({ args }) => {
    expect(() => bootstrapMain(args)).toThrow();
  });
  test('calls the existing complete SHIP verifier with every external root and never bypasses its failure', () => {
    vi.spyOn(readinessModule, 'assertFrozenNodeRuntime').mockReturnValue('v24.18.1');
    const gate = vi.spyOn(authorizationModule, 'verifyPublicationSecurityReview')
      .mockImplementation(() => { throw new Error('unit fixture: full SHIP gate rejected'); });
    expect(() => verifyBootstrapProvenance({
      root: '/reviewed-checkout',
      commentId: '4001',
      artifactRoot: '/external/candidate',
      attestationRoot: '/external/six',
      npmProvenanceRoot: '/external/npm',
    })).toThrow('unit fixture: full SHIP gate rejected');
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({
      root: '/reviewed-checkout',
      commentId: '4001',
      artifactRoot: '/external/candidate',
      attestationRoot: '/external/six',
      allowedArtifactRoots: ['/external/npm'],
    }));
  });
});
function verificationFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'npm-provenance-policy-'));
  roots.push(root);
  const artifactRoot = resolve(root, 'candidate');
  const npmProvenanceRoot = resolve(root, 'npm');
  mkdirSync(artifactRoot);
  mkdirSync(npmProvenanceRoot);
  const provenance = entries();
  const archives = new Map<string, Buffer>();
  for (const [index, entry] of provenance.entries()) {
    mkdirSync(resolve(artifactRoot, packages[index]!.file, '..'), { recursive: true });
    writeFileSync(resolve(artifactRoot, packages[index]!.file), bytes);
    const payload = statement();
    payload.subject[0]!.name = entry.subjectName;
    const text = `${JSON.stringify(bundle(payload))}\n`;
    mkdirSync(resolve(npmProvenanceRoot, String(index)));
    writeFileSync(resolve(npmProvenanceRoot, String(index), 'attestation.json'), text);
    const archive = zip(Buffer.from(text));
    entry.bundle.size = Buffer.byteLength(text);
    entry.bundle.sha256 = digest('sha256', text);
    entry.bundle.artifactDigest = `sha256:${digest('sha256', archive)}`;
    archives.set(entry.bundle.artifactId, archive);
  }
  const authorization = {
    ...identity,
    version,
    packages,
    npmProvenance: provenance,
    artifact: { id: '1' },
    attestation: { job: 'publication-candidate-attestation', jobId: '20001', bundle: { artifactId: '2' } },
    provenance: { ...identity.provenance, job: 'publication-candidate', jobId: '20000' },
    environmentPolicy: { repository: { id: facts.repositoryId, owner: { id: facts.repositoryOwnerId } } },
  };
  const repository = {
    id: Number(facts.repositoryId),
    full_name: 'OpenCoven/sdk',
    private: false,
    owner: { id: Number(facts.repositoryOwnerId), login: 'OpenCoven', type: 'Organization' },
  };
  const run = {
    id: 10000, name: 'release', event: 'workflow_dispatch', run_attempt: 1,
    head_sha: commit, head_branch: 'main', path: '.github/workflows/release.yml',
    status: 'completed', conclusion: 'success', repository, head_repository: repository,
  };
  const calls: string[][] = [];
  const execute = (_command: string, args: readonly string[]): string | Buffer => {
    calls.push([...args]);
    if (args[0] === 'attestation' && args[1] === 'trusted-root') {
      return `${JSON.stringify(publicRoot())}\n`;
    }
    if (args[0] === 'attestation' && args[1] === 'verify') {
      expect(args).toContain('--digest-alg');
      expect(args[args.indexOf('--digest-alg') + 1]).toBe('sha512');
      expect(args).toContain('--custom-trusted-root');
      expect(args).not.toContain('--no-public-good');
      expect(JSON.parse(readFileSync(args[args.indexOf('--custom-trusted-root') + 1]!, 'utf8')))
        .toEqual(publicRoot());
      const raw = JSON.parse(readFileSync(args[args.indexOf('--bundle') + 1]!, 'utf8')) as ReturnType<typeof bundle>;
      return JSON.stringify([{
        attestation: { bundle: raw },
        verificationResult: {
          statement: JSON.parse(Buffer.from(raw.dsseEnvelope.payload, 'base64').toString()) as ReturnType<typeof statement>,
          signature: { certificate: {
            runInvocationURI: 'https://github.com/OpenCoven/sdk/actions/runs/10000/attempts/1',
            runnerEnvironment: 'github-hosted',
            buildTrigger: 'workflow_dispatch',
            sourceRepositoryVisibilityAtSigning: 'public',
            sourceRepositoryURI: 'https://github.com/OpenCoven/sdk',
            sourceRepositoryDigest: commit,
            sourceRepositoryRef: 'refs/heads/main',
            sourceRepositoryIdentifier: facts.repositoryId,
            sourceRepositoryOwnerIdentifier: facts.repositoryOwnerId,
            sourceRepositoryOwnerURI: 'https://github.com/OpenCoven',
            buildSignerURI: 'https://github.com/OpenCoven/sdk/.github/workflows/release.yml@refs/heads/main',
            buildSignerDigest: commit,
          } },
        },
      }]);
    }
    const endpoint = args.at(-1);
    if (endpoint === 'repos/OpenCoven/sdk') return JSON.stringify(repository);
    if (endpoint === 'repos/OpenCoven/sdk/actions/runs/10000') return JSON.stringify(run);
    if (endpoint === 'repos/OpenCoven/sdk/actions/runs/10000/attempts/1/jobs?per_page=100') {
      return JSON.stringify({
        total_count: 2,
        jobs: [authorization.provenance, authorization.attestation].map(job => ({
          id: Number(job.jobId), name: job.job, run_id: 10000, run_attempt: 1,
          head_sha: commit, status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'],
        })),
      });
    }
    for (const entry of provenance) {
      if (endpoint === `repos/OpenCoven/sdk/actions/artifacts/${entry.bundle.artifactId}`) {
        return JSON.stringify({
          id: Number(entry.bundle.artifactId), name: entry.bundle.artifactName,
          digest: entry.bundle.artifactDigest, expired: false,
          size_in_bytes: archives.get(entry.bundle.artifactId)!.length,
          workflow_run: { id: 10000, head_sha: commit },
        });
      }
      if (endpoint === `repos/OpenCoven/sdk/actions/artifacts/${entry.bundle.artifactId}/zip`) {
        return archives.get(entry.bundle.artifactId)!;
      }
    }
    throw new Error(`Unexpected unit-fixture request ${args.join(' ')}`);
  };
  return { artifactRoot, npmProvenanceRoot, authorization, execute, calls, run, repository, archives };
}

function bootstrapFixture() {
  const fixture = verificationFixture();
  vi.spyOn(readinessModule, 'assertFrozenNodeRuntime').mockReturnValue('v24.18.1');
  const runtime = vi.spyOn(readinessModule, 'validateValidatorRuntimeFiles').mockReturnValue();
  // The SHIP gate is stubbed; only its consumed fields belong to this unit fixture.
  const review = { authorization: fixture.authorization } as ReturnType<
    typeof authorizationModule.verifyPublicationSecurityReview
  >;
  const gate = vi.spyOn(authorizationModule, 'verifyPublicationSecurityReview').mockReturnValue(review);
  const verify = () => verifyBootstrapProvenance({
    ...fixture,
    root: fixture.artifactRoot,
    attestationRoot: fixture.artifactRoot,
    commentId: '4001',
    execute: fixture.execute as typeof execFileSync,
    env: { GH_TOKEN: 'unit-fixture' },
  });
  return { ...fixture, review, gate, runtime, verify };
}

describe('bootstrap final SHIP revalidation (stubbed authorization and crypto)', () => {
  test('preserves the result and requires both SHIP/runtime passes', () => {
    const fixture = bootstrapFixture();
    expect(fixture.verify()).toMatchObject({
      kind: 'opencoven-sdk-bootstrap-provenance-verification',
      npmProvenance: fixture.authorization.npmProvenance,
      bootstrapApproval: 'separate-human-gate-required',
    });
    expect(fixture.gate).toHaveBeenCalledTimes(2);
    expect(fixture.runtime).toHaveBeenCalledTimes(2);
    expect(fixture.calls.filter(args => args[0] === 'attestation' && args[1] === 'verify')).toHaveLength(4);
  });
  test.each(['SHIP', 'runtime'])('rejects bundle mutation during the final %s pass', phase => {
    const fixture = bootstrapFixture();
    const mutate = () => {
      writeFileSync(resolve(fixture.npmProvenanceRoot, '0/attestation.json'), '{}');
    };
    if (phase === 'SHIP') {
      fixture.gate.mockReturnValueOnce(fixture.review).mockImplementationOnce(() => {
        mutate();
        return fixture.review;
      });
    } else {
      fixture.runtime.mockReturnValueOnce().mockImplementationOnce(mutate);
    }
    expect(fixture.verify).toThrow(/npm provenance inputs changed/u);
  });
  test.each([
    'tarball', 'extra bundle', 'extra directory', 'bundle symlink',
    'package directory symlink', 'candidate root symlink', 'provenance root symlink',
  ])('rejects %s replacement during the final SHIP pass', kind => {
    const fixture = bootstrapFixture();
    fixture.gate.mockReturnValueOnce(fixture.review).mockImplementationOnce(() => {
      if (kind === 'tarball') writeFileSync(resolve(fixture.artifactRoot, packages[0]!.file), 'swapped');
      if (kind === 'extra bundle') writeFileSync(resolve(fixture.npmProvenanceRoot, '0/extra.json'), '{}');
      if (kind === 'extra directory') mkdirSync(resolve(fixture.npmProvenanceRoot, '4'));
      const path = new Map([
        ['bundle symlink', resolve(fixture.npmProvenanceRoot, '0/attestation.json')],
        ['package directory symlink', resolve(fixture.artifactRoot, packages[0]!.file, '..')],
        ['candidate root symlink', fixture.artifactRoot],
        ['provenance root symlink', fixture.npmProvenanceRoot],
      ]).get(kind);
      if (path !== undefined) {
        const moved = `${path}-moved`;
        renameSync(path, moved);
        symlinkSync(moved, path);
      }
      return fixture.review;
    });
    expect(fixture.verify).toThrow();
    expect(fixture.gate).toHaveBeenCalledTimes(2);
  });
  test('does not hide final SHIP failures or changed authorization', () => {
    const fixture = bootstrapFixture();
    fixture.gate.mockReturnValueOnce(fixture.review).mockImplementationOnce(() => {
      throw new Error('unit fixture: final SHIP rejection');
    });
    expect(fixture.verify).toThrow('unit fixture: final SHIP rejection');
    fixture.gate.mockReturnValueOnce(fixture.review).mockReturnValueOnce({
      ...fixture.review,
      authorization: { ...fixture.review.authorization, version: '0.0.2' },
    });
    expect(fixture.verify).toThrow('Publication authorization changed');
  });
});

describe('npm bootstrap provenance unit policy (not cryptographic acceptance)', () => {
  test('binds four canonical singleton PURL/SHA512 bundle identities', () => {
    expect(normalizeNpmProvenance(entries(), context)).toEqual(entries());
  });
  test.each([
    ['missing', (v: ReturnType<typeof entries>) => v.pop()],
    ['extra', (v: ReturnType<typeof entries>) => v.push(v[0]!)],
    ['sparse', (v: ReturnType<typeof entries>) => { Reflect.deleteProperty(v, '0'); }],
    ['order', (v: ReturnType<typeof entries>) => v.reverse()],
    ['name', (v: ReturnType<typeof entries>) => { v[0]!.packageName = '@opencoven/sdk'; }],
    ['version', (v: ReturnType<typeof entries>) => { v[0]!.subjectName += '0'; }],
    ['sha512', (v: ReturnType<typeof entries>) => { v[0]!.sha512 = 'a'.repeat(128); }],
    ['uppercase digest', (v: ReturnType<typeof entries>) => { v[0]!.sha512 = 'A'.repeat(128); }],
    ['duplicate ID', (v: ReturnType<typeof entries>) => { v[0]!.bundle.artifactId = v[1]!.bundle.artifactId; }],
    ['unsafe numeric ID', (v: ReturnType<typeof entries>) => { v[0]!.bundle.artifactId = '9007199254740993'; }],
    ['candidate ID', (v: ReturnType<typeof entries>) => { v[0]!.bundle.artifactId = '1'; }],
    ['six-subject ID', (v: ReturnType<typeof entries>) => { v[0]!.bundle.artifactId = '2'; }],
    ['swapped artifact name', (v: ReturnType<typeof entries>) => { v[0]!.bundle.artifactName = v[1]!.bundle.artifactName; }],
    ['archive digest', (v: ReturnType<typeof entries>) => { v[0]!.bundle.artifactDigest = 'a'.repeat(64); }],
    ['oversize', (v: ReturnType<typeof entries>) => { v[0]!.bundle.size = 17 * 1024 * 1024; }],
    ['path escape', (v: ReturnType<typeof entries>) => { Object.assign(v[0]!.bundle, { file: '../attestation.json' }); }],
  ])('rejects %s metadata', (_label, mutate) => {
    const value = entries();
    mutate(value);
    expect(() => normalizeNpmProvenance(value, context)).toThrow();
  });
  test('parses the exact npm profile without claiming signature verification', () => {
    expect(parse(bundle()).statement).toEqual(statement());
  });
  test.each(['repository_id', 'repository_owner_id'])('requires documented string context %s', field => {
    // GitHub's github context documents strings; npm 11.5.1 also uses string env IDs.
    const value = statement();
    const github = value.predicate.buildDefinition.internalParameters.github;
    const id = field === 'repository_id' ? facts.repositoryId : facts.repositoryOwnerId;
    Object.assign(github, { [field]: Number(id) });
    expect(() => parse(bundle(value))).toThrow(/exactly match/u);
  });
  test.each([
    ['count', (v: ReturnType<typeof statement>) => v.subject.push(v.subject[0]!)],
    ['PURL', (v: ReturnType<typeof statement>) => { v.subject[0]!.name = 'sdk.tgz'; }],
    ['SHA512', (v: ReturnType<typeof statement>) => { v.subject[0]!.digest.sha512 = '0'.repeat(128); }],
    ['statement', (v: ReturnType<typeof statement>) => { v._type += '/wrong'; }],
    ['predicateType', (v: ReturnType<typeof statement>) => { v.predicateType += '/wrong'; }],
    ['buildType', (v: ReturnType<typeof statement>) => { v.predicate.buildDefinition.buildType = 'https://actions.github.io/buildtypes/workflow/v1'; }],
    ['ref', (v: ReturnType<typeof statement>) => { v.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/release/sdk-v0.0.1'; }],
    ['source', (v: ReturnType<typeof statement>) => { v.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = 'b'.repeat(40); }],
    ['event', (v: ReturnType<typeof statement>) => { v.predicate.buildDefinition.internalParameters.github.event_name = 'push'; }],
    ['repository ID', (v: ReturnType<typeof statement>) => { v.predicate.buildDefinition.internalParameters.github.repository_id = '123'; }],
    ['owner ID', (v: ReturnType<typeof statement>) => { v.predicate.buildDefinition.internalParameters.github.repository_owner_id = '123'; }],
    ['attempt', (v: ReturnType<typeof statement>) => { v.predicate.runDetails.metadata.invocationId += '0'; }],
    ['hosted', (v: ReturnType<typeof statement>) => { v.predicate.runDetails.builder.id = 'https://github.com/actions/runner/self-hosted'; }],
  ])('rejects signed-predicate %s tampering even in a structurally valid bundle', (_label, mutate) => {
    const value = statement();
    mutate(value);
    expect(() => parse(bundle(value))).toThrow();
  });
  test.each([
    '[]',
    `\uFEFF${JSON.stringify(bundle())}`,
    '{"bundle":{}}',
    `${JSON.stringify(bundle())}\n${JSON.stringify(bundle())}`,
    JSON.stringify({ ...bundle(), dsseEnvelope: { ...bundle().dsseEnvelope, payloadType: 'text/plain' } }),
    JSON.stringify({ ...bundle(), dsseEnvelope: { ...bundle().dsseEnvelope, signatures: [] } }),
    JSON.stringify(bundle()).replace('"mediaType":', '"mediaType":"ignored-duplicate","mediaType":'),
    JSON.stringify({
      ...bundle(),
      dsseEnvelope: {
        ...bundle().dsseEnvelope,
        payload: Buffer.from(`\uFEFF${JSON.stringify(statement())}`).toString('base64'),
      },
    }),
  ])('rejects non-bare or malformed bundles %s', value => {
    expect(() => parse(value)).toThrow();
  });
  test('selects only the public-good root from authenticated gh TUF output', () => {
    const github = { ...publicRoot(), certificateAuthorities: [{ uri: 'fulcio.githubapp.com' }] };
    expect(selectPublicGoodTrustRoot(`${JSON.stringify(publicRoot())}\n${JSON.stringify(github)}\n`))
      .toBe(`${JSON.stringify(publicRoot())}\n`);
  });
  test('rejects missing, duplicate, or mixed public-good roots', () => {
    const text = JSON.stringify(publicRoot());
    expect(() => selectPublicGoodTrustRoot('{}\n')).toThrow();
    expect(() => selectPublicGoodTrustRoot(`${text}\n${text}\n`)).toThrow();
    const mixed = publicRoot();
    mixed.certificateAuthorities.push({ ...mixed.certificateAuthorities[0]!, uri: 'fulcio.githubapp.com' });
    expect(() => selectPublicGoodTrustRoot(JSON.stringify(mixed))).toThrow();
  });
  test.each([
    ['tlogs', 'https://rekor.githubapp.com'],
    ['tlogs', 'https://rekor.sigstore.dev.attacker.test'],
    ['tlogs', 'https://attacker.test/rekor.sigstore.dev'],
    ['tlogs', 'https://rekor.sigstore.dev@attacker.test'],
    ['tlogs', 'https://user@rekor.sigstore.dev'],
    ['tlogs', 'https://rekor.sigstore.dev:444'],
    ['tlogs', 'http://rekor.sigstore.dev'],
    ['tlogs', 'https://rekor.sigstore.dev/private'],
    ['tlogs', 'https://rekor.sigstore.dev?private=1'],
    ['tlogs', 'https://rekor.sigstore.dev#private'],
    ['tlogs', 'https://rekor.sigstage.dev'],
    ['tlogs', 'https://private.rekor.sigstore.dev'],
    ['tlogs', 'https://ctfe.sigstore.dev/2022'],
    ['ctlogs', 'https://ctfe.githubapp.com'],
    ['ctlogs', 'https://ctfe.sigstore.dev.attacker.test/2022'],
    ['ctlogs', 'https://user@ctfe.sigstore.dev/2022'],
    ['ctlogs', 'https://ctfe.sigstore.dev/private'],
    ['ctlogs', 'https://ctfe.sigstage.dev/2022'],
    ['ctlogs', 'https://rekor.sigstore.dev'],
  ] as const)('rejects mixed %s with unapproved endpoint %s', (kind, baseUrl) => {
    const mixed = publicRoot();
    mixed[kind].push({ ...mixed[kind][0]!, baseUrl });
    expect(() => selectPublicGoodTrustRoot(JSON.stringify(mixed))).toThrow(/public-good/u);
  });
  test.each(['tlogs', 'ctlogs'] as const)('rejects malformed %s identities', kind => {
    for (const change of [
      { publicKey: {} },
      { logId: {} },
      { publicKey: { rawBytes: 'not base64' } },
      { logId: { keyId: 'not base64' } },
      { logId: { keyId: '' } },
      { hashAlgorithm: 'SHA2_512' },
    ]) {
      const mixed = publicRoot();
      Object.assign(mixed[kind][0]!, change);
      expect(() => selectPublicGoodTrustRoot(JSON.stringify(mixed))).toThrow();
    }
  });
  test('retains actual historical and current public-good logs without pinning rotation keys', () => {
    const trusted = publicRoot();
    expect(trusted.tlogs.map(log => log.baseUrl)).toEqual([
      'https://rekor.sigstore.dev', 'https://log2025-1.rekor.sigstore.dev',
    ]);
    expect(trusted.ctlogs.map(log => log.baseUrl)).toEqual([
      'https://ctfe.sigstore.dev/test', 'https://ctfe.sigstore.dev/2022',
    ]);
    expect(JSON.parse(selectPublicGoodTrustRoot(JSON.stringify(trusted)))).toEqual(trusted);
    // A future authenticated TUF rotation within the public-good naming scheme.
    trusted.tlogs.push({ ...trusted.tlogs[1]!, baseUrl: 'https://log2027-2.rekor.sigstore.dev' });
    trusted.ctlogs.push({ ...trusted.ctlogs[1]!, baseUrl: 'https://ctfe.sigstore.dev/2027' });
    expect(JSON.parse(selectPublicGoodTrustRoot(JSON.stringify(trusted)))).toEqual(trusted);
  });
  test('rejects archive bytes that do not match the reviewed immutable artifact digest', () => {
    expect(() => verifyNpmProvenanceArchive(Buffer.from('not zip'), bytes, entries()[0]!.bundle))
      .toThrow(/artifact.*digest/i);
  });
  test('binds archive bytes to the unique regular attestation.json without extracting', () => {
    const raw = Buffer.from(JSON.stringify(bundle()));
    const archive = zip(raw);
    const expected = { ...entries()[0]!.bundle, size: raw.length, sha256: digest('sha256', raw), artifactDigest: `sha256:${digest('sha256', archive)}` };
    expect(() => verifyNpmProvenanceArchive(archive, raw, expected)).not.toThrow();
    for (const name of ['../attestation.json', 'other.json', 'directory/attestation.json']) {
      const wrong = zip(raw, name);
      expect(() => verifyNpmProvenanceArchive(wrong, raw, { ...expected, artifactDigest: `sha256:${digest('sha256', wrong)}` })).toThrow();
    }
    expect(() => verifyNpmProvenanceArchive(archive, Buffer.from('swapped'), expected)).toThrow();
  });
  test('requires four crypto subprocess results under exclusively public-good trust (stubbed unit results)', () => {
    const fixture = verificationFixture();
    const result = verifyNpmProvenanceBundles({ ...fixture, env: { GH_TOKEN: 'unit-fixture' } });
    expect(result.entries).toEqual(fixture.authorization.npmProvenance);
    expect(result.assertUnchanged).not.toThrow();
    expect(fixture.calls.filter(args => args[0] === 'attestation' && args[1] === 'verify')).toHaveLength(4);
  });
  test.each(['run_attempt', 'head_sha', 'event', 'head_branch'])('rejects authenticated run drift in %s', field => {
    const fixture = verificationFixture();
    Object.assign(fixture.run, { [field]: 'wrong' });
    expect(() => verifyNpmProvenanceBundles({ ...fixture, env: { GH_TOKEN: 'unit-fixture' } })).toThrow();
  });
  test.each(['runInvocationURI', 'runnerEnvironment', 'buildTrigger', 'sourceRepositoryVisibilityAtSigning', 'sourceRepositoryDigest', 'sourceRepositoryRef', 'sourceRepositoryIdentifier', 'sourceRepositoryOwnerIdentifier', 'buildSignerDigest', 'buildSignerURI'])(
    'rejects cryptographically reported certificate %s drift',
    field => {
      const fixture = verificationFixture();
      const execute = (command: string, args: readonly string[]) => {
        const result = fixture.execute(command, args);
        if (args[0] !== 'attestation' || args[1] !== 'verify') return result;
        const output = JSON.parse(String(result)) as Array<{
          verificationResult: { signature: { certificate: Record<string, string> } };
        }>;
        output[0]!.verificationResult.signature.certificate[field] = 'wrong';
        return JSON.stringify(output);
      };
      expect(() => verifyNpmProvenanceBundles({ ...fixture, execute, env: { GH_TOKEN: 'unit-fixture' } })).toThrow();
    },
  );
  test.each(['raw bundle', 'SHA256', 'SHA512', 'symlink', 'extra directory', 'extra file', 'archive'])('rejects %s substitution', kind => {
    const fixture = verificationFixture();
    const path = resolve(fixture.npmProvenanceRoot, '0/attestation.json');
    if (kind === 'raw bundle') writeFileSync(path, '{}');
    if (kind === 'SHA256') fixture.authorization.packages = packages.map(p => ({ ...p, sha256: 'a'.repeat(64) }));
    if (kind === 'SHA512') fixture.authorization.packages = packages.map(p => ({ ...p, sha512: 'a'.repeat(128) }));
    if (kind === 'symlink') { rmSync(path); symlinkSync(resolve(fixture.npmProvenanceRoot, '1/attestation.json'), path); }
    if (kind === 'extra directory') mkdirSync(resolve(fixture.npmProvenanceRoot, '4'));
    if (kind === 'extra file') writeFileSync(resolve(fixture.npmProvenanceRoot, '0/extra'), '');
    if (kind === 'archive') fixture.archives.set('3', Buffer.from('substitution'));
    expect(() => verifyNpmProvenanceBundles({ ...fixture, env: { GH_TOKEN: 'unit-fixture' } })).toThrow();
  });
  test('does not convert a cryptographic subprocess failure into success', () => {
    const fixture = verificationFixture();
    const execute = (command: string, args: readonly string[]) => {
      if (args[0] === 'attestation' && args[1] === 'verify') throw new Error('unit cryptographic rejection');
      return fixture.execute(command, args);
    };
    expect(() => verifyNpmProvenanceBundles({ ...fixture, execute, env: { GH_TOKEN: 'unit-fixture' } }))
      .toThrow('unit cryptographic rejection');
  });
  test('rejects artifact-directory symlink replacement during cryptographic verification', () => {
    const fixture = verificationFixture();
    let changed = false;
    const execute = (command: string, args: readonly string[]) => {
      const result = fixture.execute(command, args);
      if (!changed && args[0] === 'attestation' && args[1] === 'verify') {
        const root = resolve(fixture.npmProvenanceRoot, '0');
        const moved = resolve(fixture.artifactRoot, 'moved-bundle');
        renameSync(root, moved);
        symlinkSync(moved, root);
        changed = true;
      }
      return result;
    };
    expect(() => verifyNpmProvenanceBundles({ ...fixture, execute, env: { GH_TOKEN: 'unit-fixture' } })).toThrow();
  });
});
