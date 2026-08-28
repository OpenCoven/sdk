import {
  isOperationAbortedError,
  isOperationTimeoutError,
  runOperation,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core/browser';

import {
  CaveDiscoveryError,
  CAVE_HPKE_KEY_ID_DOMAIN,
  parseCaveDiscoveryRecordCandidate,
  verifyCaveDiscoveryRecordCandidate,
  type CaveDiscoveryErrorCode,
} from './discovery-record.js';
import {
  MANAGED_SNAPSHOT_LIMITS,
  snapshotManagedResult,
  snapshotManagedResultWithBudget,
} from './managed-snapshot.js';

const DEFAULT_MAX_RECORD_BYTES = 16 * 1024;
const DISCOVERY_ERROR_CODES = new Set<CaveDiscoveryErrorCode>([
  'not_found',
  'owner_mismatch',
  'unsafe_endpoint',
  'stale_record',
  'body_limit',
  'invalid_response',
  'timeout',
  'aborted',
]);

export interface CaveManagedDiscoverySource {
  /**
   * Native code must read the owner-checked record. The SDK validates the
   * returned bytes and metadata; browser code never reads the filesystem.
   */
  read(context?: OperationContext): Promise<unknown>;
}

export interface CaveManagedDiscoveryOptions extends OperationOptions {
  maxRecordBytes?: number;
  operation?: OperationDefaults;
}

interface CaveManagedDiscoveredEndpointBase {
  endpoint: {
    kind: 'http';
    url: string;
  };
  freshness: {
    pid: number;
    nonce: string;
    startedAt: string;
  };
  record: {
    identity: string;
    device: number;
    inode: number;
  };
}

interface CaveManagedHpkeAuthority {
  mechanism: 'hpke-bound-v1';
  mode: 'advertise' | 'enforce';
  keyId: string;
  publicKey: string;
  suite: {
    kemId: 32;
    kdfId: 1;
    aeadId: 2;
  };
}

export type CaveManagedDiscoveredEndpoint =
  | CaveManagedDiscoveredEndpointBase & {
      version: 1;
    }
  | CaveManagedDiscoveredEndpointBase & {
      version: 2;
      authority: CaveManagedHpkeAuthority;
    };

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F))
    ) {
      return true;
    }
  }
  return false;
}

function invalidRecord(): never {
  throw new CaveDiscoveryError(
    'invalid_response',
    'Managed Cave discovery data was malformed.',
  );
}

function discoveryErrorCode(error: unknown): CaveDiscoveryErrorCode | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return (
      descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      typeof descriptor.value === 'string' &&
      DISCOVERY_ERROR_CODES.has(descriptor.value as CaveDiscoveryErrorCode)
        ? descriptor.value as CaveDiscoveryErrorCode
        : undefined
    );
  } catch {
    return undefined;
  }
}

function sanitizedDiscoveryError(error: unknown): CaveDiscoveryError {
  switch (discoveryErrorCode(error)) {
    case 'body_limit':
      return new CaveDiscoveryError(
        'body_limit',
        'Managed Cave discovery data exceeded its size limit.',
      );
    case 'stale_record':
      return new CaveDiscoveryError(
        'stale_record',
        'Managed Cave discovery record was stale.',
      );
    case 'unsafe_endpoint':
      return new CaveDiscoveryError(
        'unsafe_endpoint',
        'Managed Cave discovery endpoint was unsafe.',
      );
    default:
      return new CaveDiscoveryError(
        'invalid_response',
        'Managed Cave discovery data was malformed.',
      );
  }
}

function sanitizedDiscoveryBoundaryError(error: unknown): CaveDiscoveryError {
  if (isOperationTimeoutError(error)) {
    return new CaveDiscoveryError(
      'timeout',
      'Managed Cave discovery timed out.',
    );
  }
  if (isOperationAbortedError(error)) {
    return new CaveDiscoveryError(
      'aborted',
      'Managed Cave discovery was aborted.',
    );
  }
  return sanitizedDiscoveryError(error);
}

function snapshotDiscoverySource(
  value: unknown,
  maxRecordBytes: number,
): { bytes: unknown; record: unknown } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  try {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 2 ||
      keys.some((key) => key !== 'bytes' && key !== 'record')
    ) {
      return undefined;
    }
    const bytes = Object.getOwnPropertyDescriptor(value, 'bytes');
    const record = Object.getOwnPropertyDescriptor(value, 'record');
    if (
      bytes === undefined ||
      record === undefined ||
      !Object.hasOwn(bytes, 'value') ||
      !Object.hasOwn(record, 'value')
    ) {
      return undefined;
    }

    const recordSnapshot = snapshotManagedResultWithBudget(record.value, {
      maxArrayElements: 1,
      maxEntries: 4,
      maxNodes: 1,
      maxStringCodeUnits: 1_024,
      maxTypedArrayElements: 1,
    });
    if (!recordSnapshot.valid) {
      return undefined;
    }
    const bytesSnapshot = snapshotManagedResultWithBudget(bytes.value, {
      maxArrayElements: maxRecordBytes,
      maxEntries: maxRecordBytes,
      maxNodes: 1,
      maxStringCodeUnits: maxRecordBytes,
      maxTypedArrayElements: maxRecordBytes,
    });
    if (!bytesSnapshot.valid) {
      if (bytesSnapshot.limitExceeded) {
        throw new CaveDiscoveryError(
          'body_limit',
          'Cave discovery record exceeded its size limit.',
        );
      }
      return undefined;
    }

    return Object.freeze({
      bytes: bytesSnapshot.value,
      record: recordSnapshot.value,
    });
  } catch (error) {
    if (error instanceof CaveDiscoveryError) {
      throw error;
    }
    return undefined;
  }
}

async function parseSourceResult(
  value: unknown,
  maxRecordBytes: number,
): Promise<CaveManagedDiscoveredEndpoint> {
  const snapshot = snapshotDiscoverySource(value, maxRecordBytes);
  if (snapshot === undefined) {
    return invalidRecord();
  }
  if (
    !isDataRecord(snapshot) ||
    !hasExactKeys(snapshot, ['bytes', 'record'])
  ) {
    return invalidRecord();
  }
  if (!isDataRecord(snapshot.record) || !hasExactKeys(snapshot.record, [
    'identity',
    'device',
    'inode',
    'processAlive',
  ])) {
    return invalidRecord();
  }
  const { identity, device, inode, processAlive } = snapshot.record;
  if (
    typeof identity !== 'string' ||
    identity.length === 0 ||
    identity.length > 1_024 ||
    hasControlCharacter(identity) ||
    typeof device !== 'number' ||
    !Number.isSafeInteger(device) ||
    device < 0 ||
    typeof inode !== 'number' ||
    !Number.isSafeInteger(inode) ||
    inode < 0 ||
    typeof processAlive !== 'boolean'
  ) {
    return invalidRecord();
  }

  let serialized: string;
  if (typeof snapshot.bytes === 'string') {
    if (!isUtf8WithinLimit(snapshot.bytes, maxRecordBytes)) {
      throw new CaveDiscoveryError('body_limit', 'Cave discovery record exceeded its size limit.');
    }
    serialized = snapshot.bytes;
  } else if (
    Array.isArray(snapshot.bytes) &&
    snapshot.bytes.every(
      (byte) =>
        typeof byte === 'number' &&
        Number.isSafeInteger(byte) &&
        byte >= 0 &&
        byte <= 255,
    )
  ) {
    if (snapshot.bytes.length > maxRecordBytes) {
      throw new CaveDiscoveryError('body_limit', 'Cave discovery record exceeded its size limit.');
    }
    try {
      serialized = new TextDecoder('utf-8', { fatal: true }).decode(
        new Uint8Array(snapshot.bytes),
      );
    } catch {
      return invalidRecord();
    }
  } else {
    return invalidRecord();
  }

  const candidate = parseCaveDiscoveryRecordCandidate(
    serialized,
    () => processAlive,
  );
  const computedKeyId =
    candidate.authorityKey === undefined
      ? undefined
      : new Uint8Array(
          await globalThis.crypto.subtle.digest(
            'SHA-256',
            concatenateBytes(
              new TextEncoder().encode(CAVE_HPKE_KEY_ID_DOMAIN),
              candidate.authorityKey.publicKey,
            ),
          ),
        );
  const parsed = verifyCaveDiscoveryRecordCandidate(
    candidate,
    computedKeyId,
  );
  const endpoint = {
    ...parsed,
    record: { identity, device, inode },
  };
  const result = snapshotManagedResult(endpoint);
  if (result === undefined) {
    return invalidRecord();
  }
  return result as CaveManagedDiscoveredEndpoint;
}

function concatenateBytes(
  left: Uint8Array,
  right: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function isUtf8WithinLimit(value: string, maximumBytes: number): boolean {
  if (value.length > maximumBytes) {
    return false;
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7F) {
      bytes += 1;
    } else if (codeUnit <= 0x7FF) {
      bytes += 2;
    } else if (
      codeUnit >= 0xD800 &&
      codeUnit <= 0xDBFF &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maximumBytes) {
      return false;
    }
  }
  return true;
}

export async function discoverManagedCaveEndpoint(
  source: CaveManagedDiscoverySource,
  options: CaveManagedDiscoveryOptions = {},
): Promise<CaveManagedDiscoveredEndpoint> {
  const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  if (
    !Number.isSafeInteger(maxRecordBytes) ||
    maxRecordBytes <= 0 ||
    maxRecordBytes > MANAGED_SNAPSHOT_LIMITS.arrayElements
  ) {
    throw new RangeError(
      `maxRecordBytes must be a positive safe integer no greater than ${MANAGED_SNAPSHOT_LIMITS.arrayElements}.`,
    );
  }
  const timeoutMs = options.timeoutMs ?? options.operation?.timeoutMs;
  const observer = options.observer ?? options.operation?.observer;
  const operationOptions: OperationOptions = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(observer === undefined ? {} : { observer }),
  };

  try {
    return await runOperation(
      {
        system: 'cave',
        operation: 'managedDiscovery',
      },
      operationOptions,
      async (context) => {
        let value: unknown;
        try {
          value = await source.read(context);
        } catch {
          throw new CaveDiscoveryError(
            'invalid_response',
            'Managed Cave discovery data could not be read.',
          );
        }
        try {
          return await parseSourceResult(value, maxRecordBytes);
        } catch (error) {
          throw sanitizedDiscoveryError(error);
        }
      },
    );
  } catch (error) {
    throw sanitizedDiscoveryBoundaryError(error);
  }
}
