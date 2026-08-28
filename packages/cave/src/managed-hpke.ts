import type { OperationContext } from '@opencoven/sdk-core/browser';

import {
  discoverManagedCaveEndpoint,
  type CaveManagedDiscoveryOptions,
  type CaveManagedDiscoverySource,
  type CaveManagedDiscoveredEndpoint,
} from './managed-discovery.js';
import { snapshotManagedResult } from './managed-snapshot.js';

export interface CaveManagedHpkeDiscovery {
  source: CaveManagedDiscoverySource;
  options?: CaveManagedDiscoveryOptions;
}

export interface CaveManagedHpkeAuthentication {
  mechanism: 'hpke-bound-v1';
  keyId: string;
}

export interface CaveManagedHpkeResult<T = unknown> {
  authentication: CaveManagedHpkeAuthentication;
  value: T;
}

function managedHpkeError(
  code: 'invalid_response' | 'unsupported_operation',
  message: string,
): Error {
  return Object.assign(new Error(message), {
    code,
    retryable: false,
  });
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  const snapshot = snapshotManagedResult(value);
  return typeof snapshot === 'object' &&
    snapshot !== null &&
    !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : undefined;
}

export function requireManagedHpkeAuthentication(
  value: unknown,
  discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>,
): CaveManagedHpkeAuthentication {
  const authentication = dataRecord(value);
  if (
    authentication === undefined ||
    !exactKeys(authentication, ['mechanism', 'keyId']) ||
    authentication.mechanism !== 'hpke-bound-v1' ||
    authentication.keyId !== discovered.authority.keyId
  ) {
    throw managedHpkeError(
      'invalid_response',
      'Managed Cave HPKE authentication was invalid.',
    );
  }
  return Object.freeze({
    mechanism: 'hpke-bound-v1',
    keyId: discovered.authority.keyId,
  });
}

export function unwrapManagedHpkeResult(
  value: unknown,
  discovered: Extract<CaveManagedDiscoveredEndpoint, { version: 2 }>,
): unknown {
  const result = dataRecord(value);
  if (
    result === undefined ||
    !exactKeys(result, ['authentication', 'value'])
  ) {
    throw managedHpkeError(
      'invalid_response',
      'Managed Cave HPKE result was invalid.',
    );
  }
  requireManagedHpkeAuthentication(result.authentication, discovered);
  return result.value;
}

export function missingManagedHpkeOperation(operation: string): Error {
  return managedHpkeError(
    'unsupported_operation',
    `Managed native Cave ${operation} HPKE operation was not configured.`,
  );
}

export function createManagedHpkeAuthorityResolver(
  discovery: CaveManagedHpkeDiscovery | undefined,
): (
  context: OperationContext | undefined,
) => Promise<Extract<CaveManagedDiscoveredEndpoint, { version: 2 }> | undefined> {
  let observedV2 = false;
  return async (context) => {
    if (discovery === undefined) {
      return undefined;
    }
    const discovered = await discoverManagedCaveEndpoint(
      discovery.source,
      {
        ...(discovery.options ?? {}),
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
      },
    );
    if (discovered.version === 2) {
      observedV2 = true;
      return discovered;
    }
    if (observedV2) {
      throw managedHpkeError(
        'invalid_response',
        'Managed Cave discovery attempted an HPKE downgrade.',
      );
    }
    return undefined;
  };
}
