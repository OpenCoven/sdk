import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_PACKAGES,
  assertCanonicalRepository,
  readPackedPackageManifest,
} from './repository-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = resolve(root, '.artifacts', 'verify-package');
const tarballRoot = resolve(artifactRoot, 'tarballs');
const fixtureRoot = resolve(artifactRoot, 'packed-consumer');
const exampleRoot = resolve(artifactRoot, 'examples');

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

function runPnpm(args, cwd) {
  run('corepack', ['pnpm@10.34.0', ...args], cwd);
}

function isolatedInstallArgs() {
  return [
    '--ignore-workspace',
    '--config.inject-workspace-packages=false',
    '--config.link-workspace-packages=false',
    '--config.prefer-workspace-packages=false',
    'install',
    '--offline',
    '--ignore-scripts',
  ];
}

function findTarball(directory) {
  const tarballs = readdirSync(directory).filter((entry) => entry.endsWith('.tgz'));

  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball in ${directory}, found ${tarballs.length}.`);
  }

  return resolve(directory, tarballs[0]);
}

function tarballSpecifier(tarballs, workspaceDirectory) {
  return `file:${tarballs[workspaceDirectory]}`;
}

function publicPackageOverrides(tarballs) {
  return Object.fromEntries(
    PUBLIC_PACKAGES.map(({ packageName, workspaceDirectory }) => [
      packageName,
      tarballSpecifier(tarballs, workspaceDirectory),
    ]),
  );
}

function createToolingDevDependencies(existing = {}) {
  return {
    ...existing,
    '@types/node': '24.13.3',
    typescript: '6.0.3',
  };
}

function rewriteConsumerManifest(manifestPath, tarballs) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const overrides = publicPackageOverrides(tarballs);

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = manifest[field];

    if (!section || typeof section !== 'object') {
      continue;
    }

    for (const packageName of Object.keys(section)) {
      if (packageName in overrides) {
        section[packageName] = overrides[packageName];
      }
    }
  }

  manifest.devDependencies = createToolingDevDependencies(manifest.devDependencies);
  manifest.pnpm = {
    ...(manifest.pnpm ?? {}),
    overrides: {
      ...(manifest.pnpm?.overrides ?? {}),
      ...overrides,
    },
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function createFixture(tarballs) {
  const overrides = publicPackageOverrides(tarballs);

  mkdirSync(resolve(fixtureRoot, 'src'), { recursive: true });
  writeFileSync(
    resolve(fixtureRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-opencoven-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@opencoven/sdk-core': tarballSpecifier(tarballs, 'core'),
          '@opencoven/cave-client': tarballSpecifier(tarballs, 'cave'),
          '@opencoven/coven-client': tarballSpecifier(tarballs, 'coven'),
          '@opencoven/sdk': tarballSpecifier(tarballs, 'sdk'),
          '@opencoven/dev-cli': tarballSpecifier(tarballs, 'cli'),
        },
        pnpm: {
          overrides,
        },
        devDependencies: {
          '@types/node': '24.13.3',
          typescript: '6.0.3',
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2024',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'src', 'index.ts'),
    `import { CaveClient } from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import { formatCliOutput } from '@opencoven/dev-cli';
import { createMemorySecretStore } from '@opencoven/sdk-core';
import { createOpenCovenSdk } from '@opencoven/sdk';

const eventCursor: string = 'sequence';
const cave = new CaveClient({
  transport: {
    health: async () => ({ data: { status: 'ok' } }),
  },
});
const coven = new CovenClient({
  transport: {
    health: async () => ({
      ok: true,
      apiVersion: COVEN_DAEMON_PROTOCOL,
      covenVersion: '0.1.0',
      capabilities: {
        sessions: true,
        events: true,
        eventCursor,
        structuredErrors: true,
      },
    }),
  },
});
const sdk = createOpenCovenSdk({ cave, coven });
const store = createMemorySecretStore();

await store.set('token', 'in-memory');
void sdk;
void formatCliOutput;
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'verify.mjs'),
    `await import('@opencoven/sdk-core');
await import('@opencoven/cave-client');
await import('@opencoven/coven-client');
await import('@opencoven/sdk');
await import('@opencoven/dev-cli');

try {
  await import('@opencoven/sdk-core/src/errors.js');
  throw new Error('Deep import unexpectedly succeeded.');
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
    process.exit(0);
  }

  throw error;
}
`,
  );
}

function createPackedExamples(tarballs) {
  mkdirSync(exampleRoot, { recursive: true });
  writeFileSync(resolve(artifactRoot, 'tsconfig.base.json'), readFileSync(resolve(root, 'tsconfig.base.json')));

  for (const workspaceDirectory of ['cave-health', 'coven-health', 'unified-health']) {
    const sourceDirectory = resolve(root, 'examples', workspaceDirectory);
    const destinationDirectory = resolve(exampleRoot, workspaceDirectory);

    cpSync(sourceDirectory, destinationDirectory, { recursive: true });
    rewriteConsumerManifest(resolve(destinationDirectory, 'package.json'), tarballs);
  }
}

function assertPackedPackagesExcludeSources(installRoot) {
  for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
    const installedDirectory = resolve(
      installRoot,
      'node_modules',
      '@opencoven',
      packageName.split('/')[1],
    );
    const manifestPath = resolve(installedDirectory, 'package.json');

    if (!existsSync(manifestPath)) {
      continue;
    }

    assertCanonicalRepository(
      JSON.parse(readFileSync(manifestPath, 'utf8')),
      repositoryDirectory,
      `${packageName} installed manifest`,
    );

    if (existsSync(resolve(installedDirectory, 'src'))) {
      throw new Error(`Packed ${workspaceDirectory} package unexpectedly contains source files.`);
    }
  }
}

try {
  rmSync(artifactRoot, { force: true, recursive: true });
  mkdirSync(tarballRoot, { recursive: true });

  runPnpm(['--recursive', '--filter', './packages/*', 'build'], root);

  const tarballs = {};
  for (const { packageName, repositoryDirectory, workspaceDirectory } of PUBLIC_PACKAGES) {
    const destination = resolve(tarballRoot, workspaceDirectory);
    mkdirSync(destination, { recursive: true });
    runPnpm(['pack', '--pack-destination', destination], resolve(root, 'packages', workspaceDirectory));
    tarballs[workspaceDirectory] = findTarball(destination);
    assertCanonicalRepository(
      readPackedPackageManifest(tarballs[workspaceDirectory]),
      repositoryDirectory,
      `${packageName} packed manifest`,
    );
  }

  createFixture(tarballs);
  createPackedExamples(tarballs);
  runPnpm(isolatedInstallArgs(), fixtureRoot);
  runPnpm(['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'], fixtureRoot);
  assertPackedPackagesExcludeSources(fixtureRoot);

  for (const workspaceDirectory of ['cave-health', 'coven-health', 'unified-health']) {
    const destinationDirectory = resolve(exampleRoot, workspaceDirectory);
    runPnpm(isolatedInstallArgs(), destinationDirectory);
    runPnpm(['--ignore-workspace', 'run', 'build'], destinationDirectory);
    assertPackedPackagesExcludeSources(destinationDirectory);
  }

  run(process.execPath, ['verify.mjs'], fixtureRoot);
  run(resolve(fixtureRoot, 'node_modules', '.bin', 'opencoven'), ['--json', '--help'], fixtureRoot);
  process.stdout.write('Packed package verification passed.\n');
} finally {
  rmSync(artifactRoot, { force: true, recursive: true });
}
