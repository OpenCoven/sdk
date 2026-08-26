import {
  CaveClient,
  type CaveManagedNativeCredentialCustody,
} from './client.js';

import type { OperationDefaults } from '@opencoven/sdk-core/browser';
import type { CaveManagedCredentialTransport } from './transport.js';

export interface CaveManagedClientOptions {
  transport: CaveManagedCredentialTransport;
  operation?: OperationDefaults;
}

function ownManagedClientOptions(
  value: unknown,
): { transport: CaveManagedCredentialTransport; operation: OperationDefaults | undefined } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) => {
          if (typeof key !== 'string') {
            return true;
          }
          const descriptor = descriptors[key];
          return (
            (key !== 'transport' && key !== 'operation') ||
            descriptor === undefined ||
            !Object.hasOwn(descriptor, 'value')
          );
        },
      )
    ) {
      return undefined;
    }
    const transport = descriptors.transport;
    if (transport === undefined || !Object.hasOwn(transport, 'value')) {
      return undefined;
    }

    const operationDescriptor = descriptors.operation;
    const operationValue: unknown = operationDescriptor?.value;
    if (operationDescriptor === undefined) {
      return {
        transport: transport.value as CaveManagedCredentialTransport,
        operation: undefined,
      };
    }
    if (
      !Object.hasOwn(operationDescriptor, 'value') ||
      typeof operationValue !== 'object' ||
      operationValue === null ||
      Array.isArray(operationValue)
    ) {
      return undefined;
    }

    const operationDescriptors = Object.getOwnPropertyDescriptors(operationValue);
    const operationKeys = Reflect.ownKeys(operationDescriptors);
    if (
      operationKeys.some(
        (key) => {
          if (typeof key !== 'string') {
            return true;
          }
          const descriptor = operationDescriptors[key];
          return (
            (key !== 'timeoutMs' && key !== 'observer') ||
            descriptor === undefined ||
            !Object.hasOwn(descriptor, 'value')
          );
        },
      )
    ) {
      return undefined;
    }
    return {
      transport: transport.value as CaveManagedCredentialTransport,
      operation: Object.freeze({
        ...(operationDescriptors.timeoutMs?.value !== undefined
          ? { timeoutMs: operationDescriptors.timeoutMs.value as number }
          : {}),
        ...(operationDescriptors.observer?.value !== undefined
          ? {
              observer:
                operationDescriptors.observer.value as NonNullable<OperationDefaults['observer']>,
            }
          : {}),
      }),
    };
  } catch {
    return undefined;
  }
}

export function createManagedCaveClient(
  options: CaveManagedClientOptions,
): CaveClient {
  const captured = ownManagedClientOptions(options);
  if (captured === undefined) {
    throw new TypeError('Managed Cave client options must use own data properties.');
  }
  const credentialCustody: CaveManagedNativeCredentialCustody = {
    mode: 'managed-native',
  };
  return new CaveClient({
    transport: captured.transport,
    credentialCustody,
    ...(captured.operation === undefined ? {} : { operation: captured.operation }),
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
export type { CaveHpkeDiscoveryAuthority } from './discovery-record.js';
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
