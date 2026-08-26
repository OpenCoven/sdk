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
  CaveTransport,
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
  const requireMethod = <T extends (...args: never[]) => unknown>(
    method: T | undefined,
    operation: string,
  ): T => {
    if (typeof method !== 'function') {
      throw missingManagedHpkeOperation(operation);
    }
    return method;
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
            await requireMethod(
              transport.managedHpkePairingPoll,
              'pairingPoll',
            ).call(transport, requestId, authority, context),
            authority,
          );
    },
    async managedPairingExchange(requestId, context) {
      const authority = await resolveAuthority(context);
      return authority === undefined
        ? await transport.managedPairingExchange(requestId, context)
        : unwrapManagedHpkeResult(
            await requireMethod(
              transport.managedHpkePairingExchange,
              'pairingExchange',
            ).call(transport, requestId, authority, context),
            authority,
          );
    },
    async managedCredentialStatus(context) {
      const authority = await resolveAuthority(context);
      return authority === undefined
        ? await transport.managedCredentialStatus(context)
        : unwrapManagedHpkeResult(
            await requireMethod(
              transport.managedHpkeCredentialStatus,
              'credentialStatus',
            ).call(transport, authority, context),
            authority,
          );
    },
    managedForgetCredential: (context) =>
      transport.managedForgetCredential(context),
    async familiars(context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await requireMethod(
          transport.familiars,
          'familiars',
        ).call(transport, context);
      }
      return unwrapManagedHpkeResult(
        await requireMethod(
          transport.managedHpkeFamiliars,
          'familiars',
        ).call(transport, authority, context),
        authority,
      ) as never;
    },
    async listFamiliars(pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await requireMethod(
          transport.listFamiliars,
          'listFamiliars',
        ).call(transport, pageOptions, context);
      }
      return unwrapManagedHpkeResult(
        await requireMethod(
          transport.managedHpkeListFamiliars,
          'listFamiliars',
        ).call(transport, pageOptions, authority, context),
        authority,
      );
    },
    async listProjects(pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await requireMethod(
          transport.listProjects,
          'listProjects',
        ).call(transport, pageOptions, context);
      }
      return unwrapManagedHpkeResult(
        await requireMethod(
          transport.managedHpkeListProjects,
          'listProjects',
        ).call(transport, pageOptions, authority, context),
        authority,
      );
    },
    async listConversations(pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await requireMethod(
          transport.listConversations,
          'listConversations',
        ).call(transport, pageOptions, context);
      }
      return unwrapManagedHpkeResult(
        await requireMethod(
          transport.managedHpkeListConversations,
          'listConversations',
        ).call(transport, pageOptions, authority, context),
        authority,
      );
    },
    async getConversation(conversationId, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await requireMethod(
          transport.getConversation,
          'getConversation',
        ).call(transport, conversationId, context);
      }
      return unwrapManagedHpkeResult(
        await requireMethod(
          transport.managedHpkeGetConversation,
          'getConversation',
        ).call(transport, conversationId, authority, context),
        authority,
      );
    },
    async listConversationMessages(conversationId, pageOptions, context) {
      const authority = await resolveAuthority(context);
      if (authority === undefined) {
        return await requireMethod(
          transport.listConversationMessages,
          'listConversationMessages',
        ).call(transport, conversationId, pageOptions, context);
      }
      return unwrapManagedHpkeResult(
        await requireMethod(
          transport.managedHpkeListConversationMessages,
          'listConversationMessages',
        ).call(
          transport,
          conversationId,
          pageOptions,
          authority,
          context,
        ),
        authority,
      );
    },
    ...(transport.familiarContract === undefined
      ? {}
      : {
          familiarContract: (familiarId, context) =>
            transport.familiarContract?.(familiarId, context) as never,
        }),
    ...(transport.familiarAnalytics === undefined
      ? {}
      : {
          familiarAnalytics: (familiarId, options, context) =>
            transport.familiarAnalytics?.(
              familiarId,
              options,
              context,
            ) as never,
        }),
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
