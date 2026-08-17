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
      vi.stubGlobal('fetch', unexpectedIo);

      await expect(import(entrypoint)).resolves.toBeDefined();
      expect(unexpectedIo).not.toHaveBeenCalled();
    });
  }
});
