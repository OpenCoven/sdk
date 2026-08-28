import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  Aes256Gcm,
  CipherSuite,
  HkdfSha256,
} from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import canonicalize from 'canonicalize';

import type { CaveDiscoveredEndpointV2 } from './discovery.js';
import { CAVE_HPKE_KEY_ID_DOMAIN } from './discovery-record.js';

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/u;
const METHOD_RE = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/u;
const REQUEST_AAD_DOMAIN = UTF8.encode(
  'OpenCoven/client-v1/hpke-bound-v1/aad/request\0',
);
const RESPONSE_AAD_DOMAIN = UTF8.encode(
  'OpenCoven/client-v1/hpke-bound-v1/aad/response\0',
);

export const CAVE_HPKE_MECHANISM = 'hpke-bound-v1' as const;
export const CAVE_HPKE_RESPONSE_MEDIA_TYPE =
  'application/vnd.opencoven.client-v1.hpke-bound-v1+json' as const;
export const CAVE_HPKE_REQUEST_INFO = UTF8.encode(
  'OpenCoven/client-v1/hpke-bound-v1/request',
);
export const CAVE_HPKE_RESPONSE_INFO = UTF8.encode(
  'OpenCoven/client-v1/hpke-bound-v1/response',
);
export const CAVE_HPKE_HEADERS = Object.freeze({
  mechanism: 'x-coven-client-v1-authority',
  keyId: 'x-coven-client-v1-authority-key-id',
  instanceId: 'x-coven-client-v1-authority-instance',
  runtimeNonce: 'x-coven-client-v1-authority-runtime-nonce',
  requestNonce: 'x-coven-client-v1-authority-request-nonce',
  issuedAt: 'x-coven-client-v1-authority-issued-at',
  enc: 'x-coven-client-v1-authority-enc',
  ciphertext: 'x-coven-client-v1-authority-ciphertext',
} as const);
export const CAVE_HPKE_LIMITS = Object.freeze({
  rawKeyBytes: 32,
  encodedKeyCharacters: 43,
  requestPlaintextBytes: 1_024,
  requestCiphertextBytes: 2_048,
  requestBodyBytes: 65_536,
  responsePlaintextBytes: 8 * 1_024 * 1_024,
  responseCiphertextBytes: 8_388_624,
  responseEnvelopeBytes: 11_185_056,
  canonicalRouteBytes: 2_048,
  instanceIdBytes: 256,
} as const);

export type CaveHpkeAuthorization =
  | { kind: 'pairing-secret'; value: string }
  | { kind: 'bearer'; value: string };

export interface CaveHpkeBinding {
  method: string;
  route: string;
  bodySha256: Uint8Array;
  instanceId: string;
  runtimeNonce: string;
  runtimeNonceBytes: Uint8Array;
  keyId: string;
  keyIdBytes: Uint8Array;
  requestNonce: string;
  requestNonceBytes: Uint8Array;
  issuedAt: number;
}

export interface CaveHpkeOpenedResponse {
  status: number;
  headers: {
    contentType: 'application/json';
    retryAfter?: string;
  };
  body: Uint8Array;
}

export interface CaveHpkeBoundRequest {
  headers: Headers;
  binding: CaveHpkeBinding;
  requestAad: Uint8Array;
  responseAad: Uint8Array;
  open(
    response: Response,
    options: {
      maxBodyBytes: number;
      signal?: AbortSignal;
    },
  ): Promise<CaveHpkeOpenedResponse>;
}

function authorityError(
  code: string,
  message: string,
  options: {
    cause?: unknown;
    details?: Record<string, string>;
    retryable?: boolean;
    statusCode?: number;
  } = {},
): Error {
  const error = options.cause === undefined
    ? new Error(message)
    : new Error(message, { cause: options.cause });
  return Object.assign(error, {
    code,
    retryable: options.retryable ?? false,
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.statusCode === undefined ? {} : { statusCode: options.statusCode }),
  });
}

function proofError(cause?: unknown): Error {
  return authorityError(
    'reconcile_required',
    'The Cave HPKE authority response could not be authenticated.',
    {
      ...(cause === undefined ? {} : { cause }),
      details: { reason: 'authority_proof_failed' },
      retryable: false,
    },
  );
}

function bytesOf(value: ArrayBufferLike | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

export function caveBase64UrlEncode(
  value: ArrayBufferLike | ArrayBufferView,
): string {
  return Buffer.from(bytesOf(value)).toString('base64url');
}

export function caveBase64UrlDecode(
  value: unknown,
  bounds: { minimum: number; maximum: number },
): Uint8Array {
  if (
    !Number.isSafeInteger(bounds.minimum) ||
    !Number.isSafeInteger(bounds.maximum) ||
    bounds.minimum < 0 ||
    bounds.maximum < bounds.minimum ||
    typeof value !== 'string' ||
    value.includes('=') ||
    !BASE64URL_RE.test(value) ||
    value.length > Math.ceil((bounds.maximum * 4) / 3)
  ) {
    throw new Error('Cave HPKE value was not canonical base64url.');
  }
  const bytes = Uint8Array.from(Buffer.from(value, 'base64url'));
  if (
    bytes.byteLength < bounds.minimum ||
    bytes.byteLength > bounds.maximum ||
    caveBase64UrlEncode(bytes) !== value
  ) {
    throw new Error('Cave HPKE value had an invalid length or encoding.');
  }
  return bytes;
}

function uint32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('Cave HPKE uint32 value was invalid.');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Cave HPKE uint64 value was invalid.');
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

export function concatCaveHpkeBytes(...values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function frame(value: Uint8Array): Uint8Array {
  return concatCaveHpkeBytes(uint32be(value.byteLength), value);
}

function rfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalCaveHpkeRoute(url: URL): string {
  if (url.pathname.includes('%') || url.pathname.includes('\\')) {
    throw new Error('Cave HPKE route path was not canonical.');
  }
  const pairs = [...url.searchParams.entries()]
    .map(([name, value]) => [
      rfc3986Component(name),
      rfc3986Component(value),
    ] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? asciiCompare(leftValue, rightValue)
        : asciiCompare(leftName, rightName),
    );
  const query = pairs.map(([name, value]) => `${name}=${value}`).join('&');
  const route = query.length > 0 ? `${url.pathname}?${query}` : url.pathname;
  if (UTF8.encode(route).byteLength > CAVE_HPKE_LIMITS.canonicalRouteBytes) {
    throw new Error('Cave HPKE route exceeded its size limit.');
  }
  return route;
}

function requireBinding(binding: CaveHpkeBinding): void {
  const instanceIdBytes = UTF8.encode(binding.instanceId);
  if (
    !METHOD_RE.test(binding.method) ||
    !binding.route.startsWith('/') ||
    UTF8.encode(binding.route).byteLength > CAVE_HPKE_LIMITS.canonicalRouteBytes ||
    binding.bodySha256.byteLength !== 32 ||
    instanceIdBytes.byteLength < 1 ||
    instanceIdBytes.byteLength > CAVE_HPKE_LIMITS.instanceIdBytes ||
    binding.runtimeNonceBytes.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes ||
    binding.keyIdBytes.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes ||
    binding.requestNonceBytes.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes ||
    binding.runtimeNonce !== caveBase64UrlEncode(binding.runtimeNonceBytes) ||
    binding.keyId !== caveBase64UrlEncode(binding.keyIdBytes) ||
    binding.requestNonce !== caveBase64UrlEncode(binding.requestNonceBytes) ||
    !Number.isSafeInteger(binding.issuedAt) ||
    binding.issuedAt < 1 ||
    String(binding.issuedAt).length > 16
  ) {
    throw new Error('Cave HPKE binding was invalid.');
  }
}

export function encodeCaveHpkeAad(
  domain: 'request' | 'response',
  binding: CaveHpkeBinding,
): Uint8Array {
  requireBinding(binding);
  return concatCaveHpkeBytes(
    domain === 'request' ? REQUEST_AAD_DOMAIN : RESPONSE_AAD_DOMAIN,
    frame(UTF8.encode(binding.method)),
    frame(UTF8.encode(binding.route)),
    frame(binding.bodySha256),
    frame(UTF8.encode(binding.instanceId)),
    frame(binding.runtimeNonceBytes),
    frame(binding.keyIdBytes),
    frame(binding.requestNonceBytes),
    frame(uint64be(binding.issuedAt)),
  );
}

export function createCaveHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

export function caveHpkeKeyId(publicKey: Uint8Array): Uint8Array {
  if (publicKey.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes) {
    throw new Error('Cave HPKE public key length was invalid.');
  }
  return new Uint8Array(
    createHash('sha256')
      .update(CAVE_HPKE_KEY_ID_DOMAIN, 'utf8')
      .update(publicKey)
      .digest(),
  );
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort(asciiCompare);
  const required = [...expected].sort(asciiCompare);
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function jcs(value: unknown): Uint8Array {
  const rendered = canonicalize(value);
  if (typeof rendered !== 'string') {
    throw new Error('Cave HPKE value could not be rendered as canonical JSON.');
  }
  return UTF8.encode(rendered);
}

function validateAuthorization(value: CaveHpkeAuthorization): void {
  if (value.kind === 'pairing-secret') {
    caveBase64UrlDecode(value.value, { minimum: 32, maximum: 32 });
    return;
  }
  if (
    value.kind !== 'bearer' ||
    value.value.length < 1 ||
    value.value.length > 512 ||
    !/^[\x21-\x7e]+$/u.test(value.value)
  ) {
    throw new Error('Cave HPKE authorization was invalid.');
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

async function readBounded(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (
      !/^(?:0|[1-9][0-9]*)$/u.test(contentLength) ||
      !Number.isSafeInteger(parsed) ||
      parsed > maximumBytes
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw proofError();
    }
  }
  if (response.body === null) throw proofError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const onAbort = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted === true) onAbort();
  try {
    while (true) {
      if (signal?.aborted === true) {
        throw signal.reason ?? authorityError('aborted', 'Cave HPKE response was aborted.');
      }
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw proofError();
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  return concatCaveHpkeBytes(...chunks);
}

export async function createCaveHpkeBoundRequest(input: {
  discovered: CaveDiscoveredEndpointV2;
  instanceId: string;
  url: string;
  method: string;
  body?: Uint8Array;
  authorization: CaveHpkeAuthorization;
  issuedAt?: number;
  requestNonce?: Uint8Array;
  requestEkm?: Uint8Array;
  responseRecipientIkm?: Uint8Array;
}): Promise<CaveHpkeBoundRequest> {
  try {
    validateAuthorization(input.authorization);
    if (
      input.discovered.authority.mechanism !== CAVE_HPKE_MECHANISM ||
      (input.discovered.authority.mode !== 'advertise' && input.discovered.authority.mode !== 'enforce') ||
      input.discovered.authority.suite.kemId !== 32 ||
      input.discovered.authority.suite.kdfId !== 1 ||
      input.discovered.authority.suite.aeadId !== 2
    ) {
      throw new Error('Cave HPKE discovery authority was not supported.');
    }

    const suite = createCaveHpkeSuite();
    const authorityPublicKeyBytes = caveBase64UrlDecode(
      input.discovered.authority.publicKey,
      { minimum: CAVE_HPKE_LIMITS.rawKeyBytes, maximum: CAVE_HPKE_LIMITS.rawKeyBytes },
    );
    const authorityKeyIdBytes = caveBase64UrlDecode(
      input.discovered.authority.keyId,
      { minimum: CAVE_HPKE_LIMITS.rawKeyBytes, maximum: CAVE_HPKE_LIMITS.rawKeyBytes },
    );
    if (!equalBytes(authorityKeyIdBytes, caveHpkeKeyId(authorityPublicKeyBytes))) {
      throw new Error('Cave HPKE authority key id was invalid.');
    }
    const runtimeNonceBytes = caveBase64UrlDecode(
      input.discovered.freshness.nonce,
      { minimum: CAVE_HPKE_LIMITS.rawKeyBytes, maximum: CAVE_HPKE_LIMITS.rawKeyBytes },
    );
    const requestNonceBytes = input.requestNonce?.slice()
      ?? new Uint8Array(randomBytes(CAVE_HPKE_LIMITS.rawKeyBytes));
    if (requestNonceBytes.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes) {
      throw new Error('Cave HPKE request nonce was invalid.');
    }
    const body = input.body?.slice() ?? new Uint8Array();
    if (body.byteLength > CAVE_HPKE_LIMITS.requestBodyBytes) {
      throw authorityError('body_limit', 'Cave HPKE request body exceeded its size limit.');
    }
    const responseRecipient = input.responseRecipientIkm === undefined
      ? await suite.kem.generateKeyPair()
      : await suite.kem.deriveKeyPair(input.responseRecipientIkm);
    const responsePublicKey = new Uint8Array(
      await suite.kem.serializePublicKey(responseRecipient.publicKey),
    );
    const method = input.method.toUpperCase();
    const url = new URL(input.url);
    const binding: CaveHpkeBinding = {
      method,
      route: canonicalCaveHpkeRoute(url),
      bodySha256: new Uint8Array(createHash('sha256').update(body).digest()),
      instanceId: input.instanceId,
      runtimeNonce: input.discovered.freshness.nonce,
      runtimeNonceBytes,
      keyId: input.discovered.authority.keyId,
      keyIdBytes: authorityKeyIdBytes,
      requestNonce: caveBase64UrlEncode(requestNonceBytes),
      requestNonceBytes,
      issuedAt: input.issuedAt ?? Date.now(),
    };
    const requestAad = encodeCaveHpkeAad('request', binding);
    const responseAad = encodeCaveHpkeAad('response', binding);
    const authorityPublicKey = await suite.kem.deserializePublicKey(authorityPublicKeyBytes);
    const requestSender = await suite.createSenderContext({
      recipientPublicKey: authorityPublicKey,
      info: CAVE_HPKE_REQUEST_INFO,
      ...(input.requestEkm === undefined
        ? {}
        : { ekm: await suite.kem.deriveKeyPair(input.requestEkm) }),
    });
    const plaintext = jcs({
      authorization: input.authorization,
      responsePublicKey: caveBase64UrlEncode(responsePublicKey),
      version: 1,
    });
    if (plaintext.byteLength > CAVE_HPKE_LIMITS.requestPlaintextBytes) {
      throw new Error('Cave HPKE request plaintext exceeded its size limit.');
    }
    const ciphertext = new Uint8Array(await requestSender.seal(plaintext, requestAad));
    if (ciphertext.byteLength > CAVE_HPKE_LIMITS.requestCiphertextBytes) {
      throw new Error('Cave HPKE request ciphertext exceeded its size limit.');
    }
    const headers = new Headers({
      [CAVE_HPKE_HEADERS.mechanism]: CAVE_HPKE_MECHANISM,
      [CAVE_HPKE_HEADERS.keyId]: binding.keyId,
      [CAVE_HPKE_HEADERS.instanceId]: caveBase64UrlEncode(UTF8.encode(binding.instanceId)),
      [CAVE_HPKE_HEADERS.runtimeNonce]: binding.runtimeNonce,
      [CAVE_HPKE_HEADERS.requestNonce]: binding.requestNonce,
      [CAVE_HPKE_HEADERS.issuedAt]: String(binding.issuedAt),
      [CAVE_HPKE_HEADERS.enc]: caveBase64UrlEncode(requestSender.enc),
      [CAVE_HPKE_HEADERS.ciphertext]: caveBase64UrlEncode(ciphertext),
    });

    return {
      headers,
      binding,
      requestAad,
      responseAad,
      async open(response, options) {
        try {
          if (
            response.status !== 200 ||
            response.headers.get('content-type') !== CAVE_HPKE_RESPONSE_MEDIA_TYPE
          ) {
            throw proofError();
          }
          if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes <= 0) {
            throw proofError();
          }
          const envelopeBytes = await readBounded(
            response,
            CAVE_HPKE_LIMITS.responseEnvelopeBytes,
            options.signal,
          );
          const envelope: unknown = JSON.parse(UTF8_FATAL.decode(envelopeBytes));
          if (
            !exactKeys(
              envelope,
              ['version', 'mechanism', 'keyId', 'requestNonce', 'enc', 'ciphertext'],
            ) ||
            envelope.version !== 1 ||
            envelope.mechanism !== CAVE_HPKE_MECHANISM ||
            envelope.keyId !== binding.keyId ||
            envelope.requestNonce !== binding.requestNonce ||
            typeof envelope.enc !== 'string' ||
            typeof envelope.ciphertext !== 'string'
          ) {
            throw proofError();
          }
          const enc = caveBase64UrlDecode(envelope.enc, {
            minimum: CAVE_HPKE_LIMITS.rawKeyBytes,
            maximum: CAVE_HPKE_LIMITS.rawKeyBytes,
          });
          const responseCiphertext = caveBase64UrlDecode(envelope.ciphertext, {
            minimum: 16,
            maximum: CAVE_HPKE_LIMITS.responseCiphertextBytes,
          });
          const recipient = await suite.createRecipientContext({
            recipientKey: responseRecipient.privateKey,
            senderPublicKey: authorityPublicKey,
            enc,
            info: CAVE_HPKE_RESPONSE_INFO,
          });
          const responsePlaintext = new Uint8Array(
            await recipient.open(responseCiphertext, responseAad),
          );
          if (responsePlaintext.byteLength > CAVE_HPKE_LIMITS.responsePlaintextBytes) {
            throw proofError();
          }
          const parsed: unknown = JSON.parse(UTF8_FATAL.decode(responsePlaintext));
          if (
            !exactKeys(parsed, ['version', 'requestNonce', 'status', 'headers', 'body']) ||
            parsed.version !== 1 ||
            parsed.requestNonce !== binding.requestNonce ||
            !Number.isInteger(parsed.status) ||
            (parsed.status as number) < 100 ||
            (parsed.status as number) > 599 ||
            typeof parsed.body !== 'string' ||
            typeof parsed.headers !== 'object' ||
            parsed.headers === null ||
            Array.isArray(parsed.headers)
          ) {
            throw proofError();
          }
          const responseHeaders = parsed.headers as Record<string, unknown>;
          const expectedHeaderKeys = Object.hasOwn(responseHeaders, 'retryAfter')
            ? ['contentType', 'retryAfter']
            : ['contentType'];
          if (
            !exactKeys(responseHeaders, expectedHeaderKeys) ||
            responseHeaders.contentType !== 'application/json' ||
            (Object.hasOwn(responseHeaders, 'retryAfter') &&
              (typeof responseHeaders.retryAfter !== 'string' ||
                responseHeaders.retryAfter.length > 256))
          ) {
            throw proofError();
          }
          const canonical = jcs(parsed);
          if (!equalBytes(responsePlaintext, canonical)) {
            throw proofError();
          }
          const responseBody = caveBase64UrlDecode(parsed.body, {
            minimum: 0,
            maximum: Math.min(options.maxBodyBytes, CAVE_HPKE_LIMITS.responsePlaintextBytes),
          });
          return {
            status: parsed.status as number,
            headers: {
              contentType: 'application/json',
              ...(Object.hasOwn(responseHeaders, 'retryAfter')
                ? { retryAfter: responseHeaders.retryAfter as string }
                : {}),
            },
            body: responseBody,
          };
        } catch (error) {
          if (
            typeof error === 'object' &&
            error !== null &&
            Reflect.get(error, 'code') === 'reconcile_required'
          ) {
            throw error;
          }
          throw proofError(error);
        }
      },
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      typeof Reflect.get(error, 'code') === 'string'
    ) {
      throw error;
    }
    throw authorityError(
      'invalid_response',
      'The discovered Cave HPKE authority could not be used safely.',
      { cause: error, retryable: false },
    );
  }
}
