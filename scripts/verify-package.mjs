import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanupOwnedTempRoot, createOwnedTempDirectory } from './owned-temp-directory.mjs';
import {
  assertPackedPackagesExcludeSources,
  createPublicPackageOverrides,
  installIsolatedOfflineAfterWarming,
  packPublicPackages,
  run,
  runPnpm,
  tarballSpecifier,
} from './package-artifacts.mjs';
import { PUBLIC_PACKAGES } from './repository-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function createToolingDevDependencies(existing = {}) {
  return {
    ...existing,
    '@types/node': '24.13.3',
    typescript: '6.0.3',
  };
}

function rewriteConsumerManifest(manifestPath, tarballs) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const overrides = createPublicPackageOverrides(tarballs);

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

function createFixture(fixtureRoot, tarballs) {
  const overrides = createPublicPackageOverrides(tarballs);

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

function createPackedExamples({ artifactRoot, exampleRoot, tarballs }) {
  mkdirSync(exampleRoot, { recursive: true });
  writeFileSync(resolve(artifactRoot, 'tsconfig.base.json'), readFileSync(resolve(root, 'tsconfig.base.json')));

  for (const workspaceDirectory of ['cave-health', 'coven-health', 'unified-health']) {
    const sourceDirectory = resolve(root, 'examples', workspaceDirectory);
    const destinationDirectory = resolve(exampleRoot, workspaceDirectory);

    mkdirSync(destinationDirectory, { recursive: true });
    cpSync(resolve(sourceDirectory, 'package.json'), resolve(destinationDirectory, 'package.json'));
    cpSync(resolve(sourceDirectory, 'tsconfig.json'), resolve(destinationDirectory, 'tsconfig.json'));
    cpSync(resolve(sourceDirectory, 'src'), resolve(destinationDirectory, 'src'), {
      recursive: true,
    });
    rewriteConsumerManifest(resolve(destinationDirectory, 'package.json'), tarballs);
  }
}

function assertConsumerDependencyIsolation(consumerRoot) {
  const manifestPath = resolve(consumerRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const declaredDependencies = new Set(
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap(
      (field) => Object.keys(manifest[field] ?? {}),
    ),
  );
  const expectations = PUBLIC_PACKAGES.map(({ packageName }) => [
    packageName,
    declaredDependencies.has(packageName),
  ]);

  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const expectations = ${JSON.stringify(expectations)};
for (const [packageName, isDeclared] of expectations) {
  let isResolvable = false;

  try {
    import.meta.resolve(packageName);
    isResolvable = true;
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ERR_MODULE_NOT_FOUND') {
      throw error;
    }
  }

  if (isResolvable !== isDeclared) {
    const expectation = isDeclared ? 'resolve' : 'remain unavailable';
    throw new Error(packageName + ' must ' + expectation + ' from ' + process.cwd() + '.');
  }
}
`,
    ],
    consumerRoot,
  );
}

let artifactContext;

try {
  artifactContext = createOwnedTempDirectory({
    prefix: 'opencoven-sdk-verify-package',
  });

  const artifactRoot = artifactContext.rootPath;
  const tarballRoot = resolve(artifactRoot, 'tarballs');
  const fixtureRoot = resolve(artifactRoot, 'packed-consumer');
  const exampleRoot = resolve(artifactRoot, 'examples');
  mkdirSync(tarballRoot, { recursive: true });

  const tarballs = packPublicPackages({
    root,
    destinationRoot: tarballRoot,
  });

  createFixture(fixtureRoot, tarballs);
  createPackedExamples({
    artifactRoot,
    exampleRoot,
    tarballs,
  });
  installIsolatedOfflineAfterWarming(fixtureRoot);
  assertConsumerDependencyIsolation(fixtureRoot);
  runPnpm(['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'], fixtureRoot);
  assertPackedPackagesExcludeSources(fixtureRoot);

  for (const workspaceDirectory of ['cave-health', 'coven-health', 'unified-health']) {
    const destinationDirectory = resolve(exampleRoot, workspaceDirectory);
    installIsolatedOfflineAfterWarming(destinationDirectory);
    assertConsumerDependencyIsolation(destinationDirectory);
    runPnpm(['--ignore-workspace', 'run', 'build'], destinationDirectory);
    assertPackedPackagesExcludeSources(destinationDirectory);
  }

  run(process.execPath, ['verify.mjs'], fixtureRoot);
  run(resolve(fixtureRoot, 'node_modules', '.bin', 'opencoven'), ['--json', '--help'], fixtureRoot);
  process.stdout.write('Packed package verification passed.\n');
} finally {
  if (artifactContext !== undefined) {
    cleanupOwnedTempRoot(artifactContext);
  }
}
