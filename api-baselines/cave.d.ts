import { DiscoveryEndpoint, OperationOptions, OperationContext, PageOptions, OperationDefaults, SecretStore, SecretStoreReference, Page, BoundedPageOptions, NormalizedError, CompatibilityAssessment } from '@opencoven/sdk-core';

declare const DISCOVERY_RECORD_VERSION: 1;
type CaveDiscoveryErrorCode = 'not_found' | 'owner_mismatch' | 'unsafe_endpoint' | 'stale_record' | 'body_limit' | 'invalid_response' | 'timeout' | 'aborted';
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
interface CaveDiscoveredEndpoint {
    version: typeof DISCOVERY_RECORD_VERSION;
    endpoint: Extract<DiscoveryEndpoint, {
        kind: 'http';
    }>;
    freshness: CaveEndpointFreshness;
    record: CaveDiscoveryRecordIdentity;
}
declare class CaveDiscoveryError extends Error {
    readonly code: CaveDiscoveryErrorCode;
    readonly retryable: boolean;
    constructor(code: CaveDiscoveryErrorCode, message: string);
}
declare function isCaveDiscoveryError(error: unknown): error is CaveDiscoveryError;
declare function discoverCaveEndpoint(options?: DiscoverCaveEndpointOptions): Promise<CaveDiscoveredEndpoint>;

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
interface CaveAuthorityBinding {
    version: CaveDiscoveredEndpoint['version'];
    instanceId: string;
    endpoint: CaveDiscoveredEndpoint['endpoint'];
    record: {
        identity: string;
        device: number;
        inode: number;
    };
    freshness: CaveEndpointFreshness;
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

interface CaveCredentialBinding$1 {
    store: SecretStore;
    reference: SecretStoreReference;
}
interface CaveClientOptionsBase {
    operation?: OperationDefaults;
}
interface CaveClientOptionsWithoutCredentials extends CaveClientOptionsBase {
    transport: CaveTransport;
    credentials?: undefined;
}
interface CaveClientOptionsWithCredentials extends CaveClientOptionsBase {
    transport: CaveCredentialPersistingTransport;
    credentials: CaveCredentialBinding$1;
}
type CaveClientOptions = CaveClientOptionsWithoutCredentials | CaveClientOptionsWithCredentials;
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

interface CaveManagedNativeResponse {
    statusCode: number;
    payload: unknown;
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
type CaveManagedNativeDiscardResult = 'absent' | 'changed' | 'deleted';
interface CaveManagedNativeTransport {
    health(context?: OperationContext): Promise<CaveManagedNativeResponse>;
    pairingCreate(request: CavePairingRequest, context?: OperationContext): Promise<CaveManagedNativePairingCreated>;
    pairingPoll(handle: string, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    pairingExchange(handle: string, context?: OperationContext): Promise<CaveManagedNativePairingExchange>;
    pairingCommit(commitHandle: string, context?: OperationContext): Promise<void>;
    pairingDiscard(commitHandle: string): Promise<CaveManagedNativeDiscardResult>;
    credentialState(context?: OperationContext): Promise<unknown>;
    forgetCredential(context?: OperationContext): Promise<unknown>;
    familiars(context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listFamiliars(options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listProjects(options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listConversations(options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    getConversation(conversationId: string, context?: OperationContext): Promise<CaveManagedNativeResponse>;
    listConversationMessages(conversationId: string, options: PageOptions, context?: OperationContext): Promise<CaveManagedNativeResponse>;
}
interface CaveManagedClientOptions {
    transport: CaveManagedNativeTransport;
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
interface CaveContractOperation {
    families: readonly string[];
    id: string;
    ingress: string;
    method: string;
    path: string;
    scope: string | null;
}
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
interface CaveContractFixture {
    contract: {
        apiVersion: string;
        capabilities: readonly string[];
        discovery: {
            fileName: string;
            mode: string;
            version: number;
        };
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
        operations: readonly CaveContractOperation[];
        pairingRequired: boolean;
        pairingScopes: readonly string[];
        pairingSecretHeader: string;
        publicRoutes: readonly CaveContractPublicRoute[];
    };
    examples: {
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
    };
}
type JsonObject = Record<string, unknown>;
declare function digestCaveContractFixture(value: string | Uint8Array): string;
declare function verifyCaveContractFixtureDigest(value: string | Uint8Array, expectedDigest: string): string;
declare function parseCaveContractFixture(value: string | Uint8Array | JsonObject): CaveContractFixture;
declare function parseVerifiedCaveContractFixture(value: string | Uint8Array, expectedDigest: string): CaveContractFixture;

declare const CAVE_CLIENT_VERSION: string;

export { CAVE_ANALYTICS_WINDOWS, CAVE_CLIENT_VERSION, CAVE_FAMILIAR_PROPERTIES, CAVE_PAIRING_SCOPES, CAVE_PAIRING_STATUSES, type CaveAnalyticsWindowKey, type CaveAuthorityBinding, type CaveAuthorityBoundPairingExchange, type CaveCanonicalFamiliar, CaveClient, CaveClientError, type CaveClientOptions, type CaveContractCursor, type CaveContractEnvelopeMetadata, type CaveContractFile, type CaveContractFixture, type CaveContractHealthData, type CaveContractIdentity, type CaveContractOperation, type CaveContractPairingCreatedData, type CaveContractPairingExchangeData, type CaveContractPairingStatusData, type CaveContractPublicRoute, type CaveContractReport, type CaveContractRevision, type CaveContractViolation, type CaveConversation, type CaveConversationMessage, type CaveCredentialAccess, type CaveCredentialBinding$1 as CaveCredentialBinding, type CaveCredentialDisconnectedReason, type CaveCredentialMetadata, type CaveCredentialPersistingTransport, type CaveCredentialStatus, type CaveDiscoveredClientOptions, type CaveDiscoveredEndpoint, type CaveDiscoveryDependencies, CaveDiscoveryError, type CaveDiscoveryErrorCode, type CaveDiscoveryFileHandle, type CaveDiscoveryPathIdentity, type CaveDiscoveryRecordIdentity, type CaveEndpointFreshness, type CaveExecutionAttempt, type CaveExecutionBackfill, type CaveExecutionCoverage, type CaveExecutionSlice, type CaveExecutionWindow, type CaveFamiliar, type CaveFamiliarAnalytics, type CaveFamiliarAnalyticsOptions, type CaveFamiliarAnalyticsResponse, type CaveFamiliarContract, type CaveFamiliarContractResponse, type CaveFamiliarProperty, type CaveFamiliarWire, type CaveFamiliarsResponse, type CaveHealth, type CaveHealthData, type CaveHealthResponse, type CaveManagedClientOptions, type CaveManagedNativeDiscardResult, type CaveManagedNativePairingCreated, type CaveManagedNativePairingExchange, type CaveManagedNativeResponse, type CaveManagedNativeTransport, type CavePairingCreated, type CavePairingExchange, type CavePairingRequest, type CavePairingScope, CavePairingSession, type CavePairingState, type CavePairingStatus, type CaveProject, type CavePropertyCoverage, type CaveTransport, type CaveWindowsPathTrustResult, type CaveWindowsPathTrustValidator, type DiscoverCaveEndpointOptions, createCaveClient, createDiscoveredCaveClient, createManagedCaveClient, digestCaveContractFixture, discoverCaveEndpoint, isCaveClientError, isCaveDiscoveryError, normalizeCaveError, parseCaveContractFixture, parseVerifiedCaveContractFixture, verifyCaveContractFixtureDigest };
