import { EventEmitter } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import {
  COVEN_DAEMON_PROTOCOL,
  CovenClient,
  CovenClientError,
  CovenDaemonResponseError,
  CovenIpcError,
  createCovenUnixTransport as createRawCovenUnixTransport,
  createCovenWindowsTransport as createRawCovenWindowsTransport,
  createDiscoveredCovenClient,
  discoverCovenEndpoint,
  isCovenDaemonResponseError,
  isCovenIpcError,
  type CovenConnectedSocket,
  type CovenDiscoveryFileIdentity,
  type CovenDiscoveredEndpoint,
  type CovenExecFile,
  type CovenExecFileError,
  type CovenMetadataFileHandle,
  type CovenSocket,
  type CovenUnixFileIdentity,
  type CovenUnixTransportOptions,
  type CovenWindowsPipeIdentity,
  type CovenWindowsPipeOwnershipAdapter,
  type CovenWindowsTransportOptions,
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

function configPathsReport(
  endpointPath: string,
  metadataPath: string,
  homePath = resolve(endpointPath, '..'),
): string {
  return JSON.stringify({
    schema: 'coven.config.paths',
    version: 1,
    surfaces: [
      {
        id: 'coven.home',
        status: 'resolved',
        path: homePath,
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
  connecting = false;
  destroyed = false;
  ended = false;
  paused = false;
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

  pause(): this {
    this.paused = true;
    return this;
  }

  resume(): this {
    this.paused = false;
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

interface TestUnixPeerIdentity {
  uid: number;
  gid?: number;
  pid?: number;
}

interface TestUnixTransportOptions
  extends Omit<CovenUnixTransportOptions, 'security'> {
  peerIdentity?: {
    inspectConnected(socket: CovenConnectedSocket): Promise<TestUnixPeerIdentity>;
  };
}

function unixPeerIdentity(
  overrides: Partial<TestUnixPeerIdentity> = {},
): TestUnixPeerIdentity {
  return {
    uid: 501,
    ...overrides,
  };
}

function discoveryFileIdentity(
  overrides: Partial<CovenDiscoveryFileIdentity> = {},
): CovenDiscoveryFileIdentity {
  return {
    device: 7,
    inode: 11,
    mode: 0o100755,
    ownerUid: 501,
    regularFile: true,
    size: 128,
    symbolicLink: false,
    ...overrides,
  };
}

function memoryMetadataFile(
  serialized: string,
  options: {
    close?: () => Promise<void>;
    read?: CovenMetadataFileHandle['read'];
    stat?: () => Promise<CovenDiscoveryFileIdentity>;
  } = {},
): CovenMetadataFileHandle {
  let position = 0;
  const bytes = Buffer.from(serialized);
  return {
    close: options.close ?? (() => Promise.resolve()),
    read:
      options.read ??
      ((buffer, offset, length) => {
        const bytesRead = Math.min(length, bytes.length - position);
        if (bytesRead > 0) {
          buffer.set(bytes.subarray(position, position + bytesRead), offset);
          position += bytesRead;
        }
        return Promise.resolve({ bytesRead });
      }),
    stat:
      options.stat ??
      (() =>
        Promise.resolve(
          discoveryFileIdentity({
            mode: 0o100600,
            size: bytes.length,
          }),
        )),
  };
}

const TRUSTED_UNIX_COVEN = '/opt/opencoven/bin/coven';
const TRUSTED_WINDOWS_COVEN = 'C:\\Program Files\\Coven\\coven.exe';

function trustedCommandDependencies(
  execFile: CovenExecFile,
  overrides: Record<string, unknown> = {},
) {
  return {
    execFile,
    getEffectiveUid: () => 501,
    resolveExecutable: () => Promise.resolve(TRUSTED_UNIX_COVEN),
    realpath: (path: string) => Promise.resolve(path),
    lstat: (path: string) =>
      path === TRUSTED_UNIX_COVEN
        ? Promise.resolve(discoveryFileIdentity())
        : Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    openFile: () =>
      Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    ...overrides,
  };
}

function metadataDependencies(
  metadataPath: string,
  serialized: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    getEffectiveUid: () => 501,
    lstat: (path: string) =>
      path === metadataPath
        ? Promise.resolve(
            discoveryFileIdentity({
              mode: 0o100600,
              size: Buffer.byteLength(serialized),
            }),
          )
        : Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    openFile: (path: string) =>
      path === metadataPath
        ? Promise.resolve(memoryMetadataFile(serialized))
        : Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    ...overrides,
  };
}

function windowsDiscoveryDependencies(
  execFile: CovenExecFile,
  metadataPath: string,
  serialized: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    execFile,
    resolveExecutable: () => Promise.resolve(TRUSTED_WINDOWS_COVEN),
    realpath: (path: string) => Promise.resolve(path),
    lstat: (path: string) => {
      if (path === TRUSTED_WINDOWS_COVEN) {
        return Promise.resolve(discoveryFileIdentity());
      }
      if (path === metadataPath) {
        return Promise.resolve(
          discoveryFileIdentity({
            mode: 0o100600,
            size: Buffer.byteLength(serialized),
          }),
        );
      }
      return Promise.reject(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );
    },
    openFile: (path: string) =>
      path === metadataPath
        ? Promise.resolve(memoryMetadataFile(serialized))
        : Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    windowsFileTrust: {
      validate: () => Promise.resolve(true),
    },
    ...overrides,
  };
}

function createCovenUnixTransport(
  discovered: CovenDiscoveredEndpoint,
  options: TestUnixTransportOptions = {},
) {
  const { peerIdentity, ...transportOptions } = options;
  return createRawCovenUnixTransport(discovered, {
    ...transportOptions,
    security: {
      platform: 'unix',
      peerIdentity:
        peerIdentity ??
        {
          inspectConnected: () => Promise.resolve(unixPeerIdentity()),
        },
    },
  });
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

interface TestWindowsTransportOptions
  extends Omit<CovenWindowsTransportOptions, 'security'> {
  ownership?: CovenWindowsPipeOwnershipAdapter;
}

function createCovenWindowsTransport(
  discovered: CovenDiscoveredEndpoint,
  options: TestWindowsTransportOptions = {},
) {
  const { ownership, ...transportOptions } = options;
  return createRawCovenWindowsTransport(discovered, {
    ...transportOptions,
    security: {
      platform: 'windows',
      ownership:
        ownership ??
        {
          currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
          inspect: () => Promise.resolve(windowsIdentity()),
          inspectConnected: () => Promise.resolve(windowsIdentity()),
        },
    },
  });
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
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: socketPath,
    });
    const endpoint = await discoverCovenEndpoint({
      env: { COVEN_HOME: home, PATH: '/safe/bin', SECRET_TOKEN: 'redact-me' },
      platform: 'darwin',
      dependencies: {
        execFile,
        ...metadataDependencies(metadataPath, metadata),
      },
    });

    expect(endpoint).toEqual(unixEndpoint(socketPath));
    expect(execFile).not.toHaveBeenCalled();
  });

  test.runIf(process.platform !== 'win32')(
    'reads owner-safe Unix metadata through the default bounded file adapter',
    async () => {
      const home = resolve(ownedRoot.rootPath, 'default-file-adapter');
      const socketPath = resolve(home, 'coven.sock');
      await mkdir(home);
      await writeFile(
        resolve(home, 'daemon.json'),
        JSON.stringify({
          pid: 42,
          startedAt: '2026-08-21T06:00:00Z',
          socket: socketPath,
        }),
        { mode: 0o600 },
      );
      await chmod(resolve(home, 'daemon.json'), 0o600);

      await expect(
        discoverCovenEndpoint({
          env: { COVEN_HOME: home },
          platform: process.platform,
        }),
      ).resolves.toMatchObject({
        endpoint: { kind: 'unix', path: socketPath },
        freshness: {
          daemonPid: 42,
          daemonStartedAt: '2026-08-21T06:00:00Z',
        },
      });
    },
  );

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
        dependencies: trustedCommandDependencies(execFile),
      }),
    ).resolves.toMatchObject({
      protocol: COVEN_DAEMON_PROTOCOL,
      source: 'config_paths',
      endpoint: { kind: 'unix', path: socketPath },
    });

    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, options] = vi.mocked(execFile).mock.calls[0] ?? [];
    expect(file).toBe(TRUSTED_UNIX_COVEN);
    expect(args).toEqual(['config', 'paths', '--json']);
    expect(options).toMatchObject({
      encoding: 'utf8',
      cwd: ownedRoot.rootPath,
      shell: false,
      maxBuffer: 65_536,
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    expect(options?.timeout).toBeGreaterThan(0);
    expect(options?.timeout).toBeLessThanOrEqual(2_000);
    expect(options?.env).toEqual({
      HOME: ownedRoot.rootPath,
      PATH: '/safe/bin',
    });
  });

  test('passes an integer timeout to Node execFile', async () => {
    const socketPath = resolve(ownedRoot.rootPath, 'coven.sock');
    const metadataPath = resolve(ownedRoot.rootPath, 'daemon.json');
    const report = configPathsReport(socketPath, metadataPath);
    const timeouts: number[] = [];
    const execFile: CovenExecFile = (_file, _args, options, callback) => {
      timeouts.push(options.timeout);
      if (!Number.isInteger(options.timeout)) {
        throw new TypeError('execFile timeout must be an integer');
      }
      queueMicrotask(() => {
        callback(null, report, '');
      });
      return undefined;
    };

    await expect(
      discoverCovenEndpoint({
        cwd: ownedRoot.rootPath,
        env: { PATH: '/safe/bin' },
        platform: 'linux',
        timeoutMs: 100.75,
        dependencies: trustedCommandDependencies(execFile),
      }),
    ).resolves.toMatchObject({
      endpoint: { kind: 'unix', path: socketPath },
    });
    expect(timeouts).toHaveLength(1);
    expect(Number.isInteger(timeouts[0])).toBe(true);
  });

  test('does not allow callers to override the Coven executable', async () => {
    const socketPath = resolve(ownedRoot.rootPath, 'coven.sock');
    const metadataPath = resolve(ownedRoot.rootPath, 'daemon.json');
    const execFile = execResult(configPathsReport(socketPath, metadataPath));

    await discoverCovenEndpoint({
      command: 'attacker-controlled-coven',
      env: { PATH: '/safe/bin' },
      dependencies: trustedCommandDependencies(execFile),
    } as Parameters<typeof discoverCovenEndpoint>[0]);

    expect(execFile).toHaveBeenCalledWith(
      TRUSTED_UNIX_COVEN,
      ['config', 'paths', '--json'],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
  });

  test.each([
    ['relative path', 'bin/coven', 'bin/coven'],
    ['wrong executable name', '/opt/opencoven/bin/coven-copy', '/opt/opencoven/bin/coven-copy'],
    ['non-canonical path', '/opt/opencoven/bin/../bin/coven', TRUSTED_UNIX_COVEN],
  ])('rejects a trusted resolver returning a %s', async (_label, executable, canonical) => {
    const execFile = execResult('{}');

    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/attacker/bin' },
        platform: 'linux',
        dependencies: trustedCommandDependencies(execFile, {
          resolveExecutable: () => Promise.resolve(executable),
          realpath: () => Promise.resolve(canonical),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'config_command' },
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  test.each([
    ['symlink', discoveryFileIdentity({ symbolicLink: true })],
    ['non-file', discoveryFileIdentity({ regularFile: false })],
    ['non-executable', discoveryFileIdentity({ mode: 0o100600 })],
    ['unsafe mode', discoveryFileIdentity({ mode: 0o100775 })],
    ['wrong owner', discoveryFileIdentity({ ownerUid: 502 })],
  ])('rejects a trusted Unix Coven executable with %s', async (_label, identity) => {
    const execFile = execResult('{}');

    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/attacker/bin' },
        platform: 'linux',
        dependencies: trustedCommandDependencies(execFile, {
          lstat: () => Promise.resolve(identity),
        }),
      }),
    ).rejects.toMatchObject({
      code: identity.ownerUid === 502 ? 'owner_mismatch' : 'unsafe_endpoint',
      diagnostics: { phase: 'config_command' },
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  test('requires the injected Windows executable trust validator', async () => {
    const execFile = execResult('{}');

    await expect(
      discoverCovenEndpoint({
        env: {},
        platform: 'win32',
        dependencies: {
          execFile,
          resolveExecutable: () => Promise.resolve(TRUSTED_WINDOWS_COVEN),
          realpath: (path) => Promise.resolve(path),
          lstat: () => Promise.resolve(discoveryFileIdentity()),
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'config_command' },
    });
    expect(execFile).not.toHaveBeenCalled();
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
    const execFile = execResult(stdout);
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: trustedCommandDependencies(execFile),
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
        dependencies: trustedCommandDependencies(execResult(report)),
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
        dependencies: trustedCommandDependencies(
          execResult(JSON.stringify(report)),
        ),
      }),
    ).rejects.toMatchObject({ code });
  });

  test('rejects unsafe discovered endpoint paths', async () => {
    const report = configPathsReport('relative/coven.sock', resolve(ownedRoot.rootPath, 'daemon.json'));

    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        platform: 'linux',
        dependencies: trustedCommandDependencies(execResult(report)),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
  });

  test('bounds command output and never exposes stdout or stderr contents', async () => {
    const secret = 'secret-output-value';
    const oversized = `${secret}${'x'.repeat(65_536)}`;
    const execFile = execResult(oversized, secret);
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: trustedCommandDependencies(execFile),
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
    const execFile = execResult('', stderr);
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: trustedCommandDependencies(execFile),
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
    const execFile = execResult('secret stdout', 'secret stderr', commandError);
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: trustedCommandDependencies(execFile),
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
    const execFile = execResult(
      '',
      '',
      Object.assign(new Error('max buffer'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }),
    );
    await expect(
      discoverCovenEndpoint({
        env: { PATH: '/safe/bin' },
        dependencies: trustedCommandDependencies(execFile),
      }),
    ).rejects.toMatchObject({ code: 'body_limit' });
  });

  test('sanitizes synchronous config command failures', async () => {
    const execFile: CovenExecFile = () => {
      throw new Error('private synchronous detail');
    };
    const error: unknown = await discoverCovenEndpoint({
      env: { PATH: '/safe/bin' },
      dependencies: trustedCommandDependencies(execFile),
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
      dependencies: trustedCommandDependencies(() => ({ kill })),
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
        dependencies: trustedCommandDependencies(
          execResult(JSON.stringify(report)),
        ),
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
    const metadataPath = resolve(home, 'daemon.json');
    const serialized = JSON.stringify({
      ...metadata,
      socket:
        metadata.socket === 'placeholder'
          ? resolve(home, 'coven.sock')
          : metadata.socket,
    });
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: metadataDependencies(metadataPath, serialized),
      }),
    ).rejects.toMatchObject({ code });
  });

  test('rejects unsafe and oversized daemon metadata before materializing it', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => 501,
          lstat: () =>
            Promise.resolve(discoveryFileIdentity({ regularFile: false })),
          openFile: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });

    const read = vi.fn<CovenMetadataFileHandle['read']>(
      (buffer, offset, length) => {
        buffer.fill(0x78, offset, offset + length);
        return Promise.resolve({ bytesRead: length });
      },
    );
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: metadataDependencies(metadataPath, '{}', {
          lstat: () =>
            Promise.resolve(
              discoveryFileIdentity({
                mode: 0o100600,
                size: 16 * 1024 + 1,
              }),
            ),
          openFile: () => Promise.resolve(memoryMetadataFile('', { read })),
        }),
      }),
    ).rejects.toMatchObject({ code: 'body_limit' });
    expect(read).not.toHaveBeenCalled();
  });

  test.each([
    ['symlink', discoveryFileIdentity({ symbolicLink: true })],
    ['FIFO', discoveryFileIdentity({ regularFile: false, mode: 0o010600 })],
    ['device', discoveryFileIdentity({ regularFile: false, mode: 0o020600 })],
    ['unsafe mode', discoveryFileIdentity({ mode: 0o100660 })],
    ['wrong owner', discoveryFileIdentity({ ownerUid: 502 })],
  ])('rejects daemon metadata with %s before open', async (_label, identity) => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    const openFile = vi.fn();

    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: {
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(identity),
          openFile,
        },
      }),
    ).rejects.toMatchObject({
      code: identity.ownerUid === 502 ? 'owner_mismatch' : 'unsafe_endpoint',
      diagnostics: { phase: 'read_metadata' },
    });
    expect(openFile).not.toHaveBeenCalled();
  });

  test('reads at most the daemon metadata limit plus one byte', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const read = vi.fn<CovenMetadataFileHandle['read']>(
      (buffer, offset, length) => {
        buffer.fill(0x78, offset, offset + length);
        return Promise.resolve({ bytesRead: length });
      },
    );

    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: metadataDependencies(metadataPath, '{}', {
          lstat: () =>
            Promise.resolve(
              discoveryFileIdentity({ mode: 0o100600, size: 0 }),
            ),
          openFile: () => Promise.resolve(memoryMetadataFile('', { read })),
        }),
      }),
    ).rejects.toMatchObject({ code: 'body_limit' });

    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[2]).toBe(16 * 1024 + 1);
  });

  test('rejects metadata path replacement after open and closes the handle', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: resolve(home, 'coven.sock'),
    });
    const close = vi.fn(() => Promise.resolve());
    const read = vi.fn<CovenMetadataFileHandle['read']>(() =>
      Promise.resolve({ bytesRead: 0 }),
    );

    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: metadataDependencies(metadataPath, metadata, {
          openFile: () =>
            Promise.resolve(
              memoryMetadataFile(metadata, {
                close,
                read,
                stat: () =>
                  Promise.resolve(
                    discoveryFileIdentity({
                      inode: 12,
                      mode: 0o100600,
                      size: Buffer.byteLength(metadata),
                    }),
                  ),
              }),
            ),
        }),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'read_metadata' },
    });
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  test('uses safe nonblocking flags and rejects a FIFO opened after lstat', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: resolve(home, 'coven.sock'),
    });
    let openFlags: number | undefined;
    const close = vi.fn(() => Promise.resolve());
    const openFile = vi.fn((_path: string, flags?: number) => {
      openFlags = flags;
      return Promise.resolve(
        memoryMetadataFile(metadata, {
          close,
          stat: () =>
            Promise.resolve(
              discoveryFileIdentity({
                mode: 0o010600,
                regularFile: false,
                size: 0,
              }),
            ),
        }),
      );
    });

    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: metadataDependencies(metadataPath, metadata, {
          openFile,
        }),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'read_metadata' },
    });
    expect(openFlags).toBeTypeOf('number');
    expect((openFlags as number) & fsConstants.O_NONBLOCK).toBe(
      fsConstants.O_NONBLOCK,
    );
    if (typeof fsConstants.O_NOFOLLOW === 'number') {
      expect((openFlags as number) & fsConstants.O_NOFOLLOW).toBe(
        fsConstants.O_NOFOLLOW,
      );
    }
    expect(
      (openFlags as number) & (fsConstants.O_WRONLY | fsConstants.O_RDWR),
    ).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });

  test.each(['lstat', 'open', 'stat', 'read', 'close'])(
    'applies the discovery deadline to a stalled metadata %s',
    async (stage) => {
      vi.useFakeTimers();
      const home = resolve(ownedRoot.rootPath, 'profile');
      const metadataPath = resolve(home, 'daemon.json');
      const metadata = JSON.stringify({
        pid: 42,
        startedAt: '2026-08-21T06:00:00Z',
        socket: resolve(home, 'coven.sock'),
      });
      const never = () => new Promise<never>(() => undefined);
      const dependencies = metadataDependencies(metadataPath, metadata, {
        lstat:
          stage === 'lstat'
            ? never
            : () =>
                Promise.resolve(
                  discoveryFileIdentity({
                    mode: 0o100600,
                    size: Buffer.byteLength(metadata),
                  }),
                ),
        openFile:
          stage === 'open'
            ? never
            : () =>
                Promise.resolve(
                  memoryMetadataFile(metadata, {
                    ...(stage === 'stat' ? { stat: never } : {}),
                    ...(stage === 'read' ? { read: never } : {}),
                    ...(stage === 'close' ? { close: never } : {}),
                  }),
                ),
      });
      const result = discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        timeoutMs: 10,
        dependencies,
      }).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10);

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'read_metadata' },
      });
    },
  );

  test('closes a metadata handle after fstat timeout and absorbs late rejection', async () => {
    vi.useFakeTimers();
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: resolve(home, 'coven.sock'),
    });
    const close = vi.fn(() => Promise.resolve());
    let rejectStat: ((error: Error) => void) | undefined;
    const stat = vi.fn(
      () =>
        new Promise<CovenDiscoveryFileIdentity>((_resolve, reject) => {
          rejectStat = reject;
        }),
    );
    const result = discoverCovenEndpoint({
      env: { COVEN_HOME: home },
      platform: 'linux',
      timeoutMs: 10,
      dependencies: metadataDependencies(metadataPath, metadata, {
        openFile: () =>
          Promise.resolve(memoryMetadataFile(metadata, { close, stat })),
      }),
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'read_metadata' },
    });
    expect(close).toHaveBeenCalledOnce();

    rejectStat?.(new Error('late private fstat failure'));
    await vi.advanceTimersByTimeAsync(0);
  });

  test('closes a metadata handle that opens after the discovery deadline', async () => {
    vi.useFakeTimers();
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const close = vi.fn(() => Promise.resolve());
    let resolveOpen: ((handle: CovenMetadataFileHandle) => void) | undefined;
    const openFile = new Promise<CovenMetadataFileHandle>((resolvePromise) => {
      resolveOpen = resolvePromise;
    });
    const open = vi.fn(() => openFile);
    const result = discoverCovenEndpoint({
      env: { COVEN_HOME: home },
      platform: 'linux',
      timeoutMs: 10,
      dependencies: metadataDependencies(metadataPath, '{}', {
        openFile: open,
      }),
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ code: 'timeout' });

    resolveOpen?.(memoryMetadataFile('{}', { close }));
    await vi.advanceTimersByTimeAsync(0);

    expect(close).toHaveBeenCalledOnce();
  });

  test('rejects a discovery step that settles at its 1ms absolute deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const home = resolve(ownedRoot.rootPath, 'profile');
    let rejectLstat: ((error: Error) => void) | undefined;
    const result = discoverCovenEndpoint({
      env: { COVEN_HOME: home },
      platform: 'linux',
      timeoutMs: 1,
      dependencies: {
        getEffectiveUid: () => 501,
        lstat: () =>
          new Promise<CovenDiscoveryFileIdentity>((_resolve, reject) => {
            rejectLstat = reject;
          }),
        openFile: vi.fn(),
      },
    }).catch((error: unknown) => error);

    try {
      await vi.advanceTimersByTimeAsync(0);
      now = 1;
      rejectLstat?.(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'read_metadata' },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('rejects discovery when final endpoint assembly reaches the deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const home = resolve(ownedRoot.rootPath, 'profile');

    try {
      const result = discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        timeoutMs: 1,
        dependencies: {
          getEffectiveUid: () => {
            now = 1;
            return 501;
          },
          lstat: () =>
            Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
          openFile: vi.fn(),
        },
      }).catch((error: unknown) => error);

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'validate_endpoint' },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('cleans up a resource that settles at the discovery deadline without using it', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const close = vi.fn(() =>
      Promise.reject(new Error('private late cleanup failure')),
    );
    const stat = vi.fn(() =>
      Promise.resolve(
        discoveryFileIdentity({
          mode: 0o100600,
          size: 0,
        }),
      ),
    );
    let resolveOpen: ((handle: CovenMetadataFileHandle) => void) | undefined;
    const openFile = vi.fn(
      () =>
        new Promise<CovenMetadataFileHandle>((resolvePromise) => {
          resolveOpen = resolvePromise;
        }),
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const result = discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        timeoutMs: 1,
        dependencies: metadataDependencies(metadataPath, '{}', {
          openFile,
        }),
      }).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      expect(openFile).toHaveBeenCalledOnce();
      now = 1;
      resolveOpen?.(memoryMetadataFile('{}', { close, stat }));
      await vi.advanceTimersByTimeAsync(0);

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'read_metadata' },
      });
      expect(stat).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      nowSpy.mockRestore();
    }
  });

  test('uses the selected Windows profile state.daemon_ipc even with COVEN_HOME', async () => {
    const metadataPath = 'C:\\profiles\\coven\\daemon.json';
    const report = configPathsReport(
      '\\\\.\\pipe\\coven-daemon-v2-deadbeef.sock',
      metadataPath,
      'C:\\profiles\\coven',
    );
    const execFile = execResult(report);
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: 'coven-daemon-v2-deadbeef.sock',
      processCreationTime: '100',
    });
    const endpoint = await discoverCovenEndpoint({
      cwd: 'C:\\workspace',
      env: { COVEN_HOME: 'C:\\profiles\\coven' },
      platform: 'win32',
      dependencies: windowsDiscoveryDependencies(
        execFile,
        metadataPath,
        metadata,
      ),
    });

    expect(endpoint).toEqual({
      ...windowsEndpoint(),
      source: 'config_paths',
    });
    const [file, args, options] = vi.mocked(execFile).mock.calls[0] ?? [];
    expect(file).toBe(TRUSTED_WINDOWS_COVEN);
    expect(args).toEqual(['config', 'paths', '--json']);
    expect(options?.shell).toBe(false);
    expect(options?.env.COVEN_HOME).toBe('C:\\profiles\\coven');
  });

  test('rejects copied Windows daemon metadata instead of following its socket', async () => {
    const metadataPath = 'C:\\profiles\\selected\\daemon.json';
    const selectedPipe = '\\\\.\\pipe\\coven-daemon-v2-selected.sock';
    const copiedPipe = 'coven-daemon-v2-other-profile.sock';
    const execFile = execResult(
      configPathsReport(
        selectedPipe,
        metadataPath,
        'C:\\profiles\\selected',
      ),
    );
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: copiedPipe,
      processCreationTime: '100',
    });

    await expect(
      discoverCovenEndpoint({
        cwd: 'C:\\workspace',
        env: { COVEN_HOME: 'C:\\profiles\\selected' },
        platform: 'win32',
        dependencies: windowsDiscoveryDependencies(
          execFile,
          metadataPath,
          metadata,
        ),
      }),
    ).rejects.toMatchObject({ code: 'unsafe_endpoint' });
    expect(execFile).toHaveBeenCalledOnce();
  });

  test('rejects a Windows config-path report for a different profile', async () => {
    const metadataPath = 'C:\\profiles\\other\\daemon.json';
    const execFile = execResult(
      configPathsReport(
        '\\\\.\\pipe\\coven-daemon-v2-other.sock',
        metadataPath,
        'C:\\profiles\\other',
      ),
    );

    await expect(
      discoverCovenEndpoint({
        cwd: 'C:\\workspace',
        env: { COVEN_HOME: 'C:\\profiles\\selected' },
        platform: 'win32',
        dependencies: windowsDiscoveryDependencies(
          execFile,
          metadataPath,
          '{}',
        ),
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'validate_endpoint' },
    });
  });

  test('rejects daemon metadata that points at another profile endpoint', async () => {
    const home = resolve(ownedRoot.rootPath, 'profile');
    const metadataPath = resolve(home, 'daemon.json');
    const metadata = JSON.stringify({
      pid: 42,
      startedAt: '2026-08-21T06:00:00Z',
      socket: resolve(ownedRoot.rootPath, 'other.sock'),
    });
    await expect(
      discoverCovenEndpoint({
        env: { COVEN_HOME: home },
        platform: 'linux',
        dependencies: metadataDependencies(metadataPath, metadata),
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

  test('validates uid-only peer credentials before revalidating the pathname', async () => {
    const validationOrder: string[] = [];
    let inspections = 0;
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => connectedSocket(httpResponse(HEALTH_BODY)),
          getEffectiveUid: () => 501,
          lstat: () => {
            inspections += 1;
            validationOrder.push(`lstat-${inspections}`);
            return Promise.resolve(unixIdentity());
          },
        },
        peerIdentity: {
          inspectConnected: () => {
            validationOrder.push('peer');
            return Promise.resolve({ uid: 501 });
          },
        },
      },
    );

    await expect(transport.health()).resolves.toMatchObject({ ok: true });
    expect(validationOrder).toEqual(['lstat-1', 'peer', 'lstat-2']);
  });

  test.each([
    ['device', unixIdentity({ device: 8 })],
    ['inode', unixIdentity({ inode: 12 })],
    ['owner', unixIdentity({ ownerUid: 0 })],
    ['mode', unixIdentity({ mode: 0o140400 })],
    ['socket type', unixIdentity({ socket: false })],
  ])('rejects a post-connect pathname %s change', async (_label, confirmed) => {
    let inspection = 0;
    const socket = new FakeSocket();
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
              inspection === 1 ? unixIdentity() : confirmed,
            );
          },
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: confirmed.ownerUid === 0 ? 'owner_mismatch' : 'unsafe_endpoint',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  test('rejects a connected Unix peer owned by another effective user', async () => {
    const socket = new FakeSocket();
    socket.onWrite = () => {
      queueMicrotask(() => {
        socket.emit('data', httpResponse(HEALTH_BODY));
        socket.emit('end');
      });
    };
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
        peerIdentity: {
          inspectConnected: (connected) => {
            expect(connected).toBe(socket);
            return Promise.resolve(unixPeerIdentity({ uid: 502 }));
          },
        },
      },
    );

    await expect(transport.health()).rejects.toMatchObject({
      code: 'owner_mismatch',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  test('fails closed at construction when Unix peer security is unavailable', () => {
    expect(() => {
      Reflect.apply(createRawCovenUnixTransport, undefined, [
        unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
        {},
      ]);
    }).toThrow(expect.objectContaining({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'validate_endpoint' },
    }));
  });

  test('constructs directly with Unix security', () => {
    expect(() => {
      createRawCovenUnixTransport(
        unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
        {
          security: {
            platform: 'unix',
            peerIdentity: {
              inspectConnected: () => Promise.resolve(unixPeerIdentity()),
            },
          },
        },
      );
    }).not.toThrow();
  });

  test('fails closed at construction with Windows security', () => {
    expect(() => {
      Reflect.apply(createRawCovenUnixTransport, undefined, [
        unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
        {
          security: {
            platform: 'windows',
            ownership: {
              currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
              inspect: () => Promise.resolve(windowsIdentity()),
              inspectConnected: () => Promise.resolve(windowsIdentity()),
            },
          },
        },
      ]);
    }).toThrow(expect.objectContaining({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'validate_endpoint' },
    }));
  });

  test('sanitizes synchronous Unix connected-peer inspection failures', async () => {
    const socket = new FakeSocket();
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
        peerIdentity: {
          inspectConnected: () => {
            throw new Error('private native peer detail');
          },
        },
      },
    );

    const error: unknown = await transport.health().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(String(error)).not.toContain('private native peer detail');
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

  test.each([
    {
      error: {
        code: 'daemon.busy',
        message: 'Busy',
        status: 503,
        requestId: 'safe-additive-field',
      },
      expected: {
        code: 'daemon.busy',
        message: 'Busy',
        status: 503,
      },
    },
    {
      error: {
        code: 'daemon.busy',
        message: 'Busy',
        status: 503,
        details: { state: 'starting' },
        documentation: 'https://example.invalid/errors/daemon.busy',
      },
      expected: {
        code: 'daemon.busy',
        message: 'Busy',
        status: 503,
        details: { state: 'starting' },
      },
    },
  ])('accepts safe additive daemon error fields and optional details', async ({
    error,
    expected,
  }) => {
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () =>
            connectedSocket(httpResponse(JSON.stringify({ error }), 503)),
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
      },
    );

    const failure: unknown = await transport.health().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'daemon.busy',
      statusCode: 503,
    });
    if (!(failure instanceof CovenDaemonResponseError)) {
      throw new TypeError('Expected CovenDaemonResponseError.');
    }
    expect(failure.daemon).toEqual(expected);
  });

  test.each([
    {
      label: 'deep object',
      details: Array.from({ length: 20 }).reduce<unknown>(
        (nested) => ({ safe: nested }),
        { token: 'deep-object-secret' },
      ),
      secret: 'deep-object-secret',
    },
    {
      label: 'deep array',
      details: Array.from({ length: 20 }).reduce<unknown>(
        (nested) => [nested],
        { authorizationHeader: 'deep-array-secret' },
      ),
      secret: 'deep-array-secret',
    },
  ])('rejects $label daemon details beyond the sanitization depth', async ({
    details,
    secret,
  }) => {
    const body = JSON.stringify({
      error: {
        code: 'daemon.failure',
        message: 'Failure',
        details,
      },
    });
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

    const error: unknown = await transport.health().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('rejects daemon details that exceed the structured-data size limit', async () => {
    const body = JSON.stringify({
      error: {
        code: 'daemon.failure',
        message: 'Failure',
        details: Array.from({ length: 1_100 }, (_, index) => index),
      },
    });
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

  test('rejects a huge daemon details array before bulk descriptor allocation', () => {
    const details = new Array<null>(100_000).fill(null);
    const bulkDescriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors');
    const singleDescriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    let error: unknown;
    let bulkCalls: number;
    let singleCalls: number;

    try {
      new CovenDaemonResponseError(
        {
          code: 'daemon.failure',
          message: 'Failure',
          details,
        },
        500,
      );
    } catch (caught) {
      error = caught;
    } finally {
      bulkCalls = bulkDescriptors.mock.calls.filter(
        ([value]) => value === details,
      ).length;
      singleCalls = singleDescriptor.mock.calls.filter(
        ([value]) => value === details,
      ).length;
      bulkDescriptors.mockRestore();
      singleDescriptor.mockRestore();
    }

    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(bulkCalls).toBe(0);
    expect(singleCalls).toBe(1);
  });

  test('caps huge daemon details object inspection without a descriptor map', () => {
    const details: Record<string, number> = {};
    for (let index = 0; index < 50_000; index += 1) {
      details[`field${index}`] = index;
    }
    const bulkDescriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors');
    const singleDescriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    let error: unknown;
    let bulkCalls: number;
    let singleCalls: number;

    try {
      new CovenDaemonResponseError(
        {
          code: 'daemon.failure',
          message: 'Failure',
          details,
        },
        500,
      );
    } catch (caught) {
      error = caught;
    } finally {
      bulkCalls = bulkDescriptors.mock.calls.filter(
        ([value]) => value === details,
      ).length;
      singleCalls = singleDescriptor.mock.calls.filter(
        ([value]) => value === details,
      ).length;
      bulkDescriptors.mockRestore();
      singleDescriptor.mockRestore();
    }

    expect(error).toMatchObject({ code: 'invalid_response' });
    expect(bulkCalls).toBe(0);
    expect(singleCalls).toBeLessThanOrEqual(1_024);
  });

  test('rejects cyclic daemon details without retaining the original subtree', () => {
    const details: Record<string, unknown> = {};
    details.self = details;

    expect(
      () =>
        new CovenDaemonResponseError(
          {
            code: 'daemon.failure',
            message: 'Failure',
            details,
          },
          500,
        ),
    ).toThrow(expect.objectContaining({ code: 'invalid_response' }));
  });

  test('rejects accessor-backed daemon details without invoking getters', () => {
    let getterCalls = 0;
    const details = {};
    Object.defineProperty(details, 'authorizationHeader', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'getter-secret';
      },
    });

    expect(
      () =>
        new CovenDaemonResponseError(
          {
            code: 'daemon.failure',
            message: 'Failure',
            details,
          },
          500,
        ),
    ).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    expect(getterCalls).toBe(0);
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

  test('applies the operation deadline to Unix pre-connect validation', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(() => connectedSocket(httpResponse(HEALTH_BODY)));
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect,
          getEffectiveUid: () => 501,
          lstat: () => new Promise(() => undefined),
        },
      },
    );
    let outcome: unknown = 'pending';
    void transport
      .health({
        signal: new AbortController().signal,
        deadline: performance.now() + 10,
      })
      .then(
        (value) => {
          outcome = value;
        },
        (error: unknown) => {
          outcome = error;
        },
      );

    await vi.advanceTimersByTimeAsync(10);

    expect(outcome).toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'validate_endpoint' },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  test('rejects Unix pre-connect validation that settles at its 1ms deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const connect = vi.fn(() => connectedSocket(httpResponse(HEALTH_BODY)));
    let resolveLstat: ((identity: CovenUnixFileIdentity) => void) | undefined;
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect,
          getEffectiveUid: () => 501,
          lstat: () =>
            new Promise<CovenUnixFileIdentity>((resolvePromise) => {
              resolveLstat = resolvePromise;
            }),
        },
      },
    );

    try {
      const result = transport
        .health({
          signal: new AbortController().signal,
          deadline: now + 1,
        })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      now = 1;
      resolveLstat?.(unixIdentity());

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'validate_endpoint' },
      });
      expect(connect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('absorbs a late Unix validator rejection after the operation deadline', async () => {
    vi.useFakeTimers();
    let rejectInspection: ((error: Error) => void) | undefined;
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          getEffectiveUid: () => 501,
          lstat: () =>
            new Promise((_resolve, reject) => {
              rejectInspection = reject;
            }),
        },
      },
    );
    const result = transport
      .health({
        signal: new AbortController().signal,
        deadline: performance.now() + 10,
      })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ code: 'timeout' });

    rejectInspection?.(new Error('private late Unix rejection'));
    await Promise.resolve();
  });

  test('applies the operation deadline to Unix connected-peer validation', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const inspectConnected = vi.fn((connected: CovenSocket) => {
      expect(connected).toBe(socket);
      return new Promise<TestUnixPeerIdentity>(() => undefined);
    });
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
        peerIdentity: { inspectConnected },
      },
    );
    const result = transport
      .health({
        signal: new AbortController().signal,
        deadline: performance.now() + 10,
      })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(await result).toMatchObject({ code: 'timeout' });
    expect(inspectConnected).toHaveBeenCalledOnce();
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  test('rejects an expired Unix health budget before starting validation', async () => {
    vi.useFakeTimers();
    const now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const lstat = vi.fn(() => Promise.resolve(unixIdentity()));
    const connect = vi.fn(() => new FakeSocket());
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect,
          getEffectiveUid: () => 501,
          lstat,
        },
      },
    );

    try {
      const result = transport.health({
        signal: new AbortController().signal,
        deadline: now,
      });

      await expect(result).rejects.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'validate_endpoint' },
      });
      expect(lstat).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('does not write a Unix health request at its 1ms absolute deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
    let resolvePeer: ((identity: TestUnixPeerIdentity) => void) | undefined;
    const inspectConnected = vi.fn(
      () =>
        new Promise<TestUnixPeerIdentity>((resolvePromise) => {
          resolvePeer = resolvePromise;
        }),
    );
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
        peerIdentity: { inspectConnected },
      },
    );

    try {
      const result = transport
        .health({
          signal: new AbortController().signal,
          deadline: now + 1,
        })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      expect(inspectConnected).toHaveBeenCalledOnce();
      now = 1;
      resolvePeer?.(unixPeerIdentity());
      await vi.advanceTimersByTimeAsync(0);
      const writesBeforeTimer = socket.writes.length;
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'write_request' },
      });
      expect(writesBeforeTimer).toBe(0);
      expect(socket.destroyed).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('rejects a Unix response received at its 1ms absolute deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
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

    try {
      const result = transport
        .health({
          signal: new AbortController().signal,
          deadline: now + 1,
        })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      expect(socket.writes).toHaveLength(1);
      now = 1;
      socket.emit('data', httpResponse(HEALTH_BODY));

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'read_response' },
      });
      expect(socket.destroyed).toBe(true);
      expect(socket.listenerCount('connect')).toBe(0);
      expect(socket.listenerCount('data')).toBe(0);
      expect(socket.listenerCount('end')).toBe(0);
      expect(socket.listenerCount('error')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('does not resolve unsolicited response data before peer validation', async () => {
    const socket = new FakeSocket();
    let resolvePeer: ((identity: TestUnixPeerIdentity) => void) | undefined;
    const peer = new Promise<TestUnixPeerIdentity>((resolvePromise) => {
      resolvePeer = resolvePromise;
    });
    const transport = createCovenUnixTransport(
      unixEndpoint(resolve(ownedRoot.rootPath, 'coven.sock')),
      {
        dependencies: {
          connect: () => {
            queueMicrotask(() => {
              socket.emit('connect');
              socket.emit('data', httpResponse(HEALTH_BODY));
            });
            return socket;
          },
          getEffectiveUid: () => 501,
          lstat: () => Promise.resolve(unixIdentity()),
        },
        peerIdentity: {
          inspectConnected: () => peer,
        },
      },
    );
    let settled = false;
    const result = transport.health().then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );

    await new Promise((resolvePromise) => setImmediate(resolvePromise));

    expect(settled).toBe(false);
    expect(socket.paused).toBe(true);
    expect(socket.writes).toEqual([]);

    resolvePeer?.({ uid: 502 });

    await expect(result).rejects.toMatchObject({
      code: 'owner_mismatch',
      diagnostics: { phase: 'revalidate_endpoint' },
    });
    expect(socket.writes).toEqual([]);
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
    await vi.advanceTimersByTimeAsync(0);
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
    'passes the exact live connected Unix socket to peer validation',
    async () => {
      const shortRoot = createOwnedTempDirectory({ prefix: 'c' });
      const socketPath = resolve(shortRoot.rootPath, 's');
      let clientSocket: CovenConnectedSocket | undefined;
      const server = createServer((socket) => {
        socket.once('data', () => {
          socket.end(httpResponse(HEALTH_BODY));
        });
      });
      await new Promise<void>((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolvePromise);
      });

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
        }, {
          peerIdentity: {
            inspectConnected(socket) {
              clientSocket = socket;
              expect(socket.connecting).toBe(false);
              expect(socket.destroyed).toBe(false);
              return Promise.resolve({ uid });
            },
          },
        });

        await expect(transport.health()).resolves.toEqual(JSON.parse(HEALTH_BODY));
        expect(clientSocket).toBeDefined();
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
  test('constructs directly with Windows security', () => {
    expect(() => {
      createRawCovenWindowsTransport(windowsEndpoint(), {
        security: {
          platform: 'windows',
          ownership: {
            currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
            inspect: () => Promise.resolve(windowsIdentity()),
            inspectConnected: () => Promise.resolve(windowsIdentity()),
          },
        },
      });
    }).not.toThrow();
  });

  test.each([
    ['missing security', {}],
    [
      'a bare ownership adapter',
      {
        ownership: {
          currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
          inspect: () => Promise.resolve(windowsIdentity()),
          inspectConnected: () => Promise.resolve(windowsIdentity()),
        },
      },
    ],
    [
      'Unix security',
      {
        security: {
          platform: 'unix',
          peerIdentity: {
            inspectConnected: () => Promise.resolve(unixPeerIdentity()),
          },
        },
      },
    ],
  ])('fails closed at construction with %s', (_label, options) => {
    expect(() => {
      Reflect.apply(createRawCovenWindowsTransport, undefined, [
        windowsEndpoint(),
        options,
      ]);
    }).toThrow(expect.objectContaining({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'validate_endpoint' },
    }));
  });

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

  test('applies the operation deadline to Windows pre-connect validation', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(() => connectedSocket(httpResponse(HEALTH_BODY)));
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: { connect },
      ownership: {
        currentUserIdentity: () =>
          new Promise<string>(() => undefined),
        inspect: () => Promise.resolve(windowsIdentity()),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });
    let outcome: unknown = 'pending';
    void transport
      .health({
        signal: new AbortController().signal,
        deadline: performance.now() + 10,
      })
      .then(
        (value) => {
          outcome = value;
        },
        (error: unknown) => {
          outcome = error;
        },
      );

    await vi.advanceTimersByTimeAsync(10);

    expect(outcome).toMatchObject({
      code: 'timeout',
      diagnostics: { phase: 'validate_endpoint' },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  test('absorbs a late Windows validator rejection after the operation deadline', async () => {
    vi.useFakeTimers();
    let rejectInspection: ((error: Error) => void) | undefined;
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      ownership: {
        currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
        inspect: () =>
          new Promise((_resolve, reject) => {
            rejectInspection = reject;
          }),
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });
    const result = transport
      .health({
        signal: new AbortController().signal,
        deadline: performance.now() + 10,
      })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ code: 'timeout' });

    rejectInspection?.(new Error('private late Windows rejection'));
    await Promise.resolve();
  });

  test('applies the operation deadline to Windows connected-pipe validation', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const inspectConnected = vi.fn(
      () => new Promise<CovenWindowsPipeIdentity>(() => undefined),
    );
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
        inspectConnected,
      },
    });
    const result = transport
      .health({
        signal: new AbortController().signal,
        deadline: performance.now() + 10,
      })
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(await result).toMatchObject({ code: 'timeout' });
    expect(inspectConnected).toHaveBeenCalledOnce();
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  test('rejects an expired Windows health budget before starting validation', async () => {
    vi.useFakeTimers();
    const now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const currentUserIdentity = vi.fn(() =>
      Promise.resolve('S-1-5-21-current-user'),
    );
    const inspect = vi.fn(() => Promise.resolve(windowsIdentity()));
    const connect = vi.fn(() => new FakeSocket());
    const transport = createCovenWindowsTransport(windowsEndpoint(), {
      dependencies: { connect },
      ownership: {
        currentUserIdentity,
        inspect,
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });

    try {
      const result = transport.health({
        signal: new AbortController().signal,
        deadline: now,
      });

      await expect(result).rejects.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'validate_endpoint' },
      });
      expect(currentUserIdentity).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('does not write a Windows health request at its 1ms absolute deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
    let resolveConnected:
      | ((identity: CovenWindowsPipeIdentity) => void)
      | undefined;
    const inspectConnected = vi.fn(
      () =>
        new Promise<CovenWindowsPipeIdentity>((resolvePromise) => {
          resolveConnected = resolvePromise;
        }),
    );
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
        inspectConnected,
      },
    });

    try {
      const result = transport
        .health({
          signal: new AbortController().signal,
          deadline: now + 1,
        })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      expect(inspectConnected).toHaveBeenCalledOnce();
      now = 1;
      resolveConnected?.(windowsIdentity());
      await vi.advanceTimersByTimeAsync(0);
      const writesBeforeTimer = socket.writes.length;
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'write_request' },
      });
      expect(writesBeforeTimer).toBe(0);
      expect(socket.destroyed).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('rejects a Windows response received at its 1ms absolute deadline', async () => {
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const socket = new FakeSocket();
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
        inspectConnected: () => Promise.resolve(windowsIdentity()),
      },
    });

    try {
      const result = transport
        .health({
          signal: new AbortController().signal,
          deadline: now + 1,
        })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(0);
      expect(socket.writes).toHaveLength(1);
      now = 1;
      socket.emit('data', httpResponse(HEALTH_BODY));

      await expect(result).resolves.toMatchObject({
        code: 'timeout',
        diagnostics: { phase: 'read_response' },
      });
      expect(socket.destroyed).toBe(true);
      expect(socket.listenerCount('connect')).toBe(0);
      expect(socket.listenerCount('data')).toBe(0);
      expect(socket.listenerCount('end')).toBe(0);
      expect(socket.listenerCount('error')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
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
      transportSecurity: {
        platform: 'unix',
        peerIdentity: {
          inspectConnected: () => Promise.resolve(unixPeerIdentity()),
        },
      },
      discovery: {
        env: { PATH: '/safe/bin' },
        platform: 'linux',
        dependencies: trustedCommandDependencies(
          execResult(configPathsReport(socketPath, metadataPath)),
          { getEffectiveUid: () => 501 },
        ),
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

  test('rejects a transport-security provider for the wrong discovered platform', async () => {
    await expect(
      createDiscoveredCovenClient({
        transportSecurity: {
          platform: 'windows',
          ownership: {
            currentUserIdentity: () => Promise.resolve('S-1-5-21-current-user'),
            inspect: () => Promise.resolve(windowsIdentity()),
            inspectConnected: () => Promise.resolve(windowsIdentity()),
          },
        },
        discovery: {
          env: { PATH: '/safe/bin' },
          platform: 'linux',
          dependencies: trustedCommandDependencies(
            execResult(
              configPathsReport(
                resolve(ownedRoot.rootPath, 'coven.sock'),
                resolve(ownedRoot.rootPath, 'daemon.json'),
              ),
            ),
            { getEffectiveUid: () => 501 },
          ),
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
      diagnostics: { phase: 'validate_endpoint' },
    });
  });

  test('fails closed before discovery when transport security is missing at runtime', async () => {
    await expect(
      Reflect.apply(createDiscoveredCovenClient, undefined, [{}]),
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

  test('does not invoke getters while inspecting branded transport errors', async () => {
    let getterCalls = 0;
    const transportError = new Error('hostile branded transport error');
    Object.defineProperty(
      transportError,
      Symbol.for('@opencoven/coven-client/CovenDaemonResponseError'),
      { value: true },
    );
    Object.defineProperty(transportError, 'daemon', {
      get() {
        getterCalls += 1;
        throw new Error('getter escaped');
      },
    });
    Object.defineProperty(transportError, 'code', {
      get() {
        getterCalls += 1;
        throw new Error('code getter escaped');
      },
    });
    const client = new CovenClient({
      transport: {
        health: () => Promise.reject(transportError),
      },
    });

    const error: unknown = await client.health().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CovenClientError);
    expect(error).toMatchObject({ code: 'unknown', daemon: undefined });
    expect(String(error)).not.toContain('getter escaped');
    expect(getterCalls).toBe(0);
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
