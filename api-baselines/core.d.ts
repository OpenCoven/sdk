type OpenCovenSystem = 'cave' | 'coven' | 'sdk' | 'cli';
interface NormalizedError {
    system: OpenCovenSystem;
    code: string;
    retryable: boolean;
    operation: string;
    message?: string;
    requestId?: string;
    statusCode?: number;
}
interface NormalizeErrorOptions {
    system: OpenCovenSystem;
    operation: string;
    defaultCode?: string;
    retryable?: boolean;
    message?: string;
}
declare function normalizeError(error: unknown, options: NormalizeErrorOptions): NormalizedError;

interface CompatibilityAssessment {
    compatible: boolean;
    minimumClientVersion: string;
    clientVersion: string;
}
declare function assessCompatibility(minimumClientVersion: string, clientVersion: string): CompatibilityAssessment;

type OperationEvent = {
    phase: 'start';
    system: OpenCovenSystem;
    operation: string;
} | {
    phase: 'success';
    system: OpenCovenSystem;
    operation: string;
    durationMs: number;
} | {
    phase: 'failure' | 'timeout' | 'abort';
    system: OpenCovenSystem;
    operation: string;
    durationMs: number;
    error: NormalizedError;
};
interface OperationObserver {
    onEvent(event: OperationEvent): void;
    onObserverError(error: unknown, event: OperationEvent): void;
}

interface OperationDescriptor {
    system: OpenCovenSystem;
    operation: string;
}
interface OperationOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    observer?: OperationObserver;
}
interface OperationDefaults {
    timeoutMs?: number;
    observer?: OperationObserver;
}
interface OperationContext {
    signal: AbortSignal;
    deadline: number | undefined;
}
interface OperationScopeOptions {
    signals?: readonly AbortSignal[];
    timeoutMs?: number;
}
interface OperationScope {
    readonly context: OperationContext;
    readonly termination: Promise<never>;
    dispose(): void;
}
declare class OperationTimeoutError extends Error {
    readonly code = "timeout";
    readonly retryable = true;
    constructor(descriptor: OperationDescriptor, timeoutMs: number);
}
declare class OperationAbortedError extends Error {
    readonly code = "aborted";
    readonly retryable = false;
    constructor(descriptor: OperationDescriptor, options?: ErrorOptions);
}
declare class OperationConfigurationError extends TypeError {
    readonly code = "invalid_options";
    readonly retryable = false;
    constructor(message: string);
}
declare function isOperationTimeoutError(error: unknown): error is OperationTimeoutError;
declare function isOperationAbortedError(error: unknown): error is OperationAbortedError;
declare function createOperationScope(descriptor: OperationDescriptor, options?: OperationScopeOptions): OperationScope;
declare function runOperation<T>(descriptor: OperationDescriptor, options: OperationOptions, executor: (context: OperationContext) => Promise<T>): Promise<T>;

interface PageOptions {
    limit?: number;
    cursor?: string;
}
interface PageCursor {
    current?: string;
    next?: string;
    previous?: string;
    hasMore: boolean;
}
interface Page<T> {
    data: readonly T[];
    cursor?: PageCursor;
}
type BoundedPageOptions = PageOptions & OperationOptions & ({
    maxPages: number;
} | {
    signal: AbortSignal;
    maxPages?: number;
});
interface NormalizedPageOptions {
    limit: number;
    cursor?: string;
}
type PageReadOptions = NormalizedPageOptions & {
    signal: AbortSignal;
};
declare function normalizePageOptions(options?: PageOptions): NormalizedPageOptions;
declare function iteratePages<T>(readPage: (options: PageReadOptions) => Promise<Page<T>>, options: BoundedPageOptions): AsyncGenerator<T>;

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

interface SecretStore {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<boolean>;
    compareAndDelete?(key: string, expectedValue: string): Promise<'absent' | 'changed' | 'deleted'>;
}
interface ManagedSecretStore extends SecretStore {
    readonly disposed: boolean;
    clear(): Promise<void>;
    dispose(): Promise<void>;
}
interface SecretStoreReference {
    readonly key: string;
}
declare class InvalidSecretKeyError extends TypeError {
    readonly code = "invalid_secret_key";
    readonly retryable = false;
    constructor();
}
declare class SecretStoreDisposedError extends Error {
    readonly code = "secret_store_disposed";
    readonly retryable = false;
    constructor();
}
declare function createSecretStoreReference(key: string): SecretStoreReference;
declare function createMemorySecretStore(): SecretStore;
declare function createManagedMemorySecretStore(): ManagedSecretStore;

export { type BoundedPageOptions, type CompatibilityAssessment, DISCOVERY_PROFILES, DISCOVERY_PROTOCOL, DISCOVERY_RECORD_VERSION, DiscoveryContractError, type DiscoveryDiagnosticCode, type DiscoveryEndpoint, type DiscoveryProfile, type DiscoveryRecord, InvalidSecretKeyError, type ManagedSecretStore, type NormalizeErrorOptions, type NormalizedError, type OpenCovenSystem, OperationAbortedError, OperationConfigurationError, type OperationContext, type OperationDefaults, type OperationDescriptor, type OperationEvent, type OperationObserver, type OperationOptions, type OperationScope, type OperationScopeOptions, OperationTimeoutError, type Page, type PageCursor, type PageOptions, type SecretStore, SecretStoreDisposedError, type SecretStoreReference, assessCompatibility, createManagedMemorySecretStore, createMemorySecretStore, createOperationScope, createSecretStoreReference, isOperationAbortedError, isOperationTimeoutError, iteratePages, normalizeError, normalizePageOptions, parseDiscoveryEndpoint, parseDiscoveryRecord, runOperation };
