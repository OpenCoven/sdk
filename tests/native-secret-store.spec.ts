/* eslint-disable @typescript-eslint/require-await */

import { createNativeSecretStore, SecureStoreUnavailableError } from '@opencoven/dev-cli';
import { describe, expect, test, vi } from 'vitest';

import { probeNativeSecretStore } from '../packages/cli/src/native-secret-store.js';

interface EntryShape {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): void;
}

interface KeyringModuleShape {
  Entry: new (service: string, account: string) => EntryShape;
}

interface ProbeableNativeSecretStore {
  probe(): Promise<void>;
}

const SERVICE = 'OpenCoven CLI';

function moduleWithEntry(entry: KeyringModuleShape['Entry']) {
  return {
    loadModule: () => Promise.resolve({ Entry: entry }),
    service: SERVICE,
  };
}

describe('native secret store', () => {
  test('loads the native keyring module and stores secrets without a fallback', async () => {
    const secrets = new Map<string, string>();
    const loadModule = vi.fn(() => Promise.resolve({
      Entry: class {
        readonly #slot: string;

        constructor(service: string, account: string) {
          this.#slot = `${service}:${account}`;
        }

        getPassword(): string | undefined {
          return secrets.get(this.#slot);
        }

        setPassword(value: string): void {
          secrets.set(this.#slot, value);
        }

        deletePassword(): void {
          secrets.delete(this.#slot);
        }
      },
    } satisfies KeyringModuleShape));

    const store = await createNativeSecretStore({
      loadModule,
      service: SERVICE,
    });

    await expect(store.get('missing')).resolves.toBeUndefined();
    await expect(store.delete('missing')).resolves.toBe(false);

    await expect(store.set('cave-credential', 'bearer-value')).resolves.toBeUndefined();
    await expect(store.get('cave-credential')).resolves.toBe('bearer-value');
    await expect(store.delete('cave-credential')).resolves.toBe(true);
    await expect(store.get('cave-credential')).resolves.toBeUndefined();
    expect(loadModule).toHaveBeenCalledTimes(1);
  });

  test('probes a dedicated native keyring entry without mutating stored credentials', async () => {
    const calls: Array<{ account: string; method: 'construct' | 'get' | 'set' | 'delete' }> = [];
    const store = await createNativeSecretStore(
      moduleWithEntry(
        class {
          readonly #account: string;

          constructor(_service: string, account: string) {
            this.#account = account;
            calls.push({ account, method: 'construct' });
          }

          getPassword(): string {
            calls.push({ account: this.#account, method: 'get' });
            return this.#account === 'cave-credential' ? 'bearer-value' : 'probe-secret';
          }

          setPassword(): void {
            calls.push({ account: this.#account, method: 'set' });
          }

          deletePassword(): void {
            calls.push({ account: this.#account, method: 'delete' });
          }
        },
      ),
    );

    await expect(store.get('cave-credential')).resolves.toBe('bearer-value');
    calls.length = 0;

    await expect((store as unknown as ProbeableNativeSecretStore).probe()).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        account: 'opencoven.cli.secure-store.probe',
        method: 'construct',
      },
      {
        account: 'opencoven.cli.secure-store.probe',
        method: 'get',
      },
    ]);
  });

  test('accepts the keyring Entry constructor from a default export shape', async () => {
    const store = await createNativeSecretStore({
      loadModule: () =>
        Promise.resolve({
          default: {
            Entry: class {
              getPassword(): string | undefined {
                return undefined;
              }

              setPassword(): void {
                // no-op
              }

              deletePassword(): void {
                // no-op
              }
            },
          },
        } as unknown as KeyringModuleShape),
      service: SERVICE,
    });

    await expect(store.get('cave-credential')).resolves.toBeUndefined();
  });

  test('rejects missing Entry constructors as secure_store_unavailable', async () => {
    const error = await createNativeSecretStore({
      loadModule: () => Promise.resolve({} as unknown as KeyringModuleShape),
      service: SERVICE,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecureStoreUnavailableError);
    expect(error).toMatchObject({
      code: 'secure_store_unavailable',
      operation: 'load',
      retryable: false,
    });
  });

  test('wraps module load failures as secure_store_unavailable without leaking service details', async () => {
    const error = await createNativeSecretStore({
      loadModule: () =>
        Promise.reject(
          new Error('native binding for OpenCoven CLI secret-service failed with bearer abc123'),
        ),
      service: 'OpenCoven CLI secret-service',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecureStoreUnavailableError);
    expect(error).toMatchObject({
      code: 'secure_store_unavailable',
      message: 'Native secure credential storage is unavailable.',
      operation: 'load',
      retryable: false,
    });
    expect(String(error)).not.toContain('secret-service');
    expect(String(error)).not.toContain('abc123');
  });

  test('wraps constructor failures as secure_store_unavailable', async () => {
    const store = await createNativeSecretStore(
      moduleWithEntry(
        class {
          constructor() {
            throw new Error('OpenCoven CLI service secret should not leak');
          }

          getPassword(): string | undefined {
            return undefined;
          }

          setPassword(): void {
            throw new Error('unreachable');
          }

          deletePassword(): void {
            throw new Error('unreachable');
          }
        },
      ),
    );

    const error = await store.get('cave-credential').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecureStoreUnavailableError);
    expect(error).toMatchObject({
      code: 'secure_store_unavailable',
      message: 'Native secure credential storage is unavailable.',
      operation: 'construct',
      retryable: false,
    });
    expect(String(error)).not.toContain('OpenCoven CLI');
    expect(String(error)).not.toContain('secret');
  });

  test.each([
    ['get', 'getPassword'],
    ['set', 'setPassword'],
    ['delete', 'deletePassword'],
  ] as const)(
    'wraps backend %s failures as secure_store_unavailable',
    async (operation, failingMethod) => {
      const store = await createNativeSecretStore(
        moduleWithEntry(
          class {
            getPassword(): string | undefined {
              if (failingMethod === 'getPassword' || failingMethod === 'deletePassword') {
                throw new Error('backend failure with secret bearer value');
              }
              return 'stored-value';
            }

            setPassword(): void {
              if (failingMethod === 'setPassword') {
                throw new Error('backend failure with keychain token');
              }
            }

            deletePassword(): void {
              if (failingMethod === 'deletePassword') {
                throw new Error('backend failure with keychain token');
              }
            }
          },
        ),
      );

      const error = await (
        operation === 'get'
          ? store.get('cave-credential')
          : operation === 'set'
            ? store.set('cave-credential', 'top-secret')
            : store.delete('cave-credential')
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(SecureStoreUnavailableError);
      expect(error).toMatchObject({
        code: 'secure_store_unavailable',
        message: 'Native secure credential storage is unavailable.',
        operation,
        retryable: false,
      });
      expect(String(error)).not.toContain('top-secret');
      expect(String(error)).not.toContain('token');
      expect(String(error)).not.toContain('bearer');
    },
  );

  test('rejects missing probe APIs as secure_store_unavailable', async () => {
    const error = await probeNativeSecretStore({
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => false,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecureStoreUnavailableError);
    expect(error).toMatchObject({
      code: 'secure_store_unavailable',
      operation: 'probe',
      retryable: false,
    });
  });

  test('preserves already wrapped secure-store failures and the default service name', async () => {
    const store = await createNativeSecretStore({
      loadModule: () =>
        Promise.resolve({
          Entry: class {
            getPassword(): string | undefined {
              throw new SecureStoreUnavailableError('get');
            }

            setPassword(): void {
              throw new SecureStoreUnavailableError('set');
            }

            deletePassword(): void {
              throw new Error('not reached');
            }
          },
        }),
    });
    const deleteStore = await createNativeSecretStore({
      loadModule: () =>
        Promise.resolve({
          Entry: class {
            getPassword(): string {
              return 'stored';
            }

            setPassword(): void {
              // no-op
            }

            deletePassword(): void {
              throw new SecureStoreUnavailableError('delete');
            }
          },
        }),
    });

    await expect(store.get('cave-credential')).rejects.toMatchObject({
      operation: 'get',
    });
    await expect(store.set('cave-credential', 'value')).rejects.toMatchObject({
      operation: 'set',
    });
    await expect(deleteStore.delete('cave-credential')).rejects.toMatchObject({
      operation: 'delete',
    });

    await expect(
      probeNativeSecretStore(
        Object.assign(store, {
          probe: async () => {
            throw new SecureStoreUnavailableError('probe');
          },
        }),
      ),
    ).rejects.toMatchObject({
      operation: 'probe',
    });
  });

  test('preserves already wrapped probe failures from plain SecretStore implementations', async () => {
    await expect(
      probeNativeSecretStore(
        Object.assign(
          {
            get: async () => undefined,
            set: async () => undefined,
            delete: async () => false,
          },
          {
            probe: async () => {
              throw new SecureStoreUnavailableError('probe');
            },
          },
        ),
      ),
    ).rejects.toMatchObject({
      operation: 'probe',
    });
  });
});
