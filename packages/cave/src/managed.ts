import {
  CaveClient,
  type CaveManagedNativeCredentialCustody,
} from './client.js';

import type { OperationDefaults } from '@opencoven/sdk-core';
import type { CaveManagedCredentialTransport } from './transport.js';

export interface CaveManagedClientOptions {
  transport: CaveManagedCredentialTransport;
  operation?: OperationDefaults;
}

export function createManagedCaveClient(
  options: CaveManagedClientOptions,
): CaveClient {
  const credentialCustody: CaveManagedNativeCredentialCustody = {
    mode: 'managed-native',
  };
  return new CaveClient({
    transport: options.transport,
    credentialCustody,
    ...(options.operation === undefined ? {} : { operation: options.operation }),
  });
}

export {
  CaveClient,
  CaveClientError,
  CavePairingSession,
  isCaveClientError,
  normalizeCaveError,
} from './client.js';
export {
  CAVE_ANALYTICS_WINDOWS,
  CAVE_FAMILIAR_PROPERTIES,
  CAVE_PAIRING_SCOPES,
  CAVE_PAIRING_STATUSES,
} from './schemas.js';
export {
  discoverManagedCaveEndpoint,
} from './managed-discovery.js';
export type {
  CaveClientOptions,
  CaveCredentialBinding,
  CaveFamiliarAnalyticsOptions,
  CaveManagedNativeCredentialCustody,
} from './client.js';
export type {
  CaveManagedDiscoveryOptions,
  CaveManagedDiscoverySource,
  CaveManagedDiscoveredEndpoint,
} from './managed-discovery.js';
export type {
  CaveManagedCredentialTransport,
  CaveTransport,
} from './transport.js';
export type {
  CaveCanonicalFamiliar,
  CaveConversation,
  CaveConversationMessage,
  CaveCredentialAccess,
  CaveCredentialMetadata,
  CaveCredentialStatus,
  CaveHealth,
  CaveManagedCredentialStatusResult,
  CaveManagedForgetCredentialResult,
  CaveManagedPairingCreated,
  CaveManagedPairingExchange,
  CavePairingRequest,
  CavePairingScope,
  CavePairingState,
  CavePairingStatus,
  CaveProject,
} from './schemas.js';
