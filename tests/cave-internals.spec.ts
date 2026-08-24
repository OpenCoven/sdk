/* eslint-disable @typescript-eslint/require-await */

import { constants as fsConstants } from 'node:fs';

import {
  OperationTimeoutError,
  createSecretStoreReference,
  type SecretStore,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { caveAuthorityBindingFromDiscoveredEndpoint } from '../packages/cave/src/authority-binding.js';
import {
  forgetStoredCredential,
  inspectStoredCredentialMaterial,
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
import type * as CredentialBindingModule from '../packages/cave/src/credential-binding.js';

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

const BINDING_KEY_PREFIX = 'opencoven.cave.credential-binding.v1.';
const STAGING_KEY_PREFIX = 'opencoven.cave.credential-binding.staging.v1.';
const FAILURE_KEY_PREFIX = 'opencoven.cave.credential-binding.failure.v1.';
const OWNER_KEY_PREFIX = 'opencoven.cave.credential-binding.owner.v1.';
const authorityBinding = caveAuthorityBindingFromDiscoveredEndpoint(discovered);

type DuplicateCredentialBindingModule = typeof CredentialBindingModule;

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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createControlledMutationStore(blockedMutations: readonly number[] = []) {
  const values = new Map<string, string>();
  const blocked = new Map<number, ReturnType<typeof deferred<void>>>();
  const log: Array<{ mutation: number; method: 'set' | 'delete'; key: string; phase: 'start' | 'finish' }> = [];
  const startedResolvers = new Map<number, () => void>();
  const started = new Map<number, Promise<void>>();
  let mutationIndex = 0;

  for (const mutation of blockedMutations) {
    blocked.set(mutation, deferred<void>());
  }

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

  const store: SecretStore = {
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      mutationIndex += 1;
      const current = mutationIndex;
      log.push({ mutation: current, method: 'set', key, phase: 'start' });
      signalMutationStart(current);
      await blocked.get(current)?.promise;
      values.set(key, value);
      log.push({ mutation: current, method: 'set', key, phase: 'finish' });
    },
    async delete(key) {
      mutationIndex += 1;
      const current = mutationIndex;
      log.push({ mutation: current, method: 'delete', key, phase: 'start' });
      signalMutationStart(current);
      await blocked.get(current)?.promise;
      const deleted = values.delete(key);
      log.push({ mutation: current, method: 'delete', key, phase: 'finish' });
      return deleted;
    },
  };

  return {
    log,
    store,
    unblockMutation(mutation: number): void {
      blocked.get(mutation)?.resolve();
    },
    values,
    waitForMutationStart,
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

function storedKeyWithPrefix(store: MutableStore, prefix: string): string {
  const key = [...store.values.keys()].find((candidate) => candidate.startsWith(prefix));
  if (key === undefined) {
    throw new Error(`Expected stored key for ${prefix}.`);
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

    await storeBoundCredential(store, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(store, BINDING_KEY_PREFIX);

    expect(String(store.values.get(metadataKey))).toContain('"state":"bound"');
    await expect(
      loadBoundCredential(store, reference, discovered, (value) => value === 'bearer'),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer',
    });

    await expect(forgetStoredCredential(store, reference)).resolves.toBe(true);
    expect(store.values.size).toBe(0);

    await storeBoundCredential(store, reference, 'bearer', authorityBinding);
    await expect(invalidateStoredCredential(store, reference)).resolves.toBeUndefined();
    expect(store.values.size).toBe(0);
  });

  test('stores an opaque authority record identity instead of the discovery path', async () => {
    const reference = createSecretStoreReference('chat.cave.identity');
    const store = storeWithState();

    await storeBoundCredential(store, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(store, BINDING_KEY_PREFIX);
    const serialized = String(store.values.get(metadataKey));

    expect(serialized).toContain('"identity":"sha256:');
    expect(serialized).not.toContain(discovered.record.path);
    expect(serialized).not.toContain('"path"');
  });

  test('reports invalid bound-credential states and reconciliation reasons', async () => {
    const reference = createSecretStoreReference('chat.cave.status');
    const seeded = storeWithState();
    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(seeded, BINDING_KEY_PREFIX);
    const failureKey = `${FAILURE_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const ownerKey = `${OWNER_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const stagingKey = `${STAGING_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;

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
        storeWithState([[metadataKey, seeded.values.get(metadataKey)]]),
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
        storeWithState([
          [failureKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.failure.v1', transactionId: 'tx-1' })],
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
        storeWithState([[failureKey, '{bad-json']]),
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
          [stagingKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.staging.v1', transactionId: 'tx-1' })],
        ]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'update_in_progress' });

    await expect(
      loadBoundCredential(
        storeWithState([[stagingKey, '{bad-json']]),
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
          [metadataKey, seeded.values.get(metadataKey)],
          [ownerKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.owner.v1', transactionId: 'tx-other' })],
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
      inspectStoredCredentialMaterial(
        storeWithState([
          [failureKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.failure.v1', transactionId: 'tx-2' })],
        ]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'incomplete' });

    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([[reference.key, 'not-a-bearer']]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'invalid_bearer' });

    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([
          [stagingKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.staging.v1', transactionId: 'tx-2' })],
        ]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'update_in_progress' });

    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([
          [reference.key, 'bearer'],
          [metadataKey, seeded.values.get(metadataKey)],
          [ownerKey, '{bad-json'],
        ]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'incomplete' });

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
        storeWithState([
          [reference.key, 'bearer'],
          [metadataKey, String(seeded.values.get(metadataKey)).replace('"bound"', '"pending"')],
          [ownerKey, seeded.values.get(ownerKey)],
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

  test('preserves a newer committed credential when stale failed markers linger', async () => {
    const reference = createSecretStoreReference('chat.cave.stale.failure');
    const store = storeWithState();

    await storeBoundCredential(store, reference, 'bearer-current', authorityBinding);
    const metadataKey = storedKeyWithPrefix(store, BINDING_KEY_PREFIX);
    const failureKey = `${FAILURE_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const stagingKey = `${STAGING_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;

    store.values.set(
      failureKey,
      JSON.stringify({ schema: 'opencoven.cave.credential-binding.failure.v1', transactionId: 'tx-old' }),
    );
    store.values.set(
      stagingKey,
      JSON.stringify({ schema: 'opencoven.cave.credential-binding.staging.v1', transactionId: 'tx-old' }),
    );

    await expect(
      loadBoundCredential(
        store,
        reference,
        discovered,
        (value) => value === 'bearer-current',
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-current',
    });
    await expect(
      inspectStoredCredentialMaterial(
        store,
        reference,
        (value) => value === 'bearer-current',
      ),
    ).resolves.toEqual({ status: 'present' });
  });

  test('cleans orphaned owned partial state when ownership is still provable', async () => {
    const reference = createSecretStoreReference('chat.cave.orphaned.partial');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(seeded, BINDING_KEY_PREFIX);
    const ownerKey = `${OWNER_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const orphaned = storeWithState([
      [metadataKey, seeded.values.get(metadataKey)],
      [ownerKey, seeded.values.get(ownerKey)],
    ]);

    await expect(invalidateStoredCredential(orphaned, reference)).resolves.toBeUndefined();
    await expect(
      loadBoundCredential(orphaned, reference, discovered, (value) => value === 'bearer'),
    ).resolves.toEqual({ status: 'missing' });
    expect(orphaned.values.size).toBe(0);
  });

  test('cleans metadata-only orphaned state when no owner or bearer remains', async () => {
    const reference = createSecretStoreReference('chat.cave.metadata.only');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(seeded, BINDING_KEY_PREFIX);
    const metadataOnly = storeWithState([[metadataKey, seeded.values.get(metadataKey)]]);

    await expect(invalidateStoredCredential(metadataOnly, reference)).resolves.toBeUndefined();
    await expect(
      loadBoundCredential(metadataOnly, reference, discovered, (value) => value === 'bearer'),
    ).resolves.toEqual({ status: 'missing' });
    expect(metadataOnly.values.size).toBe(0);
  });

  test('leaves active staging and structurally invalid snapshots untouched during automatic invalidation', async () => {
    const reference = createSecretStoreReference('chat.cave.invalidate.noop');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(seeded, BINDING_KEY_PREFIX);
    const ownerKey = `${OWNER_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const stagingKey = `${STAGING_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const active = storeWithState([
      [reference.key, 'bearer'],
      [metadataKey, seeded.values.get(metadataKey)],
      [ownerKey, seeded.values.get(ownerKey)],
      [stagingKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.staging.v1', transactionId: 'tx-active' })],
    ]);
    const invalid = storeWithState([[stagingKey, '{bad-json']]);

    await expect(invalidateStoredCredential(active, reference)).resolves.toBeUndefined();
    await expect(invalidateStoredCredential(invalid, reference)).resolves.toBeUndefined();

    expect(active.values.size).toBe(4);
    expect(invalid.values.size).toBe(1);
  });

  test('clears stale failed markers alongside a newer owned invalidation target', async () => {
    const reference = createSecretStoreReference('chat.cave.invalidate.stale-failure');
    const store = storeWithState();

    await storeBoundCredential(store, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(store, BINDING_KEY_PREFIX);
    const failureKey = `${FAILURE_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const stagingKey = `${STAGING_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    store.values.set(
      failureKey,
      JSON.stringify({ schema: 'opencoven.cave.credential-binding.failure.v1', transactionId: 'tx-old' }),
    );
    store.values.set(
      stagingKey,
      JSON.stringify({ schema: 'opencoven.cave.credential-binding.staging.v1', transactionId: 'tx-old' }),
    );

    await expect(invalidateStoredCredential(store, reference)).resolves.toBeUndefined();
    expect(store.values.size).toBe(0);
  });

  test('cleans a failed staged transaction when binding ownership still matches', async () => {
    const reference = createSecretStoreReference('chat.cave.invalidate.failed-staging');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(seeded, BINDING_KEY_PREFIX);
    const failureKey = `${FAILURE_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const stagingKey = `${STAGING_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const transactionId = (
      JSON.parse(String(seeded.values.get(metadataKey))) as { transactionId: string }
    ).transactionId;
    const failed = storeWithState([
      [reference.key, 'bearer'],
      [metadataKey, seeded.values.get(metadataKey)],
      [failureKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.failure.v1', transactionId })],
      [stagingKey, JSON.stringify({ schema: 'opencoven.cave.credential-binding.staging.v1', transactionId })],
    ]);

    await expect(invalidateStoredCredential(failed, reference)).resolves.toBeUndefined();
    expect(failed.values.size).toBe(0);
  });

  test('swallows invalidation delete failures and reports whether any credential material was forgotten', async () => {
    const reference = createSecretStoreReference('chat.cave.delete');
    const first = storeWithState();
    await storeBoundCredential(first, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(first, BINDING_KEY_PREFIX);

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

  test('returns false when explicit forget cannot delete the observed snapshot', async () => {
    const reference = createSecretStoreReference('chat.cave.forget.failure');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const failingStore: SecretStore = {
      async get(key) {
        return seeded.values.get(key) as string | undefined;
      },
      async set() {
        return undefined;
      },
      async delete() {
        throw new Error('delete failed');
      },
    };

    await expect(forgetStoredCredential(failingStore, reference)).resolves.toBe(false);
  });

  test('returns false when explicit forget cannot re-read the observed snapshot', async () => {
    const reference = createSecretStoreReference('chat.cave.forget.reread');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    let reads = 0;
    const failingRereadStore: SecretStore = {
      async get(key) {
        reads += 1;
        if (reads > 5) {
          throw new Error('read failed');
        }
        return seeded.values.get(key) as string | undefined;
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        return seeded.values.delete(key);
      },
    };

    await expect(forgetStoredCredential(failingRereadStore, reference)).resolves.toBe(false);
  });

  test('reports stable metadata without a matching owner as incomplete material', async () => {
    const reference = createSecretStoreReference('chat.cave.inspect.incomplete');
    const seeded = storeWithState();

    await storeBoundCredential(seeded, reference, 'bearer', authorityBinding);
    const metadataKey = storedKeyWithPrefix(seeded, BINDING_KEY_PREFIX);

    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([
          [reference.key, 'bearer'],
          [metadataKey, seeded.values.get(metadataKey)],
        ]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'incomplete' });
  });

  test('treats duplicate-module reads during staging as update-in-progress and preserves the commit', async () => {
    const duplicateModuleUrl = new URL(
      `../packages/cave/src/credential-binding.ts?duplicate=${Date.now()}`,
      import.meta.url,
    ).href;
    const duplicateModule = (await import(
      /* @vite-ignore */ duplicateModuleUrl
    )) as DuplicateCredentialBindingModule;
    const reference = createSecretStoreReference('chat.cave.duplicate.reader');
    const controlled = createControlledMutationStore([2]);

    const storing = storeBoundCredential(
      controlled.store,
      reference,
      'bearer-current',
      authorityBinding,
    );
    await controlled.waitForMutationStart(2);

    await expect(
      duplicateModule.loadBoundCredential(
        controlled.store,
        reference,
        discovered,
        (value) => value === 'bearer-current',
      ),
    ).resolves.toEqual({ status: 'update_in_progress' });

    controlled.unblockMutation(2);

    await expect(storing).resolves.toBeUndefined();
    await expect(
      loadBoundCredential(
        controlled.store,
        reference,
        discovered,
        (value) => value === 'bearer-current',
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-current',
    });
  });

  test('returns false for a duplicate-module forget during active staging and preserves the newer commit', async () => {
    const duplicateModuleUrl = new URL(
      `../packages/cave/src/credential-binding.ts?duplicate=${Date.now() + 1}`,
      import.meta.url,
    ).href;
    const duplicateModule = (await import(
      /* @vite-ignore */ duplicateModuleUrl
    )) as DuplicateCredentialBindingModule;
    const reference = createSecretStoreReference('chat.cave.duplicate.forget');
    const controlled = createControlledMutationStore([2]);

    const storing = storeBoundCredential(
      controlled.store,
      reference,
      'bearer-committed',
      authorityBinding,
    );
    await controlled.waitForMutationStart(2);

    await expect(
      duplicateModule.forgetStoredCredential(controlled.store, reference),
    ).resolves.toBe(false);

    controlled.unblockMutation(2);

    await expect(storing).resolves.toBeUndefined();
    await expect(
      loadBoundCredential(
        controlled.store,
        reference,
        discovered,
        (value) => value === 'bearer-committed',
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-committed',
    });
  });

  test('preserves a later concurrent credential store after an earlier timeout rollback', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.concurrent.store');
      const controlled = createControlledMutationStore([5]);
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_, reject) => {
        rejectTermination = reject;
      });

      const first = storeBoundCredential(
        controlled.store,
        reference,
        'bearer-first',
        authorityBinding,
        {
          mutationGraceMs: 1,
          termination,
        },
      ).catch((error: unknown) => error);

      await controlled.waitForMutationStart(5);
      const second = storeBoundCredential(
        controlled.store,
        reference,
        'bearer-second',
        authorityBinding,
      );

      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'pairingExchange' }, 1));
      await vi.advanceTimersByTimeAsync(5);
      controlled.unblockMutation(5);

      const firstError = await first;
      expect(firstError).toBeInstanceOf(OperationTimeoutError);
      await expect(second).resolves.toBeUndefined();
      await expect(
        loadBoundCredential(
          controlled.store,
          reference,
          discovered,
          (value) => value.startsWith('bearer-'),
        ),
      ).resolves.toEqual({
        status: 'ready',
        bearer: 'bearer-second',
      });
      await expect(controlled.store.get(reference.key)).resolves.toBe('bearer-second');
    } finally {
      vi.useRealTimers();
    }
  });

  test('serializes concurrent forget and store operations on the same reference', async () => {
    const reference = createSecretStoreReference('chat.cave.concurrent.forget');
    const controlled = createControlledMutationStore([4]);

    const storePromise = storeBoundCredential(
      controlled.store,
      reference,
      'bearer-store',
      authorityBinding,
    );
    await controlled.waitForMutationStart(4);

    const forgetPromise = forgetStoredCredential(controlled.store, reference);
    controlled.unblockMutation(4);

    await expect(storePromise).resolves.toBeUndefined();
    await expect(forgetPromise).resolves.toBe(true);
    await expect(
      loadBoundCredential(
        controlled.store,
        reference,
        discovered,
        (value) => value === 'bearer-store',
      ),
    ).resolves.toEqual({ status: 'missing' });
  });

  test('keeps a newer committed credential when rollback ownership no longer matches', async () => {
    const reference = createSecretStoreReference('chat.cave.rollback.owner');
    const committed = storeWithState();
    await storeBoundCredential(committed, reference, 'bearer-current', authorityBinding);
    const metadataKey = storedKeyWithPrefix(committed, BINDING_KEY_PREFIX);
    const ownerKey = `${OWNER_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const failureKey = `${FAILURE_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const stagingKey = `${STAGING_KEY_PREFIX}${metadataKey.slice(BINDING_KEY_PREFIX.length)}`;
    const deleted: string[] = [];
    const values = new Map<string, string>();
    let writeCount = 0;

    const store: SecretStore = {
      async get(key) {
        return values.get(key);
      },
      async set(key, value) {
        writeCount += 1;
        if (writeCount === 5) {
          const originalStaging = values.get(stagingKey);
          values.clear();
          for (const [entryKey, entryValue] of committed.values) {
            values.set(entryKey, String(entryValue));
          }
          if (originalStaging !== undefined) {
            values.set(stagingKey, originalStaging);
          }
          throw new Error('late bound write failed');
        }

        values.set(key, value);
      },
      async delete(key) {
        deleted.push(key);
        return values.delete(key);
      },
    };

    const error = await storeBoundCredential(
      store,
      reference,
      'bearer-first',
      authorityBinding,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(values.get(reference.key)).toBe('bearer-current');
    expect(values.get(metadataKey)).toBe(committed.values.get(metadataKey));
    expect(values.get(ownerKey)).toBe(committed.values.get(ownerKey));
    expect(values.has(failureKey)).toBe(false);
    expect(values.has(stagingKey)).toBe(false);
    expect(deleted).toContain(failureKey);
    expect(deleted).toContain(stagingKey);
    expect(deleted).not.toContain(reference.key);
    expect(deleted).not.toContain(metadataKey);
    expect(deleted).not.toContain(ownerKey);
  });

  test('allows distinct references to mutate in parallel', async () => {
    const firstReference = createSecretStoreReference('chat.cave.parallel.first');
    const secondReference = createSecretStoreReference('chat.cave.parallel.second');
    const controlled = createControlledMutationStore([1]);

    const first = storeBoundCredential(
      controlled.store,
      firstReference,
      'bearer-first',
      authorityBinding,
    );
    await controlled.waitForMutationStart(1);

    let secondSettled = false;
    const second = storeBoundCredential(
      controlled.store,
      secondReference,
      'bearer-second',
      authorityBinding,
    ).then(() => {
      secondSettled = true;
    });
    const secondOutcome = await Promise.race([
      second.then(() => 'done' as const),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => resolve('pending'), 0);
      }),
    ]);
    expect(secondOutcome).toBe('done');
    expect(secondSettled).toBe(true);

    controlled.unblockMutation(1);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    await expect(controlled.store.get(secondReference.key)).resolves.toBe('bearer-second');
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
