import {
  assessCompatibility,
  normalizeError,
  type CompatibilityAssessment,
  type NormalizedError,
} from '@opencoven/sdk-core';

import type { CaveHealth } from './schemas.js';
import type {
  CaveExecutionAttempt,
  CaveExecutionSlice,
  CaveExecutionWindow,
  CaveFamiliar,
  CaveFamiliarAnalytics,
  CaveFamiliarContract,
  CaveFamiliarWire,
  CaveHealthResponse,
} from './schemas.js';
import type { CaveTransport } from './transport.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const CAVE_CLIENT_ERROR_BRAND = Symbol.for('@opencoven/cave-client/CaveClientError');

export interface CaveClientOptions {
  transport: CaveTransport;
}

export function normalizeCaveError(error: unknown, operation: string): NormalizedError {
  return normalizeError(error, {
    system: 'cave',
    operation,
    message: `Cave ${operation} request failed`,
  });
}

export class CaveClientError extends Error {
  readonly normalized: NormalizedError;
  readonly compatibility: CompatibilityAssessment | undefined;

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
    Object.defineProperty(this, CAVE_CLIENT_ERROR_BRAND, { value: true });
  }
}

export function isCaveClientError(error: unknown): error is CaveClientError {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, CAVE_CLIENT_ERROR_BRAND) === true
  );
}

const CAVE_API_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SUPPORTED_CAVE_API_MAJOR = '1';

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

function validateHealthResponse(response: unknown): response is CaveHealthResponse {
  if (!isObject(response)) {
    return false;
  }

  if (response.apiVersion !== undefined && typeof response.apiVersion !== 'string') {
    return false;
  }

  if (response.minimumClientVersion !== undefined && typeof response.minimumClientVersion !== 'string') {
    return false;
  }

  if (response.requestId !== undefined && typeof response.requestId !== 'string') {
    return false;
  }

  if (!isObject(response.data)) {
    return false;
  }

  return response.data.status === 'ok';
}


// ── Familiars ───────────────────────────────────────────────────────────────

function invalidResponse(operation: string): CaveClientError {
  return new CaveClientError(normalizeCaveError({ code: 'invalid_response' }, operation));
}

function unsupported(operation: string): CaveClientError {
  return new CaveClientError(normalizeCaveError({ code: 'unsupported_operation' }, operation));
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

    return new CaveClientError(normalizeCaveError({ code: reason, message }, operation));
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

export class CaveClient {
  readonly #transport: CaveTransport;

  constructor(options: CaveClientOptions) {
    this.#transport = options.transport;
  }

  async health(): Promise<CaveHealth> {
    try {
      const response: unknown = await this.#transport.health();

      if (!validateHealthResponse(response)) {
        throw invalidHealthResponse();
      }

      if (response.minimumClientVersion !== undefined) {
        let compatibility: CompatibilityAssessment;

        try {
          compatibility = assessCompatibility(response.minimumClientVersion, CAVE_CLIENT_VERSION);
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

      if (response.apiVersion !== undefined) {
        if (!CAVE_API_VERSION_PATTERN.test(response.apiVersion)) {
          throw invalidHealthResponse();
        }

        if (response.apiVersion.split('.')[0] !== SUPPORTED_CAVE_API_MAJOR) {
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

      return response.data;
    } catch (error) {
      if (isCaveClientError(error)) {
        throw error;
      }

      throw new CaveClientError(normalizeCaveError(error, 'health'), undefined, { cause: error });
    }
  }

  /**
   * The familiar roster.
   *
   * Mirrors `GET /api/familiars`. A malformed entry fails the whole call
   * rather than being dropped: a roster silently missing one familiar is
   * worse than a roster that says it could not be read.
   */
  async familiars(): Promise<CaveFamiliar[]> {
    try {
      const call = this.#transport.familiars?.bind(this.#transport);

      if (call === undefined) {
        throw unsupported('familiars');
      }

      const response: unknown = await call();

      if (!isObject(response)) {
        throw invalidResponse('familiars');
      }

      const refusal = refusalOf(response, 'familiars');

      if (refusal !== null) {
        throw refusal;
      }

      // Affirmatively true, not merely "not false": an envelope missing `ok`
      // is a shape this client does not recognise, and treating it as success
      // would let a malformed response through as an empty roster.
      if (response.ok !== true) {
        throw invalidResponse('familiars');
      }

      if (!Array.isArray(response.familiars) || !response.familiars.every(isFamiliarWire)) {
        throw invalidResponse('familiars');
      }

      return response.familiars.map(toFamiliar);
    } catch (error) {
      if (isCaveClientError(error)) {
        throw error;
      }

      throw new CaveClientError(normalizeCaveError(error, 'familiars'), undefined, {
        cause: error,
      });
    }
  }

  /** The Familiar Contract report. Mirrors `GET /api/familiars/:id/contract`. */
  async familiarContract(familiarId: string): Promise<CaveFamiliarContract> {
    try {
      const call = this.#transport.familiarContract?.bind(this.#transport);

      if (call === undefined) {
        throw unsupported('familiarContract');
      }

      const response: unknown = await call(familiarId);

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
    } catch (error) {
      if (isCaveClientError(error)) {
        throw error;
      }

      throw new CaveClientError(normalizeCaveError(error, 'familiarContract'), undefined, {
        cause: error,
      });
    }
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
    options?: { recentLimit?: number },
  ): Promise<CaveFamiliarAnalytics> {
    try {
      const call = this.#transport.familiarAnalytics?.bind(this.#transport);

      if (call === undefined) {
        throw unsupported('familiarAnalytics');
      }

      const response: unknown = await call(familiarId, options);

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
    } catch (error) {
      if (isCaveClientError(error)) {
        throw error;
      }

      throw new CaveClientError(normalizeCaveError(error, 'familiarAnalytics'), undefined, {
        cause: error,
      });
    }
  }
}

export function createCaveClient(options: CaveClientOptions): CaveClient {
  return new CaveClient(options);
}
