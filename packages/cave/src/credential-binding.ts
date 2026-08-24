import {
  isOperationAbortedError,
  isOperationTimeoutError,
  type OperationContext,
  type SecretStore,
  type SecretStoreReference,
} from '@opencoven/sdk-core';

import { caveAuthorityBindingFromDiscoveredEndpoint } from './authority-binding.js';
import type { CaveDiscoveredEndpoint } from './discovery.js';
import type { CaveAuthorityBinding } from './schemas.js';

const CAVE_STORED_CREDENTIAL_VERSION = 1 as const;
const CAVE_CREDENTIAL_STORE_GRACE_MS = 250;
const CAVE_STORED_CREDENTIAL_RECORD_MAX_BYTES = 8 * 1024;
const CAVE_STORED_CREDENTIAL_BEARER_MAX_LENGTH = 4 * 1024;
const CAVE_STORED_CREDENTIAL_ENDPOINT_MAX_LENGTH = 2 * 1024;
const CAVE_STORED_CREDENTIAL_IDENTITY_MAX_LENGTH = 512;
const CAVE_STORED_CREDENTIAL_NONCE_MAX_LENGTH = 512;
const CAVE_STORED_CREDENTIAL_STARTED_AT_MAX_LENGTH = 128;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const SECRET_STORE_LOGICAL_ID = Symbol.for('@opencoven/sdk-core/secret-store-logical-id');
const CREDENTIAL_MUTATION_REGISTRY = Symbol.for(
  '@opencoven/cave-client/credential-mutation-registry',
);
const textEncoder = new TextEncoder();
const LEGACY_CREDENTIAL_KEY_PREFIXES = [
  'opencoven.cave.credential-binding.v1.',
  'opencoven.cave.credential-binding.staging.v1.',
  'opencoven.cave.credential-binding.failure.v1.',
  'opencoven.cave.credential-binding.owner.v1.',
] as const;

interface CredentialMutationRegistry {
  readonly referenceQueues: Map<string, Promise<void>>;
  readonly concreteQueues: Map<string, Promise<void>>;
  readonly storeLogicalIds: WeakMap<object, string>;
  nextStoreLogicalId: number;
}

function credentialMutationRegistry(): CredentialMutationRegistry {
  const existing: unknown = Reflect.get(globalThis, CREDENTIAL_MUTATION_REGISTRY);
  if (typeof existing === 'object' && existing !== null) {
    return existing as CredentialMutationRegistry;
  }

  const created: CredentialMutationRegistry = {
    referenceQueues: new Map(),
    concreteQueues: new Map(),
    storeLogicalIds: new WeakMap(),
    nextStoreLogicalId: 0,
  };
  Object.defineProperty(globalThis, CREDENTIAL_MUTATION_REGISTRY, {
    configurable: false,
    enumerable: false,
    value: created,
    writable: false,
  });
  return created;
}

const mutationRegistry = credentialMutationRegistry();

export type CaveStoredCredentialMismatchReason =
  | 'authority_mismatch'
  | 'authority_restarted'
  | 'record_replaced';

export type CaveStoredCredentialInvalidReason =
  | CaveStoredCredentialMismatchReason
  | 'authority_binding_invalid';

export type LoadedCaveCredential =
  | { status: 'missing' }
  | { status: 'invalid_bearer' }
  | { status: 'invalid'; reason: CaveStoredCredentialInvalidReason }
  | { status: 'ready'; bearer: string };

export type StoredCaveCredentialMaterial =
  | { status: 'missing' }
  | { status: 'present' }
  | { status: 'invalid_bearer' }
  | { status: 'incomplete' };

interface CredentialBindingMutationOptions {
  context?: OperationContext;
  mutationGraceMs?: number;
  termination?: Promise<never>;
}

interface CaveStoredCredentialRecord {
  version: typeof CAVE_STORED_CREDENTIAL_VERSION;
  bearer: string;
  authorityBinding: CaveAuthorityBinding;
}

type PromiseResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; error: unknown };

type ForgetCurrentDeletionResult =
  | { status: 'deleted' }
  | { status: 'absent' }
  | { status: 'present' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedNonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function credentialBindingTimeoutError(): Error {
  return Object.assign(new Error('Cave credential binding timed out.'), {
    code: 'timeout',
    retryable: true,
  });
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  try {
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' && code.length > 0 ? code : undefined;
  } catch {
    return undefined;
  }
}

function wrapForgetStoreFailure(
  error: unknown,
  code: 'secret_store_read_failed' | 'secret_store_delete_failed',
): Error {
  const existingCode = errorCodeOf(error);
  if (
    existingCode === 'timeout' ||
    existingCode === 'aborted' ||
    existingCode === 'secure_store_unavailable' ||
    existingCode === 'secret_store_read_failed' ||
    existingCode === 'secret_store_delete_failed' ||
    existingCode === 'credential_update_in_progress'
  ) {
    return error as Error;
  }

  return Object.assign(
    new Error(
      code === 'secret_store_read_failed'
        ? 'The stored Cave credential could not be read safely.'
        : 'The stored Cave credential could not be deleted safely.',
      { cause: error },
    ),
    {
      code,
      retryable: false,
    },
  );
}

function credentialUpdateInProgressError(): Error {
  return Object.assign(new Error('A Cave credential update is still in progress.'), {
    code: 'credential_update_in_progress',
    retryable: true,
  });
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

function legacyCredentialKeys(reference: SecretStoreReference): readonly string[] {
  const suffix = hashCredentialReferenceKey(reference.key);
  return LEGACY_CREDENTIAL_KEY_PREFIXES.map((prefix) => `${prefix}${suffix}`);
}

function logicalStoreId(store: SecretStore): string {
  if (typeof store === 'object' && store !== null) {
    try {
      const provided: unknown = Reflect.get(store, SECRET_STORE_LOGICAL_ID);
      if (typeof provided === 'string' && provided.length > 0) {
        return provided;
      }
    } catch {
      // Fall back to process-local identity tracking below.
    }

    const existing = mutationRegistry.storeLogicalIds.get(store);
    if (existing !== undefined) {
      return existing;
    }

    const allocated = `store:${String(++mutationRegistry.nextStoreLogicalId)}`;
    mutationRegistry.storeLogicalIds.set(store, allocated);
    return allocated;
  }

  return `store:${String(++mutationRegistry.nextStoreLogicalId)}`;
}

function runSerializedTask<T>(
  queues: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);

  return run.finally(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
}

function referenceMutationKey(store: SecretStore, reference: SecretStoreReference): string {
  return `${logicalStoreId(store)}:${hashCredentialReferenceKey(reference.key)}`;
}

function concreteMutationKey(store: SecretStore, key: string): string {
  return `${logicalStoreId(store)}:${key}`;
}

function serializeReferenceMutation<T>(
  store: SecretStore,
  reference: SecretStoreReference,
  task: () => Promise<T>,
): Promise<T> {
  return runSerializedTask(
    mutationRegistry.referenceQueues,
    referenceMutationKey(store, reference),
    task,
  );
}

function serializeConcreteMutation<T>(
  store: SecretStore,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  return runSerializedTask(
    mutationRegistry.concreteQueues,
    concreteMutationKey(store, key),
    task,
  );
}

function queuedStoreSet(store: SecretStore, key: string, value: string): Promise<void> {
  return serializeConcreteMutation(store, key, async () => {
    await Promise.resolve();
    return await store.set(key, value);
  });
}

function queuedStoreDelete(store: SecretStore, key: string): Promise<boolean> {
  return serializeConcreteMutation(store, key, async () => {
    await Promise.resolve();
    return await store.delete(key);
  });
}

function parseStoredAuthorityBinding(value: unknown): CaveAuthorityBinding | undefined {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['version', 'endpoint', 'record', 'freshness']) ||
    value.version !== 1
  ) {
    return undefined;
  }

  if (
    !isPlainObject(value.endpoint) ||
    !hasExactKeys(value.endpoint, ['kind', 'url']) ||
    value.endpoint.kind !== 'http' ||
    !isBoundedNonEmptyString(value.endpoint.url, CAVE_STORED_CREDENTIAL_ENDPOINT_MAX_LENGTH)
  ) {
    return undefined;
  }

  if (
    !isPlainObject(value.record) ||
    !hasExactKeys(value.record, ['identity', 'device', 'inode']) ||
    !isBoundedNonEmptyString(value.record.identity, CAVE_STORED_CREDENTIAL_IDENTITY_MAX_LENGTH) ||
    !isNonNegativeSafeInteger(value.record.device) ||
    !isNonNegativeSafeInteger(value.record.inode)
  ) {
    return undefined;
  }

  if (
    !isPlainObject(value.freshness) ||
    !hasExactKeys(value.freshness, ['pid', 'nonce', 'startedAt']) ||
    !isNonNegativeSafeInteger(value.freshness.pid) ||
    !isBoundedNonEmptyString(value.freshness.nonce, CAVE_STORED_CREDENTIAL_NONCE_MAX_LENGTH) ||
    !isBoundedNonEmptyString(value.freshness.startedAt, CAVE_STORED_CREDENTIAL_STARTED_AT_MAX_LENGTH)
  ) {
    return undefined;
  }

  return {
    version: 1,
    endpoint: {
      kind: 'http',
      url: value.endpoint.url,
    },
    record: {
      identity: value.record.identity,
      device: value.record.device,
      inode: value.record.inode,
    },
    freshness: {
      pid: value.freshness.pid,
      nonce: value.freshness.nonce,
      startedAt: value.freshness.startedAt,
    },
  };
}

function parseStoredCredentialRecord(serialized: string): CaveStoredCredentialRecord | undefined {
  if (utf8ByteLength(serialized) > CAVE_STORED_CREDENTIAL_RECORD_MAX_BYTES) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }

  if (
    !isPlainObject(parsed) ||
    !hasExactKeys(parsed, ['version', 'bearer', 'authorityBinding']) ||
    parsed.version !== CAVE_STORED_CREDENTIAL_VERSION ||
    !isBoundedNonEmptyString(parsed.bearer, CAVE_STORED_CREDENTIAL_BEARER_MAX_LENGTH)
  ) {
    return undefined;
  }

  const authorityBinding = parseStoredAuthorityBinding(parsed.authorityBinding);
  if (authorityBinding === undefined) {
    return undefined;
  }

  return {
    version: CAVE_STORED_CREDENTIAL_VERSION,
    bearer: parsed.bearer,
    authorityBinding,
  };
}

function canonicalAuthorityBinding(authorityBinding: CaveAuthorityBinding): CaveAuthorityBinding {
  return {
    version: authorityBinding.version,
    endpoint: {
      kind: authorityBinding.endpoint.kind,
      url: authorityBinding.endpoint.url,
    },
    record: {
      identity: authorityBinding.record.identity,
      device: authorityBinding.record.device,
      inode: authorityBinding.record.inode,
    },
    freshness: {
      pid: authorityBinding.freshness.pid,
      nonce: authorityBinding.freshness.nonce,
      startedAt: authorityBinding.freshness.startedAt,
    },
  };
}

function serializeStoredCredentialRecord(
  bearer: string,
  authorityBinding: CaveAuthorityBinding,
): string {
  const serialized = JSON.stringify({
    version: CAVE_STORED_CREDENTIAL_VERSION,
    bearer,
    authorityBinding: canonicalAuthorityBinding(authorityBinding),
  } satisfies CaveStoredCredentialRecord);

  if (parseStoredCredentialRecord(serialized) === undefined) {
    throw new TypeError('Cave stored credential record was invalid.');
  }

  return serialized;
}

function mismatchReason(
  current: CaveAuthorityBinding,
  stored: CaveAuthorityBinding,
): CaveStoredCredentialMismatchReason | undefined {
  if (
    current.endpoint.url !== stored.endpoint.url ||
    current.record.identity !== stored.record.identity
  ) {
    return 'authority_mismatch';
  }

  if (
    current.record.device !== stored.record.device ||
    current.record.inode !== stored.record.inode
  ) {
    return 'record_replaced';
  }

  if (
    current.freshness.pid !== stored.freshness.pid ||
    current.freshness.nonce !== stored.freshness.nonce ||
    current.freshness.startedAt !== stored.freshness.startedAt
  ) {
    return 'authority_restarted';
  }

  return undefined;
}

function ensureActive(context: OperationContext | undefined): void {
  if (context?.signal.aborted === true) {
    throw (context.signal as AbortSignal & { reason?: unknown }).reason ?? new Error('aborted');
  }

  if (
    context?.deadline !== undefined &&
    context.deadline - performance.now() <= 0
  ) {
    throw credentialBindingTimeoutError();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  });
}

async function settleWithin<T>(
  promise: Promise<PromiseResult<T>>,
  timeoutMs: number,
): Promise<PromiseResult<T> | undefined> {
  return await Promise.race([
    promise,
    delay(timeoutMs).then(() => undefined),
  ]);
}

async function awaitStoreCall<T>(
  operation: Promise<T>,
  options: CredentialBindingMutationOptions = {},
): Promise<T> {
  ensureActive(options.context);

  if (options.termination === undefined) {
    const value = await operation;
    ensureActive(options.context);
    return value;
  }

  const completion: Promise<PromiseResult<T>> = Promise.resolve(operation).then(
    (value): PromiseResult<T> => ({ status: 'fulfilled', value }),
    (error): PromiseResult<T> => ({ status: 'rejected', error }),
  );

  try {
    const settled = await Promise.race<PromiseResult<T>>([
      completion,
      options.termination,
    ]);
    if (settled.status === 'rejected') {
      throw settled.error;
    }

    ensureActive(options.context);
    return settled.value;
  } catch (error) {
    if (!isOperationTimeoutError(error) && !isOperationAbortedError(error)) {
      throw error;
    }

    const settled = await settleWithin(
      completion,
      options.mutationGraceMs ?? CAVE_CREDENTIAL_STORE_GRACE_MS,
    );
    if (settled !== undefined) {
      if (settled.status === 'rejected') {
        throw settled.error;
      }

      ensureActive(options.context);
      return settled.value;
    }

    throw error;
  }
}

async function readStoreValue(
  store: SecretStore,
  key: string,
  options: CredentialBindingMutationOptions = {},
): Promise<unknown> {
  return await awaitStoreCall(store.get(key) as Promise<unknown>, options);
}

async function readStoreValueForForget(
  store: SecretStore,
  key: string,
  options: CredentialBindingMutationOptions = {},
): Promise<unknown> {
  try {
    return await readStoreValue(store, key, options);
  } catch (error) {
    throw wrapForgetStoreFailure(error, 'secret_store_read_failed');
  }
}

async function deleteCurrentValueIfExact(
  store: SecretStore,
  reference: SecretStoreReference,
  expected: unknown,
  options: CredentialBindingMutationOptions = {},
): Promise<boolean> {
  return await serializeConcreteMutation(store, reference.key, async () => {
    if (typeof expected === 'string' && store.compareAndDelete !== undefined) {
      const result = await awaitStoreCall(
        store.compareAndDelete(reference.key, expected),
        options,
      );
      return result === 'deleted';
    }

    const current = await readStoreValue(store, reference.key, options);
    if (!Object.is(current, expected)) {
      return false;
    }

    return await awaitStoreCall(store.delete(reference.key), options);
  });
}

async function confirmForgetDeleteCurrentValueIfExact(
  store: SecretStore,
  reference: SecretStoreReference,
  expected: unknown,
  options: CredentialBindingMutationOptions = {},
): Promise<ForgetCurrentDeletionResult> {
  return await serializeConcreteMutation(store, reference.key, async () => {
    if (typeof expected === 'string' && store.compareAndDelete !== undefined) {
      let result: Awaited<ReturnType<NonNullable<SecretStore['compareAndDelete']>>>;
      try {
        result = await awaitStoreCall(
          store.compareAndDelete(reference.key, expected),
          options,
        );
      } catch (error) {
        throw wrapForgetStoreFailure(error, 'secret_store_delete_failed');
      }

      return result === 'deleted'
        ? { status: 'deleted' }
        : result === 'absent'
          ? { status: 'absent' }
          : { status: 'present' };
    }

    const current = await readStoreValueForForget(store, reference.key, options);
    if (!Object.is(current, expected)) {
      return { status: current === undefined ? 'absent' : 'present' };
    }

    let deleted: boolean;
    try {
      deleted = await awaitStoreCall(store.delete(reference.key), options);
    } catch (error) {
      throw wrapForgetStoreFailure(error, 'secret_store_delete_failed');
    }

    if (deleted) {
      return { status: 'deleted' };
    }

    const currentAfterDelete = await readStoreValueForForget(store, reference.key, options);
    return { status: currentAfterDelete === undefined ? 'absent' : 'present' };
  });
}

async function clearLegacyCredentialState(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<boolean> {
  let deletedAny = false;

  for (const key of legacyCredentialKeys(reference)) {
    try {
      deletedAny = (await awaitStoreCall(queuedStoreDelete(store, key), options)) || deletedAny;
    } catch {
      // Best effort only.
    }
  }

  return deletedAny;
}

async function forgetLegacyCredentialState(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<boolean> {
  let deletedAny = false;

  for (const key of legacyCredentialKeys(reference)) {
    try {
      deletedAny = (await awaitStoreCall(queuedStoreDelete(store, key), options)) || deletedAny;
    } catch (error) {
      throw wrapForgetStoreFailure(error, 'secret_store_delete_failed');
    }
  }

  return deletedAny;
}

function scheduleLateStoreCleanup(
  completion: Promise<PromiseResult<void>>,
  store: SecretStore,
  reference: SecretStoreReference,
  serializedRecord: string,
): void {
  void completion.then(async (settled) => {
    if (settled.status !== 'fulfilled') {
      return;
    }

    try {
      await deleteCurrentValueIfExact(store, reference, serializedRecord);
    } catch {
      // Best effort only.
    }
  });
}

async function awaitStoreSetCommit(
  store: SecretStore,
  reference: SecretStoreReference,
  serializedRecord: string,
  options: CredentialBindingMutationOptions = {},
): Promise<void> {
  ensureActive(options.context);

  const operation = queuedStoreSet(store, reference.key, serializedRecord);
  const completion: Promise<PromiseResult<void>> = Promise.resolve(operation).then(
    (): PromiseResult<void> => ({ status: 'fulfilled', value: undefined }),
    (error): PromiseResult<void> => ({ status: 'rejected', error }),
  );

  try {
    if (options.termination === undefined) {
      await operation;
      ensureActive(options.context);
      return;
    }

    const settled = await Promise.race<PromiseResult<void>>([
      completion,
      options.termination,
    ]);
    if (settled.status === 'rejected') {
      throw settled.error;
    }

    ensureActive(options.context);
  } catch (error) {
    if (!isOperationTimeoutError(error) && !isOperationAbortedError(error)) {
      throw error;
    }

    const settled = await settleWithin(
      completion,
      options.mutationGraceMs ?? CAVE_CREDENTIAL_STORE_GRACE_MS,
    );
    if (settled === undefined) {
      scheduleLateStoreCleanup(completion, store, reference, serializedRecord);
      throw error;
    }

    if (settled.status === 'rejected') {
      throw settled.error;
    }

    try {
      await deleteCurrentValueIfExact(store, reference, serializedRecord);
    } catch {
      // Best effort only.
    }

    throw error;
  }
}

export async function storeBoundCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  bearer: string,
  authorityBinding: CaveAuthorityBinding,
  options: CredentialBindingMutationOptions = {},
): Promise<void> {
  return await serializeReferenceMutation(store, reference, async () => {
    const serializedRecord = serializeStoredCredentialRecord(bearer, authorityBinding);
    await awaitStoreSetCommit(store, reference, serializedRecord, options);
  });
}

export async function loadBoundCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  discovered: CaveDiscoveredEndpoint,
  isBearer: (value: string) => boolean,
  options: CredentialBindingMutationOptions = {},
): Promise<LoadedCaveCredential> {
  const raw = await readStoreValue(store, reference.key, options);
  if (raw === undefined) {
    return { status: 'missing' };
  }
  if (typeof raw !== 'string') {
    return {
      status: 'invalid',
      reason: 'authority_binding_invalid',
    };
  }

  const stored = parseStoredCredentialRecord(raw);
  if (stored === undefined) {
    return {
      status: 'invalid',
      reason: 'authority_binding_invalid',
    };
  }

  if (!isBearer(stored.bearer)) {
    return { status: 'invalid_bearer' };
  }

  const currentAuthority = caveAuthorityBindingFromDiscoveredEndpoint(discovered);
  const reason = mismatchReason(currentAuthority, stored.authorityBinding);
  if (reason !== undefined) {
    return {
      status: 'invalid',
      reason,
    };
  }

  return {
    status: 'ready',
    bearer: stored.bearer,
  };
}

export async function invalidateStoredCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<void> {
  await serializeReferenceMutation(store, reference, async () => {
    let observed: unknown;

    try {
      observed = await readStoreValue(store, reference.key, options);
    } catch {
      return;
    }

    if (observed !== undefined) {
      try {
        await deleteCurrentValueIfExact(store, reference, observed, options);
      } catch {
        // Best-effort fail closed.
      }
    }

    await clearLegacyCredentialState(store, reference, options);
  });
}

export async function forgetStoredCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<boolean> {
  return await serializeReferenceMutation(store, reference, async () => {
    const observed = await readStoreValueForForget(store, reference.key, options);
    let current: ForgetCurrentDeletionResult = { status: 'absent' };

    if (observed !== undefined) {
      current = await confirmForgetDeleteCurrentValueIfExact(
        store,
        reference,
        observed,
        options,
      );
      if (current.status === 'present') {
        throw credentialUpdateInProgressError();
      }
    }

    const deletedLegacy = await forgetLegacyCredentialState(store, reference, options);
    return current.status === 'deleted' || deletedLegacy;
  });
}

export async function inspectStoredCredentialMaterial(
  store: SecretStore,
  reference: SecretStoreReference,
  isBearer: (value: string) => boolean,
  options: CredentialBindingMutationOptions = {},
): Promise<StoredCaveCredentialMaterial> {
  const raw = await readStoreValue(store, reference.key, options);
  if (raw === undefined) {
    return { status: 'missing' };
  }
  if (typeof raw !== 'string') {
    return { status: 'incomplete' };
  }

  const stored = parseStoredCredentialRecord(raw);
  if (stored === undefined) {
    return { status: 'incomplete' };
  }

  if (!isBearer(stored.bearer)) {
    return { status: 'invalid_bearer' };
  }

  return { status: 'present' };
}
