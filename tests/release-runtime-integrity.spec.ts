import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

const fixtures: string[] = [];
const runtimeIntegrityModule = await import(
  '../scripts/release-runtime-integrity.mjs'
).catch(() => null);

interface RuntimeIntegrityModule {
  createSterileReleaseEnvironment(options: {
    authenticatedNodePath: string;
    home: string;
    temporary: string;
    corepackHome: string;
    source?: Record<string, string | undefined>;
    include?: Record<string, string>;
  }): Record<string, string>;
  protectedPnpmArguments(command: string, args?: string[]): string[];
  verifyAuthenticatedNodeExecutable(options: {
    executablePath: string;
    expectedPath: string;
    expectedVersion: string;
    actualVersion: string;
    expectedSha256: string;
  }): void;
  verifyAuthenticatedCorepackEntrypoint(options: {
    nodeExecutablePath: string;
    corepackPath: string;
  }): {
    corepackPath: string;
  };
  resolveAuthenticatedReleaseRuntime(options: {
    env: Record<string, string | undefined>;
    actualExecutablePath: string;
    actualVersion: string;
  }): {
    nodePath: string;
    corepackPath: string;
  };
  verifyAuthenticatedNpmCliTree(options: {
    root: string;
    version: string;
  }): {
    cliPath: string;
    treeSha256: string;
  };
  verifyAuthenticatedNpmTarball(bytes: Buffer): {
    integrity: string;
  };
  assertNoReleaseRuntimeShadows(root: string): void;
}

function runtimeIntegrity(): RuntimeIntegrityModule {
  expect(runtimeIntegrityModule).not.toBeNull();
  if (runtimeIntegrityModule === null) {
    throw new Error('release runtime integrity module is missing');
  }
  return runtimeIntegrityModule;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('release runtime integrity', () => {
  test('rejects a fake Node executable even when it self-reports the pinned version', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-fake-node-'));
    fixtures.push(root);
    const fakeNode = resolve(root, 'node');
    writeFileSync(fakeNode, '#!/bin/sh\necho v24.18.1\n', { mode: 0o755 });

    expect(() =>
      runtimeIntegrity().verifyAuthenticatedNodeExecutable({
        executablePath: fakeNode,
        expectedPath: fakeNode,
        expectedVersion: 'v24.18.1',
        actualVersion: 'v24.18.1',
        expectedSha256:
          'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a',
      }),
    ).toThrow(/authenticated Node executable digest/u);
  });

  test('drops PATH, GitHub command files, Node hooks, shell init, and package-manager config', () => {
    const environment = runtimeIntegrity().createSterileReleaseEnvironment({
      authenticatedNodePath: '/opt/hostedtoolcache/node/24.18.1/x64/bin/node',
      home: '/tmp/release-home',
      temporary: '/tmp/release-tmp',
      corepackHome: '/tmp/release-corepack',
      source: {
        PATH: '/tmp/fake-bin',
        GITHUB_PATH: '/tmp/github-path',
        GITHUB_ENV: '/tmp/github-env',
        NODE_OPTIONS: '--require=/tmp/steal.cjs',
        NODE_PATH: '/tmp/node-path',
        BASH_ENV: '/tmp/bash-env',
        ENV: '/tmp/sh-env',
        NPM_CONFIG_USERCONFIG: '/tmp/attacker.npmrc',
        npm_config_registry: 'https://capture.example.invalid/',
        PNPM_HOME: '/tmp/fake-pnpm',
      },
      include: {
        CI: 'true',
      },
    });

    expect(environment).toEqual({
      PATH: '/opt/hostedtoolcache/node/24.18.1/x64/bin:/usr/bin:/bin',
      HOME: '/tmp/release-home',
      TMPDIR: '/tmp/release-tmp',
      COREPACK_HOME: '/tmp/release-corepack',
      CI: 'true',
    });
  });

  test('disables repository pnpm hooks for every protected pnpm command', () => {
    expect(
      runtimeIntegrity().protectedPnpmArguments('install', [
        '--frozen-lockfile',
        '--ignore-scripts',
      ]),
    ).toEqual([
      'pnpm@10.34.0',
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--ignore-pnpmfile',
      '--config.global-pnpmfile=/dev/null',
    ]);
    expect(
      runtimeIntegrity().protectedPnpmArguments('pack', [
        '--ignore-scripts',
      ]),
    ).toContain('--config.pnpmfile=/dev/null');
  });

  test('reproduces a pnpmfile hook and proves the protected install suppresses it', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-pnpm-hook-'));
    fixtures.push(root);
    writeFileSync(
      resolve(root, 'package.json'),
      '{"name":"pnpm-hook-repro","version":"1.0.0","private":true}\n',
    );
    writeFileSync(
      resolve(root, '.pnpmfile.cjs'),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'fs.writeFileSync(path.join(__dirname, "hook-ran"), "yes");',
        'module.exports = { hooks: { readPackage(pkg) { return pkg; } } };',
        '',
      ].join('\n'),
    );
    execFileSync(
      'corepack',
      [
        'pnpm@10.34.0',
        'install',
        '--lockfile=false',
        '--ignore-scripts',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    expect(existsSync(resolve(root, 'hook-ran'))).toBe(true);
    rmSync(resolve(root, 'hook-ran'));

    execFileSync(
      'corepack',
      runtimeIntegrity().protectedPnpmArguments('install', [
        '--lockfile=false',
        '--ignore-scripts',
      ]),
      { cwd: root, stdio: 'ignore' },
    );
    expect(existsSync(resolve(root, 'hook-ran'))).toBe(false);
  });

  test('rejects a self-spoofing npm CLI tree with the expected package version', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-fake-npm-'));
    fixtures.push(root);
    mkdirSync(resolve(root, 'bin'), { recursive: true });
    writeFileSync(
      resolve(root, 'package.json'),
      `${JSON.stringify({
        name: 'npm',
        version: '11.5.1',
        bin: {
          npm: 'bin/npm-cli.js',
          npx: 'bin/npx-cli.js',
        },
      }, null, 2)}\n`,
    );
    writeFileSync(
      resolve(root, 'bin/npm-cli.js'),
      '#!/usr/bin/env node\nconsole.log("11.5.1");\n',
      { mode: 0o755 },
    );
    writeFileSync(
      resolve(root, 'bin/npx-cli.js'),
      '#!/usr/bin/env node\n',
      { mode: 0o755 },
    );

    expect(() =>
      runtimeIntegrity().verifyAuthenticatedNpmCliTree({
        root,
        version: '11.5.1',
      }),
    ).toThrow(/authenticated npm CLI tree digest/u);
  });

  test('rejects npm tarball bytes that do not match the pinned registry integrity', () => {
    expect(() =>
      runtimeIntegrity().verifyAuthenticatedNpmTarball(
        Buffer.from('self-spoofing npm tarball'),
      ),
    ).toThrow(/authenticated npm tarball integrity/u);
  });

  test('rejects a substituted Corepack entrypoint beside an authenticated Node path', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-fake-corepack-'));
    fixtures.push(root);
    const bin = resolve(root, 'bin');
    const lib = resolve(root, 'lib/node_modules/corepack/dist');
    mkdirSync(bin, { recursive: true });
    mkdirSync(lib, { recursive: true });
    const nodePath = resolve(bin, 'node');
    const corepackPath = resolve(lib, 'corepack.js');
    writeFileSync(nodePath, 'node bytes\n', { mode: 0o755 });
    writeFileSync(corepackPath, 'console.log("fake corepack");\n', {
      mode: 0o755,
    });

    expect(() =>
      runtimeIntegrity().verifyAuthenticatedCorepackEntrypoint({
        nodeExecutablePath: nodePath,
        corepackPath,
      }),
    ).toThrow(/authenticated Corepack entrypoint digest/u);
  });

  test('rejects PATH-selected Node even when the protected path variable is spoofed', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-path-node-'));
    fixtures.push(root);
    const expectedNode = resolve(
      root,
      'node/24.18.1/x64/bin/node',
    );
    mkdirSync(resolve(expectedNode, '..'), { recursive: true });
    writeFileSync(expectedNode, '#!/bin/sh\necho v24.18.1\n', {
      mode: 0o755,
    });

    expect(() =>
      runtimeIntegrity().resolveAuthenticatedReleaseRuntime({
        env: {
          RUNNER_OS: 'Linux',
          RUNNER_ARCH: 'X64',
          RUNNER_TOOL_CACHE: root,
          OPENCOVEN_AUTHENTICATED_NODE_PATH: expectedNode,
          PATH: `${root}/fake:/usr/bin:/bin`,
        },
        actualExecutablePath: expectedNode,
        actualVersion: 'v24.18.1',
      }),
    ).toThrow(/Protected release runtime path|authenticated Node executable digest/u);
  });

  test('rejects package-manager bin shims that can shadow the authenticated runtime', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-runtime-shadow-'));
    fixtures.push(root);
    const bin = resolve(root, 'packages/core/node_modules/.bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(resolve(bin, 'node'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });

    expect(() =>
      runtimeIntegrity().assertNoReleaseRuntimeShadows(root),
    ).toThrow(/must not shadow authenticated node/u);
  });
});
