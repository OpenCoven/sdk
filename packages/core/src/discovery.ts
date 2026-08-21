import { posix } from 'node:path';

export const DISCOVERY_RECORD_VERSION = 1 as const;
export const DISCOVERY_PROTOCOL = 'opencoven.discovery.v1' as const;
export const DISCOVERY_PROFILES = ['cave', 'coven'] as const;

export type DiscoveryProfile = (typeof DISCOVERY_PROFILES)[number];

export type DiscoveryEndpoint =
  | { kind: 'http'; url: string }
  | { kind: 'unix'; path: string }
  | { kind: 'windowsNamedPipe'; path: string };

export interface DiscoveryRecord {
  version: typeof DISCOVERY_RECORD_VERSION;
  protocol: typeof DISCOVERY_PROTOCOL;
  profile: DiscoveryProfile;
  endpoint: DiscoveryEndpoint;
}

export type DiscoveryDiagnosticCode =
  | 'invalid_discovery_value'
  | 'unexpected_discovery_field'
  | 'unsupported_discovery_endpoint_kind'
  | 'invalid_discovery_endpoint'
  | 'unsupported_discovery_version'
  | 'unsupported_discovery_protocol'
  | 'unsupported_discovery_profile';

export class DiscoveryContractError extends TypeError {
  readonly retryable = false;

  constructor(
    readonly code: DiscoveryDiagnosticCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiscoveryContractError';
  }
}

type JsonObject = Record<string, unknown>;

const WINDOWS_NAMED_PIPE_PREFIX = '\\\\.\\pipe\\';
const WINDOWS_NAMED_PIPE_MAX_LENGTH = 256;
const ENCODED_SEPARATOR_PATTERN = /%(?:2f|5c)/iu;
const HTTP_ENDPOINT_PATTERN =
  /^http:\/\/(\[[^\]]+\]|[^/?#:@\\]+):([0-9]{1,5})\/?$/iu;

function invalidValue(message: string): never {
  throw new DiscoveryContractError('invalid_discovery_value', message);
}

function invalidEndpoint(message: string): never {
  throw new DiscoveryContractError('invalid_discovery_endpoint', message);
}

function expectObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidValue(`${path} must be a plain object.`);
  }

  let prototype: object | null;

  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    return invalidValue(`${path} must be a plain object.`);
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return invalidValue(`${path} must be a plain object.`);
  }

  return value as JsonObject;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    return invalidValue(`${path} must be a string.`);
  }

  return value;
}

function getField(object: JsonObject, key: string, path: string): unknown {
  let descriptor: PropertyDescriptor | undefined;

  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    return invalidValue(`${path}.${key} could not be inspected.`);
  }

  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    return invalidValue(`${path}.${key} must be a JSON-safe data field.`);
  }

  return descriptor.value;
}

function expectOnlyFields(
  object: JsonObject,
  allowedFields: readonly string[],
  path: string,
): void {
  let fields: (string | symbol)[];

  try {
    fields = Reflect.ownKeys(object);
  } catch {
    return invalidValue(`${path} fields could not be read.`);
  }

  const allowed = new Set(allowedFields);

  for (const field of fields) {
    if (typeof field !== 'string') {
      return invalidValue(`${path} must contain JSON-safe fields only.`);
    }

    if (!allowed.has(field)) {
      throw new DiscoveryContractError(
        'unexpected_discovery_field',
        `${path}.${field} is not supported.`,
      );
    }

    let descriptor: PropertyDescriptor | undefined;

    try {
      descriptor = Object.getOwnPropertyDescriptor(object, field);
    } catch {
      return invalidValue(`${path}.${field} could not be inspected.`);
    }

    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return invalidValue(`${path}.${field} must be a JSON-safe data field.`);
    }
  }
}

function isIpv4Loopback(host: string): boolean {
  const segments = host.split('.');

  return (
    segments.length === 4 &&
    segments[0] === '127' &&
    segments.every(
      (segment) =>
        /^(?:0|[1-9][0-9]{0,2})$/u.test(segment) && Number(segment) <= 255,
    )
  );
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint !== undefined &&
      (codePoint <= 0x1F || codePoint === 0x7F)
    ) {
      return true;
    }
  }

  return false;
}

function parseHttpEndpoint(value: JsonObject): DiscoveryEndpoint {
  expectOnlyFields(value, ['kind', 'url'], 'endpoint');
  const url = expectString(getField(value, 'url', 'endpoint'), 'endpoint.url');
  const match = HTTP_ENDPOINT_PATTERN.exec(url);

  if (
    containsAsciiControl(url) ||
    match === null ||
    ENCODED_SEPARATOR_PATTERN.test(url)
  ) {
    return invalidEndpoint('endpoint.url must be a plain loopback HTTP URL with an explicit port.');
  }

  const rawHost = match[1];
  const rawPort = match[2];

  if (rawHost === undefined || rawPort === undefined) {
    return invalidEndpoint('endpoint.url must be a plain loopback HTTP URL with an explicit port.');
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return invalidEndpoint('endpoint.url must use a port from 1 through 65535.');
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return invalidEndpoint('endpoint.url must be a valid HTTP URL.');
  }

  const isIpv6Loopback = rawHost.startsWith('[') && parsed.hostname === '[::1]';

  if (
    parsed.protocol !== 'http:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (!isIpv4Loopback(rawHost) && !isIpv6Loopback)
  ) {
    return invalidEndpoint('endpoint.url must target an IP loopback address only.');
  }

  return { kind: 'http', url };
}

function parseUnixEndpoint(value: JsonObject): DiscoveryEndpoint {
  expectOnlyFields(value, ['kind', 'path'], 'endpoint');
  const path = expectString(getField(value, 'path', 'endpoint'), 'endpoint.path');

  if (
    path.includes('\0') ||
    path === '/' ||
    path.endsWith('/') ||
    !posix.isAbsolute(path) ||
    posix.normalize(path) !== path
  ) {
    return invalidEndpoint(
      'endpoint.path must be a normalized absolute Unix socket path.',
    );
  }

  return { kind: 'unix', path };
}

function parseWindowsNamedPipeEndpoint(value: JsonObject): DiscoveryEndpoint {
  expectOnlyFields(value, ['kind', 'path'], 'endpoint');
  const path = expectString(getField(value, 'path', 'endpoint'), 'endpoint.path');
  const pipeName = path.startsWith(WINDOWS_NAMED_PIPE_PREFIX)
    ? path.slice(WINDOWS_NAMED_PIPE_PREFIX.length)
    : '';

  if (
    path.includes('\0') ||
    path.length > WINDOWS_NAMED_PIPE_MAX_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(pipeName)
  ) {
    return invalidEndpoint(
      'endpoint.path must be a canonical local Windows named pipe.',
    );
  }

  return { kind: 'windowsNamedPipe', path };
}

export function parseDiscoveryEndpoint(value: unknown): DiscoveryEndpoint {
  const endpoint = expectObject(value, 'endpoint');
  const kind = expectString(getField(endpoint, 'kind', 'endpoint'), 'endpoint.kind');

  if (kind === 'http') {
    return parseHttpEndpoint(endpoint);
  }

  if (kind === 'unix') {
    return parseUnixEndpoint(endpoint);
  }

  if (kind === 'windowsNamedPipe') {
    return parseWindowsNamedPipeEndpoint(endpoint);
  }

  throw new DiscoveryContractError(
    'unsupported_discovery_endpoint_kind',
    'endpoint.kind is not supported.',
  );
}

export function parseDiscoveryRecord(value: unknown): DiscoveryRecord {
  const record = expectObject(value, 'record');
  expectOnlyFields(
    record,
    ['version', 'protocol', 'profile', 'endpoint'],
    'record',
  );

  const version = getField(record, 'version', 'record');

  if (version !== DISCOVERY_RECORD_VERSION) {
    throw new DiscoveryContractError(
      'unsupported_discovery_version',
      'record.version is not supported.',
    );
  }

  const protocol = getField(record, 'protocol', 'record');

  if (protocol !== DISCOVERY_PROTOCOL) {
    throw new DiscoveryContractError(
      'unsupported_discovery_protocol',
      'record.protocol is not supported.',
    );
  }

  const profile = getField(record, 'profile', 'record');

  if (profile !== 'cave' && profile !== 'coven') {
    throw new DiscoveryContractError(
      'unsupported_discovery_profile',
      'record.profile is not supported.',
    );
  }

  return {
    version,
    protocol,
    profile,
    endpoint: parseDiscoveryEndpoint(getField(record, 'endpoint', 'record')),
  };
}
