import { constants as fsConstants, type Stats } from 'node:fs';
import {
  lstat as nodeLstat,
  open as nodeOpen,
  realpath as nodeRealpath,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import {
  runOperation,
  type OperationOptions,
} from '@opencoven/sdk-core';

const CAVE_DISCOVERY_FILE = 'client-v1-discovery.json';
const DEFAULT_DISCOVERY_TIMEOUT_MS = 2_000;
const MAX_DISCOVERY_BYTES = 16 * 1024;
const CAVE_DISCOVERY_ERROR_BRAND = Symbol.for(
  '@opencoven/cave-client/CaveDiscoveryError',
);

export interface CaveDiscoveryRecord {
  version: 1;
  endpoint: string;
  pid: number;
  nonce: string;
  startedAt: string;
}

export interface ParseCaveDiscoveryRecordOptions {
  isProcessAlive?: (pid: number) => boolean;
}

export type CaveDiscoveryErrorCode =
  | 'body_limit'
  | 'malformed_record'
  | 'not_found'
  | 'owner_mismatch'
  | 'read_failed'
  | 'replaced_record'
  | 'replaced_root'
  | 'stale_process'
  | 'unsafe_endpoint'
  | 'unsafe_mode'
  | 'unsafe_record'
  | 'unsafe_root';

export interface CaveDiscoveryDiagnostics {
  phase:
    | 'parse_record'
    | 'read_record'
    | 'validate_record'
    | 'validate_root';
  limitBytes?: number;
}

export class CaveDiscoveryError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: CaveDiscoveryErrorCode,
    message: string,
    readonly diagnostics: CaveDiscoveryDiagnostics,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CaveDiscoveryError';
    this.retryable =
      code === 'not_found' ||
      code === 'read_failed' ||
      code === 'replaced_record' ||
      code === 'replaced_root' ||
      code === 'stale_process';
    Object.defineProperty(this, CAVE_DISCOVERY_ERROR_BRAND, { value: true });
  }
}

export function isCaveDiscoveryError(
  error: unknown,
): error is CaveDiscoveryError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      error,
      CAVE_DISCOVERY_ERROR_BRAND,
    );
    return (
      descriptor !== undefined &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === true
    );
  } catch {
    return false;
  }
}

export type CaveDiscoverySource =
  | 'coven_cave_home'
  | 'coven_home'
  | 'user_home';

export interface CaveDiscoveredEndpoint extends CaveDiscoveryRecord {
  source: CaveDiscoverySource;
}

export interface CaveDiscoveryFileIdentity {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  directory: boolean;
  regularFile: boolean;
  size: number;
  symbolicLink: boolean;
}

export interface CaveDiscoveryFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
  stat(): Promise<CaveDiscoveryFileIdentity>;
}

export interface CaveDiscoveryDependencies {
  getEffectiveUid?: () => number | undefined;
  getHomeDirectory?: () => string;
  isProcessAlive?: (pid: number) => boolean;
  lstat?: (path: string) => Promise<CaveDiscoveryFileIdentity>;
  openFile?: (
    path: string,
    flags: number,
  ) => Promise<CaveDiscoveryFileHandle>;
  realpath?: (path: string) => Promise<string>;
  windowsFileTrust?: CaveWindowsFileTrustValidator;
}

export interface CaveWindowsFileTrustValidator {
  validate(
    path: string,
    purpose: 'record' | 'root',
  ): boolean | Promise<boolean>;
}

export interface DiscoverCaveOptions extends OperationOptions {
  dependencies?: CaveDiscoveryDependencies;
  env?: Readonly<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function ownErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function discoveryRoot(
  env: Readonly<NodeJS.ProcessEnv>,
  homeDirectory: string,
): { root: string; source: CaveDiscoverySource } {
  if (env.COVEN_CAVE_HOME !== undefined && env.COVEN_CAVE_HOME.length > 0) {
    return {
      root: resolve(env.COVEN_CAVE_HOME),
      source: 'coven_cave_home',
    };
  }

  if (env.COVEN_HOME !== undefined && env.COVEN_HOME.length > 0) {
    return {
      root: resolve(env.COVEN_HOME, 'cave'),
      source: 'coven_home',
    };
  }

  return {
    root: resolve(homeDirectory, '.coven', 'cave'),
    source: 'user_home',
  };
}

function validateUnixOwner(
  actualUid: number,
  expectedUid: number | undefined,
  phase: 'validate_record' | 'validate_root',
): void {
  if (
    expectedUid === undefined ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 0 ||
    actualUid !== expectedUid
  ) {
    throw new CaveDiscoveryError(
      'owner_mismatch',
      'Cave discovery ownership could not be trusted.',
      { phase },
    );
  }
}

async function validateWindowsTrust(
  path: string,
  purpose: 'record' | 'root',
  validator: CaveWindowsFileTrustValidator | undefined,
): Promise<void> {
  const phase = purpose === 'root' ? 'validate_root' : 'validate_record';
  if (validator === undefined || typeof validator.validate !== 'function') {
    throw new CaveDiscoveryError(
      purpose === 'root' ? 'unsafe_root' : 'unsafe_record',
      'Windows ownership validation is required for Cave discovery.',
      { phase },
    );
  }

  if (await validator.validate(path, purpose) !== true) {
    throw new CaveDiscoveryError(
      'owner_mismatch',
      'Cave discovery ownership could not be trusted.',
      { phase },
    );
  }
}

function identityFromStats(stats: Stats): CaveDiscoveryFileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    ownerUid: stats.uid,
    directory: stats.isDirectory(),
    regularFile: stats.isFile(),
    size: stats.size,
    symbolicLink: stats.isSymbolicLink(),
  };
}

async function defaultLstat(path: string): Promise<CaveDiscoveryFileIdentity> {
  return identityFromStats(await nodeLstat(path));
}

async function defaultOpenFile(
  path: string,
  flags: number,
): Promise<CaveDiscoveryFileHandle> {
  const handle = await nodeOpen(path, flags);

  return {
    close: () => handle.close(),
    read: (buffer, offset, length, position) =>
      handle.read(buffer, offset, length, position),
    stat: async () => identityFromStats(await handle.stat()),
  };
}

function validateIdentityShape(
  identity: CaveDiscoveryFileIdentity,
  phase: 'validate_record' | 'validate_root',
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
    typeof identity.directory !== 'boolean' ||
    typeof identity.regularFile !== 'boolean' ||
    typeof identity.symbolicLink !== 'boolean'
  ) {
    throw new CaveDiscoveryError(
      phase === 'validate_root' ? 'unsafe_root' : 'unsafe_record',
      'Cave discovery filesystem identity was invalid.',
      { phase },
    );
  }
}

async function validateIdentity(
  path: string,
  identity: CaveDiscoveryFileIdentity,
  options: {
    effectiveUid: number | undefined;
    phase: 'validate_record' | 'validate_root';
    platform: NodeJS.Platform;
    windowsFileTrust: CaveWindowsFileTrustValidator | undefined;
  },
): Promise<void> {
  validateIdentityShape(identity, options.phase);
  const root = options.phase === 'validate_root';

  if (
    identity.symbolicLink ||
    (root ? !identity.directory : !identity.regularFile)
  ) {
    throw new CaveDiscoveryError(
      root ? 'unsafe_root' : 'unsafe_record',
      root
        ? 'Cave discovery root must be a real directory.'
        : 'Cave discovery record must be a regular file.',
      { phase: options.phase },
    );
  }

  if (options.platform === 'win32') {
    await validateWindowsTrust(
      path,
      root ? 'root' : 'record',
      options.windowsFileTrust,
    );
    return;
  }

  if ((identity.mode & 0o077) !== 0) {
    throw new CaveDiscoveryError(
      'unsafe_mode',
      root
        ? 'Cave discovery root permissions are not owner-only.'
        : 'Cave discovery record permissions are not owner-only.',
      { phase: options.phase },
    );
  }

  validateUnixOwner(identity.ownerUid, options.effectiveUid, options.phase);
}

function sameIdentity(
  left: CaveDiscoveryFileIdentity,
  right: CaveDiscoveryFileIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function openFlags(platform: NodeJS.Platform): number {
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

function decodeRecord(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CaveDiscoveryError(
      'malformed_record',
      'Cave discovery record must be valid UTF-8.',
      { phase: 'parse_record' },
    );
  }
}

async function readRecord(
  path: string,
  expected: CaveDiscoveryFileIdentity,
  openFile: NonNullable<CaveDiscoveryDependencies['openFile']>,
  platform: NodeJS.Platform,
  signal: AbortSignal,
): Promise<string> {
  if (expected.size > MAX_DISCOVERY_BYTES) {
    throw new CaveDiscoveryError(
      'body_limit',
      'Cave discovery record exceeded its size limit.',
      { phase: 'read_record', limitBytes: MAX_DISCOVERY_BYTES },
    );
  }

  signal.throwIfAborted();
  const handle = await openFile(path, openFlags(platform));
  try {
    signal.throwIfAborted();
    const opened = await handle.stat();
    signal.throwIfAborted();
    validateIdentityShape(opened, 'validate_record');
    if (!sameIdentity(expected, opened)) {
      throw new CaveDiscoveryError(
        'replaced_record',
        'Cave discovery record changed while it was being opened.',
        { phase: 'validate_record' },
      );
    }

    const buffer = Buffer.alloc(MAX_DISCOVERY_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      signal.throwIfAborted();
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > buffer.length - offset
      ) {
        throw new CaveDiscoveryError(
          'read_failed',
          'Cave discovery record could not be read safely.',
          { phase: 'read_record' },
        );
      }
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }

    if (offset > MAX_DISCOVERY_BYTES) {
      throw new CaveDiscoveryError(
        'body_limit',
        'Cave discovery record exceeded its size limit.',
        { phase: 'read_record', limitBytes: MAX_DISCOVERY_BYTES },
      );
    }

    const afterRead = await handle.stat();
    signal.throwIfAborted();
    if (!sameIdentity(opened, afterRead)) {
      throw new CaveDiscoveryError(
        'replaced_record',
        'Cave discovery record changed while it was being read.',
        { phase: 'validate_record' },
      );
    }

    return decodeRecord(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

export async function discoverCave(
  options: DiscoverCaveOptions = {},
): Promise<CaveDiscoveredEndpoint> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;

  return runOperation(
    { system: 'cave', operation: 'discover' },
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs,
      ...(options.observer === undefined ? {} : { observer: options.observer }),
    },
    async (context) => {
      let failurePhase: CaveDiscoveryDiagnostics['phase'] = 'validate_root';

      try {
        const { root, source } = discoveryRoot(
          options.env ?? process.env,
          options.dependencies?.getHomeDirectory?.() ?? homedir(),
        );
        const platform = options.platform ?? process.platform;
        const lstat = options.dependencies?.lstat ?? defaultLstat;
        const openFile = options.dependencies?.openFile ?? defaultOpenFile;
        const realpath = options.dependencies?.realpath ?? nodeRealpath;
        const getEffectiveUid =
          options.dependencies?.getEffectiveUid ??
          (() => process.geteuid?.());
        const effectiveUid = getEffectiveUid();
        context.signal.throwIfAborted();
        const configuredIdentity = await lstat(root);
        context.signal.throwIfAborted();
        validateIdentityShape(configuredIdentity, 'validate_root');
        if (configuredIdentity.symbolicLink || !configuredIdentity.directory) {
          throw new CaveDiscoveryError(
            'unsafe_root',
            'Cave discovery root must be a real directory.',
            { phase: 'validate_root' },
          );
        }

        const physicalRoot = await realpath(root);
        context.signal.throwIfAborted();
        if (physicalRoot !== root) {
          throw new CaveDiscoveryError(
            'unsafe_root',
            'Cave discovery root must not resolve through a symbolic link.',
            { phase: 'validate_root' },
          );
        }
        const rootIdentity = await lstat(physicalRoot);
        context.signal.throwIfAborted();
        await validateIdentity(physicalRoot, rootIdentity, {
          effectiveUid,
          phase: 'validate_root',
          platform,
          windowsFileTrust: options.dependencies?.windowsFileTrust,
        });
        context.signal.throwIfAborted();

        failurePhase = 'validate_record';
        const recordPath = resolve(physicalRoot, CAVE_DISCOVERY_FILE);
        const recordIdentity = await lstat(recordPath);
        context.signal.throwIfAborted();
        await validateIdentity(recordPath, recordIdentity, {
          effectiveUid,
          phase: 'validate_record',
          platform,
          windowsFileTrust: options.dependencies?.windowsFileTrust,
        });
        context.signal.throwIfAborted();

        failurePhase = 'read_record';
        const serialized = await readRecord(
          recordPath,
          recordIdentity,
          openFile,
          platform,
          context.signal,
        );
        context.signal.throwIfAborted();

        failurePhase = 'validate_record';
        const currentRecordIdentity = await lstat(recordPath);
        context.signal.throwIfAborted();
        await validateIdentity(recordPath, currentRecordIdentity, {
          effectiveUid,
          phase: 'validate_record',
          platform,
          windowsFileTrust: options.dependencies?.windowsFileTrust,
        });
        context.signal.throwIfAborted();
        if (!sameIdentity(recordIdentity, currentRecordIdentity)) {
          throw new CaveDiscoveryError(
            'replaced_record',
            'Cave discovery record changed while it was being read.',
            { phase: 'validate_record' },
          );
        }

        failurePhase = 'validate_root';
        const currentRootIdentity = await lstat(physicalRoot);
        context.signal.throwIfAborted();
        await validateIdentity(physicalRoot, currentRootIdentity, {
          effectiveUid,
          phase: 'validate_root',
          platform,
          windowsFileTrust: options.dependencies?.windowsFileTrust,
        });
        context.signal.throwIfAborted();
        const currentPhysicalRoot = await realpath(physicalRoot);
        context.signal.throwIfAborted();
        if (
          !sameIdentity(rootIdentity, currentRootIdentity) ||
          currentPhysicalRoot !== physicalRoot
        ) {
          throw new CaveDiscoveryError(
            'replaced_root',
            'Cave discovery root changed while the record was being read.',
            { phase: 'validate_root' },
          );
        }

        failurePhase = 'parse_record';
        let parsed: unknown;
        try {
          parsed = JSON.parse(serialized) as unknown;
        } catch {
          throw new CaveDiscoveryError(
            'malformed_record',
            'Cave discovery record must contain valid JSON.',
            { phase: 'parse_record' },
          );
        }
        context.signal.throwIfAborted();
        const record = parseCaveDiscoveryRecord(parsed, {
          isProcessAlive:
            options.dependencies?.isProcessAlive ?? processIsAlive,
        });

        return {
          ...record,
          source,
        };
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof CaveDiscoveryError) {
          throw error;
        }

        const notFound = ownErrorCode(error) === 'ENOENT';
        throw new CaveDiscoveryError(
          notFound ? 'not_found' : 'read_failed',
          notFound
            ? 'Cave discovery location was not found.'
            : 'Cave discovery could not be completed safely.',
          { phase: failurePhase },
          { cause: error },
        );
      }
    },
  );
}

type JsonObject = Record<string, unknown>;

function malformed(message: string): never {
  throw new CaveDiscoveryError(
    'malformed_record',
    message,
    { phase: 'parse_record' },
  );
}

function parseRecordObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return malformed('Cave discovery record must be a plain object.');
  }

  let prototype: object | null;
  let keys: (string | symbol)[];

  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    keys = Reflect.ownKeys(value);
  } catch {
    return malformed('Cave discovery record could not be inspected safely.');
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return malformed('Cave discovery record must be a plain object.');
  }

  const allowed = new Set(['version', 'endpoint', 'pid', 'nonce', 'startedAt']);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      return malformed('Cave discovery record contains an unexpected field.');
    }
  }

  return value as JsonObject;
}

function dataField(record: JsonObject, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;

  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    return malformed('Cave discovery record could not be inspected safely.');
  }

  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    return malformed('Cave discovery record fields must be JSON-safe data.');
  }

  return descriptor.value;
}

function containsControlCharacter(value: string): boolean {
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

function validTimestamp(value: string): boolean {
  const timestampPattern =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
  const match = timestampPattern.exec(value);
  const parsed = Date.parse(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDayOfMonth =
    month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;

  return (
    !containsControlCharacter(value) &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    day >= 1 &&
    day <= lastDayOfMonth
  );
}

function parseEndpoint(value: string): string {
  if (containsControlCharacter(value) || /%(?:2f|5c)/iu.test(value)) {
    throw new CaveDiscoveryError(
      'unsafe_endpoint',
      'Cave discovery endpoint must be a path-free loopback HTTP URL.',
      { phase: 'parse_record' },
    );
  }

  const match = /^http:\/\/(\[[^\]]+\]|[^/?#:@\\]+):([0-9]{1,5})\/?$/iu.exec(value);
  const rawPort = match?.[2];

  if (rawPort === undefined) {
    throw new CaveDiscoveryError(
      'unsafe_endpoint',
      'Cave discovery endpoint must be a path-free loopback HTTP URL.',
      { phase: 'parse_record' },
    );
  }

  const port = Number(rawPort);
  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch {
    throw new CaveDiscoveryError(
      'unsafe_endpoint',
      'Cave discovery endpoint must be a loopback HTTP URL.',
      { phase: 'parse_record' },
    );
  }

  if (
    endpoint.protocol !== 'http:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    endpoint.pathname !== '/' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    (endpoint.hostname !== '127.0.0.1' &&
      endpoint.hostname !== 'localhost' &&
      endpoint.hostname !== '[::1]')
  ) {
    throw new CaveDiscoveryError(
      'unsafe_endpoint',
      'Cave discovery endpoint must be a loopback HTTP URL.',
      { phase: 'parse_record' },
    );
  }

  return value;
}

export function parseCaveDiscoveryRecord(
  value: unknown,
  options: ParseCaveDiscoveryRecordOptions = {},
): CaveDiscoveryRecord {
  const record = parseRecordObject(value);
  const version = dataField(record, 'version');
  const endpoint = dataField(record, 'endpoint');
  const rawPid = dataField(record, 'pid');
  const nonce = dataField(record, 'nonce');
  const startedAt = dataField(record, 'startedAt');

  if (
    version !== 1 ||
    typeof endpoint !== 'string' ||
    !Number.isSafeInteger(rawPid) ||
    (rawPid as number) < 1 ||
    typeof nonce !== 'string' ||
    nonce.trim().length === 0 ||
    nonce.length > 256 ||
    containsControlCharacter(nonce) ||
    typeof startedAt !== 'string' ||
    !validTimestamp(startedAt)
  ) {
    return malformed('Cave discovery record is invalid.');
  }

  const pid = rawPid as number;
  if (options.isProcessAlive?.(pid) === false) {
    throw new CaveDiscoveryError(
      'stale_process',
      'Cave discovery process is not alive.',
      { phase: 'parse_record' },
    );
  }

  return {
    version: 1,
    endpoint: parseEndpoint(endpoint),
    pid,
    nonce,
    startedAt,
  };
}
