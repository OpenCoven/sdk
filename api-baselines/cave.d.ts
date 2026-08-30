// Entrypoint: .
// Declaration: dist/client-M2RrMRyI.d.ts
import { OperationObserver, OperationContext, PageOptions, OperationDefaults, SecretStore, SecretStoreReference, OperationOptions, Page, BoundedPageOptions, NormalizedError, CompatibilityAssessment } from '@opencoven/sdk-core/browser';

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

/**
 * Conversational control: the first bounded mutation authority.
 *
 * Cave remains the sole executor and canonical state owner. The SDK exposes
 * constrained typed operations only — never arbitrary HTTP paths, private
 * Cave routes, or raw transport escape hatches — and owns the public DTOs,
 * validators, and the single event translator shared by initial and resumed
 * streams.
 *
 * The five Client v1 operations this surface is defined against
 * (`conversations.create`, `messages.send`, `operations.read`,
 * `operations.events`, `operations.stop`) are not yet declared by the
 * authoritative Cave contract fixture this SDK vendors. This module therefore
 * defines the typed requests, results, operation records, event vocabulary,
 * cursor handling, and translation rules only; it introduces no HTTP paths.
 * Transport bindings for the five operations stay optional and are expected
 * to arrive with the upstream Cave producer contract and a re-imported
 * fixture.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
type CaveConversationOperationId = string;
type CaveConversationEventCursor = string;
interface CaveCreateConversationRequest {
    operationId: CaveConversationOperationId;
    familiarId: string;
    projectId?: string;
}
type CaveSendConversationMessageRequest = {
    operationId: CaveConversationOperationId;
    text: string;
    retryOfTurnId?: never;
} | {
    operationId: CaveConversationOperationId;
    retryOfTurnId: string;
    text?: never;
};
interface CaveRetryConversationTurnRequest {
    operationId: CaveConversationOperationId;
    retryOfTurnId: string;
}
type CaveConversationOperationState = 'pending' | 'accepted' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled';
type CaveConversationOperationKind = 'conversations.create' | 'messages.send';
type CaveConversationOriginatingScope = 'chat:write' | 'conversations:write';
interface CaveConversationOperation {
    id: CaveConversationOperationId;
    kind: CaveConversationOperationKind;
    state: CaveConversationOperationState;
    originatingScope: CaveConversationOriginatingScope;
    conversationId: string;
    inputTurnId?: string;
    outputTurnId?: string;
    retryOfTurnId?: string;
    failureCode?: string;
    latestEventId: number;
    replayFloorEventId: number;
    createdAt: string;
    updatedAt: string;
    idempotencyResultExpiresAt?: string;
}
interface CaveCreateConversationResult {
    operationId: CaveConversationOperationId;
    replayed: boolean;
    conversation: CaveConversation;
}
interface CaveSendConversationMessageResult {
    operation: CaveConversationOperation;
    replayed: boolean;
}
interface CaveConversationEventBase {
    operationId: CaveConversationOperationId;
    eventId: number;
    cursor: CaveConversationEventCursor;
    occurredAt: string;
}
type CaveConversationEventType = 'operation.accepted' | 'assistant.delta' | 'operation.stopping' | 'operation.completed' | 'operation.failed' | 'operation.cancelled';
type CaveConversationEvent = (CaveConversationEventBase & {
    type: 'operation.accepted';
    conversationId: string;
    inputTurnId: string;
    retryOfTurnId?: string;
}) | (CaveConversationEventBase & {
    type: 'assistant.delta';
    text: string;
}) | (CaveConversationEventBase & {
    type: 'operation.stopping';
}) | (CaveConversationEventBase & {
    type: 'operation.completed';
    outputTurnId: string;
}) | (CaveConversationEventBase & {
    type: 'operation.failed';
    outputTurnId: string;
    code: string;
}) | (CaveConversationEventBase & {
    type: 'operation.cancelled';
    outputTurnId: string;
});
interface CaveConversationEventPage {
    operation: CaveConversationOperation;
    events: readonly CaveConversationEvent[];
    complete: boolean;
    cursor?: {
        current?: CaveConversationEventCursor;
        next?: CaveConversationEventCursor;
        hasMore: boolean;
    };
}
interface CaveConversationEventPageRequest {
    cursor?: CaveConversationEventCursor;
    waitMs?: number;
}
interface CaveConversationStreamOptions {
    cursor?: CaveConversationEventCursor;
    signal?: AbortSignal;
    timeoutMs?: number;
    observer?: OperationObserver;
}
declare const CAVE_CONVERSATION_OPERATION_STATES: readonly ["pending", "accepted", "running", "stopping", "completed", "failed", "cancelled"];
declare const CAVE_CONVERSATION_TERMINAL_STATES: readonly ["completed", "failed", "cancelled"];
declare const CAVE_CONVERSATION_EVENT_TYPES: readonly ["operation.accepted", "assistant.delta", "operation.stopping", "operation.completed", "operation.failed", "operation.cancelled"];
/** The scope stored with an operation when it was claimed; reads of the operation and its events are authorized by it. */
declare const CAVE_CONVERSATION_ORIGINATING_SCOPES: readonly ["chat:write", "conversations:write"];
/**
 * The defined `reconcile_required` reasons. A `reconcile_required` error is
 * an instruction to reload canonical state, not a transient transport retry.
 */
declare const CAVE_CONVERSATION_RECONCILE_REASONS: readonly ["replay_gap", "operation_expired", "canonical_branch_changed", "idempotency_result_expired", "canonical_state_moved"];
type CaveConversationReconcileReason = (typeof CAVE_CONVERSATION_RECONCILE_REASONS)[number];
/**
 * Event cursors are opaque route strings bounded by the authoritative
 * `cursorCharacters` limit. The SDK never decodes them.
 */
declare function validateConversationEventCursor(value: unknown, label: string): CaveConversationEventCursor;
interface CaveConversationTranslatedPage {
    operation: CaveConversationOperation;
    events: readonly CaveConversationEvent[];
    complete: boolean;
    requestId: string | undefined;
    nextCursor?: CaveConversationEventCursor;
}
interface CaveConversationEventTranslator {
    readonly operationId: CaveConversationOperationId;
    readonly deliveredThroughEventId: number;
    /**
     * Validate one raw event-page response and return the accepted events in
     * wire order. Throws a protocol error on any violation.
     */
    translate(page: unknown): CaveConversationTranslatedPage;
    /** Advance the accepted cursor after the event has been delivered. */
    commit(eventId: number): void;
}
interface CaveConversationEventTranslatorOptions {
    /**
     * True when this stream's first page resumes behind an opaque cursor from
     * an earlier generator run: the first accepted event then cannot be
     * gap-checked against a known event ID. A fresh stream must begin at
     * event 1.
     */
    resumeAfterOpaqueCursor?: boolean;
}
/**
 * The one parser/translator for conversation event pages. Initial attachment
 * and every resumed long poll pass through it.
 *
 * The translator validates the shared Client v1 envelope before event data,
 * validates the operation ID on every event, requires contiguous increasing
 * event IDs, suppresses an exact duplicate event at or below the caller's
 * accepted cursor, and refuses forward gaps, reordered events, changed
 * operation IDs, malformed terminal sequences, and events after terminal as
 * protocol violations. The resume cursor advances only when the caller
 * commits, after the corresponding event has been delivered.
 */
declare function createConversationEventTranslator(operationId: CaveConversationOperationId, options?: CaveConversationEventTranslatorOptions): CaveConversationEventTranslator;
/**
 * The defined `reconcile_required` reasons, read from normalized error
 * details without trusting the error shape.
 */
declare function caveConversationReconcileReason(error: unknown): CaveConversationReconcileReason | undefined;

/**
 * Bounded attachment transfer for the privileged authority tier.
 *
 * This module owns the SDK half of the attachment contract: fail-closed
 * preflight validation (file count, per-file size, total request size,
 * declared MIME type versus signature, filename, traversal, symlink, and
 * ownership binding) and the metadata-only records that bind an attachment
 * to its uploader credential and conversation atomically. Attachment bytes
 * exist only inside the in-flight upload request; they never enter the
 * canonical attachment record, and therefore never enter canonical
 * conversation JSON, browser storage, profile config, or diagnostic bundles.
 * The SDK never hashes attachment bytes: the canonical byte digest is
 * Cave's, computed server-side where the bytes land, and appears in records
 * only as a validated string.
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `attachments:write` pairing
 * scope but no attachment operations and no attachment capability family,
 * so no transport binding or route path ships; upload and download report
 * `unsupported_operation` until the producer contract lands and
 * `pnpm sync:contracts` imports it. Cave revalidates every limit, the
 * content signature, and the ownership binding server-side.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
declare const CAVE_ATTACHMENT_LIMITS: Readonly<{
    /** Maximum attachments in one upload request. */
    maxFiles: 10;
    /** Maximum byte size of one attachment. */
    maxFileBytes: number;
    /** Maximum summed byte size of one upload request. */
    maxRequestBytes: number;
    /** Maximum filename length in UTF-16 code units. */
    maxFilenameCharacters: 128;
    /** Maximum canonical identifier length for attachment/credential IDs. */
    maxReferenceCharacters: 64;
}>;
/**
 * The approved content-type allowlist. SVG, archive, and executable types
 * are forbidden by the issue's non-goals and are not present.
 */
declare const CAVE_ATTACHMENT_CONTENT_TYPES: readonly ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];
type CaveAttachmentContentType = (typeof CAVE_ATTACHMENT_CONTENT_TYPES)[number];
declare class CaveAttachmentSchemaError extends TypeError {
    readonly field: string;
    constructor(field: string);
}
/**
 * Signature-sniff the declared content type from the leading bytes. Returns
 * the matched allowlisted type, `'text/plain'` when the bytes decode as
 * UTF-8 text without binary markers, or `undefined` when nothing matches.
 * A declared binary type whose bytes do not carry its signature is never
 * accepted.
 */
declare function sniffCaveAttachmentContentType(content: Uint8Array): CaveAttachmentContentType | undefined;
interface CaveAttachmentContent {
    readonly filename: string;
    readonly contentType: CaveAttachmentContentType;
    readonly content: Uint8Array;
    readonly symlink?: false;
}
interface CaveAttachmentDescriptor {
    readonly filename: string;
    readonly contentType: CaveAttachmentContentType;
    readonly sizeBytes: number;
}
interface CaveAttachmentBinding {
    readonly conversationId: string;
    readonly uploaderCredentialId: string;
    readonly attachments: readonly CaveAttachmentDescriptor[];
    readonly totalBytes: number;
}
interface CaveAttachmentUploadRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly uploaderCredentialId: string;
    readonly attachments: readonly CaveAttachmentContent[];
}
interface CaveAttachmentDownloadRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly attachmentId: string;
    /** Optional ceiling; the parser defaults it to `maxFileBytes`. */
    readonly maxBytes?: number;
}
/**
 * The canonical attachment record: metadata bound to its conversation and
 * uploader credential. There is no byte field on this type by construction —
 * attachment bytes never enter canonical conversation JSON.
 */
interface CaveAttachmentRecord {
    readonly attachmentId: string;
    readonly conversationId: string;
    readonly uploaderCredentialId: string;
    readonly filename: string;
    readonly contentType: CaveAttachmentContentType;
    readonly sizeBytes: number;
    readonly digestSha256: string;
}
/**
 * Bind validated attachments to their conversation and uploader credential
 * atomically: every input is validated before any descriptor is produced,
 * so a rejection leaves no partial binding. The binding is metadata-only.
 */
declare function bindCaveAttachments(conversationId: unknown, uploaderCredentialId: unknown, attachments: readonly unknown[]): CaveAttachmentBinding;
/**
 * Parse and fully validate one attachment upload request. Validation is
 * fail-closed and total: any malformed field rejects the whole request, and
 * the caller performs zero transport work on rejection.
 */
declare function parseCaveAttachmentUploadRequest(value: unknown): CaveAttachmentUploadRequest;
/**
 * Parse one bounded attachment download request. The byte ceiling is
 * mandatory in effect: when omitted it defaults to `maxFileBytes`, and a
 * larger value is rejected.
 */
declare function parseCaveAttachmentDownloadRequest(value: unknown): CaveAttachmentDownloadRequest;
/**
 * Parse a canonical attachment record from a transport response. Exact keys:
 * a record carrying a `content` (or any unknown) field is rejected, so bytes
 * cannot re-enter canonical state through the record type.
 */
declare function parseCaveAttachmentRecord(value: unknown): CaveAttachmentRecord;

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

/**
 * Privileged authority capabilities for the attachment, rich-content,
 * attention, task-handoff, and GitHub action tiers.
 *
 * Every privileged action class is gated by a capability resolution derived
 * from the authoritative Cave contract fixture this SDK vendors: an action
 * class is actionable only when the contract declares at least one operation
 * carrying the required scope. The pinned fixture (Cave `4adc97b1`) declares
 * the privileged scope names for pairing (`attachments:write`, `tasks:write`,
 * `github:write`, `chat:write`, `conversations:write`) but declares no
 * operation that uses them, so every privileged resolution is `undeclared`
 * today and the client reports `unsupported_operation` before any transport
 * dispatch. Nothing here invents routes, capability families, or scope names:
 * scope identifiers come from the fixture's pairing-scope list, and declared
 * operations come from the fixture's operation table.
 *
 * Resolutions are computed per call from the consulted contract data and
 * returned as frozen descriptors. No capability object is cached across
 * grants: Cave remains the sole authority for grants, confirmation
 * revalidation, idempotency, audit, and domain mutation.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
type CavePrivilegedActionClass = 'attachment-transfer' | 'rich-content' | 'attention-response' | 'task-handoff' | 'github-action';
declare const CAVE_PRIVILEGED_ACTION_CLASSES: readonly ["attachment-transfer", "rich-content", "attention-response", "task-handoff", "github-action"];
interface CavePrivilegedActionRequirement {
    readonly actionClass: CavePrivilegedActionClass;
    /** Drawn only from the fixture-declared pairing scope vocabulary. */
    readonly requiredScope: CavePairingScope;
    /** Every privileged action requires a direct, explicit confirmation. */
    readonly requiresConfirmation: true;
    /** Idempotency is keyed by the caller-supplied 36-character operation UUID. */
    readonly idempotencyKey: 'operation-uuid';
}
/**
 * The SDK-declared requirement mapping. Scope identifiers are the pairing
 * scopes the authoritative fixture declares; the authoritative grant mapping
 * is Cave's and is revalidated server-side regardless of these values.
 */
declare const CAVE_PRIVILEGED_ACTION_REQUIREMENTS: Readonly<Record<CavePrivilegedActionClass, CavePrivilegedActionRequirement>>;
interface CaveDeclaredOperationRef {
    readonly id: string;
    readonly method: string;
    readonly path: string;
    readonly scope: string | null;
}
type CaveCapabilityStatus = 'declared' | 'undeclared';
interface CaveCapabilityResolution {
    readonly actionClass: CavePrivilegedActionClass;
    readonly status: CaveCapabilityStatus;
    readonly requirement: CavePrivilegedActionRequirement;
    /**
     * The capability families the consulted contract declares. The pinned
     * fixture declares none of the privileged families.
     */
    readonly declaredCapabilities: readonly string[];
    /**
     * The operations the consulted contract declares with the required scope.
     * Empty for every privileged class under the pinned fixture.
     */
    readonly declaredOperations: readonly CaveDeclaredOperationRef[];
}
interface CaveCapabilityRegistry {
    resolve(actionClass: CavePrivilegedActionClass): CaveCapabilityResolution;
}
interface CaveCapabilityContractSource {
    readonly capabilities: readonly string[];
    readonly operations: readonly CaveContractOperation[];
}
/**
 * Build a capability registry from a parsed (preferably digest-verified)
 * Client v1 contract fixture. Resolution consults the operation table on
 * every call: an action class is `declared` only when the contract declares
 * at least one operation carrying the required scope.
 */
declare function createCaveCapabilityRegistry(contract: CaveCapabilityContractSource): CaveCapabilityRegistry;
/**
 * The default capability source: the operation table of the authoritative
 * fixture pinned at Cave `4adc97b1` (digest `b2694cd1…`). Tests assert this
 * snapshot matches the vendored fixture exactly, so a fixture re-import
 * forces a reviewed update here. Under this contract every privileged action
 * class resolves `undeclared`.
 */
declare const CAVE_DEFAULT_CAPABILITY_CONTRACT: CaveCapabilityContractSource;
/**
 * The default registry every `CaveClient` uses when no explicit registry is
 * supplied. Under the pinned fixture all privileged action classes resolve
 * `undeclared`.
 */
declare function createDefaultCaveCapabilityRegistry(): CaveCapabilityRegistry;
/**
 * A privileged action carries a direct, explicit confirmation: exactly one
 * `confirmed` field whose value is the literal `true`. Anything else — a
 * missing field, `false`, a string, a truthy object — is a configuration
 * error raised before any capability or transport work.
 */
declare function parsePrivilegedConfirmation(value: unknown): true;
/**
 * Privileged actions key idempotency with the same Client v1 operation UUID
 * contract as conversational control: exactly 36 characters, RFC-compatible,
 * normalized to lowercase.
 */
declare function validatePrivilegedOperationId(value: unknown): string;

/**
 * Attention responses and task handoffs for the privileged authority tier.
 *
 * The five handoff states — proposed, pending, completed, rejected, failed —
 * are kept strictly distinct: a handoff moves through the declared
 * transition map only, and terminal states accept no further transitions.
 * Attention responses carry a bounded note at most; no free-form payload
 * flows through this surface.
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `conversations:write` and
 * `tasks:write` pairing scopes but no attention or task operations and no
 * such capability families, so no transport binding or route path ships;
 * every call reports `unsupported_operation` until the producer contract
 * lands and `pnpm sync:contracts` imports it. The transition map below is
 * the SDK-owned request model; Cave owns the authoritative state machine
 * and revalidates every transition server-side.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
declare const CAVE_TASK_HANDOFF_STATES: readonly ["proposed", "pending", "completed", "rejected", "failed"];
type CaveTaskHandoffState = (typeof CAVE_TASK_HANDOFF_STATES)[number];
/**
 * The declared transition map. Every state is distinct; `completed`,
 * `rejected`, and `failed` are terminal.
 */
declare const CAVE_TASK_HANDOFF_TRANSITIONS: Readonly<Record<CaveTaskHandoffState, readonly CaveTaskHandoffState[]>>;
declare const CAVE_ATTENTION_RESPONSE_KINDS: readonly ["acknowledge", "decline"];
type CaveAttentionResponseKind = (typeof CAVE_ATTENTION_RESPONSE_KINDS)[number];
interface CaveTaskHandoffRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly handoffId: string;
    /** The state the handoff is known to be in. */
    readonly from: CaveTaskHandoffState;
    /** The requested next state; must be a legal transition from `from`. */
    readonly to: CaveTaskHandoffState;
}
interface CaveAttentionResponseRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly attentionId: string;
    readonly response: CaveAttentionResponseKind;
    readonly note?: string;
}
/**
 * Whether the declared model permits a handoff transition. Terminal states
 * transition to nothing; `proposed` only advances to `pending`.
 */
declare function isCaveTaskHandoffTransition(from: CaveTaskHandoffState, to: CaveTaskHandoffState): boolean;
/**
 * Parse one task-handoff request. The transition must be legal under the
 * declared map, and the five states remain strictly distinct: an unknown
 * state or a skipped transition is a configuration error before any
 * capability or transport work.
 */
declare function parseCaveTaskHandoffRequest(value: unknown): CaveTaskHandoffRequest;
/**
 * Parse one attention-response request. The response kind is a closed union
 * and the optional note is bounded; nothing else can be sent.
 */
declare function parseCaveAttentionResponseRequest(value: unknown): CaveAttentionResponseRequest;

/**
 * Explicitly confirmed GitHub actions for the privileged authority tier.
 *
 * The curated action union is deliberately EMPTY: the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `github:write` pairing scope but
 * no GitHub operation and no GitHub capability family, and no reviewed
 * producer contract has curated which GitHub actions exist. Naming concrete
 * action kinds here would fabricate a curation nobody reviewed, so the union
 * ships closed (`CaveGitHubActionKind` is `never`) and every request is
 * rejected before any capability or transport work — fail closed by
 * construction. When the upstream Cave producer contract curates the union,
 * `CAVE_GITHUB_ACTION_KINDS` gains its reviewed members and this module's
 * validation machinery (exact confirmation, operation-UUID idempotency,
 * bounded input) applies unchanged.
 *
 * Cave revalidates confirmation, scope, repository/project grant, and input
 * bounds regardless of client confirmation.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
/**
 * The curated GitHub action union. Typed `readonly never[]` so that the
 * kind type itself is uninhabitable — fail closed at the type level. Empty
 * pending the upstream producer contract; never extended by client-side
 * guesswork.
 */
declare const CAVE_GITHUB_ACTION_KINDS: readonly never[];
type CaveGitHubActionKind = (typeof CAVE_GITHUB_ACTION_KINDS)[number];
/**
 * The shape every confirmed GitHub action request will take once the union
 * is curated. With the union empty, `action` is uninhabitable and no request
 * can be constructed — the type system itself refuses the mutation.
 */
interface CaveGitHubActionRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly action: CaveGitHubActionKind;
    /** Bounded string-valued action input; structure owned by the union member. */
    readonly input: Readonly<Record<string, string>>;
}
/**
 * Parse one confirmed GitHub action request. Confirmation, the operation
 * UUID, and the bounded shape are validated first; the action kind is then
 * checked against the curated union, which is empty today, so every kind is
 * rejected with the precise upstream gap — before any capability resolution
 * or transport dispatch, guaranteeing zero domain mutation.
 */
declare function parseCaveGitHubActionRequest(value: unknown): CaveGitHubActionRequest;

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
     * Conversational control is optional for every transport. The five Client
     * v1 conversation-operation routes are not yet declared by the
     * authoritative Cave contract fixture this SDK vendors, so no transport
     * binds them today; the client reports a missing one as
     * `unsupported_operation` rather than inventing a route. Results are
     * `unknown` at this trust boundary and are validated by the client.
     */
    createConversation?(request: CaveCreateConversationRequest, context?: OperationContext): Promise<unknown>;
    sendConversationMessage?(conversationId: string, request: CaveSendConversationMessageRequest, context?: OperationContext): Promise<unknown>;
    getConversationOperation?(operationId: CaveConversationOperationId, context?: OperationContext): Promise<unknown>;
    readConversationOperationEvents?(operationId: CaveConversationOperationId, page: CaveConversationEventPageRequest, context?: OperationContext): Promise<unknown>;
    stopConversationOperation?(operationId: CaveConversationOperationId, context?: OperationContext): Promise<unknown>;
    /**
     * Privileged authority is optional for every transport. The attachment,
     * attention, task-handoff, and GitHub action operations are not declared
     * by the authoritative Cave contract fixture this SDK vendors, so no
     * transport binds them today; the client gates every privileged call on
     * the capability registry first and reports `unsupported_operation`
     * rather than inventing a route. Results are `unknown` at this trust
     * boundary and are validated by the client.
     */
    uploadAttachment?(request: CaveAttachmentUploadRequest, context?: OperationContext): Promise<unknown>;
    downloadAttachment?(request: CaveAttachmentDownloadRequest, context?: OperationContext): Promise<unknown>;
    respondToAttention?(request: CaveAttentionResponseRequest, context?: OperationContext): Promise<unknown>;
    requestTaskHandoff?(request: CaveTaskHandoffRequest, context?: OperationContext): Promise<unknown>;
    submitGitHubAction?(request: CaveGitHubActionRequest, context?: OperationContext): Promise<unknown>;
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
    /**
     * Capability registry for the privileged authority tiers. Defaults to the
     * registry derived from the pinned contract fixture, under which every
     * privileged action class resolves `undeclared`.
     */
    capabilities?: CaveCapabilityRegistry;
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
    /**
     * The caller-visible operation UUID for a conversation mutation or stream,
     * attached once the validated operation ID has been accepted by the SDK.
     * Undefined for errors raised before acceptance and for non-conversation
     * operations. Carries fixed metadata only.
     */
    get operationId(): string | undefined;
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
    /**
     * Canonical conversation creation. Accepts only the operation UUID, one
     * canonical familiar ID, and an optional canonical project ID; Cave owns
     * every other decision. Create does not start an executor and does not
     * open an event stream.
     */
    createConversation(request: CaveCreateConversationRequest, options?: OperationOptions): Promise<CaveCreateConversationResult>;
    /**
     * One text send, or one explicit retry when the request carries
     * `retryOfTurnId`. The response is an acceptance/result envelope, not the
     * output stream; attach with `streamConversationOperation`. The exact text
     * is preserved byte for byte. An identical completed send replays Cave's
     * recorded result; the SDK never replays one on its own.
     */
    sendConversationMessage(conversationId: string, request: CaveSendConversationMessageRequest, options?: OperationOptions): Promise<CaveSendConversationMessageResult>;
    /**
     * Typed convenience over `messages.send` for retrying an explicitly failed
     * or cancelled assistant turn. It uses a fresh operation UUID and the
     * explicit `retryOfTurnId`; it introduces no second producer route.
     */
    retryConversationTurn(conversationId: string, request: CaveRetryConversationTurnRequest, options?: OperationOptions): Promise<CaveSendConversationMessageResult>;
    /**
     * The non-content operation record: fixed codes, turn references, event
     * bounds, and timestamps. Prompt, attachment, bearer, and raw-cause
     * content never appear here.
     */
    getConversationOperation(operationId: string, options?: OperationOptions): Promise<CaveConversationOperation>;
    /**
     * The typed, resumable event stream for one conversation operation.
     *
     * `options.timeoutMs` is one total stream budget; each long poll receives
     * only the remaining budget. A caller abort closes the current event read
     * and this generator: it never calls Stop and never resubmits a send.
     * Initial attachment and every resumed page pass through the same event
     * translator, which suppresses duplicates at or below the accepted cursor
     * and refuses protocol violations. `reconcile_required` is an instruction
     * to reload canonical history, not a retry.
     */
    streamConversationOperation(operationId: string, options?: CaveConversationStreamOptions): AsyncGenerator<CaveConversationEvent>;
    /**
     * Explicit Stop for one conversation operation. Repeated Stop calls are
     * safe against the target operation; this client sends each Stop exactly
     * once and never retries it after ambiguous transport completion.
     */
    stopConversationOperation(operationId: string, options?: OperationOptions): Promise<CaveConversationOperation>;
    /**
     * Bounded attachment upload. The request is validated fail closed (file
     * count, size, request size, MIME/signature agreement, filename, symlink,
     * and the atomic uploader-credential-plus-conversation binding) before any
     * capability or transport work, so a validation rejection performs zero
     * domain mutation. Under the pinned contract the attachment capability is
     * undeclared and this reports `unsupported_operation`.
     */
    uploadAttachment(request: CaveAttachmentUploadRequest, options?: OperationOptions): Promise<CaveAttachmentRecord>;
    /**
     * Bounded attachment download. The request carries the byte ceiling; the
     * canonical record is the validated result metadata. Under the pinned
     * contract this reports `unsupported_operation` before any transport work.
     */
    downloadAttachment(request: CaveAttachmentDownloadRequest, options?: OperationOptions): Promise<CaveAttachmentRecord>;
    /**
     * One attention response with a closed response-kind union and a bounded
     * optional note. Validation failure performs zero domain mutation; under
     * the pinned contract the attention capability is undeclared and this
     * reports `unsupported_operation`.
     */
    respondToAttention(request: CaveAttentionResponseRequest, options?: OperationOptions): Promise<void>;
    /**
     * One task-handoff transition. The declared transition map keeps
     * proposed, pending, completed, rejected, and failed strictly distinct;
     * an illegal or skipped transition is a configuration error before any
     * capability or transport work. Under the pinned contract this reports
     * `unsupported_operation`.
     */
    requestTaskHandoff(request: CaveTaskHandoffRequest, options?: OperationOptions): Promise<void>;
    /**
     * One explicitly confirmed GitHub action. The curated action union is
     * empty under the pinned contract, so every request is rejected during
     * request parsing — before any capability or transport work — and zero
     * domain mutation is possible. When the upstream producer contract
     * curates the union, the confirmed request flows through the capability
     * gate to Cave, which revalidates confirmation, scope, grant, and bounds.
     */
    submitGitHubAction(request: CaveGitHubActionRequest, options?: OperationOptions): Promise<void>;
}
declare function createCaveClient(options: CaveClientOptions): CaveClient;

export { type CaveContractViolation as $, CaveAttachmentSchemaError as A, type CaveAttachmentUploadRequest as B, type CavePairingRequest as C, type CaveAttentionResponseKind as D, type CaveAttentionResponseRequest as E, type CaveAuthorityBinding as F, type CaveAuthorityBoundPairingExchange as G, type CaveCanonicalFamiliar as H, type CaveCapabilityContractSource as I, type CaveCapabilityRegistry as J, type CaveCapabilityResolution as K, type CaveCapabilityStatus as L, CaveClientError as M, type CaveClientOptions as N, type CaveContractCursor as O, type CaveContractEnvelopeMetadata as P, type CaveContractFile as Q, type CaveContractFixture as R, type CaveContractHealthData as S, type CaveContractIdentity as T, type CaveContractOperation as U, type CaveContractPairingCreatedData as V, type CaveContractPairingExchangeData as W, type CaveContractPairingStatusData as X, type CaveContractPublicRoute as Y, type CaveContractReport as Z, type CaveContractRevision as _, CaveClient as a, type CaveTaskHandoffRequest as a$, type CaveConversation as a0, type CaveConversationEvent as a1, type CaveConversationEventBase as a2, type CaveConversationEventPage as a3, type CaveConversationEventPageRequest as a4, type CaveConversationEventTranslator as a5, type CaveConversationEventType as a6, type CaveConversationMessage as a7, type CaveConversationOperation as a8, type CaveConversationOperationId as a9, type CaveFamiliarProperty as aA, type CaveFamiliarWire as aB, type CaveFamiliarsResponse as aC, type CaveGitHubActionKind as aD, type CaveGitHubActionRequest as aE, type CaveHealth as aF, type CaveHealthData as aG, type CaveHealthResponse as aH, type CaveManagedCredentialStatusResult as aI, type CaveManagedCredentialTransport as aJ, type CaveManagedForgetCredentialResult as aK, type CaveManagedNativeCredentialCustody as aL, type CaveManagedPairingCreated as aM, type CaveManagedPairingExchange as aN, type CavePairingCreated as aO, type CavePairingExchange as aP, type CavePairingScope as aQ, CavePairingSession as aR, type CavePairingState as aS, type CavePairingStatus as aT, type CavePrivilegedActionClass as aU, type CavePrivilegedActionRequirement as aV, type CaveProject as aW, type CavePropertyCoverage as aX, type CaveRetryConversationTurnRequest as aY, type CaveSendConversationMessageRequest as aZ, type CaveSendConversationMessageResult as a_, type CaveConversationOperationKind as aa, type CaveConversationOperationState as ab, type CaveConversationOriginatingScope as ac, type CaveConversationReconcileReason as ad, type CaveConversationStreamOptions as ae, type CaveConversationTranslatedPage as af, type CaveCreateConversationRequest as ag, type CaveCreateConversationResult as ah, type CaveCredentialAccess as ai, type CaveCredentialBinding as aj, type CaveCredentialDisconnectedReason as ak, type CaveCredentialMetadata as al, type CaveCredentialPersistingTransport as am, type CaveCredentialStatus as an, type CaveDeclaredOperationRef as ao, type CaveExecutionAttempt as ap, type CaveExecutionBackfill as aq, type CaveExecutionCoverage as ar, type CaveExecutionSlice as as, type CaveExecutionWindow as at, type CaveFamiliar as au, type CaveFamiliarAnalytics as av, type CaveFamiliarAnalyticsOptions as aw, type CaveFamiliarAnalyticsResponse as ax, type CaveFamiliarContract as ay, type CaveFamiliarContractResponse as az, CAVE_ANALYTICS_WINDOWS as b, type CaveTaskHandoffState as b0, type CaveTransport as b1, bindCaveAttachments as b2, caveConversationReconcileReason as b3, createCaveCapabilityRegistry as b4, createCaveClient as b5, createConversationEventTranslator as b6, createDefaultCaveCapabilityRegistry as b7, digestCaveContractFixture as b8, isCaveClientError as b9, isCaveTaskHandoffTransition as ba, normalizeCaveError as bb, parseCaveAttachmentDownloadRequest as bc, parseCaveAttachmentRecord as bd, parseCaveAttachmentUploadRequest as be, parseCaveAttentionResponseRequest as bf, parseCaveContractFixture as bg, parseCaveGitHubActionRequest as bh, parseCaveTaskHandoffRequest as bi, parsePrivilegedConfirmation as bj, parseVerifiedCaveContractFixture as bk, sniffCaveAttachmentContentType as bl, validateConversationEventCursor as bm, validatePrivilegedOperationId as bn, verifyCaveContractFixtureDigest as bo, CAVE_ATTACHMENT_CONTENT_TYPES as c, CAVE_ATTACHMENT_LIMITS as d, CAVE_ATTENTION_RESPONSE_KINDS as e, CAVE_CONVERSATION_EVENT_TYPES as f, CAVE_CONVERSATION_OPERATION_STATES as g, CAVE_CONVERSATION_ORIGINATING_SCOPES as h, CAVE_CONVERSATION_RECONCILE_REASONS as i, CAVE_CONVERSATION_TERMINAL_STATES as j, CAVE_DEFAULT_CAPABILITY_CONTRACT as k, CAVE_FAMILIAR_PROPERTIES as l, CAVE_GITHUB_ACTION_KINDS as m, CAVE_PAIRING_SCOPES as n, CAVE_PAIRING_STATUSES as o, CAVE_PRIVILEGED_ACTION_CLASSES as p, CAVE_PRIVILEGED_ACTION_REQUIREMENTS as q, CAVE_TASK_HANDOFF_STATES as r, CAVE_TASK_HANDOFF_TRANSITIONS as s, type CaveAnalyticsWindowKey as t, type CaveAttachmentBinding as u, type CaveAttachmentContent as v, type CaveAttachmentContentType as w, type CaveAttachmentDescriptor as x, type CaveAttachmentDownloadRequest as y, type CaveAttachmentRecord as z };
// Entrypoint: .
// Declaration: dist/index.d.ts
import { C as CavePairingRequest, a as CaveClient } from './client-M2RrMRyI.js';
export { b as CAVE_ANALYTICS_WINDOWS, c as CAVE_ATTACHMENT_CONTENT_TYPES, d as CAVE_ATTACHMENT_LIMITS, e as CAVE_ATTENTION_RESPONSE_KINDS, f as CAVE_CONVERSATION_EVENT_TYPES, g as CAVE_CONVERSATION_OPERATION_STATES, h as CAVE_CONVERSATION_ORIGINATING_SCOPES, i as CAVE_CONVERSATION_RECONCILE_REASONS, j as CAVE_CONVERSATION_TERMINAL_STATES, k as CAVE_DEFAULT_CAPABILITY_CONTRACT, l as CAVE_FAMILIAR_PROPERTIES, m as CAVE_GITHUB_ACTION_KINDS, n as CAVE_PAIRING_SCOPES, o as CAVE_PAIRING_STATUSES, p as CAVE_PRIVILEGED_ACTION_CLASSES, q as CAVE_PRIVILEGED_ACTION_REQUIREMENTS, r as CAVE_TASK_HANDOFF_STATES, s as CAVE_TASK_HANDOFF_TRANSITIONS, t as CaveAnalyticsWindowKey, u as CaveAttachmentBinding, v as CaveAttachmentContent, w as CaveAttachmentContentType, x as CaveAttachmentDescriptor, y as CaveAttachmentDownloadRequest, z as CaveAttachmentRecord, A as CaveAttachmentSchemaError, B as CaveAttachmentUploadRequest, D as CaveAttentionResponseKind, E as CaveAttentionResponseRequest, F as CaveAuthorityBinding, G as CaveAuthorityBoundPairingExchange, H as CaveCanonicalFamiliar, I as CaveCapabilityContractSource, J as CaveCapabilityRegistry, K as CaveCapabilityResolution, L as CaveCapabilityStatus, M as CaveClientError, N as CaveClientOptions, O as CaveContractCursor, P as CaveContractEnvelopeMetadata, Q as CaveContractFile, R as CaveContractFixture, S as CaveContractHealthData, T as CaveContractIdentity, U as CaveContractOperation, V as CaveContractPairingCreatedData, W as CaveContractPairingExchangeData, X as CaveContractPairingStatusData, Y as CaveContractPublicRoute, Z as CaveContractReport, _ as CaveContractRevision, $ as CaveContractViolation, a0 as CaveConversation, a1 as CaveConversationEvent, a2 as CaveConversationEventBase, a3 as CaveConversationEventPage, a4 as CaveConversationEventPageRequest, a5 as CaveConversationEventTranslator, a6 as CaveConversationEventType, a7 as CaveConversationMessage, a8 as CaveConversationOperation, a9 as CaveConversationOperationId, aa as CaveConversationOperationKind, ab as CaveConversationOperationState, ac as CaveConversationOriginatingScope, ad as CaveConversationReconcileReason, ae as CaveConversationStreamOptions, af as CaveConversationTranslatedPage, ag as CaveCreateConversationRequest, ah as CaveCreateConversationResult, ai as CaveCredentialAccess, aj as CaveCredentialBinding, ak as CaveCredentialDisconnectedReason, al as CaveCredentialMetadata, am as CaveCredentialPersistingTransport, an as CaveCredentialStatus, ao as CaveDeclaredOperationRef, ap as CaveExecutionAttempt, aq as CaveExecutionBackfill, ar as CaveExecutionCoverage, as as CaveExecutionSlice, at as CaveExecutionWindow, au as CaveFamiliar, av as CaveFamiliarAnalytics, aw as CaveFamiliarAnalyticsOptions, ax as CaveFamiliarAnalyticsResponse, ay as CaveFamiliarContract, az as CaveFamiliarContractResponse, aA as CaveFamiliarProperty, aB as CaveFamiliarWire, aC as CaveFamiliarsResponse, aD as CaveGitHubActionKind, aE as CaveGitHubActionRequest, aF as CaveHealth, aG as CaveHealthData, aH as CaveHealthResponse, aI as CaveManagedCredentialStatusResult, aJ as CaveManagedCredentialTransport, aK as CaveManagedForgetCredentialResult, aL as CaveManagedNativeCredentialCustody, aM as CaveManagedPairingCreated, aN as CaveManagedPairingExchange, aO as CavePairingCreated, aP as CavePairingExchange, aQ as CavePairingScope, aR as CavePairingSession, aS as CavePairingState, aT as CavePairingStatus, aU as CavePrivilegedActionClass, aV as CavePrivilegedActionRequirement, aW as CaveProject, aX as CavePropertyCoverage, aY as CaveRetryConversationTurnRequest, aZ as CaveSendConversationMessageRequest, a_ as CaveSendConversationMessageResult, a$ as CaveTaskHandoffRequest, b0 as CaveTaskHandoffState, b1 as CaveTransport, b2 as bindCaveAttachments, b3 as caveConversationReconcileReason, b4 as createCaveCapabilityRegistry, b5 as createCaveClient, b6 as createConversationEventTranslator, b7 as createDefaultCaveCapabilityRegistry, b8 as digestCaveContractFixture, b9 as isCaveClientError, ba as isCaveTaskHandoffTransition, bb as normalizeCaveError, bc as parseCaveAttachmentDownloadRequest, bd as parseCaveAttachmentRecord, be as parseCaveAttachmentUploadRequest, bf as parseCaveAttentionResponseRequest, bg as parseCaveContractFixture, bh as parseCaveGitHubActionRequest, bi as parseCaveTaskHandoffRequest, bj as parsePrivilegedConfirmation, bk as parseVerifiedCaveContractFixture, bl as sniffCaveAttachmentContentType, bm as validateConversationEventCursor, bn as validatePrivilegedOperationId, bo as verifyCaveContractFixtureDigest } from './client-M2RrMRyI.js';
import { OperationOptions, OperationContext, PageOptions, OperationDefaults, SecretStore, SecretStoreReference } from '@opencoven/sdk-core';
import '@opencoven/sdk-core/browser';

declare const CAVE_HPKE_MECHANISM: "hpke-bound-v1";
declare const CAVE_HPKE_SUITE: Readonly<{
    readonly kemId: 32;
    readonly kdfId: 1;
    readonly aeadId: 2;
}>;
type CaveDiscoveryErrorCode = 'not_found' | 'owner_mismatch' | 'unsafe_endpoint' | 'stale_record' | 'body_limit' | 'invalid_response' | 'timeout' | 'aborted';
interface CaveHpkeAuthority {
    mechanism: typeof CAVE_HPKE_MECHANISM;
    mode: 'advertise' | 'enforce';
    keyId: string;
    publicKey: string;
    suite: typeof CAVE_HPKE_SUITE;
}
declare class CaveDiscoveryError extends Error {
    readonly code: CaveDiscoveryErrorCode;
    readonly retryable: boolean;
    constructor(code: CaveDiscoveryErrorCode, message: string);
}
declare function isCaveDiscoveryError(error: unknown): error is CaveDiscoveryError;

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
interface CaveDiscoveredEndpointBase {
    endpoint: {
        kind: 'http';
        url: string;
    };
    freshness: CaveEndpointFreshness;
    record: CaveDiscoveryRecordIdentity;
}
interface CaveDiscoveredEndpointV1 extends CaveDiscoveredEndpointBase {
    version: 1;
}
interface CaveDiscoveredEndpointV2 extends CaveDiscoveredEndpointBase {
    version: 2;
    authority: CaveHpkeAuthority;
}
type CaveDiscoveredEndpoint = CaveDiscoveredEndpointV1 | CaveDiscoveredEndpointV2;
declare function discoverCaveEndpoint(options?: DiscoverCaveEndpointOptions): Promise<CaveDiscoveredEndpoint>;

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

/**
 * Passive rich content: a strict, non-executable AST for message payloads.
 *
 * The parser accepts only the closed node vocabulary below, with exact keys
 * and bounded sizes. Raw HTML is never interpreted: markup-looking text is
 * preserved byte for byte inside inert text nodes, there is no HTML node
 * type, and no node carries event handlers or executable attributes. Link
 * targets are restricted to `https:` and `mailto:` schemes, so no unsafe
 * target can be produced from a parsed document. Unknown node types,
 * unknown fields, oversized payloads, and over-deep nesting are rejected
 * (fail closed).
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares no rich-content capability family
 * and no route that would carry rich payloads. This module defines the
 * SDK-side consumer half — the parsing and validation model — so that the
 * deferred producer contract can only ever deliver inert content through
 * it. The node vocabulary is SDK-owned and closed; extending it requires a
 * reviewed change here, not data from the wire.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
declare const CAVE_RICH_CONTENT_LIMITS: Readonly<{
    /** Maximum total nodes in one document. */
    maxNodes: 512;
    /** Maximum nesting depth (the document itself is depth 0). */
    maxDepth: 24;
    /** Maximum characters in one text or code node. */
    maxTextCharacters: 8192;
    /** Maximum characters across all text and code nodes of one document. */
    maxTotalCharacters: 65536;
    /** Maximum characters in one link target. */
    maxUrlCharacters: 2048;
    /** Maximum characters in one code language tag. */
    maxLanguageCharacters: 32;
    /** Maximum characters in one link title. */
    maxTitleCharacters: 256;
}>;
type CaveRichContentUrlScheme = 'https' | 'mailto';
declare const CAVE_RICH_CONTENT_URL_SCHEMES: readonly CaveRichContentUrlScheme[];
interface CaveRichContentText {
    readonly type: 'text';
    readonly text: string;
}
interface CaveRichContentCode {
    readonly type: 'code';
    readonly text: string;
}
interface CaveRichContentLineBreak {
    readonly type: 'lineBreak';
}
interface CaveRichContentLink {
    readonly type: 'link';
    /** Always an `https:` or `mailto:` target; everything else is rejected. */
    readonly href: string;
    readonly title?: string;
    readonly children: readonly (CaveRichContentText | CaveRichContentCode | CaveRichContentLineBreak)[];
}
type CaveRichContentInline = CaveRichContentText | CaveRichContentCode | CaveRichContentLink | CaveRichContentLineBreak;
interface CaveRichContentParagraph {
    readonly type: 'paragraph';
    readonly children: readonly CaveRichContentInline[];
}
interface CaveRichContentHeading {
    readonly type: 'heading';
    readonly level: 1 | 2 | 3 | 4 | 5 | 6;
    readonly children: readonly CaveRichContentInline[];
}
interface CaveRichContentCodeBlock {
    readonly type: 'codeBlock';
    readonly language?: string;
    readonly text: string;
}
interface CaveRichContentQuote {
    readonly type: 'blockquote';
    readonly children: readonly CaveRichContentBlock[];
}
interface CaveRichContentList {
    readonly type: 'list';
    readonly ordered: boolean;
    readonly children: readonly CaveRichContentListItem[];
}
interface CaveRichContentListItem {
    readonly type: 'listItem';
    readonly children: readonly CaveRichContentBlock[];
}
type CaveRichContentBlock = CaveRichContentParagraph | CaveRichContentHeading | CaveRichContentCodeBlock | CaveRichContentQuote | CaveRichContentList;
interface CaveRichContentDocument {
    readonly type: 'doc';
    readonly children: readonly CaveRichContentBlock[];
}
declare class CaveRichContentError extends TypeError {
    readonly field: string;
    constructor(field: string);
}
/**
 * Link targets must carry an `https:` or `mailto:` scheme. Every other
 * scheme — `javascript:`, `data:`, `file:`, `vbscript:`, scheme-less
 * relative targets — is rejected, so a parsed document can never carry an
 * unsafe target.
 */
declare function parseCaveRichContentUrl(value: unknown, field: string): string;
/**
 * Parse an untrusted rich-content payload into the strict inert AST. The
 * parser is total over its closed vocabulary: unknown node types, unknown
 * fields, executable markup declarations, unsafe link targets, oversized
 * payloads, and over-deep nesting are all rejected.
 */
declare function parseCaveRichContent(value: unknown): CaveRichContentDocument;
/**
 * Serialize a parsed document. Because the input type can only be produced
 * by `parseCaveRichContent`, the output is inert by construction: it
 * contains only the declared node types, never markup or event handlers.
 */
declare function serializeCaveRichContent(document: CaveRichContentDocument): string;
/**
 * Collect every link target of a parsed document. Every returned target has
 * already passed the `https:`/`mailto:` allowlist during parsing.
 */
declare function collectCaveRichContentUrls(document: CaveRichContentDocument): string[];

declare const CAVE_CLIENT_VERSION: string;

export { CAVE_CLIENT_VERSION, CAVE_RICH_CONTENT_LIMITS, CAVE_RICH_CONTENT_URL_SCHEMES, CaveClient, type CaveDiscoveredClientOptions, type CaveDiscoveredEndpoint, type CaveDiscoveryDependencies, CaveDiscoveryError, type CaveDiscoveryErrorCode, type CaveDiscoveryFileHandle, type CaveDiscoveryPathIdentity, type CaveDiscoveryRecordIdentity, type CaveEndpointFreshness, type CaveManagedClientOptions, type CaveManagedNativeDiscardResult, type CaveManagedNativePairingCreated, type CaveManagedNativePairingExchange, type CaveManagedNativeResponse, type CaveManagedNativeTransport, CavePairingRequest, type CaveRichContentBlock, type CaveRichContentDocument, CaveRichContentError, type CaveRichContentInline, type CaveRichContentUrlScheme, type CaveWindowsPathTrustResult, type CaveWindowsPathTrustValidator, type DiscoverCaveEndpointOptions, collectCaveRichContentUrls, createDiscoveredCaveClient, createManagedCaveClient, discoverCaveEndpoint, isCaveDiscoveryError, parseCaveRichContent, parseCaveRichContentUrl, serializeCaveRichContent };
// Entrypoint: ./managed
// Declaration: dist/client-M2RrMRyI.d.ts
import { OperationObserver, OperationContext, PageOptions, OperationDefaults, SecretStore, SecretStoreReference, OperationOptions, Page, BoundedPageOptions, NormalizedError, CompatibilityAssessment } from '@opencoven/sdk-core/browser';

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

/**
 * Conversational control: the first bounded mutation authority.
 *
 * Cave remains the sole executor and canonical state owner. The SDK exposes
 * constrained typed operations only — never arbitrary HTTP paths, private
 * Cave routes, or raw transport escape hatches — and owns the public DTOs,
 * validators, and the single event translator shared by initial and resumed
 * streams.
 *
 * The five Client v1 operations this surface is defined against
 * (`conversations.create`, `messages.send`, `operations.read`,
 * `operations.events`, `operations.stop`) are not yet declared by the
 * authoritative Cave contract fixture this SDK vendors. This module therefore
 * defines the typed requests, results, operation records, event vocabulary,
 * cursor handling, and translation rules only; it introduces no HTTP paths.
 * Transport bindings for the five operations stay optional and are expected
 * to arrive with the upstream Cave producer contract and a re-imported
 * fixture.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
type CaveConversationOperationId = string;
type CaveConversationEventCursor = string;
interface CaveCreateConversationRequest {
    operationId: CaveConversationOperationId;
    familiarId: string;
    projectId?: string;
}
type CaveSendConversationMessageRequest = {
    operationId: CaveConversationOperationId;
    text: string;
    retryOfTurnId?: never;
} | {
    operationId: CaveConversationOperationId;
    retryOfTurnId: string;
    text?: never;
};
interface CaveRetryConversationTurnRequest {
    operationId: CaveConversationOperationId;
    retryOfTurnId: string;
}
type CaveConversationOperationState = 'pending' | 'accepted' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled';
type CaveConversationOperationKind = 'conversations.create' | 'messages.send';
type CaveConversationOriginatingScope = 'chat:write' | 'conversations:write';
interface CaveConversationOperation {
    id: CaveConversationOperationId;
    kind: CaveConversationOperationKind;
    state: CaveConversationOperationState;
    originatingScope: CaveConversationOriginatingScope;
    conversationId: string;
    inputTurnId?: string;
    outputTurnId?: string;
    retryOfTurnId?: string;
    failureCode?: string;
    latestEventId: number;
    replayFloorEventId: number;
    createdAt: string;
    updatedAt: string;
    idempotencyResultExpiresAt?: string;
}
interface CaveCreateConversationResult {
    operationId: CaveConversationOperationId;
    replayed: boolean;
    conversation: CaveConversation;
}
interface CaveSendConversationMessageResult {
    operation: CaveConversationOperation;
    replayed: boolean;
}
interface CaveConversationEventBase {
    operationId: CaveConversationOperationId;
    eventId: number;
    cursor: CaveConversationEventCursor;
    occurredAt: string;
}
type CaveConversationEventType = 'operation.accepted' | 'assistant.delta' | 'operation.stopping' | 'operation.completed' | 'operation.failed' | 'operation.cancelled';
type CaveConversationEvent = (CaveConversationEventBase & {
    type: 'operation.accepted';
    conversationId: string;
    inputTurnId: string;
    retryOfTurnId?: string;
}) | (CaveConversationEventBase & {
    type: 'assistant.delta';
    text: string;
}) | (CaveConversationEventBase & {
    type: 'operation.stopping';
}) | (CaveConversationEventBase & {
    type: 'operation.completed';
    outputTurnId: string;
}) | (CaveConversationEventBase & {
    type: 'operation.failed';
    outputTurnId: string;
    code: string;
}) | (CaveConversationEventBase & {
    type: 'operation.cancelled';
    outputTurnId: string;
});
interface CaveConversationEventPage {
    operation: CaveConversationOperation;
    events: readonly CaveConversationEvent[];
    complete: boolean;
    cursor?: {
        current?: CaveConversationEventCursor;
        next?: CaveConversationEventCursor;
        hasMore: boolean;
    };
}
interface CaveConversationEventPageRequest {
    cursor?: CaveConversationEventCursor;
    waitMs?: number;
}
interface CaveConversationStreamOptions {
    cursor?: CaveConversationEventCursor;
    signal?: AbortSignal;
    timeoutMs?: number;
    observer?: OperationObserver;
}
declare const CAVE_CONVERSATION_OPERATION_STATES: readonly ["pending", "accepted", "running", "stopping", "completed", "failed", "cancelled"];
declare const CAVE_CONVERSATION_TERMINAL_STATES: readonly ["completed", "failed", "cancelled"];
declare const CAVE_CONVERSATION_EVENT_TYPES: readonly ["operation.accepted", "assistant.delta", "operation.stopping", "operation.completed", "operation.failed", "operation.cancelled"];
/** The scope stored with an operation when it was claimed; reads of the operation and its events are authorized by it. */
declare const CAVE_CONVERSATION_ORIGINATING_SCOPES: readonly ["chat:write", "conversations:write"];
/**
 * The defined `reconcile_required` reasons. A `reconcile_required` error is
 * an instruction to reload canonical state, not a transient transport retry.
 */
declare const CAVE_CONVERSATION_RECONCILE_REASONS: readonly ["replay_gap", "operation_expired", "canonical_branch_changed", "idempotency_result_expired", "canonical_state_moved"];
type CaveConversationReconcileReason = (typeof CAVE_CONVERSATION_RECONCILE_REASONS)[number];
/**
 * Event cursors are opaque route strings bounded by the authoritative
 * `cursorCharacters` limit. The SDK never decodes them.
 */
declare function validateConversationEventCursor(value: unknown, label: string): CaveConversationEventCursor;
interface CaveConversationTranslatedPage {
    operation: CaveConversationOperation;
    events: readonly CaveConversationEvent[];
    complete: boolean;
    requestId: string | undefined;
    nextCursor?: CaveConversationEventCursor;
}
interface CaveConversationEventTranslator {
    readonly operationId: CaveConversationOperationId;
    readonly deliveredThroughEventId: number;
    /**
     * Validate one raw event-page response and return the accepted events in
     * wire order. Throws a protocol error on any violation.
     */
    translate(page: unknown): CaveConversationTranslatedPage;
    /** Advance the accepted cursor after the event has been delivered. */
    commit(eventId: number): void;
}
interface CaveConversationEventTranslatorOptions {
    /**
     * True when this stream's first page resumes behind an opaque cursor from
     * an earlier generator run: the first accepted event then cannot be
     * gap-checked against a known event ID. A fresh stream must begin at
     * event 1.
     */
    resumeAfterOpaqueCursor?: boolean;
}
/**
 * The one parser/translator for conversation event pages. Initial attachment
 * and every resumed long poll pass through it.
 *
 * The translator validates the shared Client v1 envelope before event data,
 * validates the operation ID on every event, requires contiguous increasing
 * event IDs, suppresses an exact duplicate event at or below the caller's
 * accepted cursor, and refuses forward gaps, reordered events, changed
 * operation IDs, malformed terminal sequences, and events after terminal as
 * protocol violations. The resume cursor advances only when the caller
 * commits, after the corresponding event has been delivered.
 */
declare function createConversationEventTranslator(operationId: CaveConversationOperationId, options?: CaveConversationEventTranslatorOptions): CaveConversationEventTranslator;
/**
 * The defined `reconcile_required` reasons, read from normalized error
 * details without trusting the error shape.
 */
declare function caveConversationReconcileReason(error: unknown): CaveConversationReconcileReason | undefined;

/**
 * Bounded attachment transfer for the privileged authority tier.
 *
 * This module owns the SDK half of the attachment contract: fail-closed
 * preflight validation (file count, per-file size, total request size,
 * declared MIME type versus signature, filename, traversal, symlink, and
 * ownership binding) and the metadata-only records that bind an attachment
 * to its uploader credential and conversation atomically. Attachment bytes
 * exist only inside the in-flight upload request; they never enter the
 * canonical attachment record, and therefore never enter canonical
 * conversation JSON, browser storage, profile config, or diagnostic bundles.
 * The SDK never hashes attachment bytes: the canonical byte digest is
 * Cave's, computed server-side where the bytes land, and appears in records
 * only as a validated string.
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `attachments:write` pairing
 * scope but no attachment operations and no attachment capability family,
 * so no transport binding or route path ships; upload and download report
 * `unsupported_operation` until the producer contract lands and
 * `pnpm sync:contracts` imports it. Cave revalidates every limit, the
 * content signature, and the ownership binding server-side.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
declare const CAVE_ATTACHMENT_LIMITS: Readonly<{
    /** Maximum attachments in one upload request. */
    maxFiles: 10;
    /** Maximum byte size of one attachment. */
    maxFileBytes: number;
    /** Maximum summed byte size of one upload request. */
    maxRequestBytes: number;
    /** Maximum filename length in UTF-16 code units. */
    maxFilenameCharacters: 128;
    /** Maximum canonical identifier length for attachment/credential IDs. */
    maxReferenceCharacters: 64;
}>;
/**
 * The approved content-type allowlist. SVG, archive, and executable types
 * are forbidden by the issue's non-goals and are not present.
 */
declare const CAVE_ATTACHMENT_CONTENT_TYPES: readonly ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];
type CaveAttachmentContentType = (typeof CAVE_ATTACHMENT_CONTENT_TYPES)[number];
declare class CaveAttachmentSchemaError extends TypeError {
    readonly field: string;
    constructor(field: string);
}
/**
 * Signature-sniff the declared content type from the leading bytes. Returns
 * the matched allowlisted type, `'text/plain'` when the bytes decode as
 * UTF-8 text without binary markers, or `undefined` when nothing matches.
 * A declared binary type whose bytes do not carry its signature is never
 * accepted.
 */
declare function sniffCaveAttachmentContentType(content: Uint8Array): CaveAttachmentContentType | undefined;
interface CaveAttachmentContent {
    readonly filename: string;
    readonly contentType: CaveAttachmentContentType;
    readonly content: Uint8Array;
    readonly symlink?: false;
}
interface CaveAttachmentDescriptor {
    readonly filename: string;
    readonly contentType: CaveAttachmentContentType;
    readonly sizeBytes: number;
}
interface CaveAttachmentBinding {
    readonly conversationId: string;
    readonly uploaderCredentialId: string;
    readonly attachments: readonly CaveAttachmentDescriptor[];
    readonly totalBytes: number;
}
interface CaveAttachmentUploadRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly uploaderCredentialId: string;
    readonly attachments: readonly CaveAttachmentContent[];
}
interface CaveAttachmentDownloadRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly attachmentId: string;
    /** Optional ceiling; the parser defaults it to `maxFileBytes`. */
    readonly maxBytes?: number;
}
/**
 * The canonical attachment record: metadata bound to its conversation and
 * uploader credential. There is no byte field on this type by construction —
 * attachment bytes never enter canonical conversation JSON.
 */
interface CaveAttachmentRecord {
    readonly attachmentId: string;
    readonly conversationId: string;
    readonly uploaderCredentialId: string;
    readonly filename: string;
    readonly contentType: CaveAttachmentContentType;
    readonly sizeBytes: number;
    readonly digestSha256: string;
}
/**
 * Bind validated attachments to their conversation and uploader credential
 * atomically: every input is validated before any descriptor is produced,
 * so a rejection leaves no partial binding. The binding is metadata-only.
 */
declare function bindCaveAttachments(conversationId: unknown, uploaderCredentialId: unknown, attachments: readonly unknown[]): CaveAttachmentBinding;
/**
 * Parse and fully validate one attachment upload request. Validation is
 * fail-closed and total: any malformed field rejects the whole request, and
 * the caller performs zero transport work on rejection.
 */
declare function parseCaveAttachmentUploadRequest(value: unknown): CaveAttachmentUploadRequest;
/**
 * Parse one bounded attachment download request. The byte ceiling is
 * mandatory in effect: when omitted it defaults to `maxFileBytes`, and a
 * larger value is rejected.
 */
declare function parseCaveAttachmentDownloadRequest(value: unknown): CaveAttachmentDownloadRequest;
/**
 * Parse a canonical attachment record from a transport response. Exact keys:
 * a record carrying a `content` (or any unknown) field is rejected, so bytes
 * cannot re-enter canonical state through the record type.
 */
declare function parseCaveAttachmentRecord(value: unknown): CaveAttachmentRecord;

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

/**
 * Privileged authority capabilities for the attachment, rich-content,
 * attention, task-handoff, and GitHub action tiers.
 *
 * Every privileged action class is gated by a capability resolution derived
 * from the authoritative Cave contract fixture this SDK vendors: an action
 * class is actionable only when the contract declares at least one operation
 * carrying the required scope. The pinned fixture (Cave `4adc97b1`) declares
 * the privileged scope names for pairing (`attachments:write`, `tasks:write`,
 * `github:write`, `chat:write`, `conversations:write`) but declares no
 * operation that uses them, so every privileged resolution is `undeclared`
 * today and the client reports `unsupported_operation` before any transport
 * dispatch. Nothing here invents routes, capability families, or scope names:
 * scope identifiers come from the fixture's pairing-scope list, and declared
 * operations come from the fixture's operation table.
 *
 * Resolutions are computed per call from the consulted contract data and
 * returned as frozen descriptors. No capability object is cached across
 * grants: Cave remains the sole authority for grants, confirmation
 * revalidation, idempotency, audit, and domain mutation.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
type CavePrivilegedActionClass = 'attachment-transfer' | 'rich-content' | 'attention-response' | 'task-handoff' | 'github-action';
declare const CAVE_PRIVILEGED_ACTION_CLASSES: readonly ["attachment-transfer", "rich-content", "attention-response", "task-handoff", "github-action"];
interface CavePrivilegedActionRequirement {
    readonly actionClass: CavePrivilegedActionClass;
    /** Drawn only from the fixture-declared pairing scope vocabulary. */
    readonly requiredScope: CavePairingScope;
    /** Every privileged action requires a direct, explicit confirmation. */
    readonly requiresConfirmation: true;
    /** Idempotency is keyed by the caller-supplied 36-character operation UUID. */
    readonly idempotencyKey: 'operation-uuid';
}
/**
 * The SDK-declared requirement mapping. Scope identifiers are the pairing
 * scopes the authoritative fixture declares; the authoritative grant mapping
 * is Cave's and is revalidated server-side regardless of these values.
 */
declare const CAVE_PRIVILEGED_ACTION_REQUIREMENTS: Readonly<Record<CavePrivilegedActionClass, CavePrivilegedActionRequirement>>;
interface CaveDeclaredOperationRef {
    readonly id: string;
    readonly method: string;
    readonly path: string;
    readonly scope: string | null;
}
type CaveCapabilityStatus = 'declared' | 'undeclared';
interface CaveCapabilityResolution {
    readonly actionClass: CavePrivilegedActionClass;
    readonly status: CaveCapabilityStatus;
    readonly requirement: CavePrivilegedActionRequirement;
    /**
     * The capability families the consulted contract declares. The pinned
     * fixture declares none of the privileged families.
     */
    readonly declaredCapabilities: readonly string[];
    /**
     * The operations the consulted contract declares with the required scope.
     * Empty for every privileged class under the pinned fixture.
     */
    readonly declaredOperations: readonly CaveDeclaredOperationRef[];
}
interface CaveCapabilityRegistry {
    resolve(actionClass: CavePrivilegedActionClass): CaveCapabilityResolution;
}
interface CaveCapabilityContractSource {
    readonly capabilities: readonly string[];
    readonly operations: readonly CaveContractOperation[];
}
/**
 * Build a capability registry from a parsed (preferably digest-verified)
 * Client v1 contract fixture. Resolution consults the operation table on
 * every call: an action class is `declared` only when the contract declares
 * at least one operation carrying the required scope.
 */
declare function createCaveCapabilityRegistry(contract: CaveCapabilityContractSource): CaveCapabilityRegistry;
/**
 * The default capability source: the operation table of the authoritative
 * fixture pinned at Cave `4adc97b1` (digest `b2694cd1…`). Tests assert this
 * snapshot matches the vendored fixture exactly, so a fixture re-import
 * forces a reviewed update here. Under this contract every privileged action
 * class resolves `undeclared`.
 */
declare const CAVE_DEFAULT_CAPABILITY_CONTRACT: CaveCapabilityContractSource;
/**
 * The default registry every `CaveClient` uses when no explicit registry is
 * supplied. Under the pinned fixture all privileged action classes resolve
 * `undeclared`.
 */
declare function createDefaultCaveCapabilityRegistry(): CaveCapabilityRegistry;
/**
 * A privileged action carries a direct, explicit confirmation: exactly one
 * `confirmed` field whose value is the literal `true`. Anything else — a
 * missing field, `false`, a string, a truthy object — is a configuration
 * error raised before any capability or transport work.
 */
declare function parsePrivilegedConfirmation(value: unknown): true;
/**
 * Privileged actions key idempotency with the same Client v1 operation UUID
 * contract as conversational control: exactly 36 characters, RFC-compatible,
 * normalized to lowercase.
 */
declare function validatePrivilegedOperationId(value: unknown): string;

/**
 * Attention responses and task handoffs for the privileged authority tier.
 *
 * The five handoff states — proposed, pending, completed, rejected, failed —
 * are kept strictly distinct: a handoff moves through the declared
 * transition map only, and terminal states accept no further transitions.
 * Attention responses carry a bounded note at most; no free-form payload
 * flows through this surface.
 *
 * Upstream-contract gap (stated, not invented): the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `conversations:write` and
 * `tasks:write` pairing scopes but no attention or task operations and no
 * such capability families, so no transport binding or route path ships;
 * every call reports `unsupported_operation` until the producer contract
 * lands and `pnpm sync:contracts` imports it. The transition map below is
 * the SDK-owned request model; Cave owns the authoritative state machine
 * and revalidates every transition server-side.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
declare const CAVE_TASK_HANDOFF_STATES: readonly ["proposed", "pending", "completed", "rejected", "failed"];
type CaveTaskHandoffState = (typeof CAVE_TASK_HANDOFF_STATES)[number];
/**
 * The declared transition map. Every state is distinct; `completed`,
 * `rejected`, and `failed` are terminal.
 */
declare const CAVE_TASK_HANDOFF_TRANSITIONS: Readonly<Record<CaveTaskHandoffState, readonly CaveTaskHandoffState[]>>;
declare const CAVE_ATTENTION_RESPONSE_KINDS: readonly ["acknowledge", "decline"];
type CaveAttentionResponseKind = (typeof CAVE_ATTENTION_RESPONSE_KINDS)[number];
interface CaveTaskHandoffRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly handoffId: string;
    /** The state the handoff is known to be in. */
    readonly from: CaveTaskHandoffState;
    /** The requested next state; must be a legal transition from `from`. */
    readonly to: CaveTaskHandoffState;
}
interface CaveAttentionResponseRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly attentionId: string;
    readonly response: CaveAttentionResponseKind;
    readonly note?: string;
}
/**
 * Whether the declared model permits a handoff transition. Terminal states
 * transition to nothing; `proposed` only advances to `pending`.
 */
declare function isCaveTaskHandoffTransition(from: CaveTaskHandoffState, to: CaveTaskHandoffState): boolean;
/**
 * Parse one task-handoff request. The transition must be legal under the
 * declared map, and the five states remain strictly distinct: an unknown
 * state or a skipped transition is a configuration error before any
 * capability or transport work.
 */
declare function parseCaveTaskHandoffRequest(value: unknown): CaveTaskHandoffRequest;
/**
 * Parse one attention-response request. The response kind is a closed union
 * and the optional note is bounded; nothing else can be sent.
 */
declare function parseCaveAttentionResponseRequest(value: unknown): CaveAttentionResponseRequest;

/**
 * Explicitly confirmed GitHub actions for the privileged authority tier.
 *
 * The curated action union is deliberately EMPTY: the authoritative Cave
 * fixture pinned at `4adc97b1` declares the `github:write` pairing scope but
 * no GitHub operation and no GitHub capability family, and no reviewed
 * producer contract has curated which GitHub actions exist. Naming concrete
 * action kinds here would fabricate a curation nobody reviewed, so the union
 * ships closed (`CaveGitHubActionKind` is `never`) and every request is
 * rejected before any capability or transport work — fail closed by
 * construction. When the upstream Cave producer contract curates the union,
 * `CAVE_GITHUB_ACTION_KINDS` gains its reviewed members and this module's
 * validation machinery (exact confirmation, operation-UUID idempotency,
 * bounded input) applies unchanged.
 *
 * Cave revalidates confirmation, scope, repository/project grant, and input
 * bounds regardless of client confirmation.
 *
 * This module is import-pure: no discovery, credential, filesystem, network,
 * or daemon I/O happens at import time.
 */
/**
 * The curated GitHub action union. Typed `readonly never[]` so that the
 * kind type itself is uninhabitable — fail closed at the type level. Empty
 * pending the upstream producer contract; never extended by client-side
 * guesswork.
 */
declare const CAVE_GITHUB_ACTION_KINDS: readonly never[];
type CaveGitHubActionKind = (typeof CAVE_GITHUB_ACTION_KINDS)[number];
/**
 * The shape every confirmed GitHub action request will take once the union
 * is curated. With the union empty, `action` is uninhabitable and no request
 * can be constructed — the type system itself refuses the mutation.
 */
interface CaveGitHubActionRequest {
    readonly operationId: string;
    readonly confirmed: true;
    readonly conversationId: string;
    readonly action: CaveGitHubActionKind;
    /** Bounded string-valued action input; structure owned by the union member. */
    readonly input: Readonly<Record<string, string>>;
}
/**
 * Parse one confirmed GitHub action request. Confirmation, the operation
 * UUID, and the bounded shape are validated first; the action kind is then
 * checked against the curated union, which is empty today, so every kind is
 * rejected with the precise upstream gap — before any capability resolution
 * or transport dispatch, guaranteeing zero domain mutation.
 */
declare function parseCaveGitHubActionRequest(value: unknown): CaveGitHubActionRequest;

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
     * Conversational control is optional for every transport. The five Client
     * v1 conversation-operation routes are not yet declared by the
     * authoritative Cave contract fixture this SDK vendors, so no transport
     * binds them today; the client reports a missing one as
     * `unsupported_operation` rather than inventing a route. Results are
     * `unknown` at this trust boundary and are validated by the client.
     */
    createConversation?(request: CaveCreateConversationRequest, context?: OperationContext): Promise<unknown>;
    sendConversationMessage?(conversationId: string, request: CaveSendConversationMessageRequest, context?: OperationContext): Promise<unknown>;
    getConversationOperation?(operationId: CaveConversationOperationId, context?: OperationContext): Promise<unknown>;
    readConversationOperationEvents?(operationId: CaveConversationOperationId, page: CaveConversationEventPageRequest, context?: OperationContext): Promise<unknown>;
    stopConversationOperation?(operationId: CaveConversationOperationId, context?: OperationContext): Promise<unknown>;
    /**
     * Privileged authority is optional for every transport. The attachment,
     * attention, task-handoff, and GitHub action operations are not declared
     * by the authoritative Cave contract fixture this SDK vendors, so no
     * transport binds them today; the client gates every privileged call on
     * the capability registry first and reports `unsupported_operation`
     * rather than inventing a route. Results are `unknown` at this trust
     * boundary and are validated by the client.
     */
    uploadAttachment?(request: CaveAttachmentUploadRequest, context?: OperationContext): Promise<unknown>;
    downloadAttachment?(request: CaveAttachmentDownloadRequest, context?: OperationContext): Promise<unknown>;
    respondToAttention?(request: CaveAttentionResponseRequest, context?: OperationContext): Promise<unknown>;
    requestTaskHandoff?(request: CaveTaskHandoffRequest, context?: OperationContext): Promise<unknown>;
    submitGitHubAction?(request: CaveGitHubActionRequest, context?: OperationContext): Promise<unknown>;
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
    /**
     * Capability registry for the privileged authority tiers. Defaults to the
     * registry derived from the pinned contract fixture, under which every
     * privileged action class resolves `undeclared`.
     */
    capabilities?: CaveCapabilityRegistry;
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
    /**
     * The caller-visible operation UUID for a conversation mutation or stream,
     * attached once the validated operation ID has been accepted by the SDK.
     * Undefined for errors raised before acceptance and for non-conversation
     * operations. Carries fixed metadata only.
     */
    get operationId(): string | undefined;
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
    /**
     * Canonical conversation creation. Accepts only the operation UUID, one
     * canonical familiar ID, and an optional canonical project ID; Cave owns
     * every other decision. Create does not start an executor and does not
     * open an event stream.
     */
    createConversation(request: CaveCreateConversationRequest, options?: OperationOptions): Promise<CaveCreateConversationResult>;
    /**
     * One text send, or one explicit retry when the request carries
     * `retryOfTurnId`. The response is an acceptance/result envelope, not the
     * output stream; attach with `streamConversationOperation`. The exact text
     * is preserved byte for byte. An identical completed send replays Cave's
     * recorded result; the SDK never replays one on its own.
     */
    sendConversationMessage(conversationId: string, request: CaveSendConversationMessageRequest, options?: OperationOptions): Promise<CaveSendConversationMessageResult>;
    /**
     * Typed convenience over `messages.send` for retrying an explicitly failed
     * or cancelled assistant turn. It uses a fresh operation UUID and the
     * explicit `retryOfTurnId`; it introduces no second producer route.
     */
    retryConversationTurn(conversationId: string, request: CaveRetryConversationTurnRequest, options?: OperationOptions): Promise<CaveSendConversationMessageResult>;
    /**
     * The non-content operation record: fixed codes, turn references, event
     * bounds, and timestamps. Prompt, attachment, bearer, and raw-cause
     * content never appear here.
     */
    getConversationOperation(operationId: string, options?: OperationOptions): Promise<CaveConversationOperation>;
    /**
     * The typed, resumable event stream for one conversation operation.
     *
     * `options.timeoutMs` is one total stream budget; each long poll receives
     * only the remaining budget. A caller abort closes the current event read
     * and this generator: it never calls Stop and never resubmits a send.
     * Initial attachment and every resumed page pass through the same event
     * translator, which suppresses duplicates at or below the accepted cursor
     * and refuses protocol violations. `reconcile_required` is an instruction
     * to reload canonical history, not a retry.
     */
    streamConversationOperation(operationId: string, options?: CaveConversationStreamOptions): AsyncGenerator<CaveConversationEvent>;
    /**
     * Explicit Stop for one conversation operation. Repeated Stop calls are
     * safe against the target operation; this client sends each Stop exactly
     * once and never retries it after ambiguous transport completion.
     */
    stopConversationOperation(operationId: string, options?: OperationOptions): Promise<CaveConversationOperation>;
    /**
     * Bounded attachment upload. The request is validated fail closed (file
     * count, size, request size, MIME/signature agreement, filename, symlink,
     * and the atomic uploader-credential-plus-conversation binding) before any
     * capability or transport work, so a validation rejection performs zero
     * domain mutation. Under the pinned contract the attachment capability is
     * undeclared and this reports `unsupported_operation`.
     */
    uploadAttachment(request: CaveAttachmentUploadRequest, options?: OperationOptions): Promise<CaveAttachmentRecord>;
    /**
     * Bounded attachment download. The request carries the byte ceiling; the
     * canonical record is the validated result metadata. Under the pinned
     * contract this reports `unsupported_operation` before any transport work.
     */
    downloadAttachment(request: CaveAttachmentDownloadRequest, options?: OperationOptions): Promise<CaveAttachmentRecord>;
    /**
     * One attention response with a closed response-kind union and a bounded
     * optional note. Validation failure performs zero domain mutation; under
     * the pinned contract the attention capability is undeclared and this
     * reports `unsupported_operation`.
     */
    respondToAttention(request: CaveAttentionResponseRequest, options?: OperationOptions): Promise<void>;
    /**
     * One task-handoff transition. The declared transition map keeps
     * proposed, pending, completed, rejected, and failed strictly distinct;
     * an illegal or skipped transition is a configuration error before any
     * capability or transport work. Under the pinned contract this reports
     * `unsupported_operation`.
     */
    requestTaskHandoff(request: CaveTaskHandoffRequest, options?: OperationOptions): Promise<void>;
    /**
     * One explicitly confirmed GitHub action. The curated action union is
     * empty under the pinned contract, so every request is rejected during
     * request parsing — before any capability or transport work — and zero
     * domain mutation is possible. When the upstream producer contract
     * curates the union, the confirmed request flows through the capability
     * gate to Cave, which revalidates confirmation, scope, grant, and bounds.
     */
    submitGitHubAction(request: CaveGitHubActionRequest, options?: OperationOptions): Promise<void>;
}
declare function createCaveClient(options: CaveClientOptions): CaveClient;

export { type CaveContractViolation as $, CaveAttachmentSchemaError as A, type CaveAttachmentUploadRequest as B, type CavePairingRequest as C, type CaveAttentionResponseKind as D, type CaveAttentionResponseRequest as E, type CaveAuthorityBinding as F, type CaveAuthorityBoundPairingExchange as G, type CaveCanonicalFamiliar as H, type CaveCapabilityContractSource as I, type CaveCapabilityRegistry as J, type CaveCapabilityResolution as K, type CaveCapabilityStatus as L, CaveClientError as M, type CaveClientOptions as N, type CaveContractCursor as O, type CaveContractEnvelopeMetadata as P, type CaveContractFile as Q, type CaveContractFixture as R, type CaveContractHealthData as S, type CaveContractIdentity as T, type CaveContractOperation as U, type CaveContractPairingCreatedData as V, type CaveContractPairingExchangeData as W, type CaveContractPairingStatusData as X, type CaveContractPublicRoute as Y, type CaveContractReport as Z, type CaveContractRevision as _, CaveClient as a, type CaveTaskHandoffRequest as a$, type CaveConversation as a0, type CaveConversationEvent as a1, type CaveConversationEventBase as a2, type CaveConversationEventPage as a3, type CaveConversationEventPageRequest as a4, type CaveConversationEventTranslator as a5, type CaveConversationEventType as a6, type CaveConversationMessage as a7, type CaveConversationOperation as a8, type CaveConversationOperationId as a9, type CaveFamiliarProperty as aA, type CaveFamiliarWire as aB, type CaveFamiliarsResponse as aC, type CaveGitHubActionKind as aD, type CaveGitHubActionRequest as aE, type CaveHealth as aF, type CaveHealthData as aG, type CaveHealthResponse as aH, type CaveManagedCredentialStatusResult as aI, type CaveManagedCredentialTransport as aJ, type CaveManagedForgetCredentialResult as aK, type CaveManagedNativeCredentialCustody as aL, type CaveManagedPairingCreated as aM, type CaveManagedPairingExchange as aN, type CavePairingCreated as aO, type CavePairingExchange as aP, type CavePairingScope as aQ, CavePairingSession as aR, type CavePairingState as aS, type CavePairingStatus as aT, type CavePrivilegedActionClass as aU, type CavePrivilegedActionRequirement as aV, type CaveProject as aW, type CavePropertyCoverage as aX, type CaveRetryConversationTurnRequest as aY, type CaveSendConversationMessageRequest as aZ, type CaveSendConversationMessageResult as a_, type CaveConversationOperationKind as aa, type CaveConversationOperationState as ab, type CaveConversationOriginatingScope as ac, type CaveConversationReconcileReason as ad, type CaveConversationStreamOptions as ae, type CaveConversationTranslatedPage as af, type CaveCreateConversationRequest as ag, type CaveCreateConversationResult as ah, type CaveCredentialAccess as ai, type CaveCredentialBinding as aj, type CaveCredentialDisconnectedReason as ak, type CaveCredentialMetadata as al, type CaveCredentialPersistingTransport as am, type CaveCredentialStatus as an, type CaveDeclaredOperationRef as ao, type CaveExecutionAttempt as ap, type CaveExecutionBackfill as aq, type CaveExecutionCoverage as ar, type CaveExecutionSlice as as, type CaveExecutionWindow as at, type CaveFamiliar as au, type CaveFamiliarAnalytics as av, type CaveFamiliarAnalyticsOptions as aw, type CaveFamiliarAnalyticsResponse as ax, type CaveFamiliarContract as ay, type CaveFamiliarContractResponse as az, CAVE_ANALYTICS_WINDOWS as b, type CaveTaskHandoffState as b0, type CaveTransport as b1, bindCaveAttachments as b2, caveConversationReconcileReason as b3, createCaveCapabilityRegistry as b4, createCaveClient as b5, createConversationEventTranslator as b6, createDefaultCaveCapabilityRegistry as b7, digestCaveContractFixture as b8, isCaveClientError as b9, isCaveTaskHandoffTransition as ba, normalizeCaveError as bb, parseCaveAttachmentDownloadRequest as bc, parseCaveAttachmentRecord as bd, parseCaveAttachmentUploadRequest as be, parseCaveAttentionResponseRequest as bf, parseCaveContractFixture as bg, parseCaveGitHubActionRequest as bh, parseCaveTaskHandoffRequest as bi, parsePrivilegedConfirmation as bj, parseVerifiedCaveContractFixture as bk, sniffCaveAttachmentContentType as bl, validateConversationEventCursor as bm, validatePrivilegedOperationId as bn, verifyCaveContractFixtureDigest as bo, CAVE_ATTACHMENT_CONTENT_TYPES as c, CAVE_ATTACHMENT_LIMITS as d, CAVE_ATTENTION_RESPONSE_KINDS as e, CAVE_CONVERSATION_EVENT_TYPES as f, CAVE_CONVERSATION_OPERATION_STATES as g, CAVE_CONVERSATION_ORIGINATING_SCOPES as h, CAVE_CONVERSATION_RECONCILE_REASONS as i, CAVE_CONVERSATION_TERMINAL_STATES as j, CAVE_DEFAULT_CAPABILITY_CONTRACT as k, CAVE_FAMILIAR_PROPERTIES as l, CAVE_GITHUB_ACTION_KINDS as m, CAVE_PAIRING_SCOPES as n, CAVE_PAIRING_STATUSES as o, CAVE_PRIVILEGED_ACTION_CLASSES as p, CAVE_PRIVILEGED_ACTION_REQUIREMENTS as q, CAVE_TASK_HANDOFF_STATES as r, CAVE_TASK_HANDOFF_TRANSITIONS as s, type CaveAnalyticsWindowKey as t, type CaveAttachmentBinding as u, type CaveAttachmentContent as v, type CaveAttachmentContentType as w, type CaveAttachmentDescriptor as x, type CaveAttachmentDownloadRequest as y, type CaveAttachmentRecord as z };
// Entrypoint: ./managed
// Declaration: dist/managed.d.ts
import { aJ as CaveManagedCredentialTransport, a as CaveClient } from './client-M2RrMRyI.js';
export { b as CAVE_ANALYTICS_WINDOWS, l as CAVE_FAMILIAR_PROPERTIES, n as CAVE_PAIRING_SCOPES, o as CAVE_PAIRING_STATUSES, H as CaveCanonicalFamiliar, M as CaveClientError, N as CaveClientOptions, a0 as CaveConversation, a7 as CaveConversationMessage, ai as CaveCredentialAccess, aj as CaveCredentialBinding, al as CaveCredentialMetadata, an as CaveCredentialStatus, aw as CaveFamiliarAnalyticsOptions, aF as CaveHealth, aI as CaveManagedCredentialStatusResult, aK as CaveManagedForgetCredentialResult, aL as CaveManagedNativeCredentialCustody, aM as CaveManagedPairingCreated, aN as CaveManagedPairingExchange, C as CavePairingRequest, aQ as CavePairingScope, aR as CavePairingSession, aS as CavePairingState, aT as CavePairingStatus, aW as CaveProject, b1 as CaveTransport, b9 as isCaveClientError, bb as normalizeCaveError } from './client-M2RrMRyI.js';
import { OperationOptions, OperationDefaults, OperationContext } from '@opencoven/sdk-core/browser';

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
interface CaveManagedHpkeAuthority {
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
type CaveManagedDiscoveredEndpoint = CaveManagedDiscoveredEndpointBase & {
    version: 1;
} | CaveManagedDiscoveredEndpointBase & {
    version: 2;
    authority: CaveManagedHpkeAuthority;
};
declare function discoverManagedCaveEndpoint(source: CaveManagedDiscoverySource, options?: CaveManagedDiscoveryOptions): Promise<CaveManagedDiscoveredEndpoint>;

interface CaveManagedClientOptions {
    transport: CaveManagedCredentialTransport;
    operation?: OperationDefaults;
}
declare function createManagedCaveClient(options: CaveManagedClientOptions): CaveClient;

export { CaveClient, type CaveManagedClientOptions, CaveManagedCredentialTransport, type CaveManagedDiscoveredEndpoint, type CaveManagedDiscoveryOptions, type CaveManagedDiscoverySource, createManagedCaveClient, discoverManagedCaveEndpoint };
