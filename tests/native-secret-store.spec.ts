import { createNativeSecretStore, SecureStoreUnavailableError } from '@opencoven/dev-cli';
import { describe, expect, test, vi } from 'vitest';

interface EntryShape {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): void;
}

interface KeyringModuleShape {
  Entry: new (service: string, account: string) => EntryShape;
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
});
