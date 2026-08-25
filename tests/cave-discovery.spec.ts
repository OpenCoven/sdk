import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir as nodeTmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  CaveDiscoveryError,
  createDiscoveredCaveClient,
  discoverCave,
  isCaveDiscoveryError,
  parseCaveDiscoveryRecord,
  type CaveDiscoveryRecord,
} from '@opencoven/cave-client';
import fc from 'fast-check';
import { afterEach, describe, expect, test, vi } from 'vitest';

const VALID_RECORD = {
  version: 1,
  endpoint: 'http://127.0.0.1:3020',
  pid: 4321,
  nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba003',
  startedAt: '2026-08-20T20:20:12.617Z',
} as const;
const scratchRoots: string[] = [];

function tmpdir(): string {
  return realpathSync(nodeTmpdir());
}

afterEach(() => {
  vi.useRealTimers();
  while (scratchRoots.length > 0) {
    const root = scratchRoots.pop();
    if (root !== undefined) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

describe('Cave Client v1 discovery', () => {
  test('parses the reviewed live discovery record', () => {
    const record: CaveDiscoveryRecord = parseCaveDiscoveryRecord(
      VALID_RECORD,
      {
        isProcessAlive: (pid) => pid === VALID_RECORD.pid,
      },
    );

    expect(record).toEqual(VALID_RECORD);
  });

  test('recognizes discovery errors across package instances without invoking getters', () => {
    const error = new CaveDiscoveryError(
      'not_found',
      'missing',
      { phase: 'validate_root' },
    );
    const hostile = {};
    Object.defineProperty(hostile, Symbol.for('@opencoven/cave-client/CaveDiscoveryError'), {
      get() {
        throw new Error('hostile getter');
      },
    });

    expect(isCaveDiscoveryError(error)).toBe(true);
    expect(isCaveDiscoveryError(hostile)).toBe(false);
  });

  test('rejects a non-loopback discovery endpoint', () => {
    expect(() =>
      parseCaveDiscoveryRecord(
        {
          ...VALID_RECORD,
          endpoint: 'http://example.com:3020',
        },
        { isProcessAlive: () => true },
      ),
    ).toThrowError(CaveDiscoveryError);
    expect(() =>
      parseCaveDiscoveryRecord(
        {
          ...VALID_RECORD,
          endpoint: 'http://example.com:3020',
        },
        { isProcessAlive: () => true },
      ),
    ).toThrowError(expect.objectContaining({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'parse_record' },
    }));
  });

  test.each([
    'https://127.0.0.1:3020',
    'http://user@127.0.0.1:3020',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:3020/path',
    'http://127.0.0.1:3020?query=1',
    'http://127.0.0.1:3020#fragment',
    'http://127.0.0.1:3020/%2fremote',
    'http://127.0.0.1:3020/\n',
  ])('rejects an unsafe endpoint shape: %s', (endpoint) => {
    expect(() =>
      parseCaveDiscoveryRecord(
        { ...VALID_RECORD, endpoint },
        { isProcessAlive: () => true },
      ),
    ).toThrowError(expect.objectContaining({
      code: 'unsafe_endpoint',
    }));
  });

  test('rejects unsafe accessors without invoking them', () => {
    let invoked = false;
    const record = { ...VALID_RECORD } as Record<string, unknown>;
    Object.defineProperty(record, 'endpoint', {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error('hostile getter');
      },
    });

    expect(() =>
      parseCaveDiscoveryRecord(record, { isProcessAlive: () => true }),
    ).toThrowError(expect.objectContaining({
      code: 'malformed_record',
    }));
    expect(invoked).toBe(false);
  });

  test('rejects a discovery record for a stale process', () => {
    expect(() =>
      parseCaveDiscoveryRecord(VALID_RECORD, { isProcessAlive: () => false }),
    ).toThrowError(expect.objectContaining({
      code: 'stale_process',
      retryable: true,
      diagnostics: { phase: 'parse_record' },
    }));
  });

  test.each([
    { ...VALID_RECORD, nonce: '' },
    { ...VALID_RECORD, nonce: 'a'.repeat(257) },
    { ...VALID_RECORD, nonce: 'nonce\nvalue' },
    { ...VALID_RECORD, startedAt: 'not-a-timestamp' },
    { ...VALID_RECORD, startedAt: '1970-01-01T00:00:00.000Z' },
    { ...VALID_RECORD, startedAt: '2026-02-30T20:20:12.617Z' },
    { ...VALID_RECORD, startedAt: '2026-13-01T20:20:12.617Z' },
    { ...VALID_RECORD, startedAt: '2026-08-20T24:20:12.617Z' },
    { ...VALID_RECORD, unexpected: true },
  ])('rejects a malformed required record field: %j', (record) => {
    expect(() =>
      parseCaveDiscoveryRecord(record, { isProcessAlive: () => true }),
    ).toThrowError(expect.objectContaining({
      code: 'malformed_record',
      retryable: false,
    }));
  });

  test('accepts every explicit valid port on reviewed loopback hosts', () => {
    expect(
      parseCaveDiscoveryRecord(
        { ...VALID_RECORD, endpoint: 'http://127.0.0.1:80' },
        { isProcessAlive: () => true },
      ).endpoint,
    ).toBe('http://127.0.0.1:80');

    fc.assert(
      fc.property(
        fc.constantFrom('127.0.0.1', 'localhost', '[::1]'),
        fc.integer({ min: 1, max: 65_535 }),
        (host, port) => {
          const endpoint = `http://${host}:${port}`;
          expect(
            parseCaveDiscoveryRecord(
              { ...VALID_RECORD, endpoint },
              { isProcessAlive: () => true },
            ).endpoint,
          ).toBe(endpoint);
        },
      ),
    );
  });

  test('discovers the fixed Client v1 record from COVEN_CAVE_HOME', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD, null, 2)}\n`,
      { mode: 0o600 },
    );

    await expect(
      discoverCave({
        env: {
          COVEN_CAVE_HOME: root,
          COVEN_HOME: '/must-not-use',
        },
        dependencies: {
          isProcessAlive: () => true,
        },
      }),
    ).resolves.toEqual({
      ...VALID_RECORD,
      source: 'coven_cave_home',
    });
  });

  test('falls back to the fixed cave directory beneath COVEN_HOME', async () => {
    const covenHome = mkdtempSync(resolve(tmpdir(), 'opencoven-home-'));
    scratchRoots.push(covenHome);
    const root = resolve(covenHome, 'cave');
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );

    await expect(
      discoverCave({
        env: { COVEN_HOME: covenHome },
        dependencies: { isProcessAlive: () => true },
      }),
    ).resolves.toMatchObject({
      ...VALID_RECORD,
      source: 'coven_home',
    });
  });

  test('falls back to the fixed cave directory beneath the owner home', async () => {
    const home = mkdtempSync(resolve(tmpdir(), 'opencoven-owner-home-'));
    scratchRoots.push(home);
    const root = resolve(home, '.coven', 'cave');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );

    await expect(
      discoverCave({
        env: {},
        dependencies: {
          getHomeDirectory: () => home,
          isProcessAlive: () => true,
        },
      }),
    ).resolves.toMatchObject({
      ...VALID_RECORD,
      source: 'user_home',
    });
  });

  test('rejects a symlinked discovery root', async () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(scratch);
    const physicalRoot = resolve(scratch, 'physical');
    const configuredRoot = resolve(scratch, 'configured');
    mkdirSync(physicalRoot, { mode: 0o700 });
    writeFileSync(
      resolve(physicalRoot, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    symlinkSync(physicalRoot, configuredRoot);

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: configuredRoot },
        dependencies: { isProcessAlive: () => true },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_root',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test('rejects a discovery root reached through a symlinked parent', async () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(scratch);
    const physicalParent = resolve(scratch, 'physical-parent');
    const configuredParent = resolve(scratch, 'configured-parent');
    const root = resolve(physicalParent, 'cave');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    symlinkSync(physicalParent, configuredParent);

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: resolve(configuredParent, 'cave') },
        dependencies: { isProcessAlive: () => true },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_root',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test.each([
    { rootMode: 0o755, recordMode: 0o600, phase: 'validate_root' },
    { rootMode: 0o700, recordMode: 0o644, phase: 'validate_record' },
  ] as const)(
    'rejects unsafe owner-local filesystem modes at $phase',
    async ({ rootMode, recordMode, phase }) => {
      const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
      scratchRoots.push(root);
      chmodSync(root, rootMode);
      const recordPath = resolve(root, 'client-v1-discovery.json');
      writeFileSync(recordPath, `${JSON.stringify(VALID_RECORD)}\n`, {
        mode: recordMode,
      });
      chmodSync(recordPath, recordMode);

      await expect(
        discoverCave({
          env: { COVEN_CAVE_HOME: root },
          dependencies: { isProcessAlive: () => true },
        }),
      ).rejects.toMatchObject({
        code: 'unsafe_mode',
        diagnostics: { phase },
      });
    },
  );

  test('rejects a discovery root owned by another Unix user', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => (process.geteuid?.() ?? 0) + 1,
          isProcessAlive: () => true,
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test('rejects Unix discovery when the effective user cannot be established', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => undefined,
          isProcessAlive: () => true,
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test('requires an injected Windows ownership validator', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
    );

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        platform: 'win32',
        dependencies: { isProcessAlive: () => true },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_root',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test('rejects a Windows discovery object denied by the trust provider', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
    );

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        platform: 'win32',
        dependencies: {
          isProcessAlive: () => true,
          windowsFileTrust: {
            validate: () => false,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'owner_mismatch',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test('rejects a discovery record replaced between inspection and open', async () => {
    const rootIdentity = {
      device: 1,
      inode: 1,
      mode: 0o700,
      ownerUid: 501,
      directory: true,
      regularFile: false,
      size: 0,
      symbolicLink: false,
    };
    const recordIdentity = {
      device: 1,
      inode: 2,
      mode: 0o600,
      ownerUid: 501,
      directory: false,
      regularFile: true,
      size: 100,
      symbolicLink: false,
    };

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: '/physical-cave-home' },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => 501,
          isProcessAlive: () => true,
          lstat: (path: string) =>
            Promise.resolve(
              path.endsWith('client-v1-discovery.json')
                ? recordIdentity
                : rootIdentity,
            ),
          realpath: () => Promise.resolve('/physical-cave-home'),
          openFile: () => Promise.resolve({
            close: () => Promise.resolve(),
            read: () => Promise.resolve({ bytesRead: 0 }),
            stat: () => Promise.resolve({
              ...recordIdentity,
              inode: 3,
            }),
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: 'replaced_record',
      diagnostics: { phase: 'validate_record' },
    });
  });

  test('creates a compatibility-checked client bound to the discovered Cave instance', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    const requests: Array<{
      input: string;
      signal: AbortSignal | null;
    }> = [];

    const client = await createDiscoveredCaveClient({
      discovery: {
        env: { COVEN_CAVE_HOME: root },
        dependencies: { isProcessAlive: () => true },
      },
      http: {
        fetch: (input, init) => {
          expect(init).toMatchObject({
            cache: 'no-store',
            credentials: 'omit',
            method: 'GET',
            redirect: 'error',
          });
          requests.push({
            input:
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url,
            signal: init?.signal ?? null,
          });
          return Promise.resolve(new Response(
            JSON.stringify({
              apiVersion: '1.0',
              capabilities: ['health', 'pairing'],
              minimumClientVersion: '0.1.0',
              operations: ['health.read', 'pairing.create'],
              data: {
                instanceId: 'cave-instance-1',
                pairingRequired: true,
                releaseVersion: '0.3.9',
              },
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200,
            },
          ));
        },
      },
      timeoutMs: 1_000,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(
      'http://127.0.0.1:3020/api/client/v1/health',
    );
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(client.discovery).toEqual({
      ...VALID_RECORD,
      source: 'coven_cave_home',
      instanceId: 'cave-instance-1',
    });
  });

  test('normalizes a missing discovery location without exposing its path', async () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(scratch);
    const missingRoot = resolve(scratch, 'private-cave-home');

    const error = await discoverCave({
      env: { COVEN_CAVE_HOME: missingRoot },
      dependencies: { isProcessAlive: () => true },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'not_found',
      retryable: true,
      diagnostics: { phase: 'validate_root' },
    });
    expect(JSON.stringify(error)).not.toContain(missingRoot);
  });

  test('fails closed when the health response exceeds its body limit', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );

    await expect(
      createDiscoveredCaveClient({
        discovery: {
          env: { COVEN_CAVE_HOME: root },
          dependencies: { isProcessAlive: () => true },
        },
        http: {
          fetch: () => Promise.resolve(new Response('x'.repeat(65))),
          maxBodyBytes: 64,
        },
      }),
    ).rejects.toMatchObject({
      normalized: {
        code: 'body_limit',
        operation: 'health',
        system: 'cave',
      },
    });
  });

  test('cancels a streamed health response immediately after its body limit is exceeded', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(65));
      },
    });

    await expect(
      createDiscoveredCaveClient({
        discovery: {
          env: { COVEN_CAVE_HOME: root },
          dependencies: { isProcessAlive: () => true },
        },
        http: {
          fetch: () => Promise.resolve(new Response(body)),
          maxBodyBytes: 64,
        },
      }),
    ).rejects.toMatchObject({
      normalized: { code: 'body_limit' },
    });
    expect(cancelled).toBe(true);
  });

  test('cancels a streamed health response when the operation is aborted', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
    });

    await expect(
      createDiscoveredCaveClient({
        discovery: {
          env: { COVEN_CAVE_HOME: root },
          dependencies: { isProcessAlive: () => true },
        },
        http: {
          fetch: () => Promise.resolve(new Response(body)),
        },
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    expect(cancelled).toBe(true);
  });

  test('cancels a health response whose declared content length exceeds the limit', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      createDiscoveredCaveClient({
        discovery: {
          env: { COVEN_CAVE_HOME: root },
          dependencies: { isProcessAlive: () => true },
        },
        http: {
          fetch: () =>
            Promise.resolve(
              new Response(body, {
                headers: { 'content-length': '65' },
              }),
            ),
          maxBodyBytes: 64,
        },
      }),
    ).rejects.toMatchObject({
      normalized: { code: 'body_limit' },
    });
    expect(cancelled).toBe(true);
  });

  test.each([300, 404, 500])(
    'rejects Cave health HTTP status %s before compatibility succeeds',
    async (status) => {
      const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
      scratchRoots.push(root);
      chmodSync(root, 0o700);
      writeFileSync(
        resolve(root, 'client-v1-discovery.json'),
        `${JSON.stringify(VALID_RECORD)}\n`,
        { mode: 0o600 },
      );

      await expect(
        createDiscoveredCaveClient({
          discovery: {
            env: { COVEN_CAVE_HOME: root },
            dependencies: { isProcessAlive: () => true },
          },
          http: {
            fetch: () =>
              Promise.resolve(
                new Response(
                  JSON.stringify({
                    apiVersion: '1.0',
                    capabilities: ['health'],
                    minimumClientVersion: '0.1.0',
                    operations: ['health.read'],
                    data: {
                      instanceId: 'must-not-bind',
                      pairingRequired: true,
                      releaseVersion: '0.3.9',
                    },
                  }),
                  { status },
                ),
              ),
          },
        }),
      ).rejects.toMatchObject({
        normalized: {
          code: 'http_status',
          retryable: status >= 500,
          statusCode: status,
        },
      });
    },
  );

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid health response limit %s',
    async (maxBodyBytes) => {
      const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
      scratchRoots.push(root);
      chmodSync(root, 0o700);
      writeFileSync(
        resolve(root, 'client-v1-discovery.json'),
        `${JSON.stringify(VALID_RECORD)}\n`,
        { mode: 0o600 },
      );

      await expect(
        createDiscoveredCaveClient({
          discovery: {
            env: { COVEN_CAVE_HOME: root },
            dependencies: { isProcessAlive: () => true },
          },
          http: {
            fetch: () => Promise.reject(new Error('must not fetch')),
            maxBodyBytes,
          },
        }),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  test('validates HTTP options before starting discovery I/O', async () => {
    let lstatCalls = 0;

    await expect(
      createDiscoveredCaveClient({
        discovery: {
          env: { COVEN_CAVE_HOME: '/must-not-read' },
          dependencies: {
            lstat: () => {
              lstatCalls += 1;
              return Promise.reject(new Error('must not run'));
            },
          },
        },
        http: { maxBodyBytes: 0 },
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(lstatCalls).toBe(0);
  });

  test('uses one absolute timeout across discovery and health negotiation', async () => {
    vi.useFakeTimers();
    const serialized = Buffer.from(`${JSON.stringify(VALID_RECORD)}\n`);
    const rootIdentity = {
      device: 1,
      inode: 1,
      mode: 0o700,
      ownerUid: 0,
      directory: true,
      regularFile: false,
      size: 0,
      symbolicLink: false,
    };
    const recordIdentity = {
      device: 1,
      inode: 2,
      mode: 0o600,
      ownerUid: 0,
      directory: false,
      regularFile: true,
      size: serialized.byteLength,
      symbolicLink: false,
    };
    let validationCalls = 0;
    let healthStarted = false;
    const result = createDiscoveredCaveClient({
      discovery: {
        env: { COVEN_CAVE_HOME: '/physical-cave-home' },
        platform: 'win32',
        dependencies: {
          isProcessAlive: () => true,
          lstat: (path) =>
            Promise.resolve(
              path.endsWith('client-v1-discovery.json')
                ? recordIdentity
                : rootIdentity,
            ),
          openFile: () => {
            let read = false;
            return Promise.resolve({
              close: () => Promise.resolve(),
              read: (buffer, offset, length) => {
                if (read) {
                  return Promise.resolve({ bytesRead: 0 });
                }
                read = true;
                const bytes = serialized.subarray(0, length);
                buffer.set(bytes, offset);
                return Promise.resolve({ bytesRead: bytes.byteLength });
              },
              stat: () => Promise.resolve(recordIdentity),
            });
          },
          realpath: () => Promise.resolve('/physical-cave-home'),
          windowsFileTrust: {
            validate: () => {
              validationCalls += 1;
              return validationCalls === 1
                ? new Promise<boolean>((resolvePromise) => {
                    setTimeout(() => resolvePromise(true), 2_100);
                  })
                : true;
            },
          },
        },
      },
      http: {
        fetch: async () => {
          healthStarted = true;
          await new Promise((resolvePromise) => {
            setTimeout(resolvePromise, 1_000);
          });
          return new Response('{}');
        },
      },
      timeoutMs: 2_500,
    });
    const caught = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(2_100);
    expect(healthStarted).toBe(true);
    await vi.advanceTimersByTimeAsync(400);

    await expect(caught).resolves.toMatchObject({
      code: 'timeout',
      retryable: true,
    });
  });

  test('honors pre-cancellation without starting discovery I/O', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    let lstatCalls = 0;

    await expect(
      discoverCave({
        signal: controller.signal,
        dependencies: {
          lstat: () => {
            lstatCalls += 1;
            return Promise.reject(new Error('must not run'));
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
    expect(lstatCalls).toBe(0);
  });

  test('does not start another discovery step after its deadline expires', async () => {
    const rootIdentity = {
      device: 1,
      inode: 1,
      mode: 0o700,
      ownerUid: 501,
      directory: true,
      regularFile: false,
      size: 0,
      symbolicLink: false,
    };
    let lstatCalls = 0;
    let realpathCalls = 0;

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: '/physical-cave-home' },
        platform: 'linux',
        timeoutMs: 5,
        dependencies: {
          getEffectiveUid: () => 501,
          isProcessAlive: () => true,
          lstat: async () => {
            lstatCalls += 1;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
            return rootIdentity;
          },
          realpath: () => {
            realpathCalls += 1;
            return Promise.resolve('/physical-cave-home');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'timeout' });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
    expect(lstatCalls).toBe(1);
    expect(realpathCalls).toBe(0);
  });

  test('detects a different Cave instance at the bound endpoint', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );
    let healthCalls = 0;
    const client = await createDiscoveredCaveClient({
      discovery: {
        env: { COVEN_CAVE_HOME: root },
        dependencies: { isProcessAlive: () => true },
      },
      http: {
        fetch: () => {
          healthCalls += 1;
          return Promise.resolve(new Response(JSON.stringify({
            apiVersion: '1.0',
            capabilities: ['health'],
            minimumClientVersion: '0.1.0',
            operations: ['health.read'],
            data: {
              instanceId:
                healthCalls === 1 ? 'cave-instance-1' : 'cave-instance-2',
              pairingRequired: true,
              releaseVersion: '0.3.9',
            },
          })));
        },
      },
    });

    await expect(client.health()).rejects.toMatchObject({
      normalized: {
        code: 'instance_changed',
        operation: 'health',
        system: 'cave',
      },
    });
  });

  test('normalizes malformed health JSON from the fixed Client v1 route', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
      { mode: 0o600 },
    );

    await expect(
      createDiscoveredCaveClient({
        discovery: {
          env: { COVEN_CAVE_HOME: root },
          dependencies: { isProcessAlive: () => true },
        },
        http: {
          fetch: () => Promise.resolve(new Response('{')),
        },
      }),
    ).rejects.toMatchObject({
      normalized: {
        code: 'invalid_response',
        operation: 'health',
        system: 'cave',
      },
    });
  });

  test('rejects a symlinked discovery record', async () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(scratch);
    const root = resolve(scratch, 'cave');
    const target = resolve(scratch, 'record.json');
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(target, `${JSON.stringify(VALID_RECORD)}\n`, { mode: 0o600 });
    symlinkSync(target, resolve(root, 'client-v1-discovery.json'));

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        dependencies: { isProcessAlive: () => true },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_record',
      diagnostics: { phase: 'validate_record' },
    });
  });

  test.each([
    {
      bytes: '{',
      code: 'malformed_record',
      diagnostics: { phase: 'parse_record' },
    },
    {
      bytes: 'x'.repeat(16 * 1024 + 1),
      code: 'body_limit',
      diagnostics: { phase: 'read_record', limitBytes: 16 * 1024 },
    },
  ])('fails closed for invalid discovery bytes: $code', async (expected) => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    chmodSync(root, 0o700);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      expected.bytes,
      { mode: 0o600 },
    );

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        dependencies: { isProcessAlive: () => true },
      }),
    ).rejects.toMatchObject({
      code: expected.code,
      diagnostics: expected.diagnostics,
    });
  });

  test('uses the injected Windows trust provider for both root and record', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(root);
    writeFileSync(
      resolve(root, 'client-v1-discovery.json'),
      `${JSON.stringify(VALID_RECORD)}\n`,
    );
    const purposes: string[] = [];

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: root },
        platform: 'win32',
        dependencies: {
          isProcessAlive: () => true,
          windowsFileTrust: {
            validate: (_path, purpose) => {
              purposes.push(purpose);
              return true;
            },
          },
        },
      }),
    ).resolves.toMatchObject(VALID_RECORD);
    expect(new Set(purposes)).toEqual(new Set(['root', 'record']));
  });

  test('rejects a discovery root replaced while its record is read', async () => {
    const serialized = Buffer.from(`${JSON.stringify(VALID_RECORD)}\n`);
    const rootIdentity = {
      device: 1,
      inode: 1,
      mode: 0o700,
      ownerUid: 501,
      directory: true,
      regularFile: false,
      size: 0,
      symbolicLink: false,
    };
    const recordIdentity = {
      device: 1,
      inode: 2,
      mode: 0o600,
      ownerUid: 501,
      directory: false,
      regularFile: true,
      size: serialized.byteLength,
      symbolicLink: false,
    };
    let realpathCalls = 0;

    await expect(
      discoverCave({
        env: { COVEN_CAVE_HOME: '/physical-cave-home' },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => 501,
          isProcessAlive: () => true,
          lstat: (path) =>
            Promise.resolve(
              path.endsWith('client-v1-discovery.json')
                ? recordIdentity
                : rootIdentity,
            ),
          openFile: () => {
            let read = false;
            return Promise.resolve({
              close: () => Promise.resolve(),
              read: (buffer, offset) => {
                if (read) {
                  return Promise.resolve({ bytesRead: 0 });
                }
                read = true;
                buffer.set(serialized, offset);
                return Promise.resolve({ bytesRead: serialized.byteLength });
              },
              stat: () => Promise.resolve(recordIdentity),
            });
          },
          realpath: () => {
            realpathCalls += 1;
            return Promise.resolve(
              realpathCalls === 1
                ? '/physical-cave-home'
                : '/replacement-cave-home',
            );
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'replaced_root',
      diagnostics: { phase: 'validate_root' },
    });
  });

  test('redacts filesystem locations from lifecycle event metadata', async () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'opencoven-cave-discovery-'));
    scratchRoots.push(scratch);
    const missingRoot = resolve(scratch, 'secret-owner-path');
    const events: unknown[] = [];

    await discoverCave({
      env: { COVEN_CAVE_HOME: missingRoot },
      observer: {
        onEvent(event) {
          events.push(event);
        },
        onObserverError(error) {
          throw error;
        },
      },
    }).catch(() => undefined);

    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(missingRoot);
    expect(events[1]).toMatchObject({
      phase: 'failure',
      error: {
        code: 'not_found',
        operation: 'discover',
        system: 'cave',
      },
    });
  });
});
