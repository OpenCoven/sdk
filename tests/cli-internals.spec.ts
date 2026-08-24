/* eslint-disable @typescript-eslint/require-await */

import { EventEmitter } from 'node:events';

import { createMemorySecretStore, createSecretStoreReference } from '@opencoven/sdk-core';
import type { CaveDiscoveredEndpoint } from '@opencoven/cave-client';
import type {
  CovenConnectedSocket,
  CovenDiscoveredEndpoint,
  CovenHealthResponse,
  CovenSocket,
} from '@opencoven/coven-client';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createPinnedCliCaveDiscoverEndpoint } from '../packages/cli/src/cave-discovery.js';
import {
  DEFAULT_CLI_COMMAND_TIMING,
  createCliDeadline,
  remainingCliTime,
  resolveCliCommandTiming,
  runWithinCliDeadline,
  runWithCliTimeout,
} from '../packages/cli/src/command-timing.js';
import { readDiscoveredCovenHealth, runCovenHealth } from '../packages/cli/src/coven.js';
import { runDiscover } from '../packages/cli/src/discover.js';
import { runDoctor } from '../packages/cli/src/doctor.js';
import type { ResolvedCliRuntime } from '../packages/cli/src/main.js';
import {
  createCliError,
  formatCliOutput,
  normalizeCliError,
  type CliErrorContext,
} from '../packages/cli/src/output.js';

const caveDiscovery: CaveDiscoveredEndpoint = {
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
};

const caveHealth = {
  status: 'ok' as const,
  pairingRequired: true as const,
  releaseVersion: '0.1.0',
  capabilities: ['chat', 'pairing'],
  operations: ['health', 'pairing.create'],
};

const covenDiscovery: CovenDiscoveredEndpoint = {
  version: 1,
  protocol: 'coven.daemon.v1',
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

const covenWindowsDiscovery: CovenDiscoveredEndpoint = {
  version: 1,
  protocol: 'coven.daemon.v1',
  source: 'config_paths',
  endpoint: {
    kind: 'windowsNamedPipe',
    path: '\\\\.\\pipe\\opencoven-coven',
  },
  owner: {
    kind: 'windows',
    identity: 'S-1-5-21-1000',
  },
  freshness: {
    daemonPid: 24,
    daemonStartedAt: '2026-08-24T02:06:12.004Z',
  },
};

const covenHealth: CovenHealthResponse = {
  ok: true,
  apiVersion: 'coven.daemon.v1',
  covenVersion: '0.1.0',
  capabilities: {
    sessions: true,
    events: true,
    eventCursor: 'sequence',
    structuredErrors: true,
  },
};

function probeableStore(
  probe: () => Promise<void> = () => Promise.resolve(),
) {
  return Object.assign(createMemorySecretStore(), { probe });
}

function runtime(overrides: Partial<ResolvedCliRuntime> = {}): ResolvedCliRuntime {
  const caveOverrides: Partial<ResolvedCliRuntime['cave']> = overrides.cave ?? {};
  const covenOverrides: Partial<ResolvedCliRuntime['coven']> = overrides.coven ?? {};
  const rest: Omit<Partial<ResolvedCliRuntime>, 'cave' | 'coven'> = { ...overrides };
  delete (rest as { cave?: unknown }).cave;
  delete (rest as { coven?: unknown }).coven;

  const cave = Object.assign(
    {
      createClient: async () => ({
        health: async () => caveHealth,
        createPairing: async () => {
          throw new Error('pairing not used in this test');
        },
        credentialStatus: async () => ({ status: 'missing' as const }),
        forgetCredential: async () => false,
      }),
      discoverEndpoint: async () => caveDiscovery,
    },
    caveOverrides,
  ) as ResolvedCliRuntime['cave'];

  const coven = Object.assign(
    {
      discoverEndpoint: async () => covenDiscovery,
      readHealth: async () => covenHealth,
    },
    covenOverrides,
  ) as ResolvedCliRuntime['coven'];

  return {
    cave,
    coven,
    createSecretStore: async () => probeableStore(),
    createSecretStoreReference,
    cwd: '/Users/example/project',
    discoveryOptions: {
      cave: {
        cwd: '/Users/example/project',
        env: {},
        platform: 'darwin',
      },
      coven: {
        cwd: '/Users/example/project',
        env: {},
        platform: 'darwin',
      },
    },
    env: {},
    fetch: fetch,
    now: () => 1_755_730_000_000,
    platform: 'darwin',
    sleep: async () => undefined,
    timing: DEFAULT_CLI_COMMAND_TIMING,
    version: '0.1.0',
    ...rest,
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

function connectedSocket(response: Buffer): CovenConnectedSocket {
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CLI output helpers', () => {
  test('creates CLI errors with optional fields only when present', () => {
    expect(createCliError('code', 'message')).toEqual({
      code: 'code',
      message: 'message',
    });
    expect(
      createCliError('code', 'message', {
        action: 'do the thing',
        details: { attempt: 1 },
        retryable: true,
      }),
    ).toEqual({
      code: 'code',
      message: 'message',
      action: 'do the thing',
      details: { attempt: 1 },
      retryable: true,
    });
  });

  test.each([
    {
      label: 'cave discovery not found',
      error: { code: 'not_found' },
      context: { system: 'cave', operation: 'discover' },
      expected: {
        code: 'not_found',
        message: 'Cave runtime discovery metadata was not found.',
        retryable: true,
        action: 'Start Cave or set COVEN_CAVE_HOME to the reviewed runtime directory.',
      },
    },
    {
      label: 'coven discovery not found',
      error: { code: 'not_found' },
      context: { system: 'coven', operation: 'discover' },
      expected: {
        code: 'not_found',
        message: 'Coven runtime discovery metadata was not found.',
        retryable: true,
        action: 'Start Coven or set COVEN_HOME to the reviewed runtime directory.',
      },
    },
    {
      label: 'coven daemon not found',
      error: { code: 'not_found' },
      context: { system: 'coven', operation: 'health' },
      expected: {
        code: 'not_found',
        message: 'Coven daemon was not found.',
        retryable: true,
        action: 'Start Coven and retry once the local daemon is listening.',
      },
    },
    {
      label: 'command failed',
      error: { code: 'command_failed' },
      context: { system: 'coven', operation: 'discover' },
      expected: {
        code: 'command_failed',
        message: 'Coven discovery command did not complete successfully.',
        retryable: true,
        action: 'Run `coven config paths --json` as the current user and retry.',
      },
    },
    {
      label: 'malformed config',
      error: { code: 'malformed_config' },
      context: { system: 'coven', operation: 'discover' },
      expected: {
        code: 'malformed_config',
        message: 'Coven discovery metadata was malformed.',
        action: 'Update Coven to a reviewed build and retry.',
      },
    },
    {
      label: 'cave owner mismatch',
      error: { code: 'owner_mismatch' },
      context: { system: 'cave', operation: 'status' },
      expected: {
        code: 'owner_mismatch',
        message: 'The discovered Cave runtime is not owned by the current user.',
        retryable: false,
        action: 'Repair the local runtime ownership or permissions and retry.',
      },
    },
    {
      label: 'coven unsafe endpoint',
      error: { code: 'unsafe_endpoint' },
      context: { system: 'coven', operation: 'health' },
      expected: {
        code: 'unsafe_endpoint',
        message: 'The discovered Coven runtime endpoint could not be validated safely.',
        retryable: false,
        action: 'Repair the local runtime ownership or permissions and retry.',
      },
    },
    {
      label: 'stale record',
      error: { code: 'stale_record' },
      context: { system: 'cave', operation: 'discover' },
      expected: {
        code: 'stale_record',
        message: 'Cave runtime discovery metadata was stale.',
        action: 'Restart Cave so it can write fresh runtime discovery metadata.',
      },
    },
    {
      label: 'body limit',
      error: { code: 'body_limit' },
      context: { system: 'cave', operation: 'discover' },
      expected: {
        code: 'body_limit',
        message: 'Runtime metadata exceeded the reviewed size limit.',
      },
    },
    {
      label: 'cave invalid response',
      error: { code: 'invalid_response' },
      context: { system: 'cave', operation: 'health' },
      expected: {
        code: 'invalid_response',
        message: 'The local Cave service returned malformed data.',
        action: 'Update the local service to a reviewed build and retry.',
      },
    },
    {
      label: 'coven invalid response',
      error: { code: 'invalid_response' },
      context: { system: 'coven', operation: 'health' },
      expected: {
        code: 'invalid_response',
        message: 'The local Coven service returned malformed health data.',
        action: 'Update the local service to a reviewed build and retry.',
      },
    },
    {
      label: 'connect failure',
      error: { code: 'connect_failure' },
      context: { system: 'coven', operation: 'health' },
      expected: {
        code: 'connect_failure',
        message: 'Could not connect to the Coven daemon.',
        retryable: true,
        action: 'Start Coven and retry once the local daemon is listening.',
      },
    },
    {
      label: 'coven platform security unavailable',
      error: { code: 'platform_security_unavailable' },
      context: { system: 'coven', operation: 'health' },
      expected: {
        code: 'platform_security_unavailable',
        message: 'Required native Coven platform security is unavailable.',
        retryable: false,
        action:
          'Use a reviewed OpenCoven CLI/runtime that injects the required native Coven transport-security adapter for this platform and retry.',
      },
    },
    {
      label: 'cave platform security unavailable',
      error: { code: 'platform_security_unavailable' },
      context: { system: 'cave', operation: 'pair' },
      expected: {
        code: 'platform_security_unavailable',
        message: 'Required native Cave platform security is unavailable.',
        retryable: false,
        action:
          'Use a reviewed OpenCoven CLI/runtime with native Windows Cave path ownership/ACL validation, or inject CliRuntime.cave.discovery.dependencies.windowsPathTrust, then retry.',
      },
    },
    {
      label: 'coven discovery timeout',
      error: { code: 'timeout' },
      context: { system: 'coven', operation: 'discover' },
      expected: {
        code: 'timeout',
        message: 'Coven runtime discovery timed out.',
        retryable: true,
      },
    },
    {
      label: 'secure-store probe timeout',
      error: { code: 'timeout' },
      context: { system: 'secure-store', operation: 'probe' },
      expected: {
        code: 'timeout',
        message: 'The native secure credential storage health check timed out.',
        retryable: true,
      },
    },
    {
      label: 'cave health timeout',
      error: { code: 'timeout' },
      context: { system: 'cave', operation: 'health' },
      expected: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
    },
    {
      label: 'generic cli timeout',
      error: { code: 'timeout' },
      context: { system: 'cli', operation: 'doctor' },
      expected: {
        code: 'timeout',
        message: 'The operation timed out.',
        retryable: true,
      },
    },
    {
      label: 'aborted',
      error: { code: 'aborted' },
      context: { system: 'cli', operation: 'doctor' },
      expected: {
        code: 'aborted',
        message: 'The operation was aborted.',
      },
    },
    {
      label: 'pairing pending',
      error: { code: 'pairing_pending' },
      context: { system: 'cave', operation: 'pair' },
      expected: {
        code: 'pairing_pending',
        message: 'Cave pairing is still pending approval.',
        action:
          'Approve the pairing request in Cave and rerun `opencoven cave pair` before the request expires.',
      },
    },
    {
      label: 'pairing denied',
      error: { code: 'pairing_denied' },
      context: { system: 'cave', operation: 'pair' },
      expected: {
        code: 'pairing_denied',
        message: 'Cave pairing request was denied.',
        retryable: false,
        action: 'Start a new pairing request with `opencoven cave pair`.',
      },
    },
    {
      label: 'pairing expired',
      error: { code: 'pairing_expired' },
      context: { system: 'cave', operation: 'pair' },
      expected: {
        code: 'pairing_expired',
        message: 'Cave pairing request expired before approval.',
        retryable: false,
        action: 'Start a new pairing request with `opencoven cave pair`.',
      },
    },
    {
      label: 'incompatible version',
      error: { code: 'incompatible_version' },
      context: { system: 'cave', operation: 'health' },
      expected: {
        code: 'incompatible_version',
        message: 'The local Cave service requires a newer OpenCoven CLI version.',
        retryable: false,
        action: 'Upgrade the OpenCoven CLI to the minimum reviewed version and retry.',
      },
    },
    {
      label: 'secure store unavailable',
      error: { code: 'secure_store_unavailable' },
      context: { system: 'secure-store', operation: 'probe' },
      expected: {
        code: 'secure_store_unavailable',
        message: 'Native secure credential storage is unavailable.',
        retryable: false,
        action: 'Enable the platform secure-store backend for this user session and retry.',
      },
    },
    {
      label: 'reconcile required',
      error: { code: 'reconcile_required' },
      context: { system: 'cave', operation: 'status' },
      expected: {
        code: 'reconcile_required',
        message: 'The local Cave authority changed and the stored credential is no longer trusted.',
        retryable: false,
        action: 'Run `opencoven cave pair` to establish a fresh credential.',
      },
    },
    {
      label: 'scope denied',
      error: { code: 'scope_denied' },
      context: { system: 'cave', operation: 'status' },
      expected: {
        code: 'scope_denied',
        message: 'The stored Cave credential is missing the required scope.',
        action: 'Create a new Cave pairing with the reviewed scopes and retry.',
      },
    },
    {
      label: 'cave service unavailable',
      error: { code: 'service_unavailable' },
      context: { system: 'cave', operation: 'health' },
      expected: {
        code: 'service_unavailable',
        message: 'The Cave service is temporarily unavailable.',
        action: 'Retry once the local service is healthy again.',
      },
    },
    {
      label: 'coven service unavailable',
      error: { code: 'service_unavailable' },
      context: { system: 'coven', operation: 'health' },
      expected: {
        code: 'service_unavailable',
        message: 'The Coven daemon is temporarily unavailable.',
        action: 'Retry once the local service is healthy again.',
      },
    },
    {
      label: 'rate limited',
      error: { code: 'rate_limited' },
      context: { system: 'cave', operation: 'health' },
      expected: {
        code: 'rate_limited',
        message: 'The Cave service temporarily rate-limited the request.',
        action: 'Retry once Cave stops rate limiting requests.',
      },
    },
    {
      label: 'conflict',
      error: { code: 'conflict' },
      context: { system: 'cave', operation: 'pair' },
      expected: {
        code: 'conflict',
        message: 'The Cave pairing request was already consumed or invalidated.',
        action: 'Start a new pairing request with `opencoven cave pair`.',
      },
    },
    {
      label: 'unsupported operation',
      error: { code: 'unsupported_operation' },
      context: { system: 'cave', operation: 'pair' },
      expected: {
        code: 'unsupported_operation',
        message: 'The local service does not support this operation.',
      },
    },
  ] satisfies ReadonlyArray<{
    label: string;
    error: { code: string };
    context: CliErrorContext;
    expected: Record<string, unknown>;
  }>)('normalizes $label errors', ({ error, context, expected }) => {
    expect(normalizeCliError(error, context)).toEqual(expected);
  });

  test('rewrites secret store write failures from nested secure-store causes and merges safe details', () => {
    const normalized = normalizeCliError(
      Object.assign(new Error('failed'), {
        code: 'secret_store_write_failed',
        details: {
          attempt: 1,
          count: 2,
          enabled: true,
          nothing: null,
          nested: { no: 'drop' },
          cause: 'drop',
          stack: 'drop',
        },
        diagnostics: {
          phase: 'store',
        },
        cause: {
          code: 'secure_store_unavailable',
        },
      }),
      {
        system: 'secure-store',
        operation: 'set',
      },
    );

    expect(normalized).toEqual({
      code: 'secure_store_unavailable',
      message: 'Native secure credential storage is unavailable.',
      retryable: false,
      action: 'Enable the platform secure-store backend for this user session and retry.',
      details: {
        attempt: 1,
        count: 2,
        enabled: true,
        nothing: null,
        phase: 'store',
      },
    });
  });

  test('keeps rollback failures explicit and fail-closed', () => {
    const normalized = normalizeCliError(
      Object.assign(new Error('rollback failed'), {
        code: 'secret_store_rollback_failed',
        retryable: false,
        details: {
          failedStep: 'delete_binding',
          reason: 'fail_closed',
          rollbackState: 'failed',
        },
      }),
      {
        system: 'secure-store',
        operation: 'set',
      },
    );

    expect(normalized).toEqual({
      code: 'secret_store_rollback_failed',
      message: 'The paired Cave credential could not be rolled back safely.',
      retryable: false,
      action: 'Run `opencoven cave forget` once secure credential storage is healthy, then pair again.',
      details: {
        failedStep: 'delete_binding',
        reason: 'fail_closed',
        rollbackState: 'failed',
      },
    });
  });

  test('falls back safely when error metadata throws during inspection', () => {
    const throwing = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('descriptor failure');
        },
      },
    );

    expect(
      normalizeCliError(throwing, {
        system: 'cli',
        operation: 'doctor',
      }),
    ).toEqual({
      code: 'unknown',
      message: 'OpenCoven command failed.',
    });
  });

  test('formats human fallback output and redacts circular JSON data', () => {
    const circular: Record<string, unknown> = {
      safe: 'kept',
      token: 'hide',
      cookie: 'hide',
      count: 1,
      enabled: true,
      nothing: null,
      dropped: () => undefined,
    };
    circular.self = circular;

    expect(
      formatCliOutput(
        {
          command: 'doctor',
          ok: false,
          version: '0.1.0',
        },
        'human',
      ),
    ).toBe('OpenCoven command failed.\n');

    expect(
      formatCliOutput(
        {
          command: 'doctor',
          human: [],
          ok: true,
          version: '0.1.0',
        },
        'human',
      ),
    ).toBe('\n');

    expect(
      JSON.parse(
        formatCliOutput(
          {
            command: 'doctor',
            data: {
              circular,
              list: [
                {
                  password: 'hide',
                  safe: 'value',
                },
              ],
            },
            error: {
              code: 'oops',
              message: 'failed',
              details: {
                stack: 'drop',
                bearer: 'hide',
                ok: 'yes',
              },
            },
            human: ['do not serialize'],
            ok: false,
            version: '0.1.0',
          },
          'json',
        ),
      ),
    ).toEqual({
      command: 'doctor',
      data: {
        circular: {
          safe: 'kept',
          token: '[REDACTED]',
          cookie: '[REDACTED]',
          count: 1,
          enabled: true,
          nothing: null,
          self: '[Circular]',
        },
        list: [
          {
            password: '[REDACTED]',
            safe: 'value',
          },
        ],
      },
      error: {
        code: 'oops',
        message: 'failed',
        details: {
          bearer: '[REDACTED]',
          ok: 'yes',
        },
      },
      ok: false,
      version: '0.1.0',
    });
  });
});

describe('CLI timing helpers', () => {
  test('resolves and validates command timing overrides', () => {
    expect(resolveCliCommandTiming()).toEqual(DEFAULT_CLI_COMMAND_TIMING);
    expect(
      resolveCliCommandTiming({
        doctorTimeoutMs: 15_000,
        cavePairPollIntervalMs: 500,
      }),
    ).toEqual({
      ...DEFAULT_CLI_COMMAND_TIMING,
      doctorTimeoutMs: 15_000,
      cavePairPollIntervalMs: 500,
    });

    expect(() => resolveCliCommandTiming({ doctorTimeoutMs: 0 })).toThrow(
      'doctorTimeoutMs must be a positive safe integer no greater than 2147483647',
    );
    expect(() => createCliDeadline(() => 1_000, Number.POSITIVE_INFINITY)).toThrow(
      'timeoutMs must be a positive safe integer no greater than 2147483647',
    );
    expect(remainingCliTime(() => 10, 5)).toBe(0);
    expect(createCliDeadline(() => 5, 10)).toBe(15);
  });

  test('wraps non-error failures and rejects on timeout or exhausted deadlines', async () => {
    await expect(
      runWithCliTimeout('doctor', 10, () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject({ code: 'opaque_failure' });
      },
      ),
    ).rejects.toMatchObject({
      message: 'OpenCoven command failed.',
      code: 'opaque_failure',
      cause: {
        code: 'opaque_failure',
      },
    });
    await expect(
      runWithCliTimeout('doctor', 10, () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject('opaque_failure');
      },
      ),
    ).rejects.toMatchObject({
      message: 'OpenCoven command failed.',
      cause: 'opaque_failure',
    });

    expect(
      await runWithinCliDeadline(
        () => 10.9,
        20.1,
        'discover',
        async (timeoutMs) => timeoutMs,
      ),
    ).toBe(9);

    vi.useFakeTimers();

    const timeoutPromise = runWithCliTimeout(
      'doctor',
      5,
      async () => await new Promise(() => undefined),
    );
    const timeoutExpectation = expect(timeoutPromise).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
      message: 'cli.doctor timed out after 5ms',
    });
    await vi.advanceTimersByTimeAsync(5);
    await timeoutExpectation;

    await expect(
      runWithinCliDeadline(
        () => 100,
        100,
        'doctor',
        async () => 'never',
      ),
    ).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
      message: 'cli.doctor timed out after 1ms',
    });
  });
});

describe('CLI discovery and doctor helpers', () => {
  test('pins Cave authority records and surfaces reconciliation reasons', async () => {
    const stableDiscoverEndpoint = vi
      .fn<ResolvedCliRuntime['cave']['discoverEndpoint']>()
      .mockResolvedValueOnce(caveDiscovery)
      .mockResolvedValueOnce(caveDiscovery);
    const stablePinned = createPinnedCliCaveDiscoverEndpoint(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: stableDiscoverEndpoint,
        },
      }),
    );

    await expect(stablePinned()).resolves.toEqual(caveDiscovery);
    await expect(stablePinned()).resolves.toEqual(caveDiscovery);

    const discoverEndpoint = vi
      .fn<ResolvedCliRuntime['cave']['discoverEndpoint']>()
      .mockResolvedValueOnce(caveDiscovery)
      .mockResolvedValueOnce({
        ...caveDiscovery,
        record: {
          ...caveDiscovery.record,
          inode: caveDiscovery.record.inode + 1,
        },
      });
    const discoverPinned = createPinnedCliCaveDiscoverEndpoint(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint,
        },
      }),
    );

    await expect(discoverPinned()).resolves.toEqual(caveDiscovery);
    await expect(discoverPinned()).rejects.toMatchObject({
      code: 'reconcile_required',
      retryable: true,
      details: {
        reason: 'record_replaced',
      },
    });

    const mismatchPinned = createPinnedCliCaveDiscoverEndpoint(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: async () => ({
            ...caveDiscovery,
            endpoint: {
              kind: 'http',
              url: 'http://127.0.0.1:4040',
            },
          }),
        },
      }),
      caveDiscovery,
    );

    await expect(mismatchPinned()).rejects.toMatchObject({
      code: 'reconcile_required',
      retryable: true,
      details: {
        reason: 'authority_mismatch',
      },
    });
  });

  test('reports partial discovery failures and success summaries', async () => {
    const partial = await runDiscover(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: async () => {
            throw Object.assign(new Error('missing cave'), { code: 'not_found' });
          },
        },
        coven: {
          discoverEndpoint: async () => {
            throw Object.assign(new Error('missing coven'), { code: 'not_found' });
          },
          readHealth: async () => covenHealth,
        },
      }),
    );

    expect(partial.exitCode).toBe(1);
    expect(partial.output).toMatchObject({
      command: 'discover',
      ok: false,
      error: {
        code: 'discovery_failed',
      },
      data: {
        cave: {
          status: 'error',
          error: {
            code: 'not_found',
          },
        },
        coven: {
          status: 'error',
          error: {
            code: 'not_found',
          },
        },
      },
    });
    expect(partial.output.human).toEqual([
      'OpenCoven runtime discovery',
      '- cave: error — Cave runtime discovery metadata was not found.',
      '  action: Start Cave or set COVEN_CAVE_HOME to the reviewed runtime directory.',
      '- coven: error — Coven runtime discovery metadata was not found.',
      '  action: Start Coven or set COVEN_HOME to the reviewed runtime directory.',
    ]);

    const success = await runDiscover(runtime());

    expect(success.exitCode).toBe(0);
    expect(success.output.ok).toBe(true);
    expect(success.output.human).toEqual([
      'OpenCoven runtime discovery',
      '- cave: ok — http://127.0.0.1:3020',
      '- coven: ok — /var/run/opencoven/coven.sock',
    ]);

    const fallbackSuccess = await runDiscover(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: async () => ({
            ...caveDiscovery,
            endpoint: {} as CaveDiscoveredEndpoint['endpoint'],
          }),
        },
        coven: {
          discoverEndpoint: async () => ({
            ...covenDiscovery,
            endpoint: {} as CovenDiscoveredEndpoint['endpoint'],
          }),
          readHealth: async () => covenHealth,
        },
      }),
    );

    expect(fallbackSuccess.output.human).toEqual([
      'OpenCoven runtime discovery',
      '- cave: ok — discovered',
      '- coven: ok — discovered',
    ]);

    const noActionFailure = await runDiscover(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: async () => {
            throw Object.assign(new Error('too large'), { code: 'body_limit' });
          },
        },
        coven: {
          discoverEndpoint: async () => {
            throw Object.assign(new Error('opaque'), { code: 'unknown' });
          },
          readHealth: async () => covenHealth,
        },
      }),
    );

    expect(noActionFailure.output.human).toEqual([
      'OpenCoven runtime discovery',
      '- cave: error — Runtime metadata exceeded the reviewed size limit.',
      '- coven: error — OpenCoven command failed.',
    ]);
  });

  test('returns doctor timeout and skip summaries for each phase boundary', async () => {
    const caveDiscoveryTimeout = await runDoctor(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: async () => {
            throw Object.assign(new Error('timed out'), { code: 'timeout', retryable: true });
          },
        },
      }),
    );

    expect(caveDiscoveryTimeout.output.data).toMatchObject({
      summary: {
        healthy: false,
        ok: 0,
        error: 1,
        skipped: 4,
      },
    });

    const caveHealthTimeout = await runDoctor(
      runtime({
        cave: {
          createClient: async () => ({
            health: async () => {
              throw Object.assign(new Error('timed out'), { code: 'timeout', retryable: true });
            },
            createPairing: async () => {
              throw new Error('unused');
            },
            credentialStatus: async () => ({ status: 'missing' as const }),
            forgetCredential: async () => false,
          }),
          discoverEndpoint: async () => caveDiscovery,
        },
      }),
    );

    expect(caveHealthTimeout.output.data).toMatchObject({
      summary: {
        healthy: false,
        ok: 1,
        error: 1,
        skipped: 3,
      },
    });

    vi.useFakeTimers();

    const secureStoreTimeoutPromise = runDoctor(
      runtime({
        createSecretStore: async () => await new Promise(() => undefined),
        timing: {
          ...DEFAULT_CLI_COMMAND_TIMING,
          doctorTimeoutMs: 5,
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(5);
    const secureStoreTimeout = await secureStoreTimeoutPromise;

    expect(secureStoreTimeout.output.data).toMatchObject({
      summary: {
        healthy: false,
        ok: 2,
        error: 1,
        skipped: 2,
      },
    });

    const covenDiscoveryTimeout = await runDoctor(
      runtime({
        coven: {
          discoverEndpoint: async () => {
            throw Object.assign(new Error('timed out'), { code: 'timeout', retryable: true });
          },
          readHealth: async () => covenHealth,
        },
      }),
    );

    expect(covenDiscoveryTimeout.output.data).toMatchObject({
      summary: {
        healthy: false,
        ok: 3,
        error: 1,
        skipped: 1,
      },
    });
  });

  test('continues after non-timeout doctor failures and marks skipped checks explicitly', async () => {
    const caveMissing = await runDoctor(
      runtime({
        cave: {
          createClient: async () => {
            throw new Error('unused');
          },
          discoverEndpoint: async () => {
            throw Object.assign(new Error('missing cave'), { code: 'not_found' });
          },
        },
      }),
    );

    expect(caveMissing.output.data).toMatchObject({
      summary: {
        healthy: false,
        ok: 3,
        error: 1,
        skipped: 1,
      },
    });
    expect(caveMissing.output.human).toContain(
      '- cave.health: skipped — Not run because Cave discovery failed.',
    );

    const covenMissing = await runDoctor(
      runtime({
        coven: {
          discoverEndpoint: async () => {
            throw Object.assign(new Error('missing coven'), { code: 'not_found' });
          },
          readHealth: async () => covenHealth,
        },
      }),
    );

    expect(covenMissing.output.data).toMatchObject({
      summary: {
        healthy: false,
        ok: 3,
        error: 1,
        skipped: 1,
      },
    });
    expect(covenMissing.output.human).toContain(
      '- coven.health: skipped — Not run because Coven discovery failed.',
    );
  });

  test('omits optional cave discovery overrides when doctor builds a client without them', async () => {
    const createClient: ResolvedCliRuntime['cave']['createClient'] = vi.fn(async () => ({
      health: async () => caveHealth,
      createPairing: async () => {
        throw new Error('unused');
      },
      credentialStatus: async () => ({ status: 'missing' as const }),
      forgetCredential: async () => false,
    }));

    const result = await runDoctor(
      runtime({
        cave: {
          createClient,
          discoverEndpoint: async () => caveDiscovery,
        },
        discoveryOptions: {
          ...runtime().discoveryOptions,
          cave: undefined,
        } as unknown as ResolvedCliRuntime['discoveryOptions'],
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(createClient).toHaveBeenCalledOnce();
    expect(vi.mocked(createClient).mock.calls[0]?.[0]).not.toHaveProperty('discovery');
  });
});

describe('CLI Coven helpers', () => {
  test('fails closed for missing or mismatched Windows platform security', async () => {
    await expect(
      readDiscoveredCovenHealth(covenWindowsDiscovery),
    ).rejects.toMatchObject({
      code: 'platform_security_unavailable',
      retryable: false,
      diagnostics: {
        platform: 'windows',
        requirement: 'pipe_ownership',
      },
    });

    await expect(
      readDiscoveredCovenHealth(covenWindowsDiscovery, {
        transportSecurity: {
          platform: 'unix',
          peerIdentity: {
            inspectConnected: async () => ({ uid: 501 }),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });

    await expect(
      readDiscoveredCovenHealth(covenDiscovery, {
        transportSecurity: {
          platform: 'windows',
          ownership: {
            currentUserIdentity: async () => 'S-1-5-21-1000',
            inspect: async () => ({
              ownerIdentity: 'S-1-5-21-1000',
              ownerOnly: true,
              pipeIdentity: 'S-1-5-21-1000',
              serverProcessId: 24,
              processCreationTime: '2026-08-24T02:06:12.004Z',
            }),
            inspectConnected: async () => ({
              ownerIdentity: 'S-1-5-21-1000',
              ownerOnly: true,
              pipeIdentity: 'S-1-5-21-1000',
              serverProcessId: 24,
              processCreationTime: '2026-08-24T02:06:12.004Z',
            }),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });
  });

  test('reads discovered Windows Coven health when ownership checks and transport are injected', async () => {
    const connect = vi.fn(() =>
      connectedSocket(httpResponse(JSON.stringify(covenHealth))),
    );
    const windowsDiscoveryWithoutFreshness = { ...covenWindowsDiscovery };
    delete (
      windowsDiscoveryWithoutFreshness as { freshness?: unknown }
    ).freshness;
    const identity = {
      ownerIdentity: 'S-1-5-21-1000',
      ownerOnly: true,
      pipeIdentity: 'S-1-5-21-1000',
      serverProcessId: 24,
      processCreationTime: '2026-08-24T02:06:12.004Z',
    };

    await expect(
      readDiscoveredCovenHealth(
        windowsDiscoveryWithoutFreshness,
        {
        transportSecurity: {
          platform: 'windows',
          ownership: {
            currentUserIdentity: async () => 'S-1-5-21-1000',
            inspect: async () => identity,
            inspectConnected: async () => identity,
          },
        },
        windows: {
          dependencies: {
            connect,
          },
        },
      },
      ),
    ).resolves.toEqual(covenHealth);

    expect(connect).toHaveBeenCalledOnce();
  });

  test('rejects malformed discovered Windows Coven endpoints before connecting', async () => {
    await expect(
      readDiscoveredCovenHealth(
        {
          ...covenWindowsDiscovery,
          protocol: 'coven.daemon.v0',
        } as unknown as CovenDiscoveredEndpoint,
        {
          transportSecurity: {
            platform: 'windows',
            ownership: {
              currentUserIdentity: async () => 'S-1-5-21-1000',
              inspect: async () => ({
                ownerIdentity: 'S-1-5-21-1000',
                ownerOnly: true,
                pipeIdentity: 'S-1-5-21-1000',
                serverProcessId: 24,
                processCreationTime: '2026-08-24T02:06:12.004Z',
              }),
              inspectConnected: async () => ({
                ownerIdentity: 'S-1-5-21-1000',
                ownerOnly: true,
                pipeIdentity: 'S-1-5-21-1000',
                serverProcessId: 24,
                processCreationTime: '2026-08-24T02:06:12.004Z',
              }),
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'unsafe_endpoint',
    });
  });

  test('renders Coven discovery and health failures with normalized actions', async () => {
    const discoveryFailure = await runCovenHealth(
      runtime({
        coven: {
          discoverEndpoint: async () => {
            throw Object.assign(new Error('missing coven'), { code: 'not_found' });
          },
          readHealth: async () => covenHealth,
        },
      }),
    );

    expect(discoveryFailure.exitCode).toBe(1);
    expect(discoveryFailure.output.human).toEqual([
      'Coven health: failed',
      'Coven runtime discovery metadata was not found.',
      'Action: Start Coven or set COVEN_HOME to the reviewed runtime directory.',
    ]);

    const healthFailure = await runCovenHealth(
      runtime({
        coven: {
          discoverEndpoint: async () => covenDiscovery,
          readHealth: async () => {
            throw Object.assign(new Error('busy'), { code: 'service_unavailable' });
          },
        },
      }),
    );

    expect(healthFailure.exitCode).toBe(1);
    expect(healthFailure.output).toMatchObject({
      command: 'coven health',
      ok: false,
      data: {
        discovery: covenDiscovery,
      },
      error: {
        code: 'service_unavailable',
        message: 'The Coven daemon is temporarily unavailable.',
        action: 'Retry once the local service is healthy again.',
      },
    });
    expect(healthFailure.output.human).toEqual([
      'Coven health: failed',
      'The Coven daemon is temporarily unavailable.',
      'Action: Retry once the local service is healthy again.',
    ]);
  });
});
