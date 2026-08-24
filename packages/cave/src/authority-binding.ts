import { createHash } from 'node:crypto';

import type { CaveDiscoveredEndpoint } from './discovery.js';
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

function recordIdentity(path: string): string {
  return `sha256:${createHash('sha256').update(path, 'utf8').digest('hex')}`;
}

export function caveAuthorityBindingFromDiscoveredEndpoint(
  discovered: CaveDiscoveredEndpoint,
): CaveAuthorityBinding {
  return {
    version: discovered.version,
    endpoint: {
      kind: 'http',
      url: discovered.endpoint.url,
    },
    record: {
      identity: recordIdentity(discovered.record.path),
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

export function parseCaveAuthorityBinding(value: unknown): CaveAuthorityBinding | undefined {
  if (!isObject(value) || value.version !== 1) {
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
