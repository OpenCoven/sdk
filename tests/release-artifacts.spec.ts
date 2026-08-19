import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

import {
  createReleaseArtifacts,
  parseReleaseArtifactArguments,
  verifyReleaseArtifacts,
} from '../scripts/create-release-artifacts.mjs';
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
    });

    expect(result.manifest.packages.map(({ name }) => name)).toEqual(
      PUBLIC_PACKAGES.map(({ packageName }) => packageName),
    );

    for (const entry of result.manifest.packages) {
      const bytes = readFileSync(resolve(outputRoot, entry.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(entry.size).toBe(bytes.byteLength);
    }
  });

  test('writes a deterministic relative release manifest', () => {
    const outputRoot = createOutputRoot();
    const result = createReleaseArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
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
    expect(verifyReleaseArtifacts({ root: workspaceRoot, artifactRoot: outputRoot })).toEqual(
      result.manifest,
    );
    expect(verifyReleaseArtifacts({ root: workspaceRoot, artifactRoot: outputRoot })).toEqual(
      writtenManifest,
    );
  });

  test('rejects modified tarballs', () => {
    const outputRoot = createOutputRoot();
    const result = createReleaseArtifacts({
      root: workspaceRoot,
      outputRoot,
      build: false,
    });
    const firstTarball = resolve(outputRoot, result.manifest.packages[0].file);
    appendFileSync(firstTarball, 'tampered');

    expect(() =>
      verifyReleaseArtifacts({ root: workspaceRoot, artifactRoot: outputRoot }),
    ).toThrow('does not match release-manifest.json');
  });

  test('creates an owned temporary artifact root when output is omitted', () => {
    const result = createReleaseArtifacts({
      root: workspaceRoot,
      build: false,
    });
    temporaryRoots.push(result.artifactRoot);

    expect(existsSync(resolve(result.artifactRoot, '.opencoven-owned-temp'))).toBe(
      true,
    );
    expect(result.manifestPath).toBe(
      resolve(result.artifactRoot, 'release-manifest.json'),
    );
  });
});
