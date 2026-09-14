/* eslint-disable @typescript-eslint/require-await */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNativeSecretStore, SecureStoreUnavailableError } from '@opencoven/dev-cli';
import { afterAll, describe, expect, test, vi } from 'vitest';

import { probeNativeSecretStore } from '../packages/cli/src/native-secret-store.js';

const lockTrace = vi.hoisted(() => ({
  target: '',
  events: [] as { operation: string; phase: string; code?: string; removing: number }[],
  removing: 0,
}));

const deletionWindow = vi.hoisted(() => ({
  target: '',
  pending: '',
  rejectedCreates: 0,
  hold: undefined as (() => Promise<void>) | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>();
  return {
    ...fs,
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      if (args[0] === deletionWindow.pending) {
        deletionWindow.rejectedCreates++;
        throw Object.assign(new Error('synthetic pending deletion or denied creation'), {
          code: 'EPERM',
          syscall: 'mkdir',
        });
      }
      if (args[0] !== lockTrace.target) {
        return fs.mkdir(...args);
      }
      lockTrace.events.push({ operation: 'mkdir', phase: 'start', removing: lockTrace.removing });
      try {
        const result = await fs.mkdir(...args);
        lockTrace.events.push({ operation: 'mkdir', phase: 'done', removing: lockTrace.removing });
        return result;
      } catch (error) {
        lockTrace.events.push({
          operation: 'mkdir',
          phase: 'error',
          code: (error as NodeJS.ErrnoException).code ?? 'unknown',
          removing: lockTrace.removing,
        });
        throw error;
      } finally {
        lockTrace.events.splice(0, Math.max(0, lockTrace.events.length - 40));
      }
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (
        deletionWindow.hold !== undefined &&
        typeof args[0] === 'string' &&
        (args[0] === deletionWindow.target || args[0].startsWith(`${deletionWindow.target}.released-`))
      ) {
        const hold = deletionWindow.hold;
        deletionWindow.hold = undefined;
        deletionWindow.pending = args[0];
        try {
          await hold();
          return await fs.rm(...args);
        } finally {
          deletionWindow.pending = '';
        }
      }
      if (
        args[0] !== lockTrace.target &&
        !(lockTrace.target !== '' && typeof args[0] === 'string' &&
          args[0].startsWith(`${lockTrace.target}.released-`))
      ) {
        return fs.rm(...args);
      }
      const operation = args[0] === lockTrace.target ? 'rm' : 'rm-retired';
      lockTrace.removing++;
      lockTrace.events.push({ operation, phase: 'start', removing: lockTrace.removing });
      try {
        await fs.rm(...args);
        lockTrace.events.push({ operation, phase: 'done', removing: lockTrace.removing });
      } catch (error) {
        lockTrace.events.push({
          operation,
          phase: 'error',
          code: (error as NodeJS.ErrnoException).code ?? 'unknown',
          removing: lockTrace.removing,
        });
        throw error;
      } finally {
        lockTrace.removing--;
        lockTrace.events.splice(0, Math.max(0, lockTrace.events.length - 40));
      }
    },
  };
});

interface EntryShape {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): boolean;
}

interface KeyringModuleShape {
  Entry: new (service: string, account: string) => EntryShape;
}

interface ProbeableNativeSecretStore {
  probe(): Promise<void>;
}

interface AtomicNativeSecretStore {
  compareAndDelete(
    key: string,
    expectedValue: string,
  ): Promise<'absent' | 'changed' | 'deleted'>;
}

const SERVICE = 'OpenCoven CLI';
const TEST_LOCK_DIRECTORY = mkdtempSync(
  join(tmpdir(), 'opencoven-native-secret-store-'),
);

afterAll(() => {
  rmSync(TEST_LOCK_DIRECTORY, { force: true, recursive: true });
});

function moduleWithEntry(entry: KeyringModuleShape['Entry']) {
  return {
    lockDirectory: TEST_LOCK_DIRECTORY,
    loadModule: () => Promise.resolve({ Entry: entry }),
    service: SERVICE,
  };
}

function lockPath(lockDirectory: string, service: string, key: string): string {
  const digest = createHash('sha256')
    .update(service)
    .update('\0')
    .update(key)
    .digest('hex');
  return join(lockDirectory, `${digest}.lock`);
}

describe('native secret store', () => {
  test('acquires the next lock while the previous directory is pending deletion', async () => {
    let value: string | undefined;
    class Entry {
      getPassword() { return value; }
      setPassword(next: string) { value = next; }
      deletePassword() { value = undefined; return true; }
    }
    const options = {
      ...moduleWithEntry(Entry),
      lockDirectory: mkdtempSync(join(TEST_LOCK_DIRECTORY, 'pending-deletion-')),
    };
    const first = await createNativeSecretStore(options);
    const second = await createNativeSecretStore(options);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    deletionWindow.target = lockPath(options.lockDirectory, SERVICE, 'credential');
    deletionWindow.rejectedCreates = 0;
    deletionWindow.hold = () => {
      entered.resolve();
      return release.promise;
    };
    const original = Promise.allSettled([first.set('credential', 'old')]);
    let replacement;
    try {
      const reachedRemoval = await Promise.race([
        entered.promise.then(() => true),
        original.then(() => false),
      ]);
      if (!reachedRemoval) {
        throw new Error('Original mutation finished before reaching the deletion window.');
      }
      replacement = await Promise.allSettled([second.set('credential', 'new')]);
    } finally {
      release.resolve();
      await original;
      deletionWindow.target = '';
      deletionWindow.hold = undefined;
    }
    expect(await original).toEqual([{ status: 'fulfilled', value: undefined }]);
    expect(replacement).toEqual([{ status: 'fulfilled', value: undefined }]);
    expect(deletionWindow.rejectedCreates).toBe(0);
    expect(value).toBe('new');
  });

  test('does not retry a genuine mkdir permission failure', async () => {
    const setPassword = vi.fn();
    const options = {
      ...moduleWithEntry(class {
        getPassword() { return undefined; }
        setPassword = setPassword;
        deletePassword() { return false; }
      }),
      lockDirectory: mkdtempSync(join(TEST_LOCK_DIRECTORY, 'denied-creation-')),
    };
    const store = await createNativeSecretStore(options);
    deletionWindow.pending = lockPath(options.lockDirectory, SERVICE, 'credential');
    deletionWindow.rejectedCreates = 0;
    try {
      await expect(store.set('credential', 'value')).rejects.toMatchObject({
        code: 'secure_store_unavailable',
        cause: { code: 'EPERM', syscall: 'mkdir' },
      });
      expect(deletionWindow.rejectedCreates).toBe(1);
      expect(setPassword).not.toHaveBeenCalled();
    } finally {
      deletionWindow.pending = '';
    }
  });

  test('loads the installed native binding without creating mutation state', async () => {
    const lockDirectory = join(TEST_LOCK_DIRECTORY, 'installed-binding');
    const store = await createNativeSecretStore({ lockDirectory });

    expect(typeof store.get).toBe('function');
    expect(typeof store.delete).toBe('function');
    expect(existsSync(lockDirectory)).toBe(false);
  });

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

        deletePassword(): boolean {
          return secrets.delete(this.#slot);
        }
      },
    } satisfies KeyringModuleShape));

    const store = await createNativeSecretStore({
      lockDirectory: TEST_LOCK_DIRECTORY,
      loadModule,
      service: SERVICE,
    });

    await expect(store.get('missing')).resolves.toBeUndefined();
    await expect(store.delete('missing')).resolves.toBe(false);

    await expect(store.set('cave-credential', 'bearer-value')).resolves.toBeUndefined();
    await expect(store.get('cave-credential')).resolves.toBe('bearer-value');
    await expect(
      store.compareAndDelete?.('cave-credential', 'stale-value'),
    ).resolves.toBe('changed');
    await expect(store.delete('cave-credential')).resolves.toBe(true);
    await expect(store.get('cave-credential')).resolves.toBeUndefined();
    await expect(
      store.compareAndDelete?.('cave-credential', 'bearer-value'),
    ).resolves.toBe('absent');
    expect(loadModule).toHaveBeenCalledTimes(1);
  });

  test.each(['delete', 'compareAndDelete'] as const)(
    'reports absence when a credential disappears during %s',
    async (operation) => {
      const secrets = new Map<string, string>([
        [`${SERVICE}:cave-credential`, 'stored-value'],
      ]);
      const store = await createNativeSecretStore(
        moduleWithEntry(
          class {
            readonly #slot: string;

            constructor(service: string, account: string) {
              this.#slot = `${service}:${account}`;
            }

            getPassword(): string | undefined {
              const value = secrets.get(this.#slot);
              secrets.delete(this.#slot);
              return value;
            }

            setPassword(value: string): void {
              secrets.set(this.#slot, value);
            }

            deletePassword(): boolean {
              return secrets.delete(this.#slot);
            }
          },
        ),
      );

      const result = operation === 'delete'
        ? store.delete('cave-credential')
        : store.compareAndDelete?.('cave-credential', 'stored-value');
      await expect(result).resolves.toBe(operation === 'delete' ? false : 'absent');
    },
  );

  test.each([
    ...Array.from({ length: 25 }, (_, iteration) => ({
      scenario: `replacement retained (iteration ${String(iteration + 1)})`,
      failure: 'none',
    })),
    { scenario: 'deletion failure', failure: 'delete' },
    { scenario: 'immediate replacement rejection', failure: 'set' },
  ])('drains the native store replacement race: $scenario', async ({ failure }) => {
    const secrets = new Map<string, string>([
      [`${SERVICE}:cave-credential`, 'credential-current'],
    ]);
    let replacement: Promise<[PromiseSettledResult<void>]> | undefined;
    const deletionFailure = new Error('injected deletion failure');
    const replacementFailure = new SecureStoreUnavailableError('set', {
      cause: Object.assign(new Error('injected lock failure'), {
        code: 'EPERM',
        syscall: 'mkdir',
      }),
    });

    class Entry {
      readonly #slot: string;

      constructor(service: string, account: string) {
        this.#slot = `${service}:${account}`;
      }

      getPassword(): string | undefined {
        const value = secrets.get(this.#slot);
        if (
          this.#slot === `${SERVICE}:cave-credential` &&
          value === 'credential-current' &&
          replacement === undefined
        ) {
          // Observe rejection immediately, without ending the test before deletion releases its lock.
          replacement = Promise.allSettled([
            replacementStore.set('cave-credential', 'credential-new'),
          ]);
        }
        return value;
      }

      setPassword(value: string): void {
        secrets.set(this.#slot, value);
      }

      deletePassword(): boolean {
        if (failure === 'delete') {
          throw deletionFailure;
        }
        return secrets.delete(this.#slot);
      }
    }

    const options = {
      ...moduleWithEntry(Entry),
      lockDirectory: mkdtempSync(join(TEST_LOCK_DIRECTORY, 'replacement-race-')),
    };
    // Trace only this synthetic fixture's canonical lock; never record paths or credentials.
    lockTrace.target = lockPath(options.lockDirectory, SERVICE, 'cave-credential');
    lockTrace.events = [];
    const deletingStore = await createNativeSecretStore(options);
    const replacementStore = await createNativeSecretStore(options);
    if (failure === 'set') {
      vi.spyOn(replacementStore, 'set').mockRejectedValue(replacementFailure);
    }
    const atomicStore = deletingStore as typeof deletingStore & AtomicNativeSecretStore;

    const [deletionResult] = await Promise.allSettled([
      atomicStore.compareAndDelete('cave-credential', 'credential-current'),
    ]);
    // Drain both operations before any assertion can abort the test or permit cleanup.
    const replacementResults = await replacement;
    if (replacementResults?.[0].status === 'rejected' && failure !== 'set') {
      console.error('synthetic-lock-lifecycle', JSON.stringify({
        platform: process.platform,
        node: process.versions.node,
        uv: process.versions.uv,
        events: lockTrace.events,
      }));
    }
    lockTrace.target = '';

    expect(lockTrace.events.some(({ operation, phase }) =>
      operation === 'rm-retired' && phase === 'done')).toBe(true);
    expect(lockTrace.removing).toBe(0);
    expect(replacementResults).toBeDefined();
    if (failure === 'delete') {
      expect(deletionResult).toMatchObject({
        status: 'rejected',
        reason: {
          code: 'secure_store_unavailable',
          operation: 'delete',
          cause: deletionFailure,
        },
      });
    } else {
      expect(deletionResult).toEqual({ status: 'fulfilled', value: 'deleted' });
    }
    if (failure === 'set') {
      expect(replacementResults).toEqual([{
        status: 'rejected',
        reason: replacementFailure,
      }]);
      await expect(deletingStore.get('cave-credential')).resolves.toBeUndefined();
    } else {
      expect(replacementResults).toEqual([{ status: 'fulfilled', value: undefined }]);
      await expect(deletingStore.get('cave-credential')).resolves.toBe('credential-new');
    }
    expect(existsSync(lockPath(options.lockDirectory, SERVICE, 'cave-credential'))).toBe(false);
  });

  test('recovers a stale owner lock even when its PID has been reused', async () => {
    const lockDirectory = join(TEST_LOCK_DIRECTORY, 'stale-lock');
    const staleLockPath = lockPath(lockDirectory, SERVICE, 'cave-credential');
    mkdirSync(staleLockPath, { recursive: true, mode: 0o700 });
    const staleTime = new Date(Date.now() - 60_000);
    writeFileSync(
      join(staleLockPath, 'owner.json'),
      `${JSON.stringify({
        version: 1,
        pid: process.pid,
        processToken: 'previous-process-token',
        token: 'stale-owner-token',
        createdAt: staleTime.getTime(),
      })}\n`,
      { mode: 0o600 },
    );
    utimesSync(staleLockPath, staleTime, staleTime);
    const secrets = new Map<string, string>();
    const store = await createNativeSecretStore({
      ...moduleWithEntry(
        class {
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

          deletePassword(): boolean {
            return secrets.delete(this.#slot);
          }
        },
      ),
      lockDirectory,
    });

    await expect(store.set('cave-credential', 'credential-value')).resolves.toBeUndefined();
    await expect(store.get('cave-credential')).resolves.toBe('credential-value');
    expect(existsSync(staleLockPath)).toBe(false);
  });

  test('does not steal an old lock from the matching live process instance', async () => {
    const lockDirectory = join(TEST_LOCK_DIRECTORY, 'live-old-lock');
    const secrets = new Map<string, string>();
    const setPassword = vi.fn((value: string) => {
      secrets.set(`${SERVICE}:cave-credential`, value);
    });
    const store = await createNativeSecretStore({
      ...moduleWithEntry(
        class {
          getPassword(): string | undefined {
            return secrets.get(`${SERVICE}:cave-credential`);
          }

          setPassword(value: string): void {
            setPassword(value);
          }

          deletePassword(): boolean {
            return secrets.delete(`${SERVICE}:cave-credential`);
          }
        },
      ),
      lockDirectory,
    });
    await store.set('cave-credential', 'initial');
    const processOwner = JSON.parse(
      readFileSync(join(lockDirectory, `process-${String(process.pid)}.json`), 'utf8'),
    ) as { processToken: string };
    const activeLockPath = lockPath(lockDirectory, SERVICE, 'cave-credential');
    mkdirSync(activeLockPath, { recursive: true, mode: 0o700 });
    const staleTime = new Date(Date.now() - 60_000);
    writeFileSync(
      join(activeLockPath, 'owner.json'),
      `${JSON.stringify({
        version: 1,
        pid: process.pid,
        processToken: processOwner.processToken,
        token: 'active-owner-token',
        createdAt: staleTime.getTime(),
      })}\n`,
      { mode: 0o600 },
    );
    utimesSync(activeLockPath, staleTime, staleTime);

    try {
      await expect(store.set('cave-credential', 'replacement')).rejects.toMatchObject({
        code: 'secure_store_unavailable',
        operation: 'set',
      });
      expect(setPassword).toHaveBeenCalledTimes(1);
      expect(secrets.get(`${SERVICE}:cave-credential`)).toBe('initial');
      expect(existsSync(activeLockPath)).toBe(true);
    } finally {
      rmSync(activeLockPath, { force: true, recursive: true });
    }
  }, 10_000);

  test('fails closed when the native mutation lock root is not a directory', async () => {
    const lockDirectory = join(TEST_LOCK_DIRECTORY, 'not-a-directory');
    writeFileSync(lockDirectory, 'not a lock directory', { mode: 0o600 });
    const store = await createNativeSecretStore({
      ...moduleWithEntry(
        class {
          getPassword(): string | undefined {
            return undefined;
          }

          setPassword(): void {
            throw new Error('mutation must not run');
          }

          deletePassword(): boolean {
            throw new Error('mutation must not run');
          }
        },
      ),
      lockDirectory,
    });

    await expect(store.set('cave-credential', 'credential-value')).rejects.toMatchObject({
      code: 'secure_store_unavailable',
      operation: 'set',
      retryable: false,
    });
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

          deletePassword(): boolean {
            calls.push({ account: this.#account, method: 'delete' });
            return true;
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
      lockDirectory: TEST_LOCK_DIRECTORY,
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

              deletePassword(): boolean {
                return false;
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

          deletePassword(): boolean {
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
    ['delete', 'getPassword'],
    ['delete', 'deletePassword'],
    ['compareAndDelete', 'getPassword'],
    ['compareAndDelete', 'deletePassword'],
    ['probe', 'getPassword'],
  ] as const)(
    'wraps backend %s/%s failures as secure_store_unavailable',
    async (operation, failingMethod) => {
      const failure = new Error('backend failure with secret bearer keychain token');
      const store = await createNativeSecretStore(
        moduleWithEntry(
          class {
            getPassword(): string | undefined {
              if (failingMethod === 'getPassword') {
                throw failure;
              }
              return 'stored-value';
            }

            setPassword(): void {
              if (failingMethod === 'setPassword') {
                throw failure;
              }
            }

            deletePassword(): boolean {
              if (failingMethod === 'deletePassword') {
                throw failure;
              }
              return true;
            }
          },
        ),
      );

      const operations = {
        get: () => store.get('cave-credential'),
        set: () => store.set('cave-credential', 'top-secret'),
        delete: () => store.delete('cave-credential'),
        compareAndDelete: () =>
          Promise.resolve(store.compareAndDelete?.('cave-credential', 'stored-value')),
        probe: () => probeNativeSecretStore(store),
      };
      const error = await operations[operation]().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(SecureStoreUnavailableError);
      expect(error).toMatchObject({
        code: 'secure_store_unavailable',
        message: 'Native secure credential storage is unavailable.',
        operation: operation === 'compareAndDelete' ? 'delete' : operation,
        retryable: false,
      });
      expect(error).toHaveProperty('cause', failure);
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
      lockDirectory: TEST_LOCK_DIRECTORY,
      loadModule: () =>
        Promise.resolve({
          Entry: class {
            getPassword(): string | undefined {
              throw new SecureStoreUnavailableError('get');
            }

            setPassword(): void {
              throw new SecureStoreUnavailableError('set');
            }

            deletePassword(): boolean {
              throw new Error('not reached');
            }
          },
        }),
    });
    const deleteStore = await createNativeSecretStore({
      lockDirectory: TEST_LOCK_DIRECTORY,
      loadModule: () =>
        Promise.resolve({
          Entry: class {
            getPassword(): string {
              return 'stored';
            }

            setPassword(): void {
              // no-op
            }

            deletePassword(): boolean {
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
