import * as core from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
}

type StoreFactory = () => SecretStore;

describe('memory secret store', () => {
  test('keeps a caller-provided secret in memory until explicitly deleted', async () => {
    const createMemorySecretStore = (core as { createMemorySecretStore?: StoreFactory }).createMemorySecretStore;
    const store = createMemorySecretStore?.();

    if (store !== undefined) {
      await store.set('cave-token', 'secret-value');
    }

    await expect(store?.get('cave-token') ?? Promise.resolve(undefined)).resolves.toBe('secret-value');
    await expect(store?.delete('cave-token') ?? Promise.resolve(undefined)).resolves.toBe(true);
    await expect(store?.get('cave-token') ?? Promise.resolve(undefined)).resolves.toBeUndefined();
  });

  test('isolates stores and reports missing or overwritten keys', async () => {
    const createMemorySecretStore = (core as { createMemorySecretStore?: StoreFactory })
      .createMemorySecretStore;
    const first = createMemorySecretStore?.();
    const second = createMemorySecretStore?.();

    await expect(first?.get('missing') ?? Promise.resolve(undefined)).resolves.toBeUndefined();
    await expect(first?.delete('missing') ?? Promise.resolve(undefined)).resolves.toBe(false);

    await first?.set('token', 'first');
    await first?.set('token', 'updated');

    await expect(first?.get('token') ?? Promise.resolve(undefined)).resolves.toBe('updated');
    await expect(second?.get('token') ?? Promise.resolve(undefined)).resolves.toBeUndefined();
  });
});
