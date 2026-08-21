export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface ManagedSecretStore extends SecretStore {
  readonly disposed: boolean;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}

export interface SecretStoreReference {
  readonly key: string;
}

export class InvalidSecretKeyError extends TypeError {
  readonly code = 'invalid_secret_key';
  readonly retryable = false;

  constructor() {
    super('Secret keys must contain non-whitespace characters and be at most 256 characters');
    this.name = 'InvalidSecretKeyError';
  }
}

export class SecretStoreDisposedError extends Error {
  readonly code = 'secret_store_disposed';
  readonly retryable = false;

  constructor() {
    super('Secret store has been disposed');
    this.name = 'SecretStoreDisposedError';
  }
}

function isValidSecretKey(key: string): boolean {
  return key.trim().length > 0 && key.length <= 256;
}

export function createSecretStoreReference(key: string): SecretStoreReference {
  if (!isValidSecretKey(key)) {
    throw new InvalidSecretKeyError();
  }

  return Object.freeze({ key });
}

class MemorySecretStore implements SecretStore {
  readonly #secrets = new Map<string, string>();

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.#secrets.get(key));
  }

  set(key: string, value: string): Promise<void> {
    this.#secrets.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.#secrets.delete(key));
  }
}

class ManagedMemorySecretStore implements ManagedSecretStore {
  readonly #secrets = new Map<string, string>();
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  get(key: string): Promise<string | undefined> {
    const error = this.#operationError(key);
    return error === undefined
      ? Promise.resolve(this.#secrets.get(key))
      : Promise.reject(error);
  }

  set(key: string, value: string): Promise<void> {
    const error = this.#operationError(key);
    if (error !== undefined) {
      return Promise.reject(error);
    }

    this.#secrets.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    const error = this.#operationError(key);
    return error === undefined
      ? Promise.resolve(this.#secrets.delete(key))
      : Promise.reject(error);
  }

  clear(): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new SecretStoreDisposedError());
    }

    this.#secrets.clear();
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    if (!this.#disposed) {
      this.#secrets.clear();
      this.#disposed = true;
    }

    return Promise.resolve();
  }

  #operationError(key: string): Error | undefined {
    if (this.#disposed) {
      return new SecretStoreDisposedError();
    }

    if (!isValidSecretKey(key)) {
      return new InvalidSecretKeyError();
    }

    return undefined;
  }
}

export function createMemorySecretStore(): SecretStore {
  return new MemorySecretStore();
}

export function createManagedMemorySecretStore(): ManagedSecretStore {
  return new ManagedMemorySecretStore();
}
