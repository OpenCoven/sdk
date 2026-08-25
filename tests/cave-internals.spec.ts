/* eslint-disable @typescript-eslint/require-await */

import { constants as fsConstants } from 'node:fs';

import {
  OperationTimeoutError,
  createSecretStoreReference,
  type SecretStore,
} from '@opencoven/sdk-core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  caveAuthorityBindingFromDiscoveredEndpoint,
  discardPairingExchangeBearer,
  parseCaveAuthorityBinding,
} from '../packages/cave/src/authority-binding.js';
import {
  forgetStoredCredential,
  inspectStoredCredentialMaterial,
  invalidateStoredCredential,
  loadBoundCredential,
  storeBoundCredential,
} from '../packages/cave/src/credential-binding-node.js';
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
import type * as CredentialBindingModule from '../packages/cave/src/credential-binding-node.js';

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
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const textEncoder = new TextEncoder();
const authorityBinding = caveAuthorityBindingFromDiscoveredEndpoint(
  discovered,
  '00000000-0000-4000-8000-000000000000',
);

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
    mutationCount(): number {
      return mutationIndex;
    },
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

function hashCredentialReferenceKey(key: string): string {
  const bytes = textEncoder.encode(key);
  let hash = FNV_OFFSET_BASIS_64;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
  }

  return hash.toString(16).padStart(16, '0');
}

function legacyCredentialKey(prefix: string, referenceKey: string): string {
  return `${prefix}${hashCredentialReferenceKey(referenceKey)}`;
}

async function storedCredentialValue(
  referenceKey: string,
  bearer = 'bearer',
) {
  const reference = createSecretStoreReference(referenceKey);
  const seeded = storeWithState();
  await storeBoundCredential(seeded, reference, bearer, authorityBinding);
  const value = seeded.values.get(reference.key);
  if (typeof value !== 'string') {
    throw new Error(`Expected a serialized credential record for ${reference.key}.`);
  }
  return value;
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
  test('stores, loads, invalidates, and forgets one atomic credential record', async () => {
    const reference = createSecretStoreReference('chat.cave');
    const store = storeWithState();

    await storeBoundCredential(store, reference, 'bearer', authorityBinding);

    expect(store.values.size).toBe(1);
    expect(JSON.parse(String(store.values.get(reference.key)))).toEqual({
      version: 1,
      bearer: 'bearer',
      authorityBinding,
    });
    await expect(
      loadBoundCredential(store, reference, discovered, (value) => value === 'bearer'),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer',
    });
    await expect(
      inspectStoredCredentialMaterial(store, reference, (value) => value === 'bearer'),
    ).resolves.toEqual({ status: 'present' });

    await expect(forgetStoredCredential(store, reference)).resolves.toBe(true);
    expect(store.values.size).toBe(0);

    await storeBoundCredential(store, reference, 'bearer-next', authorityBinding);
    await expect(invalidateStoredCredential(store, reference)).resolves.toBeUndefined();
    expect(store.values.size).toBe(0);
  });

  test('stores an opaque authority record identity instead of the discovery path', async () => {
    const reference = createSecretStoreReference('chat.cave.identity');
    const store = storeWithState();

    await storeBoundCredential(store, reference, 'bearer', authorityBinding);
    const serialized = String(store.values.get(reference.key));

    expect(serialized).toContain('"identity":"sha256:');
    expect(serialized).not.toContain(discovered.record.path);
    expect(serialized).not.toContain('"path"');
  });

  test('returns false only when forget confirms no stored credential state remains', async () => {
    const reference = createSecretStoreReference('chat.cave.absent');

    await expect(forgetStoredCredential(storeWithState(), reference)).resolves.toBe(false);
  });

  test('reports malformed, invalid, and mismatched atomic records conservatively', async () => {
    const reference = createSecretStoreReference('chat.cave.status');
    const validSerialized = await storedCredentialValue(reference.key);
    const invalidBearerSerialized = JSON.stringify({
      version: 1,
      bearer: 'not-a-bearer',
      authorityBinding,
    });

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
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_binding_invalid',
    });

    await expect(
      loadBoundCredential(
        storeWithState([[reference.key, 'bearer']]),
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
        storeWithState([[reference.key, '{bad-json']]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_binding_invalid',
    });

    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([[reference.key, '{bad-json']]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'incomplete' });

    await expect(
      loadBoundCredential(
        storeWithState([[reference.key, invalidBearerSerialized]]),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'invalid_bearer' });

    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([[reference.key, invalidBearerSerialized]]),
        reference,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'invalid_bearer' });

    await expect(
      loadBoundCredential(
        storeWithState([[reference.key, validSerialized]]),
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
        storeWithState([[reference.key, validSerialized]]),
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
        storeWithState([[reference.key, validSerialized]]),
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

  test('preserves a replacement written while an older instance proof is pending', async () => {
    const reference = createSecretStoreReference('chat.cave.instance-proof-race');
    const store = storeWithState();
    await storeBoundCredential(store, reference, 'bearer-old', authorityBinding);

    let resolveProof!: (matches: boolean) => void;
    let markProofStarted!: () => void;
    const proofStarted = new Promise<void>((resolve) => {
      markProofStarted = resolve;
    });
    const proof = new Promise<boolean>((resolve) => {
      resolveProof = resolve;
    });
    const loading = loadBoundCredential(
      store,
      reference,
      discovered,
      (value) => value.startsWith('bearer-'),
      {
        invalidateInvalid: true,
        verifyAuthorityInstance: () => {
          markProofStarted();
          return proof;
        },
      },
    );

    await proofStarted;
    await storeBoundCredential(store, reference, 'bearer-new', authorityBinding);
    resolveProof(false);

    await expect(loading).resolves.toEqual({
      status: 'invalid',
      reason: 'authority_restarted',
    });
    await expect(
      loadBoundCredential(store, reference, discovered, (value) => value === 'bearer-new'),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-new',
    });
  });

  test('rejects oversized and exact-schema-violating stored records', async () => {
    const reference = createSecretStoreReference('chat.cave.strict-schema');
    const cases = [
      JSON.stringify({
        version: 1,
        bearer: 'bearer',
        authorityBinding,
        extra: true,
      }),
      JSON.stringify({
        version: 1,
        bearer: 'bearer',
        authorityBinding: {
          ...authorityBinding,
          extra: true,
        },
      }),
      JSON.stringify({
        version: 1,
        bearer: 'b'.repeat(4_097),
        authorityBinding,
      }),
      JSON.stringify({
        version: 1,
        bearer: 'bearer',
        authorityBinding: {
          ...authorityBinding,
          instanceId: '',
        },
      }),
      JSON.stringify({
        version: 1,
        bearer: 'bearer',
        authorityBinding: {
          ...authorityBinding,
          freshness: {
            ...authorityBinding.freshness,
            nonce: '',
          },
        },
      }),
    ];

    for (const serialized of cases) {
      await expect(
        loadBoundCredential(
          storeWithState([[reference.key, serialized]]),
          reference,
          discovered,
          (value) => value === 'bearer',
        ),
      ).resolves.toEqual({
        status: 'invalid',
        reason: 'authority_binding_invalid',
      });
      await expect(
        inspectStoredCredentialMaterial(
          storeWithState([[reference.key, serialized]]),
          reference,
          (value) => value === 'bearer',
        ),
      ).resolves.toEqual({ status: 'incomplete' });
    }
  });

  test('rejects invalid authority bindings before any write begins', async () => {
    const reference = createSecretStoreReference('chat.cave.invalid-binding-write');
    const store = storeWithState();
    const invalidBinding = {
      ...authorityBinding,
      endpoint: {
        kind: 'https',
        url: authorityBinding.endpoint.url,
      },
    } as unknown as typeof authorityBinding;

    await expect(
      storeBoundCredential(store, reference, 'bearer', invalidBinding),
    ).rejects.toBeInstanceOf(TypeError);
    expect(store.values.size).toBe(0);
  });

  test('fails before writing when the operation context is already aborted or timed out', async () => {
    const reference = createSecretStoreReference('chat.cave.inactive-context');
    const set = vi.fn(async () => undefined);
    const store: SecretStore = {
      async get() {
        return undefined;
      },
      set,
      async delete() {
        return false;
      },
    };
    const aborted = new AbortController();
    const abortedReason = new Error('stop');
    aborted.abort(abortedReason);

    await expect(
      storeBoundCredential(store, reference, 'bearer', authorityBinding, {
        context: {
          signal: aborted.signal,
          deadline: undefined,
        },
      }),
    ).rejects.toBe(abortedReason);
    await expect(
      storeBoundCredential(store, reference, 'bearer', authorityBinding, {
        context: {
          signal: new AbortController().signal,
          deadline: performance.now() - 1,
        },
      }),
    ).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    });
    expect(set).not.toHaveBeenCalled();
  });

  test('ignores legacy split-key state on read and clears it on forget or invalidate', async () => {
    const reference = createSecretStoreReference('chat.cave.legacy');
    const currentSerialized = await storedCredentialValue(reference.key);
    const legacyEntries: Array<readonly [string, string]> = [
      [legacyCredentialKey(BINDING_KEY_PREFIX, reference.key), '{legacy-binding}'],
      [legacyCredentialKey(STAGING_KEY_PREFIX, reference.key), '{legacy-staging}'],
      [legacyCredentialKey(FAILURE_KEY_PREFIX, reference.key), '{legacy-failure}'],
      [legacyCredentialKey(OWNER_KEY_PREFIX, reference.key), '{legacy-owner}'],
    ];

    await expect(
      loadBoundCredential(
        storeWithState(legacyEntries),
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({ status: 'missing' });

    const legacyOnly = storeWithState(legacyEntries);
    await expect(forgetStoredCredential(legacyOnly, reference)).resolves.toBe(true);
    expect(legacyOnly.values.size).toBe(0);

    const currentAndLegacy = storeWithState([
      [reference.key, currentSerialized],
      ...legacyEntries,
    ]);
    await expect(
      loadBoundCredential(
        currentAndLegacy,
        reference,
        discovered,
        (value) => value === 'bearer',
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer',
    });
    await expect(invalidateStoredCredential(currentAndLegacy, reference)).resolves.toBeUndefined();
    expect(currentAndLegacy.values.size).toBe(0);
  });

  test('prefers a late set rejection over timeout when the write settles within grace', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.timeout.rejected-write');
      const setError = new Error('set failed');
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_resolve, reject) => {
        rejectTermination = reject;
      });
      void termination.catch(() => undefined);
      const store: SecretStore = {
        async get() {
          return undefined;
        },
        async set() {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          });
          throw setError;
        },
        async delete() {
          return false;
        },
      };

      const storing = storeBoundCredential(
        store,
        reference,
        'bearer',
        authorityBinding,
        {
          mutationGraceMs: 50,
          termination,
        },
      ).catch((error: unknown) => error);

      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'pairingExchange' }, 1));
      await vi.advanceTimersByTimeAsync(25);

      await expect(storing).resolves.toBe(setError);
    } finally {
      vi.useRealTimers();
    }
  });

  test('surfaces legacy cleanup failures from forget while invalidate stays best effort', async () => {
    const reference = createSecretStoreReference('chat.cave.legacy.delete-failure');
    const deleted: string[] = [];
    const store: SecretStore = {
      async get() {
        return undefined;
      },
      async set() {
        return undefined;
      },
      async delete(key) {
        deleted.push(key);
        throw new Error('legacy delete failed');
      },
    };

    await expect(forgetStoredCredential(store, reference)).rejects.toMatchObject({
      code: 'secret_store_delete_failed',
      retryable: false,
    });
    expect(deleted).toHaveLength(1);

    deleted.length = 0;
    await expect(invalidateStoredCredential(store, reference)).resolves.toBeUndefined();
    expect(deleted).toHaveLength(4);
  });

  test('keeps invalidate best effort but surfaces forget read/delete failures explicitly', async () => {
    const reference = createSecretStoreReference('chat.cave.failure-branches');
    const invalidateReadFailure: SecretStore = {
      async get() {
        throw new Error('read failed');
      },
      async set() {
        return undefined;
      },
      async delete() {
        return false;
      },
    };
    const invalidateDeleteFailure: SecretStore = {
      async get() {
        return '{bad-json';
      },
      async set() {
        return undefined;
      },
      async delete() {
        throw new Error('delete failed');
      },
    };
    const forgetReadFailure: SecretStore = {
      async get() {
        throw new Error('read failed');
      },
      async set() {
        return undefined;
      },
      async delete() {
        return false;
      },
    };
    const forgetDeleteFailure: SecretStore = {
      async get() {
        return '{bad-json';
      },
      async set() {
        return undefined;
      },
      async delete() {
        throw new Error('delete failed');
      },
    };

    await expect(invalidateStoredCredential(invalidateReadFailure, reference)).resolves.toBeUndefined();
    await expect(invalidateStoredCredential(invalidateDeleteFailure, reference)).resolves.toBeUndefined();
    await expect(forgetStoredCredential(forgetReadFailure, reference)).rejects.toMatchObject({
      code: 'secret_store_read_failed',
      retryable: false,
    });
    await expect(forgetStoredCredential(forgetDeleteFailure, reference)).rejects.toMatchObject({
      code: 'secret_store_delete_failed',
      retryable: false,
    });
    await expect(
      inspectStoredCredentialMaterial(
        storeWithState([[reference.key, 99]]),
        reference,
        () => true,
      ),
    ).resolves.toEqual({ status: 'incomplete' });
  });

  test('returns delayed read results that settle within the termination grace window', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.read.grace');
      const serialized = await storedCredentialValue(reference.key);
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_resolve, reject) => {
        rejectTermination = reject;
      });
      void termination.catch(() => undefined);
      const store: SecretStore = {
        async get() {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          });
          return serialized;
        },
        async set() {
          return undefined;
        },
        async delete() {
          return false;
        },
      };

      const inspected = inspectStoredCredentialMaterial(
        store,
        reference,
        (value) => value === 'bearer',
        {
          mutationGraceMs: 50,
          termination,
        },
      );

      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'status' }, 1));
      await vi.advanceTimersByTimeAsync(25);

      await expect(inspected).resolves.toEqual({ status: 'present' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('propagates timeout when a delayed read outlives the termination grace window', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.read.timeout');
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_resolve, reject) => {
        rejectTermination = reject;
      });
      void termination.catch(() => undefined);
      const store: SecretStore = {
        async get() {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          });
          return undefined;
        },
        async set() {
          return undefined;
        },
        async delete() {
          return false;
        },
      };

      const inspected = inspectStoredCredentialMaterial(store, reference, () => true, {
        mutationGraceMs: 1,
        termination,
      });
      const inspectedExpectation = expect(inspected).rejects.toBeInstanceOf(OperationTimeoutError);

      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'status' }, 1));
      await vi.advanceTimersByTimeAsync(5);

      await inspectedExpectation;
    } finally {
      vi.useRealTimers();
    }
  });

  test('ignores late rejected writes after timeout without scheduling cleanup deletes', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.write.late-reject');
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_resolve, reject) => {
        rejectTermination = reject;
      });
      void termination.catch(() => undefined);
      const setError = new Error('late set failed');
      const store = {
        get: vi.fn(async () => undefined),
        set: vi.fn(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          });
          throw setError;
        }),
        delete: vi.fn(async () => false),
      } satisfies SecretStore;

      const storing = storeBoundCredential(
        store,
        reference,
        'bearer',
        authorityBinding,
        {
          mutationGraceMs: 1,
          termination,
        },
      ).catch((error: unknown) => error);

      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'pairingExchange' }, 1));
      await vi.advanceTimersByTimeAsync(5);

      await expect(storing).resolves.toBeInstanceOf(OperationTimeoutError);
      await vi.advanceTimersByTimeAsync(25);
      await Promise.resolve();

      expect(store.delete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('fails retryably when forget loses exact-value ownership before delete to a newer record', async () => {
    const reference = createSecretStoreReference('chat.cave.forget.exact-match');
    const currentSerialized = await storedCredentialValue(reference.key, 'bearer-current');
    const newerSerialized = await storedCredentialValue(reference.key, 'bearer-newer');
    const values = new Map<string, string>([[reference.key, currentSerialized]]);
    let reads = 0;

    const store: SecretStore = {
      async get(key) {
        reads += 1;
        if (reads === 2) {
          values.set(key, newerSerialized);
        }
        return values.get(key);
      },
      async set(key, value) {
        values.set(key, value);
      },
      async delete(key) {
        return values.delete(key);
      },
    };

    await expect(forgetStoredCredential(store, reference)).rejects.toMatchObject({
      code: 'credential_update_in_progress',
      retryable: true,
    });
    await expect(loadBoundCredential(store, reference, discovered, (value) => value === 'bearer-newer'))
      .resolves.toEqual({
        status: 'ready',
        bearer: 'bearer-newer',
      });
  });

  test('uses atomic compare-and-delete to preserve a cross-process replacement', async () => {
    const reference = createSecretStoreReference('chat.cave.forget.atomic-exact-match');
    const currentSerialized = await storedCredentialValue(reference.key, 'bearer-current');
    const newerSerialized = await storedCredentialValue(reference.key, 'bearer-newer');
    const values = new Map<string, string>([[reference.key, currentSerialized]]);
    const deleteValue = vi.fn(() => Promise.resolve(values.delete(reference.key)));
    const compareAndDelete = vi.fn(
      async (
        key: string,
        expectedValue: string,
      ): Promise<'absent' | 'changed' | 'deleted'> => {
        values.set(key, newerSerialized);
        const current = values.get(key);
        if (current === undefined) {
          return 'absent';
        }
        if (current !== expectedValue) {
          return 'changed';
        }
        values.delete(key);
        return 'deleted';
      },
    );
    const store: SecretStore = {
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value);
      },
      delete: deleteValue,
      compareAndDelete,
    };

    await expect(forgetStoredCredential(store, reference)).rejects.toMatchObject({
      code: 'credential_update_in_progress',
      retryable: true,
    });
    expect(compareAndDelete).toHaveBeenCalledWith(reference.key, currentSerialized);
    expect(deleteValue).not.toHaveBeenCalled();
    await expect(
      loadBoundCredential(store, reference, discovered, (value) => value === 'bearer-newer'),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-newer',
    });
  });

  test('keeps duplicate-module concurrent writers coherent and atomic', async () => {
    const duplicateModuleUrl = new URL(
      `../packages/cave/src/credential-binding.ts?duplicate=${Date.now()}`,
      import.meta.url,
    ).href;
    const duplicateModule = (await import(
      /* @vite-ignore */ duplicateModuleUrl
    )) as DuplicateCredentialBindingModule;
    const reference = createSecretStoreReference('chat.cave.concurrent.writer');
    const controlled = createControlledMutationStore([1, 2]);

    const first = storeBoundCredential(
      controlled.store,
      reference,
      'bearer-first',
      authorityBinding,
    );
    await controlled.waitForMutationStart(1);

    const second = duplicateModule.storeBoundCredential(
      controlled.store,
      reference,
      'bearer-second',
      authorityBinding,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(controlled.mutationCount()).toBe(1);

    controlled.unblockMutation(1);
    await controlled.waitForMutationStart(2);
    controlled.unblockMutation(2);

    await expect(first).resolves.toBeUndefined();
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
    expect(JSON.parse(String(controlled.values.get(reference.key)))).toEqual({
      version: 1,
      bearer: 'bearer-second',
      authorityBinding,
    });
  });

  test('cleans a late timed-out write if its exact value lands after prompt timeout', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.timeout.cleanup');
      const controlled = createControlledMutationStore([1]);
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_resolve, reject) => {
        rejectTermination = reject;
      });
      void termination.catch(() => undefined);

      const storing = storeBoundCredential(
        controlled.store,
        reference,
        'bearer-timeout',
        authorityBinding,
        {
          mutationGraceMs: 1,
          termination,
        },
      ).catch((error: unknown) => error);

      await controlled.waitForMutationStart(1);
      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'pairingExchange' }, 1));
      await vi.advanceTimersByTimeAsync(5);

      const error = await storing;
      expect(error).toBeInstanceOf(OperationTimeoutError);
      expect(controlled.values.get(reference.key)).toBeUndefined();

      controlled.unblockMutation(1);
      await controlled.waitForMutationStart(2);
      await Promise.resolve();
      await Promise.resolve();

      await expect(controlled.store.get(reference.key)).resolves.toBeUndefined();
      expect(controlled.log).toEqual([
        { mutation: 1, method: 'set', key: reference.key, phase: 'start' },
        { mutation: 1, method: 'set', key: reference.key, phase: 'finish' },
        { mutation: 2, method: 'delete', key: reference.key, phase: 'start' },
        { mutation: 2, method: 'delete', key: reference.key, phase: 'finish' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('preserves a newer successful write against timed-out cleanup by value', async () => {
    vi.useFakeTimers();

    try {
      const reference = createSecretStoreReference('chat.cave.timeout.preserve-newer');
      const controlled = createControlledMutationStore([1, 2]);
      let rejectTermination!: (reason?: unknown) => void;
      const termination = new Promise<never>((_resolve, reject) => {
        rejectTermination = reject;
      });
      void termination.catch(() => undefined);

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
      await controlled.waitForMutationStart(1);

      rejectTermination(new OperationTimeoutError({ system: 'cave', operation: 'pairingExchange' }, 1));
      await vi.advanceTimersByTimeAsync(5);

      const second = storeBoundCredential(
        controlled.store,
        reference,
        'bearer-second',
        authorityBinding,
      );

      controlled.unblockMutation(1);
      await controlled.waitForMutationStart(2);
      controlled.unblockMutation(2);

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
    } finally {
      vi.useRealTimers();
    }
  });

  test('concurrent reads during a write see the old or new coherent record only', async () => {
    const reference = createSecretStoreReference('chat.cave.concurrent.read');
    const controlled = createControlledMutationStore([2]);

    await storeBoundCredential(
      controlled.store,
      reference,
      'bearer-old',
      authorityBinding,
    );

    const storing = storeBoundCredential(
      controlled.store,
      reference,
      'bearer-new',
      authorityBinding,
    );
    await controlled.waitForMutationStart(2);

    await expect(
      loadBoundCredential(
        controlled.store,
        reference,
        discovered,
        (value) => value.startsWith('bearer-'),
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-old',
    });
    await expect(
      inspectStoredCredentialMaterial(
        controlled.store,
        reference,
        (value) => value.startsWith('bearer-'),
      ),
    ).resolves.toEqual({ status: 'present' });

    controlled.unblockMutation(2);

    await expect(storing).resolves.toBeUndefined();
    await expect(
      loadBoundCredential(
        controlled.store,
        reference,
        discovered,
        (value) => value.startsWith('bearer-'),
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-new',
    });
  });

  test('serializes concurrent same-module forget and store operations on one reference', async () => {
    const reference = createSecretStoreReference('chat.cave.concurrent.forget');
    const controlled = createControlledMutationStore([1]);

    const storePromise = storeBoundCredential(
      controlled.store,
      reference,
      'bearer-store',
      authorityBinding,
    );
    await controlled.waitForMutationStart(1);

    const forgetPromise = forgetStoredCredential(controlled.store, reference);
    controlled.unblockMutation(1);

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

  test('lets a new write remain when it races after a forget delete', async () => {
    const duplicateModuleUrl = new URL(
      `../packages/cave/src/credential-binding.ts?duplicate=${Date.now() + 1}`,
      import.meta.url,
    ).href;
    const duplicateModule = (await import(
      /* @vite-ignore */ duplicateModuleUrl
    )) as DuplicateCredentialBindingModule;
    const reference = createSecretStoreReference('chat.cave.forget.write-race');
    const currentSerialized = await storedCredentialValue(reference.key, 'bearer-current');
    const values = new Map<string, string>([[reference.key, currentSerialized]]);
    const afterDelete = deferred<void>();
    const store: SecretStore = {
      async get(key) {
        return values.get(key);
      },
      async set(key, value) {
        await afterDelete.promise;
        values.set(key, value);
      },
      async delete(key) {
        const deleted = values.delete(key);
        afterDelete.resolve();
        return deleted;
      },
    };

    const forgetting = forgetStoredCredential(store, reference);
    const storing = duplicateModule.storeBoundCredential(
      store,
      reference,
      'bearer-next',
      authorityBinding,
    );

    await expect(forgetting).resolves.toBe(true);
    await expect(storing).resolves.toBeUndefined();
    await expect(
      loadBoundCredential(
        store,
        reference,
        discovered,
        (value) => value.startsWith('bearer-'),
      ),
    ).resolves.toEqual({
      status: 'ready',
      bearer: 'bearer-next',
    });
  });
});

describe('Cave authority binding helpers', () => {
  test('parses valid authority bindings and rejects malformed shapes', () => {
    expect(parseCaveAuthorityBinding(authorityBinding)).toEqual(authorityBinding);
    expect(parseCaveAuthorityBinding({ version: 2 })).toBeUndefined();
    expect(
      parseCaveAuthorityBinding({
        ...authorityBinding,
        instanceId: '',
      }),
    ).toBeUndefined();
    expect(
      parseCaveAuthorityBinding({
        ...authorityBinding,
        endpoint: {
          kind: 'https',
          url: authorityBinding.endpoint.url,
        },
      }),
    ).toBeUndefined();
    expect(
      parseCaveAuthorityBinding({
        ...authorityBinding,
        record: {
          ...authorityBinding.record,
          device: -1,
        },
      }),
    ).toBeUndefined();
    expect(
      parseCaveAuthorityBinding({
        ...authorityBinding,
        freshness: {
          ...authorityBinding.freshness,
          startedAt: '',
        },
      }),
    ).toBeUndefined();
  });

  test('best-effort clears pairing exchange bearers and ignores setter failures', () => {
    const exchange = { bearer: 'secret-bearer' };
    discardPairingExchangeBearer(exchange);
    expect(exchange.bearer).toBe('');

    expect(() => discardPairingExchangeBearer('secret-bearer')).not.toThrow();

    const throwingSetter = new Proxy(
      {},
      {
        set() {
          throw new Error('setter failed');
        },
      },
    );
    expect(() => discardPairingExchangeBearer(throwingSetter)).not.toThrow();
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
      inode: 0,
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = discoveredPathIdentity({
      inode: 0,
      size: Buffer.byteLength(recordBytes),
    });
    const validate = vi.fn(async (_path: string, purpose: 'root' | 'record') => ({
      trusted: true as const,
      identity: `windows-${purpose}-identity`,
    }));
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
            validateOpenedFile: async () => ({
              trusted: true,
              identity: 'windows-record-identity',
            }),
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
            validate: async (_path, purpose) => ({
              trusted: true,
              identity: `windows-${purpose}-identity`,
            }),
            validateOpenedFile: async () => ({
              trusted: true,
              identity: 'windows-record-identity',
            }),
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

  test('requires stable native Windows identity when filesystem identity is unavailable', async () => {
    const root = 'C:\\Users\\Alice\\.coven\\cave';
    const recordPath = `${root}\\client-v1-discovery.json`;
    const recordBytes = discoveryRecord();
    const rootIdentity = discoveredPathIdentity({
      device: 0,
      inode: 0,
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = discoveredPathIdentity({
      device: 0,
      inode: 0,
      size: Buffer.byteLength(recordBytes),
    });
    const lstat = (path: string) => {
      if (path === root) {
        return Promise.resolve(rootIdentity);
      }
      if (path === recordPath) {
        return Promise.resolve(recordIdentity);
      }
      return Promise.reject(Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' }));
    };

    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: { USERPROFILE: 'C:\\Users\\Alice' },
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          isProcessAlive: () => true,
          lstat,
          openFile: () => Promise.resolve(memoryHandle(recordBytes, recordIdentity)),
          realpath: (path) => Promise.resolve(path),
          windowsPathTrust: {
            validate: () => Promise.resolve(true),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      retryable: false,
    });

    let recordValidations = 0;
    await expect(
      discoverCaveEndpoint({
        cwd: 'C:\\workspace',
        env: { USERPROFILE: 'C:\\Users\\Alice' },
        platform: 'win32',
        timeoutMs: 50,
        dependencies: {
          isProcessAlive: () => true,
          lstat,
          openFile: () => Promise.resolve(memoryHandle(recordBytes, recordIdentity)),
          realpath: (path) => Promise.resolve(path),
          windowsPathTrust: {
            validate: (_path, purpose) =>
              Promise.resolve({
                trusted: true,
                identity: purpose === 'root' ? 'root-id' : 'record-id',
              }),
            validateOpenedFile: () =>
              Promise.resolve({
                trusted: true,
                identity: `record-id-${++recordValidations}`,
              }),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      retryable: false,
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
