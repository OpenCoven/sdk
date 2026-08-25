// Entrypoint: .
// Declaration: dist/index.d.ts
import { DiscoveryEndpoint, OperationContext, OperationDefaults, OperationOptions, NormalizedError } from '@opencoven/sdk-core';

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

interface CovenClientOptions {
    transport: CovenTransport;
    operation?: OperationDefaults;
}
interface CovenDiscoveredClientBaseOptions {
    discovery?: DiscoverCovenEndpointOptions;
    operation?: OperationDefaults;
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
declare class CovenClient {
    #private;
    constructor(options: CovenClientOptions);
    health(options?: OperationOptions): Promise<CovenHealth>;
}
declare function createCovenClient(options: CovenClientOptions): CovenClient;
declare function createDiscoveredCovenClient(options: CovenDiscoveredClientOptions): Promise<CovenClient>;

export { COVEN_DAEMON_PROTOCOL, CovenClient, CovenClientError, type CovenClientOptions, type CovenConnectedSocket, type CovenDaemonFailure, CovenDaemonResponseError, type CovenDiscoveredClientOptions, type CovenDiscoveredEndpoint, type CovenDiscoveredUnixClientOptions, type CovenDiscoveredUnixTransportOptions, type CovenDiscoveredWindowsClientOptions, type CovenDiscoveredWindowsTransportOptions, type CovenDiscoveryDependencies, type CovenDiscoveryFileIdentity, type CovenDiscoverySource, type CovenEndpointFreshness, type CovenEndpointOwner, type CovenExecFile, type CovenExecFileError, type CovenExecFileOptions, type CovenExecutableResolver, type CovenHealth, type CovenHealthResponse, type CovenHealthTransportLimits, type CovenIpcDiagnostics, CovenIpcError, type CovenIpcErrorCode, type CovenMetadataFileHandle, type CovenSocket, type CovenSocketConnector, type CovenTransport, type CovenTransportSecurityProvider, type CovenUnixFileIdentity, type CovenUnixPeerIdentity, type CovenUnixPeerIdentityAdapter, type CovenUnixTransportDependencies, type CovenUnixTransportOptions, type CovenUnixTransportSecurityProvider, type CovenWindowsFileTrustValidator, type CovenWindowsPipeIdentity, type CovenWindowsPipeOwnershipAdapter, type CovenWindowsTransportDependencies, type CovenWindowsTransportOptions, type CovenWindowsTransportSecurityProvider, type DiscoverCovenEndpointOptions, createCovenClient, createCovenUnixTransport, createCovenWindowsTransport, createDiscoveredCovenClient, discoverCovenEndpoint, isCovenClientError, isCovenDaemonResponseError, isCovenIpcError, normalizeCovenError };
