import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { CaveHpkeDiscoveryAuthority } from './discovery-record.js';

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
const KEY_ID_DOMAIN = 'OpenCoven/client-v1/hpke-bound-v1/key-id\0';
const RESPONSE_ERROR =
  'Cave HPKE transport authentication failed.';

function failResponse(): never {
  throw new Error(RESPONSE_ERROR);
}
type Canonicalize = (value: unknown) => string | undefined;
export type CaveHpkeRuntimeKey = object;
export interface CaveHpkeRuntimeKeyPair {
  privateKey: CaveHpkeRuntimeKey;
  publicKey: CaveHpkeRuntimeKey;
}
export interface CaveHpkeRuntimeSender {
  enc: Uint8Array;
  seal(plaintext: Uint8Array, aad: Uint8Array): Promise<ArrayBufferLike>;
}
export interface CaveHpkeRuntimeRecipient {
  open(ciphertext: Uint8Array, aad: Uint8Array): Promise<ArrayBufferLike>;
}
export interface CaveHpkeRuntimeSuite {
  kem: {
    generateKeyPair(): Promise<CaveHpkeRuntimeKeyPair>;
    deriveKeyPair(ikm: Uint8Array): Promise<CaveHpkeRuntimeKeyPair>;
    serializePublicKey(key: CaveHpkeRuntimeKey): Promise<ArrayBufferLike>;
    deserializePublicKey(bytes: Uint8Array): Promise<CaveHpkeRuntimeKey>;
  };
  createSenderContext(options: {
    recipientPublicKey: CaveHpkeRuntimeKey;
    senderKey?: CaveHpkeRuntimeKey;
    info: Uint8Array;
    ekm?: Uint8Array;
  }): Promise<CaveHpkeRuntimeSender>;
  createRecipientContext(options: {
    recipientKey: CaveHpkeRuntimeKey;
    senderPublicKey?: CaveHpkeRuntimeKey;
    enc: Uint8Array;
    info: Uint8Array;
  }): Promise<CaveHpkeRuntimeRecipient>;
}

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

export const CAVE_HPKE_RESPONSE_MEDIA_TYPE =
  'application/vnd.opencoven.client-v1.hpke-bound-v1+json';

export const CAVE_HPKE_LIMITS = Object.freeze({
  rawKeyBytes: 32,
  encodedKeyCharacters: 43,
  requestPlaintextBytes: 1_024,
  requestCiphertextBytes: 2_048,
  requestBodyBytes: 65_536,
  responsePlaintextBytes: 8_388_608,
  responseCiphertextBytes: 8_388_624,
  responseEnvelopeBytes: 11_185_056,
  canonicalRouteBytes: 2_048,
  instanceIdBytes: 256,
} as const);

export type CaveHpkeProtectedOperation =
  | 'pairing.poll'
  | 'pairing.exchange'
  | 'familiars.list'
  | 'projects.list'
  | 'conversations.list'
  | 'conversations.read'
  | 'messages.list';

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

interface CaveHpkeDeterministicInputs {
  requestNonce: Uint8Array;
  requestEkm: Uint8Array;
  responseRecipientIkm: Uint8Array;
}

export interface CaveHpkeBoundRequest {
  request: Request;
  binding: CaveHpkeBinding;
  requestAad: Uint8Array;
  responseAad: Uint8Array;
  responsePublicKey: Uint8Array;
  open(
    response: Response,
    options?: {
      context?: {
        signal: AbortSignal;
        deadline: number | undefined;
      };
      maxResponseBytes?: number;
    },
  ): Promise<CaveHpkeOpenedResponse>;
}

export class CaveHpkeResponseBodyLimitError extends Error {
  constructor(readonly statusCode: number) {
    super('Cave authenticated response exceeded its size limit.');
    this.name = 'CaveHpkeResponseBodyLimitError';
  }
}

function bytesOf(value: ArrayBufferLike | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

export function caveHpkeBase64UrlEncode(
  value: ArrayBufferLike | ArrayBufferView,
): string {
  return Buffer.from(bytesOf(value)).toString('base64url');
}

export function caveHpkeBase64UrlDecode(
  value: unknown,
  bounds: { minimum: number; maximum: number },
): Uint8Array {
  if (
    !Number.isSafeInteger(bounds.minimum) ||
    !Number.isSafeInteger(bounds.maximum) ||
    bounds.minimum < 0 ||
    bounds.maximum < bounds.minimum
  ) {
    throw new Error(RESPONSE_ERROR);
  }
  if (
    typeof value !== 'string' ||
    value.includes('=') ||
    !BASE64URL_RE.test(value) ||
    value.length > Math.ceil((bounds.maximum * 4) / 3)
  ) {
    throw new Error(RESPONSE_ERROR);
  }
  const bytes = Uint8Array.from(Buffer.from(value, 'base64url'));
  if (
    bytes.byteLength < bounds.minimum ||
    bytes.byteLength > bounds.maximum ||
    caveHpkeBase64UrlEncode(bytes) !== value
  ) {
    throw new Error(RESPONSE_ERROR);
  }
  return bytes;
}

function uint32be(value: number): Uint8Array {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffff_ffff
  ) {
    throw new Error(RESPONSE_ERROR);
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(RESPONSE_ERROR);
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function concatBytes(...values: readonly Uint8Array[]): Uint8Array {
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
  return concatBytes(uint32be(value.byteLength), value);
}

function rfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidPath(): Error {
  return new Error(RESPONSE_ERROR);
}

function canonicalCaveHpkePathname(pathname: string): string {
  if (!pathname.startsWith('/') || pathname.includes('\\')) {
    throw invalidPath();
  }
  if (pathname === '/') {
    return pathname;
  }

  const segments = pathname.slice(1).split('/');
  if (segments.some((segment) => segment.length === 0)) {
    throw invalidPath();
  }

  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidPath();
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      /%[0-9A-Fa-f]{2}/u.test(decoded) ||
      decoded.includes('\\') ||
      encodeURIComponent(decoded) !== segment
    ) {
      throw invalidPath();
    }
  }
  return pathname;
}

export function canonicalCaveHpkeRoute(url: URL): string {
  const pathname = canonicalCaveHpkePathname(url.pathname);
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
    const route = query ? `${pathname}?${query}` : pathname;
  if (UTF8.encode(route).byteLength > CAVE_HPKE_LIMITS.canonicalRouteBytes) {
    throw new Error(RESPONSE_ERROR);
  }
  return route;
}

function requireBinding(binding: CaveHpkeBinding): void {
  const instanceIdBytes = UTF8.encode(binding.instanceId);
  if (
    !METHOD_RE.test(binding.method) ||
    !binding.route.startsWith('/') ||
    UTF8.encode(binding.route).byteLength >
      CAVE_HPKE_LIMITS.canonicalRouteBytes ||
    binding.bodySha256.byteLength !== 32 ||
    instanceIdBytes.byteLength < 1 ||
    instanceIdBytes.byteLength > CAVE_HPKE_LIMITS.instanceIdBytes ||
    binding.runtimeNonceBytes.byteLength !== 32 ||
    binding.keyIdBytes.byteLength !== 32 ||
    binding.requestNonceBytes.byteLength !== 32 ||
    binding.runtimeNonce !== caveHpkeBase64UrlEncode(binding.runtimeNonceBytes) ||
    binding.keyId !== caveHpkeBase64UrlEncode(binding.keyIdBytes) ||
    binding.requestNonce !== caveHpkeBase64UrlEncode(binding.requestNonceBytes) ||
    !Number.isSafeInteger(binding.issuedAt) ||
    binding.issuedAt < 1
  ) {
    throw new Error(RESPONSE_ERROR);
  }
}

export function encodeCaveHpkeAad(
  domain: 'request' | 'response',
  binding: CaveHpkeBinding,
): Uint8Array {
  requireBinding(binding);
  return concatBytes(
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

async function loadCaveHpkeRuntime(): Promise<{
  suite: CaveHpkeRuntimeSuite;
  canonicalize: Canonicalize;
}> {
  const [core, x25519, canonicalizeModule] = await Promise.all([
    import('@hpke/core'),
    import('@hpke/dhkem-x25519'),
    import('canonicalize'),
  ]);
  return {
    suite: new core.CipherSuite({
      kem: new x25519.DhkemX25519HkdfSha256(),
      kdf: new core.HkdfSha256(),
      aead: new core.Aes256Gcm(),
    }) as unknown as CaveHpkeRuntimeSuite,
    canonicalize: canonicalizeModule.default,
  };
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort(asciiCompare);
  const required = [...expected].sort(asciiCompare);
  return (
    actual.length === required.length &&
    actual.every((key, index) => key === required[index])
  );
}

function jcs(value: unknown, canonicalize: Canonicalize): Uint8Array {
  const rendered = canonicalize(value);
  if (typeof rendered !== 'string') {
    throw new Error(RESPONSE_ERROR);
  }
  const bytes = UTF8.encode(rendered);
  if (bytes.byteLength > CAVE_HPKE_LIMITS.requestPlaintextBytes) {
    throw new Error(RESPONSE_ERROR);
  }
  return bytes;
}

function requireAuthority(authority: CaveHpkeDiscoveryAuthority): void {
  if (
    authority.mechanism !== 'hpke-bound-v1' ||
    (authority.mode !== 'advertise' && authority.mode !== 'enforce') ||
    authority.suite.kemId !== 32 ||
    authority.suite.kdfId !== 1 ||
    authority.suite.aeadId !== 2
  ) {
    throw new Error(RESPONSE_ERROR);
  }
}

function requireOperation(
  operation: CaveHpkeProtectedOperation,
  authorization: CaveHpkeAuthorization,
): void {
  const expected =
    operation === 'pairing.poll' || operation === 'pairing.exchange'
      ? 'pairing-secret'
      : 'bearer';
  if (authorization.kind !== expected) {
    throw new Error(RESPONSE_ERROR);
  }
  if (authorization.kind === 'pairing-secret') {
    caveHpkeBase64UrlDecode(authorization.value, {
      minimum: 32,
      maximum: 32,
    });
  } else if (
    authorization.value.length < 1 ||
    authorization.value.length > 512 ||
    !/^[\x21-\x7e]+$/u.test(authorization.value)
  ) {
    throw new Error(RESPONSE_ERROR);
  }
}

function keyIdForPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes) {
    throw new Error(RESPONSE_ERROR);
  }
  return new Uint8Array(
    createHash('sha256')
      .update(KEY_ID_DOMAIN, 'utf8')
      .update(publicKey)
      .digest(),
  );
}

async function readBounded(
  response: Response,
  maximumBytes: number,
  context?: {
    signal: AbortSignal;
    deadline: number | undefined;
  },
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
      throw new Error(RESPONSE_ERROR);
    }
  }
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let length = 0;
  let cancellationStarted = false;
  const cancelReader = (reason?: unknown): void => {
    if (cancellationStarted) {
      return;
    }
    cancellationStarted = true;
    try {
      void reader.cancel(reason).catch(() => undefined);
    } catch {
      // Cancellation is best-effort; the operation error must still settle.
    }
  };
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => undefined);
  const onAbort = (): void => {
    const reason: unknown = context?.signal.reason;
    rejectAbort?.(
      reason instanceof Error ? reason : new Error(RESPONSE_ERROR),
    );
    cancelReader(reason);
  };
  context?.signal.addEventListener('abort', onAbort, { once: true });
  if (context?.signal.aborted === true) {
    onAbort();
  }
  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        aborted,
      ]);
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > maximumBytes) {
        cancelReader();
        throw new Error(RESPONSE_ERROR);
      }
      chunks.push(value);
    }
  } finally {
    context?.signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  return concatBytes(...chunks);
}

export async function createCaveHpkeBoundRequest(input: {
  authority: CaveHpkeDiscoveryAuthority;
  instanceId: string;
  runtimeNonce: string;
  operation: CaveHpkeProtectedOperation;
  url: string;
  method: string;
  body?: Uint8Array;
  issuedAt?: number;
  authorization: CaveHpkeAuthorization;
  deterministic?: CaveHpkeDeterministicInputs;
}): Promise<CaveHpkeBoundRequest> {
  try {
    requireAuthority(input.authority);
    requireOperation(input.operation, input.authorization);
    const { suite, canonicalize } = await loadCaveHpkeRuntime();
    const authorityPublicKeyBytes = caveHpkeBase64UrlDecode(
      input.authority.publicKey,
      {
        minimum: CAVE_HPKE_LIMITS.rawKeyBytes,
        maximum: CAVE_HPKE_LIMITS.rawKeyBytes,
      },
    );
    const authorityKeyIdBytes = caveHpkeBase64UrlDecode(
      input.authority.keyId,
      {
        minimum: CAVE_HPKE_LIMITS.rawKeyBytes,
        maximum: CAVE_HPKE_LIMITS.rawKeyBytes,
      },
    );
    if (
      !timingSafeEqual(
        authorityKeyIdBytes,
        keyIdForPublicKey(authorityPublicKeyBytes),
      )
    ) {
      throw new Error(RESPONSE_ERROR);
    }
    const runtimeNonceBytes = caveHpkeBase64UrlDecode(input.runtimeNonce, {
      minimum: CAVE_HPKE_LIMITS.rawKeyBytes,
      maximum: CAVE_HPKE_LIMITS.rawKeyBytes,
    });
    const requestNonceBytes =
      input.deterministic?.requestNonce.slice() ??
      new Uint8Array(randomBytes(CAVE_HPKE_LIMITS.rawKeyBytes));
    if (requestNonceBytes.byteLength !== CAVE_HPKE_LIMITS.rawKeyBytes) {
      throw new Error(RESPONSE_ERROR);
    }
    const body = input.body?.slice() ?? new Uint8Array();
    if (body.byteLength > CAVE_HPKE_LIMITS.requestBodyBytes) {
      throw new Error(RESPONSE_ERROR);
    }
    const responseRecipient =
      input.deterministic === undefined
        ? await suite.kem.generateKeyPair()
        : await suite.kem.deriveKeyPair(
            input.deterministic.responseRecipientIkm,
          );
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
      runtimeNonce: input.runtimeNonce,
      runtimeNonceBytes,
      keyId: input.authority.keyId,
      keyIdBytes: authorityKeyIdBytes,
      requestNonce: caveHpkeBase64UrlEncode(requestNonceBytes),
      requestNonceBytes,
      issuedAt: input.issuedAt ?? Date.now(),
    };
    const requestAad = encodeCaveHpkeAad('request', binding);
    const responseAad = encodeCaveHpkeAad('response', binding);
    const authorityPublicKey = await suite.kem.deserializePublicKey(
      authorityPublicKeyBytes,
    );
    const requestSender = await suite.createSenderContext({
      recipientPublicKey: authorityPublicKey,
      info: CAVE_HPKE_REQUEST_INFO,
      ...(input.deterministic === undefined
        ? {}
        : { ekm: input.deterministic.requestEkm }),
    });
    const ciphertext = new Uint8Array(
      await requestSender.seal(
        jcs(
          {
            authorization: input.authorization,
            responsePublicKey: caveHpkeBase64UrlEncode(responsePublicKey),
            version: 1,
          },
          canonicalize,
        ),
        requestAad,
      ),
    );
    if (ciphertext.byteLength > CAVE_HPKE_LIMITS.requestCiphertextBytes) {
      throw new Error(RESPONSE_ERROR);
    }
    const headers = new Headers({
      [CAVE_HPKE_HEADERS.mechanism]: 'hpke-bound-v1',
      [CAVE_HPKE_HEADERS.keyId]: binding.keyId,
      [CAVE_HPKE_HEADERS.instanceId]: caveHpkeBase64UrlEncode(
        UTF8.encode(binding.instanceId),
      ),
      [CAVE_HPKE_HEADERS.runtimeNonce]: binding.runtimeNonce,
      [CAVE_HPKE_HEADERS.requestNonce]: binding.requestNonce,
      [CAVE_HPKE_HEADERS.issuedAt]: String(binding.issuedAt),
      [CAVE_HPKE_HEADERS.enc]: caveHpkeBase64UrlEncode(requestSender.enc),
      [CAVE_HPKE_HEADERS.ciphertext]:
        caveHpkeBase64UrlEncode(ciphertext),
    });
    const request = new Request(url, {
      method,
      headers,
      ...(
        body.byteLength > 0 && method !== 'GET' && method !== 'HEAD'
          ? { body }
          : {}
      ),
    });

    return {
      request,
      binding,
      requestAad,
      responseAad,
      responsePublicKey,
      async open(response, options = {}) {
        try {
          if (
            response.status !== 200 ||
            response.headers.get('content-type') !==
              CAVE_HPKE_RESPONSE_MEDIA_TYPE
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          const envelopeBytes = await readBounded(
            response,
            CAVE_HPKE_LIMITS.responseEnvelopeBytes,
            options.context,
          );
          const envelope: unknown = JSON.parse(
            UTF8_FATAL.decode(envelopeBytes),
          );
          if (
            !exactKeys(
              envelope,
              [
                'version',
                'mechanism',
                'keyId',
                'requestNonce',
                'enc',
                'ciphertext',
              ],
            ) ||
            envelope.version !== 1 ||
            envelope.mechanism !== 'hpke-bound-v1' ||
            envelope.keyId !== binding.keyId ||
            envelope.requestNonce !== binding.requestNonce ||
            typeof envelope.enc !== 'string' ||
            typeof envelope.ciphertext !== 'string'
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          const enc = caveHpkeBase64UrlDecode(envelope.enc, {
            minimum: CAVE_HPKE_LIMITS.rawKeyBytes,
            maximum: CAVE_HPKE_LIMITS.rawKeyBytes,
          });
          const responseCiphertext = caveHpkeBase64UrlDecode(
            envelope.ciphertext,
            {
              minimum: 16,
              maximum: CAVE_HPKE_LIMITS.responseCiphertextBytes,
            },
          );
          const recipient = await suite.createRecipientContext({
            recipientKey: responseRecipient.privateKey,
            senderPublicKey: authorityPublicKey,
            enc,
            info: CAVE_HPKE_RESPONSE_INFO,
          });
          const plaintext = new Uint8Array(
            await recipient.open(responseCiphertext, responseAad),
          );
          if (
            plaintext.byteLength >
            CAVE_HPKE_LIMITS.responsePlaintextBytes
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          const parsed: unknown = JSON.parse(UTF8_FATAL.decode(plaintext));
          if (
            !exactKeys(
              parsed,
              ['version', 'requestNonce', 'status', 'headers', 'body'],
            ) ||
            parsed.version !== 1 ||
            parsed.requestNonce !== binding.requestNonce ||
            !Number.isInteger(parsed.status) ||
            (parsed.status as number) < 100 ||
            (parsed.status as number) > 599 ||
            typeof parsed.body !== 'string' ||
            !exactKeys(
              parsed.headers,
              ['contentType', 'retryAfter'].filter(
                (key) =>
                  key !== 'retryAfter' ||
                  Object.hasOwn(parsed.headers as object, 'retryAfter'),
              ),
            ) ||
            parsed.headers.contentType !== 'application/json' ||
            (
              Object.hasOwn(parsed.headers, 'retryAfter') &&
              (
                typeof parsed.headers.retryAfter !== 'string' ||
                parsed.headers.retryAfter.length > 256
              )
            )
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          const canonical = canonicalize(parsed);
          if (
            typeof canonical !== 'string' ||
            !timingSafeEqual(
              Buffer.from(plaintext),
              Buffer.from(UTF8.encode(canonical)),
            )
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          const body = caveHpkeBase64UrlDecode(parsed.body, {
            minimum: 0,
            maximum: CAVE_HPKE_LIMITS.responsePlaintextBytes,
          });
          if (
            options.maxResponseBytes !== undefined &&
            body.byteLength > options.maxResponseBytes
          ) {
            throw new CaveHpkeResponseBodyLimitError(
              parsed.status as number,
            );
          }
          return {
            status: parsed.status as number,
            headers: {
              contentType: 'application/json',
              ...(Object.hasOwn(parsed.headers, 'retryAfter')
                ? { retryAfter: parsed.headers.retryAfter as string }
                : {}),
            },
            body,
          };
        } catch (error) {
          if (error instanceof CaveHpkeResponseBodyLimitError) {
            throw error;
          }
          if (
            options.context?.signal.aborted === true &&
            error === options.context.signal.reason
          ) {
            throw error;
          }
          return failResponse();
        }
      },
    };
  } catch {
    throw new Error(RESPONSE_ERROR);
  }
}
