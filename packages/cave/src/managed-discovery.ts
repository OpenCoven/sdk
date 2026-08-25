import {
  runOperation,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
} from '@opencoven/sdk-core/browser';

import {
  CaveDiscoveryError,
  parseCaveDiscoveryRecord,
} from './discovery-record.js';

const DEFAULT_MAX_RECORD_BYTES = 16 * 1024;

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

function parseSourceResult(
  value: unknown,
  maxRecordBytes: number,
): CaveManagedDiscoveredEndpoint {
  if (!isDataRecord(value) || !hasExactKeys(value, ['bytes', 'record'])) {
    return invalidRecord();
  }
  if (!isDataRecord(value.record) || !hasExactKeys(value.record, [
    'identity',
    'device',
    'inode',
    'processAlive',
  ])) {
    return invalidRecord();
  }
  const { identity, device, inode, processAlive } = value.record;
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
  if (typeof value.bytes === 'string') {
    if (new TextEncoder().encode(value.bytes).byteLength > maxRecordBytes) {
      throw new CaveDiscoveryError('body_limit', 'Cave discovery record exceeded its size limit.');
    }
    serialized = value.bytes;
  } else if (value.bytes instanceof Uint8Array) {
    if (value.bytes.byteLength > maxRecordBytes) {
      throw new CaveDiscoveryError('body_limit', 'Cave discovery record exceeded its size limit.');
    }
    try {
      serialized = new TextDecoder('utf-8', { fatal: true }).decode(value.bytes);
    } catch {
      return invalidRecord();
    }
  } else {
    return invalidRecord();
  }

  const parsed = parseCaveDiscoveryRecord(serialized, () => processAlive);
  return {
    version: parsed.version,
    endpoint: parsed.endpoint,
    freshness: parsed.freshness,
    record: { identity, device, inode },
  };
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

  return await runOperation(
    {
      system: 'cave',
      operation: 'managedDiscovery',
    },
    operationOptions,
    async (context) => parseSourceResult(await source.read(context), maxRecordBytes),
  );
}
