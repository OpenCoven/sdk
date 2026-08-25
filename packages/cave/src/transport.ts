import type { OperationContext, PageOptions } from '@opencoven/sdk-core/browser';

import type {
  CaveAuthorityBinding,
  CaveAuthorityBoundPairingExchange,
  CaveCredentialMetadata,
  CaveFamiliarsResponse,
  CaveFamiliarAnalyticsResponse,
  CaveFamiliarContractResponse,
  CaveHealthResponse,
  CavePairingCreated,
  CavePairingExchange,
  CavePairingRequest,
  CavePairingStatus,
} from './schemas.js';

export interface CaveTransport {
  health(context?: OperationContext): Promise<CaveHealthResponse>;
  pairingCreate?(
    request: CavePairingRequest,
    context?: OperationContext,
  ): Promise<CavePairingCreated>;
  pairingPoll?(
    requestId: string,
    pairingSecret: string,
    context?: OperationContext,
  ): Promise<CavePairingStatus>;
  pairingExchange?(
    requestId: string,
    pairingSecret: string,
    context?: OperationContext,
  ): Promise<CavePairingExchange>;
  /**
   * Canonical reads are optional for older transports. The caller owns their
   * I/O; the client supplies normalized page options and operation context.
   */
  listFamiliars?(
    options: PageOptions,
    context?: OperationContext,
  ): Promise<unknown>;
  listProjects?(
    options: PageOptions,
    context?: OperationContext,
  ): Promise<unknown>;
  listConversations?(
    options: PageOptions,
    context?: OperationContext,
  ): Promise<unknown>;
  getConversation?(
    conversationId: string,
    context?: OperationContext,
  ): Promise<unknown>;
  listConversationMessages?(
    conversationId: string,
    options: PageOptions,
    context?: OperationContext,
  ): Promise<unknown>;
  /**
   * The familiar operations are optional so that a transport written against
   * an older Cave still satisfies this interface. The client reports a missing
   * one as `unsupported_operation` rather than crashing on `undefined`.
   */
  familiars?(context?: OperationContext): Promise<CaveFamiliarsResponse>;
  familiarContract?(
    familiarId: string,
    context?: OperationContext,
  ): Promise<CaveFamiliarContractResponse>;
  familiarAnalytics?(
    familiarId: string,
    options?: { recentLimit?: number },
    context?: OperationContext,
  ): Promise<CaveFamiliarAnalyticsResponse>;
}

export interface CaveCredentialPersistingTransport extends CaveTransport {
  pairingExchange?(
    requestId: string,
    pairingSecret: string,
    context?: OperationContext,
  ): Promise<CaveAuthorityBoundPairingExchange>;
}

/**
 * A native credential-custody bridge. Its implementation owns all network
 * authorization, pairing secrets, exchanged bearers, and durable credential
 * storage outside the JavaScript runtime. It intentionally has no generic
 * request method.
 *
 * Results are `unknown` at this trust boundary. `CaveClient` validates every
 * non-secret value before exposing a public DTO.
 */
export interface CaveManagedCredentialTransport extends CaveTransport {
  managedPairingCreate(
    request: CavePairingRequest,
    context?: OperationContext,
  ): Promise<unknown>;
  managedPairingPoll(
    requestId: string,
    context?: OperationContext,
  ): Promise<unknown>;
  managedPairingExchange(
    requestId: string,
    context?: OperationContext,
  ): Promise<unknown>;
  managedCredentialStatus(
    context?: OperationContext,
  ): Promise<unknown>;
  managedForgetCredential(
    context?: OperationContext,
  ): Promise<unknown>;
}

/**
 * Internal transport used by the root managed-native adapter. It retains
 * opaque staging/commit handles in the SDK while the native adapter retains
 * credentials and bearer material.
 */
export interface CaveStagedManagedCredentialTransport extends CaveTransport {
  readonly credentialMode: 'managed-native';
  pairingCreateManaged(
    request: CavePairingRequest,
    context?: OperationContext,
  ): Promise<{ requestId: string; handle: string; expiresAt: number }>;
  pairingPollManaged(
    handle: string,
    context?: OperationContext,
  ): Promise<CavePairingStatus>;
  pairingExchangeManaged(
    handle: string,
    context?: OperationContext,
  ): Promise<{
    authorityBinding: CaveAuthorityBinding;
    commitHandle: string;
    credential: CaveCredentialMetadata;
  }>;
  pairingCommitManaged(
    commitHandle: string,
    context?: OperationContext,
  ): Promise<void>;
  pairingDiscardManaged(commitHandle: string): Promise<void>;
  credentialStateManaged(
    context?: OperationContext,
  ): Promise<CaveStagedManagedCredentialState>;
  forgetCredentialManaged(context?: OperationContext): Promise<boolean>;
}

export type CaveStagedManagedCredentialState =
  | 'missing'
  | 'present'
  | 'update_in_progress'
  | 'invalid';

export function isCaveStagedManagedCredentialTransport(
  transport: CaveTransport,
): transport is CaveStagedManagedCredentialTransport {
  return (
    (transport as Partial<CaveStagedManagedCredentialTransport>).credentialMode ===
      'managed-native' &&
    typeof (transport as Partial<CaveStagedManagedCredentialTransport>)
      .pairingCreateManaged === 'function' &&
    typeof (transport as Partial<CaveStagedManagedCredentialTransport>)
      .pairingPollManaged === 'function' &&
    typeof (transport as Partial<CaveStagedManagedCredentialTransport>)
      .pairingExchangeManaged === 'function'
  );
}
