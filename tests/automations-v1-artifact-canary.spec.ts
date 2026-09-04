import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptPath = resolve(root, 'scripts/verify-automations-v1-artifact.mjs');
const scratchRoots: string[] = [];
const sourceCommit = '8a796807b37d4ad33eaeca37498debf1ca55dd49';
const contractProfile = 'coven.automations.v1';
const contractFiles = [
  'README.md',
  'automation-attempt.schema.json',
  'automation-definition.schema.json',
  'automation-occurrence.schema.json',
  'automation-receipt.schema.json',
  'automation-run.schema.json',
  'capabilities.json',
  'command-envelope.schema.json',
  'common.schema.json',
  'compatibility-matrix.json',
  'conformance-manifest.json',
  'coven.automations.v1.d.ts',
  'error-envelope.schema.json',
  'event-envelope.schema.json',
  'protocol-version.json',
  'state-machines.json',
  'test-vectors.json',
] as const;

interface ArtifactOptions {
  duplicatePath?: string;
  extraPath?: string;
  manifestTransform?: (manifest: ArtifactManifest) => void;
  omitPath?: string;
  unsafePath?: string;
  contractTransform?: (files: Map<string, Buffer>) => void;
}

interface ArtifactManifest {
  schemaVersion: string;
  contractProfile: string;
  sourceCommit: string;
  contractContentSha256: string;
  files: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, '0');
  target.write(encoded, offset, length - 1, 'ascii');
  target[offset + length - 1] = 0;
}

function createTar(entries: Array<{ path: string; bytes: Buffer }>): Buffer {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.bytes.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;

    chunks.push(header, entry.bytes);

    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }

  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function fixtureEvents(): Array<Record<string, unknown>> {
  const states = ['planned', 'eligible', 'claimed', 'dispatching', 'running', 'succeeded'];

  return states.map((to, sequence) => ({
    schemaVersion: contractProfile,
    eventId: `event-${sequence}`,
    stream: {
      kind: 'occurrence',
      id: 'occurrence-1',
    },
    sequence,
    kind: 'occurrence.transitioned',
    payload: {
      entity: 'occurrence',
      from: sequence === 0 ? 'none' : states[sequence - 1],
      to,
      reason: `transition-${sequence}`,
      fenceGeneration: 1,
    },
  }));
}

function createContractFiles(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const schemas = contractFiles.filter((path) => path.endsWith('.schema.json'));

  for (const path of schemas) {
    const schemaRoot =
      path === 'common.schema.json'
        ? { $defs: {} }
        : path === 'command-envelope.schema.json'
          ? { oneOf: [] }
          : path === 'error-envelope.schema.json'
            ? { $ref: 'common.schema.json#/$defs/ErrorEnvelope' }
            : { type: 'object' };
    files.set(
      path,
      jsonBytes({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `https://opencoven.ai/spec/coven-automations/v1/${path}`,
        title: path,
        ...schemaRoot,
      }),
    );
  }

  files.set(
    'README.md',
    Buffer.from('# Coven Automations v1\n\nImmutable artifact fixture.\n', 'utf8'),
  );
  files.set(
    'protocol-version.json',
    jsonBytes({
      protocol: 'Coven Automations',
      contractProfile,
      version: 1,
    }),
  );
  files.set(
    'capabilities.json',
    jsonBytes({
      contractProfile,
      version: 1,
      supported: {},
      refused: {},
      negotiationRules: {},
    }),
  );
  files.set(
    'compatibility-matrix.json',
    jsonBytes({
      contractProfile,
      version: 1,
      changeClasses: {},
      objectFields: {},
      profileRefusal: {},
    }),
  );
  files.set(
    'state-machines.json',
    jsonBytes({
      contractProfile,
      version: 1,
      machines: {},
      invariants: [],
    }),
  );
  files.set(
    'conformance-manifest.json',
    jsonBytes({
      protocol: 'Coven Automations',
      contractProfile,
      objects: [
        'AutomationDefinition',
        'AutomationOccurrence',
        'AutomationRun',
        'AutomationAttempt',
        'AutomationReceipt',
        'CommandEnvelope',
        'CommandResponse',
        'ErrorEnvelope',
        'EventEnvelope',
      ],
      schemas: [
        ...schemas.filter((path) => path !== 'common.schema.json'),
        'common.schema.json',
      ],
      stateMachines: 'state-machines.json',
      compatibilityMatrix: 'compatibility-matrix.json',
      goldenVectors: 'test-vectors.json',
      requiredSuites: [
        'duplicate-and-out-of-order-event-replay',
        'golden-vectors-external-runners',
        'packed-artifact-canaries',
      ],
      canaryRequirements: {
        sdk: 'Consumes the pinned TypeScript declarations and golden vectors.',
      },
    }),
  );
  files.set(
    'coven.automations.v1.d.ts',
    Buffer.from(
      [
        'export type SchemaVersion = "coven.automations.v1";',
        'export interface Digest { algorithm: "sha256"; canonicalization: "jcs-rfc8785"; value: string; }',
        'export interface AutomationDefinition { schemaVersion: SchemaVersion; automationId: string; revision: number; integrity: Digest; lifecycleState: "draft" | "paused" | "active" | "disabled" | "invalid"; }',
        'export interface CommandEnvelope<C extends string = string> { schemaVersion: SchemaVersion; command: C; adoptionKey: string; }',
        'export interface EventEnvelope { schemaVersion: SchemaVersion; eventId: string; sequence: number; kind: "occurrence.transitioned"; payload: { to: string }; }',
        '',
      ].join('\n'),
      'utf8',
    ),
  );
  files.set(
    'test-vectors.json',
    jsonBytes({
      contractProfile,
      version: 1,
      status: 'proposed',
      digestRecipe: {
        canonicalization: 'RFC 8785 (JCS)',
        digest: 'SHA-256',
        fixtureScope: 'ASCII and integers',
        verification: 'Recompute before use.',
      },
      caseKinds: {
        changefeed: 'Duplicate, ordering, and replay semantics.',
      },
      fixtures: {
        'event.occurrence.sequence': fixtureEvents(),
      },
      cases: [
        {
          name: 'event-duplicate-delivery-is-ignored',
          kind: 'changefeed',
          stream: { kind: 'occurrence', id: 'occurrence-1' },
          deliveries: [
            'event.occurrence.sequence[0]',
            'event.occurrence.sequence[1]',
            'event.occurrence.sequence[1]',
            'event.occurrence.sequence[2]',
          ],
          expected: 'duplicate ignored',
        },
        {
          name: 'event-out-of-order-is-rejected-not-reordered',
          kind: 'changefeed',
          stream: { kind: 'occurrence', id: 'occurrence-1' },
          consumerCursor: 2,
          deliveries: ['event.occurrence.sequence[1]'],
          expected: 'reject',
          errorCode: 'STREAM_OUT_OF_ORDER',
        },
        {
          name: 'event-replay-rehydrates-deterministically',
          kind: 'changefeed',
          stream: { kind: 'occurrence', id: 'occurrence-1' },
          reductions: [
            {
              label: 'from-empty',
              cursor: -1,
              deliveries: 'event.occurrence.sequence[0..5]',
            },
            {
              label: 'from-empty-with-duplicate',
              cursor: -1,
              deliveries: 'event.occurrence.sequence[0..5] plus a duplicate of [3]',
            },
            {
              label: 'resume-after-cursor-2',
              cursor: 2,
              deliveries: 'event.occurrence.sequence[3..5]',
            },
          ],
          expected: 'identical succeeded projections',
        },
      ],
    }),
  );

  expect([...files.keys()].sort()).toEqual([...contractFiles].sort());
  return files;
}

function mutateVectors(
  files: Map<string, Buffer>,
  mutate: (vectors: Record<string, unknown>) => void,
): void {
  const path = 'test-vectors.json';
  const bytes = files.get(path);
  expect(bytes).toBeDefined();
  const vectors = JSON.parse(bytes?.toString('utf8') ?? '') as Record<string, unknown>;
  mutate(vectors);
  files.set(path, jsonBytes(vectors));
}

function contentDigest(files: Map<string, Buffer>): string {
  const digestInput = [...files.entries()]
    .map(([path, bytes]) => `${path}\0${sha256(bytes)}\n`)
    .sort()
    .join('');

  return sha256(digestInput);
}

function createArtifact(options: ArtifactOptions = {}): {
  archive: Buffer;
  bundleSha256: string;
  contentSha256: string;
} {
  const files = createContractFiles();
  options.contractTransform?.(files);
  const contentSha256 = contentDigest(files);
  const manifest: ArtifactManifest = {
    schemaVersion: 'coven.automations.bundle.v1',
    contractProfile,
    sourceCommit,
    contractContentSha256: contentSha256,
    files: [...files.entries()]
      .map(([path, bytes]) => ({
        path,
        sha256: sha256(bytes),
        size: bytes.length,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  options.manifestTransform?.(manifest);

  const entries = [...files.entries()]
    .filter(([path]) => path !== options.omitPath)
    .map(([path, bytes]) => ({
      path: `coven-automations-v1/${path}`,
      bytes,
    }));

  if (options.duplicatePath !== undefined) {
    entries.push({
      path: `coven-automations-v1/${options.duplicatePath}`,
      bytes: files.get(options.duplicatePath) ?? Buffer.from('duplicate', 'utf8'),
    });
  }

  if (options.extraPath !== undefined) {
    entries.push({
      path: `coven-automations-v1/${options.extraPath}`,
      bytes: Buffer.from('extra', 'utf8'),
    });
  }

  if (options.unsafePath !== undefined) {
    entries.push({
      path: options.unsafePath,
      bytes: Buffer.from('unsafe', 'utf8'),
    });
  }

  entries.push({
    path: 'manifest.json',
    bytes: jsonBytes(manifest),
  });

  const archive = gzipSync(createTar(entries), { level: 9 });

  return {
    archive,
    bundleSha256: sha256(archive),
    contentSha256,
  };
}

function writeArtifact(bytes: Buffer, name = 'artifact.tar.gz'): string {
  const scratchRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-automations-canary-spec-'));
  scratchRoots.push(scratchRoot);
  const path = resolve(scratchRoot, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

function runCanary(
  archivePath: string,
  expected: {
    bundleSha256: string;
    sourceCommit?: string;
    contentSha256: string;
  },
) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      '--archive',
      archivePath,
      '--bundle-sha256',
      expected.bundleSha256,
      '--source-commit',
      expected.sourceCommit ?? sourceCommit,
      '--content-sha256',
      expected.contentSha256,
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
}

afterEach(() => {
  while (scratchRoots.length > 0) {
    const scratchRoot = scratchRoots.pop();
    if (scratchRoot !== undefined) {
      rmSync(scratchRoot, { force: true, recursive: true });
    }
  }
});

describe('Automations v1 exact-artifact canary', () => {
  test('requires every externally recorded artifact identity argument', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'usage: verify-automations-v1-artifact.mjs --archive <path> --bundle-sha256 <sha256> --source-commit <commit> --content-sha256 <sha256>',
    );
  });

  test('verifies a complete archive, typechecks its declaration, and exercises replay vectors', () => {
    const artifact = createArtifact();
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`sourceCommit=${sourceCommit}`);
    expect(result.stdout).toContain(`bundleSha256=${artifact.bundleSha256}`);
    expect(result.stdout).toContain(`contractContentSha256=${artifact.contentSha256}`);
    expect(result.stdout).toContain('manifestFiles=17');
    expect(result.stdout).toContain('typecheck=passed');
    expect(result.stdout).toContain('duplicateDelivery=passed');
    expect(result.stdout).toContain('outOfOrderRefusal=passed');
    expect(result.stdout).toContain('reconnectReplay=passed');
  });

  test.each([
    ['bundle digest', (artifact: ReturnType<typeof createArtifact>) => ({
      ...artifact,
      bundleSha256: '0'.repeat(64),
    }), /Bundle SHA-256 mismatch/u],
    ['source commit', (artifact: ReturnType<typeof createArtifact>) => ({
      ...artifact,
      sourceCommit: '0'.repeat(40),
    }), /Source commit mismatch/u],
    ['content digest', (artifact: ReturnType<typeof createArtifact>) => ({
      ...artifact,
      contentSha256: '0'.repeat(64),
    }), /Contract content SHA-256 mismatch/u],
  ])('rejects the wrong externally recorded %s', (_label, mutate, expectedError) => {
    const artifact = createArtifact();
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, mutate(artifact));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(expectedError);
  });

  test.each([
    ['gzip stream', Buffer.from('not gzip', 'utf8'), /Invalid gzip artifact/u],
    ['tar stream', gzipSync(Buffer.from('not a tar archive', 'utf8')), /Invalid tar artifact/u],
  ])('rejects a malformed %s even when its external bundle digest matches', (_label, bytes, error) => {
    const archivePath = writeArtifact(bytes);
    const result = runCanary(archivePath, {
      bundleSha256: sha256(bytes),
      contentSha256: '0'.repeat(64),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(error);
  });

  test.each([
    ['unsafe', { unsafePath: '../escape' }, /Unsafe archive path/u],
    ['duplicate', { duplicatePath: 'README.md' }, /Duplicate archive path/u],
    ['missing', { omitPath: 'README.md' }, /Missing archive path/u],
    ['extra', { extraPath: 'unexpected.json' }, /Unexpected archive path/u],
  ])('rejects %s archive paths', (_label, options, error) => {
    const artifact = createArtifact(options);
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(error);
  });

  test.each([
    [
      'file size',
      (manifest: ArtifactManifest) => {
        const entry = manifest.files.find(({ path }) => path === 'README.md');
        if (entry !== undefined) {
          entry.size += 1;
        }
      },
      /Manifest size mismatch/u,
    ],
    [
      'file hash',
      (manifest: ArtifactManifest) => {
        const entry = manifest.files.find(({ path }) => path === 'README.md');
        if (entry !== undefined) {
          entry.sha256 = '0'.repeat(64);
        }
      },
      /Manifest SHA-256 mismatch/u,
    ],
    [
      'manifest source commit',
      (manifest: ArtifactManifest) => {
        manifest.sourceCommit = '0'.repeat(40);
      },
      /Source commit mismatch/u,
    ],
    [
      'manifest content digest',
      (manifest: ArtifactManifest) => {
        manifest.contractContentSha256 = '0'.repeat(64);
      },
      /Contract content SHA-256 mismatch/u,
    ],
  ])('rejects a bad %s', (_label, manifestTransform, error) => {
    const artifact = createArtifact({ manifestTransform });
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(error);
  });

  test('rejects a malformed expected contract set even when every digest is valid', () => {
    const artifact = createArtifact({
      contractTransform(files) {
        files.set(
          'conformance-manifest.json',
          jsonBytes({
            protocol: 'Coven Automations',
            contractProfile,
            requiredSuites: [],
            canaryRequirements: {},
          }),
        );
      },
    });
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Malformed Automations v1 contract set/u);
  });

  test('rejects a duplicate-delivery vector that never redelivers an applied event', () => {
    const artifact = createArtifact({
      contractTransform(files) {
        mutateVectors(files, (vectors) => {
          const cases = vectors.cases as Array<Record<string, unknown>>;
          const duplicateCase = cases.find(
            ({ name }) => name === 'event-duplicate-delivery-is-ignored',
          );
          expect(duplicateCase).toBeDefined();
          duplicateCase!.deliveries = [
            'event.occurrence.sequence[0]',
            'event.occurrence.sequence[1]',
            'event.occurrence.sequence[2]',
          ];
        });
      },
    });
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /duplicate-delivery case must redeliver an already-applied event/u,
    );
  });

  test('rejects replay vectors that omit the named duplicate scenario', () => {
    const artifact = createArtifact({
      contractTransform(files) {
        mutateVectors(files, (vectors) => {
          const cases = vectors.cases as Array<Record<string, unknown>>;
          const replayCase = cases.find(
            ({ name }) => name === 'event-replay-rehydrates-deterministically',
          );
          expect(replayCase).toBeDefined();
          const reductions = replayCase!.reductions as Array<Record<string, unknown>>;
          const duplicate = reductions.find(
            ({ label }) => label === 'from-empty-with-duplicate',
          );
          expect(duplicate).toBeDefined();
          duplicate!.label = 'from-empty-second-pass';
          duplicate!.deliveries = 'event.occurrence.sequence[0..5]';
        });
      },
    });
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /replay case must include from-empty-with-duplicate/u,
    );
  });

  test('rejects a resume scenario with the wrong cursor and delivery range', () => {
    const artifact = createArtifact({
      contractTransform(files) {
        mutateVectors(files, (vectors) => {
          const cases = vectors.cases as Array<Record<string, unknown>>;
          const replayCase = cases.find(
            ({ name }) => name === 'event-replay-rehydrates-deterministically',
          );
          expect(replayCase).toBeDefined();
          const reductions = replayCase!.reductions as Array<Record<string, unknown>>;
          const resume = reductions.find(({ label }) => label === 'resume-after-cursor-2');
          expect(resume).toBeDefined();
          resume!.cursor = 1;
          resume!.deliveries = 'event.occurrence.sequence[2..5]';
        });
      },
    });
    const archivePath = writeArtifact(artifact.archive);

    const result = runCanary(archivePath, artifact);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /resume-after-cursor-2 must resume at cursor 2 with deliveries 3 through 5/u,
    );
  });

  test('documents a package script without pinning any local archive path', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

    expect(manifest.scripts?.['canary:automations-v1']).toBe(
      'node ./scripts/verify-automations-v1-artifact.mjs',
    );
    expect(readme).toContain('canary:automations-v1');
    expect(readme).toContain('--archive');
    expect(readme).toContain('--bundle-sha256');
    expect(readme).toContain('--source-commit');
    expect(readme).toContain('--content-sha256');
    expect(readme).not.toContain('/Users/buns/');
  });
});
