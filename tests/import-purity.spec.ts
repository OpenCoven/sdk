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
        open: unexpectedIo,
        readFile: unexpectedIo,
        realpath: unexpectedIo,
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

      expect(unexpectedIo).not.toHaveBeenCalled();
    });
  }
});
