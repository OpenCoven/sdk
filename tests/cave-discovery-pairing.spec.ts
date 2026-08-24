import { chmod, lstat, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CaveClientError,
  createDiscoveredCaveClient,
  discoverCaveEndpoint,
} from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

const CAVE_CAPABILITIES = [
  'health',
  'pairing',
  'credentials',
  'familiars',
  'projects',
  'conversations',
  'conversation-messages',
  'cursors',
] as const;

const CAVE_OPERATIONS = [
  'health.read',
  'pairing.create',
  'pairing.poll',
  'pairing.exchange',
  'pairing.admin.list',
  'pairing.admin.decide',
  'credentials.admin.list',
  'credentials.admin.revoke',
  'familiars.list',
  'projects.list',
  'conversations.list',
  'conversations.read',
  'messages.list',
] as const;

const CURRENT_HEALTH_ENVELOPE = {
  apiVersion: '1.0',
  minimumClientVersion: '0.1.0',
  capabilities: [...CAVE_CAPABILITIES],
  operations: [...CAVE_OPERATIONS],
  data: {
    instanceId: '00000000-0000-4000-8000-000000000000',
    pairingRequired: true,
    releaseVersion: '0.3.9',
  },
} as const;

const DISCOVERED_FAMILIAR_WIRE = {
  id: 'cody',
  display_name: 'Cody',
  role: 'Implementation',
  pronouns: 'he/him',
  status: 'working',
  last_seen: '2026-08-24T02:15:00Z',
  active_sessions: 2,
  memory_freshness: 'fresh',
} as const;

const CANONICAL_FAMILIAR = {
  id: 'cody',
  displayName: 'Cody',
  role: 'Implementation',
} as const;

const CANONICAL_PROJECT = {
  id: 'project-1',
  name: 'OpenCoven Chat',
  root: '/workspace/chat',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const CANONICAL_CONVERSATION = {
  id: 'conversation/one?#',
  familiarId: 'cody',
  updatedAt: '2026-08-24T01:00:00.000Z',
} as const;

const CANONICAL_MESSAGE = {
  id: 'message-1',
  conversationId: CANONICAL_CONVERSATION.id,
  parentId: null,
  role: 'user',
  text: 'Read canonical state.',
  createdAt: '2026-08-24T00:30:00.000Z',
  attachmentCount: 0,
  toolCount: 0,
} as const;

const PAIRING_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BEARER = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const DISCOVERY_STARTED_AT = '2026-08-24T02:03:51.419Z';
const DISCOVERY_PID = 4_321;
const DISCOVERY_NONCE = '018f4f1a-77c2-7a31-8a15-55a25aaba003';
const DISCOVERY_FILE_NAME = 'client-v1-discovery.json';
const DISCOVERY_TEST_TIMEOUT_MS = 1_000;
const DEFAULT_DISCOVERY_ENDPOINT = 'http://127.0.0.1:3020';
const DEFAULT_UID = process.geteuid?.() ?? 501;
const createdRoots = new Set<string>();

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function caveHealth(
  envelope: {
    apiVersion: string;
    minimumClientVersion: string;
    data: {
      instanceId: string;
      pairingRequired: true;
      releaseVersion: string;
    };
    capabilities: readonly string[];
    operations: readonly string[];
  } = CURRENT_HEALTH_ENVELOPE,
) {
  return {
    status: 'ok' as const,
    apiVersion: envelope.apiVersion,
    minimumClientVersion: envelope.minimumClientVersion,
    instanceId: envelope.data.instanceId,
    pairingRequired: envelope.data.pairingRequired,
    releaseVersion: envelope.data.releaseVersion,
    capabilities: [...envelope.capabilities],
    operations: [...envelope.operations],
  };
}

function pairingCredential() {
  return {
    id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
    appName: 'OpenCoven Chat',
    installationId: 'chat-install-1',
    scopes: ['chat:read'] as const,
    createdAt: 1_755_730_812_617,
    lastUsedAt: null,
    revokedAt: null,
    revocationReason: null,
  };
}

function successfulPairingHandlers() {
  return [
    () =>
      jsonResponse(
        201,
        successEnvelope({
          requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
          secret: PAIRING_SECRET,
          expiresAt: 1_755_731_112_617,
        }),
      ),
    () =>
      jsonResponse(
        200,
        successEnvelope({
          bearer: BEARER,
          credential: pairingCredential(),
        }),
      ),
  ];
}

async function pairDiscoveredClient(
  client: ReturnType<typeof createDiscoveredCaveClient>,
): Promise<void> {
  const session = await client.createPairing({
    appName: 'OpenCoven Chat',
    installationId: 'chat-install-1',
    scopes: ['chat:read'],
  });
  await session.exchange();
}

function expectStoredCredentialRecord(
  serialized: string | undefined,
  bearer: string = BEARER,
): void {
  expect(serialized).toBeTypeOf('string');
  expect(JSON.parse(serialized as string)).toMatchObject({
    version: 1,
    bearer,
    authorityBinding: {
      version: 1,
      instanceId: CURRENT_HEALTH_ENVELOPE.data.instanceId,
    },
  });
}

function successEnvelope(data: Record<string, unknown>) {
  return {
    ...CURRENT_HEALTH_ENVELOPE,
    data,
  };
}

function errorEnvelope(
  code: string,
  status: number,
  retryable = false,
  details?: Record<string, string>,
) {
  return {
    apiVersion: CURRENT_HEALTH_ENVELOPE.apiVersion,
    minimumClientVersion: CURRENT_HEALTH_ENVELOPE.minimumClientVersion,
    capabilities: CURRENT_HEALTH_ENVELOPE.capabilities,
    operations: CURRENT_HEALTH_ENVELOPE.operations,
    requestId: `request-${status}-${code}`,
    error: {
      code,
      message: `${code} failure`,
      ...(details === undefined ? {} : { details }),
      retryable,
    },
  };
}

function jsonResponse(status: number, payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

function discoveryRecord(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    endpoint: DEFAULT_DISCOVERY_ENDPOINT,
    pid: DISCOVERY_PID,
    nonce: DISCOVERY_NONCE,
    startedAt: DISCOVERY_STARTED_AT,
    ...overrides,
  };
}

function createScratchRoot(label: string): string {
  const root = resolve(
    process.cwd(),
    `.scratch-cave-discovery-pairing-${label}-${randomUUID()}`,
  );
  createdRoots.add(root);
  return root;
}

async function writeDiscoveryRecord(
  root: string,
  record: Record<string, unknown> | string,
  options: {
    directoryMode?: number;
    fileMode?: number;
  } = {},
): Promise<string> {
  const directoryMode = options.directoryMode ?? 0o700;
  const fileMode = options.fileMode ?? 0o600;
  await mkdir(root, { recursive: true, mode: directoryMode });
  await chmod(root, directoryMode);
  const path = join(root, DISCOVERY_FILE_NAME);
  await writeFile(
    path,
    typeof record === 'string' ? record : `${JSON.stringify(record)}\n`,
    {
      mode: fileMode,
    },
  );
  await chmod(path, fileMode);
  return path;
}

async function replaceDiscoveryRecord(
  root: string,
  record: Record<string, unknown> | string,
  options: {
    directoryMode?: number;
    fileMode?: number;
  } = {},
): Promise<string> {
  const directoryMode = options.directoryMode ?? 0o700;
  const fileMode = options.fileMode ?? 0o600;
  await mkdir(root, { recursive: true, mode: directoryMode });
  await chmod(root, directoryMode);

  const path = join(root, DISCOVERY_FILE_NAME);
  const replacementPath = join(root, `${DISCOVERY_FILE_NAME}.${randomUUID()}`);
  await writeFile(
    replacementPath,
    typeof record === 'string' ? record : `${JSON.stringify(record)}\n`,
    {
      mode: fileMode,
    },
  );
  await chmod(replacementPath, fileMode);
  await rm(path, { force: true });
  await rename(replacementPath, path);
  await chmod(path, fileMode);
  return path;
}

function queuedFetch(
  handlers: Array<(url: string, init: RequestInit | undefined) => Response | Promise<Response>>,
  options: { automaticHealth?: boolean } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (
      options.automaticHealth !== false &&
      new URL(url).pathname === '/api/client/v1/health'
    ) {
      expect(header(init, 'authorization')).toBeNull();
      return jsonResponse(200, CURRENT_HEALTH_ENVELOPE);
    }

    const handler = handlers.shift();
    if (handler === undefined) {
      throw new Error(`Unexpected fetch for ${url}`);
    }
    return handler(url, init);
  });
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function abortingFetch(
  errorFactory: () => Error = () =>
    Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
  onStart?: () => void,
) {
  return vi.fn((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      onStart?.();
      const signal = init?.signal;
      const rejectAbort = () => reject(errorFactory());

      if (signal?.aborted === true) {
        rejectAbort();
        return;
      }

      signal?.addEventListener('abort', rejectAbort, { once: true });
    }),
  );
}

function discoveryDependencies() {
  return {
    getEffectiveUid: () => DEFAULT_UID,
    isProcessAlive: (pid: number) => pid === DISCOVERY_PID,
  };
}

function discoveredClient(
  root: string,
  fetchImplementation: typeof fetch,
  overrides: {
    credentials?: {
      store: ReturnType<typeof createMemorySecretStore>;
      reference: ReturnType<typeof createSecretStoreReference>;
    };
    maxResponseBytes?: number;
  } = {},
) {
  const credentials = overrides.credentials ?? {
    store: createMemorySecretStore(),
    reference: createSecretStoreReference(`cave-client-${randomUUID()}`),
  };

  return {
    client: createDiscoveredCaveClient({
      credentials,
      discovery: {
        root,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      },
      fetch: fetchImplementation,
      ...(overrides.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: overrides.maxResponseBytes }),
    }),
    credentials,
  };
}

interface SlowStoreOptions {
  delayMs?: number;
  delayedMutation?: number;
  failSetAtMutation?: number;
  failDeleteAtMutation?: number;
}

function createSlowMutationStore(
  options: SlowStoreOptions = {},
) {
  const retained = new Map<string, string>();
  const delayedMutation = options.delayedMutation;
  const delayMs = options.delayMs ?? 0;
  let mutationIndex = 0;
  const log: Array<{ mutation: number; method: 'set' | 'delete'; key: string; phase: 'start' | 'finish' }> = [];
  const startedResolvers = new Map<number, () => void>();
  const started = new Map<number, Promise<void>>();

  const waitForMutationStart = (target: number): Promise<void> => {
    const existing = started.get(target);
    if (existing !== undefined) {
      return existing;
    }

    const promise = new Promise<void>((resolve) => {
      startedResolvers.set(target, resolve);
    });
    started.set(target, promise);
    return promise;
  };

  const signalMutationStart = (target: number): void => {
    startedResolvers.get(target)?.();
    startedResolvers.delete(target);
    if (!started.has(target)) {
      started.set(target, Promise.resolve());
    }
  };

  const maybeDelay = async (target: number): Promise<void> => {
    if (target !== delayedMutation || delayMs <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  };

  const store = {
    get: vi.fn((key: string) => Promise.resolve(retained.get(key))),
    set: vi.fn(async (key: string, value: string) => {
      mutationIndex += 1;
      const current = mutationIndex;
      log.push({ mutation: current, method: 'set', key, phase: 'start' });
      signalMutationStart(current);
      await maybeDelay(current);
      if (options.failSetAtMutation === current) {
        throw new Error(`set failed at ${current}`);
      }
      retained.set(key, value);
      log.push({ mutation: current, method: 'set', key, phase: 'finish' });
    }),
    delete: vi.fn(async (key: string) => {
      mutationIndex += 1;
      const current = mutationIndex;
      log.push({ mutation: current, method: 'delete', key, phase: 'start' });
      signalMutationStart(current);
      await maybeDelay(current);
      if (options.failDeleteAtMutation === current) {
        throw new Error(`delete failed at ${current}`);
      }
      const deleted = retained.delete(key);
      log.push({ mutation: current, method: 'delete', key, phase: 'finish' });
      return deleted;
    }),
  };

  return {
    log,
    retained,
    store,
    waitForMutationStart,
  };
}

function inlineDiscoveredClient(fetchImplementation: typeof fetch) {
  const root = '/Users/example/.coven/cave';
  const recordPath = join(root, DISCOVERY_FILE_NAME);
  const serialized = `${JSON.stringify(discoveryRecord())}\n`;

  return createDiscoveredCaveClient({
    credentials: {
      store: createMemorySecretStore(),
      reference: createSecretStoreReference(`cave-inline-${randomUUID()}`),
    },
    discovery: {
      root,
      timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
      dependencies: {
        getEffectiveUid: () => DEFAULT_UID,
        isProcessAlive: () => true,
        lstat: (path: string) => {
          if (path === root) {
            return Promise.resolve(
              identity({
                directory: true,
                regularFile: false,
                mode: 0o040700,
                size: 0,
              }),
            );
          }

          if (path === recordPath) {
            return Promise.resolve(
              identity({
                size: Buffer.byteLength(serialized),
              }),
            );
          }

          throw Object.assign(new Error(`missing path ${path}`), { code: 'ENOENT' });
        },
        openFile: () => Promise.resolve(memoryHandle(serialized)),
        realpath: (path: string) => Promise.resolve(path),
      },
    },
    fetch: fetchImplementation,
  });
}

interface DiscoveryIdentity {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  size: number;
  symbolicLink: boolean;
  regularFile: boolean;
  directory: boolean;
}

function identity(overrides: Partial<DiscoveryIdentity> = {}): DiscoveryIdentity {
  return {
    device: 7,
    inode: 11,
    mode: 0o100600,
    ownerUid: DEFAULT_UID,
    size: 128,
    symbolicLink: false,
    regularFile: true,
    directory: false,
    ...overrides,
  };
}

function memoryHandle(
  serialized: string,
  options: {
    stat?: () => Promise<DiscoveryIdentity>;
  } = {},
) {
  let position = 0;
  const bytes = Buffer.from(serialized, 'utf8');

  return {
    close: () => Promise.resolve(),
    read: (
      buffer: Uint8Array,
      offset: number,
      length: number,
    ) => {
      const bytesRead = Math.min(length, bytes.length - position);
      if (bytesRead > 0) {
        buffer.set(bytes.subarray(position, position + bytesRead), offset);
        position += bytesRead;
      }
      return Promise.resolve({ bytesRead });
    },
    stat:
      options.stat ??
      (() =>
        Promise.resolve(
          identity({
            size: bytes.length,
          }),
        )),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    [...createdRoots].map(async (root) => {
      createdRoots.delete(root);
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe('discoverCaveEndpoint', () => {
  test('resolves the discovery file from COVEN_CAVE_HOME and validates the current record', async () => {
    const root = createScratchRoot('discover-valid');
    const path = await writeDiscoveryRecord(root, discoveryRecord());
    const stats = await lstat(path);

    await expect(
      discoverCaveEndpoint({
        env: {
          COVEN_CAVE_HOME: root,
        },
        cwd: process.cwd(),
        platform: process.platform,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).resolves.toEqual({
      version: 1,
      endpoint: {
        kind: 'http',
        url: DEFAULT_DISCOVERY_ENDPOINT,
      },
      freshness: {
        pid: DISCOVERY_PID,
        nonce: DISCOVERY_NONCE,
        startedAt: DISCOVERY_STARTED_AT,
      },
      record: {
        path,
        device: stats.dev,
        inode: stats.ino,
      },
    });
  });

  test.each([
    'http://192.168.1.4:3020',
    'http://user@127.0.0.1:3020',
    'http://127.0.0.1:3020?ready=true',
    'http://127.0.0.1:3020#fragment',
    'http://127.0.0.1:3020/client',
  ])('rejects unsafe discovery endpoints: %s', async (endpoint) => {
    const root = createScratchRoot('discover-endpoint');
    await writeDiscoveryRecord(root, discoveryRecord({ endpoint }));

    await expect(
      discoverCaveEndpoint({
        root,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      retryable: false,
    });
  });

  test('rejects stale or malformed discovery records', async () => {
    const staleRoot = createScratchRoot('discover-stale-pid');
    await writeDiscoveryRecord(staleRoot, discoveryRecord());
    await expect(
      discoverCaveEndpoint({
        root: staleRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: {
          ...discoveryDependencies(),
          isProcessAlive: () => false,
        },
      }),
    ).rejects.toMatchObject({
      code: 'stale_record',
      retryable: true,
    });

    const nonceRoot = createScratchRoot('discover-empty-nonce');
    await writeDiscoveryRecord(nonceRoot, discoveryRecord({ nonce: '' }));
    await expect(
      discoverCaveEndpoint({
        root: nonceRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
  });

  test('rejects mismatched ownership, permissive modes, symlinks, and path swaps', async () => {
    const ownerRoot = createScratchRoot('discover-owner');
    await writeDiscoveryRecord(ownerRoot, discoveryRecord());
    await expect(
      discoverCaveEndpoint({
        root: ownerRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: {
          ...discoveryDependencies(),
          getEffectiveUid: () => DEFAULT_UID + 1,
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      retryable: false,
    });

    const modeRoot = createScratchRoot('discover-mode');
    await writeDiscoveryRecord(modeRoot, discoveryRecord(), {
      directoryMode: 0o755,
      fileMode: 0o644,
    });
    await expect(
      discoverCaveEndpoint({
        root: modeRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      retryable: false,
    });

    const symlinkRoot = createScratchRoot('discover-symlink');
    const realRoot = join(symlinkRoot, 'real');
    const aliasRoot = join(symlinkRoot, 'alias');
    await writeDiscoveryRecord(realRoot, discoveryRecord());
    await symlink(realRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      discoverCaveEndpoint({
        root: aliasRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      retryable: false,
    });

    const swappedRoot = '/Users/example/.coven/cave';
    const swappedPath = join(swappedRoot, DISCOVERY_FILE_NAME);
    const swappedRecord = JSON.stringify(discoveryRecord());
    await expect(
      discoverCaveEndpoint({
        root: swappedRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: {
          getEffectiveUid: () => DEFAULT_UID,
          isProcessAlive: () => true,
          lstat: (path: string) => {
            if (path === swappedRoot) {
              return Promise.resolve(
                identity({
                  directory: true,
                  regularFile: false,
                  mode: 0o040700,
                  size: 0,
                }),
              );
            }
            if (path === swappedPath) {
              return Promise.resolve(
                identity({
                  size: Buffer.byteLength(swappedRecord),
                }),
              );
            }
            throw Object.assign(new Error(`missing path ${path}`), { code: 'ENOENT' });
          },
          openFile: () =>
            Promise.resolve(
              memoryHandle(swappedRecord, {
                stat: () =>
                  Promise.resolve(
                    identity({
                      inode: 99,
                      size: Buffer.byteLength(swappedRecord),
                    }),
                  ),
              }),
            ),
          realpath: (path: string) => Promise.resolve(path),
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      retryable: false,
    });
  });

  test('rejects oversized or malformed discovery files', async () => {
    const oversizeRoot = createScratchRoot('discover-oversize');
    await writeDiscoveryRecord(oversizeRoot, {
      ...discoveryRecord(),
      padding: 'x'.repeat(256),
    });
    await expect(
      discoverCaveEndpoint({
        root: oversizeRoot,
        maxRecordBytes: 64,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).rejects.toMatchObject({
      code: 'body_limit',
      retryable: false,
    });

    const malformedRoot = createScratchRoot('discover-malformed');
    await writeDiscoveryRecord(malformedRoot, '{not json');
    await expect(
      discoverCaveEndpoint({
        root: malformedRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
  });

  test('honors absolute deadlines and abort signals without starting collaborator work', async () => {
    const lstat = vi.fn();
    const realpath = vi.fn();

    await expect(
      discoverCaveEndpoint({
        root: '/Users/example/.coven/cave',
        deadline: performance.now(),
        dependencies: {
          getEffectiveUid: () => DEFAULT_UID,
          isProcessAlive: () => true,
          lstat,
          openFile: () => {
            throw new Error('openFile must not run');
          },
          realpath,
        },
      }),
    ).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    });
    expect(lstat).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      discoverCaveEndpoint({
        root: '/Users/example/.coven/cave',
        signal: controller.signal,
        dependencies: {
          getEffectiveUid: () => DEFAULT_UID,
          isProcessAlive: () => true,
          lstat,
          openFile: () => {
            throw new Error('openFile must not run');
          },
          realpath,
        },
      }),
    ).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
    expect(lstat).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });
});

describe('discovered Cave pairing helpers', () => {
  test('creates, polls, exchanges, validates, and forgets a paired credential', async () => {
    const root = createScratchRoot('pairing-success');
    await writeDiscoveryRecord(root, discoveryRecord());
    const credential = {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read', 'chat:write'],
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    } as const;
    const fetchImplementation = queuedFetch([
      (url, init) => {
        expect(url).toBe('http://127.0.0.1:3020/api/client/v1/pairing/requests');
        expect(init?.method).toBe('POST');
        expect(init?.redirect).toBe('error');
        expect(header(init, 'content-type')).toBe('application/json');
        expect(typeof init?.body).toBe('string');
        expect(init?.body).toBe(
          JSON.stringify({
            appName: 'OpenCoven Chat',
            installationId: 'chat-install-1',
            scopes: ['chat:read', 'chat:write'],
          }),
        );
        return jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        );
      },
      (url, init) => {
        expect(url).toBe(
          'http://127.0.0.1:3020/api/client/v1/pairing/requests/018f4f1a-77c2-7a31-8a15-55a25aaba001',
        );
        expect(init?.method).toBe('GET');
        expect(init?.redirect).toBe('error');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            status: 'approved',
            expiresAt: 1_755_731_112_617,
          }),
        );
      },
      (url, init) => {
        expect(url).toBe(
          'http://127.0.0.1:3020/api/client/v1/pairing/requests/018f4f1a-77c2-7a31-8a15-55a25aaba001/exchange',
        );
        expect(init?.method).toBe('POST');
        expect(init?.redirect).toBe('error');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential,
          }),
        );
      },
      (url, init) => {
        expect(url).toBe('http://127.0.0.1:3020/api/client/v1/familiars');
        expect(init?.method).toBe('GET');
        expect(init?.redirect).toBe('error');
        expect(header(init, 'authorization')).toBe(`Bearer ${BEARER}`);
        return jsonResponse(
          200,
          successEnvelope({
            familiars: [],
          }),
        );
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read', 'chat:write'],
    });

    expect(session.requestId).toBe('018f4f1a-77c2-7a31-8a15-55a25aaba001');
    expect(session.expiresAt).toBe(1_755_731_112_617);
    await expect(session.poll()).resolves.toEqual({
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
      status: 'approved',
      expiresAt: 1_755_731_112_617,
    });
    await expect(session.exchange()).resolves.toEqual(credential);
    expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
    await expect(client.credentialStatus()).resolves.toEqual({
      status: 'valid',
      access: 'chat:read',
      health: caveHealth(),
    });
    await expect(client.forgetCredential()).resolves.toBe(true);
    await expect(credentials.store.get(credentials.reference.key)).resolves.toBeUndefined();
    await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
    expect(fetchImplementation).toHaveBeenCalledTimes(8);
  });

  test('maps a discovered non-empty familiar roster from the wire spelling', async () => {
    const root = createScratchRoot('pairing-familiars-roster');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: {
              id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
              appName: 'OpenCoven Chat',
              installationId: 'chat-install-1',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        ),
      (_url, init) => {
        expect(header(init, 'authorization')).toBe(`Bearer ${BEARER}`);
        return jsonResponse(
          200,
          successEnvelope({
            familiars: [DISCOVERED_FAMILIAR_WIRE],
          }),
        );
      },
    ]);
    const { client } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await session.exchange();
    await expect(client.familiars()).resolves.toEqual([
      {
        id: 'cody',
        displayName: 'Cody',
        role: 'Implementation',
        pronouns: 'he/him',
        status: 'working',
        lastSeen: '2026-08-24T02:15:00Z',
        activeSessions: 2,
        memoryFreshness: 'fresh',
      },
    ]);
  });

  test('reports a discovered credential as valid against a non-empty roster', async () => {
    const root = createScratchRoot('pairing-credential-status-roster');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: {
              id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
              appName: 'OpenCoven Chat',
              installationId: 'chat-install-1',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        ),
      (_url, init) => {
        expect(header(init, 'authorization')).toBe(`Bearer ${BEARER}`);
        return jsonResponse(
          200,
          successEnvelope({
            familiars: [DISCOVERED_FAMILIAR_WIRE],
          }),
        );
      },
    ]);
    const { client } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await session.exchange();
    await expect(client.credentialStatus()).resolves.toEqual({
      status: 'valid',
      access: 'chat:read',
      health: caveHealth(),
    });
  });

  describe('discovered Cave canonical reads', () => {
    const routeInventories = [
      {
        clientOperation: 'listFamiliars',
        expectedOperation: 'familiars.list',
        requiredCapabilities: ['familiars', 'cursors'],
        invoke: (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.listFamiliars(),
      },
      {
        clientOperation: 'listProjects',
        expectedOperation: 'projects.list',
        requiredCapabilities: ['projects', 'cursors'],
        invoke: (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.listProjects(),
      },
      {
        clientOperation: 'listConversations',
        expectedOperation: 'conversations.list',
        requiredCapabilities: ['conversations', 'cursors'],
        invoke: (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.listConversations(),
      },
      {
        clientOperation: 'getConversation',
        expectedOperation: 'conversations.read',
        requiredCapabilities: ['conversations'],
        invoke: (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.getConversation('conversation-1'),
      },
      {
        clientOperation: 'listConversationMessages',
        expectedOperation: 'messages.list',
        requiredCapabilities: ['conversation-messages', 'cursors'],
        invoke: (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.listConversationMessages('conversation-1'),
      },
    ] as const;

    test.each([
      ['getConversation', '.', (client: ReturnType<typeof createDiscoveredCaveClient>) =>
        client.getConversation('.')],
      ['getConversation', '..', (client: ReturnType<typeof createDiscoveredCaveClient>) =>
        client.getConversation('..')],
      [
        'listConversationMessages',
        '.',
        (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.listConversationMessages('.'),
      ],
      [
        'listConversationMessages',
        '..',
        (client: ReturnType<typeof createDiscoveredCaveClient>) =>
          client.listConversationMessages('..'),
      ],
    ])(
      'rejects %s dot-only id %s before discovery, credential load, proof, or network I/O',
      async (_operation, _conversationId, invoke) => {
        const store = createMemorySecretStore();
        const get = vi.spyOn(store, 'get');
        const discoverEndpoint = vi.fn(() =>
          Promise.reject(new Error('discovery must not be reached')),
        );
        const fetchImplementation = vi.fn<typeof fetch>(() =>
          Promise.reject(new Error('network must not be reached')),
        );
        const client = createDiscoveredCaveClient({
          credentials: {
            store,
            reference: createSecretStoreReference(
              `canonical-dot-id-${randomUUID()}`,
            ),
          },
          discoverEndpoint,
          fetch: fetchImplementation,
        });

        await expect(invoke(client)).rejects.toMatchObject({
          code: 'invalid_options',
          message: 'conversationId must not be a dot path segment',
        });
        expect(discoverEndpoint).not.toHaveBeenCalled();
        expect(get).not.toHaveBeenCalled();
        expect(fetchImplementation).not.toHaveBeenCalled();
      },
    );

    test('uses exact canonical routes, deterministic queries, encoded ids, and bearer-only authenticated requests', async () => {
      const root = createScratchRoot('canonical-routes');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        ...successfulPairingHandlers(),
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/familiars?limit=50`,
          );
          expect(init?.method).toBe('GET');
          expect(init?.redirect).toBe('error');
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ familiars: [CANONICAL_FAMILIAR] }),
          );
        },
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/projects?limit=25&cursor=eyJ2IjoxfQ`,
          );
          expect(init?.method).toBe('GET');
          expect(init?.redirect).toBe('error');
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ projects: [CANONICAL_PROJECT] }),
          );
        },
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/conversations?limit=50&cursor=eyJ2IjoxfQ`,
          );
          expect(init?.method).toBe('GET');
          expect(init?.redirect).toBe('error');
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ conversations: [CANONICAL_CONVERSATION] }),
          );
        },
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/conversations/conversation%2Fone%3F%23`,
          );
          expect(init?.method).toBe('GET');
          expect(init?.redirect).toBe('error');
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ conversation: CANONICAL_CONVERSATION }),
          );
        },
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/conversations/conversation%2Fone%3F%23/messages?limit=100&cursor=eyJ2IjoxfQ`,
          );
          expect(init?.method).toBe('GET');
          expect(init?.redirect).toBe('error');
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ messages: [CANONICAL_MESSAGE] }),
          );
        },
      ]);
      const { client } = discoveredClient(root, fetchImplementation);

      await pairDiscoveredClient(client);
      await expect(client.listFamiliars()).resolves.toEqual({
        data: [CANONICAL_FAMILIAR],
      });
      await expect(
        client.listProjects({ limit: 25, cursor: 'eyJ2IjoxfQ' }),
      ).resolves.toEqual({ data: [CANONICAL_PROJECT] });
      await expect(
        client.listConversations({ cursor: 'eyJ2IjoxfQ' }),
      ).resolves.toEqual({ data: [CANONICAL_CONVERSATION] });
      await expect(
        client.getConversation(CANONICAL_CONVERSATION.id),
      ).resolves.toEqual(CANONICAL_CONVERSATION);
      await expect(
        client.listConversationMessages(CANONICAL_CONVERSATION.id, {
          limit: 100,
          cursor: 'eyJ2IjoxfQ',
        }),
      ).resolves.toEqual({ data: [CANONICAL_MESSAGE] });

      const authenticatedRequests = fetchImplementation.mock.calls.filter(
        ([, init]) => header(init, 'authorization') !== null,
      );
      expect(authenticatedRequests).toHaveLength(5);
      expect(fetchImplementation).toHaveBeenCalledTimes(14);
    });

    test('keeps legacy familiars separate from the canonical familiar page', async () => {
      const root = createScratchRoot('canonical-legacy-separation');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        ...successfulPairingHandlers(),
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/familiars`,
          );
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ familiars: [DISCOVERED_FAMILIAR_WIRE] }),
          );
        },
        (url, init) => {
          expect(url).toBe(
            `${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/familiars?limit=50`,
          );
          expect(header(init, 'authorization')).toBe(
            ['Bearer', BEARER].join(' '),
          );
          return jsonResponse(
            200,
            successEnvelope({ familiars: [CANONICAL_FAMILIAR] }),
          );
        },
      ]);
      const { client } = discoveredClient(root, fetchImplementation);

      await pairDiscoveredClient(client);
      await expect(client.familiars()).resolves.toEqual([
        expect.objectContaining({
          id: 'cody',
          lastSeen: DISCOVERED_FAMILIAR_WIRE.last_seen,
        }),
      ]);
      await expect(client.listFamiliars()).resolves.toEqual({
        data: [CANONICAL_FAMILIAR],
      });
    });

    test('fails closed with a missing credential before any request', async () => {
      const root = createScratchRoot('canonical-missing-credential');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = vi.fn<typeof fetch>(() =>
        Promise.reject(new Error('network must not be reached')),
      );
      const { client } = discoveredClient(root, fetchImplementation);

      await expect(client.listProjects()).rejects.toMatchObject({
        normalized: {
          code: 'unauthorized',
          operation: 'listProjects',
          retryable: false,
        },
      });
      expect(fetchImplementation).not.toHaveBeenCalled();
    });

    test('fails closed with malformed stored credentials without deleting a replacement value', async () => {
      const root = createScratchRoot('canonical-malformed-credential');
      await writeDiscoveryRecord(root, discoveryRecord());
      const store = createMemorySecretStore();
      const reference = createSecretStoreReference(
        'canonical-malformed-credential',
      );
      await store.set(reference.key, '{bad-json');
      const replacement = 'replacement-written-after-read';
      const compareAndDelete = vi
        .spyOn(store, 'compareAndDelete')
        .mockImplementation(async (key, expectedValue) => {
          expect(expectedValue).toBe('{bad-json');
          await store.set(key, replacement);
          return 'changed';
        });
      const fetchImplementation = vi.fn<typeof fetch>(() =>
        Promise.reject(new Error('network must not be reached')),
      );
      const { client } = discoveredClient(root, fetchImplementation, {
        credentials: { store, reference },
      });

      await expect(client.listProjects()).rejects.toMatchObject({
        normalized: {
          code: 'reconcile_required',
          operation: 'listProjects',
          retryable: false,
        },
        details: {
          reason: 'authority_binding_invalid',
        },
      });
      await expect(store.get(reference.key)).resolves.toBe(replacement);
      expect(compareAndDelete).toHaveBeenCalledOnce();
      expect(fetchImplementation).not.toHaveBeenCalled();
    });

    test.each([
      ['wrong', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'],
      ['revoked', BEARER],
    ])('preserves %s bearer rejection without fallback or retry', async (
      label,
      rejectedBearer,
    ) => {
      const root = createScratchRoot(`canonical-${label}-credential`);
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        ...successfulPairingHandlers(),
        (_url, init) => {
          expect(header(init, 'authorization')).toBe(`Bearer ${rejectedBearer}`);
          return jsonResponse(401, errorEnvelope('unauthorized', 401));
        },
      ]);
      const { client, credentials } = discoveredClient(
        root,
        fetchImplementation,
      );

      await pairDiscoveredClient(client);
      if (rejectedBearer !== BEARER) {
        const serialized = await credentials.store.get(
          credentials.reference.key,
        );
        expect(serialized).toBeTypeOf('string');
        const record = JSON.parse(serialized as string) as Record<
          string,
          unknown
        >;
        record.bearer = rejectedBearer;
        await credentials.store.set(
          credentials.reference.key,
          JSON.stringify(record),
        );
      }
      const storedBeforeRead = await credentials.store.get(
        credentials.reference.key,
      );

      await expect(client.listProjects()).rejects.toMatchObject({
        normalized: {
          code: 'unauthorized',
          operation: 'listProjects',
          retryable: false,
          statusCode: 401,
        },
      });
      await expect(
        credentials.store.get(credentials.reference.key),
      ).resolves.toBe(storedBeforeRead);
      const authenticatedRequests = fetchImplementation.mock.calls.filter(
        ([, init]) => header(init, 'authorization') !== null,
      );
      expect(authenticatedRequests).toHaveLength(1);
    });

    test('invalidates an instance-replaced credential before bearer attachment', async () => {
      const root = createScratchRoot('canonical-instance-replaced');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch(successfulPairingHandlers());
      const { client, credentials } = discoveredClient(
        root,
        fetchImplementation,
      );

      await pairDiscoveredClient(client);
      await replaceDiscoveryRecord(root, discoveryRecord());

      await expect(client.listConversations()).rejects.toMatchObject({
        normalized: {
          code: 'reconcile_required',
          operation: 'listConversations',
          retryable: false,
        },
        details: {
          reason: 'record_replaced',
        },
      });
      await expect(
        credentials.store.get(credentials.reference.key),
      ).resolves.toBeUndefined();
      expect(fetchImplementation).toHaveBeenCalledTimes(4);
    });

    test('sends no bearer when the unauthenticated instance proof detects replacement', async () => {
      const root = createScratchRoot('canonical-instance-proof');
      await writeDiscoveryRecord(root, discoveryRecord());
      const replacementHealth = {
        ...CURRENT_HEALTH_ENVELOPE,
        data: {
          ...CURRENT_HEALTH_ENVELOPE.data,
          instanceId: '00000000-0000-4000-8000-000000000099',
        },
      };
      const fetchImplementation = queuedFetch([
        successfulPairingHandlers()[0]!,
        (_url, init) => {
          expect(header(init, 'authorization')).toBeNull();
          return jsonResponse(200, CURRENT_HEALTH_ENVELOPE);
        },
        successfulPairingHandlers()[1]!,
        (_url, init) => {
          expect(header(init, 'authorization')).toBeNull();
          return jsonResponse(200, CURRENT_HEALTH_ENVELOPE);
        },
        (_url, init) => {
          expect(header(init, 'authorization')).toBeNull();
          return jsonResponse(200, replacementHealth);
        },
      ], { automaticHealth: false });
      const { client, credentials } = discoveredClient(
        root,
        fetchImplementation,
      );

      await pairDiscoveredClient(client);
      await expect(client.listConversations()).rejects.toMatchObject({
        normalized: {
          code: 'reconcile_required',
          operation: 'listConversations',
          retryable: false,
        },
        details: {
          reason: 'authority_restarted',
        },
      });
      await expect(
        credentials.store.get(credentials.reference.key),
      ).resolves.toBeUndefined();
      expect(
        fetchImplementation.mock.calls.every(
          ([, init]) => header(init, 'authorization') === null,
        ),
      ).toBe(true);
      expect(fetchImplementation).toHaveBeenCalledTimes(5);
    });

    test.each([
      ['not_found', 404, 'getConversation', false],
      ['scope_denied', 403, 'listProjects', false],
      ['reconcile_required', 409, 'listConversationMessages', true],
    ] as const)(
      'preserves canonical %s errors and never retries',
      async (code, status, operation, retryable) => {
        const root = createScratchRoot(`canonical-error-${code}`);
        await writeDiscoveryRecord(root, discoveryRecord());
        const details =
          code === 'reconcile_required'
            ? { reason: 'resume_from_canonical_state' }
            : undefined;
        const fetchImplementation = queuedFetch([
          ...successfulPairingHandlers(),
          () =>
            jsonResponse(
              status,
              errorEnvelope(code, status, retryable, details),
            ),
        ]);
        const { client } = discoveredClient(root, fetchImplementation);

        await pairDiscoveredClient(client);
        const read =
          operation === 'getConversation'
            ? client.getConversation('missing')
            : operation === 'listProjects'
              ? client.listProjects()
              : client.listConversationMessages('conversation-1');

        await expect(read).rejects.toMatchObject({
          normalized: {
            code,
            operation,
            requestId: `request-${status}-${code}`,
            retryable,
            statusCode: status,
          },
          ...(details === undefined ? {} : { details }),
        });
        const authenticatedRequests = fetchImplementation.mock.calls.filter(
          ([, init]) => header(init, 'authorization') !== null,
        );
        expect(authenticatedRequests).toHaveLength(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(6);
      },
    );

    test.each(
      routeInventories.map((route, index) => ({
        ...route,
        status: [401, 403, 500, 401, 500][index] as 401 | 403 | 500,
      })),
    )(
      'rejects a $clientOperation legacy proxy envelope at HTTP $status without retrying or invalidating credentials',
      async ({ clientOperation, invoke, status }) => {
        const root = createScratchRoot(
          `canonical-legacy-proxy-${clientOperation}-${status}`,
        );
        await writeDiscoveryRecord(root, discoveryRecord());
        const fetchImplementation = queuedFetch([
          ...successfulPairingHandlers(),
          () =>
            jsonResponse(status, {
              ok: false,
              error: 'Legacy proxy rejection.',
            }),
        ]);
        const { client, credentials } = discoveredClient(
          root,
          fetchImplementation,
        );

        await pairDiscoveredClient(client);
        const storedBeforeRead = await credentials.store.get(
          credentials.reference.key,
        );

        await expect(invoke(client)).rejects.toMatchObject({
          normalized: {
            code: 'invalid_response',
            operation: clientOperation,
            retryable: false,
            statusCode: status,
          },
          details: { field: 'response' },
        });
        await expect(
          credentials.store.get(credentials.reference.key),
        ).resolves.toBe(storedBeforeRead);
        const authenticatedRequests = fetchImplementation.mock.calls.filter(
          ([, init]) => header(init, 'authorization') !== null,
        );
        expect(authenticatedRequests).toHaveLength(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(6);
      },
    );

    test.each(['1.1', '2.0'] as const)(
      'rejects discovered canonical HTTP error apiVersion %s as invalid_response',
      async (apiVersion) => {
        const root = createScratchRoot(`canonical-error-version-${apiVersion}`);
        await writeDiscoveryRecord(root, discoveryRecord());
        const requestId = `canonical-version-${apiVersion}`;
        const fetchImplementation = queuedFetch([
          ...successfulPairingHandlers(),
          () =>
            jsonResponse(409, {
              ...errorEnvelope(
                'reconcile_required',
                409,
                false,
                { reason: 'resume_from_canonical_state' },
              ),
              apiVersion,
              requestId,
            }),
        ]);
        const { client } = discoveredClient(root, fetchImplementation);

        await pairDiscoveredClient(client);
        await expect(client.listProjects()).rejects.toMatchObject({
          normalized: {
            code: 'invalid_response',
            operation: 'listProjects',
            requestId,
            retryable: false,
            statusCode: 409,
          },
          details: { field: 'apiVersion' },
        });
        const authenticatedRequests = fetchImplementation.mock.calls.filter(
          ([, init]) => header(init, 'authorization') !== null,
        );
        expect(authenticatedRequests).toHaveLength(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(6);
      },
    );

    test.each(
      routeInventories.flatMap((route) => [
        {
          ...route,
          field: 'operations',
          declarations: CAVE_OPERATIONS.filter(
            (operation) => operation !== route.expectedOperation,
          ),
        },
        ...route.requiredCapabilities.map((missingCapability) => ({
          ...route,
          field: 'capabilities',
          declarations: CAVE_CAPABILITIES.filter(
            (capability) => capability !== missingCapability,
          ),
        })),
      ]),
    )(
      'rejects $clientOperation discovered HTTP error without required $field inventory',
      async ({ clientOperation, declarations, field, invoke }) => {
        const root = createScratchRoot(
          `canonical-error-inventory-${clientOperation}-${field}-${randomUUID()}`,
        );
        await writeDiscoveryRecord(root, discoveryRecord());
        const requestId = `inventory-${clientOperation}-${field}`;
        const fetchImplementation = queuedFetch([
          ...successfulPairingHandlers(),
          () =>
            jsonResponse(409, {
              ...errorEnvelope('reconcile_required', 409, false),
              [field]: declarations,
              requestId,
            }),
        ]);
        const { client } = discoveredClient(root, fetchImplementation);

        await pairDiscoveredClient(client);
        await expect(invoke(client)).rejects.toMatchObject({
          normalized: {
            code: 'invalid_response',
            operation: clientOperation,
            requestId,
            retryable: false,
            statusCode: 409,
          },
          details: { field },
        });
        const authenticatedRequests = fetchImplementation.mock.calls.filter(
          ([, init]) => header(init, 'authorization') !== null,
        );
        expect(authenticatedRequests).toHaveLength(1);
        expect(fetchImplementation).toHaveBeenCalledTimes(6);
      },
    );

    test('refuses canonical redirects without following them', async () => {
      const root = createScratchRoot('canonical-redirect');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        ...successfulPairingHandlers(),
        (_url, init) => {
          expect(init?.redirect).toBe('error');
          return new Response('', {
            status: 302,
            headers: {
              location: 'http://127.0.0.1:3999/redirected',
            },
          });

          test('preserves legacy pairing error compatibility for apiVersion 1.1', async () => {
            const root = createScratchRoot('pairing-error-version-1-1');
            await writeDiscoveryRecord(root, discoveryRecord());
            const requestId = 'pairing-error-version-1-1';
            const fetchImplementation = queuedFetch([
              () =>
                jsonResponse(409, {
                  ...errorEnvelope('conflict', 409, false, {
                    reason: 'pairing_pending',
                  }),
                  apiVersion: '1.1',
                  requestId,
                }),
            ]);
            const { client } = discoveredClient(root, fetchImplementation);

            await expect(
              client.createPairing({
                appName: 'OpenCoven Chat',
                installationId: 'chat-install-1',
                scopes: ['chat:read'],
              }),
            ).rejects.toMatchObject({
              normalized: {
                code: 'conflict',
                operation: 'pairingCreate',
                requestId,
                retryable: false,
                statusCode: 409,
              },
              details: { reason: 'pairing_pending' },
            });
            expect(fetchImplementation).toHaveBeenCalledOnce();
          });
        },
      ]);
      const { client } = discoveredClient(root, fetchImplementation);

      await pairDiscoveredClient(client);
      await expect(client.listProjects()).rejects.toMatchObject({
        normalized: {
          code: 'invalid_response',
          operation: 'listProjects',
          statusCode: 302,
        },
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(6);
    });

    test('preserves legacy proxy error normalization for noncanonical requests', async () => {
      const root = createScratchRoot('legacy-proxy-error');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        () =>
          jsonResponse(403, {
            ok: false,
            error: 'Legacy proxy rejection.',
          }),
      ], { automaticHealth: false });
      const { client } = discoveredClient(root, fetchImplementation);

      await expect(client.health()).rejects.toMatchObject({
        normalized: {
          code: 'unauthorized',
          operation: 'health',
          retryable: false,
          statusCode: 403,
        },
      });
      expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    test('bounds oversized canonical responses', async () => {
      const root = createScratchRoot('canonical-body-limit');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        ...successfulPairingHandlers(),
        () =>
          jsonResponse(
            200,
            successEnvelope({
              projects: [CANONICAL_PROJECT],
              padding: 'x'.repeat(2_048),
            }),
          ),
      ]);
      const { client } = discoveredClient(root, fetchImplementation, {
        maxResponseBytes: 1_024,
      });

      await pairDiscoveredClient(client);
      await expect(client.listProjects()).rejects.toMatchObject({
        normalized: {
          code: 'body_limit',
          operation: 'listProjects',
          statusCode: 200,
        },
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(6);
    });

    test('rejects malformed canonical JSON without retrying', async () => {
      const root = createScratchRoot('canonical-malformed-json');
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        ...successfulPairingHandlers(),
        () =>
          new Response('{bad json', {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }),
      ]);
      const { client } = discoveredClient(root, fetchImplementation);

      await pairDiscoveredClient(client);
      await expect(client.listProjects()).rejects.toMatchObject({
        normalized: {
          code: 'invalid_response',
          operation: 'listProjects',
          statusCode: 200,
        },
      });
      const authenticatedRequests = fetchImplementation.mock.calls.filter(
        ([, init]) => header(init, 'authorization') !== null,
      );
      expect(authenticatedRequests).toHaveLength(1);
      expect(fetchImplementation).toHaveBeenCalledTimes(6);
    });
  });

  test('fails closed on discovery record replacement before polling and never sends the pairing secret', async () => {
    const root = createScratchRoot('pairing-record-replaced');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      (_url, init) => {
        expect(header(init, 'x-coven-pairing-secret')).toBeNull();
        return jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        );
      },
    ], { automaticHealth: false });
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await replaceDiscoveryRecord(root, discoveryRecord());

    await expect(session.poll()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: true,
        operation: 'pairingPoll',
      },
      details: {
        reason: 'record_replaced',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('fails closed on authority restarts before exchanging and never sends the pairing secret', async () => {
    const root = createScratchRoot('pairing-authority-restarted');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      (_url, init) => {
        expect(header(init, 'x-coven-pairing-secret')).toBeNull();
        return jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        );
      },
    ]);
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await writeDiscoveryRecord(
      root,
      discoveryRecord({
        nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba099',
        startedAt: '2026-08-24T02:06:12.004Z',
      }),
    );

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: true,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'authority_restarted',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('fails closed on authority mismatches before polling and never sends the pairing secret', async () => {
    const root = createScratchRoot('pairing-authority-mismatch');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      (_url, init) => {
        expect(header(init, 'x-coven-pairing-secret')).toBeNull();
        return jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        );
      },
    ]);
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await writeDiscoveryRecord(root, discoveryRecord({ endpoint: 'http://127.0.0.1:3021' }));

    await expect(session.poll()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: true,
        operation: 'pairingPoll',
      },
      details: {
        reason: 'authority_mismatch',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('keeps the pairing secret ready after a retryable poll failure', async () => {
    const root = createScratchRoot('pairing-poll-retryable-failure');
    await writeDiscoveryRecord(root, discoveryRecord());
    const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
    const expiresAt = 1_755_731_112_617;
    const credential = {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'] as const,
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    };
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId,
            secret: PAIRING_SECRET,
            expiresAt,
          }),
        ),
      (url, init) => {
        expect(url).toBe(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}`);
        expect(init?.method).toBe('GET');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(503, errorEnvelope('service_unavailable', 503, true));
      },
      (url, init) => {
        expect(url).toBe(
          `http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}/exchange`,
        );
        expect(init?.method).toBe('POST');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential,
          }),
        );
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.poll()).rejects.toMatchObject({
      normalized: {
        code: 'service_unavailable',
        retryable: true,
        operation: 'pairingPoll',
        statusCode: 503,
      },
    });
    await expect(session.exchange()).resolves.toEqual(credential);
    expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  test('spends the pairing secret after a terminal poll status', async () => {
    const root = createScratchRoot('pairing-poll-denied');
    await writeDiscoveryRecord(root, discoveryRecord());
    const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
    const expiresAt = 1_755_731_112_617;
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId,
            secret: PAIRING_SECRET,
            expiresAt,
          }),
        ),
      (url, init) => {
        expect(url).toBe(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}`);
        expect(init?.method).toBe('GET');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            id: requestId,
            status: 'denied',
            expiresAt,
          }),
        );
      },
    ]);
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.poll()).resolves.toEqual({
      id: requestId,
      status: 'denied',
      expiresAt,
    });
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  test('allows retry after a pre-send authority mismatch without replaying the secret', async () => {
    const root = createScratchRoot('pairing-pre-send-authority-mismatch');
    await writeDiscoveryRecord(root, discoveryRecord());
    const credential = {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'] as const,
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    };
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      (_url, init) => {
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential,
          }),
        );
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await writeDiscoveryRecord(root, discoveryRecord({ endpoint: 'http://127.0.0.1:3021' }));

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: true,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'authority_mismatch',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    await writeDiscoveryRecord(root, discoveryRecord());

    await expect(session.exchange()).resolves.toEqual(credential);
    expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  test('treats generic discovered exchange fetch failures as terminal for the session', async () => {
    const root = createScratchRoot('pairing-exchange-fetch-failure');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      (_url, init) => {
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return Promise.reject(new TypeError('network down'));
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'service_unavailable',
        retryable: false,
        operation: 'pairingExchange',
      },
    });
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
    await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
    await expect(credentials.store.get(credentials.reference.key)).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  test.each([
    {
      name: 'failed',
      reason: 'authority_proof_failed',
      response: () => jsonResponse(503, errorEnvelope('service_unavailable', 503, true)),
    },
    {
      name: 'changed',
      reason: 'authority_restarted',
      response: () =>
        jsonResponse(200, {
          ...CURRENT_HEALTH_ENVELOPE,
          data: {
            ...CURRENT_HEALTH_ENVELOPE.data,
            instanceId: '00000000-0000-4000-8000-000000000099',
          },
        }),
    },
  ])(
    'requires a new pairing when the post-exchange authority proof is $name',
    async ({ reason, response }) => {
      const root = createScratchRoot(`pairing-post-exchange-proof-${reason}`);
      await writeDiscoveryRecord(root, discoveryRecord());
      const fetchImplementation = queuedFetch([
        () =>
          jsonResponse(
            201,
            successEnvelope({
              requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
          ),
        () => jsonResponse(200, CURRENT_HEALTH_ENVELOPE),
        (_url, init) => {
          expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
          return jsonResponse(
            200,
            successEnvelope({
              bearer: BEARER,
              credential: pairingCredential(),
            }),
          );
        },
        response,
      ], { automaticHealth: false });
      const { client, credentials } = discoveredClient(root, fetchImplementation);
      const session = await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      });

      await expect(session.exchange()).rejects.toMatchObject({
        normalized: {
          code: 'reconcile_required',
          retryable: false,
          operation: 'pairingExchange',
        },
        details: { reason },
      });
      await expect(session.exchange()).rejects.toMatchObject({
        normalized: {
          code: 'conflict',
          retryable: false,
          operation: 'pairingExchange',
        },
        details: {
          reason: 'pairing_replayed',
        },
      });
      await expect(credentials.store.get(credentials.reference.key)).resolves.toBeUndefined();
      expect(fetchImplementation).toHaveBeenCalledTimes(4);
    },
  );

  test('keeps a successful poll ready for one later exchange', async () => {
    const root = createScratchRoot('pairing-poll-then-exchange');
    await writeDiscoveryRecord(root, discoveryRecord());
    const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
    const expiresAt = 1_755_731_112_617;
    const credential = {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'] as const,
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    };
    const fetchImplementation = queuedFetch([
      (url, init) => {
        expect(url).toBe('http://127.0.0.1:3020/api/client/v1/pairing/requests');
        expect(init?.method).toBe('POST');
        expect(header(init, 'x-coven-pairing-secret')).toBeNull();
        return jsonResponse(
          201,
          successEnvelope({
            requestId,
            secret: PAIRING_SECRET,
            expiresAt,
          }),
        );
      },
      (url, init) => {
        expect(url).toBe(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}`);
        expect(init?.method).toBe('GET');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            id: requestId,
            status: 'approved',
            expiresAt,
          }),
        );
      },
      (url, init) => {
        expect(url).toBe(
          `http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}/exchange`,
        );
        expect(init?.method).toBe('POST');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential,
          }),
        );
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.poll()).resolves.toEqual({
      id: requestId,
      status: 'approved',
      expiresAt,
    });
    await expect(session.exchange()).resolves.toEqual(credential);
    expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  test('fails exchange locally while a poll is already using the pairing secret', async () => {
    const root = createScratchRoot('pairing-poll-exchange-concurrent');
    await writeDiscoveryRecord(root, discoveryRecord());
    const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
    const expiresAt = 1_755_731_112_617;
    const credential = {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'] as const,
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    };
    let resolvePoll: ((response: Response) => void) | undefined;
    let signalPollStarted: (() => void) | undefined;
    const pollStarted = new Promise<void>((resolve) => {
      signalPollStarted = resolve;
    });
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId,
            secret: PAIRING_SECRET,
            expiresAt,
          }),
        ),
      (url, init) => {
        expect(url).toBe(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}`);
        expect(init?.method).toBe('GET');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        signalPollStarted?.();
        return new Promise<Response>((resolve) => {
          resolvePoll = resolve;
        });
      },
      (url, init) => {
        expect(url).toBe(
          `http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}/exchange`,
        );
        expect(init?.method).toBe('POST');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        return jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential,
          }),
        );
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const poll = session.poll();
    await pollStarted;

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'operation_in_progress',
        retryable: true,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_poll_in_progress',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);

    expect(resolvePoll).toBeDefined();
    resolvePoll?.(
      jsonResponse(
        200,
        successEnvelope({
          id: requestId,
          status: 'approved',
          expiresAt,
        }),
      ),
    );

    await expect(poll).resolves.toEqual({
      id: requestId,
      status: 'approved',
      expiresAt,
    });
    await expect(session.exchange()).resolves.toEqual(credential);
    expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  test('fails concurrent polls locally without a second transport send', async () => {
    const root = createScratchRoot('pairing-concurrent-polls');
    await writeDiscoveryRecord(root, discoveryRecord());
    const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
    const expiresAt = 1_755_731_112_617;
    let resolveFirstPoll: ((response: Response) => void) | undefined;
    let signalFirstPollStarted: (() => void) | undefined;
    const firstPollStarted = new Promise<void>((resolve) => {
      signalFirstPollStarted = resolve;
    });
    let pollAttempts = 0;
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url === 'http://127.0.0.1:3020/api/client/v1/pairing/requests') {
        return jsonResponse(
          201,
          successEnvelope({
            requestId,
            secret: PAIRING_SECRET,
            expiresAt,
          }),
        );
      }

      if (url === `http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}`) {
        expect(init?.method).toBe('GET');
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        pollAttempts += 1;
        if (pollAttempts === 1) {
          signalFirstPollStarted?.();
          return await new Promise<Response>((resolve) => {
            resolveFirstPoll = resolve;
          });
        }

        if (pollAttempts === 2) {
          return jsonResponse(
            200,
            successEnvelope({
              id: requestId,
              status: 'approved',
              expiresAt,
            }),
          );
        }
      }

      throw new Error(`Unexpected fetch for ${url}`);
    });
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const firstPoll = session.poll();
    await firstPollStarted;

    await expect(session.poll()).rejects.toMatchObject({
      normalized: {
        code: 'operation_in_progress',
        retryable: true,
        operation: 'pairingPoll',
      },
      details: {
        reason: 'pairing_poll_in_progress',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(pollAttempts).toBe(1);

    expect(resolveFirstPoll).toBeDefined();
    resolveFirstPoll?.(
      jsonResponse(
        200,
        successEnvelope({
          id: requestId,
          status: 'approved',
          expiresAt,
        }),
      ),
    );

    await expect(firstPoll).resolves.toEqual({
      id: requestId,
      status: 'approved',
      expiresAt,
    });
    await expect(session.poll()).resolves.toEqual({
      id: requestId,
      status: 'approved',
      expiresAt,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(pollAttempts).toBe(2);
  });

  test.each([
    ['abort', 'aborted', false] as const,
    ['timeout', 'timeout', true] as const,
  ])(
    'releases the poll gate after %s and ignores stale completions',
    async (mode, expectedCode, expectedRetryable) => {
      const root = createScratchRoot(`pairing-poll-${mode}-release`);
      await writeDiscoveryRecord(root, discoveryRecord());
      const requestId = '018f4f1a-77c2-7a31-8a15-55a25aaba001';
      const expiresAt = 1_755_731_112_617;
      const credential = {
        id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'] as const,
        createdAt: 1_755_730_812_617,
        lastUsedAt: null,
        revokedAt: null,
        revocationReason: null,
      };
      let resolveFirstPoll: ((response: Response) => void) | undefined;
      let signalFirstPollStarted: (() => void) | undefined;
      const firstPollStarted = new Promise<void>((resolve) => {
        signalFirstPollStarted = resolve;
      });
      const fetchImplementation = queuedFetch([
        () =>
          jsonResponse(
            201,
            successEnvelope({
              requestId,
              secret: PAIRING_SECRET,
              expiresAt,
            }),
          ),
        (url, init) => {
          expect(url).toBe(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}`);
          expect(init?.method).toBe('GET');
          expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
          signalFirstPollStarted?.();
          return new Promise<Response>((resolve) => {
            resolveFirstPoll = resolve;
          });
        },
        (url, init) => {
          expect(url).toBe(
            `http://127.0.0.1:3020/api/client/v1/pairing/requests/${requestId}/exchange`,
          );
          expect(init?.method).toBe('POST');
          expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
          return jsonResponse(
            200,
            successEnvelope({
              bearer: BEARER,
              credential,
            }),
          );
        },
      ]);
      const { client, credentials } = discoveredClient(root, fetchImplementation);
      const session = await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      });
      const controller = new AbortController();

      if (mode === 'timeout') {
        vi.useFakeTimers();
      }

      const firstPoll = session
        .poll(mode === 'abort' ? { signal: controller.signal } : { timeoutMs: 10 })
        .catch((error: unknown) => error);
      await firstPollStarted;

      await expect(session.poll()).rejects.toMatchObject({
        normalized: {
          code: 'operation_in_progress',
          retryable: true,
          operation: 'pairingPoll',
        },
        details: {
          reason: 'pairing_poll_in_progress',
        },
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);

      if (mode === 'abort') {
        controller.abort(new Error('stop'));
      } else {
        await vi.advanceTimersByTimeAsync(10);
      }

      await expect(firstPoll).resolves.toMatchObject({
        normalized: {
          code: expectedCode,
          retryable: expectedRetryable,
          operation: 'pairingPoll',
        },
        cause: {
          code: expectedCode,
        },
      });

      await expect(session.exchange()).resolves.toEqual(credential);
      expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
      expect(fetchImplementation).toHaveBeenCalledTimes(5);

      expect(resolveFirstPoll).toBeDefined();
      resolveFirstPoll?.(
        jsonResponse(
          200,
          successEnvelope({
            id: requestId,
            status: 'approved',
            expiresAt,
          }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();

      await expect(session.exchange()).rejects.toMatchObject({
        normalized: {
          code: 'conflict',
          retryable: false,
          operation: 'pairingExchange',
        },
        details: {
          reason: 'pairing_replayed',
        },
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(5);
    },
  );

  test('clears a restarted stored credential before familiars can send its bearer', async () => {
    const root = createScratchRoot('pairing-stored-credential-restarted');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: {
              id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
              appName: 'OpenCoven Chat',
              installationId: 'chat-install-1',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        ),
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await session.exchange();
    await writeDiscoveryRecord(
      root,
      discoveryRecord({
        nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba099',
        startedAt: '2026-08-24T02:06:12.004Z',
      }),
    );

    await expect(client.familiars()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: false,
        operation: 'familiars',
      },
      details: {
        reason: 'authority_restarted',
      },
    });
    await expect(credentials.store.get(credentials.reference.key)).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  test('proves the Cave instance before sending a stored bearer after PID reuse', async () => {
    const root = createScratchRoot('pairing-stored-credential-instance-changed');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () => jsonResponse(200, CURRENT_HEALTH_ENVELOPE),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: pairingCredential(),
          }),
        ),
      (_url, init) => {
        expect(header(init, 'authorization')).toBeNull();
        return jsonResponse(200, CURRENT_HEALTH_ENVELOPE);
      },
      (_url, init) => {
        expect(header(init, 'authorization')).toBeNull();
        return jsonResponse(200, {
          ...CURRENT_HEALTH_ENVELOPE,
          data: {
            ...CURRENT_HEALTH_ENVELOPE.data,
            instanceId: '00000000-0000-4000-8000-000000000099',
          },
        });
      },
    ], { automaticHealth: false });
    const { client, credentials } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await session.exchange();
    await expect(client.familiars()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: false,
        operation: 'familiars',
      },
      details: {
        reason: 'authority_restarted',
      },
    });
    await expect(credentials.store.get(credentials.reference.key)).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  test('returns missing after discovery record replacement without invoking the bearer transport', async () => {
    const root = createScratchRoot('pairing-stored-credential-replaced');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: {
              id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
              appName: 'OpenCoven Chat',
              installationId: 'chat-install-1',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        ),
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await session.exchange();
    await replaceDiscoveryRecord(root, discoveryRecord());

    await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
    await expect(credentials.store.get(credentials.reference.key)).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  test('normalizes fetch-stage timeouts instead of reporting service unavailability', async () => {
    vi.useFakeTimers();
    let signalFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    const fetchImplementation = abortingFetch(undefined, () => signalFetchStarted?.());
    const client = inlineDiscoveredClient(fetchImplementation);

    const result = client.health({ timeoutMs: 10 }).catch((error: unknown) => error);
    await fetchStarted;

    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        retryable: true,
        operation: 'health',
      },
      cause: {
        code: 'timeout',
        retryable: true,
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('normalizes fetch-stage caller aborts instead of reporting service unavailability', async () => {
    let signalFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    const fetchImplementation = abortingFetch(undefined, () => signalFetchStarted?.());
    const client = inlineDiscoveredClient(fetchImplementation);
    const controller = new AbortController();

    const result = client.health({ signal: controller.signal }).catch((error: unknown) => error);
    await fetchStarted;
    controller.abort(new Error('stop'));

    await expect(result).resolves.toMatchObject({
      normalized: {
        code: 'aborted',
        retryable: false,
        operation: 'health',
      },
      cause: {
        code: 'aborted',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test('stops late response work after a discovered fetch times out', async () => {
    vi.useFakeTimers();

    let resolveFetch: ((response: Response) => void) | undefined;
    let signalFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    const getReader = vi.fn(() => ({
      read: vi.fn(),
      releaseLock: vi.fn(),
    }));
    const fetchImplementation = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          signalFetchStarted?.();
          resolveFetch = resolve;
        }),
    );
    const client = inlineDiscoveredClient(fetchImplementation);

    const result = client.health({ timeoutMs: 10 }).catch((error: unknown) => error);
    await fetchStarted;

    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toMatchObject({
      normalized: {
        code: 'timeout',
        operation: 'health',
      },
    });

    resolveFetch?.({
      status: 200,
      headers: new Headers({ 'content-length': '2' }),
      body: {
        getReader,
      },
    } as unknown as Response);
    await Promise.resolve();
    await Promise.resolve();

    expect(getReader).not.toHaveBeenCalled();
  });

  test('preserves incompatible discovered health minimums as incompatible_version', async () => {
    const client = inlineDiscoveredClient(
      queuedFetch([
        () =>
          jsonResponse(200, {
            ...CURRENT_HEALTH_ENVELOPE,
            minimumClientVersion: '999.0.0',
          }),
      ], { automaticHealth: false }),
    );

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'incompatible_version',
        operation: 'health',
      },
    });
  });

  test('treats malformed discovered health minimums as invalid_response', async () => {
    const client = inlineDiscoveredClient(
      queuedFetch([
        () =>
          jsonResponse(200, {
            ...CURRENT_HEALTH_ENVELOPE,
            minimumClientVersion: 'not-semver',
          }),
      ], { automaticHealth: false }),
    );

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
      },
    });
  });

  test('preserves explicit empty discovered capability and operation arrays', async () => {
    const emptyAdvertisedArrays = {
      ...CURRENT_HEALTH_ENVELOPE,
      capabilities: [],
      operations: [],
    };
    const client = inlineDiscoveredClient(
      queuedFetch([
        () => jsonResponse(200, emptyAdvertisedArrays),
      ], { automaticHealth: false }),
    );

    await expect(client.health()).resolves.toEqual(caveHealth(emptyAdvertisedArrays));
  });

  test.each([
    {
      label: 'duplicate capabilities',
      envelope: {
        ...CURRENT_HEALTH_ENVELOPE,
        capabilities: ['health', 'health'],
      },
    },
    {
      label: 'duplicate operations',
      envelope: {
        ...CURRENT_HEALTH_ENVELOPE,
        operations: ['health.read', 'health.read'],
      },
    },
  ])('rejects discovered health envelopes with $label', async ({ envelope }) => {
    const client = inlineDiscoveredClient(
      queuedFetch([
        () => jsonResponse(200, envelope),
      ], { automaticHealth: false }),
    );

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
      },
    });
  });

  test.each([
    {
      code: 'pairing_pending',
      retryable: true,
      status: 409,
    },
    {
      code: 'pairing_denied',
      retryable: false,
      status: 403,
    },
    {
      code: 'pairing_expired',
      retryable: false,
      status: 410,
    },
    {
      code: 'conflict',
      retryable: false,
      status: 409,
      details: { reason: 'pairing_replayed' },
    },
  ])('surfaces pairing exchange errors: $code', async ({ code, details, retryable, status }) => {
    const root = createScratchRoot(`pairing-error-${code}`);
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () => jsonResponse(status, errorEnvelope(code, status, retryable, details)),
    ]);
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const exchange = session.exchange();

    await expect(exchange).rejects.toBeInstanceOf(CaveClientError);
    await expect(exchange).rejects.toMatchObject({
      normalized: {
        code,
        retryable,
        operation: 'pairingExchange',
        statusCode: status,
      },
      ...(details === undefined ? {} : { details }),
    });
  });

  test('allows only one transport exchange across concurrent exchange attempts', async () => {
    const root = createScratchRoot('pairing-concurrent-exchange');
    await writeDiscoveryRecord(root, discoveryRecord());
    const credential = {
      id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'] as const,
      createdAt: 1_755_730_812_617,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    };
    let resolveExchange: ((response: Response) => void) | undefined;
    let signalExchangeStarted: (() => void) | undefined;
    const exchangeStarted = new Promise<void>((resolve) => {
      signalExchangeStarted = resolve;
    });
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      (_url, init) => {
        expect(header(init, 'x-coven-pairing-secret')).toBe(PAIRING_SECRET);
        signalExchangeStarted?.();
        return new Promise<Response>((resolve) => {
          resolveExchange = resolve;
        });
      },
    ]);
    const { client, credentials } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const firstExchange = session.exchange();
    await exchangeStarted;

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);

    expect(resolveExchange).toBeDefined();
    resolveExchange?.(
      jsonResponse(
        200,
        successEnvelope({
          bearer: BEARER,
          credential,
        }),
      ),
    );

    await expect(firstExchange).resolves.toEqual(credential);
    expectStoredCredentialRecord(await credentials.store.get(credentials.reference.key));
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  test('fails later exchange retries locally after a malformed exchange response', async () => {
    const root = createScratchRoot('pairing-malformed-exchange');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: 7,
            credential: null,
          }),
        ),
    ]);
    const { client } = discoveredClient(root, fetchImplementation);
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        retryable: false,
        operation: 'pairingExchange',
      },
    });
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  test.each([
    ['atomic record write', 1],
  ] as const)(
    'cleans and stays fail-closed when the %s times out',
    async (_label, delayedMutation) => {
      vi.useFakeTimers();
      const root = createScratchRoot(`pairing-timeout-${delayedMutation}`);
      await writeDiscoveryRecord(root, discoveryRecord());
      const credential = pairingCredential();
      const slowStore = createSlowMutationStore({
        delayMs: 50,
        delayedMutation,
      });
      const reference = createSecretStoreReference(`cave-timeout-${delayedMutation}`);
      const fetchImplementation = queuedFetch([
        () =>
          jsonResponse(
            201,
            successEnvelope({
              requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
          ),
        () =>
          jsonResponse(
            200,
            successEnvelope({
              bearer: BEARER,
              credential,
            }),
          ),
      ]);
      const client = createDiscoveredCaveClient({
        credentials: { store: slowStore.store, reference },
        discovery: {
          root,
          timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
          dependencies: discoveryDependencies(),
        },
        fetch: fetchImplementation,
      });
      const session = await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      });

      const exchange = session.exchange({ timeoutMs: 10 }).catch((error: unknown) => error);
      await slowStore.waitForMutationStart(delayedMutation);
      await vi.advanceTimersByTimeAsync(75);

      const error = await exchange;
      expect(error).toMatchObject({
        normalized: {
          code: 'timeout',
          retryable: true,
          operation: 'pairingExchange',
        },
      });
      const settledLogLength = slowStore.log.length;
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      expect(slowStore.log).toHaveLength(settledLogLength);

      await expect(session.exchange()).rejects.toMatchObject({
        normalized: {
          code: 'conflict',
          retryable: false,
          operation: 'pairingExchange',
        },
        details: {
          reason: 'pairing_replayed',
        },
      });
      await expect(client.familiars()).rejects.toMatchObject({
        normalized: {
          code: 'unauthorized',
          retryable: false,
          operation: 'familiars',
        },
      });
      await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
      expect(slowStore.retained.size).toBe(0);
      expect(fetchImplementation).toHaveBeenCalledTimes(4);
    },
  );

  test('reports old-or-missing credential state during an atomic write without sending a bearer', async () => {
    vi.useFakeTimers();

    try {
      const root = createScratchRoot('pairing-update-in-progress');
      await writeDiscoveryRecord(root, discoveryRecord());
      const slowStore = createSlowMutationStore({
        delayMs: 50,
        delayedMutation: 1,
      });
      const reference = createSecretStoreReference('cave-update-in-progress');
      const fetchImplementation = queuedFetch([
        () =>
          jsonResponse(
            201,
            successEnvelope({
              requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
          ),
        () =>
          jsonResponse(
            200,
            successEnvelope({
              bearer: BEARER,
              credential: pairingCredential(),
            }),
          ),
        (_url, init) => {
          expect(header(init, 'authorization')).toBe(`Bearer ${BEARER}`);
          return jsonResponse(
            200,
            successEnvelope({
              familiars: [DISCOVERED_FAMILIAR_WIRE],
            }),
          );
        },
      ]);
      const client = createDiscoveredCaveClient({
        credentials: { store: slowStore.store, reference },
        discovery: {
          root,
          timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
          dependencies: discoveryDependencies(),
        },
        fetch: fetchImplementation,
      });
      const session = await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      });

      const exchange = session.exchange();
      await slowStore.waitForMutationStart(1);

      await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
      await expect(client.familiars()).rejects.toMatchObject({
        normalized: {
          code: 'unauthorized',
          retryable: false,
          operation: 'familiars',
        },
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(75);

      await expect(exchange).resolves.toEqual(pairingCredential());
      await expect(client.credentialStatus()).resolves.toEqual({
        status: 'valid',
        access: 'chat:read',
        health: caveHealth(),
      });
      expectStoredCredentialRecord(slowStore.retained.get(reference.key));
      expect(fetchImplementation).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ['atomic record write', 1],
  ] as const)(
    'cleans and stays fail-closed when the %s is aborted',
    async (_label, delayedMutation) => {
      vi.useFakeTimers();
      const root = createScratchRoot(`pairing-abort-${delayedMutation}`);
      await writeDiscoveryRecord(root, discoveryRecord());
      const credential = pairingCredential();
      const slowStore = createSlowMutationStore({
        delayMs: 50,
        delayedMutation,
      });
      const reference = createSecretStoreReference(`cave-abort-${delayedMutation}`);
      const fetchImplementation = queuedFetch([
        () =>
          jsonResponse(
            201,
            successEnvelope({
              requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
              secret: PAIRING_SECRET,
              expiresAt: 1_755_731_112_617,
            }),
          ),
        () =>
          jsonResponse(
            200,
            successEnvelope({
              bearer: BEARER,
              credential,
            }),
          ),
      ]);
      const client = createDiscoveredCaveClient({
        credentials: { store: slowStore.store, reference },
        discovery: {
          root,
          timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
          dependencies: discoveryDependencies(),
        },
        fetch: fetchImplementation,
      });
      const session = await client.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      });
      const controller = new AbortController();

      const exchange = session.exchange({ signal: controller.signal }).catch((error: unknown) => error);
      await slowStore.waitForMutationStart(delayedMutation);
      controller.abort(new Error('stop'));
      await vi.advanceTimersByTimeAsync(75);

      const error = await exchange;
      expect(error).toMatchObject({
        normalized: {
          code: 'aborted',
          retryable: false,
          operation: 'pairingExchange',
        },
      });
      const settledLogLength = slowStore.log.length;
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      expect(slowStore.log).toHaveLength(settledLogLength);

      await expect(session.exchange()).rejects.toMatchObject({
        normalized: {
          code: 'conflict',
          retryable: false,
          operation: 'pairingExchange',
        },
        details: {
          reason: 'pairing_replayed',
        },
      });
      await expect(client.familiars()).rejects.toMatchObject({
        normalized: {
          code: 'unauthorized',
          retryable: false,
          operation: 'familiars',
        },
      });
      await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
      expect(slowStore.retained.size).toBe(0);
      expect(fetchImplementation).toHaveBeenCalledTimes(4);
    },
  );

  test('surfaces a write failure without retaining a partial credential', async () => {
    const root = createScratchRoot('pairing-store-failure');
    await writeDiscoveryRecord(root, discoveryRecord());
    const retained = new Map<string, string>();
    const store = {
      get: vi.fn((key: string) => Promise.resolve(retained.get(key))),
      set: vi.fn(() => Promise.reject(new Error('store write failed'))),
      delete: vi.fn((key: string) => Promise.resolve(retained.delete(key))),
    };
    const reference = createSecretStoreReference('cave-store-failure');
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: {
              id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
              appName: 'OpenCoven Chat',
              installationId: 'chat-install-1',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        ),
    ]);
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discovery: {
        root,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      },
      fetch: fetchImplementation,
    });
    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    const exchange = session.exchange().catch((error: unknown) => error);
    const error = await exchange;

    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.delete).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      normalized: {
        code: 'secret_store_write_failed',
        retryable: false,
        operation: 'pairingExchange',
      },
    });
    expect(String(error)).not.toContain(BEARER);
    expect(JSON.stringify(error)).not.toContain(BEARER);
    await expect(session.exchange()).rejects.toMatchObject({
      normalized: {
        code: 'conflict',
        retryable: false,
        operation: 'pairingExchange',
      },
      details: {
        reason: 'pairing_replayed',
      },
    });
    await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
    await expect(client.familiars()).rejects.toMatchObject({
      normalized: {
        code: 'unauthorized',
        retryable: false,
        operation: 'familiars',
      },
    });
    await expect(store.get(reference.key)).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  test('fails closed on malformed stored records without sending a bearer', async () => {
    const root = createScratchRoot('pairing-malformed-stored-record');
    await writeDiscoveryRecord(root, discoveryRecord());
    const retained = new Map<string, string>([['cave-malformed-stored-record', '{bad-json']]);
    const store = {
      get: vi.fn((key: string) => Promise.resolve(retained.get(key))),
      set: vi.fn(() => Promise.resolve()),
      delete: vi.fn((key: string) => Promise.resolve(retained.delete(key))),
    };
    const reference = createSecretStoreReference('cave-malformed-stored-record');
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error('network should not be reached with a malformed stored credential')),
    );
    const client = createDiscoveredCaveClient({
      credentials: { store, reference },
      discovery: {
        root,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      },
      fetch: fetchImplementation,
    });

    await expect(client.familiars()).rejects.toMatchObject({
      normalized: {
        code: 'reconcile_required',
        retryable: false,
        operation: 'familiars',
      },
      details: {
        reason: 'authority_binding_invalid',
      },
    });
    await expect(client.credentialStatus()).resolves.toEqual({ status: 'missing' });
    expect(store.delete).toHaveBeenCalledWith(reference.key);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test('reports revoked stored credentials against the current authority', async () => {
    const root = createScratchRoot('pairing-revoked');
    await writeDiscoveryRecord(root, discoveryRecord());
    const fetchImplementation = queuedFetch([
      () =>
        jsonResponse(
          201,
          successEnvelope({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: PAIRING_SECRET,
            expiresAt: 1_755_731_112_617,
          }),
        ),
      () =>
        jsonResponse(
          200,
          successEnvelope({
            bearer: BEARER,
            credential: {
              id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
              appName: 'OpenCoven Chat',
              installationId: 'chat-install-1',
              scopes: ['chat:read'],
              createdAt: 1_755_730_812_617,
              lastUsedAt: null,
              revokedAt: null,
              revocationReason: null,
            },
          }),
        ),
      () => jsonResponse(401, errorEnvelope('unauthorized', 401)),
    ]);
    const { client } = discoveredClient(root, fetchImplementation);

    const session = await client.createPairing({
      appName: 'OpenCoven Chat',
      installationId: 'chat-install-1',
      scopes: ['chat:read'],
    });

    await session.exchange();

    await expect(client.credentialStatus()).resolves.toEqual({
      status: 'revoked',
      health: caveHealth(),
    });
  });

  test('bounds response bodies and configures redirect refusal on discovered requests', async () => {
    const root = createScratchRoot('pairing-body-limit');
    await writeDiscoveryRecord(root, discoveryRecord());
    const oversized = jsonResponse(
      201,
      successEnvelope({
        requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
        secret: PAIRING_SECRET,
        expiresAt: 1_755_731_112_617,
        padding: 'x'.repeat(512),
      }),
    );
    const oversizedFetch = queuedFetch([
      (_url, init) => {
        expect(init?.redirect).toBe('error');
        return oversized;
      },
    ]);
    const oversizedClient = createDiscoveredCaveClient({
      credentials: {
        store: createMemorySecretStore(),
        reference: createSecretStoreReference('cave-oversized-response'),
      },
      discovery: {
        root,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      },
      fetch: oversizedFetch,
      maxResponseBytes: 64,
    });

    await expect(
      oversizedClient.createPairing({
        appName: 'OpenCoven Chat',
        installationId: 'chat-install-1',
        scopes: ['chat:read'],
      }),
    ).rejects.toMatchObject({
      normalized: {
        code: 'body_limit',
        operation: 'pairingCreate',
      },
    });

    const redirectFetch = queuedFetch([
      (_url, init) => {
        expect(init?.redirect).toBe('error');
        return new Response('', {
          status: 302,
          headers: {
            location: 'http://127.0.0.1:3999/redirected',
          },
        });
      },
    ], { automaticHealth: false });
    const redirectClient = createDiscoveredCaveClient({
      credentials: {
        store: createMemorySecretStore(),
        reference: createSecretStoreReference('cave-redirect-response'),
      },
      discovery: {
        root,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      },
      fetch: redirectFetch,
    });

    await expect(redirectClient.health()).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
        statusCode: 302,
      },
    });
  });

  test('uses an injected discovery resolver instead of ambient discovery state', async () => {
    const missingRoot = '/Users/example/.coven/cave/missing-runtime';
    const discoverEndpoint = vi.fn(() => Promise.resolve({
      version: 1 as const,
      endpoint: {
        kind: 'http' as const,
        url: DEFAULT_DISCOVERY_ENDPOINT,
      },
      freshness: {
        pid: DISCOVERY_PID,
        nonce: DISCOVERY_NONCE,
        startedAt: DISCOVERY_STARTED_AT,
      },
      record: {
        path: join(missingRoot, DISCOVERY_FILE_NAME),
        device: 7,
        inode: 9,
      },
    }));
    const fetchImplementation = queuedFetch([
      (url, init) => {
        expect(url).toBe(`${DEFAULT_DISCOVERY_ENDPOINT}/api/client/v1/health`);
        expect(init?.method).toBe('GET');
        return jsonResponse(200, CURRENT_HEALTH_ENVELOPE);
      },
    ], { automaticHealth: false });
    const client = createDiscoveredCaveClient({
      credentials: {
        store: createMemorySecretStore(),
        reference: createSecretStoreReference('cave-injected-discovery'),
      },
      discoverEndpoint,
      discovery: {
        root: missingRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
        dependencies: discoveryDependencies(),
      },
      fetch: fetchImplementation,
    });

    await expect(client.health()).resolves.toEqual(caveHealth());
    expect(discoverEndpoint).toHaveBeenCalledTimes(1);
    expect(discoverEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        root: missingRoot,
        timeoutMs: DISCOVERY_TEST_TIMEOUT_MS,
      }),
    );
  });
});
