/* eslint-disable @typescript-eslint/require-await */

import { constants as fsConstants } from 'node:fs';

import {
  createSecretStoreReference,
  type SecretStore,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  forgetStoredCredential,
  invalidateStoredCredential,
  loadBoundCredential,
  storeBoundCredential,
} from '../packages/cave/src/credential-binding.js';
import {
  discoverCaveEndpoint,
  type CaveDiscoveredEndpoint,
  type CaveDiscoveryFileHandle,
  type CaveDiscoveryPathIdentity,
} from '../packages/cave/src/discovery.js';
import {
  isPairingSecretUnsentError,
  markPairingSecretUnsentError,
} from '../packages/cave/src/pairing-secret.js';

const discovered: CaveDiscoveredEndpoint = {
  version: 1,
  endpoint: {
    kind: 'http',
    url: 'http://127.0.0.1:3020',
  },
  freshness: {
    pid: 42,
    nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba099',
    startedAt: '2026-08-24T02:06:12.004Z',
  },
  record: {
    path: '/Users/example/.coven/cave/client-v1-discovery.json',
    device: 7,
    inode: 9,
  },
};

interface MutableStore extends SecretStore {
  deleted: string[];
  values: Map<string, unknown>;
}

function storeWithState(entries: Iterable<readonly [string, unknown]> = []): MutableStore {
  const values = new Map<string, unknown>(entries);
  const deleted: string[] = [];

  return {
    deleted,
    values,
    async get(key) {
      return values.get(key) as string | undefined;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      deleted.push(key);
      return values.delete(key);
    },
  };
}

function discoveredPathIdentity(
  overrides: Partial<CaveDiscoveryPathIdentity> = {},
): CaveDiscoveryPathIdentity {
  return {
    device: 7,
    inode: 9,
    mode: 0o100600,
    ownerUid: 501,
    size: 0,
    symbolicLink: false,
    regularFile: true,
    directory: false,
    ...overrides,
  };
}

function memoryHandle(
  serialized: string,
  stats: CaveDiscoveryPathIdentity,
  options: {
    close?: () => Promise<void>;
  } = {},
): CaveDiscoveryFileHandle {
  const bytes = Buffer.from(serialized, 'utf8');
  let offset = 0;

  return {
    async read(buffer, bufferOffset, length) {
      const chunk = bytes.subarray(offset, offset + length);
      buffer.set(chunk, bufferOffset);
      offset += chunk.length;
      return { bytesRead: chunk.length };
    },
    async close() {
      await options.close?.();
    },
    async stat() {
      return stats;
    },
  };
}

function bindingKey(store: MutableStore, reference: { key: string }): string {
  const key = [...store.values.keys()].find((candidate) => candidate !== reference.key);
  if (key === undefined) {
    throw new Error('Expected binding metadata key.');
  }
  return key;
}

function discoveryRecord(
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    version: 1,
    endpoint: discovered.endpoint.url,
    pid: discovered.freshness.pid,
    nonce: discovered.freshness.nonce,
    startedAt: discovered.freshness.startedAt,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cave credential binding helpers', () => {
  test('stores, loads, invalidates, and forgets bound credentials', async () => {
    const reference = createSecretStoreReference('chat.cave');
    const store = storeWithState();

    await storeBoundCredential(store, reference, 'bearer', discovered);
    const metadataKey = bindingKey(store, reference);

    expect(String(store.values.get(metadataKey))).toContain('"state":"bound"');
    await expect(
      loadBoundCredential(store, reference, discovered, (value) => value === 'bearer'),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer',
    });

    await expect(forgetStoredCredential(store, reference)).resolves.toBe(true);
    expect(store.values.size).toBe(0);

    await storeBoundCredential(store, reference, 'bearer', discovered);
    await expect(invalidateStoredCredential(store, reference)).resolves.toBeUndefined();
    expect(store.values.size).toBe(0);
  });

  test('reports invalid bound-credential states and reconciliation reasons', async () => {
    const reference = createSecretStoreReference('chat.cave.status');
    const seeded = storeWithState();
    await storeBoundCredential(seeded, reference, 'bearer', discovered);
    const metadataKey = bindingKey(seeded, reference);

    await expect(
      loadBoundCredential(storeWithState(), reference, discovered, () => true),
    ).resolves.toEqual({ status: 'missing' });

    await expect(
      loadBoundCredential(
        storeWithState([[reference.key, 99]]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'invalid_bearer' });

    await expect(
      loadBoundCredential(
        storeWithState([[reference.key, 'bearer']]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_binding_missing',
    });

    await expect(
      loadBoundCredential(
        storeWithState([
          [reference.key, 'bearer'],
          [metadataKey, 123],
        ]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_binding_invalid',
    });

    await expect(
      loadBoundCredential(
        storeWithState([
          [reference.key, 'bearer'],
          [metadataKey, '{not-json'],
        ]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_binding_invalid',
    });

    await expect(
      loadBoundCredential(
        storeWithState([
          [reference.key, 'bearer'],
          [metadataKey, String(seeded.values.get(metadataKey)).replace('"bound"', '"pending"')],
        ]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_binding_incomplete',
    });

    await expect(
      loadBoundCredential(
        storeWithState(seeded.values),
        reference,
        {
          ...discovered,
          endpoint: {
            kind: 'http',
            url: 'http://127.0.0.1:4040',
          },
        },
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_mismatch',
    });

    await expect(
      loadBoundCredential(
        storeWithState(seeded.values),
        reference,
        {
          ...discovered,
          record: {
            ...discovered.record,
            inode: discovered.record.inode + 1,
          },
        },
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'record_replaced',
    });

    await expect(
      loadBoundCredential(
        storeWithState(seeded.values),
        reference,
        {
          ...discovered,
          freshness: {
            ...discovered.freshness,
            nonce: 'different',
          },
        },
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_restarted',
    });
  });

  test('swallows invalidation delete failures and reports whether any credential material was forgotten', async () => {
    const reference = createSecretStoreReference('chat.cave.delete');
    const first = storeWithState();
    await storeBoundCredential(first, reference, 'bearer', discovered);
    const metadataKey = bindingKey(first, reference);

    const bearerDeleteFailure: SecretStore = {
      async get() {
        return undefined;
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        if (key === reference.key) {
          throw new Error('bearer delete failed');
        }
        return false;
      },
    };

    const metadataDeleteFailure: SecretStore = {
      async get() {
        return undefined;
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        if (key === reference.key) {
          return true;
        }
        throw new Error('metadata delete failed');
      },
    };

    await expect(invalidateStoredCredential(bearerDeleteFailure, reference)).resolves.toBeUndefined();
    await expect(invalidateStoredCredential(metadataDeleteFailure, reference)).resolves.toBeUndefined();

    const bindingOnlyStore = storeWithState([[metadataKey, first.values.get(metadataKey)]]);
    await expect(forgetStoredCredential(bindingOnlyStore, reference)).resolves.toBe(true);
    await expect(forgetStoredCredential(storeWithState(), reference)).resolves.toBe(false);
  });
});

describe('Cave pairing secret marker', () => {
  test('marks objects, ignores primitives, and survives descriptor or getter failures', () => {
    const error = new Error('pairing');
    expect(markPairingSecretUnsentError(error)).toBe(error);
    expect(isPairingSecretUnsentError(error)).toBe(true);

    expect(markPairingSecretUnsentError('pairing-secret')).toBe('pairing-secret');
    expect(isPairingSecretUnsentError('pairing-secret')).toBe(false);

    const frozen = Object.freeze({ code: 'frozen' });
    expect(markPairingSecretUnsentError(frozen)).toBe(frozen);
    expect(isPairingSecretUnsentError(frozen)).toBe(false);

    const throwingGetter = new Proxy(
      {},
      {
        get() {
          throw new Error('no getter access');
        },
      },
    );
    expect(isPairingSecretUnsentError(throwingGetter)).toBe(false);
  });
});

describe('Cave discovery platform helpers', () => {
  test('discovers trusted Windows records from USERPROFILE and HOMEDRIVE/HOMEPATH', async () => {
    const userProfileRoot = 'C:\\Users\\Alice\\.coven\\cave';
    const userProfileRecordPath = `${userProfileRoot}\\client-v1-discovery.json`;
    const recordBytes = discoveryRecord();
    const rootIdentity = discoveredPathIdentity({
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = discoveredPathIdentity({
      size: Buffer.byteLength(recordBytes),
    });
    const validate = vi.fn(async () => true);
    const openFile = vi.fn(async (_path: string, flags: number) => {
      expect(flags).toBe(fsConstants.O_RDONLY);
      return memoryHandle(recordBytes, recordIdentity);
    });
    const lstat = vi.fn(async (path: string) => {
      if (path === userProfileRoot) {
        return rootIdentity;
      }
      if (path === userProfileRecordPath) {
        return recordIdentity;
      }
      throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
    });

    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          isProcessAlive: () => true,
          lstat,
          openFile,
          realpath: async (path) => path,
          windowsPathTrust: {
            validate,
          },
        },
      }),
    ).resolves.toEqual({
      ...discovered,
      record: {
        path: userProfileRecordPath,
        device: recordIdentity.device,
        inode: recordIdentity.inode,
      },
    });

    expect(validate).toHaveBeenNthCalledWith(1, userProfileRoot, 'root');
    expect(validate).toHaveBeenNthCalledWith(2, userProfileRecordPath, 'record');

    const homeDriveRoot = 'C:\\Users\\Bob\\.coven\\cave';
    const homeDriveRecordPath = `${homeDriveRoot}\\client-v1-discovery.json`;
    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: {
          HOMEDRIVE: 'C:',
          HOMEPATH: '\\Users\\Bob',
        },
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          isProcessAlive: () => true,
          lstat: async (path: string) => {
            if (path === homeDriveRoot) {
              return rootIdentity;
            }
            if (path === homeDriveRecordPath) {
              return recordIdentity;
            }
            throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
          },
          openFile: async () => memoryHandle(recordBytes, recordIdentity),
          realpath: async (path) => path,
          windowsPathTrust: {
            validate: async () => true,
          },
        },
      }),
    ).resolves.toEqual({
      ...discovered,
      record: {
        path: homeDriveRecordPath,
        device: recordIdentity.device,
        inode: recordIdentity.inode,
      },
    });
  });

  test('fails closed when Windows home resolution or trust validation is unavailable', async () => {
    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: {},
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          lstat: async () => {
            throw new Error('unused');
          },
          openFile: async () => {
            throw new Error('unused');
          },
          realpath: async (path) => path,
        },
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      retryable: true,
    });

    const winRoot = 'C:\\Users\\Alice\\.coven\\cave';
    const recordPath = `${winRoot}\\client-v1-discovery.json`;
    const rootIdentity = discoveredPathIdentity({
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = discoveredPathIdentity({
      size: Buffer.byteLength(discoveryRecord()),
    });
    const lstat = async (path: string) => {
      if (path === winRoot) {
        return rootIdentity;
      }
      if (path === recordPath) {
        return recordIdentity;
      }
      throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
    };

    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          isProcessAlive: () => true,
          lstat,
          openFile: async () => memoryHandle(discoveryRecord(), recordIdentity),
          realpath: async (path) => path,
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      retryable: false,
    });

    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          isProcessAlive: () => true,
          lstat,
          openFile: async () => memoryHandle(discoveryRecord(), recordIdentity),
          realpath: async (path) => path,
          windowsPathTrust: {
            validate: async () => false,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      retryable: false,
    });
  });

  test('uses default Unix collaborators, treats EPERM probes as live, and maps ENOENT late failures to not_found', async () => {
    const unixRoot = '/Users/example/.coven/cave';
    const unixRecordPath = `${unixRoot}/client-v1-discovery.json`;
    const rootIdentity = discoveredPathIdentity({
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = discoveredPathIdentity({
      size: Buffer.byteLength(discoveryRecord()),
    });
    const geteuid = vi.spyOn(process, 'geteuid').mockReturnValue(501);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
    });

    await expect(
      discoverCaveEndpoint({
        cwd: '/workspace',
        root: unixRoot,
        timeoutMs: 50,
        dependencies: {
          lstat: async (path: string) => {
            if (path === unixRoot) {
              return rootIdentity;
            }
            if (path === unixRecordPath) {
              return recordIdentity;
            }
            throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
          },
          openFile: async () => memoryHandle(discoveryRecord(), recordIdentity),
          realpath: async (path) => path,
        },
      }),
    ).resolves.toEqual({
      ...discovered,
      record: {
        path: unixRecordPath,
        device: recordIdentity.device,
        inode: recordIdentity.inode,
      },
    });

    expect(geteuid).toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(discovered.freshness.pid, 0);

    await expect(
      discoverCaveEndpoint({
        cwd: '/workspace',
        root: unixRoot,
        timeoutMs: 50,
        dependencies: {
          getEffectiveUid: () => 501,
          isProcessAlive: () => true,
          lstat: async (path: string) => {
            if (path === unixRoot) {
              return rootIdentity;
            }
            throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
          },
          openFile: async () => memoryHandle(discoveryRecord(), recordIdentity),
          realpath: async () => {
            throw Object.assign(new Error('gone'), { code: 'ENOENT' });
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
      retryable: true,
    });
  });

  test('rejects malformed discovery objects, unreadable empty records, and close failures', async () => {
    const unixRoot = '/Users/example/.coven/cave';
    const unixRecordPath = `${unixRoot}/client-v1-discovery.json`;
    const rootIdentity = discoveredPathIdentity({
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = discoveredPathIdentity({
      size: Buffer.byteLength(discoveryRecord()),
    });
    const baseDependencies = {
      getEffectiveUid: () => 501,
      isProcessAlive: () => true,
      lstat: async (path: string) => {
        if (path === unixRoot) {
          return rootIdentity;
        }
        if (path === unixRecordPath) {
          return recordIdentity;
        }
        throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
      },
      realpath: async (path: string) => path,
    };

    await expect(
      discoverCaveEndpoint({
        cwd: '/workspace',
        root: unixRoot,
        timeoutMs: 50,
        dependencies: {
          ...baseDependencies,
          openFile: async () => memoryHandle('[]', recordIdentity),
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });

    await expect(
      discoverCaveEndpoint({
        cwd: '/workspace',
        root: unixRoot,
        timeoutMs: 50,
        dependencies: {
          ...baseDependencies,
          openFile: async () => ({
            async read() {
              return { bytesRead: 999 };
            },
            async close() {
              return undefined;
            },
            async stat() {
              return recordIdentity;
            },
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });

    await expect(
      discoverCaveEndpoint({
        cwd: '/workspace',
        root: unixRoot,
        maxRecordBytes: 4,
        timeoutMs: 50,
        dependencies: {
          ...baseDependencies,
          openFile: async () => memoryHandle(discoveryRecord(), recordIdentity),
          lstat: async (path: string) => {
            if (path === unixRoot) {
              return rootIdentity;
            }
            if (path === unixRecordPath) {
              return {
                ...recordIdentity,
                size: 5,
              };
            }
            throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'body_limit',
      retryable: false,
    });

    vi.useFakeTimers();
    const closeTimeoutPromise = discoverCaveEndpoint({
      cwd: '/workspace',
      root: unixRoot,
      timeoutMs: 5,
      dependencies: {
        ...baseDependencies,
        openFile: async () =>
          memoryHandle(discoveryRecord(), recordIdentity, {
            close: async () => await new Promise(() => undefined),
          }),
      },
    });
    const closeTimeoutExpectation = expect(closeTimeoutPromise).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(5);
    await closeTimeoutExpectation;

    await expect(
      discoverCaveEndpoint({
        cwd: '/workspace',
        root: unixRoot,
        timeoutMs: 50,
        dependencies: {
          ...baseDependencies,
          openFile: async () => ({
            async read() {
              return { bytesRead: 0 };
            },
            async close() {
              return undefined;
            },
            async stat() {
              return recordIdentity;
            },
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
  });
});
