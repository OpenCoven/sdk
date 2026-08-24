import { afterEach, describe, expect, test, vi } from 'vitest';

const entrypoints = [
  '@opencoven/sdk-core',
  '@opencoven/cave-client',
  '@opencoven/coven-client',
  '@opencoven/sdk',
  '@opencoven/dev-cli',
] as const;

describe('workspace entrypoints', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  for (const entrypoint of entrypoints) {
    test(`${entrypoint} imports without triggering I/O`, async () => {
      const unexpectedIo = vi.fn(() => {
        throw new Error(`unexpected I/O while importing ${entrypoint}`);
      });

      vi.doMock('node:fs', () => ({
        default: {
          readFileSync: unexpectedIo,
          readdirSync: unexpectedIo,
          statSync: unexpectedIo,
        },
        readFileSync: unexpectedIo,
        readdirSync: unexpectedIo,
        statSync: unexpectedIo,
      }));
      vi.doMock('node:fs/promises', () => ({
        lstat: unexpectedIo,
        readFile: unexpectedIo,
        readdir: unexpectedIo,
        stat: unexpectedIo,
      }));
      vi.doMock('node:http', () => ({
        request: unexpectedIo,
      }));
      vi.doMock('node:https', () => ({
        request: unexpectedIo,
      }));
      vi.doMock('node:net', () => ({
        connect: unexpectedIo,
        createConnection: unexpectedIo,
      }));
      vi.doMock('node:child_process', () => ({
        execFile: unexpectedIo,
        spawn: unexpectedIo,
      }));
      if (entrypoint === '@opencoven/dev-cli') {
        vi.doMock('@napi-rs/keyring', () => {
          throw new Error('unexpected keyring import');
        });
      }
      vi.stubGlobal('fetch', unexpectedIo);

      const imported: unknown = await import(entrypoint);

      expect(imported).toBeDefined();

      if (entrypoint === '@opencoven/sdk-core') {
        const discovery = imported as {
          parseDiscoveryEndpoint?: (value: unknown) => unknown;
          parseDiscoveryRecord?: (value: unknown) => unknown;
        };

        expect(
          discovery.parseDiscoveryEndpoint?.({
            kind: 'unix',
            path: '/var/run/opencoven/coven.sock',
          }),
        ).toEqual({
          kind: 'unix',
          path: '/var/run/opencoven/coven.sock',
        });
        expect(
          discovery.parseDiscoveryRecord?.({
            version: 1,
            protocol: 'opencoven.discovery.v1',
            profile: 'coven',
            endpoint: {
              kind: 'windowsNamedPipe',
              path: '\\\\.\\pipe\\opencoven-coven',
            },
          }),
        ).toEqual({
          version: 1,
          protocol: 'opencoven.discovery.v1',
          profile: 'coven',
          endpoint: {
            kind: 'windowsNamedPipe',
            path: '\\\\.\\pipe\\opencoven-coven',
          },
        });
      }

      if (entrypoint === '@opencoven/cave-client') {
        const discovery = imported as {
          createDiscoveredCaveClient?: (options: {
            credentials: {
              store: {
                get(key: string): Promise<string | undefined>;
                set(key: string, value: string): Promise<void>;
                delete(key: string): Promise<boolean>;
              };
              reference: { key: string };
            };
            discovery: { root: string };
            fetch: typeof fetch;
          }) => unknown;
        };
        const core = await import('@opencoven/sdk-core');
        const createDiscoveredCaveClient = discovery.createDiscoveredCaveClient;
        const createMemorySecretStore = (
          core as {
            createMemorySecretStore?: () => {
              get(key: string): Promise<string | undefined>;
              set(key: string, value: string): Promise<void>;
              delete(key: string): Promise<boolean>;
            };
          }
        ).createMemorySecretStore;
        const createSecretStoreReference = (
          core as {
            createSecretStoreReference?: (key: string) => { key: string };
          }
        ).createSecretStoreReference;

        expect(createDiscoveredCaveClient?.({
          credentials: {
            store: createMemorySecretStore?.() ?? {
              get: () => Promise.resolve(undefined),
              set: () => Promise.resolve(),
              delete: () => Promise.resolve(false),
            },
            reference:
              createSecretStoreReference?.('cave-credential') ?? { key: 'cave-credential' },
          },
          discovery: {
            root: '/Users/example/.coven/cave',
          },
          fetch: () =>
            Promise.reject(
              new Error('fetch must not be called while constructing a discovered client'),
            ),
        })).toBeDefined();
      }

      expect(unexpectedIo).not.toHaveBeenCalled();
    });
  }
});
