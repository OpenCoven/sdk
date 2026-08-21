import { lstat as nodeLstat } from 'node:fs/promises';
import { createConnection } from 'node:net';

import {
  parseDiscoveryEndpoint,
  type OperationContext,
} from '@opencoven/sdk-core';

import {
  CovenIpcError,
  type CovenDiscoveredEndpoint,
  type CovenIpcDiagnostics,
} from './discovery.js';
import type { CovenHealthResponse } from './schemas.js';
import type { CovenTransport } from './transport.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_DAEMON_ERROR_DEPTH = 16;
const MAX_DAEMON_ERROR_NODES = 1_024;
const MAX_DAEMON_ERROR_STRING_BYTES = 64 * 1024;
const HEALTH_REQUEST = Buffer.from(
  'GET /api/v1/health HTTP/1.1\r\n' +
    'Host: coven\r\n' +
    'Accept: application/json\r\n' +
    'Connection: close\r\n' +
    'Content-Length: 0\r\n\r\n',
  'utf8',
);
const SENSITIVE_FIELD_PATTERN =
  /(?:api[-_]?key|authorization|bearer|cookie|credential|header|password|secret|token)/iu;
const COVEN_DAEMON_RESPONSE_ERROR_BRAND = Symbol.for(
  '@opencoven/coven-client/CovenDaemonResponseError',
);

export interface CovenSocket {
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  write(data: Uint8Array | string): boolean;
  end(): this;
  destroy(): this;
  pause(): this;
  resume(): this;
}

export interface CovenConnectedSocket extends CovenSocket {
  readonly connecting: boolean;
  readonly destroyed: boolean;
}

export type CovenSocketConnector = (path: string) => CovenConnectedSocket;

export interface CovenUnixFileIdentity {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  symbolicLink: boolean;
  socket: boolean;
}

export interface CovenUnixPeerIdentity {
  uid: number;
  gid?: number;
  pid?: number;
}

export interface CovenUnixPeerIdentityAdapter {
  inspectConnected(socket: CovenConnectedSocket): Promise<CovenUnixPeerIdentity>;
}

export interface CovenUnixTransportSecurityProvider {
  readonly platform: 'unix';
  readonly peerIdentity: CovenUnixPeerIdentityAdapter;
}

export interface CovenDaemonFailure {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export class CovenDaemonResponseError extends Error {
  readonly retryable = false;
  readonly code: string;
  readonly statusCode: number;
  readonly daemon: CovenDaemonFailure;

  constructor(
    daemon: CovenDaemonFailure,
    statusCode: number,
  ) {
    super('Coven daemon returned an unsafe error response.');
    const sanitized = sanitizeDaemonFailure(daemon);
    this.message = `Coven daemon rejected the health request with ${sanitized.code}.`;
    this.name = 'CovenDaemonResponseError';
    this.daemon = sanitized;
    this.code = sanitized.code;
    this.statusCode = statusCode;
    Object.defineProperty(this, COVEN_DAEMON_RESPONSE_ERROR_BRAND, {
      value: true,
    });
  }
}

export function isCovenDaemonResponseError(
  error: unknown,
): error is CovenDaemonResponseError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      error,
      COVEN_DAEMON_RESPONSE_ERROR_BRAND,
    );
    return descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === true;
  } catch {
    return false;
  }
}

export function daemonFailureFromError(
  error: unknown,
): CovenDaemonFailure | undefined {
  if (!isCovenDaemonResponseError(error)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'daemon');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }
    return sanitizeDaemonFailure(descriptor.value);
  } catch {
    return undefined;
  }
}

export interface CovenHealthTransportLimits {
  connectTimeoutMs?: number;
  maxBodyBytes?: number;
  maxHeaderBytes?: number;
  requestTimeoutMs?: number;
}

export interface CovenUnixTransportDependencies {
  connect?: CovenSocketConnector;
  getEffectiveUid?: () => number | undefined;
  lstat?: (path: string) => Promise<CovenUnixFileIdentity>;
}

export interface CovenUnixTransportOptions extends CovenHealthTransportLimits {
  dependencies?: CovenUnixTransportDependencies;
  security: CovenUnixTransportSecurityProvider;
}

interface FramedHttpResponse {
  statusCode: number;
  body: Buffer;
}

interface HealthRequestOptions {
  connectTimeoutMs: number;
  maxBodyBytes: number;
  maxHeaderBytes: number;
  requestTimeoutMs: number;
}

interface SocketRequestHooks {
  connect: CovenSocketConnector;
  revalidate(socket: CovenConnectedSocket): Promise<void>;
}

function ipcError(
  code: ConstructorParameters<typeof CovenIpcError>[0],
  message: string,
  phase: CovenIpcDiagnostics['phase'],
  extra: Omit<CovenIpcDiagnostics, 'phase'> = {},
): CovenIpcError {
  return new CovenIpcError(code, message, { phase, ...extra });
}

function validLimit(value: number | undefined, fallback: number): number {
  if (
    value === undefined ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 2_147_483_647
  ) {
    return fallback;
  }
  return value;
}

function healthRequestOptions(
  options: CovenHealthTransportLimits,
): HealthRequestOptions {
  return {
    connectTimeoutMs: validLimit(
      options.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
    maxBodyBytes: validLimit(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES),
    maxHeaderBytes: validLimit(
      options.maxHeaderBytes,
      DEFAULT_MAX_HEADER_BYTES,
    ),
    requestTimeoutMs: validLimit(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  };
}

function remainingTimeout(
  configuredMs: number,
  context: OperationContext | undefined,
): number {
  if (context?.deadline === undefined) {
    return configuredMs;
  }
  return Math.max(1, Math.min(configuredMs, context.deadline - performance.now()));
}

function safeDestroy(socket: CovenSocket): void {
  try {
    socket.destroy();
  } catch {
    // Cleanup is best effort and must never replace the primary error.
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

class UnsafeDaemonValueError extends Error {}

interface DaemonSanitizationState {
  readonly seen: WeakSet<object>;
  nodes: number;
  stringBytes: number;
}

function unsafeDaemonValue(): never {
  throw new UnsafeDaemonValueError();
}

function countDaemonString(
  value: string,
  state: DaemonSanitizationState,
): string {
  state.stringBytes += Buffer.byteLength(value, 'utf8');
  if (state.stringBytes > MAX_DAEMON_ERROR_STRING_BYTES) {
    return unsafeDaemonValue();
  }
  return value;
}

function dataDescriptors(value: object): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return unsafeDaemonValue();
  }
}

function descriptorFromMap(
  descriptors: PropertyDescriptorMap,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return Reflect.getOwnPropertyDescriptor(descriptors, key)?.value;
}

function sanitizeDaemonValue(
  value: unknown,
  state: DaemonSanitizationState,
  depth: number,
): unknown {
  state.nodes += 1;
  if (
    state.nodes > MAX_DAEMON_ERROR_NODES ||
    depth > MAX_DAEMON_ERROR_DEPTH
  ) {
    return unsafeDaemonValue();
  }

  if (
    value === null ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : unsafeDaemonValue();
  }
  if (typeof value === 'string') {
    return countDaemonString(value, state);
  }
  if (typeof value !== 'object') {
    return unsafeDaemonValue();
  }

  if (state.seen.has(value)) {
    return unsafeDaemonValue();
  }
  state.seen.add(value);

  let array: boolean;
  let prototype: object | null;
  try {
    array = Array.isArray(value);
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    return unsafeDaemonValue();
  }

  const descriptors = dataDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === 'symbol')) {
    return unsafeDaemonValue();
  }

  if (array) {
    if (prototype !== Array.prototype) {
      return unsafeDaemonValue();
    }
    const length: unknown = descriptorFromMap(descriptors, 'length')?.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0) {
      return unsafeDaemonValue();
    }
    const entries = keys.filter((key) => key !== 'length');
    if (entries.length !== length) {
      return unsafeDaemonValue();
    }
    const sanitized: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptorFromMap(descriptors, String(index));
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return unsafeDaemonValue();
      }
      sanitized.push(sanitizeDaemonValue(descriptor.value, state, depth + 1));
    }
    return sanitized;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return unsafeDaemonValue();
  }
  const sanitized: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string' || SENSITIVE_FIELD_PATTERN.test(key)) {
      return unsafeDaemonValue();
    }
    countDaemonString(key, state);
    const descriptor = descriptorFromMap(descriptors, key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true
    ) {
      return unsafeDaemonValue();
    }
    Object.defineProperty(sanitized, key, {
      configurable: true,
      enumerable: true,
      value: sanitizeDaemonValue(descriptor.value, state, depth + 1),
      writable: true,
    });
  }
  return sanitized;
}

function sanitizeDaemonFailure(value: unknown): CovenDaemonFailure {
  let sanitized: unknown;
  try {
    sanitized = sanitizeDaemonValue(
      value,
      {
        seen: new WeakSet(),
        nodes: 0,
        stringBytes: 0,
      },
      0,
    );
  } catch {
    throw ipcError(
      'invalid_response',
      'Coven daemon returned an unsafe error response.',
      'read_response',
    );
  }

  if (!isPlainObject(sanitized)) {
    throw ipcError(
      'invalid_response',
      'Coven daemon returned an unsafe error response.',
      'read_response',
    );
  }
  if (
    typeof sanitized.code !== 'string' ||
    sanitized.code.length === 0 ||
    typeof sanitized.message !== 'string' ||
    sanitized.message.length === 0 ||
    (Object.hasOwn(sanitized, 'status') &&
      (!Number.isInteger(sanitized.status) ||
        (sanitized.status as number) < 100 ||
        (sanitized.status as number) > 599))
  ) {
    throw ipcError(
      'invalid_response',
      'Coven daemon returned an unsafe error response.',
      'read_response',
    );
  }

  return {
    code: sanitized.code,
    message: sanitized.message,
    ...(Object.hasOwn(sanitized, 'status')
      ? { status: sanitized.status as number }
      : {}),
    ...(Object.hasOwn(sanitized, 'details')
      ? { details: sanitized.details }
      : {}),
  };
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw ipcError(
      'invalid_response',
      'Coven daemon response body was not UTF-8.',
      'read_response',
    );
  }
}

function parseDaemonFailure(
  body: Buffer,
  statusCode: number,
): CovenDaemonResponseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(body)) as unknown;
  } catch {
    throw ipcError(
      'invalid_response',
      'Coven daemon returned an invalid error response.',
      'read_response',
    );
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.error)) {
    throw ipcError(
      'invalid_response',
      'Coven daemon returned an invalid error response.',
      'read_response',
    );
  }
  return new CovenDaemonResponseError(
    parsed.error as unknown as CovenDaemonFailure,
    statusCode,
  );
}

function headerBoundary(
  bytes: Buffer,
): { headerEnd: number; bodyStart: number } | undefined {
  const crlf = bytes.indexOf('\r\n\r\n');
  if (crlf >= 0) {
    return { headerEnd: crlf, bodyStart: crlf + 4 };
  }
  const lf = bytes.indexOf('\n\n');
  return lf >= 0 ? { headerEnd: lf, bodyStart: lf + 2 } : undefined;
}

function parseHeaders(
  bytes: Buffer,
): { statusCode: number; contentLength: number } {
  let serialized: string;
  try {
    serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw ipcError(
      'invalid_response',
      'Coven daemon response headers were not UTF-8.',
      'read_response',
    );
  }
  const lines = serialized.split(/\r?\n/u);
  const statusLine = lines.shift();
  const match =
    statusLine === undefined
      ? null
      : /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: .*)?$/u.exec(statusLine);
  if (match?.[1] === undefined) {
    throw ipcError(
      'invalid_response',
      'Coven daemon response was missing a valid HTTP status.',
      'read_response',
    );
  }

  let contentLength: number | undefined;
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw ipcError(
        'invalid_response',
        'Coven daemon response contained a malformed header.',
        'read_response',
      );
    }
    const rawName = line.slice(0, separator);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(rawName)) {
      throw ipcError(
        'invalid_response',
        'Coven daemon response contained a malformed header.',
        'read_response',
      );
    }
    const name = rawName.toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'transfer-encoding') {
      throw ipcError(
        'invalid_response',
        'Coven daemon response used unsupported transfer encoding.',
        'read_response',
      );
    }
    if (name === 'content-length') {
      if (contentLength !== undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
        throw ipcError(
          'invalid_response',
          'Coven daemon response had an invalid Content-Length.',
          'read_response',
        );
      }
      contentLength = Number(value);
      if (!Number.isSafeInteger(contentLength)) {
        throw ipcError(
          'invalid_response',
          'Coven daemon response had an invalid Content-Length.',
          'read_response',
        );
      }
    }
  }
  if (contentLength === undefined) {
    throw ipcError(
      'invalid_response',
      'Coven daemon response omitted Content-Length.',
      'read_response',
    );
  }
  return { statusCode: Number(match[1]), contentLength };
}

function parseCompletedResponse(
  received: Buffer,
  limits: HealthRequestOptions,
): FramedHttpResponse {
  const boundary = headerBoundary(received);
  if (boundary === undefined) {
    throw ipcError(
      'invalid_response',
      'Coven daemon closed before response headers completed.',
      'read_response',
    );
  }
  if (boundary.headerEnd > limits.maxHeaderBytes) {
    throw ipcError(
      'frame_limit',
      'Coven daemon response headers exceeded their size limit.',
      'read_response',
      { limitBytes: limits.maxHeaderBytes },
    );
  }
  const { statusCode, contentLength } = parseHeaders(
    received.subarray(0, boundary.headerEnd),
  );
  if (contentLength > limits.maxBodyBytes) {
    throw ipcError(
      'body_limit',
      'Coven daemon response body exceeded its size limit.',
      'read_response',
      { limitBytes: limits.maxBodyBytes },
    );
  }
  const body = received.subarray(boundary.bodyStart);
  if (body.length !== contentLength) {
    throw ipcError(
      body.length > contentLength ? 'frame_limit' : 'invalid_response',
      body.length > contentLength
        ? 'Coven daemon response contained trailing frame bytes.'
        : 'Coven daemon closed before its response body completed.',
      'read_response',
    );
  }
  return { statusCode, body };
}

function validateReceivedSize(
  received: Buffer,
  limits: HealthRequestOptions,
): void {
  const boundary = headerBoundary(received);
  if (boundary === undefined) {
    if (received.length > limits.maxHeaderBytes) {
      throw ipcError(
        'frame_limit',
        'Coven daemon response headers exceeded their size limit.',
        'read_response',
        { limitBytes: limits.maxHeaderBytes },
      );
    }
    return;
  }
  if (boundary.headerEnd > limits.maxHeaderBytes) {
    throw ipcError(
      'frame_limit',
      'Coven daemon response headers exceeded their size limit.',
      'read_response',
      { limitBytes: limits.maxHeaderBytes },
    );
  }
  const { contentLength } = parseHeaders(received.subarray(0, boundary.headerEnd));
  if (contentLength > limits.maxBodyBytes) {
    throw ipcError(
      'body_limit',
      'Coven daemon response body exceeded its size limit.',
      'read_response',
      { limitBytes: limits.maxBodyBytes },
    );
  }
  if (received.length - boundary.bodyStart > contentLength) {
    throw ipcError(
      'frame_limit',
      'Coven daemon response contained trailing frame bytes.',
      'read_response',
    );
  }
}

function decodeHealth(response: FramedHttpResponse): CovenHealthResponse {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw parseDaemonFailure(response.body, response.statusCode);
  }

  try {
    return JSON.parse(decodeUtf8(response.body)) as CovenHealthResponse;
  } catch {
    throw ipcError(
      'invalid_response',
      'Coven daemon health response was not valid JSON.',
      'read_response',
    );
  }
}

function completeResponse(
  received: Buffer,
  limits: HealthRequestOptions,
): FramedHttpResponse | undefined {
  const boundary = headerBoundary(received);
  if (boundary === undefined) {
    return undefined;
  }
  const { contentLength } = parseHeaders(
    received.subarray(0, boundary.headerEnd),
  );
  return received.length - boundary.bodyStart === contentLength
    ? parseCompletedResponse(received, limits)
    : undefined;
}

function signalReason(signal: AbortSignal): unknown {
  try {
    return signal.reason;
  } catch {
    return undefined;
  }
}

export function awaitOperationStep<T>(
  operation: () => Promise<T>,
  context: OperationContext | undefined,
  phase: CovenIpcDiagnostics['phase'],
): Promise<T> {
  const pending = Promise.resolve().then(operation);
  if (context === undefined) {
    return pending;
  }

  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      context.signal.removeEventListener('abort', onAbort);
      action();
    };

    const onAbort = (): void => {
      const reason = signalReason(context.signal);
      finish(() => {
        reject(
          reason instanceof Error
            ? reason
            : ipcError(
                'connect_failure',
                'Coven health request was aborted.',
                phase,
              ),
        );
      });
    };

    pending.then(
      (value) => {
        finish(() => {
          resolvePromise(value);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(
            error instanceof Error
              ? error
              : ipcError(
                  'connect_failure',
                  'Coven health operation failed.',
                  phase,
                ),
          );
        });
      },
    );

    context.signal.addEventListener('abort', onAbort, { once: true });
    if (context.signal.aborted) {
      onAbort();
      return;
    }
    if (context.deadline !== undefined) {
      const remainingMs = context.deadline - performance.now();
      if (remainingMs <= 0) {
        finish(() => {
          reject(
            ipcError(
              'timeout',
              'Coven daemon health operation timed out.',
              phase,
            ),
          );
        });
        return;
      }
      timer = setTimeout(() => {
        finish(() => {
          reject(
            ipcError(
              'timeout',
              'Coven daemon health operation timed out.',
              phase,
            ),
          );
        });
      }, remainingMs);
    }
  });
}

export function requestCovenHealthOverSocket(
  path: string,
  hooks: SocketRequestHooks,
  context: OperationContext | undefined,
  configuredLimits: CovenHealthTransportLimits,
): Promise<CovenHealthResponse> {
  const limits = healthRequestOptions(configuredLimits);

  return new Promise((resolvePromise, reject) => {
    let socket: CovenConnectedSocket;
    let settled = false;
    let connected = false;
    let endedBeforeRequest = false;
    let received = Buffer.alloc(0);
    let receivedBeforeRequest = false;
    let requestSent = false;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      action: () => void,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
      }
      if (requestTimer !== undefined) {
        clearTimeout(requestTimer);
      }
      context?.signal.removeEventListener('abort', onAbort);
      socket.removeListener('connect', onConnect);
      socket.removeListener('data', onData);
      socket.removeListener('end', onEnd);
      socket.removeListener('error', onError);
      safeDestroy(socket);
      action();
    };

    const failRequest = (error: unknown): void => {
      finish(() => {
        reject(
          error instanceof Error
            ? error
            : ipcError(
                'connect_failure',
                'Coven daemon health request failed.',
                connected ? 'read_response' : 'connect',
              ),
        );
      });
    };

    const onAbort = (): void => {
      const reason =
        context === undefined ? undefined : signalReason(context.signal);
      failRequest(
        (reason instanceof Error ? reason : undefined) ??
          ipcError(
            'connect_failure',
            'Coven health request was aborted.',
            connected ? 'read_response' : 'connect',
          ),
      );
    };

    const onError = (): void => {
      failRequest(
        ipcError(
          'connect_failure',
          connected
            ? 'Coven daemon connection failed during health.'
            : 'Could not connect to the Coven daemon.',
          connected ? 'read_response' : 'connect',
        ),
      );
    };

    const onData = (chunk: unknown): void => {
      if (!(chunk instanceof Uint8Array)) {
        failRequest(
          ipcError(
            'invalid_response',
            'Coven daemon emitted a non-byte response.',
            'read_response',
          ),
        );
        return;
      }
      try {
        received = Buffer.concat([received, Buffer.from(chunk)]);
        validateReceivedSize(received, limits);
        if (!requestSent) {
          receivedBeforeRequest = true;
          return;
        }
        const response = completeResponse(received, limits);
        if (response !== undefined) {
          const health = decodeHealth(response);
          finish(() => {
            resolvePromise(health);
          });
        }
      } catch (error) {
        failRequest(error);
      }
    };

    const onEnd = (): void => {
      if (!requestSent) {
        endedBeforeRequest = true;
        return;
      }
      try {
        const health = decodeHealth(parseCompletedResponse(received, limits));
        finish(() => {
          resolvePromise(health);
        });
      } catch (error) {
        failRequest(error);
      }
    };

    const onConnect = (): void => {
      connected = true;
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
      try {
        socket.pause();
      } catch {
        failRequest(
          ipcError(
            'connect_failure',
            'Could not pause the Coven daemon connection for validation.',
            'revalidate_endpoint',
          ),
        );
        return;
      }
      requestTimer = setTimeout(() => {
        failRequest(
          ipcError(
            'timeout',
            'Coven daemon health request timed out.',
            'read_response',
          ),
        );
      }, remainingTimeout(limits.requestTimeoutMs, context));
      void hooks
        .revalidate(socket)
        .then(() => {
          if (settled) {
            return;
          }
          if (receivedBeforeRequest || endedBeforeRequest) {
            failRequest(
              ipcError(
                'invalid_response',
                'Coven daemon sent data before request validation completed.',
                'read_response',
              ),
            );
            return;
          }
          try {
            requestSent = true;
            socket.write(HEALTH_REQUEST);
            socket.end();
            socket.resume();
          } catch {
            failRequest(
              ipcError(
                'connect_failure',
                'Could not write the Coven daemon health request.',
                'write_request',
              ),
            );
          }
        })
        .catch(failRequest);
    };

    try {
      socket = hooks.connect(path);
    } catch {
      reject(
        ipcError(
          'connect_failure',
          'Could not connect to the Coven daemon.',
          'connect',
        ),
      );
      return;
    }

    socket.once('connect', onConnect);
    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('error', onError);
    context?.signal.addEventListener('abort', onAbort, { once: true });
    if (context?.signal.aborted === true) {
      onAbort();
      return;
    }
    connectTimer = setTimeout(() => {
      failRequest(
        ipcError(
          'timeout',
          'Coven daemon connection timed out.',
          'connect',
        ),
      );
    }, remainingTimeout(limits.connectTimeoutMs, context));
  });
}

function validUnixEndpoint(
  discovered: CovenDiscoveredEndpoint,
): Extract<CovenDiscoveredEndpoint['endpoint'], { kind: 'unix' }> {
  if (
    discovered.version !== 1 ||
    discovered.protocol !== 'coven.daemon.v1' ||
    discovered.endpoint.kind !== 'unix'
  ) {
    throw ipcError(
      'unsafe_endpoint',
      'Coven Unix transport requires a reviewed Unix endpoint.',
      'validate_endpoint',
    );
  }
  try {
    const endpoint = parseDiscoveryEndpoint(discovered.endpoint);
    if (endpoint.kind !== 'unix') {
      throw new TypeError('not a Unix endpoint');
    }
    return endpoint;
  } catch {
    throw ipcError(
      'unsafe_endpoint',
      'Coven Unix transport received an unsafe endpoint.',
      'validate_endpoint',
    );
  }
}

async function defaultUnixLstat(path: string): Promise<CovenUnixFileIdentity> {
  const stats = await nodeLstat(path);
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    ownerUid: stats.uid,
    symbolicLink: stats.isSymbolicLink(),
    socket: stats.isSocket(),
  };
}

function validateUnixIdentity(
  identity: CovenUnixFileIdentity,
  expectedUid: number,
  phase: 'validate_endpoint' | 'revalidate_endpoint',
): void {
  if (identity.ownerUid !== expectedUid) {
    throw ipcError(
      'owner_mismatch',
      'Coven Unix socket owner did not match the current user.',
      phase,
    );
  }
  if (
    identity.symbolicLink ||
    !identity.socket ||
    (identity.mode & 0o022) !== 0
  ) {
    throw ipcError(
      'unsafe_endpoint',
      'Coven Unix socket was writable by another user.',
      phase,
    );
  }
}

function validateUnixPeerIdentity(
  identity: CovenUnixPeerIdentity,
  expectedUid: number,
): void {
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(identity);
  } catch {
    throw ipcError(
      'unsafe_endpoint',
      'Connected Coven Unix peer identity was invalid.',
      'revalidate_endpoint',
    );
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !['uid', 'gid', 'pid'].includes(key),
    )
  ) {
    throw ipcError(
      'unsafe_endpoint',
      'Connected Coven Unix peer identity was invalid.',
      'revalidate_endpoint',
    );
  }
  const ownData = (key: 'uid' | 'gid' | 'pid'): unknown => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  };
  const uid = ownData('uid');
  const gid = ownData('gid');
  const pid = ownData('pid');
  if (
    typeof uid !== 'number' ||
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    (gid !== undefined &&
      (typeof gid !== 'number' || !Number.isSafeInteger(gid) || gid < 0)) ||
    (pid !== undefined &&
      (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0))
  ) {
    throw ipcError(
      'unsafe_endpoint',
      'Connected Coven Unix peer identity was invalid.',
      'revalidate_endpoint',
    );
  }
  if (uid !== expectedUid) {
    throw ipcError(
      'owner_mismatch',
      'Connected Coven Unix peer owner did not match the current user.',
      'revalidate_endpoint',
    );
  }
}

function sameUnixPathIdentity(
  initial: CovenUnixFileIdentity,
  confirmed: CovenUnixFileIdentity,
): boolean {
  return (
    confirmed.device === initial.device &&
    confirmed.inode === initial.inode &&
    confirmed.mode === initial.mode &&
    confirmed.ownerUid === initial.ownerUid &&
    confirmed.symbolicLink === initial.symbolicLink &&
    confirmed.socket === initial.socket
  );
}

function defaultUnixConnector(path: string): CovenConnectedSocket {
  return createConnection({ path });
}

export function createCovenUnixTransport(
  discovered: CovenDiscoveredEndpoint,
  options: CovenUnixTransportOptions,
): CovenTransport {
  const endpoint = validUnixEndpoint(discovered);
  if (
    options?.security?.platform !== 'unix' ||
    typeof options.security.peerIdentity?.inspectConnected !== 'function'
  ) {
    throw ipcError(
      'unsafe_endpoint',
      'Coven Unix connected-peer security is required.',
      'validate_endpoint',
    );
  }
  const connect = options.dependencies?.connect ?? defaultUnixConnector;
  const lstat = options.dependencies?.lstat ?? defaultUnixLstat;
  const peerIdentity = options.security.peerIdentity;
  const getEffectiveUid =
    options.dependencies?.getEffectiveUid ??
    (() => process.geteuid?.());

  return {
    async health(context) {
      const effectiveUid = getEffectiveUid();
      if (!Number.isSafeInteger(effectiveUid) || (effectiveUid as number) < 0) {
        throw ipcError(
          'owner_mismatch',
          'The current effective user could not be identified.',
          'validate_endpoint',
        );
      }
      const expectedUid = effectiveUid as number;
      if (
        discovered.owner?.kind === 'unix' &&
        discovered.owner.uid !== expectedUid
      ) {
        throw ipcError(
          'owner_mismatch',
          'Discovered Coven owner did not match the current user.',
          'validate_endpoint',
        );
      }

      const initial = await awaitOperationStep(
        async () => {
          try {
            return await lstat(endpoint.path);
          } catch (error) {
            const notFound =
              typeof error === 'object' &&
              error !== null &&
              Reflect.get(error, 'code') === 'ENOENT';
            throw ipcError(
              notFound ? 'not_found' : 'unsafe_endpoint',
              notFound
                ? 'Coven Unix socket was not found.'
                : 'Coven Unix socket could not be inspected safely.',
              'validate_endpoint',
            );
          }
        },
        context,
        'validate_endpoint',
      );
      validateUnixIdentity(initial, expectedUid, 'validate_endpoint');

      return requestCovenHealthOverSocket(
        endpoint.path,
        {
          connect,
          async revalidate(socket) {
            const connectedPeer = await Promise.resolve()
              .then(() => peerIdentity.inspectConnected(socket))
              .catch(() => {
                throw ipcError(
                  'unsafe_endpoint',
                  'Connected Coven Unix peer identity could not be established.',
                  'revalidate_endpoint',
                );
              });
            validateUnixPeerIdentity(connectedPeer, expectedUid);
            const confirmed = await Promise.resolve()
              .then(() => lstat(endpoint.path))
              .catch(() => {
                throw ipcError(
                  'unsafe_endpoint',
                  'Coven Unix socket changed during connection.',
                  'revalidate_endpoint',
                );
              });
            validateUnixIdentity(
              confirmed,
              expectedUid,
              'revalidate_endpoint',
            );
            if (!sameUnixPathIdentity(initial, confirmed)) {
              throw ipcError(
                'unsafe_endpoint',
                'Coven Unix socket changed during connection.',
                'revalidate_endpoint',
              );
            }
          },
        },
        context,
        options,
      );
    },
  };
}
