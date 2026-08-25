import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  createSecretStoreReference,
  type SecretStoreReference,
} from './secret-store.js';

const PROFILE_KEYS = new Set([
  'version',
  'name',
  'caveHome',
  'covenHome',
  'defaultFamiliarId',
  'defaultProjectId',
]);
const PROFILE_NAME_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u;
const PROFILE_VALUE_MAX_CHARACTERS = 4_096;
const PROFILE_DOCUMENT_MAX_PROFILES = 64;
const PROFILE_DOCUMENT_MAX_BYTES = 64 * 1024;
const PROFILE_FILE_MODE = 0o600;
const PROFILE_DIRECTORY_MODE_MASK = 0o077;
const profileQueues = new Map<string, Promise<void>>();

export const OPENCOVEN_PROFILE_VERSION = 1;

export interface OpenCovenProfile {
  readonly version: 1;
  readonly name: string;
  readonly caveHome?: string;
  readonly covenHome?: string;
  readonly defaultFamiliarId?: string;
  readonly defaultProjectId?: string;
}

export interface OpenCovenProfileDocument {
  readonly version: 1;
  readonly profiles: readonly OpenCovenProfile[];
}

export interface OpenCovenProfileStore {
  list(): Promise<readonly OpenCovenProfile[]>;
  get(name: string): Promise<OpenCovenProfile | undefined>;
  set(profile: OpenCovenProfile): Promise<void>;
  delete(name: string): Promise<boolean>;
  reset(): Promise<void>;
}

export interface FileOpenCovenProfileStoreOptions {
  readonly path: string;
}

export type OpenCovenProfileErrorCode =
  | 'corrupt_profile_store'
  | 'invalid_profile'
  | 'invalid_profile_store_path'
  | 'profile_platform_security_unavailable'
  | 'profile_store_read_failed'
  | 'profile_store_write_failed'
  | 'unsafe_profile_store';

export class OpenCovenProfileError extends Error {
  readonly code: OpenCovenProfileErrorCode;
  readonly retryable = false;

  constructor(code: OpenCovenProfileErrorCode, message: string) {
    super(message);
    this.name = 'OpenCovenProfileError';
    this.code = code;
  }
}

function invalidProfile(message: string): OpenCovenProfileError {
  return new OpenCovenProfileError('invalid_profile', message);
}

function profileStoreError(
  code: OpenCovenProfileErrorCode,
  message: string,
): OpenCovenProfileError {
  return new OpenCovenProfileError(code, message);
}

function ownDataObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalidProfile(`${label} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== 'string' ||
        descriptors[key] === undefined ||
        !Object.hasOwn(descriptors[key], 'value'),
    )
  ) {
    throw invalidProfile(`${label} must contain only data properties.`);
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      descriptor.value,
    ]),
  );
}

function ownDataArray(
  value: unknown,
  label: string,
  maximumLength: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw invalidProfile(`${label} was malformed.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(
    value,
    'length',
  );
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some((key) => typeof key !== 'string') ||
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, 'value')
  ) {
    throw invalidProfile(`${label} must contain only data entries.`);
  }
  return Object.freeze(
    Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw invalidProfile(
          `${label} must contain only data entries.`,
        );
      }
      const entry: unknown = descriptor.value;
      return entry;
    }),
  );
}

function compareProfileNames(
  left: OpenCovenProfile,
  right: OpenCovenProfile,
): number {
  return left.name < right.name
    ? -1
    : left.name > right.name
      ? 1
      : 0;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > PROFILE_VALUE_MAX_CHARACTERS ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint <= 0x1f;
    })
  ) {
    throw invalidProfile(`${label} was malformed.`);
  }
  return value;
}

function optionalAbsolutePath(
  value: unknown,
  label: string,
): string | undefined {
  const path = optionalString(value, label);
  if (path !== undefined && !isAbsolute(path)) {
    throw invalidProfile(`${label} must be absolute.`);
  }
  return path;
}

export function parseOpenCovenProfile(value: unknown): OpenCovenProfile {
  const profile = ownDataObject(value, 'OpenCoven profile');
  if (
    Object.keys(profile).some((key) => !PROFILE_KEYS.has(key)) ||
    profile.version !== OPENCOVEN_PROFILE_VERSION ||
    typeof profile.name !== 'string' ||
    !PROFILE_NAME_RE.test(profile.name)
  ) {
    throw invalidProfile('OpenCoven profile was malformed.');
  }
  const caveHome = optionalAbsolutePath(profile.caveHome, 'caveHome');
  const covenHome = optionalAbsolutePath(profile.covenHome, 'covenHome');
  const defaultFamiliarId = optionalString(
    profile.defaultFamiliarId,
    'defaultFamiliarId',
  );
  const defaultProjectId = optionalString(
    profile.defaultProjectId,
    'defaultProjectId',
  );

  return Object.freeze({
    version: OPENCOVEN_PROFILE_VERSION,
    name: profile.name,
    ...(caveHome === undefined ? {} : { caveHome }),
    ...(covenHome === undefined ? {} : { covenHome }),
    ...(defaultFamiliarId === undefined ? {} : { defaultFamiliarId }),
    ...(defaultProjectId === undefined ? {} : { defaultProjectId }),
  });
}

function parseProfileArray(
  value: unknown,
  version: 0 | 1,
): readonly OpenCovenProfile[] {
  const entries = ownDataArray(
    value,
    'OpenCoven profile array',
    PROFILE_DOCUMENT_MAX_PROFILES,
  );
  const profiles = entries.map((entry) => {
    if (version === 1) {
      return parseOpenCovenProfile(entry);
    }
    const legacy = ownDataObject(entry, 'Legacy OpenCoven profile');
    if (Object.hasOwn(legacy, 'version')) {
      throw invalidProfile('Legacy OpenCoven profile was malformed.');
    }
    return parseOpenCovenProfile({
      ...legacy,
      version: OPENCOVEN_PROFILE_VERSION,
    });
  });
  const names = profiles.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw invalidProfile(
      'OpenCoven profile document contained duplicate names.',
    );
  }
  return Object.freeze([...profiles].sort(compareProfileNames));
}

export function migrateOpenCovenProfileDocument(
  value: unknown,
): OpenCovenProfileDocument {
  const document = ownDataObject(value, 'OpenCoven profile document');
  if (
    Object.keys(document).length !== 2 ||
    !Object.hasOwn(document, 'version') ||
    !Object.hasOwn(document, 'profiles') ||
    (document.version !== 0 &&
      document.version !== OPENCOVEN_PROFILE_VERSION)
  ) {
    throw invalidProfile('OpenCoven profile document was malformed.');
  }
  return Object.freeze({
    version: OPENCOVEN_PROFILE_VERSION,
    profiles: parseProfileArray(document.profiles, document.version),
  });
}

export function createMemoryOpenCovenProfileStore(
  initial: unknown = {
    version: OPENCOVEN_PROFILE_VERSION,
    profiles: [],
  },
): OpenCovenProfileStore {
  let profiles = new Map(
    migrateOpenCovenProfileDocument(initial).profiles.map((profile) => [
      profile.name,
      profile,
    ]),
  );

  return Object.freeze({
    list(): Promise<readonly OpenCovenProfile[]> {
      return Promise.resolve(
        Object.freeze(
          [...profiles.values()].sort((left, right) =>
            compareProfileNames(left, right),
          ),
        ),
      );
    },
    get(name: string): Promise<OpenCovenProfile | undefined> {
      createOpenCovenProfileSecretReference(name);
      return Promise.resolve(profiles.get(name));
    },
    set(profile: OpenCovenProfile): Promise<void> {
      const parsed = parseOpenCovenProfile(profile);
      profiles.set(parsed.name, parsed);
      return Promise.resolve();
    },
    delete(name: string): Promise<boolean> {
      createOpenCovenProfileSecretReference(name);
      return Promise.resolve(profiles.delete(name));
    },
    reset(): Promise<void> {
      profiles = new Map();
      return Promise.resolve();
    },
  });
}

interface ProfileFileIdentity {
  device: number | bigint;
  inode: number | bigint;
}

function isNodeError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function validateProfileParent(path: string): Promise<void> {
  if (process.platform === 'win32') {
    throw profileStoreError(
      'profile_platform_security_unavailable',
      'Native Windows profile path security is unavailable.',
    );
  }
  const parent = dirname(path);
  try {
    const [metadata, canonical] = await Promise.all([
      lstat(parent),
      realpath(parent),
    ]);
    const uid = process.getuid?.();
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      canonical !== parent ||
      uid === undefined ||
      metadata.uid !== uid ||
      (metadata.mode & PROFILE_DIRECTORY_MODE_MASK) !== 0
    ) {
      throw profileStoreError(
        'unsafe_profile_store',
        'OpenCoven profile directory was not owner-private.',
      );
    }
  } catch (error) {
    if (error instanceof OpenCovenProfileError) {
      throw error;
    }
    throw profileStoreError(
      'unsafe_profile_store',
      'OpenCoven profile directory could not be validated safely.',
    );
  }
}

function fileIdentity(
  metadata: Awaited<ReturnType<FileHandle['stat']>>,
): ProfileFileIdentity {
  return {
    device: metadata.dev,
    inode: metadata.ino,
  };
}

function sameIdentity(
  left: ProfileFileIdentity,
  right: ProfileFileIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function validateProfileFile(
  path: string,
): Promise<ProfileFileIdentity | undefined> {
  try {
    const metadata = await lstat(path);
    const uid = process.getuid?.();
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      uid === undefined ||
      metadata.uid !== uid ||
      (metadata.mode & 0o777) !== PROFILE_FILE_MODE ||
      metadata.size > PROFILE_DOCUMENT_MAX_BYTES ||
      metadata.dev < 0 ||
      metadata.ino <= 0
    ) {
      throw profileStoreError(
        'unsafe_profile_store',
        'OpenCoven profile file was not owner-private.',
      );
    }
    return fileIdentity(metadata);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    if (error instanceof OpenCovenProfileError) {
      throw error;
    }
    throw profileStoreError(
      'unsafe_profile_store',
      'OpenCoven profile file could not be validated safely.',
    );
  }
}

async function openValidatedProfileFile(
  path: string,
  expected: ProfileFileIdentity,
): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > PROFILE_DOCUMENT_MAX_BYTES ||
      !sameIdentity(fileIdentity(opened), expected)
    ) {
      throw profileStoreError(
        'unsafe_profile_store',
        'OpenCoven profile file changed during validation.',
      );
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof OpenCovenProfileError) {
      throw error;
    }
    throw profileStoreError(
      'profile_store_read_failed',
      'OpenCoven profile file could not be read.',
    );
  }
}

async function readBoundedProfileFile(
  handle: FileHandle,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(PROFILE_DOCUMENT_MAX_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  if (offset > PROFILE_DOCUMENT_MAX_BYTES) {
    throw profileStoreError(
      'unsafe_profile_store',
      'OpenCoven profile file exceeded its size limit while read.',
    );
  }
  return buffer.subarray(0, offset);
}

function emptyProfileDocument(): OpenCovenProfileDocument {
  return Object.freeze({
    version: OPENCOVEN_PROFILE_VERSION,
    profiles: Object.freeze([]),
  });
}

async function readProfileDocument(
  path: string,
): Promise<{
  document: OpenCovenProfileDocument;
  migrated: boolean;
}> {
  await validateProfileParent(path);
  const expected = await validateProfileFile(path);
  if (expected === undefined) {
    return { document: emptyProfileDocument(), migrated: false };
  }
  const handle = await openValidatedProfileFile(path, expected);
  let bytes: Buffer;
  try {
    bytes = await readBoundedProfileFile(handle);
  } catch (error) {
    if (error instanceof OpenCovenProfileError) {
      throw error;
    }
    throw profileStoreError(
      'profile_store_read_failed',
      'OpenCoven profile file could not be read.',
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
  await validateProfileParent(path);
  const after = await validateProfileFile(path);
  if (after === undefined || !sameIdentity(expected, after)) {
    throw profileStoreError(
      'unsafe_profile_store',
      'OpenCoven profile file changed while it was read.',
    );
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const raw: unknown = JSON.parse(text);
    const document = migrateOpenCovenProfileDocument(raw);
    const rawObject = ownDataObject(raw, 'OpenCoven profile document');
    return {
      document,
      migrated: rawObject.version === 0,
    };
  } catch {
    throw profileStoreError(
      'corrupt_profile_store',
      'OpenCoven profile data was corrupt and requires explicit reset.',
    );
  }
}

async function writeProfileDocument(
  path: string,
  document: OpenCovenProfileDocument,
): Promise<void> {
  await validateProfileParent(path);
  await validateProfileFile(path);
  const payload = `${JSON.stringify(document)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > PROFILE_DOCUMENT_MAX_BYTES) {
    throw profileStoreError(
      'invalid_profile',
      'OpenCoven profile document exceeded its size limit.',
    );
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      PROFILE_FILE_MODE,
    );
    await handle.chmod(PROFILE_FILE_MODE);
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
    const expected = fileIdentity(await handle.stat());
    const temporary = await validateProfileFile(temporaryPath);
    if (
      temporary === undefined ||
      !sameIdentity(expected, temporary)
    ) {
      throw profileStoreError(
        'unsafe_profile_store',
        'OpenCoven temporary profile file changed before commit.',
      );
    }
    await rename(temporaryPath, path);
    const directory = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    await validateProfileParent(path);
    const committed = await validateProfileFile(path);
    if (
      committed === undefined ||
      !sameIdentity(expected, committed)
    ) {
      throw profileStoreError(
        'unsafe_profile_store',
        'OpenCoven profile file changed during commit.',
      );
    }
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    if (error instanceof OpenCovenProfileError) {
      throw error;
    }
    throw profileStoreError(
      'profile_store_write_failed',
      'OpenCoven profile file could not be written.',
    );
  }
}

async function withProfileQueue<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = profileQueues.get(path) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolvePending) => {
    release = resolvePending;
  });
  const tail = previous.catch(() => undefined).then(() => pending);
  profileQueues.set(path, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release?.();
    if (profileQueues.get(path) === tail) {
      profileQueues.delete(path);
    }
  }
}

export function createFileOpenCovenProfileStore(
  options: FileOpenCovenProfileStoreOptions,
): OpenCovenProfileStore {
  let values: Record<string, unknown>;
  try {
    values = ownDataObject(
      options,
      'OpenCoven file profile store options',
    );
  } catch {
    throw profileStoreError(
      'invalid_profile_store_path',
      'OpenCoven profile file path must be canonical and absolute.',
    );
  }
  if (
    Object.keys(values).length !== 1 ||
    typeof values.path !== 'string' ||
    values.path.length === 0 ||
    !isAbsolute(values.path) ||
    resolve(values.path) !== values.path
  ) {
    throw profileStoreError(
      'invalid_profile_store_path',
      'OpenCoven profile file path must be canonical and absolute.',
    );
  }
  const path = values.path;

  const load = async (): Promise<OpenCovenProfileDocument> => {
    const result = await readProfileDocument(path);
    if (result.migrated) {
      await writeProfileDocument(path, result.document);
    }
    return result.document;
  };

  return Object.freeze({
    list(): Promise<readonly OpenCovenProfile[]> {
      return withProfileQueue(path, async () => (await load()).profiles);
    },
    get(name: string): Promise<OpenCovenProfile | undefined> {
      createOpenCovenProfileSecretReference(name);
      return withProfileQueue(path, async () =>
        (await load()).profiles.find((profile) => profile.name === name),
      );
    },
    set(profile: OpenCovenProfile): Promise<void> {
      const parsed = parseOpenCovenProfile(profile);
      return withProfileQueue(path, async () => {
        const current = await load();
        const next = new Map(
          current.profiles.map((entry) => [entry.name, entry]),
        );
        next.set(parsed.name, parsed);
        const profiles = [...next.values()].sort(compareProfileNames);
        await writeProfileDocument(
          path,
          migrateOpenCovenProfileDocument({
            version: OPENCOVEN_PROFILE_VERSION,
            profiles,
          }),
        );
      });
    },
    delete(name: string): Promise<boolean> {
      createOpenCovenProfileSecretReference(name);
      return withProfileQueue(path, async () => {
        const current = await load();
        const profiles = current.profiles.filter(
          (profile) => profile.name !== name,
        );
        if (profiles.length === current.profiles.length) {
          return false;
        }
        await writeProfileDocument(
          path,
          migrateOpenCovenProfileDocument({
            version: OPENCOVEN_PROFILE_VERSION,
            profiles,
          }),
        );
        return true;
      });
    },
    reset(): Promise<void> {
      return withProfileQueue(path, async () => {
        await writeProfileDocument(path, emptyProfileDocument());
      });
    },
  });
}

export function createOpenCovenProfileSecretReference(
  profileName: string,
): SecretStoreReference {
  if (
    typeof profileName !== 'string' ||
    !PROFILE_NAME_RE.test(profileName)
  ) {
    throw invalidProfile('OpenCoven profile name was malformed.');
  }
  return createSecretStoreReference(
    `opencoven.profile.${profileName}.cave`,
  );
}
