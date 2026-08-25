import { C as CavePairingRequest, a as CaveClient } from './client-BbxpTVKf.js';
export { b as CAVE_ANALYTICS_WINDOWS, c as CAVE_FAMILIAR_PROPERTIES, d as CAVE_PAIRING_SCOPES, e as CAVE_PAIRING_STATUSES, f as CaveAnalyticsWindowKey, g as CaveAuthorityBinding, h as CaveAuthorityBoundPairingExchange, i as CaveCanonicalFamiliar, j as CaveClientError, k as CaveClientOptions, l as CaveContractFile, m as CaveContractReport, n as CaveContractViolation, o as CaveConversation, p as CaveConversationMessage, q as CaveCredentialAccess, r as CaveCredentialBinding, s as CaveCredentialDisconnectedReason, t as CaveCredentialMetadata, u as CaveCredentialPersistingTransport, v as CaveCredentialStatus, w as CaveExecutionAttempt, x as CaveExecutionBackfill, y as CaveExecutionCoverage, z as CaveExecutionSlice, A as CaveExecutionWindow, B as CaveFamiliar, D as CaveFamiliarAnalytics, E as CaveFamiliarAnalyticsOptions, F as CaveFamiliarAnalyticsResponse, G as CaveFamiliarContract, H as CaveFamiliarContractResponse, I as CaveFamiliarProperty, J as CaveFamiliarWire, K as CaveFamiliarsResponse, L as CaveHealth, M as CaveHealthData, N as CaveHealthResponse, O as CaveManagedCredentialStatusResult, P as CaveManagedCredentialTransport, Q as CaveManagedForgetCredentialResult, R as CaveManagedNativeCredentialCustody, S as CaveManagedPairingCreated, T as CaveManagedPairingExchange, U as CavePairingCreated, V as CavePairingExchange, W as CavePairingScope, X as CavePairingSession, Y as CavePairingState, Z as CavePairingStatus, _ as CaveProject, $ as CavePropertyCoverage, a0 as CaveTransport, a1 as createCaveClient, a2 as isCaveClientError, a3 as normalizeCaveError } from './client-BbxpTVKf.js';
import { OperationOptions, OperationContext, PageOptions, OperationDefaults, SecretStore, SecretStoreReference } from '@opencoven/sdk-core';
import '@opencoven/sdk-core/browser';

type CaveDiscoveryErrorCode = 'not_found' | 'owner_mismatch' | 'unsafe_endpoint' | 'stale_record' | 'body_limit' | 'invalid_response' | 'timeout' | 'aborted';
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
interface CaveDiscoveredEndpoint {
    version: 1;
    endpoint: {
        kind: 'http';
        url: string;
    };
    freshness: CaveEndpointFreshness;
    record: CaveDiscoveryRecordIdentity;
}
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

export { CAVE_CLIENT_VERSION, CaveClient, type CaveContractCursor, type CaveContractEnvelopeMetadata, type CaveContractFixture, type CaveContractHealthData, type CaveContractIdentity, type CaveContractOperation, type CaveContractPairingCreatedData, type CaveContractPairingExchangeData, type CaveContractPairingStatusData, type CaveContractPublicRoute, type CaveContractRevision, type CaveDiscoveredClientOptions, type CaveDiscoveredEndpoint, type CaveDiscoveryDependencies, CaveDiscoveryError, type CaveDiscoveryErrorCode, type CaveDiscoveryFileHandle, type CaveDiscoveryPathIdentity, type CaveDiscoveryRecordIdentity, type CaveEndpointFreshness, type CaveManagedClientOptions, type CaveManagedNativeDiscardResult, type CaveManagedNativePairingCreated, type CaveManagedNativePairingExchange, type CaveManagedNativeResponse, type CaveManagedNativeTransport, CavePairingRequest, type CaveWindowsPathTrustResult, type CaveWindowsPathTrustValidator, type DiscoverCaveEndpointOptions, createDiscoveredCaveClient, createManagedCaveClient, digestCaveContractFixture, discoverCaveEndpoint, isCaveDiscoveryError, parseCaveContractFixture, parseVerifiedCaveContractFixture, verifyCaveContractFixtureDigest };
