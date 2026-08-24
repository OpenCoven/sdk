import {
  assessCompatibility,
  createOperationScope,
  isOperationAbortedError,
  isOperationTimeoutError,
  normalizeError,
  normalizePageOptions,
  OperationConfigurationError,
  runOperation,
  type CompatibilityAssessment,
  type NormalizedError,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
  type Page,
  type PageOptions,
  type SecretStore,
  type SecretStoreReference,
} from '@opencoven/sdk-core';

import {
  discardPairingExchangeBearer,
  parseCaveAuthorityBinding,
} from './authority-binding.js';
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
import {
  CAVE_PAIRING_SCOPES,
  type CaveAuthorityBinding,
  type CaveCanonicalFamiliar,
  type CaveConversation,
  type CaveConversationMessage,
  type CaveCredentialMetadata,
  type CaveCredentialStatus,
  type CaveExecutionAttempt,
  type CaveExecutionSlice,
  type CaveExecutionWindow,
  type CaveFamiliar,
  type CaveFamiliarAnalytics,
  type CaveFamiliarContract,
  type CaveFamiliarWire,
  type CaveHealth,
  type CavePairingCreated,
  type CavePairingExchange,
  type CavePairingRequest,
  type CavePairingScope,
  type CavePairingStatus,
  type CaveProject,
} from './schemas.js';
import type {
  CaveCredentialPersistingTransport,
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

interface CaveClientOptionsBase {
  operation?: OperationDefaults;
}

interface CaveClientOptionsWithoutCredentials extends CaveClientOptionsBase {
  transport: CaveTransport;
  credentials?: undefined;
}

interface CaveClientOptionsWithCredentials extends CaveClientOptionsBase {
  transport: CaveCredentialPersistingTransport;
  credentials: CaveCredentialBinding;
}

export type CaveClientOptions =
  | CaveClientOptionsWithoutCredentials
  | CaveClientOptionsWithCredentials;

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

function isCoverage(value: unknown): boolean {
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

function isPairingCreated(value: unknown): value is CavePairingCreated {
  return (
    isObject(value) &&
    typeof value.requestId === 'string' &&
    UUID_RE.test(value.requestId) &&
    typeof value.secret === 'string' &&
    BASE64URL_43_RE.test(value.secret) &&
    Number.isSafeInteger(value.expiresAt) &&
    (value.expiresAt as number) > 0
  );
}

function isPairingStatus(value: unknown): value is CavePairingStatus {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    UUID_RE.test(value.id) &&
    (value.status === 'pending' ||
      value.status === 'approved' ||
      value.status === 'denied' ||
      value.status === 'expired') &&
    Number.isSafeInteger(value.expiresAt) &&
    (value.expiresAt as number) > 0
  );
}

function isCredentialMetadata(value: unknown): value is CaveCredentialMetadata {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    UUID_RE.test(value.id) &&
    typeof value.appName === 'string' &&
    typeof value.installationId === 'string' &&
    Array.isArray(value.scopes) &&
    value.scopes.length > 0 &&
    value.scopes.every((scope) => typeof scope === 'string' && CAVE_PAIRING_SCOPE_SET.has(scope)) &&
    Number.isSafeInteger(value.createdAt) &&
    (value.lastUsedAt === null || Number.isSafeInteger(value.lastUsedAt)) &&
    (value.revokedAt === null || Number.isSafeInteger(value.revokedAt)) &&
    (value.revocationReason === null || typeof value.revocationReason === 'string')
  );
}

function isPairingExchange(value: unknown): value is CavePairingExchange {
  return (
    isObject(value) &&
    typeof value.bearer === 'string' &&
    BASE64URL_43_RE.test(value.bearer) &&
    isCredentialMetadata(value.credential)
  );
}

function pairingExchangeAuthorityBinding(
  value: CavePairingExchange,
):
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'valid'; authorityBinding: CaveAuthorityBinding } {
  const candidate = (value as CavePairingExchange & { authorityBinding?: unknown }).authorityBinding;
  if (candidate === undefined) {
    return { status: 'missing' };
  }

  const authorityBinding = parseCaveAuthorityBinding(candidate);
  return authorityBinding === undefined
    ? { status: 'invalid' }
    : { status: 'valid', authorityBinding };
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

  constructor(options: CaveClientOptions) {
    this.#transport = options.transport;
    this.#operation = options.operation;
    this.#credentials = options.credentials;
  }

  async #execute<T>(
    operation: string,
    options: OperationOptions,
    executor: (context: OperationContext) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.#operation?.timeoutMs;
    const observer = options.observer ?? this.#operation?.observer;
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
        throw new CaveClientError(normalizeCaveError(error, operation), undefined, {
          cause: error,
        });
      }

      throw error;
    }
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

  async #executePersistentMutation<T>(
    operation: string,
    options: OperationOptions,
    executor: (
      context: OperationContext,
      termination: Promise<never>,
    ) => Promise<T>,
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
        this.#ensureActive(scope.context, operation);
      } catch (error) {
        const wrapped = this.#wrapOperationError(error, operation);
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

  async #runHealth(context: OperationContext): Promise<CaveHealth> {
    this.#ensureActive(context, 'health');
    const response: unknown = await this.#transport.health(context);

    if (isObject(response)) {
      const refusal = refusalOf(response, 'health');
      if (refusal !== null) {
        throw refusal;
      }
    }

    const parsed = parseHealthResponse(response);

    if (parsed === undefined) {
      throw invalidHealthResponse();
    }

    let compatibility: CompatibilityAssessment;

    try {
      compatibility = assessCompatibility(parsed.minimumClientVersion, CAVE_CLIENT_VERSION);
    } catch {
      throw invalidHealthResponse();
    }

    if (!compatibility.compatible) {
      throw new CaveClientError(
        normalizeCaveError(
          {
            code: 'incompatible_version',
          },
          'health',
        ),
        compatibility,
      );
    }

    if (!CAVE_API_VERSION_PATTERN.test(parsed.apiVersion)) {
      throw invalidHealthResponse();
    }

    if (parsed.apiVersion.split('.')[0] !== SUPPORTED_CAVE_API_MAJOR) {
      throw new CaveClientError(
        normalizeCaveError(
          {
            code: 'incompatible_version',
          },
          'health',
        ),
      );
    }

    return parsed.health;
  }

  async health(options: OperationOptions = {}): Promise<CaveHealth> {
    return this.#execute('health', options, async (context) => this.#runHealth(context));
  }

  async #canonicalRead<T>(
    operation: string,
    options: OperationOptions,
    read: (context: OperationContext) => Promise<unknown>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    return this.#execute(operation, options, async (context) => {
      this.#ensureActive(context, operation);
      const response = await read(context);
      try {
        return parse(response);
      } catch (error) {
        if (error instanceof CaveCanonicalSchemaError) {
          throw invalidCanonicalResponse(operation, error.field);
        }
        throw error;
      }
    });
  }

  async listFamiliars(
    options: PageOptions & OperationOptions = {},
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
    );
  }

  async listProjects(
    options: PageOptions & OperationOptions = {},
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
    );
  }

  async listConversations(
    options: PageOptions & OperationOptions = {},
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
    );
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

  async listConversationMessages(
    conversationId: string,
    options: PageOptions & OperationOptions = {},
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

    const response: unknown = await call(context);

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

    return response.familiars.map(toFamiliar);
  }

  async familiars(options: OperationOptions = {}): Promise<CaveFamiliar[]> {
    return this.#execute('familiars', options, async (context) => this.#runFamiliars(context));
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

      const response: unknown = await call(familiarId, context);

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

      return {
        id: isString(response.id) ? response.id : familiarId,
        ...(isString(response.workspace) ? { workspace: response.workspace } : {}),
        present: response.present,
        report: response.report as CaveFamiliarContract['report'],
      };
    });
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

      const response: unknown = await call(familiarId, transportOptions, context);

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

      return response.analytics;
    });
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

    const created: unknown = await call(request, context);
    if (!isPairingCreated(created)) {
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

    const status: unknown = await call(requestId, pairingSecret, context);
    if (!isPairingStatus(status)) {
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

  async createPairing(
    request: CavePairingRequest,
    options: OperationOptions = {},
  ): Promise<CavePairingSession> {
    const normalizedRequest = validatePairingRequest(request);
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
          let exchanged: CavePairingExchange;

          try {
            exchanged = await racePrePersistencePhase(
              (async () => {
                const response: unknown = await call(created.requestId, secret, context);
                if (!isPairingExchange(response)) {
                  throw invalidResponse('pairingExchange');
                }
                return response;
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
          const authorityBinding = pairingExchangeAuthorityBinding(exchanged);
          this.#ensureActive(context, 'pairingExchange');
          if (authorityBinding.status !== 'valid') {
            throw invalidAuthorityBinding(
              'pairingExchange',
              authorityBinding.status === 'missing'
                ? 'authority_binding_missing'
                : 'authority_binding_invalid',
            );
          }

          const bearerBytes = Buffer.from(exchanged.bearer, 'utf8');
          try {
            const bearer = bearerBytes.toString('utf8');
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
