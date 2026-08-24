import * as core from '@opencoven/sdk-core';
import { describe, expect, test } from 'vitest';

interface ManagedSecretStore {
  readonly disposed: boolean;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  compareAndDelete(
    key: string,
    expectedValue: string,
  ): Promise<'absent' | 'changed' | 'deleted'>;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}

function createStore(): ManagedSecretStore {
  const factory = (
    core as {
      createManagedMemorySecretStore?: () => ManagedSecretStore;
    }
  ).createManagedMemorySecretStore;

  expect(factory).toBeTypeOf('function');
  if (factory === undefined) {
    throw new Error('createManagedMemorySecretStore was not exported');
  }
  return factory();
}

describe('managed memory secret store', () => {
  test.each(['a', 'k'.repeat(256)])('accepts valid key boundary %s', async (key) => {
    const store = createStore();

    await store.set(key, 'value');

    await expect(store.get(key)).resolves.toBe('value');
  });

  test.each(['', '   ', 'k'.repeat(257)])('rejects invalid key boundary', async (key) => {
    const store = createStore();

    await expect(store.set(key, 'value')).rejects.toMatchObject({
      name: 'InvalidSecretKeyError',
    });
    await expect(store.get(key)).rejects.toMatchObject({
      name: 'InvalidSecretKeyError',
    });
    await expect(store.delete(key)).rejects.toMatchObject({
      name: 'InvalidSecretKeyError',
    });
    await expect(store.compareAndDelete(key, 'value')).rejects.toMatchObject({
      name: 'InvalidSecretKeyError',
    });
  });

  test('allows empty values and preserves overwrite and delete semantics', async () => {
    const store = createStore();

    await store.set('token', '');
    await expect(store.get('token')).resolves.toBe('');
    await store.set('token', 'updated');
    await expect(store.get('token')).resolves.toBe('updated');
    await expect(store.delete('token')).resolves.toBe(true);
    await expect(store.delete('token')).resolves.toBe(false);
  });

  test('clears all retained entries', async () => {
    const store = createStore();
    await store.set('first', 'one');
    await store.set('second', 'two');

    await store.clear();

    await expect(store.get('first')).resolves.toBeUndefined();
    await expect(store.get('second')).resolves.toBeUndefined();
  });

  test('disposes idempotently and rejects every later operation', async () => {
    const store = createStore();
    await store.set('token', 'secret');

    await store.dispose();
    await store.dispose();

    expect(store.disposed).toBe(true);
    await expect(store.get('token')).rejects.toMatchObject({
      name: 'SecretStoreDisposedError',
    });
    await expect(store.set('token', 'new')).rejects.toMatchObject({
      name: 'SecretStoreDisposedError',
    });
    await expect(store.delete('token')).rejects.toMatchObject({
      name: 'SecretStoreDisposedError',
    });
    await expect(store.compareAndDelete('token', 'secret')).rejects.toMatchObject({
      name: 'SecretStoreDisposedError',
    });
    await expect(store.clear()).rejects.toMatchObject({
      name: 'SecretStoreDisposedError',
    });
  });

  test('keeps managed stores isolated', async () => {
    const first = createStore();
    const second = createStore();
    await first.set('token', 'first');

    await expect(second.get('token')).resolves.toBeUndefined();
    await first.dispose();
    expect(second.disposed).toBe(false);
    await second.set('token', 'second');
    await expect(second.get('token')).resolves.toBe('second');
  });

  test('deletes a managed secret only when its value still matches', async () => {
    const store = createStore();
    await store.set('token', 'current');

    await expect(store.compareAndDelete('token', 'stale')).resolves.toBe('changed');
    await expect(store.get('token')).resolves.toBe('current');
    await expect(store.compareAndDelete('token', 'current')).resolves.toBe('deleted');
    await expect(store.compareAndDelete('token', 'current')).resolves.toBe('absent');
  });

  test('applies invocation order deterministically around disposal', async () => {
    const store = createStore();

    const setBeforeDispose = store.set('token', 'secret');
    const dispose = store.dispose();

    await setBeforeDispose;
    await dispose;
    await expect(store.get('token')).rejects.toMatchObject({
      name: 'SecretStoreDisposedError',
    });
  });
});
