import type { DiscoveryEndpoint } from '@opencoven/sdk-core';

export const CAVE_DISCOVERY_RECORD_VERSION = 1 as const;
export const CAVE_HPKE_DISCOVERY_RECORD_VERSION = 2 as const;
const DISCOVERY_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/u;
const CAVE_HTTP_ENDPOINT_RE =
  /^http:\/\/(\[[^\]]+\]|[^/?#:@\\]+):([0-9]{1,5})\/?$/iu;
const CAVE_DISCOVERY_ERROR_BRAND = Symbol.for('@opencoven/cave-client/CaveDiscoveryError');

export type CaveDiscoveryErrorCode =
  | 'not_found'
  | 'owner_mismatch'
  | 'unsafe_endpoint'
  | 'stale_record'
  | 'body_limit'
  | 'invalid_response'
  | 'timeout'
  | 'aborted';

export interface CaveHpkeDiscoveryAuthority {
  mechanism: 'hpke-bound-v1';
  mode: 'advertise' | 'enforce';
  keyId: string;
  publicKey: string;
  suite: {
    kemId: 32;
    kdfId: 1;
    aeadId: 2;
  };
}

export interface CaveParsedDiscoveryRecordV1 {
  version: typeof CAVE_DISCOVERY_RECORD_VERSION;
  endpoint: Extract<DiscoveryEndpoint, { kind: 'http' }>;
  freshness: {
    pid: number;
    nonce: string;
    startedAt: string;
  };
}

export interface CaveParsedDiscoveryRecordV2 {
  version: typeof CAVE_HPKE_DISCOVERY_RECORD_VERSION;
  endpoint: Extract<DiscoveryEndpoint, { kind: 'http' }>;
  freshness: {
    pid: number;
    nonce: string;
    startedAt: string;
  };
  authority: CaveHpkeDiscoveryAuthority;
}

export type CaveParsedDiscoveryRecord =
  | CaveParsedDiscoveryRecordV1
  | CaveParsedDiscoveryRecordV2;

export class CaveDiscoveryError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: CaveDiscoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaveDiscoveryError';
    this.retryable = code === 'not_found' || code === 'stale_record' || code === 'timeout';
    Object.defineProperty(this, CAVE_DISCOVERY_ERROR_BRAND, { value: true });
  }
}

export function isCaveDiscoveryError(error: unknown): error is CaveDiscoveryError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, CAVE_DISCOVERY_ERROR_BRAND);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.value === true;
  } catch {
    return false;
  }
}

function fail(code: CaveDiscoveryErrorCode, message: string): never {
  throw new CaveDiscoveryError(code, message);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F))
    ) {
      return true;
    }
  }
  return false;
}

function parseCaveHttpEndpoint(value: string): Extract<DiscoveryEndpoint, { kind: 'http' }> {
  const match = CAVE_HTTP_ENDPOINT_RE.exec(value);
  const rawHost = match?.[1]?.toLowerCase();
  const rawPort = match?.[2];
  if (
    containsControlCharacter(value) ||
    /%(?:2f|5c)/iu.test(value) ||
    (rawHost !== '127.0.0.1' && rawHost !== 'localhost' && rawHost !== '[::1]') ||
    rawPort === undefined
  ) {
    return fail('unsafe_endpoint', 'Cave discovery endpoint was not a path-free loopback URL.');
  }

  const port = Number(rawPort);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail('unsafe_endpoint', 'Cave discovery endpoint was invalid.');
  }

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    parsed.protocol !== 'http:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.hostname !== '127.0.0.1' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '[::1]')
  ) {
    return fail('unsafe_endpoint', 'Cave discovery endpoint was not a path-free loopback URL.');
  }

  return { kind: 'http', url: value };
}

function validTimestamp(value: string): boolean {
  const match = DISCOVERY_TIMESTAMP_RE.exec(value);
  if (match === null || containsControlCharacter(value)) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const parsed = Date.parse(value);

  return (
    Number.isFinite(parsed) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeCanonical32ByteBase64Url(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length !== 43 ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value)
  ) {
    return fail('invalid_response', 'Cave discovery authority encoding was invalid.');
  }

  let decoded: string;
  try {
    decoded = atob(
      `${value.replaceAll('-', '+').replaceAll('_', '/')}=`,
    );
  } catch {
    return fail('invalid_response', 'Cave discovery authority encoding was invalid.');
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32 || base64UrlEncode(bytes) !== value) {
    return fail('invalid_response', 'Cave discovery authority encoding was invalid.');
  }
  return bytes;
}

async function deriveKeyId(publicKey: Uint8Array): Promise<string> {
  const domain = new TextEncoder().encode(
    'OpenCoven/client-v1/hpke-bound-v1/key-id\0',
  );
  const input = new Uint8Array(domain.byteLength + publicKey.byteLength);
  input.set(domain);
  input.set(publicKey, domain.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return base64UrlEncode(new Uint8Array(digest));
}

async function parseAuthority(value: unknown): Promise<CaveHpkeDiscoveryAuthority> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return fail('invalid_response', 'Cave discovery authority was invalid.');
  }
  const authority = value as Record<string, unknown>;
  if (
    !exactKeys(
      authority,
      ['mechanism', 'mode', 'keyId', 'publicKey', 'suite'],
    ) ||
    authority.mechanism !== 'hpke-bound-v1' ||
    (authority.mode !== 'advertise' && authority.mode !== 'enforce') ||
    typeof authority.suite !== 'object' ||
    authority.suite === null ||
    Array.isArray(authority.suite)
  ) {
    return fail('invalid_response', 'Cave discovery authority was invalid.');
  }
  const suite = authority.suite as Record<string, unknown>;
  if (
    !exactKeys(suite, ['kemId', 'kdfId', 'aeadId']) ||
    suite.kemId !== 32 ||
    suite.kdfId !== 1 ||
    suite.aeadId !== 2
  ) {
    return fail('invalid_response', 'Cave discovery authority suite was invalid.');
  }
  const keyIdBytes = decodeCanonical32ByteBase64Url(authority.keyId);
  const publicKeyBytes = decodeCanonical32ByteBase64Url(authority.publicKey);
  const derivedKeyId = await deriveKeyId(publicKeyBytes);
  if (base64UrlEncode(keyIdBytes) !== derivedKeyId) {
    return fail('invalid_response', 'Cave discovery authority key identity was invalid.');
  }

  return Object.freeze({
    mechanism: 'hpke-bound-v1',
    mode: authority.mode,
    keyId: authority.keyId as string,
    publicKey: authority.publicKey as string,
    suite: Object.freeze({
      kemId: 32,
      kdfId: 1,
      aeadId: 2,
    }),
  });
}

export async function parseCaveDiscoveryRecord(
  serialized: string,
  isProcessAlive: (pid: number) => boolean,
): Promise<CaveParsedDiscoveryRecord> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return fail('invalid_response', 'Cave discovery record was not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('invalid_response', 'Cave discovery record must be an object.');
  }

  const record = parsed as Record<string, unknown>;
  const version = record.version;
  const expectedFields =
    version === CAVE_DISCOVERY_RECORD_VERSION
      ? ['version', 'endpoint', 'pid', 'nonce', 'startedAt']
      : version === CAVE_HPKE_DISCOVERY_RECORD_VERSION
        ? ['version', 'endpoint', 'pid', 'nonce', 'startedAt', 'authority']
        : undefined;
  if (expectedFields === undefined || !exactKeys(record, expectedFields)) {
    return fail('invalid_response', 'Cave discovery record version was not supported.');
  }
  if (typeof record.endpoint !== 'string') {
    return fail('invalid_response', 'Cave discovery endpoint was invalid.');
  }
  const endpoint = parseCaveHttpEndpoint(record.endpoint);
  if (
    typeof record.pid !== 'number' ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0
  ) {
    return fail('invalid_response', 'Cave discovery pid must be a positive safe integer.');
  }
  if (!isProcessAlive(record.pid)) {
    return fail('stale_record', 'Cave discovery pid did not identify a live process.');
  }
  if (version === CAVE_HPKE_DISCOVERY_RECORD_VERSION) {
    decodeCanonical32ByteBase64Url(record.nonce);
  } else if (
    typeof record.nonce !== 'string' ||
    record.nonce.trim().length === 0 ||
    record.nonce.length > 256 ||
    containsControlCharacter(record.nonce)
  ) {
    return fail('invalid_response', 'Cave discovery nonce was invalid.');
  }
  if (typeof record.startedAt !== 'string' || !validTimestamp(record.startedAt)) {
    return fail('invalid_response', 'Cave discovery startedAt was invalid.');
  }

  const freshness = Object.freeze({
      pid: record.pid,
      nonce: record.nonce as string,
      startedAt: record.startedAt,
  });
  if (version === CAVE_HPKE_DISCOVERY_RECORD_VERSION) {
    return Object.freeze({
      version: CAVE_HPKE_DISCOVERY_RECORD_VERSION,
      endpoint: Object.freeze(endpoint),
      freshness,
      authority: await parseAuthority(record.authority),
    });
  }
  return Object.freeze({
    version: CAVE_DISCOVERY_RECORD_VERSION,
    endpoint: Object.freeze(endpoint),
    freshness,
  });
}
