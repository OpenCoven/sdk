import {
  assessCompatibility,
  createOperationScope,
  isOperationAbortedError,
  isOperationTimeoutError,
  iteratePages,
  normalizeError,
  normalizePageOptions,
  OperationConfigurationError,
  runOperation,
  type CompatibilityAssessment,
  type BoundedPageOptions,
  type NormalizedError,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
  type Page,
  type PageOptions,
  type SecretStore,
  type SecretStoreReference,
} from '@opencoven/sdk-core/browser';

import {
  discardPairingExchangeBearer,
  parseCaveAuthorityBinding,
} from './authority-binding-contract.js';
import { CAVE_CONTRACT_ERROR_CODES } from './contract-constraints.js';
import {
  CaveCanonicalSchemaError,
  parseConversationEnvelope,
  parseConversationMessagesEnvelope,
  parseConversationsEnvelope,
  parseFamiliarsEnvelope,
  parseProjectsEnvelope,
} from './canonical-reads.js';
import {
  forgetStoredCredential,
  inspectStoredCredentialMaterial,
  invalidateStoredCredential,
  storeBoundCredential,
} from './credential-binding.js';
import { isPairingSecretUnsentError } from './pairing-secret.js';
import { parseCaveCredentialMetadata } from './credential-metadata.js';
import { snapshotManagedResult } from './managed-snapshot.js';
import {
  CAVE_PAIRING_SCOPES,
  type CaveAuthorityBinding,
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveContractReport,
  type CaveContractViolation,
  type CaveCredentialMetadata,
  type CaveCredentialStatus,
  type CaveExecutionAttempt,
  type CaveExecutionBackfill,
  type CaveExecutionCoverage,
  type CaveExecutionSlice,
  type CaveExecutionWindow,
  type CaveFamiliar,
  type CaveFamiliarAnalytics,
  type CaveFamiliarContract,
  type CaveFamiliarWire,
  type CaveHealth,
  type CavePairingCreated,
  type CaveManagedCredentialStatusResult,
  type CaveManagedForgetCredentialResult,
  type CaveManagedPairingCreated,
  type CaveManagedPairingExchange,
  type CavePairingRequest,
  type CavePairingScope,
  type CavePairingStatus,
  type CavePropertyCoverage,
  type CaveProject,
} from './schemas.js';
import type {
  CaveCredentialPersistingTransport,
  CaveManagedCredentialTransport,
  CaveTransport,
} from './transport.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const CAVE_CLIENT_ERROR_BRAND = Symbol.for('@opencoven/cave-client/CaveClientError');
const CAVE_API_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SUPPORTED_CAVE_API_MAJOR = '1';
const ADVERTISED_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const ADVERTISED_ID_MAX_CHARACTERS = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL_43_RE = /^[A-Za-z0-9_-]{43}$/u;
const CAVE_PAIRING_SCOPE_SET = new Set<string>(CAVE_PAIRING_SCOPES);

export interface CaveCredentialBinding {
  store: SecretStore;
  reference: SecretStoreReference;
}

/**
 * Selects native custody for every Cave pairing and credential secret. A
 * managed transport is responsible for retaining, consuming, and persisting
 * those values outside JavaScript.
 */
export interface CaveManagedNativeCredentialCustody {
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

export type CaveClientOptions =
  | CaveClientOptionsWithoutCredentials
  | CaveClientOptionsWithCredentials
  | CaveClientOptionsWithManagedNativeCredentials;

export interface CaveFamiliarAnalyticsOptions extends OperationOptions {
  recentLimit?: number;
}

interface ParsedHealthResponse {
  apiVersion: string;
  minimumClientVersion: string;
  health: CaveHealth;
}

interface CavePairingSessionOptions {
  requestId: string;
  expiresAt: number;
  exchange: (options?: OperationOptions) => Promise<CaveCredentialMetadata>;
  poll: (options?: OperationOptions) => Promise<CavePairingStatus>;
}

function ownDataErrorShape(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) {
    return {};
  }

  try {
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const shape: Record<string, unknown> = {};
    for (const key of ['code', 'requestId', 'retryable', 'status', 'statusCode', 'details'] as const) {
      const descriptor = descriptors[key];
      if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
        shape[key] = descriptor.value;
      }
    }
    return shape;
  } catch {
    return {};
  }
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const details = Object.entries(value as Record<string, unknown>);
  if (details.some(([, entry]) => typeof entry !== 'string')) {
    return undefined;
  }

  return Object.fromEntries(details) as Record<string, string>;
}

export function normalizeCaveError(error: unknown, operation: string): NormalizedError {
  return normalizeError(ownDataErrorShape(error), {
    system: 'cave',
    operation,
    message: `Cave ${operation} request failed`,
  });
}

export class CaveClientError extends Error {
  readonly normalized: NormalizedError;
  readonly compatibility: CompatibilityAssessment | undefined;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;
  readonly details: Record<string, string> | undefined;

  constructor(
    normalized: NormalizedError,
    compatibility?: CompatibilityAssessment,
    options?: ErrorOptions,
  ) {
    const suffix =
      compatibility === undefined
        ? ''
        : ` (minimum ${compatibility.minimumClientVersion}, client ${compatibility.clientVersion})`;

    super(`${normalized.system}.${normalized.operation}: ${normalized.code}${suffix}`, options);
    this.name = 'CaveClientError';
    this.normalized = normalized;
    this.compatibility = compatibility;
    this.code = normalized.code;
    this.retryable = normalized.retryable;
    this.requestId = normalized.requestId;
    this.statusCode = normalized.statusCode;
    this.details = asStringRecord(ownDataErrorShape(options?.cause).details);
    Object.defineProperty(this, CAVE_CLIENT_ERROR_BRAND, { value: true });
  }
}

export function isCaveClientError(error: unknown): error is CaveClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    return Reflect.get(error, CAVE_CLIENT_ERROR_BRAND) === true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Copies only own data properties from an untrusted native bridge result.
 * Accessors and prototypes are rejected so a bridge cannot execute arbitrary
 * code or smuggle values into SDK validation through a getter.
 */
function managedDataRecord(value: unknown): Record<string, unknown> | undefined {
  const snapshot = snapshotManagedResult(value);
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return undefined;
  }

  return snapshot as Record<string, unknown>;
}

function immutableManagedResult<T>(value: T): T {
  const snapshot = snapshotManagedResult(value);
  if (snapshot === undefined) {
    throw new TypeError('Managed result snapshot was malformed.');
  }
  return snapshot as T;
}

function ownConfigurationRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  try {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) => {
          if (typeof key !== 'string') {
            return true;
          }
          const descriptor = descriptors[key];
          return (
            !allowedKeys.includes(key) ||
            descriptor === undefined ||
            !Object.hasOwn(descriptor, 'value')
          );
        },
      )
    ) {
      return undefined;
    }

    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key as string];
      if (descriptor === undefined) {
        return undefined;
      }
      Object.defineProperty(record, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return Object.freeze(record);
  } catch {
    return undefined;
  }
}

interface CapturedCaveClientOptions {
  transport: CaveTransport;
  operation: OperationDefaults | undefined;
  credentials: CaveCredentialBinding | undefined;
  credentialCustody: { mode: unknown } | undefined;
}

function captureCaveClientOptions(
  value: unknown,
): CapturedCaveClientOptions | undefined {
  const options = ownConfigurationRecord(value, [
    'transport',
    'operation',
    'credentials',
    'credentialCustody',
  ]);
  if (options === undefined || !Object.hasOwn(options, 'transport')) {
    return undefined;
  }

  let operation: OperationDefaults | undefined;
  if (options.operation !== undefined) {
    const capturedOperation = ownConfigurationRecord(options.operation, [
      'timeoutMs',
      'observer',
    ]);
    if (capturedOperation === undefined) {
      return undefined;
    }
    operation = Object.freeze({
      ...(capturedOperation.timeoutMs !== undefined
        ? { timeoutMs: capturedOperation.timeoutMs as number }
        : {}),
      ...(capturedOperation.observer !== undefined
        ? { observer: capturedOperation.observer as NonNullable<OperationDefaults['observer']> }
        : {}),
    });
  }

  let credentials: CaveCredentialBinding | undefined;
  if (options.credentials !== undefined) {
    const capturedCredentials = ownConfigurationRecord(options.credentials, [
      'store',
      'reference',
    ]);
    if (
      capturedCredentials === undefined ||
      !Object.hasOwn(capturedCredentials, 'store') ||
      !Object.hasOwn(capturedCredentials, 'reference')
    ) {
      return undefined;
    }
    credentials = Object.freeze({
      store: capturedCredentials.store as SecretStore,
      reference: capturedCredentials.reference as SecretStoreReference,
    });
  }

  let credentialCustody: { mode: unknown } | undefined;
  if (options.credentialCustody !== undefined) {
    const capturedCustody = ownConfigurationRecord(options.credentialCustody, ['mode']);
    if (
      capturedCustody === undefined ||
      !Object.hasOwn(capturedCustody, 'mode')
    ) {
      return undefined;
    }
    credentialCustody = Object.freeze({ mode: capturedCustody.mode });
  }

  return Object.freeze({
    transport: options.transport as CaveTransport,
    operation,
    credentials,
    credentialCustody,
  });
}

function hasExactManagedKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseManagedPairingCreated(
  value: unknown,
): CaveManagedPairingCreated | undefined {
  const result = managedDataRecord(value);
  if (
    result === undefined ||
    !hasExactManagedKeys(result, ['requestId', 'expiresAt']) ||
    typeof result.requestId !== 'string' ||
    !UUID_RE.test(result.requestId) ||
    typeof result.expiresAt !== 'number' ||
    !Number.isSafeInteger(result.expiresAt) ||
    result.expiresAt <= 0
  ) {
    return undefined;
  }

  return immutableManagedResult({
    requestId: result.requestId,
    expiresAt: result.expiresAt,
  });
}

function parseManagedPairingExchange(
  value: unknown,
): CaveManagedPairingExchange | undefined {
  const result = managedDataRecord(value);
  if (result === undefined || !hasExactManagedKeys(result, ['credential'])) {
    return undefined;
  }

  const metadata = parseCaveCredentialMetadata(result.credential);
  if (metadata === undefined) {
    return undefined;
  }

  return immutableManagedResult({
    credential: {
      id: metadata.id,
      appName: metadata.appName,
      installationId: metadata.installationId,
      scopes: [...metadata.scopes],
      createdAt: metadata.createdAt,
      lastUsedAt: metadata.lastUsedAt,
      revokedAt: metadata.revokedAt,
      revocationReason: metadata.revocationReason,
    },
  });
}

function parseManagedPairingStatus(
  value: unknown,
): CavePairingStatus | undefined {
  const result = managedDataRecord(value);
  const status = result === undefined
    ? undefined
    : parseDirectPairingStatus(result);
  if (
    result === undefined ||
    status === undefined ||
    !hasExactManagedKeys(result, ['id', 'status', 'expiresAt']) ||
    status.id !== result.id ||
    status.status !== result.status ||
    status.expiresAt !== result.expiresAt
  ) {
    return undefined;
  }

  return immutableManagedResult({
    id: status.id,
    status: status.status,
    expiresAt: status.expiresAt,
  });
}

function parseManagedCredentialStatus(
  value: unknown,
): CaveManagedCredentialStatusResult | undefined {
  const result = managedDataRecord(value);
  if (result === undefined || typeof result.status !== 'string') {
    return undefined;
  }

  if (result.status === 'missing' && hasExactManagedKeys(result, ['status'])) {
    return immutableManagedResult({ status: 'missing' });
  }
  if (
    result.status === 'disconnected' &&
    hasExactManagedKeys(result, ['status', 'reason']) &&
    (result.reason === 'credential_update_in_progress' ||
      result.reason === 'reconcile_required')
  ) {
    return immutableManagedResult({
      status: 'disconnected',
      reason: result.reason,
    });
  }
  if (result.status === 'revoked' && hasExactManagedKeys(result, ['status', 'health'])) {
    return immutableManagedResult({ status: 'revoked', health: result.health });
  }
  if (
    result.status === 'valid' &&
    hasExactManagedKeys(result, ['status', 'access', 'health']) &&
    (result.access === 'chat:read' ||
      result.access === 'scope_denied' ||
      result.access === 'service_unavailable' ||
      result.access === 'rate_limited')
  ) {
    return immutableManagedResult({
      status: 'valid',
      access: result.access,
      health: result.health,
    });
  }

  return undefined;
}

function parseManagedForgetCredential(
  value: unknown,
): CaveManagedForgetCredentialResult | undefined {
  const result = managedDataRecord(value);
  if (
    result === undefined ||
    !hasExactManagedKeys(result, ['status']) ||
    (result.status !== 'deleted' &&
      result.status !== 'missing' &&
      result.status !== 'credential_update_in_progress')
  ) {
    return undefined;
  }

  return immutableManagedResult({ status: result.status });
}

const MANAGED_NATIVE_ERROR_CODES = new Set<string>([
  ...CAVE_CONTRACT_ERROR_CODES,
  'aborted',
  'body_limit',
  'conflict',
  'credential_update_in_progress',
  'invalid_response',
  'scope_denied',
  'timeout',
  'unsupported_operation',
]);

function redactedManagedTransportError(error: unknown, operation: string): CaveClientError {
  const shape = ownDataErrorShape(error);
  const code =
    typeof shape.code === 'string' && MANAGED_NATIVE_ERROR_CODES.has(shape.code)
      ? shape.code
      : 'invalid_response';
  const retryable = shape.retryable === true;

  return new CaveClientError(
    normalizeCaveError({ code, retryable }, operation),
  );
}

function redactedManagedCancellationError(
  error: unknown,
  operation: string,
): CaveClientError {
  const code = isOperationTimeoutError(error) ? 'timeout' : 'aborted';
  return new CaveClientError(
    normalizeCaveError(
      {
        code,
        retryable: code === 'timeout',
      },
      operation,
    ),
  );
}

function invalidHealthResponse(): CaveClientError {
  return new CaveClientError(
    normalizeCaveError(
      {
        code: 'invalid_response',
      },
      'health',
    ),
  );
}

function parseAdvertisedIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      candidate.length > ADVERTISED_ID_MAX_CHARACTERS ||
      !ADVERTISED_ID_PATTERN.test(candidate) ||
      seen.has(candidate)
    ) {
      return undefined;
    }
    seen.add(candidate);
    parsed.push(candidate);
  }

  return parsed;
}

function parseHealthResponse(response: unknown): ParsedHealthResponse | undefined {
  if (!isObject(response)) {
    return undefined;
  }

  if (typeof response.apiVersion !== 'string') {
    return undefined;
  }

  if (typeof response.minimumClientVersion !== 'string') {
    return undefined;
  }

  if (response.requestId !== undefined && typeof response.requestId !== 'string') {
    return undefined;
  }

  const capabilities = parseAdvertisedIds(response.capabilities);
  if (capabilities === undefined) {
    return undefined;
  }

  const operations = parseAdvertisedIds(response.operations);
  if (operations === undefined) {
    return undefined;
  }

  if (!isObject(response.data)) {
    return undefined;
  }

  if (
    typeof response.data.instanceId !== 'string' ||
    response.data.instanceId.length === 0 ||
    typeof response.data.pairingRequired !== 'boolean' ||
    typeof response.data.releaseVersion !== 'string' ||
    response.data.releaseVersion.length === 0
  ) {
    return undefined;
  }

  return {
    apiVersion: response.apiVersion,
    minimumClientVersion: response.minimumClientVersion,
    health: Object.freeze({
      status: 'ok',
      apiVersion: response.apiVersion,
      minimumClientVersion: response.minimumClientVersion,
      capabilities: Object.freeze(capabilities),
      operations: Object.freeze(operations),
      instanceId: response.data.instanceId,
      pairingRequired: response.data.pairingRequired,
      releaseVersion: response.data.releaseVersion,
    }),
  };
}


// ── Familiars ───────────────────────────────────────────────────────────────

function invalidResponse(operation: string): CaveClientError {
  return new CaveClientError(normalizeCaveError({ code: 'invalid_response' }, operation));
}

function invalidRequest(operation: string): CaveClientError {
  return new CaveClientError(normalizeCaveError({ code: 'invalid_request' }, operation));
}

function unsupported(operation: string): CaveClientError {
  return new CaveClientError(normalizeCaveError({ code: 'unsupported_operation' }, operation));
}

function invalidCanonicalResponse(
  operation: string,
  field: string,
): CaveClientError {
  return new CaveClientError(
    normalizeCaveError({ code: 'invalid_response' }, operation),
    undefined,
    {
      cause: {
        code: 'invalid_response',
        details: { field },
        retryable: false,
      },
    },
  );
}

function validateCanonicalId(id: unknown, label: string): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new OperationConfigurationError(
      `${label} must be a non-empty string`,
    );
  }
  if (id === '.' || id === '..') {
    throw new OperationConfigurationError(
      `${label} must not be a dot path segment`,
    );
  }

  return id;
}

function secretStoreWriteFailed(operation: string, cause: unknown): CaveClientError {
  return new CaveClientError(
    normalizeCaveError({ code: 'secret_store_write_failed' }, operation),
    undefined,
    { cause },
  );
}

function invalidAuthorityBinding(
  operation: string,
  reason: 'authority_binding_invalid' | 'authority_binding_missing',
): CaveClientError {
  return new CaveClientError(
    normalizeCaveError({ code: 'invalid_response' }, operation),
    undefined,
    {
      cause: {
        code: 'invalid_response',
        details: { reason },
        retryable: false,
      },
    },
  );
}

async function racePrePersistencePhase<T>(
  operation: Promise<T>,
  termination: Promise<never>,
  onLateSuccess: (value: T) => void,
): Promise<T> {
  let settled = false;
  const tracked = Promise.resolve(operation).finally(() => {
    settled = true;
  });

  try {
    return await Promise.race([tracked, termination]);
  } catch (error) {
    if ((isOperationTimeoutError(error) || isOperationAbortedError(error)) && !settled) {
      void tracked.then(
        (value) => {
          try {
            onLateSuccess(value);
          } catch {
            // Best effort only.
          }
        },
        () => undefined,
      );
    }
    throw error;
  }
}

function operationDuration(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function notifyOperationObserver(
  observer: OperationDefaults['observer'],
  event: {
    phase: 'start';
    system: 'cave';
    operation: string;
  } | {
    phase: 'success';
    system: 'cave';
    operation: string;
    durationMs: number;
  } | {
    phase: 'failure' | 'timeout' | 'abort';
    system: 'cave';
    operation: string;
    durationMs: number;
    error: NormalizedError;
  },
): void {
  if (observer === undefined) {
    return;
  }

  try {
    observer.onEvent(event);
  } catch (error) {
    observer.onObserverError(error, event);
  }
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  try {
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' && code.length > 0 ? code : undefined;
  } catch {
    return undefined;
  }
}

function replayedPairing(operation: string): CaveClientError {
  return new CaveClientError(
    normalizeCaveError(
      {
        code: 'conflict',
        retryable: false,
        details: { reason: 'pairing_replayed' },
      },
      operation,
    ),
    undefined,
    {
      cause: {
        code: 'conflict',
        retryable: false,
        details: { reason: 'pairing_replayed' },
      },
    },
  );
}

function pairingOperationInProgress(operation: string): CaveClientError {
  const cause = {
    code: 'operation_in_progress',
    retryable: true,
    details: { reason: 'pairing_poll_in_progress' },
  };

  return new CaveClientError(normalizeCaveError(cause, operation), undefined, { cause });
}

/**
 * A Cave route that answers `{ ok: false, error }` has failed in a way the
 * caller should hear about in the same shape as a transport failure. Left
 * unchecked it would return an envelope with no payload and the caller would
 * read `undefined` as "no familiars" rather than as "the request failed".
 */
function refusalOf(response: Record<string, unknown>, operation: string): CaveClientError | null {
  if (response.ok === false) {
    const reason = typeof response.reason === 'string' ? response.reason : 'request_failed';
    const message = typeof response.error === 'string' ? response.error : undefined;

    return new CaveClientError(normalizeCaveError({ code: reason, message }, operation), undefined, {
      cause: {
        code: reason,
        message,
      },
    });
  }

  return null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isFamiliarWire(value: unknown): value is CaveFamiliarWire {
  if (!isObject(value)) {
    return false;
  }

  return (
    isString(value.id) &&
    isString(value.display_name) &&
    isString(value.role) &&
    optionalString(value.description) &&
    optionalString(value.pronouns) &&
    optionalString(value.status) &&
    optionalString(value.last_seen) &&
    optionalNumber(value.active_sessions) &&
    optionalString(value.memory_freshness)
  );
}

/** The one place the wire's snake_case meets the rest of the program. */
function toFamiliar(wire: CaveFamiliarWire): CaveFamiliar {
  return {
    id: wire.id,
    displayName: wire.display_name,
    role: wire.role,
    ...(wire.description === undefined ? {} : { description: wire.description }),
    ...(wire.pronouns === undefined ? {} : { pronouns: wire.pronouns }),
    ...(wire.status === undefined ? {} : { status: wire.status }),
    ...(wire.last_seen === undefined ? {} : { lastSeen: wire.last_seen }),
    ...(wire.active_sessions === undefined ? {} : { activeSessions: wire.active_sessions }),
    ...(wire.memory_freshness === undefined ? {} : { memoryFreshness: wire.memory_freshness }),
  };
}

function isViolation(value: unknown): boolean {
  return (
    isObject(value) && isString(value.file) && isString(value.field) && isString(value.message)
  );
}

function isContractReport(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  if (!isString(value.specVersion) || typeof value.pass !== 'boolean') {
    return false;
  }

  // `warnings` is required, not optional. A report that omits it is not a
  // report with no warnings -- it is a shape this client does not recognise,
  // and reading it as "none" would quietly hide the difference.
  if (
    !Array.isArray(value.properties) ||
    !Array.isArray(value.violations) ||
    !Array.isArray(value.warnings)
  ) {
    return false;
  }

  if (!value.violations.every(isViolation) || !value.warnings.every(isViolation)) {
    return false;
  }

  return value.properties.every(
    (entry) => isObject(entry) && isString(entry.property) && typeof entry.pass === 'boolean',
  );
}

function isSlice(value: unknown): value is CaveExecutionSlice {
  if (!isObject(value) || !isString(value.key)) {
    return false;
  }

  const counts = ['attempts', 'completed', 'failed', 'cancelled', 'toolCalls', 'toolFailures'];

  if (!counts.every((key) => typeof value[key] === 'number')) {
    return false;
  }

  return value.successRate === null || typeof value.successRate === 'number';
}

function isCoverage(value: unknown): value is CaveExecutionCoverage {
  return (
    isObject(value) &&
    typeof value.known === 'number' &&
    typeof value.total === 'number' &&
    typeof value.ratio === 'number'
  );
}

function isWindow(value: unknown): value is CaveExecutionWindow {
  if (!isObject(value)) {
    return false;
  }

  const counts = ['attempts', 'completed', 'failed', 'cancelled', 'toolCalls', 'toolFailures'];

  if (!counts.every((key) => typeof value[key] === 'number')) {
    return false;
  }

  // Null is meaningful: a success rate over no attempts is not zero.
  if (value.successRate !== null && typeof value.successRate !== 'number') {
    return false;
  }

  if (
    !Array.isArray(value.models) ||
    !Array.isArray(value.harnesses) ||
    !value.models.every(isSlice) ||
    !value.harnesses.every(isSlice)
  ) {
    return false;
  }

  // Absent coverage is allowed; present-but-malformed is not.
  if (value.coverage !== undefined) {
    if (!isObject(value.coverage) || !Object.values(value.coverage).every(isCoverage)) {
      return false;
    }
  }

  return true;
}

function isAttempt(value: unknown): value is CaveExecutionAttempt {
  if (!isObject(value)) {
    return false;
  }

  return (
    isString(value.id) &&
    isString(value.executionKind) &&
    isString(value.occurredAt) &&
    isString(value.harnessId) &&
    (value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled') &&
    typeof value.toolCalls === 'number' &&
    typeof value.toolFailures === 'number'
  );
}

function isAnalytics(value: unknown): value is CaveFamiliarAnalytics {
  if (!isObject(value)) {
    return false;
  }

  if (!isString(value.generatedAt) || !isObject(value.windows)) {
    return false;
  }

  if (!Array.isArray(value.recentAttempts) || !value.recentAttempts.every(isAttempt)) {
    return false;
  }

  if (!Object.values(value.windows).every(isWindow)) {
    return false;
  }

  const backfill = value.backfill;

  if (!isObject(backfill) || typeof backfill.imported !== 'number') {
    return false;
  }

  if (
    backfill.state !== 'complete' &&
    backfill.state !== 'partial' &&
    backfill.state !== 'not-started'
  ) {
    return false;
  }

  return backfill.remaining === undefined || typeof backfill.remaining === 'number';
}

function managedContractViolation(
  value: unknown,
): CaveContractViolation | undefined {
  if (
    !isObject(value) ||
    !isString(value.file) ||
    !isString(value.field) ||
    !isString(value.message)
  ) {
    return undefined;
  }
  return {
    file: value.file as CaveContractViolation['file'],
    field: value.field,
    message: value.message,
  };
}

function managedPropertyCoverage(
  value: unknown,
): CavePropertyCoverage | undefined {
  if (
    !isObject(value) ||
    !isString(value.property) ||
    typeof value.pass !== 'boolean'
  ) {
    return undefined;
  }
  return { property: value.property, pass: value.pass };
}

function managedContractReport(value: unknown): CaveContractReport | undefined {
  if (
    !isObject(value) ||
    !isString(value.specVersion) ||
    typeof value.pass !== 'boolean' ||
    !Array.isArray(value.properties) ||
    !Array.isArray(value.violations) ||
    !Array.isArray(value.warnings)
  ) {
    return undefined;
  }

  const properties: CavePropertyCoverage[] = [];
  const violations: CaveContractViolation[] = [];
  const warnings: CaveContractViolation[] = [];
  for (const property of value.properties) {
    const parsed = managedPropertyCoverage(property);
    if (parsed === undefined) {
      return undefined;
    }
    properties.push(parsed);
  }
  for (const violation of value.violations) {
    const parsed = managedContractViolation(violation);
    if (parsed === undefined) {
      return undefined;
    }
    violations.push(parsed);
  }
  for (const warning of value.warnings) {
    const parsed = managedContractViolation(warning);
    if (parsed === undefined) {
      return undefined;
    }
    warnings.push(parsed);
  }

  return {
    specVersion: value.specVersion,
    pass: value.pass,
    properties,
    violations,
    warnings,
  };
}

function optionalManagedString(
  value: object,
  key: string,
): string | undefined | false {
  const candidate = (value as Record<string, unknown>)[key];
  return candidate === undefined || typeof candidate === 'string'
    ? candidate
    : false;
}

function optionalManagedNumber(
  value: object,
  key: string,
): number | undefined | false {
  const candidate = (value as Record<string, unknown>)[key];
  return candidate === undefined || typeof candidate === 'number'
    ? candidate
    : false;
}

function managedExecutionSlice(
  value: unknown,
): CaveExecutionSlice | undefined {
  if (!isSlice(value)) {
    return undefined;
  }
  const label = optionalManagedString(value, 'label');
  const medianDurationMs = optionalManagedNumber(value, 'medianDurationMs');
  const totalTokens = optionalManagedNumber(value, 'totalTokens');
  const costUsd = optionalManagedNumber(value, 'costUsd');
  if (
    label === false ||
    medianDurationMs === false ||
    totalTokens === false ||
    costUsd === false
  ) {
    return undefined;
  }
  return {
    key: value.key,
    ...(label === undefined ? {} : { label }),
    attempts: value.attempts,
    completed: value.completed,
    failed: value.failed,
    cancelled: value.cancelled,
    successRate: value.successRate,
    ...(medianDurationMs === undefined ? {} : { medianDurationMs }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    toolCalls: value.toolCalls,
    toolFailures: value.toolFailures,
  };
}

function managedExecutionCoverage(
  value: unknown,
): CaveExecutionCoverage | undefined {
  if (!isCoverage(value)) {
    return undefined;
  }
  return {
    known: value.known,
    total: value.total,
    ratio: value.ratio,
  };
}

function managedExecutionWindow(
  value: unknown,
): CaveExecutionWindow | undefined {
  if (!isWindow(value)) {
    return undefined;
  }
  const medianDurationMs = optionalManagedNumber(value, 'medianDurationMs');
  const p95DurationMs = optionalManagedNumber(value, 'p95DurationMs');
  const totalTokens = optionalManagedNumber(value, 'totalTokens');
  const costUsd = optionalManagedNumber(value, 'costUsd');
  if (
    medianDurationMs === false ||
    p95DurationMs === false ||
    totalTokens === false ||
    costUsd === false
  ) {
    return undefined;
  }

  const models: CaveExecutionSlice[] = [];
  const harnesses: CaveExecutionSlice[] = [];
  for (const model of value.models) {
    const parsed = managedExecutionSlice(model);
    if (parsed === undefined) {
      return undefined;
    }
    models.push(parsed);
  }
  for (const harness of value.harnesses) {
    const parsed = managedExecutionSlice(harness);
    if (parsed === undefined) {
      return undefined;
    }
    harnesses.push(parsed);
  }

  const coverage: Record<string, CaveExecutionCoverage> = {};
  if (value.coverage !== undefined) {
    for (const [key, entry] of Object.entries(value.coverage)) {
      const parsed = managedExecutionCoverage(entry);
      if (parsed === undefined) {
        return undefined;
      }
      coverage[key] = parsed;
    }
  }

  return {
    attempts: value.attempts,
    completed: value.completed,
    failed: value.failed,
    cancelled: value.cancelled,
    successRate: value.successRate,
    ...(medianDurationMs === undefined ? {} : { medianDurationMs }),
    ...(p95DurationMs === undefined ? {} : { p95DurationMs }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    toolCalls: value.toolCalls,
    toolFailures: value.toolFailures,
    models,
    harnesses,
    coverage,
  };
}

function managedExecutionAttempt(
  value: unknown,
): CaveExecutionAttempt | undefined {
  if (!isAttempt(value)) {
    return undefined;
  }
  const sessionId = optionalManagedString(value, 'sessionId');
  const turnId = optionalManagedString(value, 'turnId');
  const harnessVersion = optionalManagedString(value, 'harnessVersion');
  const requestedModel = optionalManagedString(value, 'requestedModel');
  const forwardedModel = optionalManagedString(value, 'forwardedModel');
  const confirmedModel = optionalManagedString(value, 'confirmedModel');
  const durationMs = optionalManagedNumber(value, 'durationMs');
  const totalTokens = optionalManagedNumber(value, 'totalTokens');
  const costUsd = optionalManagedNumber(value, 'costUsd');
  if (
    sessionId === false ||
    turnId === false ||
    harnessVersion === false ||
    requestedModel === false ||
    forwardedModel === false ||
    confirmedModel === false ||
    durationMs === false ||
    totalTokens === false ||
    costUsd === false
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(turnId === undefined ? {} : { turnId }),
    executionKind: value.executionKind,
    occurredAt: value.occurredAt,
    harnessId: value.harnessId,
    ...(harnessVersion === undefined ? {} : { harnessVersion }),
    ...(requestedModel === undefined ? {} : { requestedModel }),
    ...(forwardedModel === undefined ? {} : { forwardedModel }),
    ...(confirmedModel === undefined ? {} : { confirmedModel }),
    status: value.status,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    toolCalls: value.toolCalls,
    toolFailures: value.toolFailures,
  };
}

function managedExecutionBackfill(
  value: unknown,
): CaveExecutionBackfill | undefined {
  if (
    !isObject(value) ||
    (value.state !== 'complete' &&
      value.state !== 'partial' &&
      value.state !== 'not-started') ||
    typeof value.imported !== 'number'
  ) {
    return undefined;
  }
  if (value.remaining !== undefined && typeof value.remaining !== 'number') {
    return undefined;
  }
  return {
    state: value.state,
    imported: value.imported,
    ...(value.remaining === undefined ? {} : { remaining: value.remaining }),
  };
}

function managedFamiliarAnalytics(
  value: unknown,
): CaveFamiliarAnalytics | undefined {
  if (
    !isObject(value) ||
    !isString(value.generatedAt) ||
    !isObject(value.windows) ||
    !Array.isArray(value.recentAttempts)
  ) {
    return undefined;
  }

  const windows: CaveFamiliarAnalytics['windows'] = {};
  for (const key of ['7d', '14d', '8w', 'all'] as const) {
    const candidate = value.windows[key];
    if (candidate === undefined) {
      continue;
    }
    const parsed = managedExecutionWindow(candidate);
    if (parsed === undefined) {
      return undefined;
    }
    windows[key] = parsed;
  }

  const recentAttempts: CaveExecutionAttempt[] = [];
  for (const attempt of value.recentAttempts) {
    const parsed = managedExecutionAttempt(attempt);
    if (parsed === undefined) {
      return undefined;
    }
    recentAttempts.push(parsed);
  }
  const backfill = managedExecutionBackfill(value.backfill);
  if (backfill === undefined) {
    return undefined;
  }

  return {
    generatedAt: value.generatedAt,
    windows,
    recentAttempts,
    backfill,
  };
}

function isPairingRequest(value: unknown): value is CavePairingRequest {
  if (!isObject(value)) {
    return false;
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !['appName', 'installationId', 'scopes'].includes(key))) {
    return false;
  }

  return true;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }

  return false;
}

function validatePairingRequest(value: unknown): CavePairingRequest {
  if (!isPairingRequest(value)) {
    throw invalidRequest('pairingCreate');
  }

  const appNameInput = value.appName;
  const installationIdInput = value.installationId;
  const scopesInput = value.scopes;

  if (typeof appNameInput !== 'string' || appNameInput.length === 0 || appNameInput.length > 128) {
    throw invalidRequest('pairingCreate');
  }
  const appName = appNameInput.trim();
  if (appName.length === 0 || containsControlCharacter(appName)) {
    throw invalidRequest('pairingCreate');
  }

  if (
    typeof installationIdInput !== 'string' ||
    installationIdInput.length === 0 ||
    installationIdInput.length > 128
  ) {
    throw invalidRequest('pairingCreate');
  }
  const installationId = installationIdInput.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(installationId)) {
    throw invalidRequest('pairingCreate');
  }

  if (!Array.isArray(scopesInput) || scopesInput.length === 0) {
    throw invalidRequest('pairingCreate');
  }
  const scopes: CavePairingScope[] = [];
  for (const scope of scopesInput) {
    if (typeof scope !== 'string' || !CAVE_PAIRING_SCOPE_SET.has(scope)) {
      throw invalidRequest('pairingCreate');
    }
    if (scopes.includes(scope)) {
      throw invalidRequest('pairingCreate');
    }
    scopes.push(scope);
  }

  return {
    appName,
    installationId,
    scopes,
  };
}

function parseDirectPairingCreated(
  value: unknown,
): CavePairingCreated | undefined {
  if (!isObject(value) || Array.isArray(value)) {
    return undefined;
  }
  let requestId: unknown;
  let secret: unknown;
  let expiresAt: unknown;
  try {
    requestId = value.requestId;
    secret = value.secret;
    expiresAt = value.expiresAt;
  } catch {
    return undefined;
  }
  return (
    typeof requestId === 'string' &&
    UUID_RE.test(requestId) &&
    typeof secret === 'string' &&
    BASE64URL_43_RE.test(secret) &&
    typeof expiresAt === 'number' &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > 0
  )
    ? { requestId, secret, expiresAt }
    : undefined;
}

function parseDirectPairingStatus(
  value: unknown,
): CavePairingStatus | undefined {
  if (!isObject(value) || Array.isArray(value)) {
    return undefined;
  }
  let id: unknown;
  let status: unknown;
  let expiresAt: unknown;
  try {
    id = value.id;
    status = value.status;
    expiresAt = value.expiresAt;
  } catch {
    return undefined;
  }
  return (
    typeof id === 'string' &&
    UUID_RE.test(id) &&
    (status === 'pending' ||
      status === 'approved' ||
      status === 'denied' ||
      status === 'expired') &&
    typeof expiresAt === 'number' &&
    Number.isSafeInteger(expiresAt) &&
    expiresAt > 0
  )
    ? { id, status, expiresAt }
    : undefined;
}

interface ParsedDirectPairingExchange {
  bearer: string;
  credential: CaveCredentialMetadata;
  authorityBinding:
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'valid'; authorityBinding: CaveAuthorityBinding };
}

function parseDirectPairingExchange(
  value: unknown,
): ParsedDirectPairingExchange | undefined {
  if (!isObject(value) || Array.isArray(value)) {
    return undefined;
  }

  let bearer: unknown;
  let credential: unknown;
  let candidate: unknown;
  try {
    bearer = value.bearer;
    credential = value.credential;
    candidate = value.authorityBinding;
  } catch {
    return undefined;
  }

  if (typeof bearer !== 'string' || !BASE64URL_43_RE.test(bearer)) {
    return undefined;
  }
  const parsedCredential = parseCaveCredentialMetadata(credential, {
    allowAdditionalFields: true,
  });
  if (parsedCredential === undefined) {
    return undefined;
  }
  if (candidate === undefined) {
    return {
      bearer,
      credential: parsedCredential,
      authorityBinding: { status: 'missing' },
    };
  }

  const authorityBinding = parseCaveAuthorityBinding(
    snapshotManagedResult(candidate),
  );
  return {
    bearer,
    credential: parsedCredential,
    authorityBinding:
      authorityBinding === undefined
        ? { status: 'invalid' }
        : { status: 'valid', authorityBinding },
  };
}

export class CavePairingSession {
  readonly requestId: string;
  readonly expiresAt: number;
  readonly #poll: (options?: OperationOptions) => Promise<CavePairingStatus>;
  readonly #exchange: (options?: OperationOptions) => Promise<CaveCredentialMetadata>;

  constructor(options: CavePairingSessionOptions) {
    this.requestId = options.requestId;
    this.expiresAt = options.expiresAt;
    this.#poll = options.poll;
    this.#exchange = options.exchange;
  }

  poll(options: OperationOptions = {}): Promise<CavePairingStatus> {
    return this.#poll(options);
  }

  exchange(options: OperationOptions = {}): Promise<CaveCredentialMetadata> {
    return this.#exchange(options);
  }
}

export class CaveClient {
  readonly #transport: CaveTransport;
  readonly #operation: OperationDefaults | undefined;
  readonly #credentials: CaveCredentialBinding | undefined;
  readonly #managedCredentialTransport: CaveManagedCredentialTransport | undefined;

  constructor(options: CaveClientOptions) {
    const captured = captureCaveClientOptions(options);
    if (captured === undefined) {
      throw new TypeError('CaveClient options must use own data properties.');
    }
    if (
      captured.credentialCustody !== undefined &&
      captured.credentialCustody.mode !== 'managed-native'
    ) {
      throw new TypeError('credentialCustody.mode must be "managed-native".');
    }
    if (
      captured.credentialCustody?.mode === 'managed-native' &&
      captured.credentials !== undefined
    ) {
      throw new TypeError('Managed native credential custody cannot use a JavaScript SecretStore.');
    }

    this.#transport = captured.transport;
    this.#operation = captured.operation;
    this.#credentials = captured.credentials;
    this.#managedCredentialTransport =
      captured.credentialCustody?.mode === 'managed-native'
        ? captured.transport as CaveManagedCredentialTransport
        : undefined;
  }

  async #execute<T>(
    operation: string,
    options: OperationOptions,
    executor: (context: OperationContext) => Promise<T>,
    inheritDefaults = true,
    redactManagedErrors = false,
  ): Promise<T> {
    const timeoutMs =
      options.timeoutMs ??
      (inheritDefaults ? this.#operation?.timeoutMs : undefined);
    const observer =
      options.observer ??
      (inheritDefaults ? this.#operation?.observer : undefined);
    const operationOptions: OperationOptions = {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(observer === undefined ? {} : { observer }),
    };

    try {
      return await runOperation(
        {
          system: 'cave',
          operation,
        },
        operationOptions,
        async (context) => {
          try {
            return await executor(context);
          } catch (error) {
            if (redactManagedErrors) {
              throw redactedManagedTransportError(error, operation);
            }
            if (isCaveClientError(error)) {
              throw error;
            }

            throw new CaveClientError(normalizeCaveError(error, operation), undefined, {
              cause: error,
            });
          }
        },
      );
    } catch (error) {
      if (isCaveClientError(error)) {
        throw error;
      }

      if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
        if (redactManagedErrors) {
          throw redactedManagedCancellationError(error, operation);
        }
        throw new CaveClientError(normalizeCaveError(error, operation), undefined, {
          cause: error,
        });
      }

      throw error;
    }
  }

  #managedSnapshot(value: unknown, operation: string): unknown {
    if (this.#managedCredentialTransport === undefined) {
      return value;
    }
    const snapshot = snapshotManagedResult(value);
    if (snapshot === undefined) {
      throw invalidResponse(operation);
    }
    return snapshot;
  }

  #operationControls(options: OperationOptions): {
    observer: OperationDefaults['observer'];
    timeoutMs: number | undefined;
  } {
    return {
      timeoutMs: options.timeoutMs ?? this.#operation?.timeoutMs,
      observer: options.observer ?? this.#operation?.observer,
    };
  }

  #wrapOperationError(error: unknown, operation: string): CaveClientError {
    if (isCaveClientError(error)) {
      return error;
    }

    return new CaveClientError(normalizeCaveError(error, operation), undefined, {
      cause: error,
    });
  }

  async #invokeManaged<T>(
    operation: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw redactedManagedTransportError(error, operation);
    }
  }

  async #executePersistentMutation<T>(
    operation: string,
    options: OperationOptions,
    executor: (
      context: OperationContext,
      termination: Promise<never>,
    ) => Promise<T>,
    redactManagedErrors = false,
  ): Promise<T> {
    const { observer, timeoutMs } = this.#operationControls(options);
    const scope = createOperationScope(
      {
        system: 'cave',
        operation,
      },
      {
        signals: options.signal === undefined ? [] : [options.signal],
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
    );
    const startedAt = performance.now();

    try {
      notifyOperationObserver(observer, {
        phase: 'start',
        system: 'cave',
        operation,
      });

      let result: T;
      try {
        if (scope.context.signal.aborted) {
          result = await scope.termination;
        } else {
          result = await executor(scope.context, scope.termination);
        }
        if (redactManagedErrors) {
          this.#ensureManagedActive(scope.context, operation);
        } else {
          this.#ensureActive(scope.context, operation);
        }
      } catch (error) {
        const wrapped =
          redactManagedErrors
            ? isOperationTimeoutError(error) || isOperationAbortedError(error)
              ? redactedManagedCancellationError(error, operation)
              : isCaveClientError(error)
                ? error
                : redactedManagedTransportError(error, operation)
            : this.#wrapOperationError(error, operation);
        notifyOperationObserver(observer, {
          phase:
            wrapped.normalized.code === 'timeout'
              ? 'timeout'
              : wrapped.normalized.code === 'aborted'
                ? 'abort'
                : 'failure',
          system: 'cave',
          operation,
          durationMs: operationDuration(startedAt),
          error: wrapped.normalized,
        });
        throw wrapped;
      }

      notifyOperationObserver(observer, {
        phase: 'success',
        system: 'cave',
        operation,
        durationMs: operationDuration(startedAt),
      });
      return result;
    } finally {
      scope.dispose();
    }
  }

  #ensureActive(context: OperationContext, operation: string): void {
    if (context.signal.aborted) {
      throw new CaveClientError(normalizeCaveError(context.signal.reason, operation), undefined, {
        cause: context.signal.reason,
      });
    }

    if (context.deadline !== undefined && context.deadline - performance.now() <= 0) {
      throw new CaveClientError(
        normalizeCaveError({ code: 'timeout', retryable: true }, operation),
        undefined,
        {
          cause: { code: 'timeout', retryable: true },
        },
      );
    }
  }

  #ensureManagedActive(context: OperationContext, operation: string): void {
    if (context.signal.aborted) {
      throw redactedManagedCancellationError(context.signal.reason, operation);
    }
    if (context.deadline !== undefined && context.deadline - performance.now() <= 0) {
      throw new CaveClientError(
        normalizeCaveError({ code: 'timeout', retryable: true }, operation),
      );
    }
  }

  #validateHealthResponse(response: unknown, operation: string): CaveHealth {
    const parsed = parseHealthResponse(response);

    if (parsed === undefined) {
      if (operation === 'health') {
        throw invalidHealthResponse();
      }
      throw invalidResponse(operation);
    }

    let compatibility: CompatibilityAssessment;

    try {
      compatibility = assessCompatibility(parsed.minimumClientVersion, CAVE_CLIENT_VERSION);
    } catch {
      if (operation === 'health') {
        throw invalidHealthResponse();
      }
      throw invalidResponse(operation);
    }

    if (!compatibility.compatible) {
      throw new CaveClientError(
        normalizeCaveError(
          {
            code: 'incompatible_version',
          },
          operation,
        ),
        compatibility,
      );
    }

    if (!CAVE_API_VERSION_PATTERN.test(parsed.apiVersion)) {
      if (operation === 'health') {
        throw invalidHealthResponse();
      }
      throw invalidResponse(operation);
    }

    if (parsed.apiVersion.split('.')[0] !== SUPPORTED_CAVE_API_MAJOR) {
      throw new CaveClientError(
        normalizeCaveError(
          {
            code: 'incompatible_version',
          },
          operation,
        ),
      );
    }

    return parsed.health;
  }

  async #runHealth(context: OperationContext): Promise<CaveHealth> {
    this.#ensureActive(context, 'health');
    const response = this.#managedSnapshot(
      await this.#transport.health(context),
      'health',
    );

    if (isObject(response)) {
      const refusal = refusalOf(response, 'health');
      if (refusal !== null) {
        throw refusal;
      }
    }

    return this.#validateHealthResponse(response, 'health');
  }

  async health(options: OperationOptions = {}): Promise<CaveHealth> {
    return this.#execute(
      'health',
      options,
      async (context) => this.#runHealth(context),
      true,
      this.#managedCredentialTransport !== undefined,
    );
  }

  async #canonicalRead<T>(
    operation: string,
    options: OperationOptions,
    read: (context: OperationContext) => Promise<unknown>,
    parse: (value: unknown) => T,
    inheritDefaults = true,
  ): Promise<T> {
    return this.#execute(
      operation,
      options,
      async (context) => {
        this.#ensureActive(context, operation);
        const response = this.#managedSnapshot(await read(context), operation);
        try {
          const parsed = parse(response);
          return this.#managedCredentialTransport === undefined
            ? parsed
            : immutableManagedResult(parsed);
        } catch (error) {
          if (error instanceof CaveCanonicalSchemaError) {
            throw invalidCanonicalResponse(operation, error.field);
          }
          throw error;
        }
      },
      inheritDefaults,
      this.#managedCredentialTransport !== undefined,
    );
  }

  async #listFamiliars(
    options: PageOptions & OperationOptions = {},
    inheritDefaults = true,
  ): Promise<Page<CaveCanonicalFamiliar>> {
    const pageOptions = normalizePageOptions(options);

    return this.#canonicalRead(
      'listFamiliars',
      options,
      (context) => {
        const call = this.#transport.listFamiliars?.bind(this.#transport);
        if (call === undefined) {
          throw unsupported('listFamiliars');
        }
        return call(pageOptions, context);
      },
      parseFamiliarsEnvelope,
      inheritDefaults,
    );
  }

  async listFamiliars(
    options: PageOptions & OperationOptions = {},
  ): Promise<Page<CaveCanonicalFamiliar>> {
    return this.#listFamiliars(options);
  }

  async #listProjects(
    options: PageOptions & OperationOptions = {},
    inheritDefaults = true,
  ): Promise<Page<CaveProject>> {
    const pageOptions = normalizePageOptions(options);

    return this.#canonicalRead(
      'listProjects',
      options,
      (context) => {
        const call = this.#transport.listProjects?.bind(this.#transport);
        if (call === undefined) {
          throw unsupported('listProjects');
        }
        return call(pageOptions, context);
      },
      parseProjectsEnvelope,
      inheritDefaults,
    );
  }

  async listProjects(
    options: PageOptions & OperationOptions = {},
  ): Promise<Page<CaveProject>> {
    return this.#listProjects(options);
  }

  async #listConversations(
    options: PageOptions & OperationOptions = {},
    inheritDefaults = true,
  ): Promise<Page<CaveConversation>> {
    const pageOptions = normalizePageOptions(options);

    return this.#canonicalRead(
      'listConversations',
      options,
      (context) => {
        const call = this.#transport.listConversations?.bind(this.#transport);
        if (call === undefined) {
          throw unsupported('listConversations');
        }
        return call(pageOptions, context);
      },
      parseConversationsEnvelope,
      inheritDefaults,
    );
  }

  async listConversations(
    options: PageOptions & OperationOptions = {},
  ): Promise<Page<CaveConversation>> {
    return this.#listConversations(options);
  }

  async getConversation(
    conversationId: string,
    options: OperationOptions = {},
  ): Promise<CaveConversation> {
    const validatedId = validateCanonicalId(conversationId, 'conversationId');

    return this.#canonicalRead(
      'getConversation',
      options,
      (context) => {
        const call = this.#transport.getConversation?.bind(this.#transport);
        if (call === undefined) {
          throw unsupported('getConversation');
        }
        return call(validatedId, context);
      },
      parseConversationEnvelope,
    );
  }

  async #listConversationMessages(
    conversationId: string,
    options: PageOptions & OperationOptions = {},
    inheritDefaults = true,
  ): Promise<Page<CaveConversationMessage>> {
    const validatedId = validateCanonicalId(conversationId, 'conversationId');
    const pageOptions = normalizePageOptions(options);

    return this.#canonicalRead(
      'listConversationMessages',
      options,
      (context) => {
        const call = this.#transport.listConversationMessages?.bind(
          this.#transport,
        );
        if (call === undefined) {
          throw unsupported('listConversationMessages');
        }
        return call(validatedId, pageOptions, context);
      },
      parseConversationMessagesEnvelope,
      inheritDefaults,
    );
  }

  async listConversationMessages(
    conversationId: string,
    options: PageOptions & OperationOptions = {},
  ): Promise<Page<CaveConversationMessage>> {
    return this.#listConversationMessages(conversationId, options);
  }

  #boundedPageOptions(options: BoundedPageOptions): BoundedPageOptions {
    if (typeof options !== 'object' || options === null) {
      return options;
    }

    const timeoutMs = options.timeoutMs ?? this.#operation?.timeoutMs;
    const observer = options.observer ?? this.#operation?.observer;

    return {
      ...options,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(observer === undefined ? {} : { observer }),
    };
  }

  iterateFamiliars(
    options: BoundedPageOptions,
  ): AsyncGenerator<CaveCanonicalFamiliar> {
    return iteratePages(
      (pageOptions) => this.#listFamiliars(pageOptions, false),
      this.#boundedPageOptions(options),
    );
  }

  iterateProjects(options: BoundedPageOptions): AsyncGenerator<CaveProject> {
    return iteratePages(
      (pageOptions) => this.#listProjects(pageOptions, false),
      this.#boundedPageOptions(options),
    );
  }

  iterateConversations(
    options: BoundedPageOptions,
  ): AsyncGenerator<CaveConversation> {
    return iteratePages(
      (pageOptions) => this.#listConversations(pageOptions, false),
      this.#boundedPageOptions(options),
    );
  }

  iterateConversationMessages(
    conversationId: string,
    options: BoundedPageOptions,
  ): AsyncGenerator<CaveConversationMessage> {
    return iteratePages(
      (pageOptions) =>
        this.#listConversationMessages(conversationId, pageOptions, false),
      this.#boundedPageOptions(options),
    );
  }

  /**
   * The familiar roster.
   *
   * Mirrors `GET /api/familiars`. A malformed entry fails the whole call
   * rather than being dropped: a roster silently missing one familiar is
   * worse than a roster that says it could not be read.
   */
  async #runFamiliars(context: OperationContext): Promise<CaveFamiliar[]> {
    const operation = 'familiars';
    this.#ensureActive(context, operation);
    const call = this.#transport.familiars?.bind(this.#transport);

    if (call === undefined) {
      throw unsupported(operation);
    }

    const response = this.#managedSnapshot(await call(context), operation);

    if (!isObject(response)) {
      throw invalidResponse(operation);
    }

    const refusal = refusalOf(response, operation);

    if (refusal !== null) {
      throw refusal;
    }

    // Affirmatively true, not merely "not false": an envelope missing `ok`
    // is a shape this client does not recognise, and treating it as success
    // would let a malformed response through as an empty roster.
    if (response.ok !== true) {
      throw invalidResponse(operation);
    }

    if (!Array.isArray(response.familiars) || !response.familiars.every(isFamiliarWire)) {
      throw invalidResponse(operation);
    }

    const familiars = response.familiars.map(toFamiliar);
    return this.#managedCredentialTransport === undefined
      ? familiars
      : immutableManagedResult(familiars);
  }

  async familiars(options: OperationOptions = {}): Promise<CaveFamiliar[]> {
    return this.#execute(
      'familiars',
      options,
      async (context) => this.#runFamiliars(context),
      true,
      this.#managedCredentialTransport !== undefined,
    );
  }

  /** The Familiar Contract report. Mirrors `GET /api/familiars/:id/contract`. */
  async familiarContract(
    familiarId: string,
    options: OperationOptions = {},
  ): Promise<CaveFamiliarContract> {
    return this.#execute('familiarContract', options, async (context) => {
      this.#ensureActive(context, 'familiarContract');
      const call = this.#transport.familiarContract?.bind(this.#transport);

      if (call === undefined) {
        throw unsupported('familiarContract');
      }

      const response = this.#managedSnapshot(
        await call(familiarId, context),
        'familiarContract',
      );

      if (!isObject(response)) {
        throw invalidResponse('familiarContract');
      }

      const refusal = refusalOf(response, 'familiarContract');

      if (refusal !== null) {
        throw refusal;
      }

      if (response.ok !== true) {
        throw invalidResponse('familiarContract');
      }

      if (typeof response.present !== 'boolean' || !isContractReport(response.report)) {
        throw invalidResponse('familiarContract');
      }

      const report =
        this.#managedCredentialTransport === undefined
          ? response.report as CaveFamiliarContract['report']
          : managedContractReport(response.report);
      if (report === undefined) {
        throw invalidResponse('familiarContract');
      }
      const contract = {
        id: isString(response.id) ? response.id : familiarId,
        ...(isString(response.workspace) ? { workspace: response.workspace } : {}),
        present: response.present,
        report,
      };
      return this.#managedCredentialTransport === undefined
        ? contract
        : immutableManagedResult(contract);
    }, true, this.#managedCredentialTransport !== undefined);
  }

  /**
   * Execution analytics. Mirrors `GET /api/familiars/:id/execution-analytics`.
   *
   * `backfill` comes back untouched. A success rate drawn from a partial
   * import is a different claim from one drawn from all of it, and dropping
   * the distinction here would leave every caller unable to make it.
   */
  async familiarAnalytics(
    familiarId: string,
    options: CaveFamiliarAnalyticsOptions = {},
  ): Promise<CaveFamiliarAnalytics> {
    const transportOptions =
      options.recentLimit === undefined ? undefined : { recentLimit: options.recentLimit };

    return this.#execute('familiarAnalytics', options, async (context) => {
      this.#ensureActive(context, 'familiarAnalytics');
      const call = this.#transport.familiarAnalytics?.bind(this.#transport);

      if (call === undefined) {
        throw unsupported('familiarAnalytics');
      }

      const response = this.#managedSnapshot(
        await call(familiarId, transportOptions, context),
        'familiarAnalytics',
      );

      if (!isObject(response)) {
        throw invalidResponse('familiarAnalytics');
      }

      const refusal = refusalOf(response, 'familiarAnalytics');

      if (refusal !== null) {
        throw refusal;
      }

      if (response.ok !== true) {
        throw invalidResponse('familiarAnalytics');
      }

      if (!isAnalytics(response.analytics)) {
        throw invalidResponse('familiarAnalytics');
      }

      const analytics =
        this.#managedCredentialTransport === undefined
          ? response.analytics
          : managedFamiliarAnalytics(response.analytics);
      if (analytics === undefined) {
        throw invalidResponse('familiarAnalytics');
      }
      return this.#managedCredentialTransport === undefined
        ? analytics
        : immutableManagedResult(analytics);
    }, true, this.#managedCredentialTransport !== undefined);
  }

  async #runPairingCreate(
    request: CavePairingRequest,
    context: OperationContext,
  ): Promise<CavePairingCreated> {
    this.#ensureActive(context, 'pairingCreate');
    const call = this.#transport.pairingCreate?.bind(this.#transport);

    if (call === undefined) {
      throw unsupported('pairingCreate');
    }

    const created = parseDirectPairingCreated(await call(request, context));
    if (created === undefined) {
      throw invalidResponse('pairingCreate');
    }

    return created;
  }

  async #runPairingPoll(
    requestId: string,
    pairingSecret: string,
    context: OperationContext,
  ): Promise<CavePairingStatus> {
    this.#ensureActive(context, 'pairingPoll');
    const call = this.#transport.pairingPoll?.bind(this.#transport);

    if (call === undefined) {
      throw unsupported('pairingPoll');
    }

    const status = parseDirectPairingStatus(
      await call(requestId, pairingSecret, context),
    );
    if (status === undefined) {
      throw invalidResponse('pairingPoll');
    }

    return status;
  }

  #pairingExchangeCall(): NonNullable<CaveTransport['pairingExchange']> {
    const call = this.#transport.pairingExchange?.bind(this.#transport);

    if (call === undefined) {
      throw unsupported('pairingExchange');
    }

    return call;
  }

  async #createManagedPairing(
    request: CavePairingRequest,
    options: OperationOptions,
    transport: CaveManagedCredentialTransport,
  ): Promise<CavePairingSession> {
    const created = await this.#execute('pairingCreate', options, async (context) => {
      this.#ensureManagedActive(context, 'pairingCreate');
      const value = await this.#invokeManaged(
        'pairingCreate',
        () => transport.managedPairingCreate(request, context),
      );
      const parsed = parseManagedPairingCreated(value);
      if (parsed === undefined) {
        throw invalidResponse('pairingCreate');
      }
      return parsed;
    }, true, true);

    let pairingState: 'ready' | 'poll_pending' | 'exchange_pending' | 'spent' = 'ready';
    let nextPollAttempt = 0;
    let activePollAttempt: number | undefined;
    const spendPairing = (): void => {
      pairingState = 'spent';
      activePollAttempt = undefined;
    };
    const requireReadyPairing = (operation: string): void => {
      if (pairingState === 'poll_pending') {
        throw pairingOperationInProgress(operation);
      }
      if (pairingState !== 'ready') {
        throw replayedPairing(operation);
      }
    };
    const beginPoll = (): { attempt: number; release: () => void } => {
      requireReadyPairing('pairingPoll');
      pairingState = 'poll_pending';
      const attempt = ++nextPollAttempt;
      activePollAttempt = attempt;
      return {
        attempt,
        release: () => {
          if (activePollAttempt !== attempt) {
            return;
          }
          activePollAttempt = undefined;
          if (pairingState === 'poll_pending') {
            pairingState = 'ready';
          }
        },
      };
    };
    const beginExchange = (): void => {
      requireReadyPairing('pairingExchange');
      pairingState = 'exchange_pending';
    };

    return new CavePairingSession({
      requestId: created.requestId,
      expiresAt: created.expiresAt,
      poll: async (pollOptions = {}) =>
        this.#execute('pairingPoll', pollOptions, async (context) => {
          const { attempt, release } = beginPoll();
          const releaseOnAbort = (): void => {
            release();
          };
          context.signal.addEventListener('abort', releaseOnAbort, { once: true });

          let status: CavePairingStatus;
          try {
            this.#ensureManagedActive(context, 'pairingPoll');
            const value = await this.#invokeManaged(
              'pairingPoll',
              () => transport.managedPairingPoll(created.requestId, context),
            );
            const parsed = parseManagedPairingStatus(value);
            if (parsed === undefined || parsed.id !== created.requestId) {
              throw invalidResponse('pairingPoll');
            }
            status = parsed;
          } catch (error) {
            if (activePollAttempt === attempt) {
              if (
                isCaveClientError(error) &&
                (error.code === 'pairing_denied' ||
                  error.code === 'pairing_expired' ||
                  error.code === 'conflict' ||
                  error.code === 'reconcile_required')
              ) {
                spendPairing();
              } else {
                release();
              }
            }
            throw error;
          } finally {
            context.signal.removeEventListener('abort', releaseOnAbort);
          }

          if (activePollAttempt === attempt) {
            if (status.status === 'denied' || status.status === 'expired') {
              spendPairing();
            } else {
              release();
            }
          }
          return status;
        }, true, true),
      exchange: async (exchangeOptions = {}) =>
        this.#executePersistentMutation('pairingExchange', exchangeOptions, async (
          context,
          termination,
        ) => {
          this.#ensureManagedActive(context, 'pairingExchange');
          beginExchange();
          try {
            const value = await racePrePersistencePhase(
              this.#invokeManaged(
                'pairingExchange',
                () => transport.managedPairingExchange(created.requestId, context),
              ),
              termination,
              () => undefined,
            );
            const parsed = parseManagedPairingExchange(value);
            if (parsed === undefined) {
              throw invalidResponse('pairingExchange');
            }
            spendPairing();
            return parsed.credential;
          } catch (error) {
            // Native code owns the single-use secret, exchange dispatch, and
            // durable persistence. Any observed attempt is terminal in JS.
            spendPairing();
            throw error;
          }
        }, true),
    });
  }

  async createPairing(
    request: CavePairingRequest,
    options: OperationOptions = {},
  ): Promise<CavePairingSession> {
    const normalizedRequest = validatePairingRequest(request);
    const managedTransport = this.#managedCredentialTransport;
    if (managedTransport !== undefined) {
      return await this.#createManagedPairing(
        normalizedRequest,
        options,
        managedTransport,
      );
    }
    const created = await this.#execute('pairingCreate', options, async (context) =>
      this.#runPairingCreate(normalizedRequest, context),
    );

    let pairingSecret: string | undefined = created.secret;
    let pairingSecretState: 'ready' | 'poll_pending' | 'exchange_pending' | 'spent' = 'ready';
    let nextPollAttempt = 0;
    let activePollAttempt: number | undefined;
    // Polls borrow the secret without consuming it. The current poll attempt
    // owns a revocable gate, and only that attempt may reopen the ready state.
    const clearPairingSecret = (): void => {
      pairingSecret = undefined;
      pairingSecretState = 'spent';
      activePollAttempt = undefined;
    };
    const restorePairingSecret = (secret: string): void => {
      pairingSecret = secret;
      pairingSecretState = 'ready';
    };
    const requirePairingSecret = (operation: string): string => {
      if (pairingSecretState === 'poll_pending') {
        throw pairingOperationInProgress(operation);
      }
      if (pairingSecretState !== 'ready' || pairingSecret === undefined) {
        throw replayedPairing(operation);
      }
      return pairingSecret;
    };
    const beginPairingPoll = (): { attempt: number; release: () => void; secret: string } => {
      const secret = requirePairingSecret('pairingPoll');
      pairingSecretState = 'poll_pending';
      const attempt = ++nextPollAttempt;
      activePollAttempt = attempt;
      const release = (): void => {
        if (activePollAttempt !== attempt) {
          return;
        }

        activePollAttempt = undefined;
        if (pairingSecretState === 'poll_pending') {
          pairingSecretState = 'ready';
        }
      };

      return { attempt, release, secret };
    };
    const beginPairingExchange = (): string => {
      const secret = requirePairingSecret('pairingExchange');
      pairingSecret = undefined;
      pairingSecretState = 'exchange_pending';
      return secret;
    };

    return new CavePairingSession({
      requestId: created.requestId,
      expiresAt: created.expiresAt,
      poll: async (pollOptions = {}) =>
        this.#execute('pairingPoll', pollOptions, async (context) => {
          const { attempt, release, secret } = beginPairingPoll();
          const releaseOnAbort = (): void => {
            release();
          };
          context.signal.addEventListener('abort', releaseOnAbort, { once: true });

          let status: CavePairingStatus;
          try {
            status = await this.#runPairingPoll(created.requestId, secret, context);
          } catch (error) {
            if (activePollAttempt === attempt) {
              if (
                isCaveClientError(error) &&
                (
                  error.code === 'pairing_denied' ||
                  error.code === 'pairing_expired' ||
                  error.code === 'conflict' ||
                  error.code === 'reconcile_required'
                )
              ) {
                clearPairingSecret();
              } else {
                release();
              }
            }
            throw error;
          } finally {
            context.signal.removeEventListener('abort', releaseOnAbort);
          }
          if (activePollAttempt === attempt) {
            if (status.status === 'denied' || status.status === 'expired') {
              clearPairingSecret();
            } else {
              release();
            }
          }
          return status;
        }),
      exchange: async (exchangeOptions = {}) =>
        this.#executePersistentMutation('pairingExchange', exchangeOptions, async (
          context,
          termination,
        ) => {
          const credentials = this.#credentials;
          if (credentials === undefined) {
            throw unsupported('pairingExchange');
          }

          const call = this.#pairingExchangeCall();
          this.#ensureActive(context, 'pairingExchange');
          const secret = beginPairingExchange();
          let exchanged: ParsedDirectPairingExchange;

          try {
            exchanged = await racePrePersistencePhase(
              (async () => {
                const response: unknown = await call(created.requestId, secret, context);
                const parsed = parseDirectPairingExchange(response);
                if (parsed === undefined) {
                  throw invalidResponse('pairingExchange');
                }
                return parsed;
              })(),
              termination,
              discardPairingExchangeBearer,
            );
          } catch (error) {
            if (isPairingSecretUnsentError(error)) {
              restorePairingSecret(secret);
            } else {
              clearPairingSecret();
            }
            throw error;
          }

          clearPairingSecret();
          const authorityBinding = exchanged.authorityBinding;
          this.#ensureActive(context, 'pairingExchange');
          if (authorityBinding.status !== 'valid') {
            throw invalidAuthorityBinding(
              'pairingExchange',
              authorityBinding.status === 'missing'
                ? 'authority_binding_missing'
                : 'authority_binding_invalid',
            );
          }

          const bearerBytes = new TextEncoder().encode(exchanged.bearer);
          try {
            const bearer = new TextDecoder().decode(bearerBytes);
            await storeBoundCredential(
              credentials.store,
              credentials.reference,
              bearer,
              authorityBinding.authorityBinding,
              {
                context,
                termination,
              },
            );
          } catch (error) {
            clearPairingSecret();
            const code = errorCodeOf(error);
            if (
              code === 'secret_store_rollback_failed' ||
              code === 'timeout' ||
              code === 'aborted'
            ) {
              throw error;
            }

            throw secretStoreWriteFailed('pairingExchange', error);
          } finally {
            bearerBytes.fill(0);
          }

          return exchanged.credential;
        }),
    });
  }

  async credentialStatus(options: OperationOptions = {}): Promise<CaveCredentialStatus> {
    const managedTransport = this.#managedCredentialTransport;
    if (managedTransport !== undefined) {
      return this.#execute('credentialStatus', options, async (context) => {
        this.#ensureManagedActive(context, 'credentialStatus');
        const value = await this.#invokeManaged(
          'credentialStatus',
          () => managedTransport.managedCredentialStatus(context),
        );
        const managedStatus = parseManagedCredentialStatus(value);
        if (managedStatus === undefined) {
          throw invalidResponse('credentialStatus');
        }
        if (
          managedStatus.status === 'missing' ||
          managedStatus.status === 'disconnected'
        ) {
          return managedStatus;
        }

        const health = this.#validateHealthResponse(
          managedStatus.health,
          'credentialStatus',
        );
        return managedStatus.status === 'revoked'
          ? immutableManagedResult({ status: 'revoked', health })
          : immutableManagedResult({
              status: 'valid',
              access: managedStatus.access,
              health,
            });
      }, true, true);
    }

    return this.#execute('credentialStatus', options, async (context) => {
      const credentials = this.#credentials;
      if (credentials === undefined) {
        throw unsupported('credentialStatus');
      }

      this.#ensureActive(context, 'credentialStatus');
      const localMaterialStatus = async (
        allowInvalidate: boolean,
      ): Promise<CaveCredentialStatus | { status: 'continue' }> => {
        const localMaterial = await inspectStoredCredentialMaterial(
          credentials.store,
          credentials.reference,
          (value) => BASE64URL_43_RE.test(value),
          { context },
        );

        if (localMaterial.status === 'missing') {
          return { status: 'missing' };
        }
        if (localMaterial.status === 'present') {
          return { status: 'continue' };
        }
        if (!allowInvalidate) {
          return {
            status: 'disconnected',
            reason: 'reconcile_required',
          };
        }

        await invalidateStoredCredential(credentials.store, credentials.reference, { context });
        const repaired = await inspectStoredCredentialMaterial(
          credentials.store,
          credentials.reference,
          (value) => BASE64URL_43_RE.test(value),
          { context },
        );

        if (repaired.status === 'missing') {
          return { status: 'missing' };
        }
        if (repaired.status === 'present') {
          return { status: 'continue' };
        }

        return {
          status: 'disconnected',
          reason: 'reconcile_required',
        };
      };

      const localStatus = await localMaterialStatus(true);
      if (localStatus.status !== 'continue') {
        return localStatus;
      }

      const health = await this.#runHealth(context);

      try {
        await this.#runFamiliars(context);
        return {
          status: 'valid',
          access: 'chat:read',
          health,
        };
      } catch (error) {
        const code = isCaveClientError(error)
          ? error.code
          : normalizeCaveError(error, 'credentialStatus').code;

        if (code === 'credential_update_in_progress') {
          return {
            status: 'disconnected',
            reason: 'credential_update_in_progress',
          };
        }
        if (code === 'unauthorized') {
          return { status: 'revoked', health };
        }
        if (code === 'reconcile_required') {
          const afterReconcile = await localMaterialStatus(false);
          if (afterReconcile.status === 'missing') {
            return afterReconcile;
          }
          if (afterReconcile.status === 'disconnected') {
            return afterReconcile;
          }
          return {
            status: 'disconnected',
            reason: 'reconcile_required',
          };
        }
        if (code === 'scope_denied') {
          return { status: 'valid', access: 'scope_denied', health };
        }
        if (code === 'service_unavailable') {
          return { status: 'valid', access: 'service_unavailable', health };
        }
        if (code === 'rate_limited') {
          return { status: 'valid', access: 'rate_limited', health };
        }
        throw error;
      }
    });
  }

  async forgetCredential(options: OperationOptions = {}): Promise<boolean> {
    const managedTransport = this.#managedCredentialTransport;
    if (managedTransport !== undefined) {
      return this.#execute('forgetCredential', options, async (context) => {
        this.#ensureManagedActive(context, 'forgetCredential');
        const value = await this.#invokeManaged(
          'forgetCredential',
          () => managedTransport.managedForgetCredential(context),
        );
        const result = parseManagedForgetCredential(value);
        if (result === undefined) {
          throw invalidResponse('forgetCredential');
        }
        if (result.status === 'credential_update_in_progress') {
          const cause = {
            code: 'credential_update_in_progress',
            retryable: true,
          };
          throw new CaveClientError(
            normalizeCaveError(cause, 'forgetCredential'),
            undefined,
            { cause },
          );
        }
        return result.status === 'deleted';
      }, true, true);
    }

    return this.#execute('forgetCredential', options, async (context) => {
      const credentials = this.#credentials;
      if (credentials === undefined) {
        throw unsupported('forgetCredential');
      }

      this.#ensureActive(context, 'forgetCredential');
      return await forgetStoredCredential(credentials.store, credentials.reference, { context });
    });
  }
}

export function createCaveClient(options: CaveClientOptions): CaveClient {
  return new CaveClient(options);
}
