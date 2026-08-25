import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat as nodeLstat, open as nodeOpen, realpath as nodeRealpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import {
  isOperationAbortedError,
  isOperationTimeoutError,
  type DiscoveryEndpoint,
  type OperationOptions,
} from '@opencoven/sdk-core';

const DISCOVERY_RECORD_VERSION = 1 as const;
const DISCOVERY_FILE_NAME = 'client-v1-discovery.json';
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_RECORD_BYTES = 16 * 1024;
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

export interface CaveDiscoveryPathIdentity {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  size: number;
  symbolicLink: boolean;
  regularFile: boolean;
  directory: boolean;
}

export interface CaveDiscoveryFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
  stat(): Promise<CaveDiscoveryPathIdentity>;
}

export interface CaveWindowsPathTrustValidator {
  validate(
    path: string,
    purpose: 'root' | 'record',
  ): Promise<boolean | CaveWindowsPathTrustResult>;
}

export interface CaveWindowsPathTrustResult {
  trusted: true;
  identity: string;
}

export interface CaveDiscoveryDependencies {
  getEffectiveUid?: () => number | undefined;
  isProcessAlive?: (pid: number) => boolean;
  lstat?: (path: string) => Promise<CaveDiscoveryPathIdentity>;
  openFile?: (
    path: string,
    flags: number,
  ) => Promise<CaveDiscoveryFileHandle>;
  realpath?: (path: string) => Promise<string>;
  resolveHomeDirectory?: () => string | undefined;
  windowsPathTrust?: CaveWindowsPathTrustValidator;
}

export interface DiscoverCaveEndpointOptions extends OperationOptions {
  cwd?: string;
  deadline?: number;
  dependencies?: CaveDiscoveryDependencies;
  env?: Readonly<NodeJS.ProcessEnv>;
  maxRecordBytes?: number;
  platform?: NodeJS.Platform;
  root?: string;
  timeoutMs?: number;
}

export interface CaveEndpointFreshness {
  pid: number;
  nonce: string;
  startedAt: string;
}

export interface CaveDiscoveryRecordIdentity {
  path: string;
  device: number;
  inode: number;
}

export interface CaveDiscoveredEndpoint {
  version: typeof DISCOVERY_RECORD_VERSION;
  endpoint: Extract<DiscoveryEndpoint, { kind: 'http' }>;
  freshness: CaveEndpointFreshness;
  record: CaveDiscoveryRecordIdentity;
}

interface DiscoveryDeadline {
  expiresAt: number | undefined;
  signal: AbortSignal | undefined;
}

function discoveryRetryable(code: CaveDiscoveryErrorCode): boolean {
  return code === 'not_found' || code === 'stale_record' || code === 'timeout';
}

export class CaveDiscoveryError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: CaveDiscoveryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaveDiscoveryError';
    this.retryable = discoveryRetryable(code);
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

function safeSignalReason(signal: AbortSignal | undefined): unknown {
  if (signal === undefined) {
    return undefined;
  }

  try {
    return Reflect.get(signal, 'reason');
  } catch {
    return undefined;
  }
}

function toDiscoveryError(error: unknown, fallback: CaveDiscoveryErrorCode): CaveDiscoveryError {
  if (isCaveDiscoveryError(error)) {
    return error;
  }

  if (isOperationTimeoutError(error)) {
    return new CaveDiscoveryError('timeout', 'Cave discovery timed out.');
  }

  if (isOperationAbortedError(error)) {
    return new CaveDiscoveryError('aborted', 'Cave discovery was aborted.');
  }

  return new CaveDiscoveryError(fallback, 'Cave discovery could not be completed safely.');
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function discoveryFlags(platform: NodeJS.Platform): number {
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

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT';
}

function remainingTime(deadline: DiscoveryDeadline): number | undefined {
  return deadline.expiresAt === undefined
    ? undefined
    : Math.max(0, deadline.expiresAt - performance.now());
}

function ensureActive(deadline: DiscoveryDeadline): void {
  if (deadline.signal?.aborted === true) {
    const reason = safeSignalReason(deadline.signal);
    throw toDiscoveryError(reason, 'aborted');
  }

  if (remainingTime(deadline) === 0) {
    fail('timeout', 'Cave discovery timed out.');
  }
}

async function awaitStep<T>(
  operation: () => T | Promise<T>,
  deadline: DiscoveryDeadline,
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  ensureActive(deadline);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      abortListener?.();
      action();
    };

    const remainingMs = remainingTime(deadline);
    if (remainingMs !== undefined) {
      timer = setTimeout(() => {
        finish(() => reject(new CaveDiscoveryError('timeout', 'Cave discovery timed out.')));
      }, remainingMs);
      (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    }

    if (deadline.signal !== undefined) {
      const onAbort = (): void => {
        finish(() => reject(toDiscoveryError(safeSignalReason(deadline.signal), 'aborted')));
      };
      deadline.signal.addEventListener('abort', onAbort, { once: true });
      abortListener = () => {
        deadline.signal?.removeEventListener('abort', onAbort);
      };
    }

    Promise.resolve()
      .then(() => {
        ensureActive(deadline);
        return operation();
      })
      .then(
        (value) => {
          const expired = remainingTime(deadline) === 0;
          if (settled || expired || deadline.signal?.aborted === true) {
            if (onLateResolve !== undefined) {
              void Promise.resolve(onLateResolve(value)).catch(() => undefined);
            }
            if (!settled) {
              finish(() => reject(toDiscoveryError(safeSignalReason(deadline.signal), expired ? 'timeout' : 'aborted')));
            }
            return;
          }
          finish(() => resolve(value));
        },
        (error: unknown) => {
          finish(() =>
            reject(
              error instanceof Error ? error : new Error('Cave discovery step failed.'),
            ),
          );
        },
      );
  });
}

function expectPositiveSafeInteger(value: unknown, code: CaveDiscoveryErrorCode, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(code, message);
  }

  return value;
}

function identityFromStats(stats: Stats): CaveDiscoveryPathIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    ownerUid: stats.uid,
    size: stats.size,
    symbolicLink: stats.isSymbolicLink(),
    regularFile: stats.isFile(),
    directory: stats.isDirectory(),
  };
}

async function defaultLstat(path: string): Promise<CaveDiscoveryPathIdentity> {
  return identityFromStats(await nodeLstat(path));
}

async function defaultOpenFile(path: string, flags: number): Promise<CaveDiscoveryFileHandle> {
  const handle = await nodeOpen(path, flags);
  return {
    close: () => handle.close(),
    read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
    stat: async () => identityFromStats(await handle.stat()),
  };
}

function defaultHomeDirectory(
  platform: NodeJS.Platform,
  env: Readonly<NodeJS.ProcessEnv>,
): string | undefined {
  if (platform === 'win32') {
    const userProfile = env.USERPROFILE;
    if (typeof userProfile === 'string' && userProfile.length > 0) {
      return userProfile;
    }

    const homeDrive = env.HOMEDRIVE;
    const homePath = env.HOMEPATH;
    if (
      typeof homeDrive === 'string' &&
      homeDrive.length > 0 &&
      typeof homePath === 'string' &&
      homePath.length > 0
    ) {
      return `${homeDrive}${homePath}`;
    }

    return undefined;
  }

  return typeof env.HOME === 'string' && env.HOME.length > 0 ? env.HOME : undefined;
}

function resolveRoot(options: {
  cwd: string;
  dependencies: CaveDiscoveryDependencies | undefined;
  env: Readonly<NodeJS.ProcessEnv>;
  platform: NodeJS.Platform;
  root: string | undefined;
}): string {
  const paths = pathApi(options.platform);
  if (typeof options.root === 'string' && options.root.length > 0) {
    return paths.resolve(options.cwd, options.root);
  }

  const caveHome = options.env.COVEN_CAVE_HOME;
  if (typeof caveHome === 'string' && caveHome.length > 0) {
    return paths.resolve(options.cwd, caveHome);
  }

  const covenHome = options.env.COVEN_HOME;
  if (typeof covenHome === 'string' && covenHome.length > 0) {
    return paths.resolve(options.cwd, covenHome, 'cave');
  }

  const homeDirectory =
    options.dependencies?.resolveHomeDirectory?.() ?? defaultHomeDirectory(options.platform, options.env);
  if (typeof homeDirectory !== 'string' || homeDirectory.length === 0) {
    return fail('not_found', 'Cave home could not be resolved.');
  }

  return paths.resolve(homeDirectory, '.coven', 'cave');
}

function validateRootIdentity(
  identity: CaveDiscoveryPathIdentity,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
): void {
  if (
    !Number.isSafeInteger(identity.device) ||
    identity.device < 0 ||
    !Number.isSafeInteger(identity.inode) ||
    identity.inode < 0 ||
    (platform !== 'win32' && identity.inode === 0) ||
    !Number.isSafeInteger(identity.mode) ||
    identity.mode < 0 ||
    !Number.isSafeInteger(identity.ownerUid) ||
    identity.ownerUid < 0 ||
    !identity.directory ||
    identity.symbolicLink
  ) {
    return fail('unsafe_endpoint', 'Cave discovery root was not a trusted directory.');
  }

  if (platform !== 'win32') {
    if (expectedUid === undefined || identity.ownerUid !== expectedUid) {
      return fail('owner_mismatch', 'Cave discovery root owner did not match the current user.');
    }
    if ((identity.mode & 0o077) !== 0) {
      return fail('unsafe_endpoint', 'Cave discovery root permissions were too broad.');
    }
  }
}

function validateRecordIdentity(
  identity: CaveDiscoveryPathIdentity,
  platform: NodeJS.Platform,
  expectedUid: number | undefined,
  maxRecordBytes: number,
): void {
  if (
    !Number.isSafeInteger(identity.device) ||
    identity.device < 0 ||
    !Number.isSafeInteger(identity.inode) ||
    identity.inode < 0 ||
    (platform !== 'win32' && identity.inode === 0) ||
    !Number.isSafeInteger(identity.mode) ||
    identity.mode < 0 ||
    !Number.isSafeInteger(identity.ownerUid) ||
    identity.ownerUid < 0 ||
    !Number.isSafeInteger(identity.size) ||
    identity.size < 0 ||
    identity.symbolicLink ||
    !identity.regularFile ||
    identity.directory
  ) {
    return fail('unsafe_endpoint', 'Cave discovery record was not a trusted regular file.');
  }

  if (platform !== 'win32') {
    if (expectedUid === undefined || identity.ownerUid !== expectedUid) {
      return fail('owner_mismatch', 'Cave discovery record owner did not match the current user.');
    }
    if ((identity.mode & 0o077) !== 0) {
      return fail('unsafe_endpoint', 'Cave discovery record permissions were too broad.');
    }
  }

  if (identity.size > maxRecordBytes) {
    return fail('body_limit', 'Cave discovery record exceeded its size limit.');
  }
}

async function validateWindowsTrust(
  validator: CaveWindowsPathTrustValidator | undefined,
  path: string,
  purpose: 'root' | 'record',
  deadline: DiscoveryDeadline,
): Promise<string | undefined> {
  if (validator === undefined || typeof validator.validate !== 'function') {
    return fail('owner_mismatch', 'Windows Cave discovery trust validation is required.');
  }

  const result = await awaitStep(() => validator.validate(path, purpose), deadline);
  if (result === true) {
    return undefined;
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    result.trusted !== true ||
    typeof result.identity !== 'string' ||
    result.identity.trim().length === 0 ||
    result.identity.length > 1_024 ||
    containsControlCharacter(result.identity)
  ) {
    return fail('owner_mismatch', 'Windows Cave discovery trust validation failed.');
  }

  return result.identity;
}

function validateStableIdentity(
  initial: CaveDiscoveryPathIdentity,
  current: CaveDiscoveryPathIdentity,
  initialNativeIdentity: string | undefined,
  currentNativeIdentity: string | undefined,
  message: string,
): void {
  if (
    current.device !== initial.device ||
    current.inode !== initial.inode ||
    ((initial.device === 0 || initial.inode === 0) &&
      (initialNativeIdentity === undefined ||
        currentNativeIdentity === undefined ||
        currentNativeIdentity !== initialNativeIdentity))
  ) {
    return fail('unsafe_endpoint', message);
  }
}

function decodeJson(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('invalid_response', 'Cave discovery record was not valid UTF-8.');
  }
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

function parseRecord(
  serialized: string,
  isProcessAlive: (pid: number) => boolean,
  recordIdentity: CaveDiscoveryRecordIdentity,
): CaveDiscoveredEndpoint {
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
  const fields = Reflect.ownKeys(record);
  const allowed = new Set(['version', 'endpoint', 'pid', 'nonce', 'startedAt']);

  for (const field of fields) {
    if (typeof field !== 'string' || !allowed.has(field)) {
      return fail('invalid_response', 'Cave discovery record contained an unsupported field.');
    }
  }

  if (record.version !== DISCOVERY_RECORD_VERSION) {
    return fail('invalid_response', 'Cave discovery record version was not supported.');
  }

  const endpoint =
    typeof record.endpoint === 'string'
      ? parseCaveHttpEndpoint(record.endpoint)
      : fail('invalid_response', 'Cave discovery endpoint was invalid.');
  const pid = expectPositiveSafeInteger(
    record.pid,
    'invalid_response',
    'Cave discovery pid must be a positive safe integer.',
  );
  if (!isProcessAlive(pid)) {
    return fail('stale_record', 'Cave discovery pid did not identify a live process.');
  }

  if (
    typeof record.nonce !== 'string' ||
    record.nonce.trim().length === 0 ||
    record.nonce.length > 256 ||
    containsControlCharacter(record.nonce)
  ) {
    return fail('invalid_response', 'Cave discovery nonce was invalid.');
  }

  if (
    typeof record.startedAt !== 'string' ||
    !validTimestamp(record.startedAt)
  ) {
    return fail('invalid_response', 'Cave discovery startedAt was invalid.');
  }

  return {
    version: DISCOVERY_RECORD_VERSION,
    endpoint,
    freshness: {
      pid,
      nonce: record.nonce,
      startedAt: record.startedAt,
    },
    record: recordIdentity,
  };
}

async function closeHandle(handle: CaveDiscoveryFileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // Best effort only.
  }
}

export async function discoverCaveEndpoint(
  options: DiscoverCaveEndpointOptions = {},
): Promise<CaveDiscoveredEndpoint> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  const dependencies = options.dependencies;
  const lstat = dependencies?.lstat ?? defaultLstat;
  const openFile = dependencies?.openFile ?? defaultOpenFile;
  const realpath = dependencies?.realpath ?? nodeRealpath;
  const getEffectiveUid = dependencies?.getEffectiveUid ?? (() => process.geteuid?.());
  const isProcessAlive = dependencies?.isProcessAlive ?? ((pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  });
  const expiresAt = [
    options.deadline,
    timeoutMs === undefined ? undefined : performance.now() + timeoutMs,
  ].reduce<number | undefined>((earliest, candidate) => {
    if (candidate === undefined) {
      return earliest;
    }
    return earliest === undefined ? candidate : Math.min(earliest, candidate);
  }, undefined);
  const deadline: DiscoveryDeadline = {
    expiresAt,
    signal: options.signal,
  };
  const expectedUid = platform === 'win32' ? undefined : getEffectiveUid();
  const root = resolveRoot({
    cwd,
    dependencies,
    env,
    platform,
    root: options.root,
  });
  const paths = pathApi(platform);

  try {
    const configuredRootIdentity = await awaitStep(async () => {
      try {
        return await lstat(root);
      } catch (error) {
        if (isNotFound(error)) {
          return fail('not_found', 'Cave discovery root was not found.');
        }
        throw error;
      }
    }, deadline);
    if (configuredRootIdentity.symbolicLink) {
      return fail('unsafe_endpoint', 'Cave discovery root must not be a symlink.');
    }

    const physicalRoot = await awaitStep(() => realpath(root), deadline);
    if (physicalRoot !== root) {
      return fail('unsafe_endpoint', 'Cave discovery root must be canonical.');
    }
    const physicalRecordPath = paths.join(physicalRoot, DISCOVERY_FILE_NAME);

    const rootIdentity = await awaitStep(() => lstat(physicalRoot), deadline);
    validateRootIdentity(rootIdentity, platform, expectedUid);
    const rootWindowsIdentity =
      platform === 'win32'
        ? await validateWindowsTrust(
            dependencies?.windowsPathTrust,
            physicalRoot,
            'root',
            deadline,
          )
        : undefined;

    const initialIdentity = await awaitStep(async () => {
      try {
        return await lstat(physicalRecordPath);
      } catch (error) {
        if (isNotFound(error)) {
          return fail('not_found', 'Cave discovery record was not found.');
        }
        throw error;
      }
    }, deadline);
    validateRecordIdentity(initialIdentity, platform, expectedUid, maxRecordBytes);
    const recordWindowsIdentity =
      platform === 'win32'
        ? await validateWindowsTrust(
            dependencies?.windowsPathTrust,
            physicalRecordPath,
            'record',
            deadline,
          )
        : undefined;

    const handle = await awaitStep(
      () => openFile(physicalRecordPath, discoveryFlags(platform)),
      deadline,
      (lateHandle) => closeHandle(lateHandle),
    );
    let serialized: string | undefined;
    let primaryError: CaveDiscoveryError | undefined;

    try {
      const openedIdentity = await awaitStep(() => handle.stat(), deadline);
      validateRecordIdentity(openedIdentity, platform, expectedUid, maxRecordBytes);
      const openedRecordWindowsIdentity =
        platform === 'win32'
          ? await validateWindowsTrust(
              dependencies?.windowsPathTrust,
              physicalRecordPath,
              'record',
              deadline,
            )
          : undefined;
      validateStableIdentity(
        initialIdentity,
        openedIdentity,
        recordWindowsIdentity,
        openedRecordWindowsIdentity,
        'Cave discovery record changed while it was being opened.',
      );

      const buffer = Buffer.alloc(maxRecordBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await awaitStep(
          () => handle.read(buffer, offset, buffer.length - offset, null),
          deadline,
        );
        if (
          !Number.isSafeInteger(bytesRead) ||
          bytesRead < 0 ||
          bytesRead > buffer.length - offset
        ) {
          return fail('invalid_response', 'Cave discovery record could not be read safely.');
        }
        if (bytesRead === 0) {
          break;
        }
        offset += bytesRead;
      }

      if (offset > maxRecordBytes) {
        return fail('body_limit', 'Cave discovery record exceeded its size limit.');
      }

      serialized = decodeJson(buffer.subarray(0, offset));
    } catch (error) {
      primaryError = toDiscoveryError(error, 'unsafe_endpoint');
    }

    const closePromise = closeHandle(handle);
    try {
      await awaitStep(() => closePromise, deadline);
    } catch (error) {
      if (primaryError === undefined) {
        throw toDiscoveryError(error, 'unsafe_endpoint');
      }
    }

    if (primaryError !== undefined) {
      throw primaryError;
    }
    if (serialized === undefined) {
      return fail('invalid_response', 'Cave discovery record could not be read safely.');
    }

    const currentRecordIdentity = await awaitStep(
      () => lstat(physicalRecordPath),
      deadline,
    );
    validateRecordIdentity(
      currentRecordIdentity,
      platform,
      expectedUid,
      maxRecordBytes,
    );
    const currentRecordWindowsIdentity =
      platform === 'win32'
        ? await validateWindowsTrust(
            dependencies?.windowsPathTrust,
            physicalRecordPath,
            'record',
            deadline,
          )
        : undefined;
    validateStableIdentity(
      initialIdentity,
      currentRecordIdentity,
      recordWindowsIdentity,
      currentRecordWindowsIdentity,
      'Cave discovery record changed while it was being read.',
    );

    const currentRootIdentity = await awaitStep(() => lstat(physicalRoot), deadline);
    validateRootIdentity(currentRootIdentity, platform, expectedUid);
    const currentRootWindowsIdentity =
      platform === 'win32'
        ? await validateWindowsTrust(
            dependencies?.windowsPathTrust,
            physicalRoot,
            'root',
            deadline,
          )
        : undefined;
    if (
      (await awaitStep(() => realpath(physicalRoot), deadline)) !== physicalRoot
    ) {
      return fail('unsafe_endpoint', 'Cave discovery root changed while the record was read.');
    }
    validateStableIdentity(
      rootIdentity,
      currentRootIdentity,
      rootWindowsIdentity,
      currentRootWindowsIdentity,
      'Cave discovery root changed while the record was read.',
    );

    return parseRecord(serialized, isProcessAlive, {
      path: physicalRecordPath,
      device: initialIdentity.device,
      inode: initialIdentity.inode,
    });
  } catch (error) {
    throw toDiscoveryError(error, isNotFound(error) ? 'not_found' : 'unsafe_endpoint');
  }
}
