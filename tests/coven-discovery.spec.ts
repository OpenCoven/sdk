import { EventEmitter } from 'node:events';
import { chmodSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import {
  COVEN_DAEMON_PROTOCOL,
  CovenClient,
  CovenClientError,
  CovenIpcError,
  createCovenUnixTransport,
  createCovenWindowsTransport,
  createDiscoveredCovenClient,
  discoverCovenEndpoint,
  isCovenDaemonResponseError,
  isCovenIpcError,
  type CovenDiscoveredEndpoint,
  type CovenExecFile,
  type CovenExecFileError,
  type CovenSocket,
  type CovenUnixFileIdentity,
  type CovenWindowsPipeIdentity,
} from '@opencoven/coven-client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  cleanupOwnedTempRoot,
  createOwnedTempDirectory,
} from '../scripts/owned-temp-directory.mjs';

const HEALTH_BODY = JSON.stringify({
  ok: true,
  apiVersion: COVEN_DAEMON_PROTOCOL,
  covenVersion: '0.1.0',
  capabilities: {
    sessions: true,
    events: true,
    eventCursor: 'sequence',
    structuredErrors: true,
  },
});

function httpResponse(
  body: string,
  status = 200,
  headers: readonly string[] = [],
): Buffer {
  return Buffer.from(
    [
      `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Error'}`,
      `Content-Length: ${Buffer.byteLength(body)}`,
      ...headers,
      '',
      body,
    ].join('\r\n'),
  );
}

function configPathsReport(endpointPath: string, metadataPath: string): string {
  return JSON.stringify({
    schema: 'coven.config.paths',
    version: 1,
    surfaces: [
      {
        id: 'coven.home',
        status: 'resolved',
        path: resolve(endpointPath, '..'),
        source: 'default',
        access: 'read_only',
      },
      {
        id: 'state.daemon_metadata',
        status: 'resolved',
        path: metadataPath,
        source: 'default',
        access: 'read_only',
      },
      {
        id: 'state.daemon_ipc',
        status: 'resolved',
        path: endpointPath,
        source: 'default',
        access: 'read_only',
      },
      {
        id: 'dashboard.memory_companion_state',
        status: 'unsupported',
        source: 'default',
        access: 'read_only',
      },
    ],
  });
}

function execResult(
  stdout: string,
  stderr = '',
  error: CovenExecFileError | null = null,
): CovenExecFile {
  const implementation: CovenExecFile = (_file, _args, _options, callback) => {
    queueMicrotask(() => {
      callback(error, stdout, stderr);
    });
    return undefined;
  };
  return vi.fn(implementation);
}

class FakeSocket extends EventEmitter implements CovenSocket {
  readonly writes: Buffer[] = [];
  destroyed = false;
  ended = false;
  onWrite: ((request: Buffer) => void) | undefined;

  write(data: Uint8Array | string): boolean {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.writes.push(bytes);
    this.onWrite?.(bytes);
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function connectedSocket(response: Buffer): FakeSocket {
  const socket = new FakeSocket();
  socket.onWrite = () => {
    queueMicrotask(() => {
      socket.emit('data', response);
      socket.emit('end');
    });
  };
  queueMicrotask(() => {
    socket.emit('connect');
  });
  return socket;
}

function unixIdentity(
  overrides: Partial<CovenUnixFileIdentity> = {},
): CovenUnixFileIdentity {
  return {
    device: 7,
    inode: 11,
    mode: 0o140600,
    ownerUid: 501,
    symbolicLink: false,
    socket: true,
    ...overrides,
  };
}

function unixEndpoint(path: string): CovenDiscoveredEndpoint {
  return {
    version: 1,
    protocol: COVEN_DAEMON_PROTOCOL,
    source: 'coven_home',
    endpoint: { kind: 'unix', path },
    owner: { kind: 'unix', uid: 501 },
    freshness: {
      daemonPid: 42,
      daemonStartedAt: '2026-08-21T06:00:00Z',
    },
  };
}

function windowsEndpoint(path = '\\\\.\\pipe\\coven-daemon-v2-deadbeef.sock'): CovenDiscoveredEndpoint {
  return {
    version: 1,
    protocol: COVEN_DAEMON_PROTOCOL,
    source: 'config_paths',
    endpoint: { kind: 'windowsNamedPipe', path },
    freshness: {
      daemonPid: 42,
      daemonStartedAt: '2026-08-21T06:00:00Z',
      processCreationTime: '100',
    },
  };
}

function windowsIdentity(
  overrides: Partial<CovenWindowsPipeIdentity> = {},
): CovenWindowsPipeIdentity {
  return {
    ownerIdentity: 'S-1-5-21-current-user',
    ownerOnly: true,
    pipeIdentity: 'pipe-identity-1',
    serverProcessId: 42,
    processCreationTime: '100',
    ...overrides,
  };
}

let ownedRoot: ReturnType<typeof createOwnedTempDirectory>;

beforeEach(() => {
  ownedRoot = createOwnedTempDirectory({
    prefix: 'opencoven-coven-discovery-spec',
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanupOwnedTempRoot(ownedRoot);
});

describe('Coven endpoint discovery', () => {
  test('recognizes branded IPC errors without trusting hostile values', () => {
    const error = new CovenIpcError('not_found', 'missing', {
      phase: 'validate_endpoint',
    });
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter');
        },
      },
    );

    expect(isCovenIpcError(error)).toBe(true);
    expect(isCovenIpcError(null)).toBe(false);
    expect(isCovenIpcError(hostile)).toBe(false);
  });

  test('prefers non-empty COVEN_HOME without invoking the CLI', async () => {
    const execFile = execResult('must not be used');
    const home = resolve(ownedRoot.rootPath, 'profile');
    const socketPath = resolve(home, 'coven.sock');
    const metadataPath = resolve(home, 'daemon.json');
    const endpoint = await discoverCovenEndpoint({
      env: { COVEN_HOME: home, PATH: '/safe/bin', SECRET_TOKEN: 'redact-me' },
      platform: 'darwin',
      dependencies: {
        execFile,
        getEffectiveUid: () => 501,
        readFile: vi.fn((path) => {
          expect(path).toBe(metadataPath);
          return Promise.resolve(
            JSON.stringify({
              pid: 42,
              startedAt: '2026-08-21T06:00:00Z',
              socket: socketPath,
            }),
          );
        }),
      },
    });

    expect(endpoint).toEqual(unixEndpoint(socketPath));
    expect(execFile).not.toHaveBeenCalled();
  });

  test('falls back to exact no-shell config paths argv with a sanitized environment', async () => {
    const socketPath = resolve(ownedRoot.rootPath, 'coven.sock');
    const metadataPath = resolve(ownedRoot.rootPath, 'daemon.json');
    const execFile = execResult(configPathsReport(socketPath, metadataPath));

    await expect(
      discoverCovenEndpoint({
        cwd: ownedRoot.rootPath,
        env: {
          PATH: '/safe/bin',
          HOME: ownedRoot.rootPath,
          COVEN_HOME: '',
          SECRET_TOKEN: 'redact-me',
          AWS_SECRET_ACCESS_KEY: 'redact-me-too',
        },
        platform: 'linux',
        dependencies: {
          execFile,
          readFile: vi.fn(() =>
            Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
          ),
        },
      }),
    ).resolves.toMatchObject({
      protocol: COVEN_DAEMON_PROTOCOL,
      source: 'config_paths',
      endpoint: { kind: 'unix', path: socketPath },
    });

    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, options] = vi.mocked(execFile).mock.calls[0] ?? [];
    expect(file).toBe('coven');
    expect(args).toEqual(['config', 'paths', '--json']);
    expect(options).toMatchObject({
      encoding: 'utf8',
      cwd: ownedRoot.rootPath,
      shell: false,
      timeout: 2_000,
      maxBuffer: 65_536,
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    expect(options?.env).toEqual({
      HOME: ownedRoot.rootPath,
      PATH: '/safe/bin',
    });
  });

  test.each([
    {
      label: 'malformed JSON',
      stdout: '{"schema":',
      code: 'malformed_config',
    },
    {
      label: 'ambiguous JSON documents',
      stdout: '{}\n{}',
      code: 'malformed_config',
    },
    {
      label: 'wrong schema version',
      stdout: JSON.stringify({
        schema: 'coven.config.paths',
        version: 2,
        surfaces: [],
      }),
      code: 'malformed_config',
    },
    {
      label: 'wrong schema protocol',
      stdout: JSON.stringify({
        schema: 'coven.config.pathz',
        version: 1,
        surfaces: [],
      }),
      code: 'malformed_config',
    },
    {
      label: 'secret-bearing fields',
      stdout: JSON.stringify({
        schema: 'coven.config.paths',
        version: 1,
        token: 'must-not-survive',
        surfaces: [],
      }),
      code: 'malformed_config',
    },
  ])('rejects $label with stable diagnostics', async ({ stdout, code }) => {
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: { execFile: execResult(stdout) },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CovenIpcError);
    expect(error).toMatchObject({
      code,
      diagnostics: {
        phase: 'parse_config',
      },
    });
    expect(JSON.stringify(error)).not.toContain('must-not-survive');
  });

  test('rejects duplicate or malformed daemon IPC surfaces', async () => {
    const socketPath = resolve(ownedRoot.rootPath, 'coven.sock');
    const surface = {
      id: 'state.daemon_ipc',
      status: 'resolved',
      path: socketPath,
      source: 'default',
      access: 'read_only',
    };
    const report = JSON.stringify({
      schema: 'coven.config.paths',
      version: 1,
      surfaces: [surface, surface],
    });

    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        dependencies: { execFile: execResult(report) },
      }),
    ).rejects.toMatchObject({ code: 'malformed_config' });
  });

  test.each([
    {
      label: 'non-array surfaces',
      report: { schema: 'coven.config.paths', version: 1, surfaces: {} },
      code: 'malformed_config',
    },
    {
      label: 'invalid surface status',
      report: {
        schema: 'coven.config.paths',
        version: 1,
        surfaces: [
          {
            id: 'state.daemon_ipc',
            status: 'ready',
            path: '/safe/coven.sock',
            source: 'default',
            access: 'read_only',
          },
        ],
      },
      code: 'malformed_config',
    },
    {
      label: 'invalid surface source',
      report: {
        schema: 'coven.config.paths',
        version: 1,
        surfaces: [
          {
            id: 'state.daemon_ipc',
            status: 'resolved',
            path: '/safe/coven.sock',
            source: 'guess',
            access: 'read_only',
          },
        ],
      },
      code: 'malformed_config',
    },
    {
      label: 'writable surface',
      report: {
        schema: 'coven.config.paths',
        version: 1,
        surfaces: [
          {
            id: 'state.daemon_ipc',
            status: 'resolved',
            path: '/safe/coven.sock',
            source: 'default',
            access: 'read_write',
          },
        ],
      },
      code: 'malformed_config',
    },
    {
      label: 'invalid paths array',
      report: {
        schema: 'coven.config.paths',
        version: 1,
        surfaces: [
          {
            id: 'state.daemon_ipc',
            status: 'resolved',
            paths: ['/safe/coven.sock', 42],
            source: 'default',
            access: 'read_only',
          },
        ],
      },
      code: 'malformed_config',
    },
    {
      label: 'terminal surface with a path',
      report: {
        schema: 'coven.config.paths',
        version: 1,
        surfaces: [
          {
            id: 'state.daemon_ipc',
            status: 'unresolved',
            path: '/safe/coven.sock',
            source: 'default',
            access: 'read_only',
          },
        ],
      },
      code: 'malformed_config',
    },
    {
      label: 'missing daemon IPC surface',
      report: { schema: 'coven.config.paths', version: 1, surfaces: [] },
      code: 'not_found',
    },
  ])('rejects $label', async ({ report, code }) => {
    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        dependencies: { execFile: execResult(JSON.stringify(report)) },
      }),
    ).rejects.toMatchObject({ code });
  });

  test('rejects unsafe discovered endpoint paths', async () => {
    const report = configPathsReport('relative/coven.sock', resolve(ownedRoot.rootPath, 'daemon.json'));

    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        platform: 'linux',
        dependencies: { execFile: execResult(report) },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  });

  test('bounds command output and never exposes stdout or stderr contents', async () => {
    const secret = 'secret-output-value';
    const oversized = `${secret}${'x'.repeat(65_536)}`;
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: { execFile: execResult(oversized, secret) },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'body_limit',
      diagnostics: {
        phase: 'config_command',
        stdoutBytes: Buffer.byteLength(oversized),
        stderrBytes: Buffer.byteLength(secret),
      },
    });
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('rejects oversized stderr without exposing it', async () => {
    const stderr = `sensitive-stderr${'x'.repeat(65_536)}`;
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: { execFile: execResult('', stderr) },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'body_limit',
      diagnostics: { stderrBytes: Buffer.byteLength(stderr) },
    });
    expect(String(error)).not.toContain('sensitive-stderr');
  });

  test.each([
    {
      label: 'timeout',
      error: Object.assign(new Error('secret timeout output'), {
        code: 'ETIMEDOUT',
        killed: true,
        signal: 'SIGTERM',
      }),
      code: 'timeout',
    },
    {
      label: 'missing command',
      error: Object.assign(new Error('secret missing output'), { code: 'ENOENT' }),
      code: 'not_found',
    },
    {
      label: 'command failure',
      error: Object.assign(new Error('secret command output'), { code: 17 }),
      code: 'command_failed',
    },
  ])('reports $label without raw process output', async ({ error: commandError, code }) => {
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: {
        execFile: execResult('secret stdout', 'secret stderr', commandError),
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code,
      diagnostics: {
        phase: 'config_command',
        stdoutBytes: 13,
        stderrBytes: 13,
      },
    });
    expect(String(error)).not.toContain('secret');
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  test('classifies child-process max-buffer failures as body limits', async () => {
    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        dependencies: {
          execFile: execResult(
            '',
            '',
            Object.assign(new Error('max buffer'), {
              code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            }),
          ),
        },
      }),
    ).rejects.toMatchObject({ code: 'body_limit' });
  });

  test('sanitizes synchronous config command failures', async () => {
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: {
        execFile: () => {
          throw new Error('private synchronous detail');
        },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'command_failed' });
    expect(String(error)).not.toContain('private synchronous detail');
  });

  test('settles a timed-out config command even when its callback never runs', async () => {
    vi.useFakeTimers();
    const kill = vi.fn(() => true);
    const request = discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      timeoutMs: 10,
      dependencies: {
        execFile: () => ({ kill }),
      },
    });
    const rejection = request.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(35);

    await expect(rejection).resolves.toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'config_command' },
    });
    expect(kill).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('rejects a reported Unix IPC path outside the reported Coven home', async () => {
    const endpointPath = resolve(ownedRoot.rootPath, 'outside', 'coven.sock');
    const metadataPath = resolve(ownedRoot.rootPath, 'profile', 'daemon.json');
    const report = JSON.parse(
      configPathsReport(endpointPath, metadataPath),
    ) as {
      surfaces: Array<Record<string, unknown>>;
    };
    const homeSurface = report.surfaces.find(
      (surface) => surface.id === 'coven.home',
    );
    if (homeSurface === undefined) {
      throw new Error('Expected Coven home surface.');
    }
    homeSurface.path = resolve(ownedRoot.rootPath, 'profile');

    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        dependencies: {
          execFile: execResult(JSON.stringify(report)),
          readFile: () =>
            Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  });

  test.each([
    {
      label: 'invalid PID',
      metadata: {
        pid: 0,
        startedAt: '2026-08-21T06:00:00Z',
        socket: 'placeholder',
      },
      code: 'malformed_config',
    },
    {
      label: 'invalid start timestamp',
      metadata: {
        pid: 42,
        startedAt: 'not-a-date',
        socket: 'placeholder',
      },
      code: 'malformed_config',
    },
    {
      label: 'empty socket',
      metadata: {
        pid: 42,
        startedAt: '2026-08-21T06:00:00Z',
        socket: '',
      },
      code: 'malformed_config',
    },
    {
      label: 'extra secret',
      metadata: {
        pid: 42,
        startedAt: '2026-08-21T06:00:00Z',
        socket: 'placeholder',
        token: 'must-not-survive',
      },
      code: 'malformed_config',
    },
  ])('rejects daemon metadata with $label', async ({ metadata, code }) => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => 501,
          readFile: () =>
            Promise.resolve(
              JSON.stringify({
                ...metadata,
                socket:
                  metadata.socket === 'placeholder'
                    ? resolve(home, 'coven.sock')
                    : metadata.socket,
              }),
            ),
        },
      }),
    ).rejects.toMatchObject({ code });
  });

  test('rejects unreadable and oversized daemon metadata safely', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        dependencies: {
          readFile: () =>
            Promise.reject(Object.assign(new Error('private'), { code: 'EACCES' })),
        },
      }),
    ).rejects.toMatchObject({ code: 'command_failed' });

    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        dependencies: {
          readFile: () => Promise.resolve('x'.repeat(16 * 1024 + 1)),
        },
      }),
    ).rejects.toMatchObject({ code: 'body_limit' });
  });

  test('discovers the current Windows pipe and process freshness from COVEN_HOME', async () => {
    const endpoint = await discoverCovenEndpoint({
      cwd: 'C:\\workspace',
      env: { COVEN_HOME: 'C:\\profiles\\coven' },
      platform: 'win32',
      dependencies: {
        readFile: (path) => {
          expect(path).toBe('C:\\profiles\\coven\\daemon.json');
          return Promise.resolve(
            JSON.stringify({
              pid: 42,
              startedAt: '2026-08-21T06:00:00Z',
              socket: 'coven-daemon-v2-deadbeef.sock',
              processCreationTime: '100',
            }),
          );
        },
      },
    });

    expect(endpoint).toEqual({
      ...windowsEndpoint(),
      source: 'coven_home',
    });
  });

  test('fails closed when Windows COVEN_HOME has no daemon metadata', async () => {
    await expect(
      discoverCovenEndpoint({
        cwd: 'C:\\workspace',
        env: { COVEN_HOME: 'C:\\profiles\\coven' },
        platform: 'win32',
        dependencies: {
          readFile: () =>
            Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  test('rejects daemon metadata that points at another profile endpoint', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        dependencies: {
          readFile: () =>
            Promise.resolve(
              JSON.stringify({
                pid: 42,
                startedAt: '2026-08-21T06:00:00Z',
                socket: resolve(ownedRoot.rootPath, 'other.sock'),
              }),
            ),
        },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  });
});

describe('Unix owner-local health transport', () => {
  test('recognizes branded daemon response errors', () => {
    const error = Object.assign(new Error('daemon'), {
      daemon: {
        code: 'daemon.unavailable',
        message: 'Unavailable',
        details: null,
      },
      code: 'daemon.unavailable',
      statusCode: 503,
    });

    expect(isCovenDaemonResponseError(error)).toBe(false);
    expect(isCovenDaemonResponseError(null)).toBe(false);
  });

  test.each([
    ['symlink', unixIdentity({ symbolicLink: true })],
    ['non-socket', unixIdentity({ socket: false })],
    ['wrong uid', unixIdentity({ ownerUid: 502 })],
    ['unsafe mode', unixIdentity({ mode: 0o140660 })],
  ])('rejects a %s endpoint before connecting', async (_label, identity) => {
    const connect = vi.fn(() => connectedSocket(httpResponse(HEALTH_BODY)));
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect,
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(identity),
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: identity.ownerUid === 502 ? 'owner_mismatch' : 'unsafe_endpoint',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  test('allows group/world read bits when the Unix socket is not writable', async () => {
    const lstat = vi.fn(() =>
      Promise.resolve(unixIdentity({ mode: 0o140644 })),
    );
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
          getEffectiveUid: () => 501,
          lstat,
        },
      },
    );

    await expect(transport.health()).resolves.toMatchObject({ ok: true });
    expect(lstat).toHaveBeenCalledTimes(2);
  });

  test('reports a missing Unix socket distinctly', async () => {
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'missing.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
          getEffectiveUid: () => 501,
          lstat: () =>
            Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  test('rejects socket replacement immediately after connect', async () => {
    let inspection = 0;
    const socket = connectedSocket(httpResponse(HEALTH_BODY));
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => {
            queueMicrotask(() => {
              socket.emit('connect');
            });
            return socket;
          },
          getEffectiveUid: () => 501,
          lstat: () => {
            inspection += 1;
            return Promise.resolve(
              unixIdentity({ inode: inspection === 1 ? 11 : 12 }),
            );
          },
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  test('reports connection failure with deterministic cleanup', async () => {
    const socket = new FakeSocket();
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => {
            queueMicrotask(() => {
              socket.emit(
                'error',
                Object.assign(new Error('private socket detail'), {
                  code: 'ECONNREFUSED',
                }),
              );
            });
            return socket;
          },
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    const error: unknown = await transport.health().catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'connect_failure',
      diagnostics: { phase: 'connect' },
    });
    expect(String(error)).not.toContain('private socket detail');
    expect(socket.destroyed).toBe(true);
  });

  test.each([
    {
      label: 'oversized headers',
      response: Buffer.from(`HTTP/1.1 200 OK\r\nX-Fill: ${'x'.repeat(65_536)}\r\n\r\n`),
      code: 'frame_limit',
    },
    {
      label: 'oversized body declaration',
      response: Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 4194305\r\n\r\n'),
      code: 'body_limit',
    },
    {
      label: 'trailing bytes',
      response: Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}x'),
      code: 'frame_limit',
    },
  ])('rejects $label', async ({ response, code }) => {
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(response),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({ code });
  });

  test.each([
    Buffer.from('HTTP/1.1 nope\r\nContent-Length: 2\r\n\r\n{}'),
    Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
    Buffer.from(
      'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}',
    ),
    Buffer.from('HTTP/1.1 200 OK\r\nX-Test\r\nContent-Length: 2\r\n\r\n{}'),
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Length : 2\r\n\r\n{}'),
    Buffer.from('HTTP/1.1 200 OK\r\n\r\n{}'),
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n{}'),
  ])('rejects invalid HTTP health framing', async (response) => {
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(response),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  test.each([
    'not JSON',
    JSON.stringify({ nope: true }),
    JSON.stringify({
      error: {
        code: 'denied',
        message: 'Denied',
        details: { token: 'must-not-survive' },
      },
    }),
  ])('rejects malformed or secret-bearing daemon errors', async (body) => {
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(httpResponse(body, 500)),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  test('handles LF-delimited HTTP health framing', async () => {
    const response = Buffer.from(
      `HTTP/1.1 200 OK\nContent-Length: ${Buffer.byteLength(HEALTH_BODY)}\n\n${HEALTH_BODY}`,
    );
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(response),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).resolves.toEqual(JSON.parse(HEALTH_BODY));
  });

  test('completes once the declared response body is received without waiting for close', async () => {
    const socket = new FakeSocket();
    socket.onWrite = () => {
      queueMicrotask(() => {
        socket.emit('data', httpResponse(HEALTH_BODY));
      });
    };
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        requestTimeoutMs: 10,
        dependencies: {
          connect: () => {
            queueMicrotask(() => {
              socket.emit('connect');
            });
            return socket;
          },
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).resolves.toEqual(JSON.parse(HEALTH_BODY));
  });

  test('bounds endpoint revalidation under the request timeout', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        requestTimeoutMs: 10,
        dependencies: {
          connect: () => {
            queueMicrotask(() => {
              socket.emit('connect');
            });
            return socket;
          },
          getEffectiveUid: () => 501,
          lstat: vi
            .fn()
            .mockResolvedValueOnce(unixIdentity())
            .mockReturnValueOnce(new Promise(() => undefined)),
        },
      },
    );
    const result = transport.health().catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(await result).toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'read_response' },
    });
    expect(socket.destroyed).toBe(true);
  });

  test('rejects invalid UTF-8 response bodies', async () => {
    const body = Buffer.from([0xff]);
    const response = Buffer.concat([
      Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n'),
      body,
    ]);
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(response),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  test('reports connect timeout and honors cancellation', async () => {
    vi.useFakeTimers();
    const timeoutSocket = new FakeSocket();
    const timeoutTransport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        connectTimeoutMs: 10,
        dependencies: {
          connect: () => timeoutSocket,
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );
    const timedOut = timeoutTransport.health().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await timedOut).toMatchObject({ code: 'timeout' });
    expect(timeoutSocket.destroyed).toBe(true);

    const controller = new AbortController();
    const abortSocket = new FakeSocket();
    const abortTransport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => abortSocket,
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );
    const aborted = abortTransport.health({ signal: controller.signal, deadline: undefined });
    controller.abort(new Error('stop'));
    await expect(aborted).rejects.toThrow('stop');
    expect(abortSocket.destroyed).toBe(true);
  });

  test('maps synchronous connector failures without leaking their message', async () => {
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => {
            throw new Error('private connector detail');
          },
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    const error: unknown = await transport.health().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'connect_failure' });
    expect(String(error)).not.toContain('private connector detail');
  });

  test.runIf(process.platform !== 'win32')(
    'uses the real Node Unix socket connector with owner-only validation',
    async () => {
      const shortRoot = createOwnedTempDirectory({ prefix: 'c' });
      const socketPath = resolve(shortRoot.rootPath, 's');
      const server = createServer((socket) => {
        socket.once('data', () => {
          socket.end(httpResponse(HEALTH_BODY));
        });
      });
      await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolvePromise);
      });
      chmodSync(socketPath, 0o600);

      try {
        const uid = process.geteuid?.();
        if (uid === undefined) {
          throw new Error('Expected effective UID on Unix.');
        }
        const transport = createCovenUnixTransport({
          version: 1,
          protocol: COVEN_DAEMON_PROTOCOL,
          source: 'coven_home',
          endpoint: { kind: 'unix', path: socketPath },
          owner: { kind: 'unix', uid },
        });

        await expect(transport.health()).resolves.toEqual(JSON.parse(HEALTH_BODY));
      } finally {
        await new Promise<void>((resolvePromise) => {
          server.close(() => {
            resolvePromise();
          });
        });
        cleanupOwnedTempRoot(shortRoot);
      }
    },
  );

  test('rejects a non-Unix discovered endpoint', () => {
    expect(() =>
      createCovenUnixTransport(windowsEndpoint()),
    ).toThrow(expect.objectContaining({ code: 'unsafe_endpoint' }));
  });

  test('rejects unsupported discovered endpoint versions and protocols', () => {
    const endpoint = unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock'));

    expect(() =>
      createCovenUnixTransport({
        ...endpoint,
        version: 2 as 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'unsafe_endpoint' }));
    expect(() =>
      createCovenUnixTransport({
        ...endpoint,
        protocol: 'coven.daemon.v2' as typeof COVEN_DAEMON_PROTOCOL,
      }),
    ).toThrow(expect.objectContaining({ code: 'unsafe_endpoint' }));
  });

  test('sends only the reviewed health request and parses a valid response', async () => {
    const socket = connectedSocket(httpResponse(HEALTH_BODY));
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => {
            queueMicrotask(() => {
              socket.emit('connect');
            });
            return socket;
          },
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    await expect(transport.health()).resolves.toEqual(JSON.parse(HEALTH_BODY));
    expect(Buffer.concat(socket.writes).toString('utf8')).toBe(
      'GET /api/v1/health HTTP/1.1\r\n' +
        'Host: coven\r\n' +
        'Accept: application/json\r\n' +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n\r\n',
    );
    expect(socket.destroyed).toBe(true);
  });
});

describe('Windows owner-local health transport', () => {
  test.each([
    '\\\\server\\pipe\\coven',
    '\\\\?\\pipe\\coven',
    '\\\\.\\pipe\\..\\coven',
  ])('rejects a remote or unsafe pipe %s', (path) => {
    expect(() =>
      createCovenWindowsTransport(windowsEndpoint(path), {
        ownership: {
          currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
          inspect: () => Promise.resolve(windowsIdentity()),
          inspectConnected: () => Promise.resolve(windowsIdentity()),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'unsafe_endpoint' }));
  });

  test('rejects a pipe owned by another user before connecting', async () => {
    const connect = vi.fn(() => connectedSocket(httpResponse(HEALTH_BODY)));
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: { connect },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () =>
          Promise.resolve(windowsIdentity({ ownerIdentity: 'S-1-5-21-other-user' })),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });

    await expect(transport.health()).rejects.toMatchObject({
      code: 'owner_mismatch',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  test('rejects unsafe pipe ACLs before connecting', async () => {
    const connect = vi.fn(() => connectedSocket(httpResponse(HEALTH_BODY)));
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: { connect },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () => Promise.resolve(windowsIdentity({ ownerOnly: false })),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });

    await expect(transport.health()).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  test('rejects identity replacement at connection time', async () => {
    const socket = connectedSocket(httpResponse(HEALTH_BODY));
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () => {
          queueMicrotask(() => {
            socket.emit('connect');
          });
          return socket;
        },
      },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () => Promise.resolve(windowsIdentity()),
        inspectConnected: () =>
          Promise.resolve(windowsIdentity({ pipeIdentity: 'replacement-pipe' })),
      },
    });

    await expect(transport.health()).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  test('validates the owner twice and returns health', async () => {
    const inspect = vi.fn(() => Promise.resolve(windowsIdentity()));
    const inspectConnected = vi.fn(() => Promise.resolve(windowsIdentity()));
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
      },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect,
        inspectConnected,
      },
    });

    await expect(transport.health()).resolves.toEqual(JSON.parse(HEALTH_BODY));
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspectConnected).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      label: 'empty current user identity',
      current: '',
      initial: windowsIdentity(),
      code: 'owner_mismatch',
    },
    {
      label: 'missing current user identity',
      current: undefined as unknown as string,
      initial: windowsIdentity(),
      code: 'owner_mismatch',
    },
    {
      label: 'invalid server process id',
      current: 'S-1-5-21-current-user',
      initial: windowsIdentity({ serverProcessId: 0 }),
      code: 'unsafe_endpoint',
    },
    {
      label: 'invalid process creation time',
      current: 'S-1-5-21-current-user',
      initial: windowsIdentity({ processCreationTime: '' }),
      code: 'unsafe_endpoint',
    },
    {
      label: 'missing process creation time',
      current: 'S-1-5-21-current-user',
      initial: windowsIdentity({
        processCreationTime: undefined as unknown as string,
      }),
      code: 'unsafe_endpoint',
    },
  ])('rejects $label', async ({ current, initial, code }) => {
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
      },
      ownership: {
        currentUserIdentity: () => Promise.resolve(current),
        inspect: () => Promise.resolve(initial),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });

    await expect(transport.health()).rejects.toMatchObject({ code });
  });

  test('rejects failed ownership inspection and discovered owner mismatch', async () => {
    const inspectionFailure = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
      },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () => Promise.reject(new Error('private native detail')),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });
    await expect(inspectionFailure.health()).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });

    const ownerMismatchEndpoint = {
      ...windowsEndpoint(),
      owner: { kind: 'windows' as const, identity: 'S-1-5-21-other-user' },
    };
    const mismatch = createCovenWindowsTransport(ownerMismatchEndpoint, {
      dependencies: {
        connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
      },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () => Promise.resolve(windowsIdentity()),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });
    await expect(mismatch.health()).rejects.toMatchObject({
      code: 'owner_mismatch',
    });
  });

  test('rejects connected-pipe inspection failure', async () => {
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
      },
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () => Promise.resolve(windowsIdentity()),
        inspectConnected: () => Promise.reject(new Error('private native detail')),
      },
    });

    await expect(transport.health()).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
  });

  test('shares frame limits and structured daemon errors with Unix', async () => {
    const ownership = {
      currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
      inspect: () => Promise.resolve(windowsIdentity()),
      inspectConnected: () => Promise.resolve(windowsIdentity()),
    };
    const oversized = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () =>
          connectedSocket(
            Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 4194305\r\n\r\n'),
          ),
      },
      ownership,
    });
    await expect(oversized.health()).rejects.toMatchObject({
      code: 'body_limit',
    });

    const body = JSON.stringify({
      error: {
        code: 'daemon.busy',
        message: 'Busy',
        details: { state: 'starting' },
      },
    });
    const refused = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: {
        connect: () => connectedSocket(httpResponse(body, 503)),
      },
      ownership,
    });
    await expect(refused.health()).rejects.toMatchObject({
      code: 'daemon.busy',
      statusCode: 503,
      daemon: {
        code: 'daemon.busy',
        message: 'Busy',
        details: { state: 'starting' },
      },
    });
  });
});

describe('structured client behavior', () => {
  test('creates a discovered client with the constrained platform transport', async () => {
    const socketPath = resolve(ownedRoot.rootPath, 'coven.sock');
    const metadataPath = resolve(ownedRoot.rootPath, 'daemon.json');
    const client = await createDiscoveredCovenClient({
      discovery: {
        env: { PATH: '/safe/bin' },
        platform: 'linux',
        dependencies: {
          execFile: execResult(configPathsReport(socketPath, metadataPath)),
          getEffectiveUid: () => 501,
          readFile: () =>
            Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        },
      },
      unix: {
        dependencies: {
          connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    });

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
  });

  test('requires a Windows ownership adapter for discovered clients', async () => {
    await expect(
      createDiscoveredCovenClient({
        discovery: {
          cwd: 'C:\\workspace',
          env: { COVEN_HOME: 'C:\\profiles\\coven' },
          platform: 'win32',
          dependencies: {
            readFile: () =>
              Promise.resolve(
                JSON.stringify({
                  pid: 42,
                  startedAt: '2026-08-21T06:00:00Z',
                  socket: 'coven-daemon-v2-deadbeef.sock',
                  processCreationTime: '100',
                }),
              ),
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  });

  test('preserves structured daemon error fields without flattening them', async () => {
    const body = JSON.stringify({
      error: {
        code: 'daemon.unavailable',
        message: 'Daemon is unavailable',
        details: { state: 'stale' },
      },
    });
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(httpResponse(body, 503)),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );
    const client = new CovenClient({ transport });

    const error: unknown = await client.health().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CovenClientError);
    expect(error).toMatchObject({
      code: 'daemon.unavailable',
      statusCode: 503,
      daemon: {
        code: 'daemon.unavailable',
        message: 'Daemon is unavailable',
        details: { state: 'stale' },
      },
    });
  });

  test('rejects a health response with the wrong daemon protocol', async () => {
    const client = new CovenClient({
      transport: {
        health: () =>
          Promise.resolve({
            ...JSON.parse(HEALTH_BODY),
            apiVersion: 'coven.daemon.v2',
          }),
      },
    });

    await expect(client.health()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
