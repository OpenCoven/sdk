import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  createFileOpenCovenProfileStore,
  createMemoryOpenCovenProfileStore,
  createOpenCovenProfileSecretReference,
  migrateOpenCovenProfileDocument,
  parseOpenCovenProfile,
} from '@opencoven/sdk-core';
import { describe, expect, test, vi } from 'vitest';

const unixTest = test.runIf(process.platform !== 'win32');

describe('non-secret profiles', () => {
  test('parses a versioned profile and derives a separate secret reference', () => {
    const profile = parseOpenCovenProfile({
      version: 1,
      name: 'chat-main',
      caveHome: '/Users/example/.coven/cave',
      covenHome: '/Users/example/.coven',
      defaultFamiliarId: 'cody',
      defaultProjectId: 'project-1',
    });

    expect(profile).toEqual({
      version: 1,
      name: 'chat-main',
      caveHome: '/Users/example/.coven/cave',
      covenHome: '/Users/example/.coven',
      defaultFamiliarId: 'cody',
      defaultProjectId: 'project-1',
    });
    expect(createOpenCovenProfileSecretReference(profile.name)).toEqual({
      key: 'opencoven.profile.chat-main.cave',
    });
    expect(JSON.stringify(profile)).not.toMatch(
      /bearer|secret|token|password|cookie/iu,
    );
  });

  test('rejects secret-shaped fields, traversal names, and accessors', () => {
    let invoked = false;
    const accessorProfile = {
      version: 1,
      name: 'chat-main',
    };
    Object.defineProperty(accessorProfile, 'caveHome', {
      enumerable: true,
      get() {
        invoked = true;
        return '/tmp/cave';
      },
    });

    expect(() =>
      parseOpenCovenProfile({
        version: 1,
        name: 'chat-main',
        bearer: 'must-not-be-stored',
      }),
    ).toThrow(/malformed/iu);
    expect(() =>
      parseOpenCovenProfile({
        version: 1,
        name: '../chat',
      }),
    ).toThrow(/malformed/iu);
    expect(() =>
      parseOpenCovenProfile({
        version: 1,
        name: 'chat-main',
        caveHome: 'relative/cave',
      }),
    ).toThrow(/absolute/iu);
    expect(() => parseOpenCovenProfile(accessorProfile)).toThrow(
      /data properties/iu,
    );
    expect(() =>
      createOpenCovenProfileSecretReference(
        undefined as unknown as string,
      ),
    ).toThrow(/malformed/iu);
    expect(invoked).toBe(false);
  });

  test('rejects sparse, decorated, and accessor profile arrays', () => {
    const sparse = new Array(1);
    const decorated: unknown[] = [];
    Object.defineProperty(decorated, 'extra', {
      enumerable: true,
      value: 'unexpected',
    });
    let invoked = false;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        invoked = true;
        return { version: 1, name: 'unsafe' };
      },
    });
    accessor.length = 1;

    for (const profiles of [sparse, decorated, accessor]) {
      expect(() =>
        migrateOpenCovenProfileDocument({
          version: 1,
          profiles,
        }),
      ).toThrow(/data entries/iu);
    }
    expect(invoked).toBe(false);
  });

  test('migrates the explicit version zero document to version one', () => {
    expect(
      migrateOpenCovenProfileDocument({
        version: 0,
        profiles: [
          {
            name: 'chat-main',
            defaultFamiliarId: 'cody',
          },
        ],
      }),
    ).toEqual({
      version: 1,
      profiles: [
        {
          version: 1,
          name: 'chat-main',
          defaultFamiliarId: 'cody',
        },
      ],
    });
  });

  test('stores immutable profiles in memory without storing credentials', async () => {
    const store = createMemoryOpenCovenProfileStore();
    await store.set({
      version: 1,
      name: 'chat-main',
      defaultProjectId: 'project-1',
    });

    await expect(store.get('chat-main')).resolves.toEqual({
      version: 1,
      name: 'chat-main',
      defaultProjectId: 'project-1',
    });
    await expect(store.list()).resolves.toEqual([
      {
        version: 1,
        name: 'chat-main',
        defaultProjectId: 'project-1',
      },
    ]);
    await expect(store.delete('chat-main')).resolves.toBe(true);
    await store.reset();
    await expect(store.list()).resolves.toEqual([]);
  });

  unixTest('persists profiles atomically with owner-only permissions and migrates version zero', async () => {
    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const path = resolve(root, 'profiles.json');
    chmodSync(root, 0o700);
    writeFileSync(
      path,
      JSON.stringify({
        version: 0,
        profiles: [{ name: 'chat-main', defaultFamiliarId: 'cody' }],
      }),
      { mode: 0o600 },
    );

    try {
      const store = createFileOpenCovenProfileStore({ path });
      await expect(store.list()).resolves.toEqual([
        {
          version: 1,
          name: 'chat-main',
          defaultFamiliarId: 'cody',
        },
      ]);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
        version: 1,
      });
      await store.set({
        version: 1,
        name: 'second',
        covenHome: resolve(root, 'coven'),
      });
      await expect(
        createFileOpenCovenProfileStore({ path }).get('second'),
      ).resolves.toMatchObject({
        version: 1,
        name: 'second',
      });
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  unixTest('rejects symlinks and unsafe profile file permissions', async () => {
    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const target = resolve(root, 'target.json');
    const link = resolve(root, 'profiles.json');
    chmodSync(root, 0o700);
    writeFileSync(target, '{"version":1,"profiles":[]}\n', { mode: 0o600 });
    symlinkSync(target, link);

    try {
      await expect(
        createFileOpenCovenProfileStore({ path: link }).list(),
      ).rejects.toMatchObject({ code: 'unsafe_profile_store' });
      rmSync(link);
      writeFileSync(link, '{"version":1,"profiles":[]}\n', { mode: 0o644 });
      await expect(
        createFileOpenCovenProfileStore({ path: link }).list(),
      ).rejects.toMatchObject({ code: 'unsafe_profile_store' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  unixTest('requires explicit reset after corrupt profile data', async () => {
    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const path = resolve(root, 'profiles.json');
    chmodSync(root, 0o700);
    writeFileSync(path, '{corrupt', { mode: 0o600 });

    try {
      const store = createFileOpenCovenProfileStore({ path });
      await expect(store.list()).rejects.toMatchObject({
        code: 'corrupt_profile_store',
      });
      await store.reset();
      await expect(store.list()).resolves.toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  unixTest('requires a canonical absolute file in an owner-private directory', async () => {
    expect(() =>
      createFileOpenCovenProfileStore(
        undefined as unknown as { path: string },
      ),
    ).toThrow(/canonical and absolute/iu);
    expect(() =>
      createFileOpenCovenProfileStore({ path: 'profiles.json' }),
    ).toThrow(/canonical and absolute/iu);

    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const path = resolve(root, 'profiles.json');
    chmodSync(root, 0o755);

    try {
      expect(() =>
        createFileOpenCovenProfileStore({
          path: `${root}/nested/../profiles.json`,
        }),
      ).toThrow(/canonical and absolute/iu);
      await expect(
        createFileOpenCovenProfileStore({ path }).list(),
      ).rejects.toMatchObject({ code: 'unsafe_profile_store' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  unixTest('rejects oversized, invalid UTF-8, and invalid documents', async () => {
    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const path = resolve(root, 'profiles.json');
    chmodSync(root, 0o700);
    const store = createFileOpenCovenProfileStore({ path });

    try {
      writeFileSync(path, Buffer.alloc(64 * 1024 + 1), { mode: 0o600 });
      await expect(store.list()).rejects.toMatchObject({
        code: 'unsafe_profile_store',
      });

      writeFileSync(path, Buffer.from([0xc3, 0x28]), { mode: 0o600 });
      await expect(store.list()).rejects.toMatchObject({
        code: 'corrupt_profile_store',
      });

      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          profiles: [
            { version: 1, name: 'duplicate' },
            { version: 1, name: 'duplicate' },
          ],
        }),
        { mode: 0o600 },
      );
      await expect(store.list()).rejects.toMatchObject({
        code: 'corrupt_profile_store',
      });

      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          profiles: Array.from({ length: 65 }, (_, index) => ({
            version: 1,
            name: `profile-${index}`,
          })),
        }),
        { mode: 0o600 },
      );
      await expect(store.list()).rejects.toMatchObject({
        code: 'corrupt_profile_store',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  unixTest('creates missing stores and serializes concurrent mutations', async () => {
    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const path = resolve(root, 'profiles.json');
    chmodSync(root, 0o700);
    const first = createFileOpenCovenProfileStore({ path });
    const second = createFileOpenCovenProfileStore({ path });

    try {
      await expect(first.list()).resolves.toEqual([]);
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          (index % 2 === 0 ? first : second).set({
            version: 1,
            name: `profile-${String(index).padStart(2, '0')}`,
          }),
        ),
      );
      const profiles = await first.list();
      expect(profiles).toHaveLength(20);
      expect(profiles.map(({ name }) => name)).toEqual(
        Array.from(
          { length: 20 },
          (_, index) => `profile-${String(index).padStart(2, '0')}`,
        ),
      );
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed on Windows until native ownership checks exist', async () => {
    const root = mkdtempSync(
      resolve(realpathSync(tmpdir()), 'opencoven-profiles-'),
    );
    const path = resolve(root, 'profiles.json');
    chmodSync(root, 0o700);
    const platform = vi.spyOn(process, 'platform', 'get');
    platform.mockReturnValue('win32');

    try {
      await expect(
        createFileOpenCovenProfileStore({ path }).list(),
      ).rejects.toMatchObject({
        code: 'profile_platform_security_unavailable',
      });
    } finally {
      platform.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
