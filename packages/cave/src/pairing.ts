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
import { markPairingSecretUnsentError } from './pairing-secret.js';
import {
  loadBoundCredential,
} from './credential-binding.js';
import type {
  CaveAuthorityBoundPairingExchange,
  CaveCredentialMetadata,
  CaveFamiliarsResponse,
  CaveFamiliarWire,
  CaveHealthData,
  CaveHealthResponse,
  CavePairingCreated,
  CavePairingExchange,
  CavePairingScope,
  CavePairingStatus,
} from './schemas.js';
import { CAVE_PAIRING_SCOPES } from './schemas.js';
import type { CaveCredentialPersistingTransport } from './transport.js';
import { CAVE_CLIENT_VERSION } from './version.js';

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const CAVE_API_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DECLARATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL_43_RE = /^[A-Za-z0-9_-]{43}$/u;
const CAVE_PAIRING_SCOPE_SET = new Set<string>(CAVE_PAIRING_SCOPES);

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

function parseNullableTimestamp(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }

  return expectTimestampNumber(value, label);
}

function parseScopeList(value: unknown): CavePairingScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw transportError('invalid_response', 'credential.scopes must be a non-empty array.');
  }

  const scopes: CavePairingScope[] = [];
  for (const scope of value) {
    if (typeof scope !== 'string' || !CAVE_PAIRING_SCOPE_SET.has(scope) || scopes.includes(scope as CavePairingScope)) {
      throw transportError('invalid_response', 'credential.scopes contained an unsupported value.');
    }
    scopes.push(scope as CavePairingScope);
  }

  return scopes;
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

function parseEnvelopeBase(value: unknown): EnvelopeBase {
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

function parseHealthResponse(value: unknown): CaveHealthResponse {
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

function parseCredentialMetadata(value: unknown): CaveCredentialMetadata {
  const credential = expectObject(value, 'credential');
  const id = expectString(credential.id, 'credential.id');
  if (!UUID_RE.test(id)) {
    throw transportError('invalid_response', 'credential.id must be a UUID.');
  }

  return {
    id,
    appName: expectString(credential.appName, 'credential.appName'),
    installationId: expectString(credential.installationId, 'credential.installationId'),
    scopes: parseScopeList(credential.scopes),
    createdAt: expectTimestampNumber(credential.createdAt, 'credential.createdAt'),
    lastUsedAt: parseNullableTimestamp(credential.lastUsedAt, 'credential.lastUsedAt'),
    revokedAt: parseNullableTimestamp(credential.revokedAt, 'credential.revokedAt'),
    revocationReason:
      credential.revocationReason === null
        ? null
        : expectString(credential.revocationReason, 'credential.revocationReason'),
  };
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

function parsePairingStatus(value: unknown): CavePairingStatus {
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

function parseFamiliarsResponse(value: unknown): CaveFamiliarsResponse {
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

function parseErrorPayload(
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

async function requestJson(
  method: 'GET' | 'POST',
  route: string,
  options: {
    body?: string;
    context?: OperationContext;
    credentials?: CaveCredentialBinding;
    discoverEndpoint: (
      options?: DiscoverCaveEndpointOptions,
    ) => Promise<CaveDiscoveredEndpoint>;
    discovery: DiscoverCaveEndpointOptions | undefined;
    fetchImplementation: typeof fetch;
    headers?: Record<string, string>;
    maxResponseBytes: number;
    pairingSecretDispatch?: 'reusable' | 'single_use';
    pinnedAuthority?: CaveDiscoveredEndpoint;
    requireBearer?: boolean;
    canonicalRequirements?: CaveCanonicalEnvelopeRequirements;
  },
): Promise<RequestJsonResult> {
  ensureActive(options.context);
  let discovered: CaveDiscoveredEndpoint;

  try {
    discovered = await options.discoverEndpoint({
      ...(options.discovery ?? {}),
      ...(options.context?.signal === undefined ? {} : { signal: options.context.signal }),
      ...(options.context?.deadline === undefined ? {} : { deadline: options.context.deadline }),
    });
    ensureActive(options.context);
    if (options.pinnedAuthority !== undefined) {
      assertPinnedPairingAuthority(discovered, options.pinnedAuthority);
    }
  } catch (error) {
    if (options.pinnedAuthority !== undefined) {
      throw markPairingSecretUnsentError(error);
    }
    throw error;
  }

  const url = new URL(route, discovered.endpoint.url).toString();
  const headers = new Headers(options.headers);

  if (options.requireBearer === true) {
    const credentials = options.credentials;
    if (credentials === undefined) {
      throw transportError('unsupported_operation', 'A stored Cave credential was required.', {
        retryable: false,
      });
    }
    const credential = await loadBoundCredential(
      credentials.store,
      credentials.reference,
      discovered,
      (value) => BASE64URL_43_RE.test(value),
      {
        ...(options.context === undefined ? {} : { context: options.context }),
        invalidateInvalid: true,
        verifyAuthorityInstance: async (instanceId) => {
          const { payload } = await requestJson('GET', '/api/client/v1/health', {
            ...(options.context === undefined ? {} : { context: options.context }),
            discoverEndpoint: options.discoverEndpoint,
            discovery: options.discovery,
            fetchImplementation: options.fetchImplementation,
            maxResponseBytes: options.maxResponseBytes,
            pinnedAuthority: discovered,
          });
          return parseHealthResponse(payload).data.instanceId === instanceId;
        },
      },
    );
    ensureActive(options.context);

    if (credential.status === 'missing' || credential.status === 'invalid_bearer') {
      throw transportError('unauthorized', 'A stored Cave credential was not available.', {
        retryable: false,
        statusCode: 401,
      });
    }

    if (credential.status === 'invalid') {
      throw transportError(
        'reconcile_required',
        'The stored Cave credential must be paired again before reuse safely.',
        {
          details: {
            reason: credential.reason,
          },
          retryable: false,
        },
      );
    }

    headers.set('authorization', `Bearer ${credential.bearer}`);
  }

  let response: Response;
  try {
    response = await options.fetchImplementation(url, {
      cache: 'no-store',
      credentials: 'omit',
      method,
      headers,
      redirect: 'error',
      ...(options.context?.signal === undefined ? {} : { signal: options.context.signal }),
      ...(options.body === undefined ? {} : { body: options.body }),
    });
  } catch (error) {
    if (isOperationTimeoutError(error) || isOperationAbortedError(error)) {
      throw error;
    }

    ensureActive(options.context);
    throw transportError('service_unavailable', 'Cave request could not reach the authority.', {
      retryable: options.pairingSecretDispatch !== 'single_use',
      cause: error,
    });
  }

  try {
    ensureActive(options.context);
  } catch (error) {
    void response.body?.cancel().catch(() => undefined);
    throw error;
  }
  const text = await readResponseText(response, options.context, options.maxResponseBytes);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw transportError('invalid_response', 'Cave response was not valid JSON.', {
      statusCode: response.status,
    });
  }

  if (response.status < 200 || response.status >= 300) {
    throw parseErrorPayload(
      response.status,
      payload,
      options.canonicalRequirements,
    );
  }

  return {
    discovered,
    payload,
  };
}

function createDiscoveredTransport(
  options: DiscoveredTransportOptions,
): CaveCredentialPersistingTransport {
  const pairingAuthorities = new Map<string, CaveDiscoveredEndpoint>();
  const canonicalRead = async (
    route: string,
    context: OperationContext | undefined,
    requirements: CaveCanonicalEnvelopeRequirements,
  ): Promise<unknown> => {
    const { payload } = await requestJson('GET', route, {
      ...(context === undefined ? {} : { context }),
      credentials: options.credentials,
      discoverEndpoint: options.discoverEndpoint,
      discovery: options.discovery,
      fetchImplementation: options.fetchImplementation,
      maxResponseBytes: options.maxResponseBytes,
      requireBearer: true,
      canonicalRequirements: requirements,
    });
    return payload;
  };

  const requirePinnedAuthority = (requestId: string): CaveDiscoveredEndpoint => {
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
        headers: {
          'content-type': 'application/json',
        },
        maxResponseBytes: options.maxResponseBytes,
      });
      const created = parsePairingCreated(payload);
      pairingAuthorities.set(created.requestId, discovered);
      return created;
    },
    async pairingPoll(requestId, pairingSecret, context) {
      const { payload } = await requestJson(
        'GET',
        `/api/client/v1/pairing/requests/${requestId}`,
        {
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          headers: {
            'x-coven-pairing-secret': pairingSecret,
          },
          maxResponseBytes: options.maxResponseBytes,
          pairingSecretDispatch: 'reusable',
          pinnedAuthority: requirePinnedAuthority(requestId),
        },
      );
      const status = parsePairingStatus(payload);
      if (status.status === 'denied' || status.status === 'expired') {
        pairingAuthorities.delete(requestId);
      }
      return status;
    },
    async pairingExchange(requestId, pairingSecret, context) {
      let expectedInstanceId: string;
      try {
        const expectedHealth = await requestJson('GET', '/api/client/v1/health', {
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          maxResponseBytes: options.maxResponseBytes,
          pinnedAuthority: requirePinnedAuthority(requestId),
        });
        expectedInstanceId = parseHealthResponse(expectedHealth.payload).data.instanceId;
      } catch (error) {
        throw markPairingSecretUnsentError(error);
      }

      const { payload, discovered } = await requestJson(
        'POST',
        `/api/client/v1/pairing/requests/${requestId}/exchange`,
        {
          body: '',
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
          headers: {
            'x-coven-pairing-secret': pairingSecret,
          },
          maxResponseBytes: options.maxResponseBytes,
          pairingSecretDispatch: 'single_use',
          pinnedAuthority: requirePinnedAuthority(requestId),
        },
      );
      const exchanged = parsePairingExchange(payload);
      pairingAuthorities.delete(requestId);
      let verifiedHealth: RequestJsonResult;
      let verifiedInstanceId: string;
      try {
        verifiedHealth = await requestJson('GET', '/api/client/v1/health', {
          ...(context === undefined ? {} : { context }),
          discoverEndpoint: options.discoverEndpoint,
          discovery: options.discovery,
          fetchImplementation: options.fetchImplementation,
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
      );
    },
    async listProjects(pageOptions, context) {
      return canonicalRead(
        canonicalProjectsRoute(pageOptions),
        context,
        CAVE_CANONICAL_PROJECTS_REQUIREMENTS,
      );
    },
    async listConversations(pageOptions, context) {
      return canonicalRead(
        canonicalConversationsRoute(pageOptions),
        context,
        CAVE_CANONICAL_CONVERSATIONS_REQUIREMENTS,
      );
    },
    async getConversation(conversationId, context) {
      return canonicalRead(
        canonicalConversationRoute(conversationId),
        context,
        CAVE_CANONICAL_CONVERSATION_REQUIREMENTS,
      );
    },
    async listConversationMessages(conversationId, pageOptions, context) {
      return canonicalRead(
        canonicalConversationMessagesRoute(conversationId, pageOptions),
        context,
        CAVE_CANONICAL_MESSAGES_REQUIREMENTS,
      );
    },
    async familiars(context) {
      const { payload } = await requestJson('GET', '/api/client/v1/familiars', {
        ...(context === undefined ? {} : { context }),
        credentials: options.credentials,
        discoverEndpoint: options.discoverEndpoint,
        discovery: options.discovery,
        fetchImplementation: options.fetchImplementation,
        maxResponseBytes: options.maxResponseBytes,
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
      maxResponseBytes,
    }),
  });
}
