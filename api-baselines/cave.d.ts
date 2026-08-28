// Entrypoint: .
// Declaration: dist/client-CYVZtJJc.d.ts
import { OperationContext, OperationOptions, OperationDefaults, PageOptions, SecretStore, SecretStoreReference, Page, BoundedPageOptions, NormalizedError, CompatibilityAssessment } from '@opencoven/sdk-core/browser';
import { DiscoveryEndpoint } from '@opencoven/sdk-core';

interface CaveCanonicalFamiliar {
    id: string;
    displayName: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    lastSeenAt?: string;
    activeSessions?: number;
}
interface CaveProject {
    id: string;
    name: string;
    root: string;
    color?: string;
    repoUrl?: string;
    createdAt: string;
    updatedAt: string;
}
interface CaveConversation {
    id: string;
    familiarId: string;
    harness?: string;
    model?: string;
    runtime?: string;
    title?: string;
    origin?: string;
    status?: string;
    exitCode?: number | null;
    pending?: boolean;
    createdAt?: string;
    updatedAt: string;
}
interface CaveConversationMessage {
    id: string;
    conversationId: string;
    parentId: string | null;
    role: string;
    text: string;
    createdAt: string;
    attachmentCount: number;
    toolCount: number;
    isError?: boolean;
    cancelled?: boolean;
}
interface CaveHealth {
    status: 'ok';
    apiVersion: string;
    minimumClientVersion: string;
    capabilities: readonly string[];
    operations: readonly string[];
    instanceId: string;
    pairingRequired: boolean;
    releaseVersion: string;
}
interface CaveHealthData {
    instanceId: string;
    pairingRequired: boolean;
    releaseVersion: string;
}
interface CaveHealthResponse {
    apiVersion: string;
    minimumClientVersion: string;
    requestId?: string;
    capabilities: readonly string[];
    operations: readonly string[];
    data: CaveHealthData;
}
declare const CAVE_PAIRING_SCOPES: readonly ["chat:read", "chat:write", "conversations:write", "attachments:write", "tasks:write", "github:write"];
type CavePairingScope = (typeof CAVE_PAIRING_SCOPES)[number];
declare const CAVE_PAIRING_STATUSES: readonly ["pending", "approved", "denied", "expired"];
type CavePairingState = (typeof CAVE_PAIRING_STATUSES)[number];
interface CavePairingRequest {
    appName: string;
    installationId: string;
    scopes: CavePairingScope[];
}
interface CavePairingCreated {
    requestId: string;
    secret: string;
    expiresAt: number;
}
interface CavePairingStatus {
    id: string;
    status: CavePairingState;
    expiresAt: number;
}
interface CaveCredentialMetadata {
    id: string;
    appName: string;
    installationId: string;
    scopes: CavePairingScope[];
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
    revocationReason: string | null;
}
interface CavePairingExchange {
    bearer: string;
    credential: CaveCredentialMetadata;
}
/**
 * The non-secret metadata a managed native bridge may return after creating a
 * pairing request. Native code retains the pairing secret.
 */
interface CaveManagedPairingCreated {
    requestId: string;
    expiresAt: number;
}
/**
 * The non-secret metadata a managed native bridge may return after consuming
 * an exchange. Native code retains and persists the bearer.
 */
interface CaveManagedPairingExchange {
    credential: CaveCredentialMetadata;
}
interface CaveAuthorityBinding {
    version: 1;
    instanceId: string;
    endpoint: {
        kind: 'http';
        url: string;
    };
    record: {
        identity: string;
        device: number;
        inode: number;
    };
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
}
interface CaveAuthorityBoundPairingExchange extends CavePairingExchange {
    authorityBinding: CaveAuthorityBinding;
}
type CaveCredentialAccess = 'chat:read' | 'scope_denied' | 'service_unavailable' | 'rate_limited';
type CaveCredentialDisconnectedReason = 'credential_update_in_progress' | 'reconcile_required';
type CaveCredentialStatus = {
    status: 'missing';
} | {
    status: 'disconnected';
    reason: CaveCredentialDisconnectedReason;
} | {
    status: 'revoked';
    health: CaveHealth;
} | {
    status: 'valid';
    access: CaveCredentialAccess;
    health: CaveHealth;
};
/**
 * Native bridges return this raw, non-secret status shape. `health` remains
 * untrusted until the SDK validates it with the authoritative health parser.
 */
type CaveManagedCredentialStatusResult = {
    status: 'missing';
} | {
    status: 'disconnected';
    reason: CaveCredentialDisconnectedReason;
} | {
    status: 'revoked';
    health: unknown;
} | {
    status: 'valid';
    access: CaveCredentialAccess;
    health: unknown;
};
/**
 * Native credential deletion must distinguish confirmed absence from a
 * replacement race so JavaScript never reports a newer credential as removed.
 */
type CaveManagedForgetCredentialResult = {
    status: 'deleted';
} | {
    status: 'missing';
} | {
    status: 'credential_update_in_progress';
};
/**
 * Familiars.
 *
 * These mirror what Cave already serves, rather than proposing a shape it does
 * not have: `GET /api/familiars` for the roster, `/[id]/contract` for the
 * Familiar Contract report, and `/[id]/execution-analytics` for run history.
 * Field-for-field, so a change on either side is a type error rather than a
 * value that silently arrives as undefined.
 *
 * The wire uses snake_case on the roster and camelCase everywhere else. The
 * `*Wire` types below keep the wire spelling exactly, because that is what has
 * to be validated; the exported types are camelCase, because that is what the
 * rest of a TypeScript program expects. The client is the one place the two
 * meet, and it is a better place for the seam than every call site.
 */
/** A familiar as the roster lists it. */
interface CaveFamiliar {
    id: string;
    displayName: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    lastSeen?: string;
    activeSessions?: number;
    memoryFreshness?: string;
}
/** The roster entry as it arrives. */
interface CaveFamiliarWire {
    id: string;
    display_name: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    last_seen?: string;
    active_sessions?: number;
    memory_freshness?: string;
}
interface CaveFamiliarsResponse {
    ok: boolean;
    familiars?: CaveFamiliarWire[];
    error?: string;
    reason?: string;
}
/**
 * The five normative properties of the Familiar Contract, in the spec's order.
 *
 * Duplicated from Cave rather than imported because the SDK does not depend on
 * Cave's source. The contract report carries its own `specVersion`, so a client
 * that finds a property it does not know about can say which version it was
 * built against instead of guessing.
 */
declare const CAVE_FAMILIAR_PROPERTIES: readonly ["Named Identity", "Defined Purpose", "Bounded Authority", "Persistent Memory", "Human Belonging"];
type CaveFamiliarProperty = (typeof CAVE_FAMILIAR_PROPERTIES)[number];
type CaveContractFile = 'SOUL.md' | 'IDENTITY.md' | 'ward.toml' | 'MEMORY.md' | 'cross-file';
interface CaveContractViolation {
    file: CaveContractFile;
    field: string;
    message: string;
}
interface CavePropertyCoverage {
    property: string;
    pass: boolean;
}
/**
 * `pass` is true when there are zero hard violations. Warnings do not fail a
 * contract -- a familiar that keeps no memory is a real answer to a real
 * question, not a malformed one.
 */
interface CaveContractReport {
    specVersion: string;
    pass: boolean;
    properties: CavePropertyCoverage[];
    violations: CaveContractViolation[];
    warnings: CaveContractViolation[];
}
interface CaveFamiliarContract {
    id: string;
    workspace?: string;
    present: boolean;
    report: CaveContractReport;
}
interface CaveFamiliarContractResponse {
    ok: boolean;
    /** Present on a refusal. The client surfaces it as the error code. */
    reason?: string;
    id?: string;
    workspace?: string;
    present?: boolean;
    report?: CaveContractReport;
    error?: string;
}
/** The windows Cave aggregates over. */
declare const CAVE_ANALYTICS_WINDOWS: readonly ["7d", "14d", "8w", "all"];
type CaveAnalyticsWindowKey = (typeof CAVE_ANALYTICS_WINDOWS)[number];
interface CaveExecutionSlice {
    key: string;
    label?: string;
    attempts: number;
    completed: number;
    failed: number;
    cancelled: number;
    successRate: number | null;
    medianDurationMs?: number;
    totalTokens?: number;
    costUsd?: number;
    toolCalls: number;
    toolFailures: number;
}
interface CaveExecutionCoverage {
    known: number;
    total: number;
    ratio: number;
}
interface CaveExecutionWindow {
    attempts: number;
    completed: number;
    failed: number;
    cancelled: number;
    /** Null when there were no attempts: a rate over nothing is not zero. */
    successRate: number | null;
    medianDurationMs?: number;
    p95DurationMs?: number;
    totalTokens?: number;
    costUsd?: number;
    toolCalls: number;
    toolFailures: number;
    models: CaveExecutionSlice[];
    harnesses: CaveExecutionSlice[];
    coverage: Record<string, CaveExecutionCoverage>;
}
interface CaveExecutionAttempt {
    id: string;
    sessionId?: string;
    turnId?: string;
    executionKind: string;
    occurredAt: string;
    harnessId: string;
    harnessVersion?: string;
    requestedModel?: string;
    forwardedModel?: string;
    confirmedModel?: string;
    status: 'completed' | 'failed' | 'cancelled';
    durationMs?: number;
    totalTokens?: number;
    costUsd?: number;
    toolCalls: number;
    toolFailures: number;
}
/**
 * Whether the history behind these numbers is complete.
 *
 * Reported rather than hidden, because a success rate drawn from a partial
 * import is a different claim from one drawn from all of it, and a reader who
 * cannot tell them apart will believe the wrong one.
 */
interface CaveExecutionBackfill {
    state: 'complete' | 'partial' | 'not-started';
    imported: number;
    remaining?: number;
}
interface CaveFamiliarAnalytics {
    generatedAt: string;
    windows: Partial<Record<CaveAnalyticsWindowKey, CaveExecutionWindow>>;
    recentAttempts: CaveExecutionAttempt[];
    backfill: CaveExecutionBackfill;
}
interface CaveFamiliarAnalyticsResponse {
    ok: boolean;
    /** Present on a refusal. The client surfaces it as the error code. */
    reason?: string;
    analytics?: CaveFamiliarAnalytics;
    error?: string;
}

declare const CAVE_DISCOVERY_RECORD_VERSION: 1;
declare const CAVE_HPKE_DISCOVERY_RECORD_VERSION: 2;
type CaveDiscoveryErrorCode = 'not_found' | 'owner_mismatch' | 'unsafe_endpoint' | 'stale_record' | 'body_limit' | 'invalid_response' | 'timeout' | 'aborted';
interface CaveHpkeDiscoveryAuthority {
    mechanism: 'hpke-bound-v1';
    mode: 'advertise' | 'enforce';
    keyId: string;
    publicKey: string;
    suite: {
        kemId: 32;
        kdfId: 1;
        aeadId: 2;
    };
}
interface CaveParsedDiscoveryRecordV1 {
    version: typeof CAVE_DISCOVERY_RECORD_VERSION;
    endpoint: Extract<DiscoveryEndpoint, {
        kind: 'http';
    }>;
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
}
interface CaveParsedDiscoveryRecordV2 {
    version: typeof CAVE_HPKE_DISCOVERY_RECORD_VERSION;
    endpoint: Extract<DiscoveryEndpoint, {
        kind: 'http';
    }>;
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
    authority: CaveHpkeDiscoveryAuthority;
}
type CaveParsedDiscoveryRecord = CaveParsedDiscoveryRecordV1 | CaveParsedDiscoveryRecordV2;
declare class CaveDiscoveryError extends Error {
    readonly code: CaveDiscoveryErrorCode;
    readonly retryable: boolean;
    constructor(code: CaveDiscoveryErrorCode, message: string);
}
declare function isCaveDiscoveryError(error: unknown): error is CaveDiscoveryError;

interface CaveManagedDiscoverySource {
    /**
     * Native code must read the owner-checked record. The SDK validates the
     * returned bytes and metadata; browser code never reads the filesystem.
     */
    read(context?: OperationContext): Promise<unknown>;
}
interface CaveManagedDiscoveryOptions extends OperationOptions {
    maxRecordBytes?: number;
    operation?: OperationDefaults;
}
interface CaveManagedDiscoveredEndpointBase {
    endpoint: {
        kind: 'http';
        url: string;
    };
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
    record: {
        identity: string;
        device: number;
        inode: number;
    };
}
type CaveManagedDiscoveredEndpoint = (CaveManagedDiscoveredEndpointBase & {
    version: 1;
}) | (CaveManagedDiscoveredEndpointBase & {
    version: 2;
    authority: CaveHpkeDiscoveryAuthority;
});
declare function discoverManagedCaveEndpoint(source: CaveManagedDiscoverySource, options?: CaveManagedDiscoveryOptions): Promise<CaveManagedDiscoveredEndpoint>;

interface CaveManagedHpkeDiscovery {
    source: CaveManagedDiscoverySource;
    options?: CaveManagedDiscoveryOptions;
}
interface CaveManagedHpkeAuthentication {
    mechanism: 'hpke-bound-v1';
    keyId: string;
}
interface CaveManagedHpkeResult<T = unknown> {
    authentication: CaveManagedHpkeAuthentication;
    value: T;
}

interface CaveTransport {
    health(context?: OperationContext): Promise<CaveHealthResponse>;
    pairingCreate?(request: CavePairingRequest, context?: OperationContext): Promise<CavePairingCreated>;
    pairingPoll?(requestId: string, pairingSecret: string, context?: OperationContext): Promise<CavePairingStatus>;
    pairingExchange?(requestId: string, pairingSecret: string, context?: OperationContext): Promise<CavePairingExchange>;
    /**
     * Canonical reads are optional for older transports. The caller owns their
     * I/O; the client supplies normalized page options and operation context.
     */
    listFamiliars?(options: PageOptions, context?: OperationContext): Promise<unknown>;
    listProjects?(options: PageOptions, context?: OperationContext): Promise<unknown>;
    listConversations?(options: PageOptions, context?: OperationContext): Promise<unknown>;
    getConversation?(conversationId: string, context?: OperationContext): Promise<unknown>;
    listConversationMessages?(conversationId: string, options: PageOptions, context?: OperationContext): Promise<unknown>;
    /**
     * The familiar operations are optional so that a transport written against
     * an older Cave still satisfies this interface. The client reports a missing
     * one as `unsupported_operation` rather than crashing on `undefined`.
     */
    familiars?(context?: OperationContext): Promise<CaveFamiliarsResponse>;
    familiarContract?(familiarId: string, context?: OperationContext): Promise<CaveFamiliarContractResponse>;
    familiarAnalytics?(familiarId: string, options?: {
        recentLimit?: number;
    }, context?: OperationContext): Promise<CaveFamiliarAnalyticsResponse>;
}
interface CaveCredentialPersistingTransport extends CaveTransport {
    pairingExchange?(requestId: string, pairingSecret: string, context?: OperationContext): Promise<CaveAuthorityBoundPairingExchange>;
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
interface CaveManagedCredentialTransport extends CaveTransport {
    managedPairingCreate(request: CavePairingRequest, context?: OperationContext): Promise<unknown>;
    managedPairingPoll(requestId: string, context?: OperationContext): Promise<unknown>;
    managedPairingExchange(requestId: string, context?: OperationContext): Promise<unknown>;
    managedCredentialStatus(context?: OperationContext): Promise<unknown>;
    managedForgetCredential(context?: OperationContext): Promise<unknown>;
    managedHpkePairingPoll?(requestId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkePairingExchange?(requestId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeCredentialStatus?(discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeFamiliars?(discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListFamiliars?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListProjects?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListConversations?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeGetConversation?(conversationId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListConversationMessages?(conversationId: string, options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
}

interface CaveCredentialBinding {
    store: SecretStore;
    reference: SecretStoreReference;
}
/**
 * Selects native custody for every Cave pairing and credential secret. A
 * managed transport is responsible for retaining, consuming, and persisting
 * those values outside JavaScript.
 */
interface CaveManagedNativeCredentialCustody {
    mode: 'managed-native';
}
interface CaveClientOptionsBase {
    operation?: OperationDefaults;
}
interface CaveClientOptionsWithoutCredentials extends CaveClientOptionsBase {
    transport: CaveTransport;
    credentials?: undefined;
    credentialCustody?: undefined;
}
interface CaveClientOptionsWithCredentials extends CaveClientOptionsBase {
    transport: CaveCredentialPersistingTransport;
    credentials: CaveCredentialBinding;
    credentialCustody?: undefined;
}
interface CaveClientOptionsWithManagedNativeCredentials extends CaveClientOptionsBase {
    transport: CaveManagedCredentialTransport;
    credentials?: never;
    credentialCustody: CaveManagedNativeCredentialCustody;
}
type CaveClientOptions = CaveClientOptionsWithoutCredentials | CaveClientOptionsWithCredentials | CaveClientOptionsWithManagedNativeCredentials;
interface CaveFamiliarAnalyticsOptions extends OperationOptions {
    recentLimit?: number;
}
interface CavePairingSessionOptions {
    requestId: string;
    expiresAt: number;
    exchange: (options?: OperationOptions) => Promise<CaveCredentialMetadata>;
    poll: (options?: OperationOptions) => Promise<CavePairingStatus>;
}
declare function normalizeCaveError(error: unknown, operation: string): NormalizedError;
declare class CaveClientError extends Error {
    readonly normalized: NormalizedError;
    readonly compatibility: CompatibilityAssessment | undefined;
    readonly code: string;
    readonly retryable: boolean;
    readonly requestId: string | undefined;
    readonly statusCode: number | undefined;
    readonly details: Record<string, string> | undefined;
    constructor(normalized: NormalizedError, compatibility?: CompatibilityAssessment, options?: ErrorOptions);
}
declare function isCaveClientError(error: unknown): error is CaveClientError;
declare class CavePairingSession {
    #private;
    readonly requestId: string;
    readonly expiresAt: number;
    constructor(options: CavePairingSessionOptions);
    poll(options?: OperationOptions): Promise<CavePairingStatus>;
    exchange(options?: OperationOptions): Promise<CaveCredentialMetadata>;
}
declare class CaveClient {
    #private;
    constructor(options: CaveClientOptions);
    health(options?: OperationOptions): Promise<CaveHealth>;
    listFamiliars(options?: PageOptions & OperationOptions): Promise<Page<CaveCanonicalFamiliar>>;
    listProjects(options?: PageOptions & OperationOptions): Promise<Page<CaveProject>>;
    listConversations(options?: PageOptions & OperationOptions): Promise<Page<CaveConversation>>;
    getConversation(conversationId: string, options?: OperationOptions): Promise<CaveConversation>;
    listConversationMessages(conversationId: string, options?: PageOptions & OperationOptions): Promise<Page<CaveConversationMessage>>;
    iterateFamiliars(options: BoundedPageOptions): AsyncGenerator<CaveCanonicalFamiliar>;
    iterateProjects(options: BoundedPageOptions): AsyncGenerator<CaveProject>;
    iterateConversations(options: BoundedPageOptions): AsyncGenerator<CaveConversation>;
    iterateConversationMessages(conversationId: string, options: BoundedPageOptions): AsyncGenerator<CaveConversationMessage>;
    familiars(options?: OperationOptions): Promise<CaveFamiliar[]>;
    /** The Familiar Contract report. Mirrors `GET /api/familiars/:id/contract`. */
    familiarContract(familiarId: string, options?: OperationOptions): Promise<CaveFamiliarContract>;
    /**
     * Execution analytics. Mirrors `GET /api/familiars/:id/execution-analytics`.
     *
     * `backfill` comes back untouched. A success rate drawn from a partial
     * import is a different claim from one drawn from all of it, and dropping
     * the distinction here would leave every caller unable to make it.
     */
    familiarAnalytics(familiarId: string, options?: CaveFamiliarAnalyticsOptions): Promise<CaveFamiliarAnalytics>;
    createPairing(request: CavePairingRequest, options?: OperationOptions): Promise<CavePairingSession>;
    credentialStatus(options?: OperationOptions): Promise<CaveCredentialStatus>;
    forgetCredential(options?: OperationOptions): Promise<boolean>;
}
declare function createCaveClient(options: CaveClientOptions): CaveClient;

export { type CavePairingCreated as $, CaveDiscoveryError as A, type CaveDiscoveryErrorCode as B, type CaveHpkeDiscoveryAuthority as C, type CaveExecutionAttempt as D, type CaveExecutionBackfill as E, type CaveExecutionCoverage as F, type CaveExecutionSlice as G, type CaveExecutionWindow as H, type CaveFamiliar as I, type CaveFamiliarAnalytics as J, type CaveFamiliarAnalyticsOptions as K, type CaveFamiliarAnalyticsResponse as L, type CaveFamiliarContract as M, type CaveFamiliarContractResponse as N, type CaveFamiliarProperty as O, type CaveFamiliarWire as P, type CaveFamiliarsResponse as Q, type CaveHealth as R, type CaveHealthData as S, type CaveHealthResponse as T, type CaveManagedCredentialStatusResult as U, type CaveManagedCredentialTransport as V, type CaveManagedForgetCredentialResult as W, type CaveManagedHpkeResult as X, type CaveManagedNativeCredentialCustody as Y, type CaveManagedPairingCreated as Z, type CaveManagedPairingExchange as _, type CavePairingRequest as a, type CavePairingExchange as a0, type CavePairingScope as a1, CavePairingSession as a2, type CavePairingState as a3, type CavePairingStatus as a4, type CaveParsedDiscoveryRecord as a5, type CaveParsedDiscoveryRecordV1 as a6, type CaveParsedDiscoveryRecordV2 as a7, type CaveProject as a8, type CavePropertyCoverage as a9, type CaveTransport as aa, createCaveClient as ab, isCaveClientError as ac, isCaveDiscoveryError as ad, normalizeCaveError as ae, type CaveManagedDiscoveryOptions as af, type CaveManagedDiscoverySource as ag, discoverManagedCaveEndpoint as ah, type CaveManagedDiscoveredEndpoint as b, type CaveManagedHpkeAuthentication as c, type CaveManagedHpkeDiscovery as d, CaveClient as e, CAVE_ANALYTICS_WINDOWS as f, CAVE_FAMILIAR_PROPERTIES as g, CAVE_PAIRING_SCOPES as h, CAVE_PAIRING_STATUSES as i, type CaveAnalyticsWindowKey as j, type CaveAuthorityBinding as k, type CaveAuthorityBoundPairingExchange as l, type CaveCanonicalFamiliar as m, CaveClientError as n, type CaveClientOptions as o, type CaveContractFile as p, type CaveContractReport as q, type CaveContractViolation as r, type CaveConversation as s, type CaveConversationMessage as t, type CaveCredentialAccess as u, type CaveCredentialBinding as v, type CaveCredentialDisconnectedReason as w, type CaveCredentialMetadata as x, type CaveCredentialPersistingTransport as y, type CaveCredentialStatus as z };
// Entrypoint: .
// Declaration: dist/index.d.ts
import { C as CaveHpkeDiscoveryAuthority, a as CavePairingRequest, b as CaveManagedDiscoveredEndpoint, c as CaveManagedHpkeAuthentication, d as CaveManagedHpkeDiscovery, e as CaveClient } from './client-CYVZtJJc.js';
export { f as CAVE_ANALYTICS_WINDOWS, g as CAVE_FAMILIAR_PROPERTIES, h as CAVE_PAIRING_SCOPES, i as CAVE_PAIRING_STATUSES, j as CaveAnalyticsWindowKey, k as CaveAuthorityBinding, l as CaveAuthorityBoundPairingExchange, m as CaveCanonicalFamiliar, n as CaveClientError, o as CaveClientOptions, p as CaveContractFile, q as CaveContractReport, r as CaveContractViolation, s as CaveConversation, t as CaveConversationMessage, u as CaveCredentialAccess, v as CaveCredentialBinding, w as CaveCredentialDisconnectedReason, x as CaveCredentialMetadata, y as CaveCredentialPersistingTransport, z as CaveCredentialStatus, A as CaveDiscoveryError, B as CaveDiscoveryErrorCode, D as CaveExecutionAttempt, E as CaveExecutionBackfill, F as CaveExecutionCoverage, G as CaveExecutionSlice, H as CaveExecutionWindow, I as CaveFamiliar, J as CaveFamiliarAnalytics, K as CaveFamiliarAnalyticsOptions, L as CaveFamiliarAnalyticsResponse, M as CaveFamiliarContract, N as CaveFamiliarContractResponse, O as CaveFamiliarProperty, P as CaveFamiliarWire, Q as CaveFamiliarsResponse, R as CaveHealth, S as CaveHealthData, T as CaveHealthResponse, U as CaveManagedCredentialStatusResult, V as CaveManagedCredentialTransport, W as CaveManagedForgetCredentialResult, X as CaveManagedHpkeResult, Y as CaveManagedNativeCredentialCustody, Z as CaveManagedPairingCreated, _ as CaveManagedPairingExchange, $ as CavePairingCreated, a0 as CavePairingExchange, a1 as CavePairingScope, a2 as CavePairingSession, a3 as CavePairingState, a4 as CavePairingStatus, a5 as CaveParsedDiscoveryRecord, a6 as CaveParsedDiscoveryRecordV1, a7 as CaveParsedDiscoveryRecordV2, a8 as CaveProject, a9 as CavePropertyCoverage, aa as CaveTransport, ab as createCaveClient, ac as isCaveClientError, ad as isCaveDiscoveryError, ae as normalizeCaveError } from './client-CYVZtJJc.js';
import { OperationOptions, OperationContext, PageOptions, OperationDefaults, SecretStore, SecretStoreReference } from '@opencoven/sdk-core';
import '@opencoven/sdk-core/browser';

interface CaveDiscoveryPathIdentity {
    device: number;
    inode: number;
    mode: number;
    ownerUid: number;
    size: number;
    symbolicLink: boolean;
    regularFile: boolean;
    directory: boolean;
}
interface CaveDiscoveryFileHandle {
    read(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<{
        bytesRead: number;
    }>;
    close(): Promise<void>;
    stat(): Promise<CaveDiscoveryPathIdentity>;
}
interface CaveWindowsPathTrustValidator {
    validate(path: string, purpose: 'root' | 'record'): Promise<boolean | CaveWindowsPathTrustResult>;
    validateOpenedFile?(handle: CaveDiscoveryFileHandle, path: string, purpose: 'record'): Promise<boolean | CaveWindowsPathTrustResult>;
}
interface CaveWindowsPathTrustResult {
    trusted: true;
    identity: string;
}
interface CaveDiscoveryDependencies {
    getEffectiveUid?: () => number | undefined;
    isProcessAlive?: (pid: number) => boolean;
    lstat?: (path: string) => Promise<CaveDiscoveryPathIdentity>;
    openFile?: (path: string, flags: number) => Promise<CaveDiscoveryFileHandle>;
    realpath?: (path: string) => Promise<string>;
    resolveHomeDirectory?: () => string | undefined;
    windowsPathTrust?: CaveWindowsPathTrustValidator;
}
interface DiscoverCaveEndpointOptions extends OperationOptions {
    cwd?: string;
    deadline?: number;
    dependencies?: CaveDiscoveryDependencies;
    env?: Readonly<NodeJS.ProcessEnv>;
    maxRecordBytes?: number;
    platform?: NodeJS.Platform;
    root?: string;
    timeoutMs?: number;
}
interface CaveEndpointFreshness {
    pid: number;
    nonce: string;
    startedAt: string;
}
interface CaveDiscoveryRecordIdentity {
    path: string;
    device: number;
    inode: number;
}
interface CaveDiscoveredEndpointV1 {
    version: 1;
    endpoint: {
        kind: 'http';
        url: string;
    };
    freshness: CaveEndpointFreshness;
    record: CaveDiscoveryRecordIdentity;
}
interface CaveDiscoveredEndpointV2 {
    version: 2;
    endpoint: {
        kind: 'http';
        url: string;
    };
    freshness: CaveEndpointFreshness;
    authority: CaveHpkeDiscoveryAuthority;
    record: CaveDiscoveryRecordIdentity;
}
type CaveDiscoveredEndpoint = CaveDiscoveredEndpointV1 | CaveDiscoveredEndpointV2;
declare function discoverCaveEndpoint(options?: DiscoverCaveEndpointOptions): Promise<CaveDiscoveredEndpoint>;

interface CaveManagedNativeResponse {
    statusCode: number;
    payload: unknown;
}
interface CaveManagedNativeAuthenticatedResponse extends CaveManagedNativeResponse {
    authentication: CaveManagedHpkeAuthentication;
}
interface CaveManagedNativePairingCreated {
    handle: string;
    response: CaveManagedNativeResponse;
}
interface CaveManagedNativePairingExchange {
    authorityBinding: unknown;
    commitHandle: string;
    response: CaveManagedNativeResponse;
}
interface CaveManagedNativeHpkePairingExchange {
    authorityBinding: unknown;
    commitHandle: string;
    response: CaveManagedNativeAuthenticatedResponse;
}
type CaveManagedNativeDiscardResult = 'absent' | 'changed' | 'deleted';
interface CaveManagedNativeTransport {
    health(context?: OperationContext): Promise<CaveManagedNativeResponse>;
    pairingCreate(request: CavePairingRequest, context?: OperationContext): Promise<CaveManagedNativePairingCreated>;
    pairingPoll?(handle: string, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    pairingPollHpke?(handle: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
    pairingExchange?(handle: string, context?: OperationContext): Promise<CaveManagedNativePairingExchange>;
    pairingExchangeHpke?(handle: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeHpkePairingExchange>;
    pairingCommit(commitHandle: string, context?: OperationContext): Promise<void>;
    pairingDiscard(commitHandle: string): Promise<CaveManagedNativeDiscardResult>;
    credentialState(context?: OperationContext): Promise<unknown>;
    forgetCredential(context?: OperationContext): Promise<unknown>;
    familiars?(context?: OperationContext): Promise<CaveManagedNativeResponse>;
    familiarsHpke?(discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
    listFamiliars?(options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listFamiliarsHpke?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
    listProjects?(options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listProjectsHpke?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
    listConversations?(options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listConversationsHpke?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
    getConversation?(conversationId: string, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    getConversationHpke?(conversationId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
    listConversationMessages?(conversationId: string, options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listConversationMessagesHpke?(conversationId: string, options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedNativeAuthenticatedResponse>;
}
interface CaveManagedClientOptions {
    transport: CaveManagedNativeTransport;
    discovery?: CaveManagedHpkeDiscovery;
    operation?: OperationDefaults;
}
declare function createManagedCaveClient(options: CaveManagedClientOptions): CaveClient;

interface CaveCredentialBinding {
    store: SecretStore;
    reference: SecretStoreReference;
}
interface CaveDiscoveredClientOptions {
    credentials: CaveCredentialBinding;
    discoverEndpoint?: (options?: DiscoverCaveEndpointOptions) => Promise<CaveDiscoveredEndpoint>;
    discovery?: DiscoverCaveEndpointOptions;
    fetch?: typeof fetch;
    maxResponseBytes?: number;
    operation?: OperationDefaults;
}
declare function createDiscoveredCaveClient(options: CaveDiscoveredClientOptions): CaveClient;

interface CaveContractCursor {
    current: string;
    hasMore: boolean;
    next: string;
}
interface CaveContractIdentity {
    displayName: string;
    id: string;
    kind: string;
}
interface CaveContractRevision {
    token: string;
    updatedAt: string;
}
interface CaveContractOperationBase {
    families: readonly string[];
    id: string;
    ingress: string;
    method: string;
    path: string;
    scope: string | null;
}
type CaveContractOperation = (CaveContractOperationBase & {
    binding?: never;
    credential?: never;
}) | (CaveContractOperationBase & {
    binding: string;
    credential: string;
});
interface CaveContractPublicRoute {
    method: string;
    path: string;
}
interface CaveContractEnvelopeMetadata {
    apiVersion: string;
    capabilities: readonly string[];
    minimumClientVersion: string;
    operations: readonly string[];
    requestId?: string;
}
interface CaveContractHealthData {
    instanceId: string;
    pairingRequired: boolean;
    releaseVersion: string;
}
interface CaveContractPairingStatusData {
    expiresAt: number;
    id: string;
    status: string;
}
interface CaveContractPairingCreatedData {
    expiresAt: number;
    requestId: string;
    secret: string;
}
interface CaveContractPairingExchangeData {
    bearer: string;
    credential: {
        appName: string;
        createdAt: number;
        id: string;
        installationId: string;
        lastUsedAt: number | null;
        revocationReason: string | null;
        revokedAt: number | null;
        scopes: readonly string[];
    };
}
interface CaveContractHpkeAuthority {
    defaultMode: string;
    modes: readonly string[];
    mechanism: {
        aadEncoding: string;
        canonicalRoute: string;
        discoveryVersion: number;
        freshness: {
            maximumAgeMs: number;
            maximumFutureSkewMs: number;
            replayCapacity: number;
            replayTtlMs: number;
        };
        id: string;
        keyIdDerivation: string;
        limits: {
            canonicalRouteBytes: number;
            encodedKeyCharacters: number;
            instanceIdBytes: number;
            rawKeyBytes: number;
            requestBodyBytes: number;
            requestCiphertextBytes: number;
            requestPlaintextBytes: number;
            responseCiphertextBytes: number;
            responseEnvelopeBytes: number;
            responsePlaintextBytes: number;
        };
        protectedOperations: readonly string[];
        requestEncoding: string;
        requestHeaders: {
            ciphertext: string;
            enc: string;
            instanceId: string;
            issuedAt: string;
            keyId: string;
            mechanism: string;
            requestNonce: string;
            runtimeNonce: string;
        };
        requestHpkeMode: string;
        requestInfo: string;
        responseHpkeMode: string;
        responseInfo: string;
        responseMediaType: string;
        suite: {
            aead: string;
            aeadId: number;
            kdf: string;
            kdfId: number;
            kem: string;
            kemId: number;
        };
        vectorFixture: {
            fileName: string;
            sha256FileName: string;
        };
    };
}
interface CaveContractDiscoveryRecordV2 {
    authority: {
        keyId: string;
        mechanism: string;
        mode: string;
        publicKey: string;
        suite: {
            aeadId: number;
            kdfId: number;
            kemId: number;
        };
    };
    endpoint: string;
    nonce: string;
    pid: number;
    startedAt: string;
    version: number;
}
interface CaveContractDiscoveryBase {
    fileName: string;
    mode: string;
    version: number;
}
interface CaveContractContractBase {
    apiVersion: string;
    capabilities: readonly string[];
    errorCodes: readonly string[];
    identityKinds: readonly string[];
    limits: {
        cursorCharacters: number;
        declarationIdCharacters: number;
        defaultPageSize: number;
        errorDetailEntries: number;
        errorDetailValueCharacters: number;
        errorMessageCharacters: number;
        idempotencyKeyCharacters: number;
        instanceIdCharacters: number;
        maxPageSize: number;
        releaseVersionCharacters: number;
        requestIdCharacters: number;
        revisionTokenCharacters: number;
    };
    minimumClientVersion: string;
    pairingRequired: boolean;
    pairingScopes: readonly string[];
    pairingSecretHeader: string;
    publicRoutes: readonly CaveContractPublicRoute[];
}
interface CaveContractExamplesBase {
    cursor: CaveContractCursor;
    discoveryRecord: {
        endpoint: string;
        nonce: string;
        pid: number;
        startedAt: string;
        version: number;
    };
    errorEnvelope: CaveContractEnvelopeMetadata & {
        error: {
            code: string;
            details: Record<string, string>;
            message: string;
            retryable: boolean;
        };
        requestId: string;
    };
    health: CaveContractHealthData;
    healthEnvelope: CaveContractEnvelopeMetadata & {
        data: CaveContractHealthData;
    };
    identity: CaveContractIdentity;
    pairingCreatedEnvelope: CaveContractEnvelopeMetadata & {
        data: CaveContractPairingCreatedData;
    };
    pairingExchangeEnvelope: CaveContractEnvelopeMetadata & {
        data: CaveContractPairingExchangeData;
    };
    pairingStatusEnvelope: CaveContractEnvelopeMetadata & {
        data: CaveContractPairingStatusData;
    };
    revision: CaveContractRevision;
    status: {
        status: 'ok';
    };
    successEnvelope: CaveContractEnvelopeMetadata & {
        cursor: CaveContractCursor;
        data: {
            status: 'ok';
        };
        identity: CaveContractIdentity;
        requestId: string;
        revision: CaveContractRevision;
    };
}
type CaveContractFixture = {
    contract: CaveContractContractBase & {
        authority?: never;
        discovery: CaveContractDiscoveryBase & {
            hpkeBoundVersion?: never;
        };
        operations: readonly Extract<CaveContractOperation, {
            binding?: never;
        }>[];
    };
    examples: CaveContractExamplesBase & {
        discoveryRecordV2?: never;
    };
} | {
    contract: CaveContractContractBase & {
        authority: CaveContractHpkeAuthority;
        discovery: CaveContractDiscoveryBase & {
            hpkeBoundVersion: number;
        };
        operations: readonly Extract<CaveContractOperation, {
            binding: string;
        }>[];
    };
    examples: CaveContractExamplesBase & {
        discoveryRecordV2: CaveContractDiscoveryRecordV2;
    };
};
type JsonObject = Record<string, unknown>;
declare function digestCaveContractFixture(value: string | Uint8Array): string;
declare function verifyCaveContractFixtureDigest(value: string | Uint8Array, expectedDigest: string): string;
declare function parseCaveContractFixture(value: string | Uint8Array | JsonObject): CaveContractFixture;
declare function parseVerifiedCaveContractFixture(value: string | Uint8Array, expectedDigest: string): CaveContractFixture;

declare const CAVE_CLIENT_VERSION: string;

export { CAVE_CLIENT_VERSION, CaveClient, type CaveContractCursor, type CaveContractDiscoveryRecordV2, type CaveContractEnvelopeMetadata, type CaveContractFixture, type CaveContractHealthData, type CaveContractHpkeAuthority, type CaveContractIdentity, type CaveContractOperation, type CaveContractPairingCreatedData, type CaveContractPairingExchangeData, type CaveContractPairingStatusData, type CaveContractPublicRoute, type CaveContractRevision, type CaveDiscoveredClientOptions, type CaveDiscoveredEndpoint, type CaveDiscoveredEndpointV1, type CaveDiscoveredEndpointV2, type CaveDiscoveryDependencies, type CaveDiscoveryFileHandle, type CaveDiscoveryPathIdentity, type CaveDiscoveryRecordIdentity, type CaveEndpointFreshness, CaveHpkeDiscoveryAuthority, type CaveManagedClientOptions, CaveManagedHpkeAuthentication, CaveManagedHpkeDiscovery, type CaveManagedNativeAuthenticatedResponse, type CaveManagedNativeDiscardResult, type CaveManagedNativeHpkePairingExchange, type CaveManagedNativePairingCreated, type CaveManagedNativePairingExchange, type CaveManagedNativeResponse, type CaveManagedNativeTransport, CavePairingRequest, type CaveWindowsPathTrustResult, type CaveWindowsPathTrustValidator, type DiscoverCaveEndpointOptions, createDiscoveredCaveClient, createManagedCaveClient, digestCaveContractFixture, discoverCaveEndpoint, parseCaveContractFixture, parseVerifiedCaveContractFixture, verifyCaveContractFixtureDigest };
// Entrypoint: ./managed
// Declaration: dist/client-CYVZtJJc.d.ts
import { OperationContext, OperationOptions, OperationDefaults, PageOptions, SecretStore, SecretStoreReference, Page, BoundedPageOptions, NormalizedError, CompatibilityAssessment } from '@opencoven/sdk-core/browser';
import { DiscoveryEndpoint } from '@opencoven/sdk-core';

interface CaveCanonicalFamiliar {
    id: string;
    displayName: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    lastSeenAt?: string;
    activeSessions?: number;
}
interface CaveProject {
    id: string;
    name: string;
    root: string;
    color?: string;
    repoUrl?: string;
    createdAt: string;
    updatedAt: string;
}
interface CaveConversation {
    id: string;
    familiarId: string;
    harness?: string;
    model?: string;
    runtime?: string;
    title?: string;
    origin?: string;
    status?: string;
    exitCode?: number | null;
    pending?: boolean;
    createdAt?: string;
    updatedAt: string;
}
interface CaveConversationMessage {
    id: string;
    conversationId: string;
    parentId: string | null;
    role: string;
    text: string;
    createdAt: string;
    attachmentCount: number;
    toolCount: number;
    isError?: boolean;
    cancelled?: boolean;
}
interface CaveHealth {
    status: 'ok';
    apiVersion: string;
    minimumClientVersion: string;
    capabilities: readonly string[];
    operations: readonly string[];
    instanceId: string;
    pairingRequired: boolean;
    releaseVersion: string;
}
interface CaveHealthData {
    instanceId: string;
    pairingRequired: boolean;
    releaseVersion: string;
}
interface CaveHealthResponse {
    apiVersion: string;
    minimumClientVersion: string;
    requestId?: string;
    capabilities: readonly string[];
    operations: readonly string[];
    data: CaveHealthData;
}
declare const CAVE_PAIRING_SCOPES: readonly ["chat:read", "chat:write", "conversations:write", "attachments:write", "tasks:write", "github:write"];
type CavePairingScope = (typeof CAVE_PAIRING_SCOPES)[number];
declare const CAVE_PAIRING_STATUSES: readonly ["pending", "approved", "denied", "expired"];
type CavePairingState = (typeof CAVE_PAIRING_STATUSES)[number];
interface CavePairingRequest {
    appName: string;
    installationId: string;
    scopes: CavePairingScope[];
}
interface CavePairingCreated {
    requestId: string;
    secret: string;
    expiresAt: number;
}
interface CavePairingStatus {
    id: string;
    status: CavePairingState;
    expiresAt: number;
}
interface CaveCredentialMetadata {
    id: string;
    appName: string;
    installationId: string;
    scopes: CavePairingScope[];
    createdAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
    revocationReason: string | null;
}
interface CavePairingExchange {
    bearer: string;
    credential: CaveCredentialMetadata;
}
/**
 * The non-secret metadata a managed native bridge may return after creating a
 * pairing request. Native code retains the pairing secret.
 */
interface CaveManagedPairingCreated {
    requestId: string;
    expiresAt: number;
}
/**
 * The non-secret metadata a managed native bridge may return after consuming
 * an exchange. Native code retains and persists the bearer.
 */
interface CaveManagedPairingExchange {
    credential: CaveCredentialMetadata;
}
interface CaveAuthorityBinding {
    version: 1;
    instanceId: string;
    endpoint: {
        kind: 'http';
        url: string;
    };
    record: {
        identity: string;
        device: number;
        inode: number;
    };
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
}
interface CaveAuthorityBoundPairingExchange extends CavePairingExchange {
    authorityBinding: CaveAuthorityBinding;
}
type CaveCredentialAccess = 'chat:read' | 'scope_denied' | 'service_unavailable' | 'rate_limited';
type CaveCredentialDisconnectedReason = 'credential_update_in_progress' | 'reconcile_required';
type CaveCredentialStatus = {
    status: 'missing';
} | {
    status: 'disconnected';
    reason: CaveCredentialDisconnectedReason;
} | {
    status: 'revoked';
    health: CaveHealth;
} | {
    status: 'valid';
    access: CaveCredentialAccess;
    health: CaveHealth;
};
/**
 * Native bridges return this raw, non-secret status shape. `health` remains
 * untrusted until the SDK validates it with the authoritative health parser.
 */
type CaveManagedCredentialStatusResult = {
    status: 'missing';
} | {
    status: 'disconnected';
    reason: CaveCredentialDisconnectedReason;
} | {
    status: 'revoked';
    health: unknown;
} | {
    status: 'valid';
    access: CaveCredentialAccess;
    health: unknown;
};
/**
 * Native credential deletion must distinguish confirmed absence from a
 * replacement race so JavaScript never reports a newer credential as removed.
 */
type CaveManagedForgetCredentialResult = {
    status: 'deleted';
} | {
    status: 'missing';
} | {
    status: 'credential_update_in_progress';
};
/**
 * Familiars.
 *
 * These mirror what Cave already serves, rather than proposing a shape it does
 * not have: `GET /api/familiars` for the roster, `/[id]/contract` for the
 * Familiar Contract report, and `/[id]/execution-analytics` for run history.
 * Field-for-field, so a change on either side is a type error rather than a
 * value that silently arrives as undefined.
 *
 * The wire uses snake_case on the roster and camelCase everywhere else. The
 * `*Wire` types below keep the wire spelling exactly, because that is what has
 * to be validated; the exported types are camelCase, because that is what the
 * rest of a TypeScript program expects. The client is the one place the two
 * meet, and it is a better place for the seam than every call site.
 */
/** A familiar as the roster lists it. */
interface CaveFamiliar {
    id: string;
    displayName: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    lastSeen?: string;
    activeSessions?: number;
    memoryFreshness?: string;
}
/** The roster entry as it arrives. */
interface CaveFamiliarWire {
    id: string;
    display_name: string;
    role: string;
    description?: string;
    pronouns?: string;
    status?: string;
    last_seen?: string;
    active_sessions?: number;
    memory_freshness?: string;
}
interface CaveFamiliarsResponse {
    ok: boolean;
    familiars?: CaveFamiliarWire[];
    error?: string;
    reason?: string;
}
/**
 * The five normative properties of the Familiar Contract, in the spec's order.
 *
 * Duplicated from Cave rather than imported because the SDK does not depend on
 * Cave's source. The contract report carries its own `specVersion`, so a client
 * that finds a property it does not know about can say which version it was
 * built against instead of guessing.
 */
declare const CAVE_FAMILIAR_PROPERTIES: readonly ["Named Identity", "Defined Purpose", "Bounded Authority", "Persistent Memory", "Human Belonging"];
type CaveFamiliarProperty = (typeof CAVE_FAMILIAR_PROPERTIES)[number];
type CaveContractFile = 'SOUL.md' | 'IDENTITY.md' | 'ward.toml' | 'MEMORY.md' | 'cross-file';
interface CaveContractViolation {
    file: CaveContractFile;
    field: string;
    message: string;
}
interface CavePropertyCoverage {
    property: string;
    pass: boolean;
}
/**
 * `pass` is true when there are zero hard violations. Warnings do not fail a
 * contract -- a familiar that keeps no memory is a real answer to a real
 * question, not a malformed one.
 */
interface CaveContractReport {
    specVersion: string;
    pass: boolean;
    properties: CavePropertyCoverage[];
    violations: CaveContractViolation[];
    warnings: CaveContractViolation[];
}
interface CaveFamiliarContract {
    id: string;
    workspace?: string;
    present: boolean;
    report: CaveContractReport;
}
interface CaveFamiliarContractResponse {
    ok: boolean;
    /** Present on a refusal. The client surfaces it as the error code. */
    reason?: string;
    id?: string;
    workspace?: string;
    present?: boolean;
    report?: CaveContractReport;
    error?: string;
}
/** The windows Cave aggregates over. */
declare const CAVE_ANALYTICS_WINDOWS: readonly ["7d", "14d", "8w", "all"];
type CaveAnalyticsWindowKey = (typeof CAVE_ANALYTICS_WINDOWS)[number];
interface CaveExecutionSlice {
    key: string;
    label?: string;
    attempts: number;
    completed: number;
    failed: number;
    cancelled: number;
    successRate: number | null;
    medianDurationMs?: number;
    totalTokens?: number;
    costUsd?: number;
    toolCalls: number;
    toolFailures: number;
}
interface CaveExecutionCoverage {
    known: number;
    total: number;
    ratio: number;
}
interface CaveExecutionWindow {
    attempts: number;
    completed: number;
    failed: number;
    cancelled: number;
    /** Null when there were no attempts: a rate over nothing is not zero. */
    successRate: number | null;
    medianDurationMs?: number;
    p95DurationMs?: number;
    totalTokens?: number;
    costUsd?: number;
    toolCalls: number;
    toolFailures: number;
    models: CaveExecutionSlice[];
    harnesses: CaveExecutionSlice[];
    coverage: Record<string, CaveExecutionCoverage>;
}
interface CaveExecutionAttempt {
    id: string;
    sessionId?: string;
    turnId?: string;
    executionKind: string;
    occurredAt: string;
    harnessId: string;
    harnessVersion?: string;
    requestedModel?: string;
    forwardedModel?: string;
    confirmedModel?: string;
    status: 'completed' | 'failed' | 'cancelled';
    durationMs?: number;
    totalTokens?: number;
    costUsd?: number;
    toolCalls: number;
    toolFailures: number;
}
/**
 * Whether the history behind these numbers is complete.
 *
 * Reported rather than hidden, because a success rate drawn from a partial
 * import is a different claim from one drawn from all of it, and a reader who
 * cannot tell them apart will believe the wrong one.
 */
interface CaveExecutionBackfill {
    state: 'complete' | 'partial' | 'not-started';
    imported: number;
    remaining?: number;
}
interface CaveFamiliarAnalytics {
    generatedAt: string;
    windows: Partial<Record<CaveAnalyticsWindowKey, CaveExecutionWindow>>;
    recentAttempts: CaveExecutionAttempt[];
    backfill: CaveExecutionBackfill;
}
interface CaveFamiliarAnalyticsResponse {
    ok: boolean;
    /** Present on a refusal. The client surfaces it as the error code. */
    reason?: string;
    analytics?: CaveFamiliarAnalytics;
    error?: string;
}

declare const CAVE_DISCOVERY_RECORD_VERSION: 1;
declare const CAVE_HPKE_DISCOVERY_RECORD_VERSION: 2;
type CaveDiscoveryErrorCode = 'not_found' | 'owner_mismatch' | 'unsafe_endpoint' | 'stale_record' | 'body_limit' | 'invalid_response' | 'timeout' | 'aborted';
interface CaveHpkeDiscoveryAuthority {
    mechanism: 'hpke-bound-v1';
    mode: 'advertise' | 'enforce';
    keyId: string;
    publicKey: string;
    suite: {
        kemId: 32;
        kdfId: 1;
        aeadId: 2;
    };
}
interface CaveParsedDiscoveryRecordV1 {
    version: typeof CAVE_DISCOVERY_RECORD_VERSION;
    endpoint: Extract<DiscoveryEndpoint, {
        kind: 'http';
    }>;
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
}
interface CaveParsedDiscoveryRecordV2 {
    version: typeof CAVE_HPKE_DISCOVERY_RECORD_VERSION;
    endpoint: Extract<DiscoveryEndpoint, {
        kind: 'http';
    }>;
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
    authority: CaveHpkeDiscoveryAuthority;
}
type CaveParsedDiscoveryRecord = CaveParsedDiscoveryRecordV1 | CaveParsedDiscoveryRecordV2;
declare class CaveDiscoveryError extends Error {
    readonly code: CaveDiscoveryErrorCode;
    readonly retryable: boolean;
    constructor(code: CaveDiscoveryErrorCode, message: string);
}
declare function isCaveDiscoveryError(error: unknown): error is CaveDiscoveryError;

interface CaveManagedDiscoverySource {
    /**
     * Native code must read the owner-checked record. The SDK validates the
     * returned bytes and metadata; browser code never reads the filesystem.
     */
    read(context?: OperationContext): Promise<unknown>;
}
interface CaveManagedDiscoveryOptions extends OperationOptions {
    maxRecordBytes?: number;
    operation?: OperationDefaults;
}
interface CaveManagedDiscoveredEndpointBase {
    endpoint: {
        kind: 'http';
        url: string;
    };
    freshness: {
        pid: number;
        nonce: string;
        startedAt: string;
    };
    record: {
        identity: string;
        device: number;
        inode: number;
    };
}
type CaveManagedDiscoveredEndpoint = (CaveManagedDiscoveredEndpointBase & {
    version: 1;
}) | (CaveManagedDiscoveredEndpointBase & {
    version: 2;
    authority: CaveHpkeDiscoveryAuthority;
});
declare function discoverManagedCaveEndpoint(source: CaveManagedDiscoverySource, options?: CaveManagedDiscoveryOptions): Promise<CaveManagedDiscoveredEndpoint>;

interface CaveManagedHpkeDiscovery {
    source: CaveManagedDiscoverySource;
    options?: CaveManagedDiscoveryOptions;
}
interface CaveManagedHpkeAuthentication {
    mechanism: 'hpke-bound-v1';
    keyId: string;
}
interface CaveManagedHpkeResult<T = unknown> {
    authentication: CaveManagedHpkeAuthentication;
    value: T;
}

interface CaveTransport {
    health(context?: OperationContext): Promise<CaveHealthResponse>;
    pairingCreate?(request: CavePairingRequest, context?: OperationContext): Promise<CavePairingCreated>;
    pairingPoll?(requestId: string, pairingSecret: string, context?: OperationContext): Promise<CavePairingStatus>;
    pairingExchange?(requestId: string, pairingSecret: string, context?: OperationContext): Promise<CavePairingExchange>;
    /**
     * Canonical reads are optional for older transports. The caller owns their
     * I/O; the client supplies normalized page options and operation context.
     */
    listFamiliars?(options: PageOptions, context?: OperationContext): Promise<unknown>;
    listProjects?(options: PageOptions, context?: OperationContext): Promise<unknown>;
    listConversations?(options: PageOptions, context?: OperationContext): Promise<unknown>;
    getConversation?(conversationId: string, context?: OperationContext): Promise<unknown>;
    listConversationMessages?(conversationId: string, options: PageOptions, context?: OperationContext): Promise<unknown>;
    /**
     * The familiar operations are optional so that a transport written against
     * an older Cave still satisfies this interface. The client reports a missing
     * one as `unsupported_operation` rather than crashing on `undefined`.
     */
    familiars?(context?: OperationContext): Promise<CaveFamiliarsResponse>;
    familiarContract?(familiarId: string, context?: OperationContext): Promise<CaveFamiliarContractResponse>;
    familiarAnalytics?(familiarId: string, options?: {
        recentLimit?: number;
    }, context?: OperationContext): Promise<CaveFamiliarAnalyticsResponse>;
}
interface CaveCredentialPersistingTransport extends CaveTransport {
    pairingExchange?(requestId: string, pairingSecret: string, context?: OperationContext): Promise<CaveAuthorityBoundPairingExchange>;
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
interface CaveManagedCredentialTransport extends CaveTransport {
    managedPairingCreate(request: CavePairingRequest, context?: OperationContext): Promise<unknown>;
    managedPairingPoll(requestId: string, context?: OperationContext): Promise<unknown>;
    managedPairingExchange(requestId: string, context?: OperationContext): Promise<unknown>;
    managedCredentialStatus(context?: OperationContext): Promise<unknown>;
    managedForgetCredential(context?: OperationContext): Promise<unknown>;
    managedHpkePairingPoll?(requestId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkePairingExchange?(requestId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeCredentialStatus?(discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeFamiliars?(discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListFamiliars?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListProjects?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListConversations?(options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeGetConversation?(conversationId: string, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
    managedHpkeListConversationMessages?(conversationId: string, options: PageOptions, discovered: Extract<CaveManagedDiscoveredEndpoint, {
        version: 2;
    }>, context?: OperationContext): Promise<CaveManagedHpkeResult>;
}

interface CaveCredentialBinding {
    store: SecretStore;
    reference: SecretStoreReference;
}
/**
 * Selects native custody for every Cave pairing and credential secret. A
 * managed transport is responsible for retaining, consuming, and persisting
 * those values outside JavaScript.
 */
interface CaveManagedNativeCredentialCustody {
    mode: 'managed-native';
}
interface CaveClientOptionsBase {
    operation?: OperationDefaults;
}
interface CaveClientOptionsWithoutCredentials extends CaveClientOptionsBase {
    transport: CaveTransport;
    credentials?: undefined;
    credentialCustody?: undefined;
}
interface CaveClientOptionsWithCredentials extends CaveClientOptionsBase {
    transport: CaveCredentialPersistingTransport;
    credentials: CaveCredentialBinding;
    credentialCustody?: undefined;
}
interface CaveClientOptionsWithManagedNativeCredentials extends CaveClientOptionsBase {
    transport: CaveManagedCredentialTransport;
    credentials?: never;
    credentialCustody: CaveManagedNativeCredentialCustody;
}
type CaveClientOptions = CaveClientOptionsWithoutCredentials | CaveClientOptionsWithCredentials | CaveClientOptionsWithManagedNativeCredentials;
interface CaveFamiliarAnalyticsOptions extends OperationOptions {
    recentLimit?: number;
}
interface CavePairingSessionOptions {
    requestId: string;
    expiresAt: number;
    exchange: (options?: OperationOptions) => Promise<CaveCredentialMetadata>;
    poll: (options?: OperationOptions) => Promise<CavePairingStatus>;
}
declare function normalizeCaveError(error: unknown, operation: string): NormalizedError;
declare class CaveClientError extends Error {
    readonly normalized: NormalizedError;
    readonly compatibility: CompatibilityAssessment | undefined;
    readonly code: string;
    readonly retryable: boolean;
    readonly requestId: string | undefined;
    readonly statusCode: number | undefined;
    readonly details: Record<string, string> | undefined;
    constructor(normalized: NormalizedError, compatibility?: CompatibilityAssessment, options?: ErrorOptions);
}
declare function isCaveClientError(error: unknown): error is CaveClientError;
declare class CavePairingSession {
    #private;
    readonly requestId: string;
    readonly expiresAt: number;
    constructor(options: CavePairingSessionOptions);
    poll(options?: OperationOptions): Promise<CavePairingStatus>;
    exchange(options?: OperationOptions): Promise<CaveCredentialMetadata>;
}
declare class CaveClient {
    #private;
    constructor(options: CaveClientOptions);
    health(options?: OperationOptions): Promise<CaveHealth>;
    listFamiliars(options?: PageOptions & OperationOptions): Promise<Page<CaveCanonicalFamiliar>>;
    listProjects(options?: PageOptions & OperationOptions): Promise<Page<CaveProject>>;
    listConversations(options?: PageOptions & OperationOptions): Promise<Page<CaveConversation>>;
    getConversation(conversationId: string, options?: OperationOptions): Promise<CaveConversation>;
    listConversationMessages(conversationId: string, options?: PageOptions & OperationOptions): Promise<Page<CaveConversationMessage>>;
    iterateFamiliars(options: BoundedPageOptions): AsyncGenerator<CaveCanonicalFamiliar>;
    iterateProjects(options: BoundedPageOptions): AsyncGenerator<CaveProject>;
    iterateConversations(options: BoundedPageOptions): AsyncGenerator<CaveConversation>;
    iterateConversationMessages(conversationId: string, options: BoundedPageOptions): AsyncGenerator<CaveConversationMessage>;
    familiars(options?: OperationOptions): Promise<CaveFamiliar[]>;
    /** The Familiar Contract report. Mirrors `GET /api/familiars/:id/contract`. */
    familiarContract(familiarId: string, options?: OperationOptions): Promise<CaveFamiliarContract>;
    /**
     * Execution analytics. Mirrors `GET /api/familiars/:id/execution-analytics`.
     *
     * `backfill` comes back untouched. A success rate drawn from a partial
     * import is a different claim from one drawn from all of it, and dropping
     * the distinction here would leave every caller unable to make it.
     */
    familiarAnalytics(familiarId: string, options?: CaveFamiliarAnalyticsOptions): Promise<CaveFamiliarAnalytics>;
    createPairing(request: CavePairingRequest, options?: OperationOptions): Promise<CavePairingSession>;
    credentialStatus(options?: OperationOptions): Promise<CaveCredentialStatus>;
    forgetCredential(options?: OperationOptions): Promise<boolean>;
}
declare function createCaveClient(options: CaveClientOptions): CaveClient;

export { type CavePairingCreated as $, CaveDiscoveryError as A, type CaveDiscoveryErrorCode as B, type CaveHpkeDiscoveryAuthority as C, type CaveExecutionAttempt as D, type CaveExecutionBackfill as E, type CaveExecutionCoverage as F, type CaveExecutionSlice as G, type CaveExecutionWindow as H, type CaveFamiliar as I, type CaveFamiliarAnalytics as J, type CaveFamiliarAnalyticsOptions as K, type CaveFamiliarAnalyticsResponse as L, type CaveFamiliarContract as M, type CaveFamiliarContractResponse as N, type CaveFamiliarProperty as O, type CaveFamiliarWire as P, type CaveFamiliarsResponse as Q, type CaveHealth as R, type CaveHealthData as S, type CaveHealthResponse as T, type CaveManagedCredentialStatusResult as U, type CaveManagedCredentialTransport as V, type CaveManagedForgetCredentialResult as W, type CaveManagedHpkeResult as X, type CaveManagedNativeCredentialCustody as Y, type CaveManagedPairingCreated as Z, type CaveManagedPairingExchange as _, type CavePairingRequest as a, type CavePairingExchange as a0, type CavePairingScope as a1, CavePairingSession as a2, type CavePairingState as a3, type CavePairingStatus as a4, type CaveParsedDiscoveryRecord as a5, type CaveParsedDiscoveryRecordV1 as a6, type CaveParsedDiscoveryRecordV2 as a7, type CaveProject as a8, type CavePropertyCoverage as a9, type CaveTransport as aa, createCaveClient as ab, isCaveClientError as ac, isCaveDiscoveryError as ad, normalizeCaveError as ae, type CaveManagedDiscoveryOptions as af, type CaveManagedDiscoverySource as ag, discoverManagedCaveEndpoint as ah, type CaveManagedDiscoveredEndpoint as b, type CaveManagedHpkeAuthentication as c, type CaveManagedHpkeDiscovery as d, CaveClient as e, CAVE_ANALYTICS_WINDOWS as f, CAVE_FAMILIAR_PROPERTIES as g, CAVE_PAIRING_SCOPES as h, CAVE_PAIRING_STATUSES as i, type CaveAnalyticsWindowKey as j, type CaveAuthorityBinding as k, type CaveAuthorityBoundPairingExchange as l, type CaveCanonicalFamiliar as m, CaveClientError as n, type CaveClientOptions as o, type CaveContractFile as p, type CaveContractReport as q, type CaveContractViolation as r, type CaveConversation as s, type CaveConversationMessage as t, type CaveCredentialAccess as u, type CaveCredentialBinding as v, type CaveCredentialDisconnectedReason as w, type CaveCredentialMetadata as x, type CaveCredentialPersistingTransport as y, type CaveCredentialStatus as z };
// Entrypoint: ./managed
// Declaration: dist/managed.d.ts
import { V as CaveManagedCredentialTransport, d as CaveManagedHpkeDiscovery, e as CaveClient } from './client-CYVZtJJc.js';
export { f as CAVE_ANALYTICS_WINDOWS, g as CAVE_FAMILIAR_PROPERTIES, h as CAVE_PAIRING_SCOPES, i as CAVE_PAIRING_STATUSES, m as CaveCanonicalFamiliar, n as CaveClientError, o as CaveClientOptions, s as CaveConversation, t as CaveConversationMessage, u as CaveCredentialAccess, v as CaveCredentialBinding, x as CaveCredentialMetadata, z as CaveCredentialStatus, K as CaveFamiliarAnalyticsOptions, R as CaveHealth, C as CaveHpkeDiscoveryAuthority, U as CaveManagedCredentialStatusResult, b as CaveManagedDiscoveredEndpoint, af as CaveManagedDiscoveryOptions, ag as CaveManagedDiscoverySource, W as CaveManagedForgetCredentialResult, c as CaveManagedHpkeAuthentication, X as CaveManagedHpkeResult, Y as CaveManagedNativeCredentialCustody, Z as CaveManagedPairingCreated, _ as CaveManagedPairingExchange, a as CavePairingRequest, a1 as CavePairingScope, a2 as CavePairingSession, a3 as CavePairingState, a4 as CavePairingStatus, a8 as CaveProject, aa as CaveTransport, ah as discoverManagedCaveEndpoint, ac as isCaveClientError, ae as normalizeCaveError } from './client-CYVZtJJc.js';
import { OperationDefaults } from '@opencoven/sdk-core/browser';
import '@opencoven/sdk-core';

interface CaveManagedClientOptions {
    transport: CaveManagedCredentialTransport;
    discovery?: CaveManagedHpkeDiscovery;
    operation?: OperationDefaults;
}
declare function createManagedCaveClient(options: CaveManagedClientOptions): CaveClient;

export { CaveClient, type CaveManagedClientOptions, CaveManagedCredentialTransport, CaveManagedHpkeDiscovery, createManagedCaveClient };
