import { EventEmitter } from 'node:events';

import {
  COVEN_DAEMON_PROTOCOL,
  type CovenConnectedSocket,
  type CovenDiscoveredEndpoint,
  type CovenSocket,
} from '@opencoven/coven-client';
import { createMemorySecretStore } from '@opencoven/sdk-core';
import {
  DEV_CLI_VERSION,
  runCli,
  type CliRuntime,
} from '@opencoven/dev-cli';
import { describe, expect, test, vi } from 'vitest';

const caveDiscovery = {
  version: 1,
  endpoint: {
    kind: 'http',
    url: 'http://127.0.0.1:3020',
  },
  freshness: {
    pid: 42,
    nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba099',
    startedAt: '2026-08-24T02:06:12.004Z',
  },
  record: {
    path: '/Users/example/.coven/cave/client-v1-discovery.json',
    device: 7,
    inode: 9,
  },
} as const;

const caveHealth = {
  status: 'ok',
  apiVersion: '1.0',
  minimumClientVersion: '0.1.0',
  instanceId: 'security-test-cave',
  pairingRequired: true,
  releaseVersion: '0.1.0',
  capabilities: ['chat', 'pairing'],
  operations: ['health', 'pairing.create'],
} as const;

const covenDiscovery: CovenDiscoveredEndpoint = {
  version: 1,
  protocol: COVEN_DAEMON_PROTOCOL,
  source: 'coven_home',
  endpoint: {
    kind: 'unix',
    path: '/var/run/opencoven/coven.sock',
  },
  owner: {
    kind: 'unix',
    uid: 501,
  },
  freshness: {
    daemonPid: 24,
    daemonStartedAt: '2026-08-24T02:06:12.004Z',
  },
};

const covenHealthResponse = {
  ok: true,
  apiVersion: COVEN_DAEMON_PROTOCOL,
  covenVersion: '0.1.0',
  capabilities: {
    sessions: true,
    events: true,
    eventCursor: 'sequence',
    structuredErrors: true,
  },
} as const;

function createProbeableStore(
  probe: () => Promise<void> = () => Promise.resolve(),
) {
  return Object.assign(createMemorySecretStore(), { probe });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObjectJson(serialized: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(serialized);
  if (!isObject(parsed)) {
    throw new TypeError('Expected JSON object output.');
  }

  return parsed;
}

function runtime(overrides: CliRuntime = {}): CliRuntime {
  return {
    ...overrides,
    cave: {
      createClient: () => ({
        health: () => Promise.resolve(caveHealth),
        createPairing: () =>
          Promise.reject(new Error('pairing was not expected in this test')),
        credentialStatus: () =>
          Promise.reject(new Error('credential status was not expected in this test')),
        forgetCredential: () =>
          Promise.reject(new Error('forget credential was not expected in this test')),
      }),
      discoverEndpoint: () => Promise.resolve(caveDiscovery),
      ...overrides.cave,
    },
    coven: {
      discoverEndpoint: () => Promise.resolve(covenDiscovery),
      ...overrides.coven,
    },
    createSecretStore: overrides.createSecretStore ?? (() => createProbeableStore()),
    now: overrides.now ?? (() => 1_755_730_000_000),
    sleep: overrides.sleep ?? (() => Promise.resolve()),
  };
}

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

function unixIdentity() {
  return {
    device: 7,
    inode: 11,
    mode: 0o140600,
    ownerUid: 501,
    symbolicLink: false,
    socket: true,
  } as const;
}

function unixTransport(connect: () => CovenConnectedSocket) {
  return {
    unix: {
      dependencies: {
        connect,
        getEffectiveUid: () => 501,
        lstat: () => Promise.resolve(unixIdentity()),
      },
    },
  } as const;
}

describe('CLI Coven transport security', () => {
  test('fails closed without a native Unix peer-identity provider', async () => {
    const connect = vi.fn(() => connectedSocket(httpResponse(JSON.stringify(covenHealthResponse))));

    const result = await runCli(
      ['--json', 'coven', 'health'],
      runtime({
        coven: {
          transport: unixTransport(connect),
        },
      }),
    );

    expect(connect).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'coven health',
      data: {
        discovery: covenDiscovery,
      },
      error: {
        code: 'platform_security_unavailable',
        message: 'Required native Coven platform security is unavailable.',
        retryable: false,
        action:
          'Use a reviewed OpenCoven CLI/runtime that injects the required native Coven transport-security adapter for this platform and retry.',
        details: {
          phase: 'validate_endpoint',
          platform: 'unix',
          requirement: 'peer_identity',
        },
      },
      ok: false,
      version: DEV_CLI_VERSION,
    });
  });

  test('reports missing Coven platform security as an unhealthy doctor check', async () => {
    const result = await runCli(['--json', 'doctor'], runtime());
    const output = parseObjectJson(result.stdout);
    const data = output.data;
    if (!isObject(data)) {
      throw new TypeError('Doctor output data was not an object.');
    }
    const summary = data.summary;
    if (!isObject(summary)) {
      throw new TypeError('Doctor summary was not an object.');
    }
    const checksValue = data.checks;
    if (!Array.isArray(checksValue)) {
      throw new TypeError('Doctor checks were not an array.');
    }
    const checks = checksValue.filter(isObject);

    expect(result.exitCode).toBe(1);
    expect(output.command).toBe('doctor');
    expect(output.error).toEqual({
      code: 'unhealthy',
      message: 'One or more diagnostics failed.',
    });
    expect(output.ok).toBe(false);
    expect(output.version).toBe(DEV_CLI_VERSION);
    expect(summary).toEqual({
      healthy: false,
      ok: 4,
      error: 1,
      skipped: 0,
    });
    expect(checks).toHaveLength(checksValue.length);
    expect(
      checks.some(
        (check) =>
          check.id === 'coven.discovery' &&
          check.status === 'ok',
      ),
    ).toBe(true);
    expect(
      checks.some(
        (check) =>
          check.id === 'coven.health' &&
          check.status === 'error' &&
          isObject(check.error) &&
          check.error.code === 'platform_security_unavailable',
      ),
    ).toBe(true);
  });

  test('accepts an injected native Unix peer-identity provider', async () => {
    const connect = vi.fn(() => connectedSocket(httpResponse(JSON.stringify(covenHealthResponse))));

    const result = await runCli(
      ['--json', 'coven', 'health'],
      runtime({
        coven: {
          transportSecurity: {
            platform: 'unix',
            peerIdentity: {
              inspectConnected: () =>
                Promise.resolve({ uid: 501, gid: 20, pid: 42 }),
            },
          },
          transport: unixTransport(connect),
        },
      }),
    );

    expect(connect).toHaveBeenCalledOnce();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'coven health',
      data: {
        discovery: covenDiscovery,
        health: {
          status: 'ok',
          covenVersion: covenHealthResponse.covenVersion,
          capabilities: covenHealthResponse.capabilities,
        },
      },
      ok: true,
      version: DEV_CLI_VERSION,
    });
  });

  test('fails closed when an injected native provider reports the wrong peer owner', async () => {
    const socket = new FakeSocket();
    socket.onWrite = () => {
      queueMicrotask(() => {
        socket.emit('data', httpResponse(JSON.stringify(covenHealthResponse)));
        socket.emit('end');
      });
    };
    const connect = vi.fn(() => {
      queueMicrotask(() => {
        socket.emit('connect');
      });
      return socket;
    });

    const result = await runCli(
      ['--json', 'coven', 'health'],
      runtime({
        coven: {
          transportSecurity: {
            platform: 'unix',
            peerIdentity: {
              inspectConnected: () => Promise.resolve({ uid: 0 }),
            },
          },
          transport: unixTransport(connect),
        },
      }),
    );

    expect(connect).toHaveBeenCalledOnce();
    expect(socket.writes).toEqual([]);
    expect(socket.destroyed).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'coven health',
      data: {
        discovery: covenDiscovery,
      },
      error: {
        code: 'owner_mismatch',
        message: 'The discovered Coven runtime is not owned by the current user.',
        retryable: false,
        action: 'Repair the local runtime ownership or permissions and retry.',
      },
      ok: false,
      version: DEV_CLI_VERSION,
    });
  });
});
