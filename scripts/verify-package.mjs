import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { cleanupOwnedTempRoot, createOwnedTempDirectory } from './owned-temp-directory.mjs';
import {
  createConformanceArtifacts,
  verifyConformanceArtifacts,
} from './create-release-artifacts.mjs';
import {
  assertApiBaseline,
  isJsonOrderEqual,
  readApiBaseline,
  readPackedApiSurfaces,
} from './api-baselines.mjs';
import {
  assertPackedPackagesExcludeSources,
  createPublicPackageOverrides,
  installIsolatedConsumersOfflineAfterWarming,
  packPublicPackages,
  run,
  runPnpm,
  tarballSpecifier,
} from './package-artifacts.mjs';
import {
  PUBLIC_PACKAGES,
  assertApprovedPackageLicense,
} from './repository-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleWorkspaces = [
  'cave-discovery',
  'cave-health',
  'cave-managed-native',
  'coven-health',
  'unified-health',
];
const installedPackageNames = {
  core: 'sdk-core',
  cave: 'cave-client',
  coven: 'coven-client',
  sdk: 'sdk',
};
const rootPackageExports = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  },
  './package.json': './package.json',
};

function expectedPackageExports(workspaceDirectory) {
  const root = rootPackageExports['.'];
  if (workspaceDirectory === 'core') {
    return {
      '.': root,
      './browser': {
        types: './dist/browser.d.ts',
        import: './dist/browser.js',
        default: './dist/browser.js',
      },
      './package.json': './package.json',
    };
  }
  if (workspaceDirectory === 'cave') {
    return {
      '.': root,
      './managed': {
        types: './dist/managed.d.ts',
        import: './dist/managed.js',
        default: './dist/managed.js',
      },
      './package.json': './package.json',
    };
  }
  return rootPackageExports;
}

function readTarballFile(tarball, path) {
  return execFileSync('tar', ['-xOf', tarball, `package/${path}`], {
    encoding: 'utf8',
  });
}

function assertPackedLicenses(tarballs) {
  for (const { packageName, workspaceDirectory } of PUBLIC_PACKAGES) {
    const manifest = JSON.parse(readTarballFile(tarballs[workspaceDirectory], 'package.json'));
    const selector = readTarballFile(tarballs[workspaceDirectory], 'LICENSE');
    const agpl = readTarballFile(tarballs[workspaceDirectory], 'LICENSE-AGPL');
    const mit = readTarballFile(tarballs[workspaceDirectory], 'LICENSE-MIT');

    assertApprovedPackageLicense(
      manifest.license,
      selector,
      `Packed ${packageName} package`,
    );

    if (
      manifest.name !== packageName ||
      !selector.includes('OpenCoven SDK') ||
      selector.includes('coven-cave') ||
      !agpl.includes('GNU AFFERO GENERAL PUBLIC LICENSE') ||
      !mit.startsWith('MIT License\n')
    ) {
      throw new Error(
        `Packed ${workspaceDirectory} package has inaccurate license metadata or text.`,
      );
    }
  }
}

function assertPackedChangelogs(tarballs) {
  for (const { packageName, workspaceDirectory } of PUBLIC_PACKAGES) {
    const manifest = JSON.parse(readTarballFile(tarballs[workspaceDirectory], 'package.json'));
    const changelog = readTarballFile(tarballs[workspaceDirectory], 'CHANGELOG.md');

    if (!changelog.includes(`## ${manifest.version}`)) {
      throw new Error(
        `Packed ${packageName} package changelog does not contain version ${manifest.version}.`,
      );
    }
  }
}

function expectedPackedDependencies(workspaceDirectory, version) {
  switch (workspaceDirectory) {
    case 'core':
      return {};
    case 'cave':
      return {
        '@hpke/core': '1.9.0',
        '@hpke/dhkem-x25519': '1.8.0',
        '@opencoven/sdk-core': version,
        canonicalize: '4.0.0',
      };
    case 'coven':
      return {
        '@opencoven/sdk-core': version,
      };
    case 'sdk':
      return {
        '@opencoven/cave-client': version,
        '@opencoven/coven-client': version,
        '@opencoven/sdk-core': version,
      };
    default:
      throw new Error(`Unexpected workspace package ${workspaceDirectory}.`);
  }
}

function assertPackedPackageContracts(tarballs) {
  for (const { packageName, workspaceDirectory } of PUBLIC_PACKAGES) {
    const manifest = JSON.parse(readTarballFile(tarballs[workspaceDirectory], 'package.json'));
    const expectedDependencies = expectedPackedDependencies(workspaceDirectory, manifest.version);

    if (
      manifest.main !== './dist/index.js' ||
      manifest.types !== './dist/index.d.ts' ||
      !isJsonOrderEqual(manifest.exports, expectedPackageExports(workspaceDirectory))
    ) {
      throw new Error(
        `Packed ${packageName} package must ship only the reviewed root export map.`,
      );
    }

    if (!isDeepStrictEqual(manifest.dependencies ?? {}, expectedDependencies)) {
      throw new Error(
        `Packed ${packageName} package direct dependencies drifted from the reviewed contract.`,
      );
    }
  }
}

function assertPackedContractFixtures(tarballs) {
  for (const path of [
    'fixtures/contract-fixture.json',
    'fixtures/contract-fixture.sha256',
    'fixtures/contract-fixture.provenance.json',
  ]) {
    const packed = readTarballFile(tarballs.cave, path);
    const source = readFileSync(resolve(root, 'packages/cave', path), 'utf8');
    if (packed !== source) {
      throw new Error(`Packed @opencoven/cave-client ${path} differs from source.`);
    }
  }
}

async function assertPackedApiBaselines(tarballs, artifactRoot) {
  const surfaces = await readPackedApiSurfaces({
    artifactRoot,
    packages: PUBLIC_PACKAGES,
    tarballs,
  });
  for (const { packageName, workspaceDirectory } of PUBLIC_PACKAGES) {
    const surface = surfaces[workspaceDirectory];
    if (surface === undefined) {
      throw new Error(`Packed API surface was missing for ${packageName}.`);
    }
    assertApiBaseline(
      readApiBaseline(root, workspaceDirectory),
      surface,
    );
  }
}

function assertInstalledPackageDirectoryMap() {
  for (const { packageName, workspaceDirectory } of PUBLIC_PACKAGES) {
    if (installedPackageNames[workspaceDirectory] !== packageName.split('/')[1]) {
      throw new Error(`Installed package directory mapping is incomplete for ${packageName}.`);
    }
  }
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
    `import {
  CaveClient,
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveProject,
} from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import {
  createFileOpenCovenProfileStore,
  createManagedMemorySecretStore,
  createMemoryOpenCovenProfileStore,
  createMemorySecretStore,
  createOpenCovenDiagnosticReport,
  createOpenCovenProfileSecretReference,
  type BoundedPageOptions,
  type FileOpenCovenProfileStoreOptions,
  type OpenCovenDiagnosticReport,
  type OpenCovenProfile,
  type OperationContext,
  type OperationEvent,
} from '@opencoven/sdk-core';
import { createOpenCovenSdk } from '@opencoven/sdk';

const eventCursor: string = 'sequence';
const events: OperationEvent[] = [];
const observer = {
  onEvent(event: OperationEvent) {
    events.push(event);
  },
  onObserverError(error: unknown) {
    throw error;
  },
};
const cave = new CaveClient({
  operation: {
    timeoutMs: 1_000,
    observer,
  },
  transport: {
    health: async (context?: OperationContext) => {
      void context?.signal;
      void context?.deadline;
      return {
        apiVersion: '1.0',
        capabilities: ['health'],
        minimumClientVersion: '0.1.0',
        operations: ['health.read'],
        data: {
          instanceId: 'packed-consumer-cave',
          pairingRequired: true,
          releaseVersion: '0.3.9',
        },
      };
    },
  },
});
const coven = new CovenClient({
  transport: {
    health: async (context?: OperationContext) => {
      void context?.signal;
      void context?.deadline;
      return {
        ok: true,
        apiVersion: COVEN_DAEMON_PROTOCOL,
        covenVersion: '0.1.0',
        capabilities: {
          sessions: true,
          events: true,
          eventCursor,
          structuredErrors: true,
        },
      };
    },
  },
});
const sdk = createOpenCovenSdk({ cave, coven });
const store = createMemorySecretStore();
const managedStore = createManagedMemorySecretStore();
const profile: OpenCovenProfile = {
  version: 1,
  name: 'packed-consumer',
  defaultProjectId: 'project-1',
};
const profileStore = createMemoryOpenCovenProfileStore();
const profileFileOptions: FileOpenCovenProfileStoreOptions = {
  path: '/not-called/profiles.json',
};
const diagnostics: OpenCovenDiagnosticReport =
  createOpenCovenDiagnosticReport({
    generatedAt: '2026-08-25T06:50:00.000Z',
    packageVersion: '0.1.0',
    runtime: {
      name: 'node',
      version: 'v24.18.1',
      platform: 'linux',
      architecture: 'x64',
    },
    checks: [{ id: 'cave.discovery', status: 'ok' }],
  });
const controller = new AbortController();
const boundedPageOptions: BoundedPageOptions = { maxPages: 1 };
const caveIterators: [
  AsyncGenerator<CaveCanonicalFamiliar>,
  AsyncGenerator<CaveProject>,
  AsyncGenerator<CaveConversation>,
  AsyncGenerator<CaveConversationMessage>,
] = [
  cave.iterateFamiliars(boundedPageOptions),
  cave.iterateProjects(boundedPageOptions),
  cave.iterateConversations(boundedPageOptions),
  cave.iterateConversationMessages('conversation-1', boundedPageOptions),
];

await store.set('token', 'in-memory');
await managedStore.set('token', 'managed');
await managedStore.clear();
await managedStore.dispose();
await profileStore.set(profile);
await profileStore.get(profile.name);
createOpenCovenProfileSecretReference(profile.name);
void createFileOpenCovenProfileStore;
void profileFileOptions;
void diagnostics;
await cave.health({
  signal: controller.signal,
  timeoutMs: 500,
  observer,
});
await sdk.healthReport({
  signal: controller.signal,
  timeoutMs: 1_000,
  cave: { timeoutMs: 500 },
  coven: { timeoutMs: 500 },
  observer,
});
void events;
void caveIterators;
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'verify.mjs'),
    `const core = await import('@opencoven/sdk-core');
const { CaveClient } = await import('@opencoven/cave-client');
await import('@opencoven/coven-client');
await import('@opencoven/sdk');

for (const coreExport of [
  'createOpenCovenDiagnosticReport',
  'createFileOpenCovenProfileStore',
  'createMemoryOpenCovenProfileStore',
  'createOpenCovenProfileSecretReference',
  'migrateOpenCovenProfileDocument',
  'parseOpenCovenProfile',
]) {
  if (typeof core[coreExport] !== 'function') {
    throw new Error(\`Packed core export \${coreExport} is unavailable.\`);
  }
}

const iteratorClient = new CaveClient({
  transport: {
    health: () => Promise.reject(new Error('Packed iterator transport must remain inert.')),
  },
});
const caveIterators = [
  iteratorClient.iterateFamiliars({ maxPages: 1 }),
  iteratorClient.iterateProjects({ maxPages: 1 }),
  iteratorClient.iterateConversations({ maxPages: 1 }),
  iteratorClient.iterateConversationMessages('conversation-1', { maxPages: 1 }),
];
if (
  caveIterators.some(
    (iterator) =>
      typeof iterator.next !== 'function' ||
      typeof iterator.return !== 'function' ||
      typeof iterator.throw !== 'function',
  )
) {
  throw new Error('Packed Cave iterator methods are unavailable.');
}

const startedAt = Date.now();
let watchdog;
try {
  await Promise.race([
    new CaveClient({
      transport: {
        health: () => new Promise(() => {}),
      },
    }).health({ timeoutMs: 25 }),
    new Promise((_, reject) => {
      watchdog = setTimeout(() => {
        reject(new Error('Packed timeout canary exceeded its watchdog.'));
      }, 1_000);
    }),
  ]);
  throw new Error('Never-settling packed transport unexpectedly resolved.');
} catch (error) {
  if (!error || typeof error !== 'object' || error.normalized?.code !== 'timeout') {
    throw error;
  }
  if (Date.now() - startedAt > 1_000) {
    throw new Error('Packed timeout canary did not reject promptly.');
  }
} finally {
  clearTimeout(watchdog);
}
console.log('Packed timeout canary passed.');

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

function createManagedBrowserFixture(fixtureRoot, tarballs) {
  const caveTarball = tarballSpecifier(tarballs, 'cave');
  const overrides = createPublicPackageOverrides(tarballs);

  mkdirSync(resolve(fixtureRoot, 'src'), { recursive: true });
  writeFileSync(
    resolve(fixtureRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'packed-opencoven-managed-browser-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@opencoven/cave-client': caveTarball,
        },
        pnpm: {
          overrides,
        },
        devDependencies: {
          esbuild: '0.28.1',
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
          types: [],
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
    `import {
  createManagedCaveClient,
  type CaveManagedCredentialTransport,
} from '@opencoven/cave-client/managed';

const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const transport: CaveManagedCredentialTransport = {
  health: async () => ({
    apiVersion: '1.0',
    capabilities: ['health'],
    minimumClientVersion: '0.1.0',
    operations: ['health.read'],
    data: {
      instanceId: 'packed-browser-cave',
      pairingRequired: true,
      releaseVersion: '0.3.9',
    },
  }),
  managedPairingCreate: async () => ({ requestId, expiresAt: 1_755_731_112_617 }),
  managedPairingPoll: async () => ({
    id: requestId,
    status: 'approved',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingExchange: async () => ({
    credential: {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'Packed browser',
      installationId: 'packed-browser',
      scopes: ['chat:read'],
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    },
  }),
  managedCredentialStatus: async () => ({
    status: 'missing',
  }),
  managedForgetCredential: async () => ({ status: 'missing' }),
};

void createManagedCaveClient({ transport });
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'verify.mjs'),
    `import { inspect } from 'node:util';

const { createManagedCaveClient } = await import('@opencoven/cave-client/managed');
const secret = 'packed-managed-browser-secret-canary';
const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const events = [];
let resolveExchange;
let exchangeCalls = 0;
const health = {
  apiVersion: '1.0',
  capabilities: ['health'],
  minimumClientVersion: '0.1.0',
  operations: ['health.read'],
  data: {
    instanceId: 'packed-browser-cave',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
};
const credential = {
  id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
  appName: 'Packed browser',
  installationId: 'packed-browser',
  scopes: ['chat:read'],
  createdAt: 1_755_730_812_617,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
};
const transport = {
  health: async () => health,
  managedPairingCreate: async () => ({ requestId, expiresAt: 1_755_731_112_617 }),
  managedPairingPoll: async (id) => ({
    id,
    status: 'approved',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingExchange: async () => {
    exchangeCalls += 1;
    return new Promise((resolve) => {
      resolveExchange = resolve;
    });
  },
  managedCredentialStatus: async () => ({
    status: 'valid',
    access: 'chat:read',
    health,
  }),
  managedForgetCredential: async () => ({ status: 'deleted' }),
  listFamiliars: async () => ({
    apiVersion: '1.0',
    capabilities: [
      'health',
      'pairing',
      'credentials',
      'familiars',
      'projects',
      'conversations',
      'conversation-messages',
      'cursors',
    ],
    minimumClientVersion: '0.1.0',
    operations: [
      'familiars.list',
      'projects.list',
      'conversations.list',
      'conversations.read',
      'messages.list',
    ],
    data: {
      familiars: [{ id: 'cedar', displayName: 'Cedar', role: 'guide' }],
    },
  }),
};
const client = createManagedCaveClient({
  transport,
  operation: {
    observer: {
      onEvent(event) {
        events.push(event);
      },
      onObserverError(error) {
        throw error;
      },
    },
  },
});
const session = await client.createPairing({
  appName: 'Packed browser',
  installationId: 'packed-browser',
  scopes: ['chat:read'],
});
if (JSON.stringify(session).includes(secret)) {
  throw new Error('Managed pairing session exposed the secret canary.');
}
await session.poll();
const controller = new AbortController();
const exchange = session.exchange({ signal: controller.signal }).catch((error) => error);
await new Promise((resolve) => setImmediate(resolve));
controller.abort(new Error(secret));
const aborted = await exchange;
if (!aborted || aborted.normalized?.code !== 'aborted') {
  throw new Error('Managed browser exchange did not preserve abort semantics.');
}
resolveExchange({ credential });
await new Promise((resolve) => setImmediate(resolve));
if (exchangeCalls !== 1) {
  throw new Error('Late managed browser exchange was replayed.');
}
const replay = await session.exchange().catch((error) => error);
if (!replay || replay.normalized?.code !== 'conflict') {
  throw new Error('Managed browser exchange replay was not rejected.');
}
const status = await client.credentialStatus();
const forgot = await client.forgetCredential();
const familiars = await client.listFamiliars();
const malformedClient = createManagedCaveClient({
  transport: {
    ...transport,
    managedPairingCreate: async () => ({
      requestId,
      expiresAt: 1_755_731_112_617,
      bearer: secret,
    }),
  },
});
const malformed = await malformedClient.createPairing({
  appName: 'Packed browser',
  installationId: 'packed-browser-malformed',
  scopes: ['chat:read'],
}).catch((error) => error);
const serialized = JSON.stringify({
  session,
  status,
  forgot,
  familiars,
  malformed,
  events,
  inspect: inspect(malformed),
  message: malformed?.message,
  normalized: malformed?.normalized,
});
if (
  serialized.includes(secret) ||
  malformed?.normalized?.code !== 'invalid_response' ||
  status.status !== 'valid' ||
  forgot !== true ||
  familiars.data[0]?.id !== 'cedar'
) {
  throw new Error('Managed browser packed lifecycle leaked a native secret or failed validation.');
}
console.log('Packed managed browser lifecycle passed.');
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'bundle.mjs'),
    `import { build } from 'esbuild';

await build({
  bundle: true,
  entryPoints: ['src/index.ts'],
  format: 'esm',
  outfile: 'bundle.mjs',
  platform: 'browser',
});
`,
  );
}

function createPackedExamples({ artifactRoot, exampleRoot, tarballs }) {
  mkdirSync(exampleRoot, { recursive: true });
  writeFileSync(resolve(artifactRoot, 'tsconfig.base.json'), readFileSync(resolve(root, 'tsconfig.base.json')));

  for (const workspaceDirectory of exampleWorkspaces) {
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
  const managedBrowserFixtureRoot = resolve(artifactRoot, 'packed-managed-browser-consumer');
  const exampleRoot = resolve(artifactRoot, 'examples');
  mkdirSync(tarballRoot, { recursive: true });

  const tarballs = packPublicPackages({
    root,
    destinationRoot: tarballRoot,
  });
  assertInstalledPackageDirectoryMap();
  assertPackedLicenses(tarballs);
  process.stdout.write('Packed license metadata verified.\n');
  assertPackedChangelogs(tarballs);
  process.stdout.write('Packed changelog metadata verified.\n');
  assertPackedPackageContracts(tarballs);
  process.stdout.write('Packed package manifest contracts verified.\n');
  assertPackedContractFixtures(tarballs);
  process.stdout.write('Packed Cave contract fixtures verified.\n');
  await assertPackedApiBaselines(
    tarballs,
    resolve(artifactRoot, 'api-baseline-runtime'),
  );
  process.stdout.write('Packed API baselines verified.\n');

  const conformanceArtifactRoot = resolve(
    artifactRoot,
    'conformance-artifacts',
  );
  createConformanceArtifacts({
    root,
    outputRoot: conformanceArtifactRoot,
    build: false,
    requireConformanceEvidence: false,
  });
  verifyConformanceArtifacts({
    root,
    artifactRoot: conformanceArtifactRoot,
    requireConformanceEvidence: false,
  });
  process.stdout.write('Conformance artifact manifest verified.\n');

  createFixture(fixtureRoot, tarballs);
  createManagedBrowserFixture(managedBrowserFixtureRoot, tarballs);
  createPackedExamples({
    artifactRoot,
    exampleRoot,
    tarballs,
  });
  const consumerRoots = [
    fixtureRoot,
    managedBrowserFixtureRoot,
    ...exampleWorkspaces.map((workspaceDirectory) =>
      resolve(exampleRoot, workspaceDirectory),
    ),
  ];
  await installIsolatedConsumersOfflineAfterWarming(consumerRoots);
  assertConsumerDependencyIsolation(fixtureRoot);
  runPnpm(['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'], fixtureRoot);
  assertPackedPackagesExcludeSources(fixtureRoot);
  assertConsumerDependencyIsolation(managedBrowserFixtureRoot);
  runPnpm(
    ['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'],
    managedBrowserFixtureRoot,
  );
  runPnpm(['--ignore-workspace', 'exec', 'node', 'bundle.mjs'], managedBrowserFixtureRoot);
  run(process.execPath, ['verify.mjs'], managedBrowserFixtureRoot);
  assertPackedPackagesExcludeSources(managedBrowserFixtureRoot);

  for (const workspaceDirectory of exampleWorkspaces) {
    const destinationDirectory = resolve(exampleRoot, workspaceDirectory);
    assertConsumerDependencyIsolation(destinationDirectory);
    runPnpm(['--ignore-workspace', 'run', 'build'], destinationDirectory);
    runPnpm(['--ignore-workspace', 'run', 'start'], destinationDirectory);
    assertPackedPackagesExcludeSources(destinationDirectory);
  }

  run(process.execPath, ['verify.mjs'], fixtureRoot);
  process.stdout.write('Packed package verification passed.\n');
} finally {
  if (artifactContext !== undefined) {
    cleanupOwnedTempRoot(artifactContext);
  }
}
