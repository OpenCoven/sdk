import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat as nodeLstat, open as nodeOpen, realpath as nodeRealpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import {
  isOperationAbortedError,
  isOperationTimeoutError,
  type OperationOptions,
} from '@opencoven/sdk-core';
import {
  CaveDiscoveryError,
  isCaveDiscoveryError,
  parseCaveDiscoveryRecord,
  type CaveDiscoveryErrorCode,
} from './discovery-record.js';
export {
  CaveDiscoveryError,
  isCaveDiscoveryError,
} from './discovery-record.js';
export type { CaveDiscoveryErrorCode } from './discovery-record.js';

const DISCOVERY_FILE_NAME = 'client-v1-discovery.json';
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_RECORD_BYTES = 16 * 1024;

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
  validateOpenedFile?(
    handle: CaveDiscoveryFileHandle,
    path: string,
    purpose: 'record',
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
  version: 1;
  endpoint: {
    kind: 'http';
    url: string;
  };
  freshness: CaveEndpointFreshness;
  record: CaveDiscoveryRecordIdentity;
}

interface DiscoveryDeadline {
  expiresAt: number | undefined;
  signal: AbortSignal | undefined;
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

async function validateWindowsOpenedFileTrust(
  validator: CaveWindowsPathTrustValidator | undefined,
  handle: CaveDiscoveryFileHandle,
  path: string,
  deadline: DiscoveryDeadline,
): Promise<string> {
  if (
    validator === undefined ||
    typeof validator.validateOpenedFile !== 'function'
  ) {
    return fail(
      'owner_mismatch',
      'Windows Cave discovery opened-file identity validation is required.',
    );
  }
  const validateOpenedFile = validator.validateOpenedFile.bind(validator);

  const identity = await validateWindowsTrust(
    {
      validate: () => validateOpenedFile(handle, path, 'record'),
    },
    path,
    'record',
    deadline,
  );
  if (identity === undefined) {
    return fail(
      'owner_mismatch',
      'Windows Cave discovery opened-file identity validation is required.',
    );
  }
  return identity;
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
        platform === 'win32' &&
        (initialIdentity.device === 0 || initialIdentity.inode === 0)
          ? await validateWindowsOpenedFileTrust(
              dependencies?.windowsPathTrust,
              handle,
              physicalRecordPath,
              deadline,
            )
          : recordWindowsIdentity;
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

    return {
      ...parseCaveDiscoveryRecord(serialized, isProcessAlive),
      record: {
        path: physicalRecordPath,
        device: initialIdentity.device,
        inode: initialIdentity.inode,
      },
    };
  } catch (error) {
    throw toDiscoveryError(error, isNotFound(error) ? 'not_found' : 'unsafe_endpoint');
  }
}
