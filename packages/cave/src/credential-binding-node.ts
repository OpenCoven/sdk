import { caveAuthorityBindingFromDiscoveredEndpoint } from './authority-binding.js';
import {
  loadBoundCredentialForAuthority,
  type LoadedCaveCredential,
} from './credential-binding.js';
import type { CaveDiscoveredEndpoint } from './discovery.js';
import type {
  OperationContext,
  SecretStore,
  SecretStoreReference,
} from '@opencoven/sdk-core';

export * from './credential-binding.js';

export async function loadBoundCredential(
  store: SecretStore,
  reference: SecretStoreReference,
  discovered: CaveDiscoveredEndpoint,
  isBearer: (value: string) => boolean,
  options: {
    context?: OperationContext;
    invalidateInvalid?: boolean;
    preserveForAuthenticatedAuthority?: boolean;
    verifyAuthorityInstance?: (instanceId: string) => Promise<boolean>;
  } = {},
): Promise<LoadedCaveCredential> {
  return await loadBoundCredentialForAuthority(
    store,
    reference,
    (instanceId) => caveAuthorityBindingFromDiscoveredEndpoint(discovered, instanceId),
    isBearer,
    options,
  );
}
