import { execFile as nodeExecFile } from 'node:child_process';
import { constants as fsConstants, type Stats } from 'node:fs';
import {
  lstat as nodeLstat,
  open as nodeOpen,
  realpath as nodeRealpath,
} from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import {
  DiscoveryContractError,
  parseDiscoveryEndpoint,
  type DiscoveryEndpoint,
} from '@opencoven/sdk-core';

import { COVEN_DAEMON_PROTOCOL } from './schemas.js';

const CONFIG_PATHS_SCHEMA = 'coven.config.paths';
const CONFIG_PATHS_VERSION = 1;
const DISCOVERED_ENDPOINT_VERSION = 1;
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_DAEMON_STATUS_BYTES = 16 * 1024;
const COVEN_COMMAND_ARGS = ['config', 'paths', '--json'] as const;
const SAFE_ENVIRONMENT_KEYS = [
  'ComSpec',
  'COVEN_HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'XDG_CONFIG_HOME',
] as const;

export type CovenIpcErrorCode =
  | 'not_found'
  | 'command_failed'
  | 'malformed_config'
  | 'unsafe_endpoint'
  | 'owner_mismatch'
  | 'connect_failure'
  | 'timeout'
  | 'body_limit'
  | 'frame_limit'
  | 'invalid_response';

export interface CovenIpcDiagnostics {
  phase:
    | 'config_command'
    | 'parse_config'
    | 'read_metadata'
    | 'validate_endpoint'
    | 'connect'
    | 'revalidate_endpoint'
    | 'write_request'
    | 'read_response';
  exitCode?: number;
  signal?: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  limitBytes?: number;
}

const COVEN_IPC_ERROR_BRAND = Symbol.for(
  '@opencoven/coven-client/CovenIpcError',
);

function ipcRetryable(code: CovenIpcErrorCode): boolean {
  return (
    code === 'not_found' ||
    code === 'command_failed' ||
    code === 'connect_failure' ||
    code === 'timeout'
  );
}

export class CovenIpcError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: CovenIpcErrorCode,
    message: string,
    readonly diagnostics: CovenIpcDiagnostics,
  ) {
    super(message);
    this.name = 'CovenIpcError';
    this.retryable = ipcRetryable(code);
    Object.defineProperty(this, COVEN_IPC_ERROR_BRAND, { value: true });
  }
}

export function isCovenIpcError(error: unknown): error is CovenIpcError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      error,
      COVEN_IPC_ERROR_BRAND,
    );
    return descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === true;
  } catch {
    return false;
  }
}

export interface CovenExecFileOptions {
  cwd: string;
  encoding: 'utf8';
  env: NodeJS.ProcessEnv;
  killSignal: 'SIGKILL';
  maxBuffer: number;
  shell: false;
  timeout: number;
  windowsHide: true;
}

export interface CovenExecFileError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string;
}

interface CovenExecFileChild {
  kill(signal: 'SIGKILL'): boolean;
}

export type CovenExecFile = (
  file: string,
  args: readonly string[],
  options: CovenExecFileOptions,
  callback: (
    error: CovenExecFileError | null,
    stdout: string,
    stderr: string,
  ) => void,
) => CovenExecFileChild | void;

export interface CovenDiscoveryFileIdentity {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  regularFile: boolean;
  size: number;
  symbolicLink: boolean;
}

export interface CovenMetadataFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
  stat(): Promise<CovenDiscoveryFileIdentity>;
}

export type CovenExecutableResolver = () => string | Promise<string>;

export interface CovenWindowsFileTrustValidator {
  validate(
    path: string,
    purpose: 'executable' | 'metadata',
  ): Promise<boolean>;
}

export interface CovenDiscoveryDependencies {
  execFile?: CovenExecFile;
  getEffectiveUid?: () => number | undefined;
  lstat?: (path: string) => Promise<CovenDiscoveryFileIdentity>;
  openFile?: (
    path: string,
    flags: number,
  ) => Promise<CovenMetadataFileHandle>;
  realpath?: (path: string) => Promise<string>;
  resolveExecutable?: CovenExecutableResolver;
  windowsFileTrust?: CovenWindowsFileTrustValidator;
}

export interface DiscoverCovenEndpointOptions {
  cwd?: string;
  dependencies?: CovenDiscoveryDependencies;
  env?: Readonly<NodeJS.ProcessEnv>;
  maxOutputBytes?: number;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

export type CovenDiscoverySource = 'coven_home' | 'config_paths';

export type CovenEndpointOwner =
  | { kind: 'unix'; uid: number }
  | { kind: 'windows'; identity: string };

export interface CovenEndpointFreshness {
  daemonPid: number;
  daemonStartedAt: string;
  processCreationTime?: string;
}

type CovenLocalEndpoint = Extract<
  DiscoveryEndpoint,
  { kind: 'unix' | 'windowsNamedPipe' }
>;

export interface CovenDiscoveredEndpoint {
  version: typeof DISCOVERED_ENDPOINT_VERSION;
  protocol: typeof COVEN_DAEMON_PROTOCOL;
  source: CovenDiscoverySource;
  endpoint: CovenLocalEndpoint;
  owner?: CovenEndpointOwner;
  freshness?: CovenEndpointFreshness;
}

interface DaemonStatus {
  pid: number;
  startedAt: string;
  socket: string;
  processCreationTime?: string;
}

type JsonObject = Record<string, unknown>;

function fail(
  code: CovenIpcErrorCode,
  message: string,
  diagnostics: CovenIpcDiagnostics,
): never {
  throw new CovenIpcError(code, message, diagnostics);
}

function safeByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function expectObject(value: unknown, label: string): JsonObject {
  if (!isPlainObject(value)) {
    return fail('malformed_config', `${label} must be a JSON object.`, {
      phase: 'parse_config',
    });
  }

  return value;
}

function expectOnlyFields(
  object: JsonObject,
  allowed: readonly string[],
  label: string,
): void {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(object)) {
    if (!allowedFields.has(field)) {
      return fail('malformed_config', `${label} contains an unsupported field.`, {
        phase: 'parse_config',
      });
    }
  }
}

function parseStrictJson(serialized: string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return fail('malformed_config', `${label} was not one JSON object.`, {
      phase: 'parse_config',
    });
  }

  return expectObject(parsed, label);
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return fail('malformed_config', `${label} must be a positive integer.`, {
      phase: 'parse_config',
    });
  }

  return value as number;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('malformed_config', `${label} must be a non-empty string.`, {
      phase: 'parse_config',
    });
  }

  return value;
}

function parseDaemonStatus(serialized: string): DaemonStatus {
  const status = parseStrictJson(serialized, 'Coven daemon metadata');
  expectOnlyFields(
    status,
    ['pid', 'startedAt', 'socket', 'processCreationTime'],
    'Coven daemon metadata',
  );

  const startedAt = parseNonEmptyString(
    status.startedAt,
    'Coven daemon metadata startedAt',
  );
  if (Number.isNaN(Date.parse(startedAt))) {
    return fail(
      'malformed_config',
      'Coven daemon metadata startedAt must be an ISO timestamp.',
      { phase: 'parse_config' },
    );
  }

  const processCreationTime =
    status.processCreationTime === undefined
      ? undefined
      : parseNonEmptyString(
          status.processCreationTime,
          'Coven daemon metadata processCreationTime',
        );

  return {
    pid: parsePositiveInteger(status.pid, 'Coven daemon metadata pid'),
    startedAt,
    socket: parseNonEmptyString(
      status.socket,
      'Coven daemon metadata socket',
    ),
    ...(processCreationTime === undefined ? {} : { processCreationTime }),
  };
}

function endpointFromPath(
  path: string,
  platform: NodeJS.Platform,
): CovenLocalEndpoint {
  const candidate =
    platform === 'win32'
      ? { kind: 'windowsNamedPipe' as const, path }
      : { kind: 'unix' as const, path };

  try {
    const endpoint = parseDiscoveryEndpoint(candidate);
    if (endpoint.kind === 'http') {
      return fail('unsafe_endpoint', 'Coven discovery does not accept HTTP endpoints.', {
        phase: 'validate_endpoint',
      });
    }
    return endpoint;
  } catch (error) {
    if (error instanceof DiscoveryContractError) {
      return fail('unsafe_endpoint', 'Coven reported an unsafe local IPC endpoint.', {
        phase: 'validate_endpoint',
      });
    }
    throw error;
  }
}

function windowsPipePath(socket: string): string {
  return socket.startsWith('\\\\.\\pipe\\') ? socket : `\\\\.\\pipe\\${socket}`;
}

function statusEndpoint(
  status: DaemonStatus,
  platform: NodeJS.Platform,
): CovenLocalEndpoint {
  return endpointFromPath(
    platform === 'win32' ? windowsPipePath(status.socket) : status.socket,
    platform,
  );
}

function sameEndpoint(
  left: CovenLocalEndpoint,
  right: CovenLocalEndpoint,
): boolean {
  return left.kind === right.kind && left.path === right.path;
}

function freshnessOf(status: DaemonStatus | undefined): CovenEndpointFreshness | undefined {
  if (status === undefined) {
    return undefined;
  }

  return {
    daemonPid: status.pid,
    daemonStartedAt: status.startedAt,
    ...(status.processCreationTime === undefined
      ? {}
      : { processCreationTime: status.processCreationTime }),
  };
}

function currentUnixOwner(
  platform: NodeJS.Platform,
  getEffectiveUid: () => number | undefined,
): CovenEndpointOwner | undefined {
  if (platform === 'win32') {
    return undefined;
  }

  const uid = getEffectiveUid();
  return Number.isSafeInteger(uid) && (uid as number) >= 0
    ? { kind: 'unix', uid: uid as number }
    : undefined;
}

function discoveredEndpoint(
  endpoint: CovenLocalEndpoint,
  source: CovenDiscoverySource,
  platform: NodeJS.Platform,
  getEffectiveUid: () => number | undefined,
  status?: DaemonStatus,
): CovenDiscoveredEndpoint {
  const owner = currentUnixOwner(platform, getEffectiveUid);
  const freshness = freshnessOf(status);

  return {
    version: DISCOVERED_ENDPOINT_VERSION,
    protocol: COVEN_DAEMON_PROTOCOL,
    source,
    endpoint,
    ...(owner === undefined ? {} : { owner }),
    ...(freshness === undefined ? {} : { freshness }),
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === 'ENOENT';
  } catch {
    return false;
  }
}

interface DiscoveryDeadline {
  readonly expiresAt: number;
}

interface DiscoveryFileDependencies {
  getEffectiveUid: () => number | undefined;
  lstat: (path: string) => Promise<CovenDiscoveryFileIdentity>;
  openFile: (
    path: string,
    flags: number,
  ) => Promise<CovenMetadataFileHandle>;
  platform: NodeJS.Platform;
  windowsFileTrust: CovenWindowsFileTrustValidator | undefined;
}

function discoveryTimeout(
  phase: CovenIpcDiagnostics['phase'],
): CovenIpcError {
  return new CovenIpcError(
    'timeout',
    'Coven discovery timed out.',
    { phase },
  );
}

function remainingDiscoveryTime(deadline: DiscoveryDeadline): number {
  return Math.max(0, deadline.expiresAt - performance.now());
}

function awaitDiscoveryStep<T>(
  operation: () => T | Promise<T>,
  deadline: DiscoveryDeadline,
  phase: CovenIpcDiagnostics['phase'],
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  const pending = Promise.resolve().then(operation);
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const timeout: { timer?: ReturnType<typeof setTimeout> } = {};
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout.timer !== undefined) {
        clearTimeout(timeout.timer);
      }
      action();
    };

    pending.then(
      (value) => {
        if (settled) {
          if (onLateResolve !== undefined) {
            void Promise.resolve()
              .then(() => onLateResolve(value))
              .catch(() => undefined);
          }
          return;
        }
        finish(() => {
          resolvePromise(value);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(
            isCovenIpcError(error)
              ? error
              : new CovenIpcError(
                  'command_failed',
                  phase === 'read_metadata'
                    ? 'Coven daemon metadata operation failed.'
                    : 'Coven executable validation failed.',
                  { phase },
                ),
          );
        });
      },
    );

    const remainingMs = remainingDiscoveryTime(deadline);
    if (remainingMs <= 0) {
      finish(() => {
        reject(discoveryTimeout(phase));
      });
      return;
    }
    timeout.timer = setTimeout(() => {
      finish(() => {
        reject(discoveryTimeout(phase));
      });
    }, remainingMs);
  });
}

function validateSafeFileIdentity(
  identity: CovenDiscoveryFileIdentity,
  options: {
    expectedUid: number | undefined;
    phase: 'config_command' | 'read_metadata';
    requireExecutable: boolean;
  },
): void {
  if (
    !Number.isSafeInteger(identity.device) ||
    identity.device < 0 ||
    !Number.isSafeInteger(identity.inode) ||
    identity.inode <= 0 ||
    !Number.isSafeInteger(identity.mode) ||
    identity.mode < 0 ||
    !Number.isSafeInteger(identity.ownerUid) ||
    identity.ownerUid < 0 ||
    !Number.isSafeInteger(identity.size) ||
    identity.size < 0 ||
    identity.symbolicLink ||
    !identity.regularFile ||
    (options.requireExecutable && (identity.mode & 0o111) === 0) ||
    (identity.mode & 0o022) !== 0
  ) {
    return fail(
      'unsafe_endpoint',
      options.requireExecutable
        ? 'The Coven executable was not a trusted regular executable.'
        : 'Coven daemon metadata was not an owner-safe regular file.',
      { phase: options.phase },
    );
  }
  if (
    options.expectedUid === undefined ||
    (identity.ownerUid !== options.expectedUid && identity.ownerUid !== 0)
  ) {
    return fail(
      'owner_mismatch',
      options.requireExecutable
        ? 'The Coven executable owner was not trusted.'
        : 'Coven daemon metadata owner was not trusted.',
      { phase: options.phase },
    );
  }
}

function validateWindowsMetadataIdentity(
  identity: CovenDiscoveryFileIdentity,
): void {
  if (
    !Number.isSafeInteger(identity.device) ||
    identity.device < 0 ||
    !Number.isSafeInteger(identity.inode) ||
    identity.inode < 0 ||
    !Number.isSafeInteger(identity.mode) ||
    identity.mode < 0 ||
    !Number.isSafeInteger(identity.ownerUid) ||
    identity.ownerUid < 0 ||
    !Number.isSafeInteger(identity.size) ||
    identity.size < 0 ||
    identity.symbolicLink ||
    !identity.regularFile
  ) {
    return fail(
      'unsafe_endpoint',
      'Coven daemon metadata was not an owner-safe regular file.',
      { phase: 'read_metadata' },
    );
  }
}

function validateMetadataIdentity(
  identity: CovenDiscoveryFileIdentity,
  dependencies: DiscoveryFileDependencies,
): void {
  if (dependencies.platform === 'win32') {
    validateWindowsMetadataIdentity(identity);
    return;
  }
  validateSafeFileIdentity(identity, {
    expectedUid: dependencies.getEffectiveUid(),
    phase: 'read_metadata',
    requireExecutable: false,
  });
}

function metadataOpenFlags(platform: NodeJS.Platform): number {
  let flags = fsConstants.O_RDONLY;
  if (platform !== 'win32') {
    if (typeof fsConstants.O_NOFOLLOW === 'number') {
      flags |= fsConstants.O_NOFOLLOW;
    }
    if (typeof fsConstants.O_NONBLOCK === 'number') {
      flags |= fsConstants.O_NONBLOCK;
    }
  }
  return flags;
}

async function validateWindowsFile(
  path: string,
  purpose: 'executable' | 'metadata',
  validator: CovenWindowsFileTrustValidator | undefined,
  deadline: DiscoveryDeadline,
  phase: 'config_command' | 'read_metadata',
): Promise<void> {
  if (validator === undefined || typeof validator.validate !== 'function') {
    return fail(
      'unsafe_endpoint',
      'Windows file trust validation is required.',
      { phase },
    );
  }
  const trusted = await awaitDiscoveryStep(
    () => validator.validate(path, purpose),
    deadline,
    phase,
  );
  if (trusted !== true) {
    return fail(
      'owner_mismatch',
      'Windows file ownership or trust validation failed.',
      { phase },
    );
  }
}

function decodeMetadata(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(
      'malformed_config',
      'Coven daemon metadata was not UTF-8.',
      { phase: 'parse_config' },
    );
  }
}

async function readOptionalDaemonStatus(
  path: string,
  dependencies: DiscoveryFileDependencies,
  deadline: DiscoveryDeadline,
): Promise<DaemonStatus | undefined> {
  const identity = await awaitDiscoveryStep(
    async () => {
      try {
        return await dependencies.lstat(path);
      } catch (error) {
        if (isNotFound(error)) {
          return undefined;
        }
        throw error;
      }
    },
    deadline,
    'read_metadata',
  );
  if (identity === undefined) {
    return undefined;
  }

  validateMetadataIdentity(identity, dependencies);
  if (dependencies.platform === 'win32') {
    await validateWindowsFile(
      path,
      'metadata',
      dependencies.windowsFileTrust,
      deadline,
      'read_metadata',
    );
  }

  if (identity.size > MAX_DAEMON_STATUS_BYTES) {
    return fail('body_limit', 'Coven daemon metadata exceeded its size limit.', {
      phase: 'read_metadata',
      limitBytes: MAX_DAEMON_STATUS_BYTES,
    });
  }

  const handle = await awaitDiscoveryStep(
    () => dependencies.openFile(path, metadataOpenFlags(dependencies.platform)),
    deadline,
    'read_metadata',
    (lateHandle) => lateHandle.close(),
  );
  let serialized: string | undefined;
  let primaryError: CovenIpcError | undefined;
  try {
    const openedIdentity = await awaitDiscoveryStep(
      () => handle.stat(),
      deadline,
      'read_metadata',
    );
    validateMetadataIdentity(openedIdentity, dependencies);
    if (
      openedIdentity.device !== identity.device ||
      openedIdentity.inode !== identity.inode
    ) {
      return fail(
        'unsafe_endpoint',
        'Coven daemon metadata changed while it was being opened.',
        { phase: 'read_metadata' },
      );
    }
    if (openedIdentity.size > MAX_DAEMON_STATUS_BYTES) {
      return fail(
        'body_limit',
        'Coven daemon metadata exceeded its size limit.',
        {
          phase: 'read_metadata',
          limitBytes: MAX_DAEMON_STATUS_BYTES,
        },
      );
    }
    const buffer = Buffer.alloc(MAX_DAEMON_STATUS_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await awaitDiscoveryStep(
        () => handle.read(buffer, offset, buffer.length - offset, null),
        deadline,
        'read_metadata',
      );
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > buffer.length - offset
      ) {
        return fail(
          'command_failed',
          'Coven daemon metadata could not be read safely.',
          { phase: 'read_metadata' },
        );
      }
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > MAX_DAEMON_STATUS_BYTES) {
      return fail(
        'body_limit',
        'Coven daemon metadata exceeded its size limit.',
        {
          phase: 'read_metadata',
          limitBytes: MAX_DAEMON_STATUS_BYTES,
        },
      );
    }
    serialized = decodeMetadata(buffer.subarray(0, offset));
  } catch (error) {
    primaryError = isCovenIpcError(error)
      ? error
      : new CovenIpcError(
          'command_failed',
          'Coven daemon metadata could not be read safely.',
          { phase: 'read_metadata' },
        );
  }

  try {
    await awaitDiscoveryStep(
      () => handle.close(),
      deadline,
      'read_metadata',
    );
  } catch (error) {
    if (primaryError === undefined) {
      throw isCovenIpcError(error)
        ? error
        : new CovenIpcError(
            'command_failed',
            'Coven daemon metadata could not be closed safely.',
            { phase: 'read_metadata' },
          );
    }
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
  if (serialized === undefined) {
    return fail(
      'command_failed',
      'Coven daemon metadata could not be read safely.',
      { phase: 'read_metadata' },
    );
  }
  return parseDaemonStatus(serialized);
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

async function discoverFromHome(
  homeValue: string,
  options: Required<Pick<DiscoverCovenEndpointOptions, 'cwd' | 'platform'>> &
    DiscoveryFileDependencies & {
      deadline: DiscoveryDeadline;
    },
): Promise<CovenDiscoveredEndpoint> {
  const paths = pathApi(options.platform);
  const home = paths.resolve(options.cwd, homeValue);
  const metadataPath = paths.join(home, 'daemon.json');
  const status = await readOptionalDaemonStatus(
    metadataPath,
    options,
    options.deadline,
  );

  const endpoint = endpointFromPath(paths.join(home, 'coven.sock'), options.platform);
  if (status !== undefined && !sameEndpoint(endpoint, statusEndpoint(status, options.platform))) {
    return fail(
      'unsafe_endpoint',
      'Coven daemon metadata did not match the selected profile endpoint.',
      { phase: 'validate_endpoint' },
    );
  }

  return discoveredEndpoint(
    endpoint,
    'coven_home',
    options.platform,
    options.getEffectiveUid,
    status,
  );
}

function sanitizeEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined && value.length > 0) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function outputDiagnostics(
  stdout: string,
  stderr: string,
  extra: Partial<CovenIpcDiagnostics> = {},
): CovenIpcDiagnostics {
  return {
    phase: 'config_command',
    stdoutBytes: safeByteLength(stdout),
    stderrBytes: safeByteLength(stderr),
    ...extra,
  };
}

async function resolveTrustedExecutable(
  options: {
    deadline: DiscoveryDeadline;
    getEffectiveUid: () => number | undefined;
    lstat: (path: string) => Promise<CovenDiscoveryFileIdentity>;
    platform: NodeJS.Platform;
    realpath: (path: string) => Promise<string>;
    resolveExecutable: CovenExecutableResolver | undefined;
    windowsFileTrust: CovenWindowsFileTrustValidator | undefined;
  },
): Promise<string> {
  if (typeof options.resolveExecutable !== 'function') {
    return fail(
      'unsafe_endpoint',
      'A trusted Coven executable resolver is required.',
      { phase: 'config_command' },
    );
  }
  const executable = await awaitDiscoveryStep(
    () => options.resolveExecutable?.(),
    options.deadline,
    'config_command',
  );
  if (typeof executable !== 'string' || executable.length === 0) {
    return fail(
      'unsafe_endpoint',
      'The Coven executable resolver returned an unsafe path.',
      { phase: 'config_command' },
    );
  }
  const paths = pathApi(options.platform);
  const expectedName = options.platform === 'win32' ? 'coven.exe' : 'coven';
  if (
    !paths.isAbsolute(executable) ||
    (options.platform === 'win32'
      ? paths.basename(executable).toLowerCase() !== expectedName
      : paths.basename(executable) !== expectedName) ||
    paths.normalize(executable) !== executable
  ) {
    return fail(
      'unsafe_endpoint',
      'The Coven executable resolver returned an unsafe path.',
      { phase: 'config_command' },
    );
  }
  const canonical = await awaitDiscoveryStep(
    () => options.realpath(executable),
    options.deadline,
    'config_command',
  );
  if (canonical !== executable) {
    return fail(
      'unsafe_endpoint',
      'The Coven executable path was not canonical.',
      { phase: 'config_command' },
    );
  }
  const identity = await awaitDiscoveryStep(
    () => options.lstat(canonical),
    options.deadline,
    'config_command',
  );
  if (options.platform === 'win32') {
    if (identity.symbolicLink || !identity.regularFile) {
      return fail(
        'unsafe_endpoint',
        'The Coven executable was not a trusted regular executable.',
        { phase: 'config_command' },
      );
    }
    await validateWindowsFile(
      canonical,
      'executable',
      options.windowsFileTrust,
      options.deadline,
      'config_command',
    );
  } else {
    validateSafeFileIdentity(identity, {
      expectedUid: options.getEffectiveUid(),
      phase: 'config_command',
      requireExecutable: true,
    });
  }
  return canonical;
}

function executeConfigPaths(
  executable: string,
  cwd: string,
  execFile: CovenExecFile,
  environment: Readonly<NodeJS.ProcessEnv>,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let child: CovenExecFileChild | void;
    const rejectOnce = (error: CovenIpcError): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      reject(error);
    };
    const resolveOnce = (stdout: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      resolvePromise(stdout);
    };
    const callback = (
      error: CovenExecFileError | null,
      stdout: string,
      stderr: string,
    ): void => {
        if (settled) {
          return;
        }
        const diagnostics = outputDiagnostics(stdout, stderr);
        if (
          safeByteLength(stdout) > maxOutputBytes ||
          safeByteLength(stderr) > maxOutputBytes ||
          error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ) {
          rejectOnce(
            new CovenIpcError(
              'body_limit',
              'Coven config output exceeded its size limit.',
              { ...diagnostics, limitBytes: maxOutputBytes },
            ),
          );
          return;
        }

        if (error !== null) {
          const exitCode = typeof error.code === 'number' ? error.code : undefined;
          const signal =
            typeof error.signal === 'string' ? error.signal : undefined;
          const commandDiagnostics = {
            ...diagnostics,
            ...(exitCode === undefined ? {} : { exitCode }),
            ...(signal === undefined ? {} : { signal }),
          };
          const code =
            error.code === 'ETIMEDOUT' || error.killed === true
              ? 'timeout'
              : error.code === 'ENOENT'
                ? 'not_found'
                : 'command_failed';
          rejectOnce(
            new CovenIpcError(
              code,
              code === 'timeout'
                ? 'Coven config discovery timed out.'
                : code === 'not_found'
                  ? 'The Coven executable was not found.'
                  : 'Coven config discovery failed.',
              commandDiagnostics,
            ),
          );
          return;
        }

        if (stderr.length > 0) {
          rejectOnce(
            new CovenIpcError(
              'command_failed',
              'Coven config discovery wrote unexpected diagnostics.',
              diagnostics,
            ),
          );
          return;
        }

        resolveOnce(stdout);
    };

    try {
      child = execFile(
        executable,
        COVEN_COMMAND_ARGS,
        {
          cwd,
          encoding: 'utf8',
          env: sanitizeEnvironment(environment),
          killSignal: 'SIGKILL',
          maxBuffer: maxOutputBytes,
          shell: false,
          timeout: timeoutMs,
          windowsHide: true,
        },
        callback,
      );
      if (!settled) {
        timeout = setTimeout(() => {
          try {
            child?.kill('SIGKILL');
          } catch {
            // A failed kill must not prevent the bounded timeout from settling.
          }
          rejectOnce(
            new CovenIpcError(
              'timeout',
              'Coven config discovery timed out.',
              { phase: 'config_command' },
            ),
          );
        }, timeoutMs);
      }
    } catch {
      rejectOnce(
        new CovenIpcError(
          'command_failed',
          'Coven config discovery could not be started.',
          { phase: 'config_command' },
        ),
      );
    }
  });
}

interface ConfigSurface {
  id: string;
  status: 'resolved' | 'not_applicable' | 'unsupported' | 'unresolved';
  path?: string;
  paths?: string[];
  source: 'environment' | 'configuration' | 'default';
  access: 'read_only';
}

function parseSurface(value: unknown): ConfigSurface {
  const surface = expectObject(value, 'Coven config path surface');
  expectOnlyFields(
    surface,
    ['id', 'status', 'path', 'paths', 'source', 'access'],
    'Coven config path surface',
  );
  const id = parseNonEmptyString(surface.id, 'Coven config path surface id');
  const status = surface.status;
  if (
    status !== 'resolved' &&
    status !== 'not_applicable' &&
    status !== 'unsupported' &&
    status !== 'unresolved'
  ) {
    return fail('malformed_config', 'Coven config path surface status was invalid.', {
      phase: 'parse_config',
    });
  }
  const source = surface.source;
  if (
    source !== 'environment' &&
    source !== 'configuration' &&
    source !== 'default'
  ) {
    return fail('malformed_config', 'Coven config path surface source was invalid.', {
      phase: 'parse_config',
    });
  }
  if (surface.access !== 'read_only') {
    return fail('malformed_config', 'Coven config path surface access was invalid.', {
      phase: 'parse_config',
    });
  }

  const path =
    surface.path === undefined
      ? undefined
      : parseNonEmptyString(surface.path, 'Coven config path surface path');
  let paths: string[] | undefined;
  if (surface.paths !== undefined) {
    if (
      !Array.isArray(surface.paths) ||
      !surface.paths.every((entry) => typeof entry === 'string' && entry.length > 0)
    ) {
      return fail('malformed_config', 'Coven config path surface paths were invalid.', {
        phase: 'parse_config',
      });
    }
    paths = [];
    for (const entry of surface.paths) {
      if (typeof entry !== 'string') {
        return fail(
          'malformed_config',
          'Coven config path surface paths were invalid.',
          { phase: 'parse_config' },
        );
      }
      paths.push(entry);
    }
  }

  if (
    (status === 'resolved' && (path === undefined) === (paths === undefined)) ||
    (status !== 'resolved' && (path !== undefined || paths !== undefined))
  ) {
    return fail('malformed_config', 'Coven config path surface resolution was ambiguous.', {
      phase: 'parse_config',
    });
  }

  return {
    id,
    status,
    source,
    access: 'read_only',
    ...(path === undefined ? {} : { path }),
    ...(paths === undefined ? {} : { paths }),
  };
}

function parseConfigPaths(serialized: string): ConfigSurface[] {
  const report = parseStrictJson(serialized, 'Coven config paths output');
  expectOnlyFields(report, ['schema', 'version', 'surfaces'], 'Coven config paths output');
  if (report.schema !== CONFIG_PATHS_SCHEMA || report.version !== CONFIG_PATHS_VERSION) {
    return fail('malformed_config', 'Coven config paths schema is unsupported.', {
      phase: 'parse_config',
    });
  }
  if (!Array.isArray(report.surfaces)) {
    return fail('malformed_config', 'Coven config paths surfaces must be an array.', {
      phase: 'parse_config',
    });
  }

  const surfaces = report.surfaces.map(parseSurface);
  const ids = new Set<string>();
  for (const surface of surfaces) {
    if (ids.has(surface.id)) {
      return fail('malformed_config', 'Coven config paths contained a duplicate surface.', {
        phase: 'parse_config',
      });
    }
    ids.add(surface.id);
  }
  return surfaces;
}

function resolvedSurfacePath(
  surfaces: readonly ConfigSurface[],
  id: string,
  required: boolean,
): string | undefined {
  const surface = surfaces.find((candidate) => candidate.id === id);
  if (surface === undefined || surface.status !== 'resolved') {
    if (required) {
      return fail('not_found', 'Coven did not report the required daemon path.', {
        phase: 'parse_config',
      });
    }
    return undefined;
  }
  if (surface.path === undefined || surface.paths !== undefined) {
    return fail('malformed_config', 'Coven reported an ambiguous daemon path.', {
      phase: 'parse_config',
    });
  }
  return surface.path;
}

async function discoverFromCommand(
  options: {
    cwd: string;
    deadline: DiscoveryDeadline;
    environment: Readonly<NodeJS.ProcessEnv>;
    execFile: CovenExecFile;
    getEffectiveUid: () => number | undefined;
    lstat: (path: string) => Promise<CovenDiscoveryFileIdentity>;
    maxOutputBytes: number;
    openFile: (
      path: string,
      flags: number,
    ) => Promise<CovenMetadataFileHandle>;
    platform: NodeJS.Platform;
    realpath: (path: string) => Promise<string>;
    resolveExecutable: CovenExecutableResolver | undefined;
    timeoutMs: number;
    windowsFileTrust: CovenWindowsFileTrustValidator | undefined;
  },
): Promise<CovenDiscoveredEndpoint> {
  const executable = await resolveTrustedExecutable(options);
  const commandTimeoutMs = Math.max(
    1,
    Math.floor(
      Math.min(options.timeoutMs, remainingDiscoveryTime(options.deadline)),
    ),
  );
  const serialized = await awaitDiscoveryStep(
    () =>
      executeConfigPaths(
        executable,
        options.cwd,
        options.execFile,
        options.environment,
        commandTimeoutMs,
        options.maxOutputBytes,
      ),
    options.deadline,
    'config_command',
  );
  const surfaces = parseConfigPaths(serialized);
  const homePath = resolvedSurfacePath(surfaces, 'coven.home', true);
  const endpointPath = resolvedSurfacePath(surfaces, 'state.daemon_ipc', true);
  if (homePath === undefined || endpointPath === undefined) {
    return fail('not_found', 'Coven did not report a daemon endpoint.', {
      phase: 'parse_config',
    });
  }
  const endpoint = endpointFromPath(endpointPath, options.platform);
  const metadataPath = resolvedSurfacePath(
    surfaces,
    'state.daemon_metadata',
    false,
  );
  const paths = pathApi(options.platform);
  if (
    !paths.isAbsolute(homePath) ||
    paths.normalize(homePath) !== homePath ||
    (options.environment.COVEN_HOME !== undefined &&
      options.environment.COVEN_HOME.length > 0 &&
      homePath !== paths.resolve(options.cwd, options.environment.COVEN_HOME)) ||
    (options.platform !== 'win32' &&
      endpointPath !== paths.join(homePath, 'coven.sock')) ||
    (metadataPath !== undefined &&
      metadataPath !== paths.join(homePath, 'daemon.json'))
  ) {
    return fail(
      'unsafe_endpoint',
      'Coven reported daemon paths outside its selected home.',
      { phase: 'validate_endpoint' },
    );
  }
  const status =
    metadataPath === undefined
      ? undefined
      : await readOptionalDaemonStatus(
          metadataPath,
          options,
          options.deadline,
        );

  if (status !== undefined && !sameEndpoint(endpoint, statusEndpoint(status, options.platform))) {
    return fail(
      'unsafe_endpoint',
      'Coven daemon metadata did not match the reported endpoint.',
      { phase: 'validate_endpoint' },
    );
  }

  return discoveredEndpoint(
    endpoint,
    'config_paths',
    options.platform,
    options.getEffectiveUid,
    status,
  );
}

const defaultExecFile = nodeExecFile as unknown as CovenExecFile;

async function defaultDiscoveryLstat(
  path: string,
): Promise<CovenDiscoveryFileIdentity> {
  const stats = await nodeLstat(path);
  return discoveryFileIdentityFromStats(stats);
}

function discoveryFileIdentityFromStats(
  stats: Stats,
): CovenDiscoveryFileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    ownerUid: stats.uid,
    regularFile: stats.isFile(),
    size: stats.size,
    symbolicLink: stats.isSymbolicLink(),
  };
}

async function defaultOpenFile(
  path: string,
  flags: number,
): Promise<CovenMetadataFileHandle> {
  const handle = await nodeOpen(path, flags);
  return {
    close: () => handle.close(),
    read: (buffer, offset, length, position) =>
      handle.read(buffer, offset, length, position),
    stat: async () =>
      discoveryFileIdentityFromStats(await handle.stat()),
  };
}

export async function discoverCovenEndpoint(
  options: DiscoverCovenEndpointOptions = {},
): Promise<CovenDiscoveredEndpoint> {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const execFile = options.dependencies?.execFile ?? defaultExecFile;
  const lstat = options.dependencies?.lstat ?? defaultDiscoveryLstat;
  const openFile = options.dependencies?.openFile ?? defaultOpenFile;
  const realpath = options.dependencies?.realpath ?? nodeRealpath;
  const resolveExecutable = options.dependencies?.resolveExecutable;
  const windowsFileTrust = options.dependencies?.windowsFileTrust;
  const getEffectiveUid =
    options.dependencies?.getEffectiveUid ??
    (() => process.geteuid?.());
  const covenHome = environment.COVEN_HOME;
  const deadline: DiscoveryDeadline = {
    expiresAt: performance.now() + timeoutMs,
  };

  if (
    platform !== 'win32' &&
    covenHome !== undefined &&
    covenHome.length > 0
  ) {
    return discoverFromHome(covenHome, {
      cwd,
      deadline,
      platform,
      getEffectiveUid,
      lstat,
      openFile,
      windowsFileTrust,
    });
  }

  return discoverFromCommand({
    cwd,
    deadline,
    environment,
    execFile,
    getEffectiveUid,
    lstat,
    maxOutputBytes,
    openFile,
    platform,
    realpath,
    resolveExecutable,
    timeoutMs,
    windowsFileTrust,
  });
}
