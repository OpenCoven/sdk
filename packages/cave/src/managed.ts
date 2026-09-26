import {
  captureManagedHpkeDiscovery,
  createManagedHpkeAuthorityResolver,
  unwrapManagedHpkeResult,
  type CaveManagedHpkeDiscovery,
} from './managed-hpke.js';
import type { OperationContext } from '@opencoven/sdk-core/browser';
import {
  CaveClient,
  type CaveManagedNativeCredentialCustody,
} from './client.js';

import type { OperationDefaults } from '@opencoven/sdk-core/browser';
import type { CaveManagedCredentialTransport } from './transport.js';

export interface CaveManagedClientOptions {
  transport: CaveManagedCredentialTransport;
  operation?: OperationDefaults;
  discovery?: CaveManagedHpkeDiscovery;
}

function ownManagedClientOptions(
  value: unknown,
): { transport: CaveManagedCredentialTransport; operation: OperationDefaults | undefined; discovery: CaveManagedHpkeDiscovery | undefined } | undefined {
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
            (key !== 'transport' && key !== 'operation' && key !== 'discovery') ||
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

    const discovery = captureManagedHpkeDiscovery(descriptors.discovery?.value);
    const operationDescriptor = descriptors.operation;
    const operationValue: unknown = operationDescriptor?.value;
    if (operationDescriptor === undefined) {
      return {
        transport: transport.value as CaveManagedCredentialTransport,
        discovery,
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
        discovery,
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

function wrapManagedReads(transport: CaveManagedCredentialTransport, discovery: CaveManagedHpkeDiscovery): CaveManagedCredentialTransport {
  const resolver = createManagedHpkeAuthorityResolver(discovery);
  const invoke = (name: keyof CaveManagedCredentialTransport, args: unknown[], beforeInvoke?: () => void): Promise<unknown> => {
    const method: unknown = Reflect.get(transport, name);
    if (typeof method !== 'function') throw Object.assign(new Error('Managed Cave read was not configured.'), {
      code: 'unsupported_operation', retryable: false,
    });
    beforeInvoke?.();
    return Promise.resolve(Reflect.apply(method, transport, args) as unknown);
  };
  const read = (name: keyof CaveManagedCredentialTransport, hpke: keyof CaveManagedCredentialTransport,
    args: unknown[], context?: OperationContext): Promise<unknown> => resolver.run(String(name), context, async (context) => {
    const authority = await resolver.resolve(context);
    const guard = () => resolver.beforeDispatch(authority, context);
    guard();
    return authority?.version === 2
      ? unwrapManagedHpkeResult(await invoke(hpke, [...args, authority, context], guard), authority)
      : await invoke(name, [...args, context], guard);
  });
  return {
    health: (context) => transport.health(context),
    managedPairingCreate: (request, context) => transport.managedPairingCreate(request, context),
    managedPairingPoll: (id, context) => transport.managedPairingPoll(id, context),
    managedPairingExchange: (id, context) => transport.managedPairingExchange(id, context),
    managedCredentialStatus: (context) => transport.managedCredentialStatus(context),
    managedForgetCredential: (context) => transport.managedForgetCredential(context),
    familiars: (context) => read('familiars', 'managedHpkeFamiliars', [], context) as ReturnType<NonNullable<CaveManagedCredentialTransport['familiars']>>,
    listFamiliars: (options, context) => read('listFamiliars', 'managedHpkeListFamiliars', [options], context),
    listProjects: (options, context) => read('listProjects', 'managedHpkeListProjects', [options], context),
    listConversations: (options, context) => read('listConversations', 'managedHpkeListConversations', [options], context),
    getConversation: (id, context) => read('getConversation', 'managedHpkeGetConversation', [id], context),
    listConversationMessages: (id, options, context) => read('listConversationMessages', 'managedHpkeListConversationMessages', [id, options], context),
    familiarContract: (id, context) => read('familiarContract', 'managedHpkeFamiliarContract', [id], context) as ReturnType<NonNullable<CaveManagedCredentialTransport['familiarContract']>>,
    familiarAnalytics: (id, options, context) => read('familiarAnalytics', 'managedHpkeFamiliarAnalytics', [id, options], context) as ReturnType<NonNullable<CaveManagedCredentialTransport['familiarAnalytics']>>,
  };
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
    transport: captured.discovery === undefined ? captured.transport : wrapManagedReads(captured.transport, captured.discovery),
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

export { canonicalFamiliarContractData, canonicalFamiliarAnalyticsData } from './client.js';

export type { CaveManagedHpkeDiscovery, CaveManagedHpkeAuthentication, CaveManagedHpkeResult } from './managed-hpke.js';
