import {
  assessCompatibility,
  isOperationAbortedError,
  isOperationTimeoutError,
  type OperationContext,
  type OperationDefaults,
  type SecretStore,
  type SecretStoreReference,
} from '@opencoven/sdk-core';

import { createCaveClient, type CaveClient } from './client.js';
import {
  discoverCaveEndpoint,
  type CaveDiscoveredEndpoint,
  type DiscoverCaveEndpointOptions,
} from './discovery.js';
import { caveAuthorityBindingFromDiscoveredEndpoint } from './authority-binding.js';
import {
  CAVE_CANONICAL_CONVERSATION_REQUIREMENTS,
  CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS,
  CAVE_CANONICAL_FAMILIARS_REQUIREMENTS,
  CAVE_CANONICAL_MESSAGES_REQUIREMENTS,
  CAVE_CANONICAL_PROJECTS_REQUIREMENTS,
  canonicalConversationMessagesRoute,
  canonicalConversationRoute,
  canonicalConversationsRoute,
  canonicalFamiliarsRoute,
  canonicalProjectsRoute,
  type CaveCanonicalEnvelopeRequirements,
} from './canonical-reads.js';
import {
  CAVE_CONTRACT_API_VERSION,
  CAVE_CONTRACT_LIMITS,
  isCaveContractErrorCode,
} from './contract-constraints.js';
import { markPairingExchangeUnsentError } from './pairing-secret.js';
import { parseCaveCredentialMetadata } from './credential-metadata.js';
import {
  loadBoundCredential,
} from './credential-binding-node.js';
import {
  CAVE_HPKE_RESPONSE_MEDIA_TYPE,
  createCaveHpkeBoundRequest,
  type CaveHpkeAuthorization,
  type CaveHpkeProtectedOperation,
} from './hpke-bound-v1-node.js';
import type {
  CaveAuthorityBoundPairingExchange,
  CaveCredentialMetadata,
  CaveFamiliarsResponse,
  CaveFamiliarWire,
  CaveHealthData,
  CaveHealthResponse,
  CavePairingCreated,
  CavePairingExchange,
  CavePairingStatus,
} from './schemas.js';
import type { CaveCredentialPersistingTransport } from './transport.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const CAVE_API_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DECLARATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL_43_RE = /^[A-Za-z0-9_-]{43}$/u;

export interface CaveCredentialBinding {
  store: SecretStore;
  reference: SecretStoreReference;
}

export interface CaveDiscoveredClientOptions {
  credentials: CaveCredentialBinding;
  discoverEndpoint?: (
    options?: DiscoverCaveEndpointOptions,
  ) => Promise<CaveDiscoveredEndpoint>;
  discovery?: DiscoverCaveEndpointOptions;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
  operation?: OperationDefaults;
}

interface DiscoveredTransportOptions {
  credentials: CaveCredentialBinding;
  discoverEndpoint: (
    options?: DiscoverCaveEndpointOptions,
  ) => Promise<CaveDiscoveredEndpoint>;
  discovery: DiscoverCaveEndpointOptions | undefined;
  fetchImplementation: typeof fetch;
  hpkeState: {
    observedV2: boolean;
  };
  maxResponseBytes: number;
}

interface EnvelopeBase {
  apiVersion: string;
  minimumClientVersion: string;
  requestId?: string | undefined;
  capabilities?: string[] | undefined;
  operations?: string[] | undefined;
}

type JsonObject = Record<string, unknown>;
type PairingAuthorityMismatchReason =
  | 'authority_mismatch'
  | 'authority_restarted'
  | 'record_replaced';

interface RequestJsonResult {
  discovered: CaveDiscoveredEndpoint;
  payload: unknown;
}

function transportError(
  code: string,
  message: string,
  options: {
    cause?: unknown;
    details?: Record<string, string> | undefined;
    requestId?: string | undefined;
    retryable?: boolean;
    statusCode?: number;
  } = {},
): Error {
  const error =
    options.cause === undefined
      ? new Error(message)
      : new Error(message, { cause: options.cause });

  return Object.assign(error, {
    code,
    retryable: options.retryable ?? false,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.statusCode === undefined ? {} : { statusCode: options.statusCode }),
    ...(options.details === undefined ? {} : { details: options.details }),
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureActive(context: OperationContext | undefined): void {
  if (context?.signal.aborted === true) {
    throw (context.signal as AbortSignal & { reason?: unknown }).reason ?? new Error('aborted');
  }
}

function pairingAuthorityMismatchReason(
  expected: CaveDiscoveredEndpoint,
  current: CaveDiscoveredEndpoint,
): PairingAuthorityMismatchReason | undefined {
  if (
    current.endpoint.url !== expected.endpoint.url ||
    current.record.path !== expected.record.path
  ) {
    return 'authority_mismatch';
  }

  if (expected.version === 2 && current.version === 2) {
    return undefined;
  }

  if (
    current.record.device !== expected.record.device ||
    current.record.inode !== expected.record.inode
  ) {
    return 'record_replaced';
  }

  if (
    current.freshness.pid !== expected.freshness.pid ||
    current.freshness.nonce !== expected.freshness.nonce ||
    current.freshness.startedAt !== expected.freshness.startedAt
  ) {
    return 'authority_restarted';
  }

  return undefined;
}

function pinnedPairingAuthorityError(reason: PairingAuthorityMismatchReason): Error {
  return transportError(
    'reconcile_required',
    'The discovered Cave authority changed before the pairing secret could be reused safely.',
    {
      details: { reason },
      retryable: true,
    },
  );
}

function spentPairingAuthorityProofError(
  reason: 'authority_proof_failed' | 'authority_restarted',
  cause?: unknown,
): Error {
  return transportError(
    'reconcile_required',
    'The Cave authority could not be proven after the pairing secret was spent; pair again.',
    {
      ...(cause === undefined ? {} : { cause }),
      details: { reason },
      retryable: false,
    },
  );
}

function assertPinnedPairingAuthority(
  current: CaveDiscoveredEndpoint,
  expected: CaveDiscoveredEndpoint | undefined,
): void {
  if (expected === undefined) {
    throw pinnedPairingAuthorityError('authority_mismatch');
  }

  const reason = pairingAuthorityMismatchReason(expected, current);
  if (reason !== undefined) {
    throw pinnedPairingAuthorityError(reason);
  }
}

function expectObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) {
    throw transportError('invalid_response', `${label} must be an object.`);
  }

  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw transportError('invalid_response', `${label} must be a non-empty string.`);
  }

  return value;
}

function expectTimestampNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw transportError('invalid_response', `${label} must be a non-negative safe integer.`);
  }

  return value;
}

function parseAdvertisedIds(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw transportError('invalid_response', `${label} must be an array.`);
  }

  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== 'string' ||
      entry.length > CAVE_CONTRACT_LIMITS.declarationIdCharacters ||
      !DECLARATION_ID_PATTERN.test(entry) ||
      seen.has(entry)
    ) {
      throw transportError('invalid_response', `${label} contained an invalid declaration id.`);
    }
    seen.add(entry);
    parsed.push(entry);
  }

  return parsed;
}

export function parseEnvelopeBase(value: unknown): EnvelopeBase {
  const envelope = expectObject(value, 'Client v1 envelope');
  const apiVersion = expectString(envelope.apiVersion, 'apiVersion');
  const minimumClientVersion = expectString(
    envelope.minimumClientVersion,
    'minimumClientVersion',
  );

  if (!CAVE_API_VERSION_PATTERN.test(apiVersion) || apiVersion.split('.')[0] !== '1') {
    throw transportError('incompatible_version', 'Cave apiVersion was not compatible.');
  }

  let compatibility: ReturnType<typeof assessCompatibility>;
  try {
    compatibility = assessCompatibility(minimumClientVersion, CAVE_CLIENT_VERSION);
  } catch {
    throw transportError('invalid_response', 'Cave minimumClientVersion was malformed.');
  }

  if (!compatibility.compatible) {
    throw transportError('incompatible_version', 'Cave minimumClientVersion was not compatible.');
  }

  const requestId =
    envelope.requestId === undefined ? undefined : expectString(envelope.requestId, 'requestId');
  const capabilities = parseAdvertisedIds(envelope.capabilities, 'capabilities');
  const operations = parseAdvertisedIds(envelope.operations, 'operations');

  return {
    apiVersion,
    minimumClientVersion,
    ...(requestId === undefined ? {} : { requestId }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(operations === undefined ? {} : { operations }),
  };
}

function parseHealthData(value: unknown): CaveHealthData {
  const data = expectObject(value, 'health.data');

  return {
    instanceId: expectString(data.instanceId, 'health.data.instanceId'),
    pairingRequired:
      typeof data.pairingRequired === 'boolean'
        ? data.pairingRequired
        : (() => {
            throw transportError(
              'invalid_response',
              'health.data.pairingRequired must be a boolean.',
            );
          })(),
    releaseVersion: expectString(data.releaseVersion, 'health.data.releaseVersion'),
  };
}

export function parseHealthResponse(value: unknown): CaveHealthResponse {
  const base = parseEnvelopeBase(value);
  const envelope = expectObject(value, 'health response');
  if (base.capabilities === undefined || base.operations === undefined) {
    throw transportError(
      'invalid_response',
      'health response must declare capabilities and operations.',
    );
  }

  return {
    apiVersion: base.apiVersion,
    minimumClientVersion: base.minimumClientVersion,
    ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    capabilities: [...base.capabilities],
    operations: [...base.operations],
    data: parseHealthData(envelope.data),
  };
}

export function parseCredentialMetadata(value: unknown): CaveCredentialMetadata {
  const credential = parseCaveCredentialMetadata(value, {
    allowAdditionalFields: true,
  });
  if (credential === undefined) {
    throw transportError('invalid_response', 'pairing.exchange credential was malformed.');
  }
  return credential;
}

function parsePairingCreated(value: unknown): CavePairingCreated {
  const envelope = expectObject(value, 'pairing.create response');
  parseEnvelopeBase(envelope);
  const data = expectObject(envelope.data, 'pairing.create data');
  const requestId = expectString(data.requestId, 'pairing.create.requestId');
  const secret = expectString(data.secret, 'pairing.create.secret');
  if (!UUID_RE.test(requestId) || !BASE64URL_43_RE.test(secret)) {
    throw transportError('invalid_response', 'pairing.create response was malformed.');
  }

  return {
    requestId,
    secret,
    expiresAt: expectTimestampNumber(data.expiresAt, 'pairing.create.expiresAt'),
  };
}

export function parsePairingStatus(value: unknown): CavePairingStatus {
  const envelope = expectObject(value, 'pairing.poll response');
  parseEnvelopeBase(envelope);
  const data = expectObject(envelope.data, 'pairing.poll data');
  const id = expectString(data.id, 'pairing.poll.id');
  const status = expectString(data.status, 'pairing.poll.status');
  if (!UUID_RE.test(id) || !['pending', 'approved', 'denied', 'expired'].includes(status)) {
    throw transportError('invalid_response', 'pairing.poll response was malformed.');
  }

  return {
    id,
    status: status as CavePairingStatus['status'],
    expiresAt: expectTimestampNumber(data.expiresAt, 'pairing.poll.expiresAt'),
  };
}

function parsePairingExchange(value: unknown): CavePairingExchange {
  const envelope = expectObject(value, 'pairing.exchange response');
  parseEnvelopeBase(envelope);
  const data = expectObject(envelope.data, 'pairing.exchange data');
  const bearer = expectString(data.bearer, 'pairing.exchange.bearer');
  if (!BASE64URL_43_RE.test(bearer)) {
    throw transportError('invalid_response', 'pairing.exchange bearer was malformed.');
  }

  return {
    bearer,
    credential: parseCredentialMetadata(data.credential),
  };
}

function parseFamiliar(value: unknown): CaveFamiliarWire {
  const familiar = expectObject(value, 'familiar');

  return {
    id: expectString(familiar.id, 'familiar.id'),
    display_name: expectString(familiar.display_name, 'familiar.display_name'),
    role: expectString(familiar.role, 'familiar.role'),
    ...(familiar.description === undefined
      ? {}
      : { description: expectString(familiar.description, 'familiar.description') }),
    ...(familiar.pronouns === undefined
      ? {}
      : { pronouns: expectString(familiar.pronouns, 'familiar.pronouns') }),
    ...(familiar.status === undefined
      ? {}
      : { status: expectString(familiar.status, 'familiar.status') }),
    ...(familiar.last_seen === undefined
      ? {}
      : { last_seen: expectString(familiar.last_seen, 'familiar.last_seen') }),
    ...(familiar.active_sessions === undefined
      ? {}
      : {
          active_sessions: expectTimestampNumber(
            familiar.active_sessions,
            'familiar.active_sessions',
          ),
        }),
    ...(familiar.memory_freshness === undefined
      ? {}
      : {
          memory_freshness: expectString(
            familiar.memory_freshness,
            'familiar.memory_freshness',
          ),
        }),
  };
}

export function parseFamiliarsResponse(value: unknown): CaveFamiliarsResponse {
  const envelope = expectObject(value, 'familiars response');
  parseEnvelopeBase(envelope);
  const data = expectObject(envelope.data, 'familiars data');
  if (!Array.isArray(data.familiars)) {
    throw transportError('invalid_response', 'familiars data was malformed.');
  }

  return {
    ok: true,
    familiars: data.familiars.map(parseFamiliar),
  };
}

function parseErrorDetails(
  value: unknown,
  options: {
    requestId?: string;
    statusCode: number;
  },
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw transportError('invalid_response', 'error.details was malformed.', {
      details: { field: 'error.details' },
      ...options,
    });
  }

  const details = value;
  const entries = Object.entries(details);
  if (entries.length > CAVE_CONTRACT_LIMITS.errorDetailEntries) {
    throw transportError('invalid_response', 'error.details contained too many entries.', {
      details: { field: 'error.details' },
      ...options,
    });
  }

  return Object.fromEntries(
    entries.map(([key, entry]) => {
      const field = `error.details.${key}`;
      if (
        typeof entry !== 'string' ||
        entry.length > CAVE_CONTRACT_LIMITS.errorDetailValueCharacters
      ) {
        throw transportError('invalid_response', `${field} was malformed.`, {
          details: { field },
          ...options,
        });
      }
      return [key, entry];
    }),
  );
}

function parseProxyFailure(status: number, payload: JsonObject): Error {
  const message = typeof payload.error === 'string' ? payload.error : 'Cave proxy refused the request.';
  const code =
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 404
        ? 'not_found'
        : status === 409
          ? 'conflict'
          : status === 410
            ? 'pairing_expired'
            : status === 429
              ? 'rate_limited'
              : status >= 500
                ? 'service_unavailable'
                : 'invalid_request';

  return transportError(code, message, {
    retryable: status === 429 || status >= 500,
    statusCode: status,
  });
}

export function parseErrorPayload(
  status: number,
  value: unknown,
  canonicalRequirements?: CaveCanonicalEnvelopeRequirements,
): Error {
  const payload = expectObject(value, 'error response');
  if (payload.ok === false && typeof payload.error === 'string') {
    if (canonicalRequirements !== undefined) {
      throw transportError('invalid_response', 'Cave response used a legacy proxy envelope.', {
        details: { field: 'response' },
        statusCode: status,
      });
    }
    return parseProxyFailure(status, payload);
  }

  if (
    payload.requestId !== undefined &&
    (
      typeof payload.requestId !== 'string' ||
      payload.requestId.length === 0 ||
      payload.requestId.length > CAVE_CONTRACT_LIMITS.requestIdCharacters
    )
  ) {
    throw transportError('invalid_response', 'requestId was malformed.', {
      details: { field: 'requestId' },
      statusCode: status,
    });
  }

  if (
    canonicalRequirements !== undefined &&
    payload.apiVersion !== CAVE_CONTRACT_API_VERSION
  ) {
    throw transportError('invalid_response', 'apiVersion was malformed.', {
      details: { field: 'apiVersion' },
      statusCode: status,
      ...(typeof payload.requestId === 'string'
        ? { requestId: payload.requestId }
        : {}),
    });
  }
  const base = parseEnvelopeBase(payload);
  if (base.capabilities === undefined || base.capabilities.length === 0) {
    throw transportError('invalid_response', 'capabilities was malformed.', {
      details: { field: 'capabilities' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }
  if (base.operations === undefined || base.operations.length === 0) {
    throw transportError('invalid_response', 'operations was malformed.', {
      details: { field: 'operations' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }
  if (
    canonicalRequirements !== undefined &&
    !base.operations.includes(canonicalRequirements.operation)
  ) {
    throw transportError('invalid_response', 'operations was malformed.', {
      details: { field: 'operations' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }
  if (
    canonicalRequirements !== undefined &&
    canonicalRequirements.capabilities.some(
      (capability) => !base.capabilities?.includes(capability),
    )
  ) {
    throw transportError('invalid_response', 'capabilities was malformed.', {
      details: { field: 'capabilities' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }
  if (payload.data !== undefined && payload.error !== undefined) {
    throw transportError('invalid_response', 'Cave response branches were ambiguous.', {
      details: { field: 'response' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }
  const error = expectObject(payload.error, 'error envelope');
  const code = expectString(error.code, 'error.code');
  if (!isCaveContractErrorCode(code)) {
    throw transportError('invalid_response', 'error.code was not supported.', {
      details: { field: 'error.code' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }

  if (
    typeof error.message !== 'string' ||
    error.message.length === 0 ||
    error.message.length > CAVE_CONTRACT_LIMITS.errorMessageCharacters
  ) {
    throw transportError('invalid_response', 'error.message was malformed.', {
      details: { field: 'error.message' },
      statusCode: status,
      ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    });
  }

  const details = parseErrorDetails(error.details, {
    statusCode: status,
    ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
  });
  return transportError(code, error.message, {
    ...(details === undefined ? {} : { details }),
    ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
    retryable:
      typeof error.retryable === 'boolean'
        ? error.retryable
        : (() => {
            throw transportError('invalid_response', 'error.retryable must be a boolean.', {
              statusCode: status,
              ...(base.requestId === undefined ? {} : { requestId: base.requestId }),
            });
          })(),
    statusCode: status,
  });
}

async function readResponseText(
  response: Response,
  context: OperationContext | undefined,
  maxResponseBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maxResponseBytes
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw transportError('body_limit', 'Cave response exceeded its size limit.', {
      statusCode: response.status,
    });
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw transportError('invalid_response', 'Cave response body was missing.', {
      statusCode: response.status,
    });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancellationStarted = false;
  const cancelReader = (reason?: unknown): void => {
    if (!cancellationStarted) {
      cancellationStarted = true;
      void reader.cancel(reason).catch(() => undefined);
    }
  };
  const onAbort = (): void => {
    cancelReader(context?.signal.reason);
  };
  context?.signal.addEventListener('abort', onAbort, { once: true });
  if (context?.signal.aborted === true) {
    onAbort();
  }

  try {
    while (true) {
      ensureActive(context);
      let readResult: { done: boolean; value: Uint8Array | undefined };
      try {
        readResult = await (
          reader as ReadableStreamDefaultReader<Uint8Array>
        ).read();
      } catch (error) {
        if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
          throw error;
        }

        ensureActive(context);
        throw error;
      }
      ensureActive(context);
      const { done, value } = readResult;
      if (done) {
        break;
      }
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxResponseBytes) {
          cancelReader();
          throw transportError('body_limit', 'Cave response exceeded its size limit.', {
            statusCode: response.status,
          });
        }
        chunks.push(value);
      }
    }
  } finally {
    context?.signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw transportError('invalid_response', 'Cave response was not valid UTF-8.', {
      statusCode: response.status,
    });
  }
}

function stringifyJsonBody(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw transportError('invalid_request', 'Cave request body could not be serialized.', {
      retryable: false,
    });
  }
}

function hpkeTransportFailure(): Error {
  return transportError(
    'invalid_response',
    'Cave HPKE transport authentication failed.',
    { retryable: false },
  );
}

function authorityUnavailable(): Error {
  return transportError(
    'service_unavailable',
    'Cave HPKE authority is unavailable.',
    {
      details: { reason: 'authority_unavailable' },
      retryable: true,
      statusCode: 503,
    },
  );
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw transportError(
      'invalid_response',
      'Cave authenticated response was not valid JSON.',
    );
  }
}

type PlaintextAuthorityGuidance =
  | 'stale-key'
  | 'stale-instance'
  | 'stale-request'
  | 'unavailable';

function plaintextAuthorityGuidance(
  response: Response,
  payload: unknown,
): PlaintextAuthorityGuidance | undefined {
  if (!isObject(payload) || !isObject(payload.error)) {
    return undefined;
  }
  const code = payload.error.code;
  const details = payload.error.details;
  const reason =
    isObject(details) && typeof details.reason === 'string'
      ? details.reason
      : undefined;
  if (
    response.status === 409 &&
    code === 'conflict' &&
    reason === 'authority_key_stale'
  ) {
    return 'stale-key';
  }
  if (
    response.status === 409 &&
    code === 'conflict' &&
    reason === 'authority_instance_stale'
  ) {
    return 'stale-instance';
  }
  if (
    response.status === 409 &&
    code === 'conflict' &&
    reason === 'authority_request_stale'
  ) {
    return 'stale-request';
  }
  if (
    response.status === 503 &&
    code === 'service_unavailable' &&
    reason === 'authority_unavailable'
  ) {
    return 'unavailable';
  }
  return undefined;
}

function authenticatedErrorReason(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, 'details');
  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, 'value') ||
    !isObject(descriptor.value)
  ) {
    return undefined;
  }
  return typeof descriptor.value.reason === 'string'
    ? descriptor.value.reason
    : undefined;
}

function retryAfterMilliseconds(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    return undefined;
  }
  const milliseconds = seconds * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

async function waitForHpkeRetry(
  delayMs: number,
  context: OperationContext | undefined,
): Promise<void> {
  ensureActive(context);
  if (
    context?.deadline !== undefined &&
    delayMs > Math.max(0, context.deadline - performance.now())
  ) {
    throw transportError('timeout', 'Cave HPKE retry exceeded the operation deadline.', {
      retryable: true,
    });
  }
  if (delayMs === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      context?.signal.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = (): void => {
      finish(() => reject(context?.signal.reason ?? new Error('aborted')));
    };
    const timer = setTimeout(() => finish(resolve), delayMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    context?.signal.addEventListener('abort', onAbort, { once: true });
    if (context?.signal.aborted === true) {
      onAbort();
    }
  });
  ensureActive(context);
}

async function requestJson(
  method: 'GET' | 'POST',
  route: string,
  options: {
    authorization?: CaveHpkeAuthorization;
    body?: string;
    context?: OperationContext;
    credentials?: CaveCredentialBinding;
    discoverEndpoint: (
      options?: DiscoverCaveEndpointOptions,
    ) => Promise<CaveDiscoveredEndpoint>;
    discovery: DiscoverCaveEndpointOptions | undefined;
    fetchImplementation: typeof fetch;
    headers?: Record<string, string>;
    hpkeState: {
      observedV2: boolean;
    };
    instanceId?: string;
    maxResponseBytes: number;
    onPreDispatchFailure?: (error: unknown) => unknown;
    pairingSecretDispatch?: 'reusable' | 'single_use';
    pinnedAuthority?: CaveDiscoveredEndpoint;
    protectedOperation?: CaveHpkeProtectedOperation;
    requireBearer?: boolean;
    canonicalRequirements?: CaveCanonicalEnvelopeRequirements;
  },
): Promise<RequestJsonResult> {
  let retried = false;
  let previousIssuedAt = 0;

  while (true) {
    ensureActive(options.context);
    let discovered: CaveDiscoveredEndpoint;

    try {
      discovered = await options.discoverEndpoint({
        ...(options.discovery ?? {}),
        ...(options.context?.signal === undefined
          ? {}
          : { signal: options.context.signal }),
        ...(options.context?.deadline === undefined
          ? {}
          : { deadline: options.context.deadline }),
      });
      ensureActive(options.context);
      if (discovered.version === 2) {
        options.hpkeState.observedV2 = true;
      }
      if (options.pinnedAuthority !== undefined) {
        assertPinnedPairingAuthority(discovered, options.pinnedAuthority);
      }
    } catch (error) {
      if (options.onPreDispatchFailure !== undefined) {
        throw options.onPreDispatchFailure(error);
      }
      throw error;
    }

    const protectedRequest = options.protectedOperation !== undefined;
    if (
      protectedRequest &&
      discovered.version === 1 &&
      options.hpkeState.observedV2
    ) {
      throw hpkeTransportFailure();
    }

    const url = new URL(route, discovered.endpoint.url).toString();
    const headers = new Headers(options.headers);
    let authorization = options.authorization;
    let instanceId = options.instanceId;

    if (options.requireBearer === true) {
      const credentials = options.credentials;
      if (credentials === undefined) {
        throw transportError(
          'unsupported_operation',
          'A stored Cave credential was required.',
          { retryable: false },
        );
      }
      const credential = await loadBoundCredential(
        credentials.store,
        credentials.reference,
        discovered,
        (value) => BASE64URL_43_RE.test(value),
        {
          ...(options.context === undefined
            ? {}
            : { context: options.context }),
          invalidateInvalid: true,
          preserveForAuthenticatedAuthority: discovered.version === 2,
          ...(discovered.version === 2
            ? {}
            : {
                verifyAuthorityInstance: async (expectedInstanceId) => {
                  const { payload } = await requestJson(
                    'GET',
                    '/api/client/v1/health',
                    {
                      ...(options.context === undefined
                        ? {}
                        : { context: options.context }),
                      discoverEndpoint: options.discoverEndpoint,
                      discovery: options.discovery,
                      fetchImplementation: options.fetchImplementation,
                      hpkeState: options.hpkeState,
                      maxResponseBytes: options.maxResponseBytes,
                      pinnedAuthority: discovered,
                    },
                  );
                  return (
                    parseHealthResponse(payload).data.instanceId ===
                    expectedInstanceId
                  );
                },
              }),
        },
      );
      ensureActive(options.context);

      if (
        credential.status === 'missing' ||
        credential.status === 'invalid_bearer'
      ) {
        throw transportError(
          'unauthorized',
          'A stored Cave credential was not available.',
          {
            retryable: false,
            statusCode: 401,
          },
        );
      }
      if (credential.status === 'invalid') {
        throw transportError(
          'reconcile_required',
          'The stored Cave credential must be paired again before reuse safely.',
          {
            details: { reason: credential.reason },
            retryable: false,
          },
        );
      }
      authorization = { kind: 'bearer', value: credential.bearer };
      instanceId = credential.authorityBinding?.instanceId;
    }

    let sealed:
      | Awaited<ReturnType<typeof createCaveHpkeBoundRequest>>
      | undefined;
    if (protectedRequest && discovered.version === 2) {
      if (authorization === undefined || instanceId === undefined) {
        const error = hpkeTransportFailure();
        if (options.onPreDispatchFailure !== undefined) {
          throw options.onPreDispatchFailure(error);
        }
        throw error;
      }
      headers.delete('authorization');
      headers.delete('x-coven-pairing-secret');
      try {
        const issuedAt = Math.max(Date.now(), previousIssuedAt + 1);
        previousIssuedAt = issuedAt;
        sealed = await createCaveHpkeBoundRequest({
          authority: discovered.authority,
          instanceId,
          runtimeNonce: discovered.freshness.nonce,
          operation: options.protectedOperation as CaveHpkeProtectedOperation,
          url,
          method,
          issuedAt,
          body:
            options.body === undefined
              ? new Uint8Array()
              : new TextEncoder().encode(options.body),
          authorization,
        });
      } catch (error) {
        if (options.onPreDispatchFailure !== undefined) {
          throw options.onPreDispatchFailure(error);
        }
        throw hpkeTransportFailure();
      }
    } else if (authorization?.kind === 'pairing-secret') {
      headers.set('x-coven-pairing-secret', authorization.value);
    } else if (authorization?.kind === 'bearer') {
      headers.set('authorization', `Bearer ${authorization.value}`);
    }

    let response: Response;
    try {
      response = await options.fetchImplementation(url, {
        cache: 'no-store',
        credentials: 'omit',
        method,
        headers: sealed?.request.headers ?? headers,
        redirect: 'error',
        ...(options.context?.signal === undefined
          ? {}
          : { signal: options.context.signal }),
        ...(options.body === undefined ? {} : { body: options.body }),
      });
    } catch (error) {
      if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
        throw error;
      }

      ensureActive(options.context);
      throw transportError(
        'service_unavailable',
        'Cave request could not reach the authority.',
        {
          retryable: options.pairingSecretDispatch !== 'single_use',
          ...(sealed === undefined ? { cause: error } : {}),
        },
      );
    }

    try {
      ensureActive(options.context);
    } catch (error) {
      void response.body?.cancel().catch(() => undefined);
      throw error;
    }

    if (sealed !== undefined) {
      if (
        response.status !== 200 ||
        response.headers.get('content-type') !==
          CAVE_HPKE_RESPONSE_MEDIA_TYPE
      ) {
        const text = await readResponseText(
          response,
          options.context,
          options.maxResponseBytes,
        ).catch(() => {
          throw hpkeTransportFailure();
        });
        let outerPayload: unknown;
        try {
          outerPayload = JSON.parse(text) as unknown;
        } catch {
          throw hpkeTransportFailure();
        }
        const guidance = plaintextAuthorityGuidance(
          response,
          outerPayload,
        );
        if (guidance === 'unavailable') {
          const error = authorityUnavailable();
          if (options.onPreDispatchFailure !== undefined) {
            throw options.onPreDispatchFailure(error);
          }
          throw error;
        }
        if (
          !retried &&
          (guidance === 'stale-key' ||
            guidance === 'stale-instance' ||
            guidance === 'stale-request')
        ) {
          retried = true;
          continue;
        }
        const error = hpkeTransportFailure();
        if (
          guidance !== undefined &&
          options.onPreDispatchFailure !== undefined
        ) {
          throw options.onPreDispatchFailure(error);
        }
        throw error;
      }

      let opened: Awaited<ReturnType<typeof sealed.open>>;
      try {
        opened = await sealed.open(response);
      } catch {
        throw hpkeTransportFailure();
      }
      ensureActive(options.context);
      const payload = parseJsonBytes(opened.body);
      if (opened.status < 200 || opened.status >= 300) {
        const error = parseErrorPayload(
          opened.status,
          payload,
          options.canonicalRequirements,
        );
        const reason = authenticatedErrorReason(error);
        const retryAfter = retryAfterMilliseconds(
          opened.headers.retryAfter,
        );
        if (
          !retried &&
          opened.status === 503 &&
          reason === 'authority_replay_capacity' &&
          retryAfter !== undefined
        ) {
          retried = true;
          await waitForHpkeRetry(retryAfter, options.context);
          continue;
        }
        throw error;
      }
      return { discovered, payload };
    }

    const text = await readResponseText(
      response,
      options.context,
      options.maxResponseBytes,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw transportError(
        'invalid_response',
        'Cave response was not valid JSON.',
        { statusCode: response.status },
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw parseErrorPayload(
        response.status,
        payload,
        options.canonicalRequirements,
      );
    }
    return { discovered, payload };
  }
}

function createDiscoveredTransport(
  options: DiscoveredTransportOptions,
): CaveCredentialPersistingTransport {
  const pairingAuthorities = new Map<
    string,
    {
      discovered: CaveDiscoveredEndpoint;
      instanceId?: string;
    }
  >();
  const canonicalRead = async (
    route: string,
    context: OperationContext | undefined,
    requirements: CaveCanonicalEnvelopeRequirements,
    protectedOperation: CaveHpkeProtectedOperation,
  ): Promise<unknown> => {
    const { payload } = await requestJson('GET', route, {
      ...(context === undefined ? {} : { context }),
      credentials: options.credentials,
      discoverEndpoint: options.discoverEndpoint,
      discovery: options.discovery,
      fetchImplementation: options.fetchImplementation,
      hpkeState: options.hpkeState,
      maxResponseBytes: options.maxResponseBytes,
      protectedOperation,
      requireBearer: true,
      canonicalRequirements: requirements,
    });
    return payload;
  };

  const requirePinnedAuthority = (
    requestId: string,
  ): {
    discovered: CaveDiscoveredEndpoint;
    instanceId?: string;
  } => {
    const pinnedAuthority = pairingAuthorities.get(requestId);
    if (pinnedAuthority === undefined) {
      throw pinnedPairingAuthorityError('authority_mismatch');
    }

    return pinnedAuthority;
  };

  return {
    async health(context) {
      const { payload } = await requestJson('GET', '/api/client/v1/health', {
        ...(context === undefined ? {} : { context }),
        discoverEndpoint: options.discoverEndpoint,
        discovery: options.discovery,
        fetchImplementation: options.fetchImplementation,
        hpkeState: options.hpkeState,
        maxResponseBytes: options.maxResponseBytes,
      });
      return parseHealthResponse(payload);
    },
    async pairingCreate(request, context) {
      const { payload, discovered } = await requestJson('POST', '/api/client/v1/pairing/requests', {
        body: stringifyJsonBody(request),
        ...(context === undefined ? {} : { context }),
        discoverEndpoint: options.discoverEndpoint,
        discovery: options.discovery,
        fetchImplementation: options.fetchImplementation,
        hpkeState: options.hpkeState,
        headers: {
          'content-type': 'application/json',
        },
        maxResponseBytes: options.maxResponseBytes,
      });
      const created = parsePairingCreated(payload);
      let instanceId: string | undefined;
      if (discovered.version === 2) {
        const health = await requestJson('GET', '/api/client/v1/health', {
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          hpkeState: options.hpkeState,
          maxResponseBytes: options.maxResponseBytes,
          pinnedAuthority: discovered,
        });
        instanceId = parseHealthResponse(health.payload).data.instanceId;
      }
      pairingAuthorities.set(created.requestId, {
        discovered,
        ...(instanceId === undefined ? {} : { instanceId }),
      });
      return created;
    },
    async pairingPoll(requestId, pairingSecret, context) {
      const pinned = requirePinnedAuthority(requestId);
      const { payload } = await requestJson(
        'GET',
        `/api/client/v1/pairing/requests/${requestId}`,
        {
          authorization: {
            kind: 'pairing-secret',
            value: pairingSecret,
          },
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          hpkeState: options.hpkeState,
          ...(pinned.instanceId === undefined
            ? {}
            : { instanceId: pinned.instanceId }),
          maxResponseBytes: options.maxResponseBytes,
          pairingSecretDispatch: 'reusable',
          pinnedAuthority: pinned.discovered,
          protectedOperation: 'pairing.poll',
        },
      );
      const status = parsePairingStatus(payload);
      if (status.status === 'denied' || status.status === 'expired') {
        pairingAuthorities.delete(requestId);
      }
      return status;
    },
    async pairingExchange(requestId, pairingSecret, context) {
      const pinned = requirePinnedAuthority(requestId);
      let expectedInstanceId: string;
      if (pinned.discovered.version === 2 && pinned.instanceId !== undefined) {
        expectedInstanceId = pinned.instanceId;
      } else {
        try {
          const expectedHealth = await requestJson('GET', '/api/client/v1/health', {
            ...(context === undefined ? {} : { context }),
            discoverEndpoint: options.discoverEndpoint,
            discovery: options.discovery,
            fetchImplementation: options.fetchImplementation,
            hpkeState: options.hpkeState,
            maxResponseBytes: options.maxResponseBytes,
            pinnedAuthority: pinned.discovered,
          });
          expectedInstanceId = parseHealthResponse(expectedHealth.payload).data.instanceId;
        } catch (error) {
          throw markPairingExchangeUnsentError(error, context);
        }
      }

      const { payload, discovered } = await requestJson(
        'POST',
        `/api/client/v1/pairing/requests/${requestId}/exchange`,
        {
          authorization: {
            kind: 'pairing-secret',
            value: pairingSecret,
          },
          body: '',
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          hpkeState: options.hpkeState,
          instanceId: expectedInstanceId,
          maxResponseBytes: options.maxResponseBytes,
          onPreDispatchFailure: (error) =>
            markPairingExchangeUnsentError(error, context),
          pairingSecretDispatch: 'single_use',
          pinnedAuthority: pinned.discovered,
          protectedOperation: 'pairing.exchange',
        },
      );
      const exchanged = parsePairingExchange(payload);
      pairingAuthorities.delete(requestId);
      if (discovered.version === 2) {
        return {
          ...exchanged,
          authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(
            discovered,
            expectedInstanceId,
          ),
        };
      }
      let verifiedHealth: RequestJsonResult;
      let verifiedInstanceId: string;
      try {
        verifiedHealth = await requestJson('GET', '/api/client/v1/health', {
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          hpkeState: options.hpkeState,
          maxResponseBytes: options.maxResponseBytes,
          pinnedAuthority: discovered,
        });
        verifiedInstanceId = parseHealthResponse(verifiedHealth.payload).data.instanceId;
      } catch (error) {
        throw spentPairingAuthorityProofError('authority_proof_failed', error);
      }
      if (verifiedInstanceId !== expectedInstanceId) {
        throw spentPairingAuthorityProofError('authority_restarted');
      }

      const authorityBoundExchange: CaveAuthorityBoundPairingExchange = {
        ...exchanged,
        authorityBinding: caveAuthorityBindingFromDiscoveredEndpoint(
          verifiedHealth.discovered,
          verifiedInstanceId,
        ),
      };
      return authorityBoundExchange;
    },
    async listFamiliars(pageOptions, context) {
      return canonicalRead(
        canonicalFamiliarsRoute(pageOptions),
        context,
        CAVE_CANONICAL_FAMILIARS_REQUIREMENTS,
        'familiars.list',
      );
    },
    async listProjects(pageOptions, context) {
      return canonicalRead(
        canonicalProjectsRoute(pageOptions),
        context,
        CAVE_CANONICAL_PROJECTS_REQUIREMENTS,
        'projects.list',
      );
    },
    async listConversations(pageOptions, context) {
      return canonicalRead(
        canonicalConversationsRoute(pageOptions),
        context,
        CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS,
        'conversations.list',
      );
    },
    async getConversation(conversationId, context) {
      return canonicalRead(
        canonicalConversationRoute(conversationId),
        context,
        CAVE_CANONICAL_CONVERSATION_REQUIREMENTS,
        'conversations.read',
      );
    },
    async listConversationMessages(conversationId, pageOptions, context) {
      return canonicalRead(
        canonicalConversationMessagesRoute(conversationId, pageOptions),
        context,
        CAVE_CANONICAL_MESSAGES_REQUIREMENTS,
        'messages.list',
      );
    },
    async familiars(context) {
      const { payload } = await requestJson('GET', '/api/client/v1/familiars', {
        ...(context === undefined ? {} : { context }),
        credentials: options.credentials,
        discoverEndpoint: options.discoverEndpoint,
        discovery: options.discovery,
        fetchImplementation: options.fetchImplementation,
        hpkeState: options.hpkeState,
        maxResponseBytes: options.maxResponseBytes,
        protectedOperation: 'familiars.list',
        requireBearer: true,
      });
      return parseFamiliarsResponse(payload);
    },
  };
}

export function createDiscoveredCaveClient(
  options: CaveDiscoveredClientOptions,
): CaveClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw transportError('unsupported_operation', 'A Fetch implementation is required.', {
      retryable: false,
    });
  }
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new RangeError('maxResponseBytes must be a positive safe integer.');
  }

  return createCaveClient({
    credentials: options.credentials,
    ...(options.operation === undefined ? {} : { operation: options.operation }),
    transport: createDiscoveredTransport({
      credentials: options.credentials,
      discoverEndpoint: options.discoverEndpoint ?? discoverCaveEndpoint,
      discovery: options.discovery,
      fetchImplementation,
      hpkeState: { observedV2: false },
      maxResponseBytes,
    }),
  });
}
