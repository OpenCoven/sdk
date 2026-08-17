export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
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

export function createMemorySecretStore(): SecretStore {
  return new MemorySecretStore();
}
