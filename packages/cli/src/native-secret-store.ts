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
const NATIVE_SECRET_STORE_PROBE_ACCOUNT = 'opencoven.cli.secure-store.probe';

export interface NativeSecretStoreOptions {
  loadModule?: () => Promise<KeyringModule>;
  service?: string;
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

class NativeSecretStore implements SecretStore {
  readonly #service: string;
  readonly #Entry: KeyringModule['Entry'];

  constructor(service: string, Entry: KeyringModule['Entry']) {
    this.#service = service;
    this.#Entry = Entry;
    Object.defineProperty(this, NATIVE_SECRET_STORE_BRAND, { value: true });
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

  set(key: string, value: string): Promise<void> {
    try {
      this.#entry(key).setPassword(value);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof SecureStoreUnavailableError
          ? error
          : secureStoreUnavailable('set', error),
      );
    }
  }

  delete(key: string): Promise<boolean> {
    try {
      const entry = this.#entry(key);
      const value = entry.getPassword();
      if (value == null) {
        return Promise.resolve(false);
      }
      entry.deletePassword();
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(
        error instanceof SecureStoreUnavailableError
          ? error
          : secureStoreUnavailable('delete', error),
      );
    }
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

  return new NativeSecretStore(service, Entry);
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
