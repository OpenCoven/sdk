// Entrypoint: .
// Declaration: dist/index.d.ts
import { OperationContext, OperationDefaults, OperationOptions, BoundedPageOptions, DiscoveryEndpoint, NormalizedError } from '@opencoven/sdk-core';

/** Hand-authored read projection of Coven 4e35dd4c99013159fcee4c1ab2f183accdf7a5f8, not generated types. */
interface CovenAutomationReceiptDigest {
    readonly algorithm: 'sha256';
    readonly canonicalization: 'jcs-rfc8785';
    readonly value: string;
}
/** Receipt data and references, not authenticated identity, authority or outcome evidence. */
interface CovenAutomationReceipt {
    readonly schemaVersion: 'coven.automations.v1';
    readonly receiptId: string;
    readonly automationId: string;
    readonly automationRevision: number;
    readonly definitionDigest?: CovenAutomationReceiptDigest;
    readonly occurrenceId: string;
    readonly occurrenceFenceGeneration?: number;
    readonly runId: string;
    readonly attemptId: string;
    readonly attemptNumber?: number;
    readonly identity: {
        readonly familiarId: string;
    };
    readonly authority?: {
        readonly principal: {
            readonly principalId: string;
            readonly displayName?: string;
        };
        readonly approval?: {
            readonly approvalPolicyRef: string;
            readonly approvalRecordRef?: string;
        };
    };
    readonly runtime?: {
        readonly runtimeId: string;
        readonly capabilities: readonly string[];
        readonly model?: string;
    };
    readonly deliveryDigest?: CovenAutomationReceiptDigest;
    readonly resultDigest?: CovenAutomationReceiptDigest;
    readonly exercisedCapabilities?: readonly string[];
    readonly sideEffectClass: 'none' | 'local_read' | 'local_write' | 'external_read' | 'external_mutation' | 'irreversible_external_mutation';
    readonly outcome: {
        readonly disposition: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'ambiguous';
        readonly failureClass?: string;
        readonly detail?: string;
        readonly partialFailures?: readonly {
            readonly step: string;
            readonly reason: string;
            readonly recovered?: boolean;
        }[];
        readonly recoveryDisposition?: 'not_required' | 'recovered_inline' | 'deferred_to_operator';
    };
    readonly producedAt: string;
    readonly producer: {
        readonly component: string;
        readonly instanceId: string;
        readonly implementationVersion?: string;
    };
    readonly integrity: CovenAutomationReceiptDigest & {
        readonly authentication?: 'none' | 'producer-hmac' | 'cosign';
    };
    readonly privacy: {
        readonly classification: 'public' | 'operational';
        readonly retention: {
            readonly classification: 'ephemeral' | 'standard' | 'extended';
            readonly deleteAfter?: string;
        };
        readonly notes?: string;
    };
}
/** Producer-reported diagnostics only. The SDK does not independently verify these claims. */
interface CovenAutomationReceiptReadVerification {
    readonly status: 'unverifiable';
    readonly integrity: 'valid';
    readonly correlation: 'valid';
    readonly receiptAuthentication: {
        readonly status: 'unverified';
        readonly evidence: 'unavailable';
    };
    readonly runtimeAuthority: {
        readonly status: 'unverified';
        readonly evidence: 'unavailable';
    };
    readonly reasons: readonly ['PRODUCER_AUTHENTICATION_UNVERIFIED', 'RUNTIME_AUTHORITY_UNVERIFIED'];
}
interface CovenAutomationReceiptResult {
    readonly receipt: CovenAutomationReceipt;
    readonly verification: CovenAutomationReceiptReadVerification;
}

/** Explicit caller expectations; never populate these from an untrusted receipt itself. */
interface CovenAutomationReceiptTrustContext {
    readonly receiptId: string;
    readonly automationId: string;
    readonly automationRevision: number;
    readonly occurrenceId: string;
    readonly runId: string;
    readonly attemptId: string;
    readonly familiarId: string;
    readonly occurrenceFenceGeneration?: number;
    readonly attemptNumber?: number;
    readonly runtimeId?: string;
    /** These compare digest references only; no definition, delivery or result bytes are read. */
    readonly definitionDigest?: CovenAutomationReceiptDigest;
    readonly deliveryDigest?: CovenAutomationReceiptDigest;
    readonly resultDigest?: CovenAutomationReceiptDigest;
}
type CovenAutomationReceiptVerificationCheck = 'valid' | 'invalid' | 'unavailable';
declare const bindingReasons: {
    readonly receiptId: "RECEIPT_ID_MISMATCH";
    readonly automationId: "AUTOMATION_ID_MISMATCH";
    readonly automationRevision: "AUTOMATION_REVISION_MISMATCH";
    readonly occurrenceId: "OCCURRENCE_ID_MISMATCH";
    readonly runId: "RUN_ID_MISMATCH";
    readonly attemptId: "ATTEMPT_ID_MISMATCH";
    readonly familiarId: "FAMILIAR_ID_MISMATCH";
    readonly occurrenceFenceGeneration: "OCCURRENCE_FENCE_MISMATCH";
    readonly attemptNumber: "ATTEMPT_NUMBER_MISMATCH";
    readonly runtimeId: "RUNTIME_ID_MISMATCH";
    readonly definitionDigest: "DEFINITION_DIGEST_MISMATCH";
    readonly deliveryDigest: "DELIVERY_DIGEST_MISMATCH";
    readonly resultDigest: "RESULT_DIGEST_MISMATCH";
};
type CovenAutomationReceiptVerificationReason = typeof bindingReasons[keyof typeof bindingReasons] | 'INVALID_RECEIPT' | 'INVALID_TRUST_CONTEXT' | 'INTEGRITY_MISMATCH' | 'PRODUCER_AUTHENTICATION_UNVERIFIED' | 'RUNTIME_AUTHORITY_UNVERIFIED';
/** Local checks cannot establish authenticated provenance, authority, delivery or execution. */
interface CovenAutomationReceiptVerification {
    readonly status: 'invalid' | 'unverifiable';
    readonly schema: 'valid' | 'invalid';
    readonly integrity: CovenAutomationReceiptVerificationCheck;
    readonly bindings: Readonly<Record<keyof CovenAutomationReceiptTrustContext, CovenAutomationReceiptVerificationCheck>>;
    readonly receiptAuthentication: {
        readonly status: 'unverified';
        readonly evidence: 'unavailable';
    };
    readonly runtimeAuthority: {
        readonly status: 'unverified';
        readonly evidence: 'unavailable';
    };
    readonly reasons: readonly CovenAutomationReceiptVerificationReason[];
}
/** Pure local verification. Unknown or malformed host values produce fixed, non-secret reasons. */
declare function verifyReceipt(receipt: unknown, trustContext: CovenAutomationReceiptTrustContext): CovenAutomationReceiptVerification;

/** The producer's spec command-envelope action (OpenCoven/coven#1176). */
declare const COMMAND_ENVELOPE_ACTION = "coven.automations.command.v1";
/** Lifecycle commands this SDK sends. Create and revise need rich-definition persistence first. */
type CovenAutomationLifecycleCommand = 'definition.activate.v1' | 'definition.pause.v1' | 'definition.disable.v1' | 'definition.tombstone.v1';
/**
 * Who asks, why, and under which idempotency key. `principalId` is recorded
 * with the command; it is never an authority grant. Authority comes from the
 * transport: the built-in transports reach only the owner-only socket or pipe.
 */
interface CovenAutomationCommandContext {
    /**
     * Stable idempotency key, 8–200 characters of `[A-Za-z0-9._:-]` starting
     * alphanumeric. Resend with the same key to reconcile an unknown outcome;
     * a new key could apply the command twice.
     */
    readonly adoptionKey: string;
    /** Human-authored intent, 1–1000 characters. */
    readonly intent: string;
    /** 1–128 characters of `[A-Za-z0-9._:@-]`, starting alphanumeric. */
    readonly principalId: string;
    /** Optional 1–200 character correlation id, recorded on the committed event. */
    readonly correlationId?: string;
}
interface CovenAutomationLifecycleOptions {
    /** Optional 1–500 character reason. Not accepted by `tombstone`. */
    readonly reason?: string;
}
/** A command the producer committed now or had already committed under this key. */
interface CovenAutomationCommandCommitted {
    readonly outcome: 'committed' | 'replayed';
    readonly command: CovenAutomationLifecycleCommand;
    readonly adoptionKey: string;
    /** Definition revision after the command. */
    readonly revision: number;
    /** Command-specific committed result, as the producer projected it. */
    readonly result: Readonly<Record<string, unknown>>;
    /** Where the committed event landed, when the producer reports it. */
    readonly eventRef?: {
        readonly stream: string;
        readonly sequence: number;
    };
    /** Present only on a replay. */
    readonly replay?: {
        readonly firstCommittedAt: string;
    };
}
/**
 * A command the producer refused; nothing committed. The producer's message is
 * not copied, only its typed code.
 */
interface CovenAutomationCommandRejected {
    readonly outcome: 'rejected';
    readonly command: CovenAutomationLifecycleCommand;
    readonly adoptionKey: string;
    readonly error: {
        /** A `coven.automations.v1` error code, e.g. `REVISION_CONFLICT` or `ILLEGAL_TRANSITION`. */
        readonly code: string;
        readonly retryable: boolean;
        /** The stored revision, when the producer reports it (for example on `REVISION_CONFLICT`). */
        readonly currentRevision?: number;
    };
}
type CovenAutomationCommandResult = CovenAutomationCommandCommitted | CovenAutomationCommandRejected;
/** The envelope sent on the control-action wire. */
interface CovenAutomationCommandRequest {
    readonly action: typeof COMMAND_ENVELOPE_ACTION;
    readonly envelope: {
        readonly schemaVersion: 'coven.automations.v1';
        readonly command: CovenAutomationLifecycleCommand;
        readonly adoptionKey: string;
        readonly expectedRevision: number;
        readonly origin: {
            readonly principal: {
                readonly principalId: string;
            };
            readonly channel: 'sdk';
            readonly correlationId?: string;
        };
        readonly intent: {
            readonly statement: string;
        };
        readonly payload: {
            readonly automationId: string;
            readonly reason?: string;
        };
    };
}

/** A keyset history page's position, shaped as an sdk-core `PageCursor`. */
interface CovenAutomationHistoryCursor {
    readonly hasMore: boolean;
    /** The cursor this page was read from; absent on the first page. */
    readonly current?: string;
    readonly next?: string;
}

interface CovenAutomationRunsOptions {
    /** Newest-first history size, 1–100 (default 20). No pagination cursor is exposed by the producer. */
    readonly limit?: number;
}
interface CovenAutomationAttempt {
    readonly id: string;
    readonly runId: string;
    readonly occurrenceId: string;
    readonly attemptNumber: number;
    readonly adoptionKey: string;
    readonly occurrenceFenceGeneration: number;
    readonly dispatchGeneration: number;
    readonly state: 'adopted' | 'dispatching' | 'started' | 'observing' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'ambiguous';
    readonly failureClass: 'transient_dispatch' | 'lease_expired' | 'runtime_unavailable' | 'launch_refused' | 'runtime_error' | 'timeout' | 'cancelled' | 'ambiguous_evidence' | 'runtime_authority_unsupported' | null;
    readonly priorAttemptNumber: number | null;
    readonly priorDisposition: 'failed' | 'timed_out' | 'cancelled' | 'ambiguous' | null;
    readonly retryClassification: 'initial' | 'automatic_retry' | 'operator_retry' | 'operator_recovery';
    readonly notBefore: string;
    readonly sessionId: string | null;
    readonly stateReason: string | null;
    readonly openedAt: string;
    readonly settledAt: string | null;
}
/** Diagnostic cancellation projection, not a cancellation command or authorization proof. */
interface CovenAutomationRunCancellation {
    readonly scope: 'run';
    readonly requestedBy: {
        readonly principalId: string;
    };
    readonly status: 'requested' | 'stopping' | 'cancelled' | 'recovery_required' | 'rejected';
    readonly requestedAt: string;
    readonly reason?: string;
    readonly acknowledgedAt?: string;
    readonly reconciledAt?: string;
}
/** Exact compatibility history projection; the producer does not serialize revision or digest here. */
interface CovenAutomationRun {
    readonly id: string;
    readonly automationId: string;
    readonly occurrenceId: string | null;
    readonly sessionId: string | null;
    readonly familiarId: string | null;
    readonly runtime: string | null;
    readonly status: string;
    readonly exitCode: number | null;
    /** Opaque stored text, not parsed JSON. */
    readonly logJson: string | null;
    readonly outputCommit: string | null;
    readonly startedAt: string;
    readonly finishedAt: string | null;
    /** A reference only; no receipt authentication is performed. */
    readonly receiptId: string | null;
    readonly attempts: readonly CovenAutomationAttempt[];
    readonly cancellation?: CovenAutomationRunCancellation;
}
interface CovenAutomationRunsResult {
    readonly runs: readonly CovenAutomationRun[];
}
interface CovenAutomationRunHistoryOptions {
    /** 1–100, default 20. */
    readonly limit?: number;
    /** An opaque `cursor.next` from an earlier page of the same query. */
    readonly cursor?: string;
    /** Restricts the history to one occurrence's runs. */
    readonly occurrenceId?: string;
}
/**
 * One page of an automation's runs, newest first by start instant then
 * `id`, each with its attempts. Shaped as an sdk-core `Page`.
 */
interface CovenAutomationRunHistoryPage {
    readonly automationId: string;
    readonly occurrenceId?: string;
    readonly data: readonly CovenAutomationRun[];
    readonly cursor: CovenAutomationHistoryCursor;
}

/** Domain streams only: the global feed has a separate, non-domain cursor. */
interface CovenAutomationEventStream {
    readonly kind: 'automation' | 'occurrence' | 'run';
    readonly id: string;
}
type CovenAutomationEventsOptions = {
    readonly stream: CovenAutomationEventStream;
} & ({
    readonly after?: number;
    readonly checkpoint?: never;
} | {
    readonly checkpoint: string;
    readonly after?: never;
});
type CovenAutomationEventsRequest = CovenAutomationEventsOptions & {
    readonly action: 'coven.automations.events.subscribe.v1';
};
interface EventBase {
    readonly schemaVersion: 'coven.automations.v1';
    readonly eventId: string;
    readonly stream: CovenAutomationEventStream;
    readonly sequence: number;
    readonly recordedAt: string;
    readonly observedAt: string;
    readonly producer: {
        readonly component: string;
        readonly instanceId: string;
        readonly implementationVersion?: string;
    };
    readonly causation?: {
        readonly adoptionKey?: string;
        readonly causeEventId?: string;
        readonly correlationId?: string;
    };
    readonly automationId?: string;
    readonly occurrenceId?: string;
    readonly runId?: string;
    readonly attemptId?: string;
    readonly summary: string;
    readonly privacy: {
        readonly classification: 'public' | 'operational' | 'sensitive' | 'restricted';
        readonly retention: {
            readonly classification: 'ephemeral' | 'standard' | 'extended';
            readonly deleteAfter?: string;
        };
    };
    readonly integrity?: CovenAutomationReceiptDigest;
}
interface TransitionPayload {
    readonly from: string;
    readonly to: string;
    readonly reason: string;
    readonly fenceGeneration?: number;
    readonly attemptNumber?: number;
    readonly commandAdoptionKey?: string;
}
/** Validated event data; integrity and producer fields are not authenticated claims. */
type CovenAutomationEvent = EventBase & ({
    readonly kind: 'definition.created' | 'definition.revised' | 'definition.activated' | 'definition.paused' | 'definition.disabled' | 'definition.invalidated' | 'definition.tombstoned' | 'definition.imported';
    readonly payload: {
        readonly revision: number;
        readonly definitionDigest?: CovenAutomationReceiptDigest;
        readonly lifecycleState?: 'draft' | 'paused' | 'active' | 'disabled' | 'invalid' | 'tombstoned';
        readonly importedFrom?: string;
    };
} | {
    readonly kind: 'occurrence.transitioned';
    readonly payload: TransitionPayload & {
        readonly entity: 'occurrence';
    };
} | {
    readonly kind: 'run.transitioned';
    readonly payload: TransitionPayload & {
        readonly entity: 'run';
    };
} | {
    readonly kind: 'attempt.transitioned';
    readonly payload: TransitionPayload & {
        readonly entity: 'attempt';
    };
} | {
    readonly kind: 'occurrence.misfire_recorded';
    readonly payload: {
        readonly disposition: 'none' | 'collapsed_to_latest' | 'skipped_overlap' | 'skipped_paused' | 'skipped_invalid';
        readonly collapsedSlots: readonly string[];
    };
} | {
    readonly kind: 'receipt.recorded';
    readonly payload: {
        readonly receiptRef: string;
        readonly outcome: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'ambiguous';
        readonly sideEffectClass?: 'none' | 'local_read' | 'local_write' | 'external_read' | 'external_mutation' | 'irreversible_external_mutation';
    };
} | {
    readonly kind: 'feed.snapshot';
    readonly payload: {
        readonly throughSequence: number;
        readonly state: Readonly<Record<string, unknown>>;
        readonly reason?: 'retention_compaction' | 'manual_snapshot';
    };
});
interface CovenAutomationEventPage {
    readonly stream: CovenAutomationEventStream;
    /** Exclusive concrete cursor; null means the beginning. */
    readonly after: number | null;
    readonly events: readonly CovenAutomationEvent[];
    readonly nextAfter: number | null;
    readonly checkpoint: string;
    readonly checkpointExpiresAt: string;
}

type CovenAutomationOccurrenceView = 'due' | 'eligible' | 'claimed' | 'running' | 'recovery_required';
/** Scheduler inspection, optionally for one automation; not cursor pagination. */
interface CovenAutomationOccurrencesOptions {
    readonly view: CovenAutomationOccurrenceView;
    /** 1–100, default 20. */
    readonly limit?: number;
    /**
     * Restricts the view to one automation. The producer applies it inside the
     * view's query, so `limit` bounds that automation's rows.
     */
    readonly automationId?: string;
}
/** Producer diagnostics; digests, leases and states do not establish authority. */
interface CovenAutomationOccurrence {
    readonly id: string;
    readonly automationId: string;
    readonly automationRevision: number;
    readonly definitionDigest: string | null;
    readonly scheduledFor: string;
    readonly kind: string;
    readonly state: string;
    readonly leaseOwner: string | null;
    readonly leaseExpiresAt: string | null;
    readonly schedulerGeneration: number | null;
    readonly fenceGeneration: number;
    readonly failureReason: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
}
interface CovenAutomationOccurrenceRun extends Omit<CovenAutomationRun, 'cancellation'> {
    readonly occurrenceId: string;
    readonly automationRevision: number;
    readonly definitionDigest: string | null;
    readonly authorityProfile: string | null;
    readonly timeoutAt: string | null;
}
interface CovenAutomationOccurrenceDetail extends CovenAutomationOccurrence {
    /** At most 20 oldest runs. Truncation is explicit; no continuation cursor exists. */
    readonly runs: readonly CovenAutomationOccurrenceRun[];
    readonly runsTruncated: boolean;
}
interface CovenAutomationOccurrencesResult {
    readonly occurrences: readonly CovenAutomationOccurrence[];
}
interface CovenAutomationOccurrenceHistoryOptions {
    /** 1–100, default 20. */
    readonly limit?: number;
    /** An opaque `cursor.next` from an earlier page of the same automation. */
    readonly cursor?: string;
}
/**
 * One page of an automation's occurrences in every state, newest first by
 * `scheduledFor` then `id`. Shaped as an sdk-core `Page`.
 */
interface CovenAutomationOccurrenceHistoryPage {
    readonly automationId: string;
    readonly data: readonly CovenAutomationOccurrence[];
    readonly cursor: CovenAutomationHistoryCursor;
}
interface CovenAutomationOccurrenceResult {
    readonly occurrence: CovenAutomationOccurrenceDetail | null;
}
interface CovenAutomationRunResult {
    /** The same projection as an occurrence detail's runs, or null when absent. */
    readonly run: CovenAutomationOccurrenceRun | null;
}

/** Executable compatibility shape, not the normative rich AutomationDefinition. */
interface CovenAutomationRoutine {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly name: string;
    readonly status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
    readonly rrule: string;
    readonly timezone: string;
    readonly misfire: 'latest';
    readonly overlap: 'forbid';
    readonly timeoutMinutes: number;
    readonly runtime: string;
    readonly prompt: string;
    readonly familiarId?: string;
    readonly cwd?: string;
    readonly outputTarget?: string;
    readonly model?: string;
    readonly tags?: readonly string[];
    readonly retry?: {
        readonly maxAttempts: number;
        readonly backoffPolicy: 'none' | 'fixed' | 'exponential';
        readonly backoffSeconds?: number;
        readonly retryableClasses?: readonly ('transient_dispatch' | 'lease_expired' | 'runtime_unavailable')[];
    };
}
interface CovenAutomationDefinitionList {
    readonly routines: readonly CovenAutomationRoutine[];
    readonly revisionById: Readonly<Record<string, number>>;
    readonly tombstonedAtById: Readonly<Record<string, string>>;
}
type CovenAutomationDefinition = {
    readonly routine: null;
} | {
    readonly routine: CovenAutomationRoutine;
    readonly revision: number;
    readonly tombstonedAt: string | null;
};
interface CovenAutomationListOptions {
    readonly includeTombstoned?: boolean;
}
interface CovenAutomationHealth {
    readonly automationId: string;
    readonly nextDueAt: string | null;
    readonly lastPlannedAt: string | null;
    readonly lastStartedAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly consecutiveFailures: number;
    readonly leaseOwner: string | null;
    readonly leaseExpiresAt: string | null;
    readonly staleReason: string | null;
    readonly currentAttempt: number | null;
    readonly maxAttempts: number;
    readonly retryNotBefore: string | null;
    readonly consecutiveExhaustions: number;
    readonly quarantinedAt: string | null;
    readonly quarantineFailureClass: string | null;
    readonly quarantineReason: string | null;
}
interface CovenAutomationHealthResult {
    readonly health: CovenAutomationHealth;
}
/** Read-only diagnostic actions permitted by the built-in transport. */
type CovenAutomationDefinitionReadRequest = {
    readonly action: 'coven.automations.definition.list.v1';
    readonly includeTombstoned: boolean;
} | {
    readonly action: 'coven.automations.definition.get.v1';
    readonly id: string;
} | {
    readonly action: 'coven.automations.health';
    readonly id: string;
} | {
    readonly action: 'coven.automations.runs';
    readonly id: string;
    readonly limit: number;
} | {
    readonly action: 'coven.automations.occurrence.list.v1';
    readonly view: CovenAutomationOccurrenceView;
    readonly limit: number;
    readonly automationId?: string;
} | {
    readonly action: 'coven.automations.occurrence.history.v1';
    readonly automationId: string;
    readonly limit: number;
    readonly cursor?: string;
} | {
    readonly action: 'coven.automations.occurrence.get.v1';
    readonly id: string;
} | {
    readonly action: 'coven.automations.run.history.v1';
    readonly automationId: string;
    readonly limit: number;
    readonly occurrenceId?: string;
    readonly cursor?: string;
} | {
    readonly action: 'coven.automations.run.get.v1';
    readonly id: string;
} | {
    readonly action: 'coven.automations.receipt.get.v1';
    readonly id: string;
} | CovenAutomationEventsRequest;

interface CovenAutomationVariant {
    readonly variant: string;
    readonly profile?: string;
    readonly notes?: string;
}
interface CovenAutomationCapabilityProfile {
    readonly version: 1;
    readonly contractProfile: 'coven.automations.v1';
    readonly description: string;
    readonly supported: {
        readonly triggers: readonly CovenAutomationVariant[];
        readonly conditions: readonly CovenAutomationVariant[];
        readonly actions: readonly CovenAutomationVariant[];
        readonly triggerPolicies: readonly CovenAutomationVariant[];
        readonly deliveryPolicies: readonly CovenAutomationVariant[];
        readonly retentionPolicies: readonly CovenAutomationVariant[];
    };
    readonly experimental: readonly CovenAutomationVariant[];
    readonly refused: readonly {
        readonly variant: string;
        readonly reason: string;
    }[];
    readonly negotiationRules: readonly string[];
}
type CovenAutomationCapabilities = {
    readonly status: 'unavailable';
    readonly reason: 'not_advertised' | 'planned' | 'profile_missing';
} | {
    readonly status: 'available';
    readonly actions: readonly string[];
    readonly policy: 'allow' | 'requiresApproval';
    readonly variantNegotiation: CovenAutomationCapabilityProfile;
};
interface CovenAutomationsTransport {
    /**
     * Sends one lifecycle command envelope. Optional: a transport without it
     * cannot mutate, and commands fail with `unsupported_operation`.
     */
    sendCommand?(request: CovenAutomationCommandRequest, context: OperationContext): Promise<{
        readonly status: number;
        readonly body: Uint8Array;
    }>;
    readDefinitions?(request: CovenAutomationDefinitionReadRequest, context: OperationContext): Promise<{
        readonly status: number;
        readonly body: Uint8Array;
    }>;
    capabilities(context: OperationContext): Promise<{
        readonly status: number;
        readonly body: Uint8Array;
    }>;
}
interface CovenAutomationsClientOptions {
    readonly transport: CovenAutomationsTransport;
    readonly operation?: OperationDefaults;
}
/** Reads advertisements and diagnostics; neither receipt authentication nor execution authorization. */
declare class CovenAutomationsClient {
    #private;
    constructor(options: CovenAutomationsClientOptions);
    list(query?: CovenAutomationListOptions, options?: OperationOptions): Promise<CovenAutomationDefinitionList>;
    get(id: string, options?: OperationOptions): Promise<CovenAutomationDefinition>;
    health(id: string, options?: OperationOptions): Promise<CovenAutomationHealthResult>;
    runs(id: string, query?: CovenAutomationRunsOptions, options?: OperationOptions): Promise<CovenAutomationRunsResult>;
    occurrences(query: CovenAutomationOccurrencesOptions, options?: OperationOptions): Promise<CovenAutomationOccurrencesResult>;
    /** One page of one automation's occurrences in every state, newest first. */
    occurrenceHistory(automationId: string, query?: CovenAutomationOccurrenceHistoryOptions, options?: OperationOptions): Promise<CovenAutomationOccurrenceHistoryPage>;
    /**
     * Every occurrence of one automation, newest first, across pages. Requires
     * `maxPages` or a caller-owned `signal`; `timeoutMs` bounds the whole walk.
     */
    iterateOccurrenceHistory(automationId: string, options: BoundedPageOptions): AsyncGenerator<CovenAutomationOccurrence>;
    /** One page of one automation's runs, optionally for one occurrence, newest first. */
    runHistory(automationId: string, query?: CovenAutomationRunHistoryOptions, options?: OperationOptions): Promise<CovenAutomationRunHistoryPage>;
    /**
     * Every run of one automation, optionally for one occurrence, newest first
     * across pages. Requires `maxPages` or a caller-owned `signal`; `timeoutMs`
     * bounds the whole walk.
     */
    iterateRunHistory(automationId: string, options: BoundedPageOptions, query?: {
        readonly occurrenceId?: string;
    }): AsyncGenerator<CovenAutomationRun>;
    /**
     * `paused -> active` at `expectedRevision`. Returns the typed outcome; a
     * domain refusal is `outcome: 'rejected'`, not an exception. Throws
     * `outcome_unknown` when the request may have reached the producer but no
     * trustworthy answer came back: resend with the same `adoptionKey`.
     */
    activate(automationId: string, expectedRevision: number, context: CovenAutomationCommandContext, options?: CovenAutomationLifecycleOptions & OperationOptions): Promise<CovenAutomationCommandResult>;
    /** `active -> paused` at `expectedRevision`. Outcomes as for `activate`. */
    pause(automationId: string, expectedRevision: number, context: CovenAutomationCommandContext, options?: CovenAutomationLifecycleOptions & OperationOptions): Promise<CovenAutomationCommandResult>;
    /** Disables at `expectedRevision`; a disabled definition never reactivates directly. */
    disable(automationId: string, expectedRevision: number, context: CovenAutomationCommandContext, options?: CovenAutomationLifecycleOptions & OperationOptions): Promise<CovenAutomationCommandResult>;
    /** Tombstones at `expectedRevision`, retaining history. Takes no `reason`. */
    tombstone(automationId: string, expectedRevision: number, context: CovenAutomationCommandContext, options?: OperationOptions): Promise<CovenAutomationCommandResult>;
    /** One run and its attempts by run id, read from one producer snapshot. */
    getRun(runId: string, options?: OperationOptions): Promise<CovenAutomationRunResult>;
    getOccurrence(id: string, options?: OperationOptions): Promise<CovenAutomationOccurrenceResult>;
    getReceipt(id: string, options?: OperationOptions): Promise<CovenAutomationReceiptResult>;
    /** Local integrity and caller-binding checks; no transport or authentication inference. */
    verifyReceipt(receipt: unknown, trustContext: CovenAutomationReceiptTrustContext): CovenAutomationReceiptVerification;
    events(query: CovenAutomationEventsOptions, options?: OperationOptions): Promise<CovenAutomationEventPage>;
    subscribe(query: CovenAutomationEventsOptions, options?: OperationOptions): AsyncIterableIterator<CovenAutomationEventPage>;
    capabilities(options?: OperationOptions): Promise<CovenAutomationCapabilities>;
}
declare function createCovenAutomationsClient(options: CovenAutomationsClientOptions): CovenAutomationsClient;

declare const COVEN_DAEMON_PROTOCOL: "coven.daemon.v1";
interface CovenHealthResponse {
    ok: true;
    apiVersion: typeof COVEN_DAEMON_PROTOCOL;
    covenVersion: string;
    capabilities: {
        sessions: boolean;
        events: boolean;
        eventCursor?: string;
        structuredErrors: boolean;
    };
}
interface CovenHealth {
    status: 'ok';
}

declare const DISCOVERED_ENDPOINT_VERSION = 1;
type CovenIpcErrorCode = 'not_found' | 'command_failed' | 'malformed_config' | 'unsafe_endpoint' | 'owner_mismatch' | 'connect_failure' | 'timeout' | 'body_limit' | 'frame_limit' | 'invalid_response';
interface CovenIpcDiagnostics {
    phase: 'config_command' | 'parse_config' | 'read_metadata' | 'validate_endpoint' | 'connect' | 'revalidate_endpoint' | 'write_request' | 'read_response';
    exitCode?: number;
    signal?: string;
    stdoutBytes?: number;
    stderrBytes?: number;
    limitBytes?: number;
}
declare class CovenIpcError extends Error {
    readonly code: CovenIpcErrorCode;
    readonly diagnostics: CovenIpcDiagnostics;
    readonly retryable: boolean;
    constructor(code: CovenIpcErrorCode, message: string, diagnostics: CovenIpcDiagnostics);
}
declare function isCovenIpcError(error: unknown): error is CovenIpcError;
interface CovenExecFileOptions {
    cwd: string;
    encoding: 'utf8';
    env: NodeJS.ProcessEnv;
    killSignal: 'SIGKILL';
    maxBuffer: number;
    shell: false;
    timeout: number;
    windowsHide: true;
}
interface CovenExecFileError extends Error {
    code?: number | string;
    killed?: boolean;
    signal?: string;
}
interface CovenExecFileChild {
    kill(signal: 'SIGKILL'): boolean;
}
type CovenExecFile = (file: string, args: readonly string[], options: CovenExecFileOptions, callback: (error: CovenExecFileError | null, stdout: string, stderr: string) => void) => CovenExecFileChild | void;
interface CovenDiscoveryFileIdentity {
    device: number;
    inode: number;
    mode: number;
    ownerUid: number;
    regularFile: boolean;
    size: number;
    symbolicLink: boolean;
}
interface CovenMetadataFileHandle {
    read(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<{
        bytesRead: number;
    }>;
    close(): Promise<void>;
    stat(): Promise<CovenDiscoveryFileIdentity>;
}
type CovenExecutableResolver = () => string | Promise<string>;
interface CovenWindowsFileTrustValidator {
    validate(path: string, purpose: 'executable' | 'metadata'): Promise<boolean>;
}
interface CovenDiscoveryDependencies {
    execFile?: CovenExecFile;
    getEffectiveUid?: () => number | undefined;
    lstat?: (path: string) => Promise<CovenDiscoveryFileIdentity>;
    openFile?: (path: string, flags: number) => Promise<CovenMetadataFileHandle>;
    realpath?: (path: string) => Promise<string>;
    resolveExecutable?: CovenExecutableResolver;
    windowsFileTrust?: CovenWindowsFileTrustValidator;
}
interface DiscoverCovenEndpointOptions {
    cwd?: string;
    dependencies?: CovenDiscoveryDependencies;
    env?: Readonly<NodeJS.ProcessEnv>;
    maxOutputBytes?: number;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
}
type CovenDiscoverySource = 'coven_home' | 'config_paths';
type CovenEndpointOwner = {
    kind: 'unix';
    uid: number;
} | {
    kind: 'windows';
    identity: string;
};
interface CovenEndpointFreshness {
    daemonPid: number;
    daemonStartedAt: string;
    processCreationTime?: string;
}
type CovenLocalEndpoint = Extract<DiscoveryEndpoint, {
    kind: 'unix' | 'windowsNamedPipe';
}>;
interface CovenDiscoveredEndpoint {
    version: typeof DISCOVERED_ENDPOINT_VERSION;
    protocol: typeof COVEN_DAEMON_PROTOCOL;
    source: CovenDiscoverySource;
    endpoint: CovenLocalEndpoint;
    owner?: CovenEndpointOwner;
    freshness?: CovenEndpointFreshness;
}
declare function discoverCovenEndpoint(options?: DiscoverCovenEndpointOptions): Promise<CovenDiscoveredEndpoint>;

declare const COVEN_SESSION_POLICY_CONTRACT = "coven.session-policy.v1";
declare const COVEN_SESSION_POLICY_PROFILE = "workspace-readonly-no-network.v1";
interface CovenSessionPolicyDiscovery {
    readonly contract: typeof COVEN_SESSION_POLICY_CONTRACT;
    readonly enforcement: 'unavailable';
    readonly supportedProfiles: readonly [];
    readonly reason: 'no_verified_enforcement_backend';
}
interface CovenRestrictedLaunchRequest {
    readonly contract: typeof COVEN_SESSION_POLICY_CONTRACT;
    readonly requestId: string;
    readonly invocationId: string;
    readonly profile: typeof COVEN_SESSION_POLICY_PROFILE;
    readonly expiresAtUnixMs: number;
    readonly launch: {
        readonly projectRoot: string;
        readonly cwd: string;
        readonly harness: 'codex' | 'claude' | 'coven-code' | 'copilot';
        readonly familiarId: string;
        readonly launchMode: 'nonInteractive';
        readonly prompt: string;
        readonly title: string;
    };
}
interface CovenSessionPolicyRefusal {
    readonly contract: typeof COVEN_SESSION_POLICY_CONTRACT;
    readonly requestId: string;
    readonly invocationId: string;
    readonly requestDigest: string;
    readonly decision: 'rejected';
    readonly code: 'enforcement_unavailable';
    readonly admission: 'not_started';
}
type CovenSessionPolicyTransportRequest = {
    readonly method: 'GET';
    readonly path: '/api/v1/session-policy';
    readonly maxResponseBytes: 16384;
} | {
    readonly method: 'POST';
    readonly path: '/api/v1/sessions/restricted';
    readonly maxResponseBytes: 16384;
    /** Frozen UTF-8 octets. Send exactly once without reserialization. */
    readonly body: readonly number[];
};
interface CovenSessionPolicyTransportResponse {
    readonly status: number;
    readonly body: Uint8Array;
}
/** Opt-in owner-local transport; never adapt the built-in health transport. */
interface CovenSessionPolicyTransport {
    request(request: CovenSessionPolicyTransportRequest, context: OperationContext): Promise<CovenSessionPolicyTransportResponse>;
}
interface CovenSessionPolicyClientOptions {
    readonly transport: CovenSessionPolicyTransport;
    readonly operation?: OperationDefaults;
}
type CovenSessionPolicyErrorCode = 'invalid_request' | 'invalid_response' | 'unsupported_contract' | 'unsupported_profile' | 'unsupported_platform' | 'http_error' | 'transport_error' | 'invalid_options' | 'aborted' | 'timeout';
type CovenSessionPolicyDelivery = 'not_attempted' | 'unknown';
type PolicyOperation = 'sessionPolicy.discover' | 'sessionPolicy.launchRestricted';
interface Binding {
    readonly requestId: string;
    readonly invocationId: string;
    readonly requestDigest: string;
}
declare class CovenSessionPolicyError extends Error {
    readonly code: CovenSessionPolicyErrorCode;
    readonly delivery: CovenSessionPolicyDelivery;
    readonly statusCode?: number | undefined;
    readonly normalized: NormalizedError;
    readonly retryable = false;
    readonly requestId: string | undefined;
    readonly invocationId: string | undefined;
    readonly requestDigest: string | undefined;
    constructor(code: CovenSessionPolicyErrorCode, operation: PolicyOperation, delivery: CovenSessionPolicyDelivery, statusCode?: number | undefined, binding?: Binding);
}
declare function isCovenSessionPolicyError(error: unknown): error is CovenSessionPolicyError;
declare class CovenSessionPolicyClient {
    #private;
    constructor(options: CovenSessionPolicyClientOptions);
    discover(options?: OperationOptions): Promise<CovenSessionPolicyDiscovery>;
    launchRestricted(body: Uint8Array, options?: OperationOptions): Promise<CovenSessionPolicyRefusal>;
}
declare function createCovenSessionPolicyClient(options: CovenSessionPolicyClientOptions): CovenSessionPolicyClient;

interface CovenWindowsPipeIdentity {
    ownerIdentity: string;
    ownerOnly: boolean;
    pipeIdentity: string;
    serverProcessId: number;
    processCreationTime: string;
}
interface CovenWindowsPipeOwnershipAdapter {
    currentUserIdentity(): Promise<string>;
    inspect(path: string): Promise<CovenWindowsPipeIdentity>;
    inspectConnected(path: string, socket: CovenSocket): Promise<CovenWindowsPipeIdentity>;
}
interface CovenWindowsTransportSecurityProvider {
    readonly platform: 'windows';
    readonly ownership: CovenWindowsPipeOwnershipAdapter;
}
interface CovenWindowsTransportDependencies {
    connect?: CovenSocketConnector;
}
interface CovenWindowsTransportOptions extends CovenHealthTransportLimits {
    dependencies?: CovenWindowsTransportDependencies;
    security: CovenWindowsTransportSecurityProvider;
}
declare function createCovenWindowsTransport(discovered: CovenDiscoveredEndpoint, options: CovenWindowsTransportOptions): CovenTransport;

interface CovenTransport {
    health(context?: OperationContext): Promise<CovenHealthResponse>;
}
type CovenTransportSecurityProvider = CovenUnixTransportSecurityProvider | CovenWindowsTransportSecurityProvider;

interface CovenSocket {
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    removeListener(event: string, listener: (...args: unknown[]) => void): this;
    write(data: Uint8Array | string): boolean;
    end(): this;
    destroy(): this;
    pause(): this;
    resume(): this;
}
interface CovenConnectedSocket extends CovenSocket {
    readonly connecting: boolean;
    readonly destroyed: boolean;
}
type CovenSocketConnector = (path: string) => CovenConnectedSocket;
interface CovenUnixFileIdentity {
    device: number;
    inode: number;
    mode: number;
    ownerUid: number;
    symbolicLink: boolean;
    socket: boolean;
}
interface CovenUnixPeerIdentity {
    uid: number;
    gid?: number;
    pid?: number;
}
interface CovenUnixPeerIdentityAdapter {
    inspectConnected(socket: CovenConnectedSocket): Promise<CovenUnixPeerIdentity>;
}
interface CovenUnixTransportSecurityProvider {
    readonly platform: 'unix';
    readonly peerIdentity: CovenUnixPeerIdentityAdapter;
}
interface CovenDaemonFailure {
    code: string;
    message: string;
    status?: number;
    details?: unknown;
}
declare class CovenDaemonResponseError extends Error {
    readonly retryable = false;
    readonly code: string;
    readonly statusCode: number;
    readonly daemon: CovenDaemonFailure;
    constructor(daemon: CovenDaemonFailure, statusCode: number);
}
declare function isCovenDaemonResponseError(error: unknown): error is CovenDaemonResponseError;
interface CovenHealthTransportLimits {
    connectTimeoutMs?: number;
    maxBodyBytes?: number;
    maxHeaderBytes?: number;
    requestTimeoutMs?: number;
}
interface CovenUnixTransportDependencies {
    connect?: CovenSocketConnector;
    getEffectiveUid?: () => number | undefined;
    lstat?: (path: string) => Promise<CovenUnixFileIdentity>;
}
interface CovenUnixTransportOptions extends CovenHealthTransportLimits {
    dependencies?: CovenUnixTransportDependencies;
    security: CovenUnixTransportSecurityProvider;
}
declare function createCovenUnixTransport(discovered: CovenDiscoveredEndpoint, options: CovenUnixTransportOptions): CovenTransport;

interface CovenAutomationsUnixTransportOptions {
    readonly security: CovenUnixTransportSecurityProvider;
    readonly dependencies?: CovenUnixTransportDependencies;
}
/** Uses the same endpoint and connected-peer checks as the Unix health transport. */
declare function createCovenAutomationsUnixTransport(discovered: CovenDiscoveredEndpoint, options: CovenAutomationsUnixTransportOptions): CovenAutomationsTransport;

interface CovenAutomationsWindowsTransportOptions {
    readonly security: CovenWindowsTransportSecurityProvider;
    readonly dependencies?: CovenWindowsTransportDependencies;
}
/** Requires the same owner-only ACL and connected-pipe identity checks as health. */
declare function createCovenAutomationsWindowsTransport(discovered: CovenDiscoveredEndpoint, options: CovenAutomationsWindowsTransportOptions): CovenAutomationsTransport;

declare function normalizeCovenError(error: unknown, operation: string): NormalizedError;
declare class CovenClientError extends Error {
    readonly normalized: NormalizedError;
    readonly code: string;
    readonly retryable: boolean;
    readonly requestId: string | undefined;
    readonly statusCode: number | undefined;
    readonly daemon: CovenDaemonFailure | undefined;
    constructor(normalized: NormalizedError, options?: ErrorOptions);
}
declare function isCovenClientError(error: unknown): error is CovenClientError;

interface CovenClientOptions {
    transport: CovenTransport;
    automationsTransport?: CovenAutomationsTransport;
    operation?: OperationDefaults;
}
interface CovenDiscoveredClientBaseOptions {
    discovery?: DiscoverCovenEndpointOptions;
    operation?: OperationDefaults;
    automations?: boolean;
}
type CovenDiscoveredUnixTransportOptions = Omit<CovenUnixTransportOptions, 'security'>;
type CovenDiscoveredWindowsTransportOptions = Omit<CovenWindowsTransportOptions, 'security'>;
interface CovenDiscoveredUnixClientOptions extends CovenDiscoveredClientBaseOptions {
    transportSecurity: CovenUnixTransportSecurityProvider;
    unix?: CovenDiscoveredUnixTransportOptions;
    windows?: never;
}
interface CovenDiscoveredWindowsClientOptions extends CovenDiscoveredClientBaseOptions {
    transportSecurity: CovenWindowsTransportSecurityProvider;
    unix?: never;
    windows?: CovenDiscoveredWindowsTransportOptions;
}
type CovenDiscoveredClientOptions = CovenDiscoveredUnixClientOptions | CovenDiscoveredWindowsClientOptions;
declare class CovenClient {
    #private;
    readonly automations: CovenAutomationsClient | undefined;
    constructor(options: CovenClientOptions);
    requireAutomations(): CovenAutomationsClient;
    health(options?: OperationOptions): Promise<CovenHealth>;
}
declare function createCovenClient(options: CovenClientOptions): CovenClient;
declare function createDiscoveredCovenClient(options: CovenDiscoveredClientOptions): Promise<CovenClient>;

interface CovenSessionPolicyUnixTransportOptions {
    readonly security: CovenUnixTransportSecurityProvider;
    readonly dependencies?: CovenUnixTransportDependencies;
}
/** Unix only. Native connected-peer validation is mandatory, never inferred from metadata. */
declare function createCovenSessionPolicyUnixTransport(discovered: CovenDiscoveredEndpoint, options: CovenSessionPolicyUnixTransportOptions): CovenSessionPolicyTransport;

interface Principal {
    readonly principalId: string;
    readonly displayName?: string;
}
interface Retention {
    readonly classification: 'ephemeral' | 'standard' | 'extended';
    readonly deleteAfter?: string;
}
/** Complete v1 wire document, distinct from the legacy get() projection. No authority is implied. */
interface CovenAutomationDefinitionDocument {
    readonly schemaVersion: 'coven.automations.v1';
    readonly automationId: string;
    readonly revision: number;
    readonly integrity: CovenAutomationReceiptDigest;
    readonly lifecycleState: 'draft' | 'paused' | 'active' | 'disabled' | 'invalid';
    readonly deletion?: {
        readonly tombstoned: true;
        readonly requestedAt: string;
        readonly requestedBy?: Principal;
        readonly reason?: string;
    };
    readonly display: {
        readonly name: string;
        readonly description?: string;
        readonly tags?: readonly string[];
    };
    readonly trigger: {
        readonly variant: 'schedule';
        readonly version: 1;
        readonly schedule: {
            readonly rrule: string;
            readonly timezone: string;
        };
    };
    readonly conditions?: readonly never[];
    readonly action: {
        readonly variant: 'familiarInvocation';
        readonly version: 1;
        readonly prompt: string;
        readonly cwd?: string;
    };
    readonly binding: {
        readonly familiarBindingPolicy: 'exact';
        /** Required for active, paused and disabled documents by the structural validator. */
        readonly familiarId?: string;
        readonly authority: {
            readonly approvalPolicyRef: string;
            readonly approvalRecordRef?: string;
        };
    };
    readonly runtimeRequirements?: {
        readonly runtimeId: string;
        readonly capabilities: readonly string[];
        readonly model?: string;
    };
    readonly policies: {
        readonly timeout: {
            readonly perRunMinutes: number;
        };
        readonly retry: {
            readonly maxAttempts: number;
            readonly backoffPolicy: 'none' | 'fixed' | 'exponential';
            readonly backoffSeconds?: number;
            readonly retryableClasses?: readonly ('transient_dispatch' | 'lease_expired' | 'runtime_unavailable')[];
        };
        readonly concurrency: {
            readonly overlap: 'forbid';
        };
        readonly misfire: {
            readonly disposition: 'latest';
        };
        /** Reserved wire shape; hashing does not advertise delivery capability. */
        readonly delivery?: {
            readonly outputTarget?: string;
            readonly mode?: 'atomic';
        };
        readonly retention: {
            readonly occurrenceHistory: Retention;
            readonly runLogs?: Retention;
            readonly receipts?: Retention;
        };
    };
    readonly provenance?: {
        readonly createdBy: Principal;
        readonly createdAt?: string;
        readonly updatedBy?: Principal;
        readonly updatedAt?: string;
        readonly importedFrom?: string;
    };
    readonly activation?: {
        readonly effectiveFrom?: string;
        readonly effectiveUntil?: string;
    };
    readonly extensions?: Readonly<Record<string, unknown>>;
}

/** Internal owned JSON representation for bounded Automations local helpers. */
type AutomationJson = null | boolean | number | string | readonly AutomationJson[] | {
    readonly [key: string]: AutomationJson;
};

type CovenAutomationDefinitionDigestResult = {
    readonly status: 'computed';
    readonly digest: CovenAutomationReceiptDigest;
} | {
    readonly status: 'invalid';
    readonly reason: 'INVALID_DEFINITION';
};
interface CovenAutomationEventIntegrity {
    readonly schema: 'valid' | 'invalid';
    readonly integrity: 'valid' | 'invalid' | 'unavailable';
    readonly producerAuthentication: {
        readonly status: 'unverified';
        readonly evidence: 'unavailable';
    };
    readonly reasons: readonly ('INVALID_EVENT' | 'INTEGRITY_ABSENT' | 'INTEGRITY_MISMATCH')[];
}
/** Hash a complete supplied document. This neither compares its integrity nor establishes authority. */
declare function computeDefinitionDigest(definition: unknown): CovenAutomationDefinitionDigestResult;
/** Optional local digest consistency; a matching digest never authenticates its producer. */
declare function verifyEventIntegrity(event: unknown): CovenAutomationEventIntegrity;

type CovenAutomationProjectionJson = AutomationJson;
type ReductionFailure = 'INVALID_EVENTS' | 'EVENT_ID_CONFLICT' | 'STREAM_MISMATCH' | 'STREAM_OUT_OF_ORDER' | 'EVENT_INTEGRITY_MISMATCH' | 'OCCURRENCE_STATE_MISMATCH' | 'OCCURRENCE_TERMINAL_REGRESSION';
type CovenAutomationEventReduction = {
    readonly status: 'projected';
    readonly stream: CovenAutomationEventStream | null;
    readonly cursor: number | null;
    readonly state: CovenAutomationProjectionJson;
    readonly stateDigest: `sha256:${string}`;
    readonly occurrenceContinuity: 'checked' | 'unavailable';
    readonly authority: 'unverified';
} | {
    readonly status: 'invalid';
    readonly reason: ReductionFailure;
};
/** Bounded supplied-batch reference projection; no persistence, transport or execution authority. */
declare function reduceAutomationEvents(events: unknown): CovenAutomationEventReduction;

export { COVEN_DAEMON_PROTOCOL, COVEN_SESSION_POLICY_CONTRACT, COVEN_SESSION_POLICY_PROFILE, type CovenAutomationAttempt, type CovenAutomationCapabilities, type CovenAutomationCapabilityProfile, type CovenAutomationCommandCommitted, type CovenAutomationCommandContext, type CovenAutomationCommandRejected, type CovenAutomationCommandRequest, type CovenAutomationCommandResult, type CovenAutomationDefinition, type CovenAutomationDefinitionDigestResult, type CovenAutomationDefinitionDocument, type CovenAutomationDefinitionList, type CovenAutomationDefinitionReadRequest, type CovenAutomationEvent, type CovenAutomationEventIntegrity, type CovenAutomationEventPage, type CovenAutomationEventReduction, type CovenAutomationEventStream, type CovenAutomationEventsOptions, type CovenAutomationEventsRequest, type CovenAutomationHealth, type CovenAutomationHealthResult, type CovenAutomationHistoryCursor, type CovenAutomationLifecycleCommand, type CovenAutomationLifecycleOptions, type CovenAutomationListOptions, type CovenAutomationOccurrence, type CovenAutomationOccurrenceDetail, type CovenAutomationOccurrenceHistoryOptions, type CovenAutomationOccurrenceHistoryPage, type CovenAutomationOccurrenceResult, type CovenAutomationOccurrenceRun, type CovenAutomationOccurrenceView, type CovenAutomationOccurrencesOptions, type CovenAutomationOccurrencesResult, type CovenAutomationProjectionJson, type CovenAutomationReceipt, type CovenAutomationReceiptDigest, type CovenAutomationReceiptReadVerification, type CovenAutomationReceiptResult, type CovenAutomationReceiptTrustContext, type CovenAutomationReceiptVerification, type CovenAutomationReceiptVerificationCheck, type CovenAutomationReceiptVerificationReason, type CovenAutomationRoutine, type CovenAutomationRun, type CovenAutomationRunCancellation, type CovenAutomationRunHistoryOptions, type CovenAutomationRunHistoryPage, type CovenAutomationRunResult, type CovenAutomationRunsOptions, type CovenAutomationRunsResult, type CovenAutomationVariant, CovenAutomationsClient, type CovenAutomationsClientOptions, type CovenAutomationsTransport, type CovenAutomationsUnixTransportOptions, type CovenAutomationsWindowsTransportOptions, CovenClient, CovenClientError, type CovenClientOptions, type CovenConnectedSocket, type CovenDaemonFailure, CovenDaemonResponseError, type CovenDiscoveredClientOptions, type CovenDiscoveredEndpoint, type CovenDiscoveredUnixClientOptions, type CovenDiscoveredUnixTransportOptions, type CovenDiscoveredWindowsClientOptions, type CovenDiscoveredWindowsTransportOptions, type CovenDiscoveryDependencies, type CovenDiscoveryFileIdentity, type CovenDiscoverySource, type CovenEndpointFreshness, type CovenEndpointOwner, type CovenExecFile, type CovenExecFileError, type CovenExecFileOptions, type CovenExecutableResolver, type CovenHealth, type CovenHealthResponse, type CovenHealthTransportLimits, type CovenIpcDiagnostics, CovenIpcError, type CovenIpcErrorCode, type CovenMetadataFileHandle, type CovenRestrictedLaunchRequest, CovenSessionPolicyClient, type CovenSessionPolicyClientOptions, type CovenSessionPolicyDelivery, type CovenSessionPolicyDiscovery, CovenSessionPolicyError, type CovenSessionPolicyErrorCode, type CovenSessionPolicyRefusal, type CovenSessionPolicyTransport, type CovenSessionPolicyTransportRequest, type CovenSessionPolicyTransportResponse, type CovenSessionPolicyUnixTransportOptions, type CovenSocket, type CovenSocketConnector, type CovenTransport, type CovenTransportSecurityProvider, type CovenUnixFileIdentity, type CovenUnixPeerIdentity, type CovenUnixPeerIdentityAdapter, type CovenUnixTransportDependencies, type CovenUnixTransportOptions, type CovenUnixTransportSecurityProvider, type CovenWindowsFileTrustValidator, type CovenWindowsPipeIdentity, type CovenWindowsPipeOwnershipAdapter, type CovenWindowsTransportDependencies, type CovenWindowsTransportOptions, type CovenWindowsTransportSecurityProvider, type DiscoverCovenEndpointOptions, computeDefinitionDigest, createCovenAutomationsClient, createCovenAutomationsUnixTransport, createCovenAutomationsWindowsTransport, createCovenClient, createCovenSessionPolicyClient, createCovenSessionPolicyUnixTransport, createCovenUnixTransport, createCovenWindowsTransport, createDiscoveredCovenClient, discoverCovenEndpoint, isCovenClientError, isCovenDaemonResponseError, isCovenIpcError, isCovenSessionPolicyError, normalizeCovenError, reduceAutomationEvents, verifyEventIntegrity, verifyReceipt };
