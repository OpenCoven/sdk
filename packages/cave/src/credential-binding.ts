import type { SecretStore, SecretStoreReference } from '@opencoven/sdk-core';

import type { CaveDiscoveredEndpoint } from './discovery.js';

const CAVE_CREDENTIAL_BINDING_SCHEMA = 'opencoven.cave.credential-binding.v1' as const;
const CAVE_CREDENTIAL_BINDING_KEY_PREFIX = 'opencoven.cave.credential-binding.v1.' as const;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;

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
  endpoint: string;
  record: {
    path: string;
    device: number;
    inode: number;
  };
  freshness: {
    pid: number;
    nonce: string;
    startedAt: string;
  };
}

export type LoadedCaveCredential =
  | { status: 'missing' }
  | { status: 'invalid_bearer' }
  | { status: 'invalid'; reason: CaveStoredCredentialInvalidReason }
  | { status: 'ready'; bearer: string };

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

function bindingRecord(
  discovered: CaveDiscoveredEndpoint,
  state: CaveStoredCredentialBindingState,
): CaveCredentialBindingRecord {
  return {
    schema: CAVE_CREDENTIAL_BINDING_SCHEMA,
    state,
    endpoint: discovered.endpoint.url,
    record: {
      path: discovered.record.path,
      device: discovered.record.device,
      inode: discovered.record.inode,
    },
    freshness: {
      pid: discovered.freshness.pid,
      nonce: discovered.freshness.nonce,
      startedAt: discovered.freshness.startedAt,
    },
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

  if (!isNonEmptyString(parsed.endpoint)) {
    return undefined;
  }

  if (
    !isObject(parsed.record) ||
    !isNonEmptyString(parsed.record.path) ||
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
    endpoint: parsed.endpoint,
    record: {
      path: parsed.record.path,
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

function mismatchReason(
  discovered: CaveDiscoveredEndpoint,
  stored: CaveCredentialBindingRecord,
): CaveStoredCredentialMismatchReason | undefined {
  if (
    discovered.endpoint.url !== stored.endpoint ||
    discovered.record.path !== stored.record.path
  ) {
    return 'authority_mismatch';
  }

  if (
    discovered.record.device !== stored.record.device ||
    discovered.record.inode !== stored.record.inode
  ) {
    return 'record_replaced';
  }

  if (
    discovered.freshness.pid !== stored.freshness.pid ||
    discovered.freshness.nonce !== stored.freshness.nonce ||
    discovered.freshness.startedAt !== stored.freshness.startedAt
  ) {
    return 'authority_restarted';
  }

  return undefined;
}

export async function storeBoundCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  bearer: string,
  discovered: CaveDiscoveredEndpoint,
): Promise<void> {
  const metadataKey = bindingMetadataKey(reference);
  await store.set(metadataKey, JSON.stringify(bindingRecord(discovered, 'pending')));
  await store.set(reference.key, bearer);
  await store.set(metadataKey, JSON.stringify(bindingRecord(discovered, 'bound')));
}

export async function loadBoundCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  discovered: CaveDiscoveredEndpoint,
  isBearer: (value: string) => boolean,
): Promise<LoadedCaveCredential> {
  const bearer = await store.get(reference.key);
  if (bearer === undefined) {
    return { status: 'missing' };
  }

  if (typeof bearer !== 'string' || !isBearer(bearer)) {
    return { status: 'invalid_bearer' };
  }

  const serialized = await store.get(bindingMetadataKey(reference));
  if (serialized === undefined) {
    return {
      status: 'invalid',
      reason: 'authority_binding_missing',
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

  if (stored.state !== 'bound') {
    return {
      status: 'invalid',
      reason: 'authority_binding_incomplete',
    };
  }

  const reason = mismatchReason(discovered, stored);
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
): Promise<void> {
  let bearerDeleted: boolean;

  try {
    bearerDeleted = await store.delete(reference.key);
  } catch {
    return;
  }

  try {
    await store.delete(bindingMetadataKey(reference));
  } catch {
    if (!bearerDeleted) {
      return;
    }
  }
}

export async function forgetStoredCredential(
  store: SecretStore,
  reference: SecretStoreReference,
): Promise<boolean> {
  const bearerDeleted = await store.delete(reference.key);
  const bindingDeleted = await store.delete(bindingMetadataKey(reference));

  return bearerDeleted || bindingDeleted;
}
