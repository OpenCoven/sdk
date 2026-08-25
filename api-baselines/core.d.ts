import { SecretStoreReference } from './browser.js';
export { BoundedPageOptions, CompatibilityAssessment, InvalidSecretKeyError, ManagedSecretStore, NormalizeErrorOptions, NormalizedError, OpenCovenSystem, OperationAbortedError, OperationConfigurationError, OperationContext, OperationDefaults, OperationDescriptor, OperationEvent, OperationObserver, OperationOptions, OperationScope, OperationScopeOptions, OperationTimeoutError, Page, PageCursor, PageOptions, SecretStore, SecretStoreDisposedError, assessCompatibility, createManagedMemorySecretStore, createMemorySecretStore, createOperationScope, createSecretStoreReference, isOperationAbortedError, isOperationTimeoutError, iteratePages, normalizeError, normalizePageOptions, runOperation } from './browser.js';

declare const DIAGNOSTIC_CHECK_IDS: readonly ["cave.discovery", "cave.health", "secure-store", "coven.discovery", "coven.health"];
declare const CAVE_CAPABILITIES: readonly ["health", "pairing", "credentials", "familiars", "projects", "conversations", "conversation-messages", "cursors"];
declare const CAVE_OPERATIONS: readonly ["health.read", "pairing.create", "pairing.poll", "pairing.exchange", "pairing.admin.list", "pairing.admin.decide", "credentials.admin.list", "credentials.admin.revoke", "familiars.list", "projects.list", "conversations.list", "conversations.read", "messages.list"];
declare const SAFE_DIAGNOSTIC_CODES: readonly ["aborted", "body_limit", "command_failed", "conflict", "connect_failure", "credential_update_in_progress", "frame_limit", "incompatible_version", "invalid_request", "invalid_response", "malformed_config", "not_found", "operation_in_progress", "owner_mismatch", "pairing_denied", "pairing_expired", "pairing_pending", "platform_security_unavailable", "rate_limited", "reconcile_required", "scope_denied", "secret_store_delete_failed", "secret_store_read_failed", "secret_store_rollback_failed", "secret_store_write_failed", "secure_store_unavailable", "service_unavailable", "stale_record", "timeout", "unknown", "unsafe_endpoint", "unsupported_operation"];
declare const OPENCOVEN_DIAGNOSTIC_VERSION = 1;
type OpenCovenDiagnosticCheckId = (typeof DIAGNOSTIC_CHECK_IDS)[number];
type OpenCovenDiagnosticCode = (typeof SAFE_DIAGNOSTIC_CODES)[number];
type OpenCovenDiagnosticCapability = (typeof CAVE_CAPABILITIES)[number] | 'event-cursor' | 'events' | 'sessions' | 'structured-errors';
type OpenCovenDiagnosticOperation = (typeof CAVE_OPERATIONS)[number];
type OpenCovenDiagnosticStatus = 'ok' | 'error' | 'skipped';
type OpenCovenDiagnosticSkipReason = 'deadline-expired' | 'dependency-failed';
type OpenCovenDiagnosticSystem = 'cave' | 'coven' | 'secure-store';
type OpenCovenDiagnosticPhase = 'credential-store' | 'discovery' | 'health';
interface OpenCovenDiagnosticRuntimeInput {
    readonly name: 'node';
    readonly version: string;
    readonly platform: string;
    readonly architecture: string;
}
type OpenCovenDiagnosticCheckInput = {
    readonly id: 'cave.discovery';
    readonly status: 'ok';
    readonly discovery?: unknown;
} | {
    readonly id: 'cave.health';
    readonly status: 'ok';
    readonly observedAt: string;
    readonly health: unknown;
} | {
    readonly id: 'secure-store';
    readonly status: 'ok';
    readonly observedAt: string;
} | {
    readonly id: 'coven.discovery';
    readonly status: 'ok';
    readonly discovery?: unknown;
} | {
    readonly id: 'coven.health';
    readonly status: 'ok';
    readonly observedAt: string;
    readonly health: unknown;
} | {
    readonly id: OpenCovenDiagnosticCheckId;
    readonly status: 'error';
    readonly error: unknown;
} | {
    readonly id: OpenCovenDiagnosticCheckId;
    readonly status: 'skipped';
    readonly skipReason: OpenCovenDiagnosticSkipReason;
};
interface OpenCovenDiagnosticReportOptions {
    readonly generatedAt: string;
    readonly packageVersion: string;
    readonly runtime: OpenCovenDiagnosticRuntimeInput;
    readonly checks: readonly OpenCovenDiagnosticCheckInput[];
}
interface OpenCovenDiagnosticEnvironment {
    readonly packageVersion: string;
    readonly runtime: 'node';
    readonly runtimeVersion: string;
    readonly platform: string;
    readonly architecture: string;
}
interface OpenCovenDiagnosticFailure {
    readonly code: OpenCovenDiagnosticCode;
    readonly retryable: boolean;
    readonly diagnosticId?: string;
}
interface OpenCovenDiagnosticFacts {
    readonly apiVersion?: string;
    readonly releaseVersion?: string;
    readonly instanceSuffix?: string;
    readonly pairingRequired?: boolean;
    readonly capabilities?: readonly OpenCovenDiagnosticCapability[];
    readonly operations?: readonly OpenCovenDiagnosticOperation[];
    readonly lastHealthyAt?: string;
    readonly backend?: 'native';
    readonly protocol?: 'coven.daemon.v1';
    readonly transport?: 'unix' | 'windows-named-pipe';
}
interface OpenCovenDiagnosticCheck {
    readonly id: OpenCovenDiagnosticCheckId;
    readonly system: OpenCovenDiagnosticSystem;
    readonly phase: OpenCovenDiagnosticPhase;
    readonly status: OpenCovenDiagnosticStatus;
    readonly outcome?: 'discovered';
    readonly facts?: OpenCovenDiagnosticFacts;
    readonly error?: OpenCovenDiagnosticFailure;
    readonly skipReason?: OpenCovenDiagnosticSkipReason;
}
interface OpenCovenDiagnosticSummary {
    readonly healthy: boolean;
    readonly ok: number;
    readonly error: number;
    readonly skipped: number;
}
interface OpenCovenDiagnosticReport {
    readonly version: 1;
    readonly generatedAt: string;
    readonly environment: OpenCovenDiagnosticEnvironment;
    readonly checks: readonly OpenCovenDiagnosticCheck[];
    readonly summary: OpenCovenDiagnosticSummary;
}
declare class OpenCovenDiagnosticError extends TypeError {
    readonly code = "invalid_diagnostics";
    readonly retryable = false;
    constructor(message: string);
}
declare function createOpenCovenDiagnosticReport(options: OpenCovenDiagnosticReportOptions): OpenCovenDiagnosticReport;

declare const DISCOVERY_RECORD_VERSION: 1;
declare const DISCOVERY_PROTOCOL: "opencoven.discovery.v1";
declare const DISCOVERY_PROFILES: readonly ["cave", "coven"];
type DiscoveryProfile = (typeof DISCOVERY_PROFILES)[number];
type DiscoveryEndpoint = {
    kind: 'http';
    url: string;
} | {
    kind: 'unix';
    path: string;
} | {
    kind: 'windowsNamedPipe';
    path: string;
};
interface DiscoveryRecord {
    version: typeof DISCOVERY_RECORD_VERSION;
    protocol: typeof DISCOVERY_PROTOCOL;
    profile: DiscoveryProfile;
    endpoint: DiscoveryEndpoint;
}
type DiscoveryDiagnosticCode = 'invalid_discovery_value' | 'unexpected_discovery_field' | 'unsupported_discovery_endpoint_kind' | 'invalid_discovery_endpoint' | 'unsupported_discovery_version' | 'unsupported_discovery_protocol' | 'unsupported_discovery_profile';
declare class DiscoveryContractError extends TypeError {
    readonly code: DiscoveryDiagnosticCode;
    readonly retryable = false;
    constructor(code: DiscoveryDiagnosticCode, message: string);
}
declare function parseDiscoveryEndpoint(value: unknown): DiscoveryEndpoint;
declare function parseDiscoveryRecord(value: unknown): DiscoveryRecord;

declare const OPENCOVEN_PROFILE_VERSION = 1;
interface OpenCovenProfile {
    readonly version: 1;
    readonly name: string;
    readonly caveHome?: string;
    readonly covenHome?: string;
    readonly defaultFamiliarId?: string;
    readonly defaultProjectId?: string;
}
interface OpenCovenProfileDocument {
    readonly version: 1;
    readonly profiles: readonly OpenCovenProfile[];
}
interface OpenCovenProfileStore {
    list(): Promise<readonly OpenCovenProfile[]>;
    get(name: string): Promise<OpenCovenProfile | undefined>;
    set(profile: OpenCovenProfile): Promise<void>;
    delete(name: string): Promise<boolean>;
    reset(): Promise<void>;
}
interface FileOpenCovenProfileStoreOptions {
    readonly path: string;
}
type OpenCovenProfileErrorCode = 'corrupt_profile_store' | 'invalid_profile' | 'invalid_profile_store_path' | 'profile_platform_security_unavailable' | 'profile_store_read_failed' | 'profile_store_write_failed' | 'unsafe_profile_store';
declare class OpenCovenProfileError extends Error {
    readonly code: OpenCovenProfileErrorCode;
    readonly retryable = false;
    constructor(code: OpenCovenProfileErrorCode, message: string);
}
declare function parseOpenCovenProfile(value: unknown): OpenCovenProfile;
declare function migrateOpenCovenProfileDocument(value: unknown): OpenCovenProfileDocument;
declare function createMemoryOpenCovenProfileStore(initial?: unknown): OpenCovenProfileStore;
declare function createFileOpenCovenProfileStore(options: FileOpenCovenProfileStoreOptions): OpenCovenProfileStore;
declare function createOpenCovenProfileSecretReference(profileName: string): SecretStoreReference;

export { DISCOVERY_PROFILES, DISCOVERY_PROTOCOL, DISCOVERY_RECORD_VERSION, DiscoveryContractError, type DiscoveryDiagnosticCode, type DiscoveryEndpoint, type DiscoveryProfile, type DiscoveryRecord, type FileOpenCovenProfileStoreOptions, OPENCOVEN_DIAGNOSTIC_VERSION, OPENCOVEN_PROFILE_VERSION, type OpenCovenDiagnosticCapability, type OpenCovenDiagnosticCheck, type OpenCovenDiagnosticCheckId, type OpenCovenDiagnosticCheckInput, type OpenCovenDiagnosticCode, type OpenCovenDiagnosticEnvironment, OpenCovenDiagnosticError, type OpenCovenDiagnosticFacts, type OpenCovenDiagnosticFailure, type OpenCovenDiagnosticOperation, type OpenCovenDiagnosticPhase, type OpenCovenDiagnosticReport, type OpenCovenDiagnosticReportOptions, type OpenCovenDiagnosticRuntimeInput, type OpenCovenDiagnosticSkipReason, type OpenCovenDiagnosticStatus, type OpenCovenDiagnosticSummary, type OpenCovenDiagnosticSystem, type OpenCovenProfile, type OpenCovenProfileDocument, OpenCovenProfileError, type OpenCovenProfileErrorCode, type OpenCovenProfileStore, SecretStoreReference, createFileOpenCovenProfileStore, createMemoryOpenCovenProfileStore, createOpenCovenDiagnosticReport, createOpenCovenProfileSecretReference, migrateOpenCovenProfileDocument, parseDiscoveryEndpoint, parseDiscoveryRecord, parseOpenCovenProfile };
