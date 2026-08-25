import type { OperationContext, PageOptions } from '@opencoven/sdk-core';

import type {
  CaveAuthorityBoundPairingExchange,
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
