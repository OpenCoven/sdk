import type { CaveAuthorityBinding } from './schemas.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseCaveAuthorityBinding(value: unknown): CaveAuthorityBinding | undefined {
  if (!isObject(value) || value.version !== 1 || !isNonEmptyString(value.instanceId)) {
    return undefined;
  }

  if (
    !isObject(value.endpoint) ||
    value.endpoint.kind !== 'http' ||
    !isNonEmptyString(value.endpoint.url)
  ) {
    return undefined;
  }

  if (
    !isObject(value.record) ||
    !isNonEmptyString(value.record.identity) ||
    !isNonNegativeSafeInteger(value.record.device) ||
    !isNonNegativeSafeInteger(value.record.inode)
  ) {
    return undefined;
  }

  if (
    !isObject(value.freshness) ||
    !isNonNegativeSafeInteger(value.freshness.pid) ||
    !isNonEmptyString(value.freshness.nonce) ||
    !isNonEmptyString(value.freshness.startedAt)
  ) {
    return undefined;
  }

  return {
    version: 1,
    instanceId: value.instanceId,
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

export function discardPairingExchangeBearer(value: unknown): void {
  if (!isObject(value)) {
    return;
  }

  try {
    if (typeof value.bearer === 'string') {
      Reflect.set(value, 'bearer', '');
    }
  } catch {
    // Best effort only.
  }
}
