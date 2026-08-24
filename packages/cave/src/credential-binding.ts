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

const CAVE_CREDENTIAL_BINDING_SCHEMA = 'opencoven.cave.credential-binding.v1' as const;
const CAVE_CREDENTIAL_BINDING_KEY_PREFIX = 'opencoven.cave.credential-binding.v1.' as const;
const CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA = 'opencoven.cave.credential-binding.staging.v1' as const;
const CAVE_CREDENTIAL_BINDING_STAGING_KEY_PREFIX =
  'opencoven.cave.credential-binding.staging.v1.' as const;
const CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA = 'opencoven.cave.credential-binding.failure.v1' as const;
const CAVE_CREDENTIAL_BINDING_FAILURE_KEY_PREFIX =
  'opencoven.cave.credential-binding.failure.v1.' as const;
const CAVE_CREDENTIAL_BINDING_OWNER_SCHEMA = 'opencoven.cave.credential-binding.owner.v1' as const;
const CAVE_CREDENTIAL_BINDING_OWNER_KEY_PREFIX =
  'opencoven.cave.credential-binding.owner.v1.' as const;
const CAVE_CREDENTIAL_STORE_GRACE_MS = 250;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const SECRET_STORE_LOGICAL_ID = Symbol.for('@opencoven/sdk-core/secret-store-logical-id');
const referenceMutationQueues = new Map<string, Promise<void>>();
const concreteMutationQueues = new Map<string, Promise<void>>();
const secretStoreLogicalIds = new WeakMap<object, string>();
let nextSecretStoreLogicalId = 0;

export type CaveStoredCredentialMismatchReason =
  | 'authority_mismatch'
  | 'authority_restarted'
  | 'record_replaced';

export type CaveStoredCredentialInvalidReason =
  | CaveStoredCredentialMismatchReason
  | 'authority_binding_missing'
  | 'authority_binding_invalid'
  | 'authority_binding_incomplete';

type CaveStoredCredentialBindingState = 'bound' | 'pending';

interface CaveCredentialBindingRecord {
  schema: typeof CAVE_CREDENTIAL_BINDING_SCHEMA;
  state: CaveStoredCredentialBindingState;
  transactionId?: string;
  endpoint: string;
  record: {
    identity: string;
    device: number;
    inode: number;
  };
  freshness: {
    pid: number;
    nonce: string;
    startedAt: string;
  };
}

interface CaveCredentialBindingMarkerRecord {
  schema:
    | typeof CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA
    | typeof CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA;
  transactionId: string;
}

interface CaveCredentialBindingOwnerRecord {
  schema: typeof CAVE_CREDENTIAL_BINDING_OWNER_SCHEMA;
  transactionId: string;
}

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

type PromiseResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; error: unknown };

interface RollbackFailure {
  step: string;
  error: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hashCredentialReferenceKey(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let hash = FNV_OFFSET_BASIS_64;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
  }

  return hash.toString(16).padStart(16, '0');
}

function bindingMetadataKey(reference: SecretStoreReference): string {
  return `${CAVE_CREDENTIAL_BINDING_KEY_PREFIX}${hashCredentialReferenceKey(reference.key)}`;
}

function bindingStagingKey(reference: SecretStoreReference): string {
  return `${CAVE_CREDENTIAL_BINDING_STAGING_KEY_PREFIX}${hashCredentialReferenceKey(reference.key)}`;
}

function bindingFailureKey(reference: SecretStoreReference): string {
  return `${CAVE_CREDENTIAL_BINDING_FAILURE_KEY_PREFIX}${hashCredentialReferenceKey(reference.key)}`;
}

function bindingOwnerKey(reference: SecretStoreReference): string {
  return `${CAVE_CREDENTIAL_BINDING_OWNER_KEY_PREFIX}${hashCredentialReferenceKey(reference.key)}`;
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

    const existing = secretStoreLogicalIds.get(store);
    if (existing !== undefined) {
      return existing;
    }

    const allocated = `store:${String(++nextSecretStoreLogicalId)}`;
    secretStoreLogicalIds.set(store, allocated);
    return allocated;
  }

  return `store:${String(++nextSecretStoreLogicalId)}`;
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

function referenceMutationKey(
  store: SecretStore,
  reference: SecretStoreReference,
): string {
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
    referenceMutationQueues,
    referenceMutationKey(store, reference),
    task,
  );
}

function queuedStoreSet(
  store: SecretStore,
  key: string,
  value: string,
): Promise<void> {
  return runSerializedTask(
    concreteMutationQueues,
    concreteMutationKey(store, key),
    async () => {
      await Promise.resolve();
      return await store.set(key, value);
    },
  );
}

function queuedStoreDelete(
  store: SecretStore,
  key: string,
): Promise<boolean> {
  return runSerializedTask(
    concreteMutationQueues,
    concreteMutationKey(store, key),
    async () => {
      await Promise.resolve();
      return await store.delete(key);
    },
  );
}

function bindingRecord(
  authorityBinding: CaveAuthorityBinding,
  state: CaveStoredCredentialBindingState,
  transactionId?: string,
): CaveCredentialBindingRecord {
  return {
    schema: CAVE_CREDENTIAL_BINDING_SCHEMA,
    state,
    ...(transactionId === undefined ? {} : { transactionId }),
    endpoint: authorityBinding.endpoint.url,
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

function markerRecord(
  schema:
    | typeof CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA
    | typeof CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
  transactionId: string,
): CaveCredentialBindingMarkerRecord {
  return {
    schema,
    transactionId,
  };
}

function ownerRecord(transactionId: string): CaveCredentialBindingOwnerRecord {
  return {
    schema: CAVE_CREDENTIAL_BINDING_OWNER_SCHEMA,
    transactionId,
  };
}

function parseBindingRecord(serialized: string): CaveCredentialBindingRecord | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }

  if (!isObject(parsed) || parsed.schema !== CAVE_CREDENTIAL_BINDING_SCHEMA) {
    return undefined;
  }

  if (parsed.state !== 'bound' && parsed.state !== 'pending') {
    return undefined;
  }

  if (parsed.transactionId !== undefined && !isNonEmptyString(parsed.transactionId)) {
    return undefined;
  }

  if (!isNonEmptyString(parsed.endpoint)) {
    return undefined;
  }

  if (
    !isObject(parsed.record) ||
    !isNonEmptyString(parsed.record.identity) ||
    !isNonNegativeSafeInteger(parsed.record.device) ||
    !isNonNegativeSafeInteger(parsed.record.inode)
  ) {
    return undefined;
  }

  if (
    !isObject(parsed.freshness) ||
    !isNonNegativeSafeInteger(parsed.freshness.pid) ||
    !isNonEmptyString(parsed.freshness.nonce) ||
    !isNonEmptyString(parsed.freshness.startedAt)
  ) {
    return undefined;
  }

  return {
    schema: CAVE_CREDENTIAL_BINDING_SCHEMA,
    state: parsed.state,
    ...(parsed.transactionId === undefined ? {} : { transactionId: parsed.transactionId }),
    endpoint: parsed.endpoint,
    record: {
      identity: parsed.record.identity,
      device: parsed.record.device,
      inode: parsed.record.inode,
    },
    freshness: {
      pid: parsed.freshness.pid,
      nonce: parsed.freshness.nonce,
      startedAt: parsed.freshness.startedAt,
    },
  };
}

function parseMarkerRecord(
  serialized: string,
  schema:
    | typeof CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA
    | typeof CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
): CaveCredentialBindingMarkerRecord | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }

  if (
    !isObject(parsed) ||
    parsed.schema !== schema ||
    !isNonEmptyString(parsed.transactionId)
  ) {
    return undefined;
  }

  return {
    schema,
    transactionId: parsed.transactionId,
  };
}

function parseOwnerRecord(serialized: string): CaveCredentialBindingOwnerRecord | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }

  if (
    !isObject(parsed) ||
    parsed.schema !== CAVE_CREDENTIAL_BINDING_OWNER_SCHEMA ||
    !isNonEmptyString(parsed.transactionId)
  ) {
    return undefined;
  }

  return {
    schema: CAVE_CREDENTIAL_BINDING_OWNER_SCHEMA,
    transactionId: parsed.transactionId,
  };
}

function mismatchReason(
  current: CaveAuthorityBinding,
  stored: CaveCredentialBindingRecord,
): CaveStoredCredentialMismatchReason | undefined {
  if (
    current.endpoint.url !== stored.endpoint ||
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
    throw Object.assign(new Error('Cave credential binding timed out.'), {
      code: 'timeout',
      retryable: true,
    });
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

async function awaitRollbackCall<T>(
  operation: Promise<T>,
): Promise<T> {
  const completion: Promise<PromiseResult<T>> = Promise.resolve(operation).then(
    (value): PromiseResult<T> => ({ status: 'fulfilled', value }),
    (error): PromiseResult<T> => ({ status: 'rejected', error }),
  );

  const settled = await settleWithin(completion, CAVE_CREDENTIAL_STORE_GRACE_MS);
  if (settled === undefined) {
    throw Object.assign(new Error('Cave credential rollback timed out.'), {
      code: 'timeout',
      retryable: true,
    });
  }

  if (settled.status === 'rejected') {
    throw settled.error;
  }

  return settled.value;
}

async function safeRollbackString(
  operation: Promise<string | undefined>,
): Promise<string | undefined> {
  try {
    const value = await awaitRollbackCall(operation);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function rollbackFailureError(
  cause: unknown,
  failures: readonly RollbackFailure[],
): Error {
  const timedOut = failures.some(({ error }) => {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    try {
      return Reflect.get(error, 'code') === 'timeout';
    } catch {
      return false;
    }
  });

  return Object.assign(new Error('Cave credential rollback failed closed.'), {
    code: 'secret_store_rollback_failed',
    retryable: false,
    details: {
      failedStep: failures[0]?.step ?? 'unknown',
      reason: 'fail_closed',
      rollbackState: timedOut ? 'timed_out' : 'failed',
    },
    diagnostics: {
      phase: 'rollback',
      failures: failures.length,
    },
    cause,
  });
}

async function rollbackCredentialWrite(
  store: SecretStore,
  reference: SecretStoreReference,
  transactionId: string,
  bearer: string,
  cause: unknown,
): Promise<void> {
  const failures: RollbackFailure[] = [];
  const metadataKey = bindingMetadataKey(reference);
  const stagingKey = bindingStagingKey(reference);
  const failureKey = bindingFailureKey(reference);
  const ownerKey = bindingOwnerKey(reference);

  const attempt = async (step: string, operation: Promise<unknown>): Promise<void> => {
    try {
      await awaitRollbackCall(operation);
    } catch (error) {
      failures.push({ step, error });
    }
  };

  await attempt(
    'set_failure_marker',
    queuedStoreSet(
      store,
      failureKey,
      JSON.stringify(
        markerRecord(
          CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
          transactionId,
        ),
      ),
    ),
  );
  const owner = parseOwnerRecord(
    (await safeRollbackString(store.get(ownerKey))) ?? '',
  );
  const binding = parseBindingRecord(
    (await safeRollbackString(store.get(metadataKey))) ?? '',
  );

  if (owner?.transactionId === transactionId) {
    await attempt('delete_bearer', queuedStoreDelete(store, reference.key));
    await attempt('delete_owner', queuedStoreDelete(store, ownerKey));
  } else if (owner === undefined && binding?.transactionId === transactionId) {
    const currentBearer = await safeRollbackString(store.get(reference.key));
    if (currentBearer === bearer) {
      await attempt('delete_bearer', queuedStoreDelete(store, reference.key));
    }
  }

  if (binding?.transactionId === transactionId) {
    await attempt('delete_binding', queuedStoreDelete(store, metadataKey));
  }

  const staging = parseMarkerRecord(
    (await safeRollbackString(store.get(stagingKey))) ?? '',
    CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA,
  );
  if (staging?.transactionId === transactionId) {
    await attempt('delete_staging', queuedStoreDelete(store, stagingKey));
  }

  const currentOwner = parseOwnerRecord(
    (await safeRollbackString(store.get(ownerKey))) ?? '',
  );
  const currentBinding = parseBindingRecord(
    (await safeRollbackString(store.get(metadataKey))) ?? '',
  );
  if (
    (currentOwner !== undefined && currentOwner.transactionId !== transactionId) ||
    (currentBinding?.transactionId !== undefined && currentBinding.transactionId !== transactionId)
  ) {
    await attempt('delete_failure_marker', queuedStoreDelete(store, failureKey));
  }

  if (failures.length > 0) {
    throw rollbackFailureError(cause, failures);
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
    const metadataKey = bindingMetadataKey(reference);
    const stagingKey = bindingStagingKey(reference);
    const failureKey = bindingFailureKey(reference);
    const ownerKey = bindingOwnerKey(reference);
    const transactionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    let writeStarted = false;

    try {
      writeStarted = true;
      await awaitStoreCall(
        queuedStoreSet(
          store,
          stagingKey,
          JSON.stringify(
            markerRecord(
              CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA,
              transactionId,
            ),
          ),
        ),
        options,
      );
      await awaitStoreCall(
        queuedStoreSet(
          store,
          metadataKey,
          JSON.stringify(
            bindingRecord(authorityBinding, 'pending', transactionId),
          ),
        ),
        options,
      );
      await awaitStoreCall(queuedStoreSet(store, reference.key, bearer), options);
      await awaitStoreCall(
        queuedStoreSet(
          store,
          ownerKey,
          JSON.stringify(ownerRecord(transactionId)),
        ),
        options,
      );
      await awaitStoreCall(
        queuedStoreSet(
          store,
          metadataKey,
          JSON.stringify(
            bindingRecord(authorityBinding, 'bound', transactionId),
          ),
        ),
        options,
      );
      await awaitStoreCall(queuedStoreDelete(store, failureKey), options);
      await awaitStoreCall(queuedStoreDelete(store, stagingKey), options);
    } catch (error) {
      if (!writeStarted) {
        throw error;
      }

      await rollbackCredentialWrite(store, reference, transactionId, bearer, error);
      throw error;
    }
  });
}

export async function loadBoundCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  discovered: CaveDiscoveredEndpoint,
  isBearer: (value: string) => boolean,
  options: CredentialBindingMutationOptions = {},
): Promise<LoadedCaveCredential> {
  const currentAuthority = caveAuthorityBindingFromDiscoveredEndpoint(discovered);
  const failureSerialized = await awaitStoreCall(
    store.get(bindingFailureKey(reference)),
    options,
  );
  if (failureSerialized !== undefined) {
    if (
      typeof failureSerialized !== 'string' ||
      parseMarkerRecord(
        failureSerialized,
        CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
      ) === undefined
    ) {
      return {
        status: 'invalid',
        reason: 'authority_binding_invalid',
      };
    }

    return {
      status: 'invalid',
      reason: 'authority_binding_incomplete',
    };
  }

  const stagingSerialized = await awaitStoreCall(
    store.get(bindingStagingKey(reference)),
    options,
  );
  if (stagingSerialized !== undefined) {
    if (
      typeof stagingSerialized !== 'string' ||
      parseMarkerRecord(
        stagingSerialized,
        CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA,
      ) === undefined
    ) {
      return {
        status: 'invalid',
        reason: 'authority_binding_invalid',
      };
    }

    return {
      status: 'invalid',
      reason: 'authority_binding_incomplete',
    };
  }

  const serialized = await awaitStoreCall(
    store.get(bindingMetadataKey(reference)),
    options,
  );
  const ownerSerialized = await awaitStoreCall(
    store.get(bindingOwnerKey(reference)),
    options,
  );
  const bearer = await awaitStoreCall(store.get(reference.key), options);

  if (bearer === undefined) {
    return serialized === undefined && ownerSerialized === undefined
      ? { status: 'missing' }
      : {
          status: 'invalid',
          reason: 'authority_binding_incomplete',
        };
  }

  if (typeof bearer !== 'string' || !isBearer(bearer)) {
    return { status: 'invalid_bearer' };
  }

  if (serialized === undefined) {
    return {
      status: 'invalid',
      reason: ownerSerialized === undefined
        ? 'authority_binding_missing'
        : 'authority_binding_incomplete',
    };
  }

  if (typeof serialized !== 'string') {
    return {
      status: 'invalid',
      reason: 'authority_binding_invalid',
    };
  }

  const stored = parseBindingRecord(serialized);
  if (stored === undefined) {
    return {
      status: 'invalid',
      reason: 'authority_binding_invalid',
    };
  }

  if (ownerSerialized !== undefined) {
    if (typeof ownerSerialized !== 'string') {
      return {
        status: 'invalid',
        reason: 'authority_binding_invalid',
      };
    }

    const owner = parseOwnerRecord(ownerSerialized);
    if (
      owner === undefined ||
      stored.transactionId === undefined ||
      owner.transactionId !== stored.transactionId
    ) {
      return {
        status: 'invalid',
        reason: 'authority_binding_incomplete',
      };
    }
  }

  if (stored.state !== 'bound') {
    return {
      status: 'invalid',
      reason: 'authority_binding_incomplete',
    };
  }

  const reason = mismatchReason(currentAuthority, stored);
  if (reason !== undefined) {
    return {
      status: 'invalid',
      reason,
    };
  }

  return {
    status: 'ready',
    bearer,
  };
}

export async function invalidateStoredCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<void> {
  await serializeReferenceMutation(store, reference, async () => {
    for (const key of [
      reference.key,
      bindingMetadataKey(reference),
      bindingOwnerKey(reference),
      bindingStagingKey(reference),
      bindingFailureKey(reference),
    ]) {
      try {
        await awaitStoreCall(queuedStoreDelete(store, key), options);
      } catch {
        // Best-effort fail closed.
      }
    }
  });
}

export async function forgetStoredCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<boolean> {
  return await serializeReferenceMutation(store, reference, async () => {
    const bearerDeleted = await awaitStoreCall(
      queuedStoreDelete(store, reference.key),
      options,
    );
    const bindingDeleted = await awaitStoreCall(
      queuedStoreDelete(store, bindingMetadataKey(reference)),
      options,
    );
    const ownerDeleted = await awaitStoreCall(
      queuedStoreDelete(store, bindingOwnerKey(reference)),
      options,
    );
    const stagingDeleted = await awaitStoreCall(
      queuedStoreDelete(store, bindingStagingKey(reference)),
      options,
    );
    const failureDeleted = await awaitStoreCall(
      queuedStoreDelete(store, bindingFailureKey(reference)),
      options,
    );

    return bearerDeleted || bindingDeleted || ownerDeleted || stagingDeleted || failureDeleted;
  });
}

export async function inspectStoredCredentialMaterial(
  store: SecretStore,
  reference: SecretStoreReference,
  isBearer: (value: string) => boolean,
  options: CredentialBindingMutationOptions = {},
): Promise<StoredCaveCredentialMaterial> {
  const failureSerialized = await awaitStoreCall(
    store.get(bindingFailureKey(reference)),
    options,
  );
  if (failureSerialized !== undefined) {
    return { status: 'incomplete' };
  }

  const stagingSerialized = await awaitStoreCall(
    store.get(bindingStagingKey(reference)),
    options,
  );
  if (stagingSerialized !== undefined) {
    return { status: 'incomplete' };
  }

  const metadata = await awaitStoreCall(
    store.get(bindingMetadataKey(reference)),
    options,
  );
  const ownerSerialized = await awaitStoreCall(
    store.get(bindingOwnerKey(reference)),
    options,
  );
  const bearer = await awaitStoreCall(store.get(reference.key), options);

  if (bearer === undefined) {
    return metadata === undefined && ownerSerialized === undefined
      ? { status: 'missing' }
      : { status: 'incomplete' };
  }

  if (ownerSerialized !== undefined) {
    if (typeof ownerSerialized !== 'string') {
      return { status: 'incomplete' };
    }

    const owner = parseOwnerRecord(ownerSerialized);
    const stored = typeof metadata === 'string' ? parseBindingRecord(metadata) : undefined;
    if (
      owner === undefined ||
      stored === undefined ||
      stored.transactionId === undefined ||
      stored.transactionId !== owner.transactionId
    ) {
      return { status: 'incomplete' };
    }
  }

  return typeof bearer === 'string' && isBearer(bearer)
    ? { status: 'present' }
    : { status: 'invalid_bearer' };
}
