import type { OperationContext, PageOptions } from '@opencoven/sdk-core';

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

export interface CaveManagedPairingCreated {
  requestId: string;
  handle: string;
  expiresAt: number;
}

export interface CaveManagedPairingExchange {
  authorityBinding: CaveAuthorityBinding;
  commitHandle: string;
  credential: CaveCredentialMetadata;
}

export type CaveManagedCredentialState =
  | 'missing'
  | 'present'
  | 'update_in_progress'
  | 'invalid';

export interface CaveManagedCredentialTransport extends CaveTransport {
  readonly credentialMode: 'managed-native';
  pairingCreateManaged(
    request: CavePairingRequest,
    context?: OperationContext,
  ): Promise<CaveManagedPairingCreated>;
  pairingPollManaged(
    handle: string,
    context?: OperationContext,
  ): Promise<CavePairingStatus>;
  pairingExchangeManaged(
    handle: string,
    context?: OperationContext,
  ): Promise<CaveManagedPairingExchange>;
  pairingCommitManaged(
    commitHandle: string,
    context?: OperationContext,
  ): Promise<void>;
  pairingDiscardManaged(commitHandle: string): Promise<void>;
  credentialStateManaged(
    context?: OperationContext,
  ): Promise<CaveManagedCredentialState>;
  forgetCredentialManaged(
    context?: OperationContext,
  ): Promise<boolean>;
}

export function isCaveManagedCredentialTransport(
  transport: CaveTransport,
): transport is CaveManagedCredentialTransport {
  return (
    (transport as Partial<CaveManagedCredentialTransport>).credentialMode ===
      'managed-native' &&
    typeof (transport as Partial<CaveManagedCredentialTransport>)
      .pairingCreateManaged === 'function' &&
    typeof (transport as Partial<CaveManagedCredentialTransport>)
      .pairingPollManaged === 'function' &&
    typeof (transport as Partial<CaveManagedCredentialTransport>)
      .pairingExchangeManaged === 'function'
  );
}
