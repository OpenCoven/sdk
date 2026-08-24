import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { SecretStore } from '@opencoven/sdk-core';

import { NATIVE_SECRET_STORE_SERVICE } from './credentials.js';

export type SecureStoreUnavailableOperation = 'load' | 'construct' | 'get' | 'set' | 'delete' | 'probe';

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): void;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

const NATIVE_SECRET_STORE_BRAND = Symbol.for('@opencoven/dev-cli/native-secret-store');
const SECRET_STORE_LOGICAL_ID = Symbol.for('@opencoven/sdk-core/secret-store-logical-id');
const NATIVE_SECRET_STORE_PROBE_ACCOUNT = 'opencoven.cli.secure-store.probe';
const NATIVE_SECRET_STORE_LOCK_TIMEOUT_MS = 5_000;
const NATIVE_SECRET_STORE_LOCK_RETRY_MS = 25;
const NATIVE_SECRET_STORE_STALE_LOCK_MS = 30_000;
const NATIVE_SECRET_STORE_LOCK_OWNER_FILE = 'owner.json';

export interface NativeSecretStoreOptions {
  lockDirectory?: string;
  loadModule?: () => Promise<KeyringModule>;
  service?: string;
}

interface NativeSecretStoreLockOwner {
  version: 1;
  pid: number;
  token: string;
  createdAt: number;
}

export class SecureStoreUnavailableError extends Error {
  readonly code = 'secure_store_unavailable';
  readonly retryable = false;
  readonly operation: SecureStoreUnavailableOperation;

  constructor(operation: SecureStoreUnavailableOperation, options?: ErrorOptions) {
    super('Native secure credential storage is unavailable.', options);
    this.name = 'SecureStoreUnavailableError';
    this.operation = operation;
  }
}

function secureStoreUnavailable(
  operation: SecureStoreUnavailableOperation,
  cause: unknown,
): SecureStoreUnavailableError {
  return new SecureStoreUnavailableError(operation, { cause });
}

async function defaultLoadModule(): Promise<KeyringModule> {
  return await import('@napi-rs/keyring');
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  try {
    const code: unknown = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function lockPathFor(lockDirectory: string, service: string, key: string): string {
  const digest = createHash('sha256')
    .update(service)
    .update('\0')
    .update(key)
    .digest('hex');
  return resolve(lockDirectory, `${digest}.lock`);
}

function parseLockOwner(serialized: string): NativeSecretStoreLockOwner | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const owner = parsed as Record<string, unknown>;
  return owner.version === 1 &&
    Number.isSafeInteger(owner.pid) &&
    (owner.pid as number) > 0 &&
    typeof owner.token === 'string' &&
    owner.token.length > 0 &&
    Number.isSafeInteger(owner.createdAt) &&
    (owner.createdAt as number) > 0
    ? {
        version: 1,
        pid: owner.pid as number,
        token: owner.token,
        createdAt: owner.createdAt as number,
      }
    : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}

async function ensureLockDirectory(lockDirectory: string): Promise<void> {
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  const identity = await lstat(lockDirectory);
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new Error('Native secret-store lock root was not a directory.');
  }

  const effectiveUid = process.geteuid?.();
  if (effectiveUid !== undefined && identity.uid !== effectiveUid) {
    throw new Error('Native secret-store lock root ownership was invalid.');
  }
  await chmod(lockDirectory, 0o700);
}

async function recoverAbandonedLock(lockPath: string): Promise<boolean> {
  let identity;
  try {
    identity = await lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return true;
    }
    throw error;
  }

  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new Error('Native secret-store lock path was invalid.');
  }

  let owner: NativeSecretStoreLockOwner | undefined;
  try {
    owner = parseLockOwner(
      await readFile(resolve(lockPath, NATIVE_SECRET_STORE_LOCK_OWNER_FILE), 'utf8'),
    );
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }

  const lockAgeMs = Date.now() - identity.mtimeMs;
  if (
    owner !== undefined &&
    processIsAlive(owner.pid) &&
    lockAgeMs < NATIVE_SECRET_STORE_STALE_LOCK_MS
  ) {
    return false;
  }
  if (
    owner === undefined &&
    lockAgeMs < NATIVE_SECRET_STORE_STALE_LOCK_MS
  ) {
    return false;
  }

  const stalePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EEXIST') {
      return false;
    }
    throw error;
  }
  await rm(stalePath, { force: true, recursive: true });
  return true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function acquireNativeSecretStoreLock(
  lockDirectory: string,
  service: string,
  key: string,
): Promise<() => Promise<void>> {
  await ensureLockDirectory(lockDirectory);
  const lockPath = lockPathFor(lockDirectory, service, key);
  const token = randomUUID();
  const owner: NativeSecretStoreLockOwner = {
    version: 1,
    pid: process.pid,
    token,
    createdAt: Date.now(),
  };
  const deadline = Date.now() + NATIVE_SECRET_STORE_LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(
          resolve(lockPath, NATIVE_SECRET_STORE_LOCK_OWNER_FILE),
          `${JSON.stringify(owner)}\n`,
          { encoding: 'utf8', flag: 'wx', mode: 0o600 },
        );
      } catch (error) {
        await rm(lockPath, { force: true, recursive: true });
        throw error;
      }

      return async () => {
        let current: NativeSecretStoreLockOwner | undefined;
        try {
          current = parseLockOwner(
            await readFile(
              resolve(lockPath, NATIVE_SECRET_STORE_LOCK_OWNER_FILE),
              'utf8',
            ),
          );
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') {
            throw error;
          }
        }

        if (current?.token === token) {
          await rm(lockPath, { force: true, recursive: true });
        }
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error;
      }
    }

    await recoverAbandonedLock(lockPath);
    if (Date.now() >= deadline) {
      throw new Error('Native secret-store lock acquisition timed out.');
    }
    await delay(NATIVE_SECRET_STORE_LOCK_RETRY_MS);
  }
}

class NativeSecretStore implements SecretStore {
  readonly #service: string;
  readonly #Entry: KeyringModule['Entry'];
  readonly #lockDirectory: string;

  constructor(
    service: string,
    Entry: KeyringModule['Entry'],
    lockDirectory: string,
  ) {
    this.#service = service;
    this.#Entry = Entry;
    this.#lockDirectory = lockDirectory;
    Object.defineProperty(this, NATIVE_SECRET_STORE_BRAND, { value: true });
    Object.defineProperty(this, SECRET_STORE_LOGICAL_ID, {
      value: `native:${service}`,
    });
  }

  get(key: string): Promise<string | undefined> {
    try {
      const value = this.#entry(key).getPassword();
      return Promise.resolve(value == null ? undefined : value);
    } catch (error) {
      return Promise.reject(
        error instanceof SecureStoreUnavailableError
          ? error
          : secureStoreUnavailable('get', error),
      );
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.#withMutationLock('set', key, () => {
      this.#entry(key).setPassword(value);
    });
  }

  async delete(key: string): Promise<boolean> {
    return await this.#withMutationLock('delete', key, () => {
      const entry = this.#entry(key);
      const value = entry.getPassword();
      if (value == null) {
        return false;
      }
      entry.deletePassword();
      return true;
    });
  }

  async compareAndDelete(
    key: string,
    expectedValue: string,
  ): Promise<'absent' | 'changed' | 'deleted'> {
    return await this.#withMutationLock('delete', key, () => {
      const entry = this.#entry(key);
      const current = entry.getPassword();
      if (current == null) {
        return 'absent';
      }
      if (current !== expectedValue) {
        return 'changed';
      }

      entry.deletePassword();
      return 'deleted';
    });
  }

  probe(): Promise<void> {
    try {
      this.#entry(NATIVE_SECRET_STORE_PROBE_ACCOUNT).getPassword();
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof SecureStoreUnavailableError
          ? error
          : secureStoreUnavailable('probe', error),
      );
    }
  }

  #entry(key: string): KeyringEntry {
    try {
      return new this.#Entry(this.#service, key);
    } catch (error) {
      throw secureStoreUnavailable('construct', error);
    }
  }

  async #withMutationLock<T>(
    operation: 'set' | 'delete',
    key: string,
    mutation: () => T,
  ): Promise<T> {
    let release: () => Promise<void>;
    try {
      release = await acquireNativeSecretStoreLock(
        this.#lockDirectory,
        this.#service,
        key,
      );
    } catch (error) {
      throw (
        error instanceof SecureStoreUnavailableError
          ? error
          : secureStoreUnavailable(operation, error)
      );
    }

    let outcome:
      | { ok: true; value: T }
      | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: mutation() };
    } catch (error) {
      outcome = { ok: false, error };
    }

    let releaseError: unknown;
    try {
      await release();
    } catch (error) {
      releaseError = error;
    }

    if (!outcome.ok) {
      throw (
        outcome.error instanceof SecureStoreUnavailableError
          ? outcome.error
          : secureStoreUnavailable(operation, outcome.error)
      );
    }
    if (releaseError !== undefined) {
      throw secureStoreUnavailable(operation, releaseError);
    }

    return outcome.value;
  }
}

export async function createNativeSecretStore(
  options: NativeSecretStoreOptions = {},
): Promise<SecretStore> {
  const loadModule = options.loadModule ?? defaultLoadModule;
  const service = options.service ?? NATIVE_SECRET_STORE_SERVICE;
  let keyring: KeyringModule;

  try {
    keyring = await loadModule();
  } catch (error) {
    throw secureStoreUnavailable('load', error);
  }

  const keyringShape = keyring as KeyringModule & { default?: KeyringModule };
  const Entry = typeof keyringShape.Entry === 'function'
    ? keyringShape.Entry
    : typeof keyringShape.default?.Entry === 'function'
      ? keyringShape.default.Entry
      : undefined;

  if (Entry === undefined) {
    throw secureStoreUnavailable('load', new TypeError('Keyring Entry constructor was not available.'));
  }

  const lockDirectory = options.lockDirectory === undefined
    ? resolve(homedir(), '.coven', 'locks', 'credentials')
    : resolve(options.lockDirectory);

  return new NativeSecretStore(
    service,
    Entry,
    lockDirectory,
  );
}

export async function probeNativeSecretStore(store: SecretStore): Promise<void> {
  const probe = (
    typeof store === 'object' &&
    store !== null &&
    typeof Reflect.get(store, 'probe') === 'function'
      ? Reflect.get(store, 'probe')
      : undefined
  ) as ((this: SecretStore) => Promise<void>) | undefined;

  if (probe === undefined) {
    throw secureStoreUnavailable(
      'probe',
      new TypeError('Native secure-store probe API was unavailable.'),
    );
  }

  try {
    await probe.call(store);
  } catch (error) {
    throw (
      error instanceof SecureStoreUnavailableError
        ? error
        : secureStoreUnavailable('probe', error)
    );
  }
}
