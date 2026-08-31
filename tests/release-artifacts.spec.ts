import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import {
  assertPublishablePackedManifest,
  assertFrozenConformanceArtifacts,
  createConformanceArtifacts,
  createPublicationArtifacts,
  parseReleaseArtifactArguments,
  verifyConformanceArtifacts,
} from '../scripts/create-release-artifacts.mjs';
import { readFrozenConformanceLock } from '../scripts/conformance-contract.mjs';
import {
  PUBLIC_PACKAGES,
  readPackedPackageManifest,
} from '../scripts/repository-metadata.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactManifestSchemaPath = resolve(
  workspaceRoot,
  'conformance/release-artifact-manifest.schema.json',
);
const temporaryRoots: string[] = [];

function createOutputRoot(): string {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-release-artifacts-'));
  temporaryRoots.push(outputRoot);
  return outputRoot;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('release artifacts', () => {
  test('defines distinct conformance and publication artifact schemas', () => {
    const schema = JSON.parse(
      readFileSync(artifactManifestSchemaPath, 'utf8'),
    ) as {
      oneOf: Array<{ $ref: string }>;
      $defs: Record<string, { required: string[] }>;
    };

    expect(schema.oneOf).toEqual([
      { $ref: '#/$defs/conformanceArtifactSet' },
      { $ref: '#/$defs/publicationArtifactSet' },
    ]);
    expect(schema.$defs.conformanceArtifactSet?.required).not.toContain(
      'provenance',
    );
    expect(schema.$defs.publicationArtifactSet?.required).toEqual([
      'schemaVersion',
      'artifactSet',
      'version',
      'source',
      'toolchain',
      'publisher',
      'provenance',
      'packages',
    ]);
    expect(
      (
        schema.$defs.publicationArtifactSet as unknown as {
          properties: {
            schemaVersion: {
              const: number;
            };
            source: {
              properties: {
                runtimeManifest: {
                  type: string;
                };
              };
              required: string[];
            };
          };
        }
      ).properties.schemaVersion.const,
    ).toBe(6);
    expect(
      (
        schema.$defs.publicationArtifactSet as unknown as {
          properties: {
            source: {
              required: string[];
            };
          };
        }
      ).properties.source.required,
    ).toContain('runtimeManifest');
    expect(
      (
        schema.$defs.publicationArtifactSet as unknown as {
          properties: {
            provenance: {
              required: string[];
            };
          };
        }
      ).properties.provenance.required,
    ).toEqual([
      'repository',
      'workflow',
      'workflowCommit',
      'sourceRef',
      'runId',
      'runAttempt',
      'job',
      'environment',
      'artifactName',
    ]);
  });

  test('binds conformance artifacts to the frozen candidate metadata', () => {
    const lock = readFrozenConformanceLock();
    const manifest = {
      schemaVersion: 1 as const,
      version: lock.candidate.releaseManifest.version,
      packages: lock.candidate.sdkPackages.map((entry) => ({
        name: entry.packageName,
        version: entry.version,
        file: entry.releaseFile,
        size: entry.size,
        sha256: entry.sha256,
      })),
    };
    expect(() =>
      assertFrozenConformanceArtifacts(manifest, lock),
    ).not.toThrow();

    const substituted = structuredClone(manifest);
    substituted.packages[0]!.sha256 = 'f'.repeat(64);
    expect(() =>
      assertFrozenConformanceArtifacts(substituted, lock),
    ).toThrow(
      'Conformance artifact @opencoven/sdk-core does not match the frozen SDK candidate',
    );
  });

  test('does not create canonical conformance artifacts without named evidence', () => {
    const outputRoot = createOutputRoot();

    expect(() =>
      createConformanceArtifacts({
        root: workspaceRoot,
        outputRoot,
        build: false,
      }),
    ).toThrow(
      'release.config.json must name a passing SDK #38 aggregate record',
    );
    expect(existsSync(resolve(outputRoot, 'release-manifest.json'))).toBe(false);
  });

  test('keeps private non-publication artifacts distinct from publication candidates', () => {
    const outputRoot = createOutputRoot();
    const result = createConformanceArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
      requireConformanceEvidence: false,
    });
    const first = result.manifest.packages[0];
    if (first === undefined) {
      throw new Error('Expected a conformance artifact.');
    }

    expect(result.artifactSet).toBe('local-verification');
    expect(
      verifyConformanceArtifacts({
        root: workspaceRoot,
        artifactRoot: outputRoot,
        requireConformanceEvidence: false,
      }),
    ).toEqual(result.manifest);
    expect(() =>
      assertPublishablePackedManifest(
        readPackedPackageManifest(resolve(outputRoot, first.file)),
        first.name,
      ),
    ).toThrow(`${first.name} publication artifact must not contain private: true`);
    expect(() =>
      createPublicationArtifacts({
        root: workspaceRoot,
        outputRoot: resolve(outputRoot, 'publication'),
        build: false,
      }),
    ).toThrow(
      'Release publishing is disabled by release.config.json',
    );
  }, 30_000);

  test('accepts pnpm argument separators without weakening option validation', () => {
    expect(
      parseReleaseArtifactArguments([
        '--',
        '--output',
        '.artifacts/release-test',
        '--version',
        '0.1.0',
        '--skip-build',
      ]),
    ).toEqual({
      outputRoot: '.artifacts/release-test',
      version: '0.1.0',
      build: false,
    });
    expect(() => parseReleaseArtifactArguments(['--unknown'])).toThrow(
      'Unknown option --unknown',
    );
  });

  test('creates checksummed tarballs in canonical package order', () => {
    const outputRoot = createOutputRoot();
    const result = createConformanceArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
      requireConformanceEvidence: false,
    });

    expect(result.manifest.packages.map(({ name }) => name)).toEqual(
      PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    );
    expect(result.manifest.packages).toHaveLength(4);

    for (const entry of result.manifest.packages) {
      const bytes = readFileSync(resolve(outputRoot, entry.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(entry.size).toBe(bytes.byteLength);
    }
  }, 30_000);

  test('writes a deterministic relative release manifest', () => {
    const outputRoot = createOutputRoot();
    const result = createConformanceArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
      requireConformanceEvidence: false,
    });
    const writtenManifest = JSON.parse(
      readFileSync(result.manifestPath, 'utf8'),
    ) as typeof result.manifest;

    expect(writtenManifest).toEqual(result.manifest);
    expect(writtenManifest.schemaVersion).toBe(1);
    expect(writtenManifest.version).toBe('0.1.0');
    expect(
      writtenManifest.packages.every(
        ({ file }) => !isAbsolute(file) && !file.includes('..'),
      ),
    ).toBe(true);
    expect(verifyConformanceArtifacts({
      root: workspaceRoot,
      artifactRoot: outputRoot,
      requireConformanceEvidence: false,
    })).toEqual(
      result.manifest,
    );
    expect(verifyConformanceArtifacts({
      root: workspaceRoot,
      artifactRoot: outputRoot,
      requireConformanceEvidence: false,
    })).toEqual(
      writtenManifest,
    );
  }, 30_000);

  test('rejects modified tarballs', () => {
    const outputRoot = createOutputRoot();
    const result = createConformanceArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
      requireConformanceEvidence: false,
    });
    const [firstEntry] = result.manifest.packages;
    expect(firstEntry).toBeDefined();
    if (firstEntry === undefined) {
      throw new Error('Expected at least one release artifact.');
    }
    const firstTarball = resolve(outputRoot, firstEntry.file);
    const bytes = readFileSync(firstTarball);
    const firstByte = bytes[0];
    if (firstByte === undefined) {
      throw new Error('Expected a non-empty release artifact.');
    }
    bytes[0] = firstByte ^ 0xff;
    writeFileSync(firstTarball, bytes);

    expect(() =>
      verifyConformanceArtifacts({
        root: workspaceRoot,
        artifactRoot: outputRoot,
        requireConformanceEvidence: false,
      }),
    ).toThrow('digest does not match release-manifest.json');
  }, 30_000);

  test.each([
    {
      name: 'appended whitespace',
      mutate: (text: string): string => `${text} `,
      message:
        'release-manifest.json must use canonical UTF-8 JSON with LF and one trailing newline',
    },
    {
      name: 'alternate key order',
      mutate: (text: string): string => {
        const manifest = JSON.parse(text) as Record<string, unknown>;
        return `${JSON.stringify({
          packages: manifest.packages,
          version: manifest.version,
          schemaVersion: manifest.schemaVersion,
        }, null, 2)}\n`;
      },
      message:
        'release-manifest.json must use canonical UTF-8 JSON with LF and one trailing newline',
    },
    {
      name: 'alternate nested key order',
      mutate: (text: string): string => {
        const manifest = JSON.parse(text) as {
          schemaVersion: number;
          version: string;
          packages: Array<{
            name: string;
            version: string;
            file: string;
            size: number;
            sha256: string;
          }>;
        };
        return `${JSON.stringify({
          schemaVersion: manifest.schemaVersion,
          version: manifest.version,
          packages: manifest.packages.map((entry) => ({
            sha256: entry.sha256,
            size: entry.size,
            file: entry.file,
            version: entry.version,
            name: entry.name,
          })),
        }, null, 2)}\n`;
      },
      message:
        'release-manifest.json must use canonical UTF-8 JSON with LF and one trailing newline',
    },
    {
      name: 'duplicate keys',
      mutate: (text: string): string =>
        text.replace(
          '  "schemaVersion": 1,',
          '  "schemaVersion": 1,\n  "schemaVersion": 1,',
        ),
      message: 'release-manifest.json contains duplicate JSON object key "schemaVersion"',
    },
  ])('rejects non-canonical manifest bytes with $name', ({ mutate, message }) => {
    const outputRoot = createOutputRoot();
    const result = createConformanceArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
      requireConformanceEvidence: false,
    });
    const manifestText = readFileSync(result.manifestPath, 'utf8');
    writeFileSync(result.manifestPath, mutate(manifestText));

    expect(() =>
      verifyConformanceArtifacts({
        root: workspaceRoot,
        artifactRoot: outputRoot,
        requireConformanceEvidence: false,
      }),
    ).toThrow(message);
  }, 30_000);

  test('creates an owned temporary artifact root when output is omitted', () => {
    const result = createConformanceArtifacts({
      root: workspaceRoot,
      build: false,
      requireConformanceEvidence: false,
    });
    temporaryRoots.push(result.artifactRoot);

    expect(existsSync(resolve(result.artifactRoot, '.opencoven-owned-temp'))).toBe(
      true,
    );
    expect(result.manifestPath).toBe(
      resolve(result.artifactRoot, 'release-manifest.json'),
    );
  }, 30_000);
});
