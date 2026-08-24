import type {
  CaveDiscoveredClientOptions,
  CaveDiscoveredEndpoint,
} from '@opencoven/cave-client';

import type { ResolvedCliRuntime } from './main.js';

type CaveAuthorityMismatchReason =
  | 'authority_mismatch'
  | 'authority_restarted'
  | 'record_replaced';

function caveAuthorityMismatchReason(
  expected: CaveDiscoveredEndpoint,
  current: CaveDiscoveredEndpoint,
): CaveAuthorityMismatchReason | undefined {
  if (
    current.endpoint.url !== expected.endpoint.url ||
    current.record.path !== expected.record.path
  ) {
    return 'authority_mismatch';
  }

  if (
    current.record.device !== expected.record.device ||
    current.record.inode !== expected.record.inode
  ) {
    return 'record_replaced';
  }

  if (
    current.freshness.pid !== expected.freshness.pid ||
    current.freshness.nonce !== expected.freshness.nonce ||
    current.freshness.startedAt !== expected.freshness.startedAt
  ) {
    return 'authority_restarted';
  }

  return undefined;
}

function pinnedCaveAuthorityError(reason: CaveAuthorityMismatchReason): Error {
  return Object.assign(
    new Error('The discovered Cave authority changed before the CLI could continue safely.'),
    {
      code: 'reconcile_required',
      details: { reason },
      retryable: true,
    },
  );
}

export function createPinnedCliCaveDiscoverEndpoint(
  runtime: ResolvedCliRuntime,
  initialAuthority?: CaveDiscoveredEndpoint,
): NonNullable<CaveDiscoveredClientOptions['discoverEndpoint']> {
  let expectedAuthority = initialAuthority;

  return async (options) => {
    const discovered = await runtime.cave.discoverEndpoint(options);

    if (expectedAuthority === undefined) {
      expectedAuthority = discovered;
      return discovered;
    }

    const reason = caveAuthorityMismatchReason(expectedAuthority, discovered);
    if (reason !== undefined) {
      throw pinnedCaveAuthorityError(reason);
    }

    return discovered;
  };
}
