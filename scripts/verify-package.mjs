import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { cleanupOwnedTempRoot, createOwnedTempDirectory } from './owned-temp-directory.mjs';
import {
  createReleaseArtifacts,
  verifyReleaseArtifacts,
} from './create-release-artifacts.mjs';
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
  return {
    ...rootPackageExports,
    ...(workspaceDirectory === 'core'
      ? {
          './browser': {
            types: './dist/browser.d.ts',
            import: './dist/browser.js',
            default: './dist/browser.js',
          },
        }
      : {}),
    ...(workspaceDirectory === 'cave'
      ? {
          './managed': {
            types: './dist/managed.d.ts',
            import: './dist/managed.js',
            default: './dist/managed.js',
          },
        }
      : {}),
  };
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
      !isDeepStrictEqual(manifest.exports, expectedPackageExports(workspaceDirectory))
    ) {
      throw new Error(
        `Packed ${packageName} package must ship only its reviewed export map.`,
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
import {
  createManagedCaveClient,
  type CaveManagedCredentialTransport,
} from '@opencoven/cave-client/managed';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import {
  createManagedMemorySecretStore,
  createMemorySecretStore,
  type BoundedPageOptions,
  type OperationContext,
  type OperationEvent,
} from '@opencoven/sdk-core';
import { normalizePageOptions as normalizeBrowserPageOptions } from '@opencoven/sdk-core/browser';
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
const managedNativeTransport = {
  health: async (context?: OperationContext) => {
    void context?.signal;
    return {
      apiVersion: '1.0',
      capabilities: ['health'],
      minimumClientVersion: '0.1.0',
      operations: ['health.read'],
      data: {
        instanceId: 'packed-managed-native-cave',
        pairingRequired: true,
        releaseVersion: '0.3.9',
      },
    };
  },
  managedPairingCreate: async () => ({
    requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingPoll: async () => ({
    id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
    status: 'pending',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingExchange: async () => ({
    credential: {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'packed-managed-native',
      scopes: ['chat:read'],
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    },
  }),
  managedCredentialStatus: async () => ({ status: 'missing' }),
  managedForgetCredential: async () => ({ status: 'missing' }),
} satisfies CaveManagedCredentialTransport;
const managedNativeCave = createManagedCaveClient({
  transport: managedNativeTransport,
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
void managedNativeCave;
void normalizeBrowserPageOptions;
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'verify.mjs'),
    `await import('@opencoven/sdk-core');
await import('@opencoven/sdk-core/browser');
const { CaveClient } = await import('@opencoven/cave-client');
await import('@opencoven/cave-client/managed');
await import('@opencoven/coven-client');
await import('@opencoven/sdk');

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
          '@opencoven/cave-client': tarballSpecifier(tarballs, 'cave'),
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
          lib: ['ES2024', 'DOM'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          types: [],
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
  createManagedCaveClient,
  type CaveManagedCredentialTransport,
} from '@opencoven/cave-client/managed';

const transport = {
  health: async () => ({
    apiVersion: '1.0',
    minimumClientVersion: '0.1.0',
    capabilities: ['health'],
    operations: ['health.read'],
    data: {
      instanceId: 'packed-managed-browser-cave',
      pairingRequired: true,
      releaseVersion: '0.3.9',
    },
  }),
  managedPairingCreate: async () => ({
    requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingPoll: async () => ({
    id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
    status: 'pending',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingExchange: async () => ({
    credential: {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'packed-managed-browser',
      scopes: ['chat:read'],
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    },
  }),
  managedCredentialStatus: async () => ({ status: 'missing' }),
  managedForgetCredential: async () => ({ status: 'missing' }),
} satisfies CaveManagedCredentialTransport;

void createManagedCaveClient({ transport });
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'bundle.mjs'),
    `import { build } from 'esbuild';

const result = await build({
  bundle: true,
  entryPoints: ['src/index.ts'],
  format: 'esm',
  logLevel: 'silent',
  platform: 'browser',
  target: 'es2024',
  write: false,
});
const output = result.outputFiles.map(({ text }) => text).join('\\n');
if (
  /["']node:[^"']+["']/u.test(output) ||
  /\\bBuffer\\b/u.test(output) ||
  /\\bprocess\\s*\\.\\s*(?:env|cwd|platform|kill|get)/u.test(output)
) {
  throw new Error('Packed managed browser entry point includes a Node runtime dependency.');
}
`,
  );
  writeFileSync(
    resolve(fixtureRoot, 'verify.mjs'),
    `import { inspect } from 'node:util';

const { createManagedCaveClient } = await import('@opencoven/cave-client/managed');
const managedEntrypoint = import.meta.resolve('@opencoven/cave-client/managed');
if (
  !managedEntrypoint.includes('node_modules') ||
  managedEntrypoint.includes('/packages/cave/') ||
  managedEntrypoint.includes('/src/')
) {
  throw new Error('Packed managed entry point resolved outside its installed tarball.');
}

const PACKED_MANAGED_SECRET = 'PACKED_MANAGED_PAIRING_SECRET';
const PACKED_MANAGED_BEARER = 'PACKED_MANAGED_BEARER';
const canaries = [PACKED_MANAGED_SECRET, PACKED_MANAGED_BEARER];
const events = [];
const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
const credential = {
  id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
  appName: 'Packed Managed Cave',
  installationId: 'packed-managed-browser',
  scopes: ['chat:read'],
  createdAt: 1_755_730_812_617,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
};
const health = {
  apiVersion: '1.0',
  minimumClientVersion: '0.1.0',
  capabilities: ['health', 'familiars', 'cursors'],
  operations: ['health.read', 'familiars.list'],
  data: {
    instanceId: 'packed-managed-browser-cave',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
};
const canonicalFamiliars = {
  apiVersion: '1.0',
  minimumClientVersion: '0.1.0',
  capabilities: ['familiars', 'cursors'],
  operations: ['familiars.list'],
  data: {
    familiars: [{
      id: 'familiar-packed',
      displayName: 'Packed Familiar',
      role: 'verifier',
      nativeBearer: PACKED_MANAGED_BEARER,
    }],
  },
  nativeBearer: PACKED_MANAGED_BEARER,
};

function serialized(error) {
  return error instanceof Error
    ? JSON.stringify(error, Object.getOwnPropertyNames(error))
    : JSON.stringify(error);
}

function assertRedacted(value) {
  const text = [String(value), inspect(value), JSON.stringify(value), serialized(value)].join('\\n');
  if (canaries.some((canary) => text.includes(canary))) {
    throw new Error('Cave managed result leaked a native canary.');
  }
}

async function expectFailure(promise, code) {
  try {
    await promise;
  } catch (error) {
    if (error?.normalized?.code !== code) {
      throw error;
    }
    return error;
  }
  throw new Error('Packed managed operation unexpectedly succeeded.');
}

let exchangeCalls = 0;
let resolveLateExchange;
const transport = {
  health: async () => health,
  listFamiliars: async () => canonicalFamiliars,
  managedPairingCreate: async () => ({
    requestId,
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingPoll: async (id) => ({
    id,
    status: 'approved',
    expiresAt: 1_755_731_112_617,
  }),
  managedPairingExchange: async () => {
    exchangeCalls += 1;
    if (exchangeCalls === 1) {
      return { credential };
    }
    return await new Promise((resolve) => {
      resolveLateExchange = resolve;
    });
  },
  managedCredentialStatus: async () => ({
    status: 'valid',
    access: 'chat:read',
    health,
  }),
  managedForgetCredential: async () => ({ status: 'deleted' }),
};
const observer = {
  onEvent(event) {
    events.push(event);
  },
  onObserverError(error) {
    throw error;
  },
};
const client = createManagedCaveClient({
  transport,
  operation: { observer },
});

const healthy = await client.health();
const session = await client.createPairing({
  appName: 'Packed Managed Cave',
  installationId: 'packed-managed-browser',
  scopes: ['chat:read'],
});
const polled = await session.poll();
const exchanged = await session.exchange();
const status = await client.credentialStatus();
const forgotten = await client.forgetCredential();
const familiars = await client.listFamiliars();
if (
  healthy.instanceId !== health.data.instanceId ||
  polled.id !== requestId ||
  exchanged.id !== credential.id ||
  status.status !== 'valid' ||
  forgotten !== true ||
  familiars.data[0]?.id !== 'familiar-packed' ||
  'nativeBearer' in familiars ||
  'nativeBearer' in familiars.data[0]
) {
  throw new Error('Packed managed lifecycle did not validate its public DTOs.');
}

const lateSession = await client.createPairing({
  appName: 'Packed Managed Cave',
  installationId: 'packed-managed-browser-late',
  scopes: ['chat:read'],
});
const abortController = new AbortController();
const cancelled = lateSession.exchange({ signal: abortController.signal });
abortController.abort(new Error(PACKED_MANAGED_BEARER));
const cancellation = await expectFailure(cancelled, 'aborted');
if (typeof resolveLateExchange !== 'function') {
  throw new Error('Packed managed late exchange was not dispatched.');
}
resolveLateExchange({ credential });
await new Promise((resolve) => setTimeout(resolve, 0));
const replay = await expectFailure(lateSession.exchange(), 'conflict');
if (exchangeCalls !== 2) {
  throw new Error('Packed managed late completion triggered a duplicate exchange.');
}

const malformedClient = createManagedCaveClient({
  transport: {
    ...transport,
    managedPairingCreate: async () => ({
      requestId,
      expiresAt: 1_755_731_112_617,
      bearer: PACKED_MANAGED_BEARER,
    }),
  },
});
const malformed = await expectFailure(
  malformedClient.createPairing({
    appName: 'Packed Managed Cave',
    installationId: 'packed-managed-malformed',
    scopes: ['chat:read'],
  }),
  'invalid_response',
);
const hostileClient = createManagedCaveClient({
  transport: {
    ...transport,
    managedCredentialStatus: async () => {
      throw new Error(PACKED_MANAGED_BEARER);
    },
  },
});
const hostile = await expectFailure(hostileClient.credentialStatus(), 'invalid_response');
const hostileSnapshotClient = createManagedCaveClient({
  transport: {
    ...transport,
    managedPairingCreate: async () => new Proxy({}, {
      ownKeys() {
        throw new Error(PACKED_MANAGED_BEARER);
      },
    }),
  },
});
const hostileSnapshot = await expectFailure(
  hostileSnapshotClient.createPairing({
    appName: 'Packed Managed Cave',
    installationId: 'packed-managed-hostile-snapshot',
    scopes: ['chat:read'],
  }),
  'invalid_response',
);
const redactedSnapshot = structuredClone({
  cancellation,
  replay,
  malformed,
  hostile,
  hostileSnapshot,
  events,
});

assertRedacted({
  healthy,
  session,
  polled,
  exchanged,
  status,
  forgotten,
  familiars,
  cancellation,
  replay,
  malformed,
  hostile,
  hostileSnapshot,
  redactedSnapshot,
  events,
});
console.log('Packed managed lifecycle passed.');
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

  const releaseArtifactRoot = resolve(artifactRoot, 'release');
  createReleaseArtifacts({
    root,
    outputRoot: releaseArtifactRoot,
    build: false,
  });
  verifyReleaseArtifacts({
    root,
    artifactRoot: releaseArtifactRoot,
  });
  process.stdout.write('Release artifact manifest verified.\n');

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
  const managedBrowserManifest = JSON.parse(
    readFileSync(resolve(managedBrowserFixtureRoot, 'package.json'), 'utf8'),
  );
  const managedBrowserTsconfig = JSON.parse(
    readFileSync(resolve(managedBrowserFixtureRoot, 'tsconfig.json'), 'utf8'),
  );
  if (
    managedBrowserManifest.devDependencies?.['@types/node'] !== undefined ||
    !Array.isArray(managedBrowserTsconfig.compilerOptions?.types) ||
    managedBrowserTsconfig.compilerOptions.types.length !== 0
  ) {
    throw new Error('Packed managed browser consumer must typecheck without Node ambient types.');
  }
  runPnpm(
    ['--ignore-workspace', 'exec', 'tsc', '--pretty', 'false'],
    managedBrowserFixtureRoot,
  );
  run(process.execPath, ['verify.mjs'], managedBrowserFixtureRoot);
  run(process.execPath, ['bundle.mjs'], managedBrowserFixtureRoot);
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
