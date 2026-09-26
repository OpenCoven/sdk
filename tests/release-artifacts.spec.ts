import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  assertPublishablePackedManifest,
  assertFrozenConformanceArtifacts,
  createConformanceArtifacts,
  createPublicationArtifacts,
  main,
  parseReleaseArtifactArguments,
  serializeReleaseManifest,
  verifyConformanceArtifacts,
  verifyPublicationArtifacts,
} from '../scripts/create-release-artifacts.mjs';
import {
  readFrozenConformanceLock,
  validateJsonSchemaValue,
} from '../scripts/conformance-contract.mjs';
import * as releaseReadiness from '../scripts/release-readiness.mjs';
import * as sourceIdentity from '../scripts/publication-source-identity.mjs';
import * as releaseRuntime from '../scripts/release-runtime-integrity.mjs';
import * as packageArtifacts from '../scripts/package-artifacts.mjs';
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

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

function createOutputRoot(): string {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'opencoven-release-artifacts-'));
  temporaryRoots.push(outputRoot);
  return outputRoot;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(childProcess.execFileSync).mockReset();
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createPublicationFixture() {
  const root = createOutputRoot();
  const artifactRoot = resolve(root, 'artifacts');
  const config = releaseReadiness.readReleaseConfig(workspaceRoot);
  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const publisherBytes = Buffer.from('fixture publisher\n');
  const npmrcBytes = readFileSync(resolve(workspaceRoot, '.npmrc'));
  const sourceManifest: sourceIdentity.PublicationSourceManifest = {
    schemaVersion: 1,
    repository: 'OpenCoven/sdk',
    candidate: { commit: config.conformanceEvidence.candidateCommit, tree },
    entries: [{
      mode: '100644',
      path: 'packages/core/src/index.ts',
      size: 1,
      sha256: 'd'.repeat(64),
    }],
    runtimeSha256: config.conformanceEvidence.runtimeManifestSha256,
  };
  mkdirSync(resolve(root, 'scripts'));
  writeFileSync(resolve(root, 'scripts/publish-release-artifacts.mjs'), publisherBytes);
  writeFileSync(resolve(root, '.npmrc'), npmrcBytes);
  const tarballs: Record<string, string> = {};
  for (const { packageName, workspaceDirectory } of PUBLIC_PACKAGES) {
    const directory = resolve(root, 'fixtures', workspaceDirectory);
    mkdirSync(resolve(directory, 'package'), { recursive: true });
    writeFileSync(
      resolve(directory, 'package/package.json'),
      JSON.stringify({ name: packageName, version: '0.0.1' }),
    );
    const tarball = resolve(directory, 'package.tgz');
    childProcess.execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
    tarballs[workspaceDirectory] = tarball;
  }

  // Isolate release authorization and authenticated build execution, not artifact bytes.
  vi.spyOn(releaseReadiness, 'readReleaseConfig').mockReturnValue({
    ...config,
    publishingEnabled: true,
  });
  vi.spyOn(releaseReadiness, 'inspectReleaseRepository').mockReturnValue({
    root, repository: 'OpenCoven/sdk', commit, tree,
  });
  vi.spyOn(releaseReadiness, 'validateReleaseReadiness').mockReturnValue({
    version: '0.0.1',
    publishingEnabled: true,
    packages: config.packages,
    conformanceEvidenceRecord: null,
  });
  vi.spyOn(sourceIdentity, 'createPublicationSourceManifest').mockReturnValue(sourceManifest);
  vi.spyOn(sourceIdentity, 'serializePublicationSourceManifest').mockReturnValue(
    `${JSON.stringify(sourceManifest)}\n`,
  );
  vi.spyOn(sourceIdentity, 'verifyPublicationSourceIdentity').mockReturnValue(undefined);
  vi.spyOn(sourceIdentity, 'applyPublicationMetadataTransform').mockReturnValue(undefined);
  const runtime = {
    nodeVersion: releaseRuntime.AUTHENTICATED_NODE_VERSION,
    nodePath: releaseRuntime.AUTHENTICATED_NODE_LINUX_X64_PATH,
    nodeSize: releaseRuntime.AUTHENTICATED_NODE_LINUX_X64_SIZE,
    nodeSha256: releaseRuntime.AUTHENTICATED_NODE_LINUX_X64_EXECUTABLE_SHA256,
    corepackVersion: releaseRuntime.AUTHENTICATED_COREPACK_VERSION,
    corepackTreeSha256: releaseRuntime.AUTHENTICATED_COREPACK_TREE_SHA256,
    corepackPath: '/fixture/corepack.cjs',
  };
  vi.spyOn(releaseRuntime, 'resolveAuthenticatedReleaseRuntime').mockReturnValue(runtime);
  vi.spyOn(releaseRuntime, 'assertNoReleaseRuntimeShadows').mockReturnValue(undefined);
  const execute = vi.mocked(childProcess.execFileSync).getMockImplementation();
  if (execute === undefined) {
    throw new Error('Expected real process execution for tarball inspection.');
  }
  vi.mocked(childProcess.execFileSync).mockImplementation((command, args, options) => {
    if (command === runtime.nodePath) return '';
    if (command !== 'git' && command !== '/usr/bin/git') {
      return execute(command, args, options);
    }
    const arguments_ = args ?? [];
    if (arguments_[0] === 'status' || arguments_[0] === 'checkout') return '';
    if (arguments_[0] === 'clone') {
      const destination = arguments_.at(-1);
      if (typeof destination !== 'string') throw new Error('Missing clone destination');
      mkdirSync(destination, { recursive: true });
      return '';
    }
    if (arguments_[0] === 'rev-parse') {
      if (arguments_[1] === 'HEAD^{tree}') return tree;
      return options?.cwd === root || options?.cwd === workspaceRoot
        ? commit : sourceManifest.candidate.commit;
    }
    if (arguments_[0] === 'ls-files') return '.npmrc\0';
    if (arguments_[0] === 'show' && arguments_[1] === 'HEAD:.npmrc') return npmrcBytes;
    if (arguments_[0] === 'ls-tree') {
      return `100644 blob ${'c'.repeat(40)}\tscripts/publish-release-artifacts.mjs\n`;
    }
    if (arguments_[0] === 'cat-file') return publisherBytes;
    throw new Error(`Unexpected fixture git command: ${arguments_.join(' ')}`);
  });
  vi.spyOn(packageArtifacts, 'packPublicPackages').mockImplementation(({ destinationRoot }) => {
    const packed: Record<string, string> = {};
    for (const { workspaceDirectory } of PUBLIC_PACKAGES) {
      const source = tarballs[workspaceDirectory];
      if (source === undefined || destinationRoot === undefined) {
        throw new Error('Missing fixture tarball or destination');
      }
      const destination = resolve(destinationRoot, workspaceDirectory, 'package.tgz');
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination);
      packed[workspaceDirectory] = destination;
    }
    return packed;
  });
  const env = {
    GITHUB_REPOSITORY: 'OpenCoven/sdk',
    GITHUB_SHA: commit,
    GITHUB_WORKFLOW_SHA: commit,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'OpenCoven/sdk/.github/workflows/release.yml@refs/heads/main',
    GITHUB_JOB: 'publication-candidate',
    GITHUB_RUN_ID: '1234',
    GITHUB_RUN_ATTEMPT: '1',
    OPENCOVEN_PUBLICATION_ENVIRONMENT: 'publication-candidate',
    OPENCOVEN_PUBLICATION_ARTIFACT_NAME: `opencoven-sdk-publication-${commit}-0.0.1`,
  };
  return {
    root,
    artifactRoot,
    env,
    create: () => createPublicationArtifacts({ root, outputRoot: artifactRoot, env }),
    verify: () => verifyPublicationArtifacts({ root, artifactRoot }),
  };
}

describe('release artifacts', { timeout: 30_000 }, () => {
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
    ).toBe(7);
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
    const serialized = serializeReleaseManifest(manifest);
    expect(serialized).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(Buffer.byteLength(serialized)).toBe(lock.candidate.releaseManifest.size);
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(
      lock.candidate.releaseManifest.sha256,
    );
    expect(serialized).not.toContain('sha512');

    const substituted = structuredClone(manifest);
    substituted.packages[0]!.sha256 = 'f'.repeat(64);
    expect(() =>
      assertFrozenConformanceArtifacts(substituted, lock),
    ).toThrow(
      'Conformance artifact @opencoven/sdk-core does not match the frozen SDK candidate',
    );
  });

  test('does not create canonical conformance artifacts without verified evidence', () => {
    const outputRoot = createOutputRoot();

    expect(() =>
      createConformanceArtifacts({
        root: workspaceRoot,
        outputRoot,
        build: false,
      }),
    ).toThrow(
      'release.config.json conformance evidence record is not a complete canonical aggregate',
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

    test('parses an explicit GitHub output path without weakening validation', () => {
      expect(parseReleaseArtifactArguments(['--', '--github-output', '/tmp/outputs'])).toEqual({
        build: true,
        githubOutput: '/tmp/outputs',
      });
      for (const arguments_ of [
        ['--github-output'],
        ['--github-output', '--skip-build'],
        ['--github-output', ''],
      ]) {
        expect(() => parseReleaseArtifactArguments(arguments_)).toThrow(
          'Option --github-output requires a value',
        );
      }
      expect(() =>
        parseReleaseArtifactArguments(['--github-output', 'a', '--github-output', 'b']),
      ).toThrow('Option --github-output may only be provided once');
    });

    test('creates publication v7 with both digests bound to actual tarball bytes', () => {
      const fixture = createPublicationFixture();
      const result = fixture.create();
      expect(result.manifest.schemaVersion).toBe(7);
      expect(result.manifest.packages.map(({ name }) => name)).toEqual(
        PUBLIC_PACKAGES.map(({ packageName }) => packageName),
      );
      for (const entry of result.manifest.packages) {
        const bytes = readFileSync(resolve(fixture.artifactRoot, entry.file));
        expect(entry).toEqual({
          name: entry.name,
          version: entry.version,
          file: entry.file,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sha512: createHash('sha512').update(bytes).digest('hex'),
        });
      }
      expect(readFileSync(result.manifestPath, 'utf8')).toBe(
        `${JSON.stringify(result.manifest, null, 2)}\n`,
      );
      expect(fixture.verify()).toEqual(result.manifest);
    });

    test.each([
      ['missing', undefined],
      ['wrong algorithm', 'a'.repeat(64)],
      ['uppercase', 'A'.repeat(128)],
      ['non-hex', 'g'.repeat(128)],
      ['SRI encoding', `sha512-${'a'.repeat(128)}`],
    ])('rejects publication SHA512 that is %s', (_label, sha512) => {
      const fixture = createPublicationFixture();
      const result = fixture.create();
      const invalid = {
        ...result.manifest,
        schemaVersion: 7 as const,
        packages: result.manifest.packages.map((entry) => ({ ...entry, sha512 })),
      };
      const text = `${JSON.stringify(invalid, null, 2)}\n`;
      const schema = JSON.parse(
        readFileSync(artifactManifestSchemaPath, 'utf8'),
      ) as Record<string, unknown>;
      schema.$ref = '#/$defs/publicationArtifactSet';
      const parsed: unknown = JSON.parse(text);
      expect(() => validateJsonSchemaValue(parsed, schema, 'manifest')).toThrow();
      writeFileSync(result.manifestPath, text);
      expect(fixture.verify).toThrow(/sha512/u);
      expect(() => {
        // @ts-expect-error Exercise malformed publication digest input at runtime.
        serializeReleaseManifest(invalid);
      }).toThrow(/sha512/u);
    });

    test('rejects publication schema 6 rather than relabeling it', () => {
      const fixture = createPublicationFixture();
      const result = fixture.create();
      const obsolete = { ...result.manifest, schemaVersion: 6 };
      writeFileSync(result.manifestPath, `${JSON.stringify(obsolete, null, 2)}\n`);
      expect(fixture.verify).toThrow(/schemaVersion/u);
      expect(() => {
        // @ts-expect-error Obsolete schema versions must also fail at runtime.
        serializeReleaseManifest(obsolete);
      }).toThrow(/schemaVersion/u);
    });

    test('rejects a SHA512 mismatch even when SHA256 and size match', () => {
      const fixture = createPublicationFixture();
      const result = fixture.create();
      const changed = {
        ...result.manifest,
        schemaVersion: 7,
        packages: result.manifest.packages.map((entry) => ({
          ...entry,
          sha512: '0'.repeat(128),
        })),
      };
      writeFileSync(result.manifestPath, `${JSON.stringify(changed, null, 2)}\n`);
      expect(fixture.verify).toThrow(
        '@opencoven/sdk-core sha512 digest does not match release-manifest.json',
      );
    });

    test('appends exactly four ordered SHA512 outputs after successful creation', () => {
      const fixture = createPublicationFixture();
      for (const [key, value] of Object.entries(fixture.env)) vi.stubEnv(key, value);
      const outputPath = resolve(fixture.root, 'github-output');
      writeFileSync(outputPath, 'existing=value\n');
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      main(['--output', fixture.artifactRoot, '--github-output', outputPath]);
      const manifest = fixture.verify();
      expect(readFileSync(outputPath, 'utf8')).toBe(
        'existing=value\n'
        + manifest.packages.map((entry, index) =>
          `npm-sha512-${index}=${createHash('sha512')
            .update(readFileSync(resolve(fixture.artifactRoot, entry.file))).digest('hex')}\n`,
        ).join(''),
      );
      expect(stdout).toHaveBeenCalledExactlyOnceWith(`${JSON.stringify({
        artifactRoot: fixture.artifactRoot,
        manifestPath: resolve(fixture.artifactRoot, 'release-manifest.json'),
        manifest,
      })}\n`);
    });

    test('does not append GitHub outputs when creation fails closed', () => {
      const outputPath = resolve(createOutputRoot(), 'github-output');
      writeFileSync(outputPath, 'existing=value\n');
      expect(() => main(['--github-output', outputPath])).toThrow(
        'Release publishing is disabled by release.config.json',
      );
      expect(readFileSync(outputPath, 'utf8')).toBe('existing=value\n');
    });

    test('does not append GitHub outputs when artifact verification fails', () => {
      const fixture = createPublicationFixture();
      for (const [key, value] of Object.entries(fixture.env)) vi.stubEnv(key, value);
      mkdirSync(fixture.artifactRoot);
      writeFileSync(resolve(fixture.artifactRoot, 'unexpected.txt'), 'not an artifact');
      const outputPath = resolve(fixture.root, 'github-output');
      writeFileSync(outputPath, 'existing=value\n');
      expect(() =>
        main(['--output', fixture.artifactRoot, '--github-output', outputPath]),
      ).toThrow('Publication artifact set contains unexpected or missing files');
      expect(readFileSync(outputPath, 'utf8')).toBe('existing=value\n');
    });

    test('does not let GitHub outputs modify the verified artifact inventory', () => {
      const fixture = createPublicationFixture();
      for (const [key, value] of Object.entries(fixture.env)) vi.stubEnv(key, value);
      const outputPath = resolve(fixture.artifactRoot, 'release-manifest.json');
      vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      expect(() =>
        main(['--output', fixture.artifactRoot, '--github-output', outputPath]),
      ).toThrow('GitHub output file must be outside the publication artifact root');
      expect(fixture.verify().schemaVersion).toBe(7);
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
    expect(writtenManifest.version).toBe('0.0.1');
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
