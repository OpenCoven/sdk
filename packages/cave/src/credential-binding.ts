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
const CAVE_CREDENTIAL_STABLE_READ_ATTEMPTS = 3;
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
  | { status: 'update_in_progress' }
  | { status: 'invalid_bearer' }
  | { status: 'invalid'; reason: CaveStoredCredentialInvalidReason }
  | { status: 'ready'; bearer: string };

export type StoredCaveCredentialMaterial =
  | { status: 'missing' }
  | { status: 'present' }
  | { status: 'invalid_bearer' }
  | { status: 'incomplete' }
  | { status: 'update_in_progress' };

interface CredentialBindingMutationOptions {
  context?: OperationContext;
  mutationGraceMs?: number;
  termination?: Promise<never>;
}

type CredentialSnapshotKey = 'metadata' | 'staging' | 'failure' | 'owner' | 'bearer';

const CREDENTIAL_SNAPSHOT_KEYS = [
  'metadata',
  'staging',
  'failure',
  'owner',
  'bearer',
] as const satisfies readonly CredentialSnapshotKey[];

const CREDENTIAL_SNAPSHOT_HEADER_KEYS = [
  'metadata',
  'staging',
  'failure',
  'owner',
] as const satisfies readonly Exclude<CredentialSnapshotKey, 'bearer'>[];

const CREDENTIAL_DELETE_ORDER = [
  'bearer',
  'owner',
  'metadata',
  'failure',
  'staging',
] as const satisfies readonly CredentialSnapshotKey[];

const INVALID_CREDENTIAL_SNAPSHOT_ENTRY = Symbol('invalid-credential-snapshot-entry');

type ParsedCredentialSnapshotEntry<T> =
  | T
  | typeof INVALID_CREDENTIAL_SNAPSHOT_ENTRY
  | undefined;

interface CredentialSnapshot {
  keys: Record<CredentialSnapshotKey, string>;
  values: Record<CredentialSnapshotKey, unknown>;
  binding: ParsedCredentialSnapshotEntry<CaveCredentialBindingRecord>;
  staging: ParsedCredentialSnapshotEntry<CaveCredentialBindingMarkerRecord>;
  failure: ParsedCredentialSnapshotEntry<CaveCredentialBindingMarkerRecord>;
  owner: ParsedCredentialSnapshotEntry<CaveCredentialBindingOwnerRecord>;
}

interface SnapshotMutationAccess {
  read(key: string): Promise<unknown>;
  delete(key: string): Promise<boolean>;
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

function isInvalidCredentialSnapshotEntry<T>(
  value: ParsedCredentialSnapshotEntry<T>,
): value is typeof INVALID_CREDENTIAL_SNAPSHOT_ENTRY {
  return value === INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
}

function parseSnapshotBindingEntry(
  value: unknown,
): ParsedCredentialSnapshotEntry<CaveCredentialBindingRecord> {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
  }

  return parseBindingRecord(value) ?? INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
}

function parseSnapshotMarkerEntry(
  value: unknown,
  schema:
    | typeof CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA
    | typeof CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
): ParsedCredentialSnapshotEntry<CaveCredentialBindingMarkerRecord> {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
  }

  return parseMarkerRecord(value, schema) ?? INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
}

function parseSnapshotOwnerEntry(
  value: unknown,
): ParsedCredentialSnapshotEntry<CaveCredentialBindingOwnerRecord> {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
  }

  return parseOwnerRecord(value) ?? INVALID_CREDENTIAL_SNAPSHOT_ENTRY;
}

function markerTransactionId(
  marker: ParsedCredentialSnapshotEntry<CaveCredentialBindingMarkerRecord>,
): string | undefined {
  return marker === undefined || isInvalidCredentialSnapshotEntry(marker)
    ? undefined
    : marker.transactionId;
}

function bindingTransactionId(
  binding: ParsedCredentialSnapshotEntry<CaveCredentialBindingRecord>,
): string | undefined {
  return binding === undefined || isInvalidCredentialSnapshotEntry(binding)
    ? undefined
    : binding.transactionId;
}

function ownerTransactionId(
  owner: ParsedCredentialSnapshotEntry<CaveCredentialBindingOwnerRecord>,
): string | undefined {
  return owner === undefined || isInvalidCredentialSnapshotEntry(owner)
    ? undefined
    : owner.transactionId;
}

function ownedTransactionId(snapshot: CredentialSnapshot): string | undefined {
  const ownerId = ownerTransactionId(snapshot.owner);
  if (ownerId === undefined) {
    return undefined;
  }

  const bindingId = bindingTransactionId(snapshot.binding);
  return bindingId === undefined || bindingId === ownerId ? ownerId : undefined;
}

function committedTransactionId(snapshot: CredentialSnapshot): string | undefined {
  if (snapshot.binding === undefined || isInvalidCredentialSnapshotEntry(snapshot.binding)) {
    return undefined;
  }

  const bindingId = snapshot.binding.transactionId;
  if (snapshot.binding.state !== 'bound' || bindingId === undefined) {
    return undefined;
  }

  return ownerTransactionId(snapshot.owner) === bindingId ? bindingId : undefined;
}

function isSnapshotStructurallyInvalid(snapshot: CredentialSnapshot): boolean {
  return [
    snapshot.binding,
    snapshot.staging,
    snapshot.failure,
    snapshot.owner,
  ].some((value) => isInvalidCredentialSnapshotEntry(value));
}

function assessSnapshotReadState(
  snapshot: CredentialSnapshot,
):
  | { status: 'continue' }
  | { status: 'update_in_progress' }
  | { status: 'invalid'; reason: CaveStoredCredentialInvalidReason } {
  if (isSnapshotStructurallyInvalid(snapshot)) {
    return {
      status: 'invalid',
      reason: 'authority_binding_invalid',
    };
  }

  const committedId = committedTransactionId(snapshot);
  const failureId = markerTransactionId(snapshot.failure);
  const stagingId = markerTransactionId(snapshot.staging);

  if (failureId !== undefined) {
    if (stagingId === undefined || stagingId === failureId) {
      if (committedId === undefined || committedId === failureId) {
        return {
          status: 'invalid',
          reason: 'authority_binding_incomplete',
        };
      }
    }
  }

  if (stagingId !== undefined && stagingId !== failureId) {
    return { status: 'update_in_progress' };
  }

  return { status: 'continue' };
}

function snapshotHeaderValuesEqual(
  left: CredentialSnapshot,
  right: CredentialSnapshot,
): boolean {
  return CREDENTIAL_SNAPSHOT_HEADER_KEYS.every((key) => Object.is(left.values[key], right.values[key]));
}

async function readStoreValue(
  store: SecretStore,
  key: string,
  options: CredentialBindingMutationOptions = {},
): Promise<unknown> {
  return await awaitStoreCall(store.get(key) as Promise<unknown>, options);
}

async function readCredentialSnapshot(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
  includeBearer = true,
): Promise<CredentialSnapshot> {
  const keys = {
    metadata: bindingMetadataKey(reference),
    staging: bindingStagingKey(reference),
    failure: bindingFailureKey(reference),
    owner: bindingOwnerKey(reference),
    bearer: reference.key,
  } as const;

  const failureValue = await readStoreValue(store, keys.failure, options);
  const stagingValue = await readStoreValue(store, keys.staging, options);
  const metadataValue = await readStoreValue(store, keys.metadata, options);
  const ownerValue = await readStoreValue(store, keys.owner, options);
  const bearerValue = includeBearer
    ? await readStoreValue(store, keys.bearer, options)
    : undefined;

  return {
    keys: { ...keys },
    values: {
      metadata: metadataValue,
      staging: stagingValue,
      failure: failureValue,
      owner: ownerValue,
      bearer: bearerValue,
    },
    binding: parseSnapshotBindingEntry(metadataValue),
    staging: parseSnapshotMarkerEntry(
      stagingValue,
      CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA,
    ),
    failure: parseSnapshotMarkerEntry(
      failureValue,
      CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
    ),
    owner: parseSnapshotOwnerEntry(ownerValue),
  };
}

function keysOwnedByTransaction(
  snapshot: CredentialSnapshot,
  transactionId: string,
): CredentialSnapshotKey[] {
  const owned = new Set<CredentialSnapshotKey>();
  const bindingId = bindingTransactionId(snapshot.binding);
  const ownerId = ownerTransactionId(snapshot.owner);
  const failureId = markerTransactionId(snapshot.failure);
  const stagingId = markerTransactionId(snapshot.staging);

  if (bindingId === transactionId) {
    owned.add('metadata');
  }
  if (ownerId === transactionId) {
    owned.add('owner');
  }
  if (failureId === transactionId) {
    owned.add('failure');
  }
  if (stagingId === transactionId) {
    owned.add('staging');
  }
  if (
    snapshot.values.bearer !== undefined &&
    (
      ownerId === transactionId ||
      (bindingId === transactionId && (failureId === transactionId || stagingId === transactionId))
    )
  ) {
    owned.add('bearer');
  }

  return CREDENTIAL_DELETE_ORDER.filter((key) => owned.has(key));
}

async function snapshotStillMatches(
  access: SnapshotMutationAccess,
  snapshot: CredentialSnapshot,
  expected: Record<CredentialSnapshotKey, unknown>,
): Promise<boolean> {
  for (const key of CREDENTIAL_SNAPSHOT_KEYS) {
    const current = await access.read(snapshot.keys[key]);
    if (!Object.is(current, expected[key])) {
      return false;
    }
  }

  return true;
}

async function deleteObservedSnapshot(
  access: SnapshotMutationAccess,
  snapshot: CredentialSnapshot,
  targetKeys: readonly CredentialSnapshotKey[],
  options: {
    continueOnDeleteError?: boolean;
    onDeleteError?: (key: CredentialSnapshotKey, error: unknown) => void;
  } = {},
): Promise<boolean> {
  const expected = {
    metadata: snapshot.values.metadata,
    staging: snapshot.values.staging,
    failure: snapshot.values.failure,
    owner: snapshot.values.owner,
    bearer: snapshot.values.bearer,
  } satisfies Record<CredentialSnapshotKey, unknown>;
  const targets = new Set<CredentialSnapshotKey>(targetKeys);
  let deletedAny = false;

  for (const key of CREDENTIAL_DELETE_ORDER) {
    if (!targets.has(key) || expected[key] === undefined) {
      continue;
    }

    if (!(await snapshotStillMatches(access, snapshot, expected))) {
      return deletedAny;
    }

    try {
      await access.delete(snapshot.keys[key]);
      expected[key] = undefined;
      deletedAny = true;
    } catch (error) {
      options.onDeleteError?.(key, error);
      if (options.continueOnDeleteError !== true) {
        return deletedAny;
      }
    }
  }

  return deletedAny;
}

async function readStableCredentialSnapshot(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
):
  Promise<
    | { status: 'stable'; snapshot: CredentialSnapshot; bearer: unknown }
    | { status: 'update_in_progress' }
    | { status: 'invalid'; reason: CaveStoredCredentialInvalidReason }
  > {
  for (let attempt = 0; attempt < CAVE_CREDENTIAL_STABLE_READ_ATTEMPTS; attempt += 1) {
    const before = await readCredentialSnapshot(store, reference, options, false);
    const beforeState = assessSnapshotReadState(before);
    if (beforeState.status !== 'continue') {
      return beforeState;
    }

    const bearer = await readStoreValue(store, reference.key, options);
    const after = await readCredentialSnapshot(store, reference, options, false);
    const afterState = assessSnapshotReadState(after);
    if (afterState.status !== 'continue') {
      return afterState;
    }

    if (snapshotHeaderValuesEqual(before, after)) {
      return {
        status: 'stable',
        snapshot: after,
        bearer,
      };
    }
  }

  return { status: 'update_in_progress' };
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

async function safeRollbackValue(
  operation: Promise<unknown>,
): Promise<unknown> {
  try {
    return await awaitRollbackCall(operation);
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
  cause: unknown,
): Promise<void> {
  const failures: RollbackFailure[] = [];
  const failureKey = bindingFailureKey(reference);

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
  const snapshot = {
    keys: {
      metadata: bindingMetadataKey(reference),
      staging: bindingStagingKey(reference),
      failure: failureKey,
      owner: bindingOwnerKey(reference),
      bearer: reference.key,
    },
    values: {
      metadata: await safeRollbackValue(store.get(bindingMetadataKey(reference))),
      staging: await safeRollbackValue(store.get(bindingStagingKey(reference))),
      failure: await safeRollbackValue(store.get(failureKey)),
      owner: await safeRollbackValue(store.get(bindingOwnerKey(reference))),
      bearer: await safeRollbackValue(store.get(reference.key)),
    },
  } satisfies Pick<CredentialSnapshot, 'keys' | 'values'>;
  const parsedSnapshot: CredentialSnapshot = {
    ...snapshot,
    binding: parseSnapshotBindingEntry(snapshot.values.metadata),
    staging: parseSnapshotMarkerEntry(
      snapshot.values.staging,
      CAVE_CREDENTIAL_BINDING_STAGING_SCHEMA,
    ),
    failure: parseSnapshotMarkerEntry(
      snapshot.values.failure,
      CAVE_CREDENTIAL_BINDING_FAILURE_SCHEMA,
    ),
    owner: parseSnapshotOwnerEntry(snapshot.values.owner),
  };
  const targetKeys = new Set<CredentialSnapshotKey>(keysOwnedByTransaction(parsedSnapshot, transactionId));

  if (markerTransactionId(parsedSnapshot.failure) === transactionId) {
    targetKeys.add('failure');
  }
  if (markerTransactionId(parsedSnapshot.staging) === transactionId) {
    targetKeys.add('staging');
  }

  await deleteObservedSnapshot(
    {
      read: async (key) => await safeRollbackValue(store.get(key)),
      delete: async (key) => await awaitRollbackCall(queuedStoreDelete(store, key)),
    },
    parsedSnapshot,
    [...targetKeys],
    {
      continueOnDeleteError: true,
      onDeleteError: (key, error) => {
        failures.push({
          step: `delete_${key}`,
          error,
        });
      },
    },
  );

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

      await rollbackCredentialWrite(store, reference, transactionId, error);
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
  const stable = await readStableCredentialSnapshot(store, reference, options);
  if (stable.status === 'update_in_progress') {
    return { status: 'update_in_progress' };
  }
  if (stable.status === 'invalid') {
    return {
      status: 'invalid',
      reason: stable.reason,
    };
  }

  const { snapshot, bearer } = stable;
  if (bearer === undefined) {
    return snapshot.values.metadata === undefined && snapshot.values.owner === undefined
      ? { status: 'missing' }
      : {
          status: 'invalid',
          reason: 'authority_binding_incomplete',
        };
  }

  if (typeof bearer !== 'string' || !isBearer(bearer)) {
    return { status: 'invalid_bearer' };
  }

  const stored = snapshot.binding;
  if (stored === undefined || isInvalidCredentialSnapshotEntry(stored)) {
    return {
      status: 'invalid',
      reason: snapshot.values.owner === undefined
        ? 'authority_binding_missing'
        : 'authority_binding_incomplete',
    };
  }

  const owner = snapshot.owner;
  if (
    stored.transactionId === undefined ||
    owner === undefined ||
    isInvalidCredentialSnapshotEntry(owner) ||
    owner.transactionId !== stored.transactionId
  ) {
    return {
      status: 'invalid',
      reason: 'authority_binding_incomplete',
    };
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
    const snapshot = await readCredentialSnapshot(store, reference, options, true);
    if (isSnapshotStructurallyInvalid(snapshot)) {
      return;
    }

    const failureId = markerTransactionId(snapshot.failure);
    const stagingId = markerTransactionId(snapshot.staging);
    if (stagingId !== undefined && stagingId !== failureId) {
      return;
    }

    const committedId = committedTransactionId(snapshot);
    const currentOwnedId = ownedTransactionId(snapshot);
    const targetKeys = new Set<CredentialSnapshotKey>();
    if (currentOwnedId !== undefined) {
      for (const key of keysOwnedByTransaction(snapshot, currentOwnedId)) {
        targetKeys.add(key);
      }

      if (
        failureId !== undefined &&
        failureId !== (committedId ?? currentOwnedId) &&
        (stagingId === undefined || stagingId === failureId)
      ) {
        targetKeys.add('failure');
        if (stagingId === failureId) {
          targetKeys.add('staging');
        }
      }
    } else if (
      failureId !== undefined &&
      (stagingId === undefined || stagingId === failureId) &&
      (bindingTransactionId(snapshot.binding) === undefined ||
        bindingTransactionId(snapshot.binding) === failureId) &&
      (ownerTransactionId(snapshot.owner) === undefined ||
        ownerTransactionId(snapshot.owner) === failureId)
    ) {
      for (const key of keysOwnedByTransaction(snapshot, failureId)) {
        targetKeys.add(key);
      }
      targetKeys.add('failure');
      if (stagingId === failureId) {
        targetKeys.add('staging');
      }
    }

    if (
      targetKeys.size === 0 &&
      snapshot.binding !== undefined &&
      !isInvalidCredentialSnapshotEntry(snapshot.binding) &&
      snapshot.binding.transactionId !== undefined &&
      snapshot.values.owner === undefined &&
      snapshot.values.bearer === undefined &&
      failureId === undefined &&
      stagingId === undefined
    ) {
      targetKeys.add('metadata');
    }

    if (targetKeys.size === 0) {
      return;
    }

    try {
      await deleteObservedSnapshot(
        {
          read: async (key) => await readStoreValue(store, key, options),
          delete: async (key) => await awaitStoreCall(queuedStoreDelete(store, key), options),
        },
        snapshot,
        [...targetKeys],
      );
    } catch {
      // Best-effort fail closed.
    }
  });
}

export async function forgetStoredCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  options: CredentialBindingMutationOptions = {},
): Promise<boolean> {
  return await serializeReferenceMutation(store, reference, async () => {
    const snapshot = await readCredentialSnapshot(store, reference, options, true);
    if (!isSnapshotStructurallyInvalid(snapshot)) {
      const failureId = markerTransactionId(snapshot.failure);
      const stagingId = markerTransactionId(snapshot.staging);
      if (stagingId !== undefined && stagingId !== failureId) {
        return false;
      }
    }

    try {
      return await deleteObservedSnapshot(
        {
          read: async (key) => await readStoreValue(store, key, options),
          delete: async (key) => await awaitStoreCall(queuedStoreDelete(store, key), options),
        },
        snapshot,
        CREDENTIAL_SNAPSHOT_KEYS,
      );
    } catch {
      return false;
    }
  });
}

export async function inspectStoredCredentialMaterial(
  store: SecretStore,
  reference: SecretStoreReference,
  isBearer: (value: string) => boolean,
  options: CredentialBindingMutationOptions = {},
): Promise<StoredCaveCredentialMaterial> {
  const stable = await readStableCredentialSnapshot(store, reference, options);
  if (stable.status === 'update_in_progress') {
    return { status: 'update_in_progress' };
  }
  if (stable.status === 'invalid') {
    return { status: 'incomplete' };
  }

  const { snapshot, bearer } = stable;
  if (bearer === undefined) {
    return snapshot.values.metadata === undefined && snapshot.values.owner === undefined
      ? { status: 'missing' }
      : { status: 'incomplete' };
  }

  if (typeof bearer !== 'string' || !isBearer(bearer)) {
    return { status: 'invalid_bearer' };
  }

  const stored = snapshot.binding;
  const owner = snapshot.owner;
  if (
    stored === undefined ||
    isInvalidCredentialSnapshotEntry(stored) ||
    stored.state !== 'bound' ||
    stored.transactionId === undefined ||
    owner === undefined ||
    isInvalidCredentialSnapshotEntry(owner) ||
    owner.transactionId !== stored.transactionId
  ) {
    return { status: 'incomplete' };
  }

  return { status: 'present' };
}
