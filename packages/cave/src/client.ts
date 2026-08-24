import {
  assessCompatibility,
  isOperationAbortedError,
  isOperationTimeoutError,
  normalizeError,
  runOperation,
  type CompatibilityAssessment,
  type NormalizedError,
  type OperationContext,
  type OperationDefaults,
  type OperationOptions,
  type SecretStore,
  type SecretStoreReference,
} from '@opencoven/sdk-core';

import type {
  CaveCredentialMetadata,
  CaveCredentialStatus,
  CaveHealth,
  CavePairingCreated,
  CavePairingExchange,
  CavePairingRequest,
  CavePairingScope,
  CavePairingStatus,
} from './schemas.js';
import type {
  CaveExecutionAttempt,
  CaveExecutionSlice,
  CaveExecutionWindow,
  CaveFamiliar,
  CaveFamiliarAnalytics,
  CaveFamiliarContract,
  CaveFamiliarWire,
} from './schemas.js';
import { CAVE_PAIRING_SCOPES } from './schemas.js';
import type { CaveTransport } from './transport.js';
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

export interface CaveClientOptions {
  transport: CaveTransport;
  operation?: OperationDefaults;
  credentials?: CaveCredentialBinding;
}

export interface CaveFamiliarAnalyticsOptions extends OperationOptions {
  recentLimit?: number;
}

interface ParsedHealthResponse {
  apiVersion?: string | undefined;
  minimumClientVersion?: string | undefined;
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

  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const parsed: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      candidate.length > ADVERTISED_ID_MAX_CHARACTERS ||
      !ADVERTISED_ID_PATTERN.test(candidate) ||
      parsed.includes(candidate)
    ) {
      return undefined;
    }
    parsed.push(candidate);
  }

  return parsed;
}

function parseHealthResponse(response: unknown): ParsedHealthResponse | undefined {
  if (!isObject(response)) {
    return undefined;
  }

  if (response.apiVersion !== undefined && typeof response.apiVersion !== 'string') {
    return undefined;
  }

  if (response.minimumClientVersion !== undefined && typeof response.minimumClientVersion !== 'string') {
    return undefined;
  }

  if (response.requestId !== undefined && typeof response.requestId !== 'string') {
    return undefined;
  }

  const capabilities = parseAdvertisedIds(response.capabilities);
  if (response.capabilities !== undefined && capabilities === undefined) {
    return undefined;
  }

  const operations = parseAdvertisedIds(response.operations);
  if (response.operations !== undefined && operations === undefined) {
    return undefined;
  }

  if (!isObject(response.data)) {
    return undefined;
  }

  if (response.data.status === 'ok') {
    return {
      ...(response.apiVersion === undefined ? {} : { apiVersion: response.apiVersion }),
      ...(response.minimumClientVersion === undefined
        ? {}
        : { minimumClientVersion: response.minimumClientVersion }),
      health: {
        status: 'ok',
        ...(capabilities === undefined ? {} : { capabilities }),
        ...(operations === undefined ? {} : { operations }),
      },
    };
  }

  if (
    typeof response.data.instanceId !== 'string' ||
    response.data.instanceId.length === 0 ||
    response.data.pairingRequired !== true ||
    typeof response.data.releaseVersion !== 'string' ||
    response.data.releaseVersion.length === 0
  ) {
    return undefined;
  }

  return {
    ...(response.apiVersion === undefined ? {} : { apiVersion: response.apiVersion }),
    ...(response.minimumClientVersion === undefined
      ? {}
      : { minimumClientVersion: response.minimumClientVersion }),
    health: {
      status: 'ok',
      instanceId: response.data.instanceId,
      pairingRequired: true,
      releaseVersion: response.data.releaseVersion,
      ...(capabilities === undefined ? {} : { capabilities }),
      ...(operations === undefined ? {} : { operations }),
    },
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

function secretStoreWriteFailed(operation: string, cause: unknown): CaveClientError {
  return new CaveClientError(
    normalizeCaveError({ code: 'secret_store_write_failed' }, operation),
    undefined,
    { cause },
  );
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
    const parsed = parseHealthResponse(response);

    if (parsed === undefined) {
      throw invalidHealthResponse();
    }

    if (parsed.minimumClientVersion !== undefined) {
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
    }

    if (parsed.apiVersion !== undefined) {
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
    }

    return parsed.health;
  }

  async health(options: OperationOptions = {}): Promise<CaveHealth> {
    return this.#execute('health', options, async (context) => this.#runHealth(context));
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

  async #runPairingExchange(
    requestId: string,
    pairingSecret: string,
    context: OperationContext,
  ): Promise<CavePairingExchange> {
    this.#ensureActive(context, 'pairingExchange');
    const call = this.#transport.pairingExchange?.bind(this.#transport);

    if (call === undefined) {
      throw unsupported('pairingExchange');
    }

    const exchanged: unknown = await call(requestId, pairingSecret, context);
    if (!isPairingExchange(exchanged)) {
      throw invalidResponse('pairingExchange');
    }

    return exchanged;
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
    const clearPairingSecret = (): void => {
      pairingSecret = undefined;
    };
    const requirePairingSecret = (operation: string): string => {
      if (pairingSecret === undefined) {
        throw replayedPairing(operation);
      }
      return pairingSecret;
    };

    return new CavePairingSession({
      requestId: created.requestId,
      expiresAt: created.expiresAt,
      poll: async (pollOptions = {}) =>
        this.#execute('pairingPoll', pollOptions, async (context) => {
          const status = await this.#runPairingPoll(
            created.requestId,
            requirePairingSecret('pairingPoll'),
            context,
          );
          if (status.status === 'denied' || status.status === 'expired') {
            clearPairingSecret();
          }
          return status;
        }),
      exchange: async (exchangeOptions = {}) =>
        this.#execute('pairingExchange', exchangeOptions, async (context) => {
          const secret = requirePairingSecret('pairingExchange');
          let exchanged: CavePairingExchange;

          try {
            exchanged = await this.#runPairingExchange(created.requestId, secret, context);
          } catch (error) {
            if (
              isCaveClientError(error) &&
              (error.code === 'pairing_denied' || error.code === 'pairing_expired' || error.code === 'conflict')
            ) {
              clearPairingSecret();
            }
            throw error;
          }

          const credentials = this.#credentials;
          if (credentials === undefined) {
            clearPairingSecret();
            throw unsupported('pairingExchange');
          }

          const bearerBytes = Buffer.from(exchanged.bearer, 'utf8');
          try {
            this.#ensureActive(context, 'pairingExchange');
            await credentials.store.set(
              credentials.reference.key,
              bearerBytes.toString('utf8'),
            );
          } catch (error) {
            clearPairingSecret();
            throw secretStoreWriteFailed('pairingExchange', error);
          } finally {
            bearerBytes.fill(0);
          }

          clearPairingSecret();
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
      const bearer = await credentials.store.get(credentials.reference.key);
      if (bearer === undefined) {
        return { status: 'missing' };
      }
      if (typeof bearer !== 'string' || !BASE64URL_43_RE.test(bearer)) {
        throw invalidResponse('credentialStatus');
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

        if (code === 'unauthorized') {
          return { status: 'revoked', health };
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
      return await credentials.store.delete(credentials.reference.key);
    });
  }
}

export function createCaveClient(options: CaveClientOptions): CaveClient {
  return new CaveClient(options);
}
