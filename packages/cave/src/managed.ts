import {
  CaveClient,
  type CaveManagedNativeCredentialCustody,
} from './client.js';

import type { OperationDefaults } from '@opencoven/sdk-core/browser';
import {
  createManagedHpkeAuthorityResolver,
  missingManagedHpkeOperation,
  unwrapManagedHpkeResult,
  type CaveManagedHpkeDiscovery,
} from './managed-hpke.js';
import type {
  CaveManagedCredentialTransport,
} from './transport.js';

export interface CaveManagedClientOptions {
  transport: CaveManagedCredentialTransport;
  discovery?: CaveManagedHpkeDiscovery;
  operation?: OperationDefaults;
}

function ownManagedClientOptions(
  value: unknown,
): {
  transport: CaveManagedCredentialTransport;
  discovery: CaveManagedHpkeDiscovery | undefined;
  operation: OperationDefaults | undefined;
} | undefined {
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

    const operationDescriptor = descriptors.operation;
    const discoveryDescriptor = descriptors.discovery;
    let discovery: CaveManagedHpkeDiscovery | undefined;
    if (discoveryDescriptor !== undefined) {
      if (
        !Object.hasOwn(discoveryDescriptor, 'value') ||
        typeof discoveryDescriptor.value !== 'object' ||
        discoveryDescriptor.value === null ||
        Array.isArray(discoveryDescriptor.value)
      ) {
        return undefined;
      }
      const discoveryDescriptors = Object.getOwnPropertyDescriptors(
        discoveryDescriptor.value,
      );
      const discoveryKeys = Reflect.ownKeys(discoveryDescriptors);
      if (
        discoveryKeys.some(
          (key) =>
            typeof key !== 'string' ||
            (key !== 'source' && key !== 'options') ||
            discoveryDescriptors[key] === undefined ||
            !Object.hasOwn(discoveryDescriptors[key], 'value'),
        ) ||
        discoveryDescriptors.source === undefined
      ) {
        return undefined;
      }
      const discoveryOptions: unknown =
        discoveryDescriptors.options?.value;
      discovery = Object.freeze({
        source:
          discoveryDescriptors.source.value as CaveManagedHpkeDiscovery['source'],
        ...(discoveryOptions === undefined
          ? {}
          : {
              options:
                discoveryOptions as NonNullable<CaveManagedHpkeDiscovery['options']>,
            }),
      });
    }
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

function wrapManagedHpkeTransport(
  transport: CaveManagedCredentialTransport,
  discovery: CaveManagedHpkeDiscovery,
): CaveManagedCredentialTransport {
  const resolveAuthority = createManagedHpkeAuthorityResolver(discovery);
  const invokeManaged = async (
    methodName: keyof CaveManagedCredentialTransport,
    arguments_: readonly unknown[],
    operation: string,
  ): Promise<unknown> => {
    const method: unknown = Reflect.get(transport, methodName);
    if (typeof method !== 'function') {
      throw missingManagedHpkeOperation(operation);
    }
    return await Promise.resolve(
      Reflect.apply(method, transport, arguments_) as unknown,
    );
  };
  const wrapped: CaveManagedCredentialTransport = {
    health: (context) => transport.health(context),
    managedPairingCreate: (request, context) =>
      transport.managedPairingCreate(request, context),
    async managedPairingPoll(requestId, context) {
      const authority = await resolveAuthority(context);
      return authority === undefined
        ? await transport.managedPairingPoll(requestId, context)
        : unwrapManagedHpkeResult(
            await invokeManaged(
              'managedHpkePairingPoll',
              [requestId, authority, context],
              'pairingPoll',
            ),
            authority,
          );
    },
    async managedPairingExchange(requestId, context) {
      const authority = await resolveAuthority(context);
      return authority === undefined
        ? await transport.managedPairingExchange(requestId, context)
        : unwrapManagedHpkeResult(
            await invokeManaged(
              'managedHpkePairingExchange',
              [requestId, authority, context],
              'pairingExchange',
            ),
            authority,
          );
    },
    async managedCredentialStatus(context) {
      const authority = await resolveAuthority(context);
      return authority === undefined
        ? await transport.managedCredentialStatus(context)
        : unwrapManagedHpkeResult(
            await invokeManaged(
              'managedHpkeCredentialStatus',
              [authority, context],
              'credentialStatus',
            ),
            authority,
          );
    },
    managedForgetCredential: (context) =>
      transport.managedForgetCredential(context),
    async familiars(context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await invokeManaged(
          'familiars',
          [context],
          'familiars',
        ) as never;
      }
      return unwrapManagedHpkeResult(
        await invokeManaged(
          'managedHpkeFamiliars',
          [authority, context],
          'familiars',
        ),
        authority,
      ) as never;
    },
    async listFamiliars(pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await invokeManaged(
          'listFamiliars',
          [pageOptions, context],
          'listFamiliars',
        );
      }
      return unwrapManagedHpkeResult(
        await invokeManaged(
          'managedHpkeListFamiliars',
          [pageOptions, authority, context],
          'listFamiliars',
        ),
        authority,
      );
    },
    async listProjects(pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await invokeManaged(
          'listProjects',
          [pageOptions, context],
          'listProjects',
        );
      }
      return unwrapManagedHpkeResult(
        await invokeManaged(
          'managedHpkeListProjects',
          [pageOptions, authority, context],
          'listProjects',
        ),
        authority,
      );
    },
    async listConversations(pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await invokeManaged(
          'listConversations',
          [pageOptions, context],
          'listConversations',
        );
      }
      return unwrapManagedHpkeResult(
        await invokeManaged(
          'managedHpkeListConversations',
          [pageOptions, authority, context],
          'listConversations',
        ),
        authority,
      );
    },
    async getConversation(conversationId, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await invokeManaged(
          'getConversation',
          [conversationId, context],
          'getConversation',
        );
      }
      return unwrapManagedHpkeResult(
        await invokeManaged(
          'managedHpkeGetConversation',
          [conversationId, authority, context],
          'getConversation',
        ),
        authority,
      );
    },
    async listConversationMessages(conversationId, pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await invokeManaged(
          'listConversationMessages',
          [conversationId, pageOptions, context],
          'listConversationMessages',
        );
      }
      return unwrapManagedHpkeResult(
        await invokeManaged(
          'managedHpkeListConversationMessages',
          [
            conversationId,
            pageOptions,
            authority,
            context,
          ],
          'listConversationMessages',
        ),
        authority,
      );
    },
    familiarContract: (familiarId, context) =>
      invokeManaged(
        'familiarContract',
        [familiarId, context],
        'familiarContract',
      ) as never,
    familiarAnalytics: (familiarId, options, context) =>
      invokeManaged(
        'familiarAnalytics',
        [familiarId, options, context],
        'familiarAnalytics',
      ) as never,
  };
  return wrapped;
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
  const transport =
    captured.discovery === undefined
      ? captured.transport
      : wrapManagedHpkeTransport(captured.transport, captured.discovery);
  return new CaveClient({
    transport,
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
  CaveManagedHpkeAuthentication,
  CaveManagedHpkeDiscovery,
  CaveManagedHpkeResult,
} from './managed-hpke.js';
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
