import { execFile as nodeExecFile } from 'node:child_process';
import { readFile as nodeReadFile } from 'node:fs/promises';
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
    return Reflect.get(error, COVEN_IPC_ERROR_BRAND) === true;
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

export interface CovenDiscoveryDependencies {
  execFile?: CovenExecFile;
  getEffectiveUid?: () => number | undefined;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
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
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

async function readOptionalDaemonStatus(
  path: string,
  readFile: (path: string, encoding: 'utf8') => Promise<string>,
): Promise<DaemonStatus | undefined> {
  let serialized: string;
  try {
    serialized = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    return fail('command_failed', 'Coven daemon metadata could not be read.', {
      phase: 'read_metadata',
    });
  }

  if (safeByteLength(serialized) > MAX_DAEMON_STATUS_BYTES) {
    return fail('body_limit', 'Coven daemon metadata exceeded its size limit.', {
      phase: 'read_metadata',
      limitBytes: MAX_DAEMON_STATUS_BYTES,
    });
  }

  return parseDaemonStatus(serialized);
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

async function discoverFromHome(
  homeValue: string,
  options: Required<
    Pick<DiscoverCovenEndpointOptions, 'cwd' | 'platform'>
  > & {
    getEffectiveUid: () => number | undefined;
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
  },
): Promise<CovenDiscoveredEndpoint> {
  const paths = pathApi(options.platform);
  const home = paths.resolve(options.cwd, homeValue);
  const metadataPath = paths.join(home, 'daemon.json');
  const status = await readOptionalDaemonStatus(metadataPath, options.readFile);

  if (options.platform === 'win32') {
    if (status === undefined) {
      return fail(
        'not_found',
        'Coven daemon metadata was not found for the selected profile.',
        { phase: 'read_metadata' },
      );
    }
    return discoveredEndpoint(
      statusEndpoint(status, options.platform),
      'coven_home',
      options.platform,
      options.getEffectiveUid,
      status,
    );
  }

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

function executeConfigPaths(
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
        'coven',
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
        }, timeoutMs + 25);
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
    environment: Readonly<NodeJS.ProcessEnv>;
    execFile: CovenExecFile;
    getEffectiveUid: () => number | undefined;
    maxOutputBytes: number;
    platform: NodeJS.Platform;
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
    timeoutMs: number;
  },
): Promise<CovenDiscoveredEndpoint> {
  const serialized = await executeConfigPaths(
    options.cwd,
    options.execFile,
    options.environment,
    options.timeoutMs,
    options.maxOutputBytes,
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
      : await readOptionalDaemonStatus(metadataPath, options.readFile);

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

export async function discoverCovenEndpoint(
  options: DiscoverCovenEndpointOptions = {},
): Promise<CovenDiscoveredEndpoint> {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const execFile = options.dependencies?.execFile ?? defaultExecFile;
  const readFile = options.dependencies?.readFile ?? nodeReadFile;
  const getEffectiveUid =
    options.dependencies?.getEffectiveUid ??
    (() => process.geteuid?.());
  const covenHome = environment.COVEN_HOME;

  if (covenHome !== undefined && covenHome.length > 0) {
    return discoverFromHome(covenHome, {
      cwd,
      platform,
      getEffectiveUid,
      readFile,
    });
  }

  return discoverFromCommand({
    cwd,
    environment,
    execFile,
    getEffectiveUid,
    maxOutputBytes,
    platform,
    readFile,
    timeoutMs,
  });
}
