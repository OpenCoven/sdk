import { createHash } from 'node:crypto';

import {
  isOperationAbortedError,
  isOperationTimeoutError,
  normalizeError,
  OperationConfigurationError,
  runOperation,
  type NormalizedError,
  type OperationContext,
  type OperationDefaults,
  type OperationObserver,
  type OperationOptions,
} from '@opencoven/sdk-core';

import { parsePolicyJson, PolicyJsonError } from './policy-json.js';

export const COVEN_SESSION_POLICY_CONTRACT = 'coven.session-policy.v1';
export const COVEN_SESSION_POLICY_PROFILE = 'workspace-readonly-no-network.v1';

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_ADMISSION_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_BRAND = Symbol.for('@opencoven/coven-client/CovenSessionPolicyError');

export interface CovenSessionPolicyDiscovery {
  readonly contract: typeof COVEN_SESSION_POLICY_CONTRACT;
  readonly enforcement: 'unavailable';
  readonly supportedProfiles: readonly [];
  readonly reason: 'no_verified_enforcement_backend';
}

export interface CovenRestrictedLaunchRequest {
  readonly contract: typeof COVEN_SESSION_POLICY_CONTRACT;
  readonly requestId: string;
  readonly invocationId: string;
  readonly profile: typeof COVEN_SESSION_POLICY_PROFILE;
  readonly expiresAtUnixMs: number;
  readonly launch: {
    readonly projectRoot: string;
    readonly cwd: string;
    readonly harness: 'codex' | 'claude' | 'coven-code' | 'copilot';
    readonly familiarId: string;
    readonly launchMode: 'nonInteractive';
    readonly prompt: string;
    readonly title: string;
  };
}

export interface CovenSessionPolicyRefusal {
  readonly contract: typeof COVEN_SESSION_POLICY_CONTRACT;
  readonly requestId: string;
  readonly invocationId: string;
  readonly requestDigest: string;
  readonly decision: 'rejected';
  readonly code: 'enforcement_unavailable';
  readonly admission: 'not_started';
}

export type CovenSessionPolicyTransportRequest =
  | {
    readonly method: 'GET';
    readonly path: '/api/v1/session-policy';
    readonly maxResponseBytes: 16384;
  }
  | {
    readonly method: 'POST';
    readonly path: '/api/v1/sessions/restricted';
    readonly maxResponseBytes: 16384;
    /** Frozen UTF-8 octets. Send exactly once without reserialization. */
    readonly body: readonly number[];
  };

export interface CovenSessionPolicyTransportResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

/** Opt-in owner-local transport; never adapt the built-in health transport. */
export interface CovenSessionPolicyTransport {
  request(
    request: CovenSessionPolicyTransportRequest,
    context: OperationContext,
  ): Promise<CovenSessionPolicyTransportResponse>;
}

export interface CovenSessionPolicyClientOptions {
  readonly transport: CovenSessionPolicyTransport;
  readonly operation?: OperationDefaults;
}

export type CovenSessionPolicyErrorCode =
  | 'invalid_request'
  | 'invalid_response'
  | 'unsupported_contract'
  | 'unsupported_profile'
  | 'unsupported_platform'
  | 'http_error'
  | 'transport_error'
  | 'invalid_options'
  | 'aborted'
  | 'timeout';

export type CovenSessionPolicyDelivery = 'not_attempted' | 'unknown';
type PolicyOperation = 'sessionPolicy.discover' | 'sessionPolicy.launchRestricted';
interface Binding {
  readonly requestId: string;
  readonly invocationId: string;
  readonly requestDigest: string;
}

export class CovenSessionPolicyError extends Error {
  readonly normalized: NormalizedError;
  readonly retryable = false;
  readonly requestId: string | undefined;
  readonly invocationId: string | undefined;
  readonly requestDigest: string | undefined;

  constructor(
    readonly code: CovenSessionPolicyErrorCode,
    operation: PolicyOperation,
    readonly delivery: CovenSessionPolicyDelivery,
    readonly statusCode?: number,
    binding?: Binding,
  ) {
    super(`coven.${operation}: ${code}`);
    this.name = 'CovenSessionPolicyError';
    this.requestId = binding?.requestId;
    this.invocationId = binding?.invocationId;
    this.requestDigest = binding?.requestDigest;
    this.normalized = Object.freeze(normalizeError({
      code,
      retryable: false,
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(binding === undefined ? {} : { requestId: binding.requestId }),
    }, { system: 'coven', operation }));
    Object.defineProperty(this, ERROR_BRAND, { value: true });
  }
}

export function isCovenSessionPolicyError(error: unknown): error is CovenSessionPolicyError {
  if (typeof error !== 'object' || error === null) return false;
  try {
    return Object.getOwnPropertyDescriptor(error, ERROR_BRAND)?.value === true;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) &&
    !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= max;
}

const POLICY_HARNESS_WIRE_IDS = {
  codex: true, claude: true, 'coven-code': true, copilot: true,
} satisfies Record<CovenRestrictedLaunchRequest['launch']['harness'], true>;

function isPolicyHarnessWireId(value: unknown): value is CovenRestrictedLaunchRequest['launch']['harness'] {
  return typeof value === 'string' && Object.hasOwn(POLICY_HARNESS_WIRE_IDS, value);
}

function parseRequest(body: Uint8Array): CovenRestrictedLaunchRequest {
  const fail = (code: CovenSessionPolicyErrorCode = 'invalid_request'): never => {
    throw new CovenSessionPolicyError(code, 'sessionPolicy.launchRestricted', 'not_attempted');
  };
  let parsed: unknown;
  try {
    parsed = parsePolicyJson(body, MAX_REQUEST_BYTES, true);
  } catch (error) {
    if (error instanceof PolicyJsonError) return fail();
    throw error;
  }
  if (!closed(parsed, [
    'contract', 'requestId', 'invocationId', 'profile', 'expiresAtUnixMs', 'launch',
  ])) return fail();
  if (typeof parsed.contract !== 'string' || typeof parsed.profile !== 'string') return fail();
  if (parsed.contract !== COVEN_SESSION_POLICY_CONTRACT) return fail('unsupported_contract');
  if (parsed.profile !== COVEN_SESSION_POLICY_PROFILE) return fail('unsupported_profile');
  const launch = parsed.launch;
  const now = Date.now();
  if (
    typeof parsed.requestId !== 'string' || !UUID.test(parsed.requestId) ||
    typeof parsed.invocationId !== 'string' || !UUID.test(parsed.invocationId) ||
    typeof parsed.expiresAtUnixMs !== 'number' || !Number.isSafeInteger(parsed.expiresAtUnixMs) ||
    parsed.expiresAtUnixMs <= now || parsed.expiresAtUnixMs - now > MAX_ADMISSION_MS ||
    !closed(launch, ['projectRoot', 'cwd', 'harness', 'familiarId', 'launchMode', 'prompt', 'title']) ||
    !text(launch.projectRoot, 4096) || !text(launch.cwd, 4096) ||
    !isPolicyHarnessWireId(launch.harness) ||
    !text(launch.familiarId, 128) || launch.familiarId.trim() !== launch.familiarId ||
    launch.launchMode !== 'nonInteractive' || !text(launch.prompt, 1_000_000) ||
    !text(launch.title, 512, true)
  ) return fail();
  return {
    contract: COVEN_SESSION_POLICY_CONTRACT,
    requestId: parsed.requestId,
    invocationId: parsed.invocationId,
    profile: COVEN_SESSION_POLICY_PROFILE,
    expiresAtUnixMs: parsed.expiresAtUnixMs,
    launch: {
      projectRoot: launch.projectRoot, cwd: launch.cwd,
      harness: launch.harness, familiarId: launch.familiarId,
      launchMode: 'nonInteractive', prompt: launch.prompt, title: launch.title,
    },
  };
}

function responseData(value: CovenSessionPolicyTransportResponse): {
  status: number;
  body: Uint8Array;
} | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // A transport must supply data, not accessors that run while validating it.
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const status: unknown = descriptors.status?.value;
    const body: unknown = descriptors.body?.value;
    if (
      typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599 ||
      !(body instanceof Uint8Array) || body.byteLength > MAX_RESPONSE_BYTES
    ) return undefined;
    return { status, body };
  } catch {
    return undefined;
  }
}

function transportPolicyCode(error: unknown): CovenSessionPolicyErrorCode {
  if (!isCovenSessionPolicyError(error)) return 'transport_error';
  let code: unknown;
  try {
    code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  } catch {
    return 'transport_error';
  }
  switch (code) {
    case 'invalid_request':
    case 'invalid_response':
    case 'unsupported_contract':
    case 'unsupported_profile':
    case 'unsupported_platform':
    case 'http_error':
    case 'transport_error':
    case 'invalid_options':
    case 'aborted':
    case 'timeout':
      return code;
    default:
      return 'transport_error';
  }
}

export class CovenSessionPolicyClient {
  readonly #transport: CovenSessionPolicyTransport;
  readonly #operation: OperationDefaults | undefined;

  constructor(options: CovenSessionPolicyClientOptions) {
    this.#transport = options.transport;
    this.#operation = options.operation;
  }

  async discover(options: OperationOptions = {}): Promise<CovenSessionPolicyDiscovery> {
    return this.#execute(
      'sessionPolicy.discover',
      Object.freeze({ method: 'GET', path: '/api/v1/session-policy', maxResponseBytes: MAX_RESPONSE_BYTES }),
      options,
      (value, status, fail) => {
        if (status !== 200 || !closed(value, [
          'contract', 'enforcement', 'supportedProfiles', 'reason',
        ])) return fail('invalid_response');
        if (typeof value.contract !== 'string') return fail('invalid_response');
        if (value.contract !== COVEN_SESSION_POLICY_CONTRACT) return fail('unsupported_contract');
        if (
          !Array.isArray(value.supportedProfiles) ||
          !value.supportedProfiles.every((profile: unknown) => typeof profile === 'string')
        ) return fail('invalid_response');
        if (value.supportedProfiles.length > 0) return fail('unsupported_profile');
        if (
          value.enforcement !== 'unavailable' ||
          value.reason !== 'no_verified_enforcement_backend'
        ) return fail('invalid_response');
        return Object.freeze({
          contract: COVEN_SESSION_POLICY_CONTRACT,
          enforcement: 'unavailable',
          supportedProfiles: Object.freeze<[]>([]),
          reason: 'no_verified_enforcement_backend',
        });
      },
    );
  }

  async launchRestricted(
    body: Uint8Array,
    options: OperationOptions = {},
  ): Promise<CovenSessionPolicyRefusal> {
    const startedAt = performance.now();
    if (!(body instanceof Uint8Array) || body.byteLength > MAX_REQUEST_BYTES) {
      throw new CovenSessionPolicyError('invalid_request', 'sessionPolicy.launchRestricted', 'not_attempted');
    }
    // Copy actual octets before parsing; caller iterators cannot change the wire identity.
    const snapshot = new Uint8Array(body);
    const parsed = parseRequest(snapshot);
    const frozenBody = Object.freeze(Array.from(snapshot));
    const binding: Binding = {
      requestId: parsed.requestId,
      invocationId: parsed.invocationId,
      requestDigest: `sha256:${createHash('sha256').update(Buffer.from(frozenBody)).digest('hex')}`,
    };
    return this.#execute(
      'sessionPolicy.launchRestricted',
      Object.freeze({
        method: 'POST', path: '/api/v1/sessions/restricted',
        maxResponseBytes: MAX_RESPONSE_BYTES, body: frozenBody,
      }),
      options,
      (value, status, fail) => {
        if (status !== 409 || !closed(value, [
          'contract', 'requestId', 'invocationId', 'requestDigest', 'decision', 'code', 'admission',
        ])) return fail('invalid_response');
        if (typeof value.contract !== 'string') return fail('invalid_response');
        if (value.contract !== COVEN_SESSION_POLICY_CONTRACT) return fail('unsupported_contract');
        if (
          value.requestId !== binding.requestId || value.invocationId !== binding.invocationId ||
          value.requestDigest !== binding.requestDigest || value.decision !== 'rejected' ||
          value.code !== 'enforcement_unavailable' || value.admission !== 'not_started'
        ) return fail('invalid_response');
        return Object.freeze({
          contract: COVEN_SESSION_POLICY_CONTRACT,
          ...binding,
          decision: 'rejected',
          code: 'enforcement_unavailable',
          admission: 'not_started',
        });
      },
      binding,
      parsed.expiresAtUnixMs,
      startedAt,
    );
  }

  async #execute<T>(
    operation: PolicyOperation,
    request: CovenSessionPolicyTransportRequest,
    options: OperationOptions,
    validate: (
      value: unknown, status: number, fail: (code: CovenSessionPolicyErrorCode) => never,
    ) => T,
    binding?: Binding,
    expiresAtUnixMs?: number,
    startedAt = performance.now(),
  ): Promise<T> {
    let attempted = false;
    let status: number | undefined;
    const fail = (code: CovenSessionPolicyErrorCode): never => {
      throw new CovenSessionPolicyError(
        code, operation, attempted ? 'unknown' : 'not_attempted', status, binding,
      );
    };
    const timeoutMs = options.timeoutMs ?? this.#operation?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      return fail('invalid_options');
    }
    const operationDeadline = startedAt + Math.min(timeoutMs, MAX_ADMISSION_MS);
    const remaining = Math.min(
      operationDeadline - performance.now(),
      expiresAtUnixMs === undefined ? MAX_ADMISSION_MS : expiresAtUnixMs - Date.now(),
    );
    if (remaining <= 0) return fail('timeout');
    const observer = options.observer ?? this.#operation?.observer;
    const policyObserver: OperationObserver | undefined = observer === undefined ? undefined : {
      onEvent(event) {
        observer.onEvent('error' in event
          ? { ...event, error: { ...event.error, retryable: false } }
          : event);
      },
      onObserverError(error, event) {
        observer.onObserverError(error, event);
      },
    };
    const active = (context: OperationContext): void => {
      if (context.signal.aborted) {
        fail(isOperationTimeoutError(context.signal.reason) ? 'timeout' : 'aborted');
      }
      if (
        performance.now() >= operationDeadline ||
        (context.deadline !== undefined && performance.now() >= context.deadline) ||
        (expiresAtUnixMs !== undefined && Date.now() >= expiresAtUnixMs)
      ) fail('timeout');
    };
    try {
      return await runOperation(
        { system: 'coven', operation },
        {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(policyObserver === undefined ? {} : { observer: policyObserver }),
          timeoutMs: Math.ceil(remaining),
        },
        async (context) => {
          active(context);
          let response: CovenSessionPolicyTransportResponse;
          try {
            attempted = true;
            response = await this.#transport.request(request, context);
          } catch (error) {
            active(context);
            return fail(transportPolicyCode(error));
          }
          active(context);
          const data = responseData(response);
          if (data === undefined) return fail('invalid_response');
          status = data.status;
          let parsed: unknown;
          try {
            parsed = parsePolicyJson(data.body, MAX_RESPONSE_BYTES);
          } catch (error) {
            if (error instanceof PolicyJsonError) return fail('invalid_response');
            throw error;
          }
          active(context);
          if (status >= 400 && record(parsed) && Object.hasOwn(parsed, 'error')) {
            return fail('http_error');
          }
          return validate(parsed, status, fail);
        },
      );
    } catch (error) {
      if (isOperationTimeoutError(error)) return fail('timeout');
      if (isOperationAbortedError(error)) return fail('aborted');
      if (error instanceof OperationConfigurationError) return fail('invalid_options');
      throw error;
    }
  }
}

export function createCovenSessionPolicyClient(
  options: CovenSessionPolicyClientOptions,
): CovenSessionPolicyClient {
  return new CovenSessionPolicyClient(options);
}
