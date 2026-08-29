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
  assertFrozenReleaseArtifacts,
  createReleaseArtifacts,
  parseReleaseArtifactArguments,
  verifyReleaseArtifacts,
} from '../scripts/create-release-artifacts.mjs';
import { readFrozenConformanceLock } from '../scripts/conformance-contract.mjs';
import { PUBLIC_PACKAGES } from '../scripts/repository-metadata.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  test('binds publication artifacts to the frozen candidate metadata', () => {
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
      assertFrozenReleaseArtifacts(manifest, lock),
    ).not.toThrow();

    const substituted = structuredClone(manifest);
    substituted.packages[0]!.sha256 = 'f'.repeat(64);
    expect(() =>
      assertFrozenReleaseArtifacts(substituted, lock),
    ).toThrow(
      'Release artifact @opencoven/sdk-core does not match the frozen SDK candidate',
    );
  });

  test('does not create canonical release artifacts without named evidence', () => {
    const outputRoot = createOutputRoot();

    expect(() =>
      createReleaseArtifacts({
        root: workspaceRoot,
        outputRoot,
        build: false,
      }),
    ).toThrow(
      'release.config.json must name a passing SDK #38 aggregate record',
    );
    expect(existsSync(resolve(outputRoot, 'release-manifest.json'))).toBe(false);
  });

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
    const result = createReleaseArtifacts({
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
    const result = createReleaseArtifacts({
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
    expect(verifyReleaseArtifacts({
      root: workspaceRoot,
      artifactRoot: outputRoot,
      requireConformanceEvidence: false,
    })).toEqual(
      result.manifest,
    );
    expect(verifyReleaseArtifacts({
      root: workspaceRoot,
      artifactRoot: outputRoot,
      requireConformanceEvidence: false,
    })).toEqual(
      writtenManifest,
    );
  }, 30_000);

  test('rejects modified tarballs', () => {
    const outputRoot = createOutputRoot();
    const result = createReleaseArtifacts({
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
      verifyReleaseArtifacts({
        root: workspaceRoot,
        artifactRoot: outputRoot,
        requireConformanceEvidence: false,
      }),
    ).toThrow('digest does not match release-manifest.json');
  }, 30_000);

  test('creates an owned temporary artifact root when output is omitted', () => {
    const result = createReleaseArtifacts({
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
