import { createOperationScope, type OperationContext } from '@opencoven/sdk-core/browser';

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

/** Native-owned proof, issued only after opening the bound HPKE response. */
export interface CaveManagedHpkeAuthentication {
  mechanism: 'hpke-bound-v1';
  keyId: string;
}

export interface CaveManagedHpkeResult<T = unknown> {
  authentication: CaveManagedHpkeAuthentication;
  value: T;
}

type Authority = CaveManagedDiscoveredEndpoint;
type AuthoritySlot = { identity?: string };
const iteratorAuthorities = new WeakMap<AbortSignal, AuthoritySlot>();

/** Only CaveClient's iterator path associates the per-page child operation. */
export function associateManagedIteratorAuthority(parent: AbortSignal, child: AbortSignal): void {
  let slot = iteratorAuthorities.get(parent);
  if (slot === undefined) {
    slot = {};
    iteratorAuthorities.set(parent, slot);
  }
  iteratorAuthorities.set(child, slot);
}

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, retryable: false });
}

export function ensureManagedReadActive(context?: OperationContext): void {
  if (context?.signal.aborted === true) throw context.signal.reason;
  if (context?.deadline !== undefined && context.deadline <= performance.now()) {
    throw Object.assign(new Error('Managed Cave read timed out.'), { code: 'timeout', retryable: true });
  }
}

function dataObject(value: unknown): Record<string, unknown> | undefined {
  const snapshot = snapshotManagedResult(value);
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown> : undefined;
}

export function requireManagedHpkeAuthentication(value: unknown, authority: Extract<Authority, { version: 2 }>): void {
  const proof = dataObject(value);
  if (proof === undefined || Object.keys(proof).length !== 2
    || proof.mechanism !== 'hpke-bound-v1' || proof.keyId !== authority.authority.keyId) {
    throw failure('invalid_response', 'Managed Cave HPKE authentication was invalid.');
  }
}

export function unwrapManagedHpkeResult(value: unknown, authority: Extract<Authority, { version: 2 }>): unknown {
  const result = dataObject(value);
  if (result === undefined || Object.keys(result).length !== 2
    || !Object.hasOwn(result, 'authentication') || !Object.hasOwn(result, 'value')) {
    throw failure('invalid_response', 'Managed Cave HPKE result was invalid.');
  }
  requireManagedHpkeAuthentication(result.authentication, authority);
  return result.value;
}

export function captureManagedHpkeDiscovery(value: unknown): CaveManagedHpkeDiscovery | undefined {
  if (value === undefined) return undefined;
  const own = (candidate: unknown, keys: string[]): PropertyDescriptorMap => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string'
      || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, 'value'))) throw new TypeError();
    return descriptors;
  };
  try {
    const descriptors = own(value, ['source', 'options']);
    if (descriptors.source === undefined) throw new TypeError();
    const options = descriptors.options?.value as unknown;
    const capturedOptions = options === undefined ? undefined
      : Object.fromEntries(Object.entries(own(options, ['signal', 'timeoutMs', 'observer', 'maxRecordBytes', 'operation']))
        .map(([key, descriptor]) => [key, descriptor.value as unknown]));
    if (capturedOptions?.operation !== undefined) {
      capturedOptions.operation = Object.freeze(Object.fromEntries(Object.entries(
        own(capturedOptions.operation, ['timeoutMs', 'observer']),
      ).map(([key, descriptor]) => [key, descriptor.value as unknown])));
    }
    return Object.freeze({ source: descriptors.source.value as CaveManagedDiscoverySource,
      ...(capturedOptions === undefined ? {} : { options: Object.freeze(capturedOptions) }) });
  } catch {
    throw new TypeError('Managed Cave discovery options must use own data properties.');
  }
}

export function createManagedHpkeAuthorityResolver(discovery: CaveManagedHpkeDiscovery | undefined) {
  let observedV2 = false;
  return {
    async run<T>(operation: string, context: OperationContext | undefined,
      execute: (context: OperationContext | undefined) => Promise<T>): Promise<T> {
      const configuredSignal = discovery?.options?.signal;
      if (configuredSignal === undefined) {
        const result = await execute(context);
        ensureManagedReadActive(context);
        return result;
      }
      const scope = createOperationScope({ system: 'cave', operation }, {
        signals: context === undefined ? [configuredSignal] : [context.signal, configuredSignal],
      });
      const slot = context === undefined ? undefined : iteratorAuthorities.get(context.signal);
      if (slot !== undefined) iteratorAuthorities.set(scope.context.signal, slot);
      try {
        ensureManagedReadActive(scope.context);
        const result = await Promise.race([execute(scope.context), scope.termination]);
        ensureManagedReadActive(scope.context);
        return result;
      } finally {
        scope.dispose();
      }
    },
    async resolve(context?: OperationContext): Promise<Authority | undefined> {
      ensureManagedReadActive(context);
      if (discovery === undefined) return undefined;
      const authority = await discoverManagedCaveEndpoint(discovery.source, {
        ...discovery.options,
        ...(context === undefined ? {} : { signal: context.signal }),
      });
      ensureManagedReadActive(context);
      if (authority.version === 2) observedV2 = true;
      return authority;
    },
    beforeDispatch(authority: Authority | undefined, context?: OperationContext): void {
      ensureManagedReadActive(context);
      if (discovery?.options?.signal?.aborted === true) throw discovery.options.signal.reason;
      if (authority === undefined) return;
      if (authority.version === 1 && observedV2) {
        throw failure('reconcile_required', 'Managed Cave discovery attempted an HPKE downgrade.');
      }
      const slot = context === undefined ? undefined : iteratorAuthorities.get(context.signal);
      if (slot === undefined) return;
      // Discovery parsing returns a canonical, owned snapshot of every identity field.
      const identity = JSON.stringify(authority);
      if (slot.identity !== undefined && slot.identity !== identity) {
        throw failure('reconcile_required', 'The managed Cave authority changed during iteration.');
      }
      slot.identity = identity;
    },
  };
}
