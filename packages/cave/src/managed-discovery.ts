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
  parseCaveDiscoveryRecord,
  type CaveDiscoveryErrorCode,
} from './discovery-record.js';
import { snapshotManagedResult } from './managed-snapshot.js';

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

export interface CaveManagedDiscoveredEndpoint {
  version: 1;
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

function parseSourceResult(
  value: unknown,
  maxRecordBytes: number,
): CaveManagedDiscoveredEndpoint {
  const snapshot = snapshotManagedResult(value);
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
    if (new TextEncoder().encode(snapshot.bytes).byteLength > maxRecordBytes) {
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

  const parsed = parseCaveDiscoveryRecord(serialized, () => processAlive);
  const endpoint = {
    version: parsed.version,
    endpoint: parsed.endpoint,
    freshness: parsed.freshness,
    record: { identity, device, inode },
  };
  const result = snapshotManagedResult(endpoint);
  if (result === undefined) {
    return invalidRecord();
  }
  return result as CaveManagedDiscoveredEndpoint;
}

export async function discoverManagedCaveEndpoint(
  source: CaveManagedDiscoverySource,
  options: CaveManagedDiscoveryOptions = {},
): Promise<CaveManagedDiscoveredEndpoint> {
  const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes <= 0) {
    throw new RangeError('maxRecordBytes must be a positive safe integer.');
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
          return parseSourceResult(value, maxRecordBytes);
        } catch (error) {
          throw sanitizedDiscoveryError(error);
        }
      },
    );
  } catch (error) {
    throw sanitizedDiscoveryBoundaryError(error);
  }
}
