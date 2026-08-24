import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAVE_PAIRING_SCOPES,
  createDiscoveredCaveClient,
  type CaveDiscoveryFileHandle,
  type CaveDiscoveryPathIdentity,
} from '@opencoven/cave-client';
import { createMemorySecretStore } from '@opencoven/sdk-core';
import {
  createNativeSecretStore,
  formatCliOutput,
  main,
  runCli,
} from '@opencoven/dev-cli';
import { describe, expect, test, vi } from 'vitest';

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fakeClockStart = Date.parse('2026-08-24T02:06:12.004Z');
const cliVersion = (
  JSON.parse(readFileSync(resolve(workspaceRoot, 'packages/cli/package.json'), 'utf8')) as {
    version: string;
  }
).version;
const usage = [
  'opencoven [--help] [--version] [--json]',
  'opencoven doctor [--json]',
  'opencoven discover [--json]',
  'opencoven cave pair [--json]',
  'opencoven cave status [--json]',
  'opencoven cave forget [--json]',
  'opencoven coven health [--json]',
] as const;
const helpLines = [
  'OpenCoven developer CLI',
  '',
  'Usage:',
  ...usage.map((line) => `  ${line}`),
  '',
  'Human output is written to stdout on success and stderr on failure.',
  'JSON output is always written to stdout.',
  '',
] as const;
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
  pairingRequired: true,
  releaseVersion: '0.1.0',
  capabilities: ['chat', 'pairing'],
  operations: ['health', 'pairing.create'],
} as const;
const caveCredential = {
  id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
  appName: 'OpenCoven CLI',
  installationId: 'opencoven-cli',
  scopes: [...CAVE_PAIRING_SCOPES],
  createdAt: 1_755_730_812_617,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
} as const;
const covenDiscovery = {
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
} as const;
const covenHealth = {
  ok: true,
  apiVersion: 'coven.daemon.v1',
  covenVersion: '0.1.0',
  capabilities: {
    sessions: true,
    events: true,
    eventCursor: 'sequence',
    structuredErrors: true,
  },
} as const;

function windowsDiscoveryRecord(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    endpoint: caveDiscovery.endpoint.url,
    pid: caveDiscovery.freshness.pid,
    nonce: caveDiscovery.freshness.nonce,
    startedAt: caveDiscovery.freshness.startedAt,
    ...overrides,
  });
}

function windowsDiscoveryIdentity(
  overrides: Partial<CaveDiscoveryPathIdentity> = {},
): CaveDiscoveryPathIdentity {
  return {
    device: 7,
    inode: 9,
    mode: 0o100600,
    ownerUid: 501,
    size: 0,
    symbolicLink: false,
    regularFile: true,
    directory: false,
    ...overrides,
  };
}

function windowsDiscoveryHandle(
  serialized: string,
  stats: CaveDiscoveryPathIdentity,
): CaveDiscoveryFileHandle {
  const bytes = Buffer.from(serialized, 'utf8');
  let offset = 0;

  return {
    read(buffer, bufferOffset, length) {
      const chunk = bytes.subarray(offset, offset + length);
      buffer.set(chunk, bufferOffset);
      offset += chunk.length;
      return Promise.resolve({ bytesRead: chunk.length });
    },
    close: () => Promise.resolve(),
    stat: () => Promise.resolve(stats),
  };
}

function createProbeableStore(
  probe: () => Promise<void> = () => Promise.resolve(),
) {
  return Object.assign(createMemorySecretStore(), { probe });
}

function caveResponse(status: number, data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      apiVersion: '1.0',
      minimumClientVersion: '0.1.0',
      capabilities: [...caveHealth.capabilities],
      operations: [...caveHealth.operations],
      data,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
      },
    },
  );
}

function createSlowMutationStore(
  options: { delayedMutation: number; delayMs: number },
) {
  const retained = new Map<string, string>();
  const log: Array<{ mutation: number; phase: 'start' | 'finish' }> = [];
  let mutationIndex = 0;
  let startedResolver: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    startedResolver = resolve;
  });

  const maybeDelay = async (current: number): Promise<void> => {
    if (current !== options.delayedMutation) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, options.delayMs);
    });
  };

  return {
    log,
    retained,
    store: {
      get(key: string) {
        return Promise.resolve(retained.get(key));
      },
      async set(key: string, value: string) {
        mutationIndex += 1;
        const current = mutationIndex;
        log.push({ mutation: current, phase: 'start' });
        if (current === options.delayedMutation) {
          startedResolver?.();
        }
        await maybeDelay(current);
        retained.set(key, value);
        log.push({ mutation: current, phase: 'finish' });
      },
      async delete(key: string) {
        mutationIndex += 1;
        const current = mutationIndex;
        log.push({ mutation: current, phase: 'start' });
        if (current === options.delayedMutation) {
          startedResolver?.();
        }
        await maybeDelay(current);
        const deleted = retained.delete(key);
        log.push({ mutation: current, phase: 'finish' });
        return deleted;
      },
    },
    started,
  };
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

function runtime(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const caveOverrides = overrides.cave as Record<string, unknown> | undefined;
  const covenOverrides = overrides.coven as Record<string, unknown> | undefined;
  const rest = { ...overrides };
  delete rest.cave;
  delete rest.coven;

  return {
    cave: {
      createClient: () => ({
        health: () => Promise.resolve(caveHealth),
        createPairing: () =>
          Promise.resolve({
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            expiresAt: 1_755_731_112_617,
            poll: () =>
              Promise.resolve({
                id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
                status: 'approved',
                expiresAt: 1_755_731_112_617,
              }),
            exchange: () => Promise.resolve(caveCredential),
          }),
        credentialStatus: () => Promise.resolve({ status: 'valid', access: 'chat:read', health: caveHealth }),
        forgetCredential: () => Promise.resolve(true),
      }),
      discoverEndpoint: () => Promise.resolve(caveDiscovery),
      ...caveOverrides,
    },
    coven: {
      discoverEndpoint: () => Promise.resolve(covenDiscovery),
      readHealth: () => Promise.resolve(covenHealth),
      ...covenOverrides,
    },
    createSecretStore: () => createProbeableStore(),
    now: () => 1_755_730_000_000,
    sleep: () => Promise.resolve(),
    ...rest,
  };
}

function never<T>(): Promise<T> {
  return new Promise(() => undefined);
}

async function runTimedCli(
  argv: readonly string[],
  overrides: Record<string, unknown>,
  advanceMs: number,
) {
  vi.useFakeTimers();
  vi.setSystemTime(fakeClockStart);

  try {
    const resultPromise = runCli(
      argv,
      runtime({
        now: () => Date.now(),
        sleep: (milliseconds: number) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds)),
        ...overrides,
      }),
    );

    await vi.advanceTimersByTimeAsync(advanceMs);

    const result = await resultPromise;
    return {
      result,
      json: JSON.parse(result.stdout) as Record<string, unknown>,
    };
  } finally {
    vi.useRealTimers();
  }
}

interface KeyringEntryShape {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): void;
}

function nativeStoreWithEntry(
  entry: new (service: string, account: string) => KeyringEntryShape,
) {
  return createNativeSecretStore({
    loadModule: () => Promise.resolve({ Entry: entry }),
    service: 'OpenCoven CLI',
  });
}

describe('opencoven CLI output', () => {
  test('returns stable human-readable help without touching local services', async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${helpLines.join('\n')}`,
    });
  });

  test('returns stable JSON help and version output', async () => {
    const help = await runCli(['doctor', '--help', '--json']);

    expect(help.exitCode).toBe(0);
    expect(JSON.parse(help.stdout)).toEqual({
      command: 'help',
      data: {
        name: 'opencoven',
        usage,
      },
      ok: true,
      version: cliVersion,
    });

    await expect(runCli(['--version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${cliVersion}\n`,
    });

    const version = await runCli(['--json', '--version']);

    expect(JSON.parse(version.stdout)).toEqual({
      command: 'version',
      ok: true,
      version: cliVersion,
    });
  });

  test('rejects unknown and incomplete arguments with deterministic usage', async () => {
    await expect(runCli(['cave', 'pair', '--bogus'])).resolves.toEqual({
      exitCode: 1,
      stdout: '',
      stderr: [
        'Unknown option "--bogus".',
        '',
        'Usage:',
        ...usage.map((line) => `  ${line}`),
        '',
      ].join('\n'),
    });

    const result = await runCli(['--json', 'coven']);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'coven',
      data: { usage },
      error: {
        code: 'invalid_arguments',
        message: 'Unknown or incomplete command.',
        action: 'Run `opencoven --help` to review the supported commands.',
      },
      ok: false,
      version: cliVersion,
    });

    for (const argv of [
      ['--json', 'cave', 'pair', '--bogus'],
      ['cave', 'pair', '--bogus', '--json'],
    ] as const) {
      const invalidJson = await runCli(argv);

      expect(invalidJson.exitCode).toBe(1);
      expect(invalidJson.stderr).toBe('');
      expect(JSON.parse(invalidJson.stdout)).toEqual({
        command: 'cave pair',
        data: { usage },
        error: {
          code: 'invalid_arguments',
          message: 'Unknown option "--bogus".',
          action: 'Run `opencoven --help` to review the supported commands.',
        },
        ok: false,
        version: cliVersion,
      });
    }
  });

  test('redacts nested secret-like fields from JSON output', () => {
    const output = formatCliOutput(
      {
        command: 'doctor',
        data: {
          cause: {
            secret: 'top-secret',
            service: 'OpenCoven CLI',
          },
          nested: {
            authorization: 'Bearer secret-token',
            pairingSecret: 'pairing-secret-value',
            safe: 'kept',
          },
        },
        error: {
          code: 'secure_store_unavailable',
          message: 'Native secure credential storage is unavailable.',
          details: {
            bearer: 'should-hide',
            stack: 'also-hide',
            safe: 'still-here',
          },
        },
        human: ['ignore human'],
        ok: false,
        version: cliVersion,
      },
      'json',
    );

    expect(JSON.parse(output)).toEqual({
      command: 'doctor',
      data: {
        nested: {
          authorization: '[REDACTED]',
          pairingSecret: '[REDACTED]',
          safe: 'kept',
        },
      },
      error: {
        code: 'secure_store_unavailable',
        details: {
          bearer: '[REDACTED]',
          safe: 'still-here',
        },
        message: 'Native secure credential storage is unavailable.',
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('returns stable doctor diagnostics and marks unhealthy checks as failures', async () => {
    const healthy = await runCli(['--json', 'doctor'], runtime());

    expect(healthy.exitCode).toBe(0);
    expect(JSON.parse(healthy.stdout)).toEqual({
      command: 'doctor',
      data: {
        checks: [
          {
            id: 'cave.discovery',
            status: 'ok',
            summary: 'Discovered the Cave client endpoint.',
            data: {
              endpoint: caveDiscovery.endpoint,
              freshness: {
                pid: caveDiscovery.freshness.pid,
                startedAt: caveDiscovery.freshness.startedAt,
              },
              record: caveDiscovery.record,
            },
          },
          {
            id: 'cave.health',
            status: 'ok',
            summary: 'Cave health is compatible.',
            data: caveHealth,
          },
          {
            id: 'secure-store',
            status: 'ok',
            summary: 'Native secure credential storage is available.',
            data: {
              backend: 'native',
            },
          },
          {
            id: 'coven.discovery',
            status: 'ok',
            summary: 'Discovered the Coven daemon endpoint.',
            data: covenDiscovery,
          },
          {
            id: 'coven.health',
            status: 'ok',
            summary: 'Coven daemon health is compatible.',
            data: {
              covenVersion: covenHealth.covenVersion,
              capabilities: covenHealth.capabilities,
            },
          },
        ],
        summary: {
          healthy: true,
          ok: 5,
          error: 0,
          skipped: 0,
        },
      },
      ok: true,
      version: cliVersion,
    });

    const unhealthy = await runCli(
      ['doctor'],
      runtime({
        coven: {
          readHealth: () =>
            Promise.reject(
              Object.assign(new Error('admin token secret'), {
                code: 'connect_failure',
                retryable: true,
                diagnostics: { phase: 'connect' },
              }),
            ),
        },
      }),
    );

    expect(unhealthy.exitCode).toBe(1);
    expect(unhealthy.stdout).toBe('');
    expect(unhealthy.stderr).toContain('OpenCoven doctor: unhealthy');
    expect(unhealthy.stderr).toContain('coven.health: error');
    expect(unhealthy.stderr).not.toContain('admin token');
  });

  test('times out a hung doctor check without starting later work', async () => {
    const createSecretStore = vi.fn(() => createProbeableStore());
    const { result, json } = await runTimedCli(
      ['--json', 'doctor'],
      {
        cave: {
          discoverEndpoint: () => never(),
        },
        createSecretStore,
        timing: {
          doctorTimeoutMs: 25,
        },
      },
      25,
    );

    expect(result.exitCode).toBe(1);
    expect(json).toEqual({
      command: 'doctor',
      data: {
        checks: [
          {
            id: 'cave.discovery',
            status: 'error',
            summary: 'Cave runtime discovery failed.',
            error: {
              code: 'timeout',
              message: 'Cave runtime discovery timed out.',
              retryable: true,
            },
          },
          {
            id: 'cave.health',
            status: 'skipped',
            summary: 'Not run because the doctor deadline expired.',
          },
          {
            id: 'secure-store',
            status: 'skipped',
            summary: 'Not run because the doctor deadline expired.',
          },
          {
            id: 'coven.discovery',
            status: 'skipped',
            summary: 'Not run because the doctor deadline expired.',
          },
          {
            id: 'coven.health',
            status: 'skipped',
            summary: 'Not run because the doctor deadline expired.',
          },
        ],
        summary: {
          healthy: false,
          ok: 0,
          error: 1,
          skipped: 4,
        },
      },
      error: {
        code: 'unhealthy',
        message: 'One or more diagnostics failed.',
      },
      ok: false,
      version: cliVersion,
    });
    expect(createSecretStore).not.toHaveBeenCalled();
  });

  test.each([
    [
      'constructor',
      class {
        constructor(service: string, account: string) {
          void service;
          void account;
          throw new Error('OpenCoven CLI constructor secret should not leak');
        }

        getPassword(): string | undefined {
          return undefined;
        }

        setPassword(): void {
          throw new Error('unreachable');
        }

        deletePassword(): void {
          throw new Error('unreachable');
        }
      },
      'constructor secret',
    ],
    [
      'backend',
      class {
        constructor(service: string, account: string) {
          void service;
          void account;
        }

        getPassword(): string | undefined {
          throw new Error('secret-service bearer should not leak');
        }

        setPassword(): void {
          throw new Error('unreachable');
        }

        deletePassword(): void {
          throw new Error('unreachable');
        }
      },
      'secret-service bearer',
    ],
  ] as const)(
    'reports %s secure-store probe failures in doctor',
    async (_label, Entry, leakedText) => {
      const result = await runCli(
        ['--json', 'doctor'],
        runtime({
          createSecretStore: () => nativeStoreWithEntry(Entry),
        }),
      );

      expect(result.exitCode).toBe(1);
      const output = JSON.parse(result.stdout) as {
        command: string;
        data: {
          summary: {
            healthy: boolean;
            error: number;
          };
          checks: Array<{
            id: string;
            status: string;
            summary: string;
            error?: {
              code: string;
              message: string;
              retryable?: boolean;
              action?: string;
            };
          }>;
        };
        error: {
          code: string;
          message: string;
        };
        ok: boolean;
        version: string;
      };
      const secureStoreCheck = output.data.checks.find((check) => check.id === 'secure-store');

      expect(output.command).toBe('doctor');
      expect(output.data.summary).toEqual({
        healthy: false,
        ok: 4,
        error: 1,
        skipped: 0,
      });
      expect(secureStoreCheck).toEqual({
        id: 'secure-store',
        status: 'error',
        summary: 'Native secure credential storage is unavailable.',
        error: {
          code: 'secure_store_unavailable',
          message: 'Native secure credential storage is unavailable.',
          retryable: false,
          action: 'Enable the platform secure-store backend for this user session and retry.',
        },
      });
      expect(output.error).toEqual({
        code: 'unhealthy',
        message: 'One or more diagnostics failed.',
      });
      expect(output.ok).toBe(false);
      expect(output.version).toBe(cliVersion);
      expect(result.stdout).not.toContain(leakedText);
    },
  );

  test('returns explicit secret-free runtime discovery metadata', async () => {
    const success = await runCli(['discover', '--json'], runtime());

    expect(success.exitCode).toBe(0);
    expect(JSON.parse(success.stdout)).toEqual({
      command: 'discover',
      data: {
        cave: {
          status: 'ok',
          discovery: {
            endpoint: caveDiscovery.endpoint,
            freshness: {
              pid: caveDiscovery.freshness.pid,
              startedAt: caveDiscovery.freshness.startedAt,
            },
            record: caveDiscovery.record,
          },
        },
        coven: {
          status: 'ok',
          discovery: covenDiscovery,
        },
      },
      ok: true,
      version: cliVersion,
    });

    const failure = await runCli(
      ['--json', 'discover'],
      runtime({
        cave: {
          discoverEndpoint: () =>
            Promise.reject(Object.assign(new Error('not found'), { code: 'not_found', retryable: true })),
        },
      }),
    );

    expect(failure.exitCode).toBe(1);
    expect(JSON.parse(failure.stdout)).toEqual({
      command: 'discover',
      data: {
        cave: {
          status: 'error',
          error: {
            code: 'not_found',
            message: 'Cave runtime discovery metadata was not found.',
            retryable: true,
            action: 'Start Cave or set COVEN_CAVE_HOME to the reviewed runtime directory.',
          },
        },
        coven: {
          status: 'ok',
          discovery: covenDiscovery,
        },
      },
      error: {
        code: 'discovery_failed',
        message: 'One or more runtime discovery probes failed.',
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('fails Cave discovery closed on Windows without native path trust', async () => {
    const result = await runCli(
      ['--json', 'discover'],
      runtime({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        cave: {
          discoverEndpoint: undefined,
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'discover',
      data: {
        cave: {
          status: 'error',
          error: {
            code: 'platform_security_unavailable',
            message: 'Required native Cave platform security is unavailable.',
            retryable: false,
            action:
              'Use a reviewed OpenCoven CLI/runtime with native Windows Cave path ownership/ACL validation, or inject CliRuntime.cave.discovery.dependencies.windowsPathTrust, then retry.',
            details: {
              platform: 'windows',
              requirement: 'path_ownership_acl',
            },
          },
        },
        coven: {
          status: 'ok',
          discovery: covenDiscovery,
        },
      },
      error: {
        code: 'discovery_failed',
        message: 'One or more runtime discovery probes failed.',
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('accepts injected Windows Cave path trust and rejects mismatches for default discovery', async () => {
    const discoveryRoot = 'C:\\Users\\Alice\\.coven\\cave';
    const recordPath = `${discoveryRoot}\\client-v1-discovery.json`;
    const recordBytes = windowsDiscoveryRecord();
    const rootIdentity = windowsDiscoveryIdentity({
      regularFile: false,
      directory: true,
      mode: 0o040700,
      size: 0,
    });
    const recordIdentity = windowsDiscoveryIdentity({
      size: Buffer.byteLength(recordBytes),
    });
    const lstat = (path: string) => {
      if (path === discoveryRoot) {
        return Promise.resolve(rootIdentity);
      }
      if (path === recordPath) {
        return Promise.resolve(recordIdentity);
      }
      return Promise.reject(Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' }));
    };
    const validate = vi.fn(() => Promise.resolve(true));

    const success = await runCli(
      ['--json', 'discover'],
      runtime({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        cave: {
          discoverEndpoint: undefined,
          discovery: {
            dependencies: {
              isProcessAlive: () => true,
              lstat,
              openFile: () => Promise.resolve(windowsDiscoveryHandle(recordBytes, recordIdentity)),
              realpath: (path: string) => Promise.resolve(path),
              windowsPathTrust: {
                validate,
              },
            },
          },
        },
      }),
    );

    expect(success.exitCode).toBe(0);
    expect(JSON.parse(success.stdout)).toEqual({
      command: 'discover',
      data: {
        cave: {
          status: 'ok',
          discovery: {
            endpoint: caveDiscovery.endpoint,
            freshness: {
              pid: caveDiscovery.freshness.pid,
              startedAt: caveDiscovery.freshness.startedAt,
            },
            record: {
              path: recordPath,
              device: recordIdentity.device,
              inode: recordIdentity.inode,
            },
          },
        },
        coven: {
          status: 'ok',
          discovery: covenDiscovery,
        },
      },
      ok: true,
      version: cliVersion,
    });
    expect(validate).toHaveBeenNthCalledWith(1, discoveryRoot, 'root');
    expect(validate).toHaveBeenNthCalledWith(2, recordPath, 'record');

    const mismatch = await runCli(
      ['--json', 'discover'],
      runtime({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        cave: {
          discoverEndpoint: undefined,
          discovery: {
            dependencies: {
              isProcessAlive: () => true,
              lstat,
              openFile: () => Promise.resolve(windowsDiscoveryHandle(recordBytes, recordIdentity)),
              realpath: (path: string) => Promise.resolve(path),
              windowsPathTrust: {
                validate: () => Promise.resolve(false),
              },
            },
          },
        },
      }),
    );

    expect(mismatch.exitCode).toBe(1);
    expect(JSON.parse(mismatch.stdout)).toEqual({
      command: 'discover',
      data: {
        cave: {
          status: 'error',
          error: {
            code: 'owner_mismatch',
            message: 'The discovered Cave runtime is not owned by the current user.',
            retryable: false,
            action: 'Repair the local runtime ownership or permissions and retry.',
          },
        },
        coven: {
          status: 'ok',
          discovery: covenDiscovery,
        },
      },
      error: {
        code: 'discovery_failed',
        message: 'One or more runtime discovery probes failed.',
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('reports missing Windows Cave path trust in doctor and skips Cave health', async () => {
    const result = await runCli(
      ['--json', 'doctor'],
      runtime({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        cave: {
          discoverEndpoint: undefined,
        },
      }),
    );
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
    expect(output.error).toEqual({
      code: 'unhealthy',
      message: 'One or more diagnostics failed.',
    });
    expect(summary).toEqual({
      healthy: false,
      ok: 3,
      error: 1,
      skipped: 1,
    });
    expect(
      checks.some(
        (check) =>
          check.id === 'cave.discovery' &&
          check.status === 'error' &&
          isObject(check.error) &&
          check.error.code === 'platform_security_unavailable',
      ),
    ).toBe(true);
    expect(
      checks.some(
        (check) =>
          check.id === 'cave.health' &&
          check.status === 'skipped',
      ),
    ).toBe(true);
  });

  test('creates, polls, exchanges, and reports Cave pairing without leaking the bearer', async () => {
    const store = createMemorySecretStore();
    let now = 1_755_730_000_000;
    const sleeps: number[] = [];
    const createPairing = vi.fn((request: unknown) => {
      expect(request).toEqual({
        appName: 'OpenCoven CLI',
        installationId: 'opencoven-cli',
        scopes: [...CAVE_PAIRING_SCOPES],
      });
      return Promise.resolve({
        requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
        expiresAt: now + 10_000,
        poll: vi
          .fn()
          .mockResolvedValueOnce({
            id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            status: 'pending',
            expiresAt: now + 10_000,
          })
          .mockResolvedValueOnce({
            id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            status: 'approved',
            expiresAt: now + 10_000,
          }),
        exchange: async () => {
          await store.set('opencoven.cli.cave.credential', 'bearer-value');
          return caveCredential;
        },
      });
    });

    const result = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        cave: {
          createClient: () => ({ createPairing }),
        },
        createSecretStore: () => store,
        now: () => now,
        sleep: (milliseconds: number) => {
          sleeps.push(milliseconds);
          now += milliseconds;
          return Promise.resolve();
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 2,
        credential: caveCredential,
        expiresAt: 1_755_730_010_000,
        requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
        status: 'approved',
      },
      ok: true,
      version: cliVersion,
    });
    expect(sleeps).toEqual([1_000]);
    expect(result.stdout).not.toContain('bearer-value');
  });

  test.each([
    {
      argv: ['--json', 'cave', 'pair'] as const,
      command: 'cave pair',
      createClient: vi.fn(async (options: Record<string, unknown>) => {
        const discoverEndpoint = options.discoverEndpoint as
          | ((value: unknown) => Promise<unknown>)
          | undefined;
        expect(await discoverEndpoint?.(options.discovery)).toEqual(caveDiscovery);
        await expect(discoverEndpoint?.(options.discovery)).rejects.toMatchObject({
          code: 'reconcile_required',
          details: {
            reason: 'authority_restarted',
          },
        });
        return {
          createPairing: () =>
            Promise.resolve({
              requestId: 'injected-pair-request',
              expiresAt: 1_755_731_112_617,
              poll: () =>
                Promise.resolve({
                  id: 'injected-pair-request',
                  status: 'approved' as const,
                  expiresAt: 1_755_731_112_617,
                }),
              exchange: () => Promise.resolve(caveCredential),
            }),
        };
      }),
    },
    {
      argv: ['--json', 'cave', 'status'] as const,
      command: 'cave status',
      createClient: vi.fn(async (options: Record<string, unknown>) => {
        const discoverEndpoint = options.discoverEndpoint as
          | ((value: unknown) => Promise<unknown>)
          | undefined;
        expect(await discoverEndpoint?.(options.discovery)).toEqual(caveDiscovery);
        await expect(discoverEndpoint?.(options.discovery)).rejects.toMatchObject({
          code: 'reconcile_required',
          details: {
            reason: 'authority_restarted',
          },
        });
        return {
          credentialStatus: () =>
            Promise.resolve({ status: 'valid' as const, access: 'chat:read', health: caveHealth }),
        };
      }),
    },
    {
      argv: ['--json', 'cave', 'forget'] as const,
      command: 'cave forget',
      createClient: vi.fn(async (options: Record<string, unknown>) => {
        const discoverEndpoint = options.discoverEndpoint as
          | ((value: unknown) => Promise<unknown>)
          | undefined;
        expect(await discoverEndpoint?.(options.discovery)).toEqual(caveDiscovery);
        await expect(discoverEndpoint?.(options.discovery)).rejects.toMatchObject({
          code: 'reconcile_required',
          details: {
            reason: 'authority_restarted',
          },
        });
        return {
          forgetCredential: () => Promise.resolve(true),
        };
      }),
    },
  ])(
    'threads injected Cave discovery into $command client construction',
    async ({ argv, command, createClient }) => {
      const discoverEndpoint = vi
        .fn()
        .mockResolvedValueOnce(caveDiscovery)
        .mockResolvedValueOnce({
          ...caveDiscovery,
          freshness: {
            ...caveDiscovery.freshness,
            nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba199',
          },
        });

      const result = await runCli(
        argv,
        runtime({
          cave: {
            createClient,
            discoverEndpoint,
          },
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        command,
        ok: true,
        version: cliVersion,
      });
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(discoverEndpoint).toHaveBeenCalledTimes(2);
    },
  );

  test('returns explicit pending, denied, expired, version, and store pairing failures', async () => {
    let now = 1_755_730_000_000;
    const pending = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'pending-request',
                expiresAt: now + 2_100,
                poll: () =>
                  Promise.resolve({
                    id: 'pending-request',
                    status: 'pending',
                    expiresAt: now + 2_100,
                  }),
                exchange: () => Promise.resolve(caveCredential),
              }),
          }),
        },
        now: () => now,
        sleep: (milliseconds: number) => {
          now += milliseconds;
          return Promise.resolve();
        },
      }),
    );

    expect(JSON.parse(pending.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 2,
        expiresAt: 1_755_730_002_100,
        requestId: 'pending-request',
        status: 'pending',
      },
      error: {
        code: 'pairing_pending',
        message: 'Cave pairing is still pending approval.',
        action:
          'Approve the pairing request in Cave and rerun `opencoven cave pair` before the request expires.',
      },
      ok: false,
      version: cliVersion,
    });

    for (const status of ['denied', 'expired'] as const) {
      const result = await runCli(
        ['--json', 'cave', 'pair'],
        runtime({
          cave: {
            createClient: () => ({
              createPairing: () =>
                Promise.resolve({
                  requestId: `${status}-request`,
                  expiresAt: 1_755_731_112_617,
                  poll: () =>
                    Promise.resolve({
                      id: `${status}-request`,
                      status,
                      expiresAt: 1_755_731_112_617,
                    }),
                  exchange: () => Promise.resolve(caveCredential),
                }),
            }),
          },
        }),
      );

      expect(JSON.parse(result.stdout)).toEqual({
        command: 'cave pair',
        data: {
          attempts: 1,
          expiresAt: 1_755_731_112_617,
          requestId: `${status}-request`,
          status,
        },
        error: {
          code: `pairing_${status}`,
          message:
            status === 'denied'
              ? 'Cave pairing request was denied.'
              : 'Cave pairing request expired before approval.',
          action: 'Start a new pairing request with `opencoven cave pair`.',
        },
        ok: false,
        version: cliVersion,
      });
    }

    const version = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'version-request',
                expiresAt: 1_755_731_112_617,
                poll: () =>
                  Promise.resolve({
                    id: 'version-request',
                    status: 'approved',
                    expiresAt: 1_755_731_112_617,
                  }),
                exchange: () =>
                  Promise.reject(
                    Object.assign(new Error('minimum version 9.9.9'), {
                      code: 'incompatible_version',
                      retryable: false,
                    }),
                  ),
              }),
          }),
        },
      }),
    );

    expect(JSON.parse(version.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 1,
        expiresAt: 1_755_731_112_617,
        requestId: 'version-request',
      },
      error: {
        code: 'incompatible_version',
        message: 'The local Cave service requires a newer OpenCoven CLI version.',
        retryable: false,
        action: 'Upgrade the OpenCoven CLI to the minimum reviewed version and retry.',
      },
      ok: false,
      version: cliVersion,
    });

    const storeError = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'store-request',
                expiresAt: 1_755_731_112_617,
                poll: () =>
                  Promise.resolve({
                    id: 'store-request',
                    status: 'approved',
                    expiresAt: 1_755_731_112_617,
                  }),
                exchange: () =>
                  Promise.reject(
                    Object.assign(new Error('OpenCoven CLI secret store failed'), {
                      code: 'secret_store_write_failed',
                      cause: Object.assign(new Error('backend bearer secret'), {
                        code: 'secure_store_unavailable',
                        operation: 'set',
                        retryable: false,
                      }),
                    }),
                  ),
              }),
          }),
        },
      }),
    );

    expect(JSON.parse(storeError.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 1,
        expiresAt: 1_755_731_112_617,
        requestId: 'store-request',
      },
      error: {
        code: 'secure_store_unavailable',
        message: 'Native secure credential storage is unavailable.',
        retryable: false,
        action: 'Enable the platform secure-store backend for this user session and retry.',
      },
      ok: false,
      version: cliVersion,
    });
    expect(storeError.stdout).not.toContain('OpenCoven CLI');
    expect(storeError.stdout).not.toContain('bearer secret');
  });

  test('reproduces fail-closed CLI timeout during credential binding persistence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fakeClockStart);

    try {
      const slowStore = createSlowMutationStore({
        delayedMutation: 6,
        delayMs: 50,
      });
      const timedCreateClient = (options: Parameters<typeof createDiscoveredCaveClient>[0]) => {
        const client = createDiscoveredCaveClient(options);
        return {
          health: client.health.bind(client),
          credentialStatus: client.credentialStatus.bind(client),
          forgetCredential: client.forgetCredential.bind(client),
          createPairing: async (
            request: Parameters<typeof client.createPairing>[0],
            createOptions?: Parameters<typeof client.createPairing>[1],
          ) => {
            const session = await client.createPairing(request, createOptions);
            return {
              requestId: session.requestId,
              expiresAt: session.expiresAt,
              poll: session.poll.bind(session),
              exchange: (exchangeOptions?: { timeoutMs?: number }) =>
                session.exchange({
                  ...(exchangeOptions ?? {}),
                  timeoutMs: 10,
                }),
            };
          },
        };
      };
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          caveResponse(201, {
            requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            expiresAt: fakeClockStart + 10_000,
          }),
        )
        .mockResolvedValueOnce(
          caveResponse(200, {
            id: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
            status: 'approved',
            expiresAt: fakeClockStart + 10_000,
          }),
        )
        .mockResolvedValueOnce(
          caveResponse(200, {
            bearer: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            credential: caveCredential,
          }),
        );

      const pairPromise = runCli(
        ['--json', 'cave', 'pair'],
        runtime({
          now: () => Date.now(),
          sleep: (milliseconds: number) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
          timing: {
            cavePairTimeoutMs: 100,
            cavePairPollIntervalMs: 10,
          },
          fetch: fetchImplementation,
          createSecretStore: () => slowStore.store,
          cave: {
            createClient: timedCreateClient,
            discoverEndpoint: () => Promise.resolve(caveDiscovery),
          },
        }),
      );

      await vi.advanceTimersByTimeAsync(200);
      const pair = await pairPromise;

      expect(pair.exitCode).toBe(1);
      expect(JSON.parse(pair.stdout)).toEqual({
        command: 'cave pair',
        data: {
          attempts: 1,
          expiresAt: fakeClockStart + 10_000,
          requestId: '018f4f1a-77c2-7a31-8a15-55a25aaba001',
        },
        error: {
          code: 'timeout',
          message: 'The Cave operation timed out.',
          retryable: true,
        },
        ok: false,
        version: cliVersion,
      });
      expect(pair.stdout).not.toContain('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

      const settledLogLength = slowStore.log.length;
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      expect(slowStore.log).toHaveLength(settledLogLength);

      const status = await runCli(
        ['--json', 'cave', 'status'],
        runtime({
          now: () => Date.now(),
          sleep: (milliseconds: number) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
          fetch: fetchImplementation,
          createSecretStore: () => slowStore.store,
          cave: {
            createClient: createDiscoveredCaveClient,
            discoverEndpoint: () => Promise.resolve(caveDiscovery),
          },
        }),
      );

      expect(JSON.parse(status.stdout)).toEqual({
        command: 'cave status',
        data: {
          status: 'missing',
        },
        error: {
          code: 'missing_credential',
          message: 'No Cave credential is stored.',
          action: 'Run `opencoven cave pair` to create and store a credential.',
        },
        ok: false,
        version: cliVersion,
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test('times out hung discover, pair create, pair exchange, status, forget, and Coven health commands', async () => {
    const discover = await runTimedCli(
      ['--json', 'discover'],
      {
        cave: {
          discoverEndpoint: () => never(),
        },
        timing: {
          discoverTimeoutMs: 25,
        },
      },
      25,
    );

    expect(discover.result.exitCode).toBe(1);
    expect(discover.json).toEqual({
      command: 'discover',
      data: {
        cave: {
          status: 'error',
          error: {
            code: 'timeout',
            message: 'Cave runtime discovery timed out.',
            retryable: true,
          },
        },
        coven: {
          status: 'ok',
          discovery: covenDiscovery,
        },
      },
      error: {
        code: 'discovery_failed',
        message: 'One or more runtime discovery probes failed.',
      },
      ok: false,
      version: cliVersion,
    });

    const pairCreate = await runTimedCli(
      ['--json', 'cave', 'pair'],
      {
        cave: {
          createClient: () => ({
            createPairing: () => never(),
          }),
        },
        timing: {
          cavePairTimeoutMs: 25,
        },
      },
      25,
    );

    expect(pairCreate.result.exitCode).toBe(1);
    expect(pairCreate.json).toEqual({
      command: 'cave pair',
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });

    const pairExchange = await runTimedCli(
      ['--json', 'cave', 'pair'],
      {
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'exchange-request',
                expiresAt: fakeClockStart + 10_000,
                poll: () =>
                  Promise.resolve({
                    id: 'exchange-request',
                    status: 'approved',
                    expiresAt: fakeClockStart + 10_000,
                  }),
                exchange: () => never(),
              }),
          }),
        },
        timing: {
          cavePairTimeoutMs: 25,
        },
      },
      25,
    );

    expect(pairExchange.result.exitCode).toBe(1);
    expect(pairExchange.json).toEqual({
      command: 'cave pair',
      data: {
        attempts: 1,
        expiresAt: fakeClockStart + 10_000,
        requestId: 'exchange-request',
      },
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });

    const status = await runTimedCli(
      ['--json', 'cave', 'status'],
      {
        cave: {
          createClient: () => ({
            credentialStatus: () => never(),
          }),
        },
        timing: {
          caveStatusTimeoutMs: 25,
        },
      },
      25,
    );

    expect(status.result.exitCode).toBe(1);
    expect(status.json).toEqual({
      command: 'cave status',
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });

    const forget = await runTimedCli(
      ['--json', 'cave', 'forget'],
      {
        cave: {
          createClient: () => ({
            forgetCredential: () => never(),
          }),
        },
        timing: {
          caveForgetTimeoutMs: 25,
        },
      },
      25,
    );

    expect(forget.result.exitCode).toBe(1);
    expect(forget.json).toEqual({
      command: 'cave forget',
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });

    const coven = await runTimedCli(
      ['--json', 'coven', 'health'],
      {
        coven: {
          readHealth: () => never(),
        },
        timing: {
          covenHealthTimeoutMs: 25,
        },
      },
      25,
    );

    expect(coven.result.exitCode).toBe(1);
    expect(coven.json).toEqual({
      command: 'coven health',
      data: {
        discovery: covenDiscovery,
      },
      error: {
        code: 'timeout',
        message: 'The Coven daemon health check timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('returns timeout when cave pair create settles on the absolute deadline', async () => {
    let now = fakeClockStart;
    const expiresAt = fakeClockStart + 10_000;
    const poll = vi.fn(() =>
      Promise.resolve({
        id: 'late-create-request',
        status: 'pending' as const,
        expiresAt,
      }),
    );
    const exchange = vi.fn(() => Promise.resolve(caveCredential));

    const result = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        now: () => now,
        timing: {
          cavePairTimeoutMs: 50,
        },
        cave: {
          createClient: () => ({
            createPairing: () => {
              now = fakeClockStart + 50;
              return Promise.resolve({
                requestId: 'late-create-request',
                expiresAt,
                poll,
                exchange,
              });
            },
          }),
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 0,
        expiresAt,
        requestId: 'late-create-request',
      },
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });
    expect(poll).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  test('returns timeout when cave pair poll settles on the absolute deadline', async () => {
    let now = fakeClockStart;
    const expiresAt = fakeClockStart + 10_000;
    const poll = vi.fn(() => {
      now = fakeClockStart + 50;
      return Promise.resolve({
        id: 'late-poll-request',
        status: 'pending' as const,
        expiresAt,
      });
    });
    const exchange = vi.fn(() => Promise.resolve(caveCredential));

    const result = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        now: () => now,
        timing: {
          cavePairTimeoutMs: 50,
        },
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'late-poll-request',
                expiresAt,
                poll,
                exchange,
              }),
          }),
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 1,
        expiresAt,
        requestId: 'late-poll-request',
      },
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(exchange).not.toHaveBeenCalled();
  });

  test('returns timeout when cave pair exchange settles on the absolute deadline', async () => {
    let now = fakeClockStart;
    const expiresAt = fakeClockStart + 10_000;
    const poll = vi.fn(() =>
      Promise.resolve({
        id: 'late-exchange-request',
        status: 'approved' as const,
        expiresAt,
      }),
    );
    const exchange = vi.fn(() => {
      now = fakeClockStart + 50;
      return Promise.resolve(caveCredential);
    });

    const result = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        now: () => now,
        timing: {
          cavePairTimeoutMs: 50,
        },
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'late-exchange-request',
                expiresAt,
                poll,
                exchange,
              }),
          }),
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 1,
        expiresAt,
        requestId: 'late-exchange-request',
      },
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  test('returns timeout when cave pair sleep reaches the absolute deadline after a pending poll', async () => {
    let now = fakeClockStart;
    const expiresAt = fakeClockStart + 10_000;

    const result = await runCli(
      ['--json', 'cave', 'pair'],
      runtime({
        now: () => now,
        timing: {
          cavePairTimeoutMs: 50,
          cavePairPollIntervalMs: 50,
        },
        cave: {
          createClient: () => ({
            createPairing: () =>
              Promise.resolve({
                requestId: 'sleep-deadline-request',
                expiresAt,
                poll: () =>
                  Promise.resolve({
                    id: 'sleep-deadline-request',
                    status: 'pending' as const,
                    expiresAt,
                  }),
                exchange: () => Promise.resolve(caveCredential),
              }),
          }),
        },
        sleep: (milliseconds: number) => {
          now += milliseconds;
          return Promise.resolve();
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'cave pair',
      data: {
        attempts: 1,
        expiresAt,
        requestId: 'sleep-deadline-request',
      },
      error: {
        code: 'timeout',
        message: 'The Cave operation timed out.',
        retryable: true,
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('preserves one absolute Cave pairing deadline across polls and stops before exchange', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fakeClockStart);

    try {
      const poll = vi
        .fn()
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            id: 'deadline-request',
            status: 'pending' as const,
            expiresAt: fakeClockStart + 10_000,
          };
        })
        .mockImplementationOnce(() => never());
      const exchange = vi.fn(() => Promise.resolve(caveCredential));

      const resultPromise = runCli(
        ['--json', 'cave', 'pair'],
        runtime({
          now: () => Date.now(),
          sleep: (milliseconds: number) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
          timing: {
            cavePairTimeoutMs: 50,
            cavePairPollIntervalMs: 10,
          },
          cave: {
            createClient: () => ({
              createPairing: () =>
                Promise.resolve({
                  requestId: 'deadline-request',
                  expiresAt: fakeClockStart + 10_000,
                  poll,
                  exchange,
                }),
            }),
          },
        }),
      );

      await vi.advanceTimersByTimeAsync(50);

      const result = await resultPromise;
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        command: 'cave pair',
        data: {
          attempts: 2,
          expiresAt: fakeClockStart + 10_000,
          requestId: 'deadline-request',
        },
        error: {
          code: 'timeout',
          message: 'The Cave operation timed out.',
          retryable: true,
        },
        ok: false,
        version: cliVersion,
      });
      expect(poll).toHaveBeenCalledTimes(2);
      expect(poll.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 50 });
      expect(poll.mock.calls[1]?.[0]).toMatchObject({ timeoutMs: 10 });
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('reports stored Cave credential status and forgets credentials deterministically', async () => {
    const valid = await runCli(['--json', 'cave', 'status'], runtime());

    expect(JSON.parse(valid.stdout)).toEqual({
      command: 'cave status',
      data: {
        status: 'valid',
        access: 'chat:read',
        health: caveHealth,
      },
      ok: true,
      version: cliVersion,
    });

    const missing = await runCli(
      ['--json', 'cave', 'status'],
      runtime({
        cave: {
          createClient: () => ({
            credentialStatus: () => Promise.resolve({ status: 'missing' }),
          }),
        },
      }),
    );

    expect(JSON.parse(missing.stdout)).toEqual({
      command: 'cave status',
      data: {
        status: 'missing',
      },
      error: {
        code: 'missing_credential',
        message: 'No Cave credential is stored.',
        action: 'Run `opencoven cave pair` to create and store a credential.',
      },
      ok: false,
      version: cliVersion,
    });

    const revoked = await runCli(
      ['--json', 'cave', 'status'],
      runtime({
        cave: {
          createClient: () => ({
            credentialStatus: () => Promise.resolve({ status: 'revoked', health: caveHealth }),
          }),
        },
      }),
    );

    expect(JSON.parse(revoked.stdout)).toEqual({
      command: 'cave status',
      data: {
        status: 'revoked',
        health: caveHealth,
      },
      error: {
        code: 'revoked_credential',
        message: 'The stored Cave credential was rejected by Cave.',
        action: 'Run `opencoven cave forget` and pair again.',
      },
      ok: false,
      version: cliVersion,
    });

    const forgotten = await runCli(['--json', 'cave', 'forget'], runtime());
    expect(JSON.parse(forgotten.stdout)).toEqual({
      command: 'cave forget',
      data: {
        deleted: true,
      },
      ok: true,
      version: cliVersion,
    });

    const forgetFailure = await runCli(
      ['--json', 'cave', 'forget'],
      runtime({
        cave: {
          createClient: () => ({
            forgetCredential: () =>
              Promise.reject(
                Object.assign(new Error('secret backend failure'), {
                  code: 'secure_store_unavailable',
                  operation: 'delete',
                  retryable: false,
                }),
              ),
          }),
        },
      }),
    );

    expect(JSON.parse(forgetFailure.stdout)).toEqual({
      command: 'cave forget',
      error: {
        code: 'secure_store_unavailable',
        message: 'Native secure credential storage is unavailable.',
        retryable: false,
        action: 'Enable the platform secure-store backend for this user session and retry.',
      },
      ok: false,
      version: cliVersion,
    });
  });

  test('fails Windows Cave commands before secret-store or client access when trust is unavailable', async () => {
    const createSecretStore = vi.fn(() => createProbeableStore());
    const createClient = vi.fn(() => ({
      credentialStatus: () => Promise.resolve({ status: 'valid', access: 'chat:read', health: caveHealth }),
      createPairing: never,
      forgetCredential: () => Promise.resolve(false),
      health: () => Promise.resolve(caveHealth),
    }));
    const fetchImplementation = vi.fn<typeof fetch>();

    const result = await runCli(
      ['--json', 'cave', 'status'],
      runtime({
        cwd: 'C:\\workspace',
        env: {
          USERPROFILE: 'C:\\Users\\Alice',
        },
        platform: 'win32',
        createSecretStore,
        fetch: fetchImplementation,
        cave: {
          createClient,
          discoverEndpoint: undefined,
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'cave status',
      error: {
        code: 'platform_security_unavailable',
        message: 'Required native Cave platform security is unavailable.',
        retryable: false,
        action:
          'Use a reviewed OpenCoven CLI/runtime with native Windows Cave path ownership/ACL validation, or inject CliRuntime.cave.discovery.dependencies.windowsPathTrust, then retry.',
        details: {
          platform: 'windows',
          requirement: 'path_ownership_acl',
        },
      },
      ok: false,
      version: cliVersion,
    });
    expect(createSecretStore).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test('pins the doctor Cave health client to the already discovered authority', async () => {
    const discoverEndpoint = vi
      .fn()
      .mockResolvedValueOnce(caveDiscovery)
      .mockResolvedValueOnce({
        ...caveDiscovery,
        freshness: {
          ...caveDiscovery.freshness,
          nonce: '018f4f1a-77c2-7a31-8a15-55a25aaba299',
        },
      });

    const result = await runCli(
      ['--json', 'doctor'],
      runtime({
        cave: {
          discoverEndpoint,
          createClient: (options: Record<string, unknown>) => ({
            health: async () => {
              const resolveDiscovery = options.discoverEndpoint as
                | ((value: unknown) => Promise<unknown>)
                | undefined;
              await resolveDiscovery?.(options.discovery);
              return caveHealth;
            },
          }),
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    const output = parseObjectJson(result.stdout);
    const data = output.data;
    if (!isObject(data)) {
      throw new TypeError('Doctor output data was not an object.');
    }
    const checksValue = data.checks;
    if (!Array.isArray(checksValue)) {
      throw new TypeError('Doctor checks were not an array.');
    }
    const checks = checksValue.filter(isObject);

    expect(output).toMatchObject({
      command: 'doctor',
      ok: false,
      version: cliVersion,
    });
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cave.discovery',
          status: 'ok',
        }),
      ]),
    );
    const caveHealthCheck = checks.find((check) => check.id === 'cave.health');
    expect(caveHealthCheck).toMatchObject({
      id: 'cave.health',
      status: 'error',
      error: {
        code: 'reconcile_required',
        details: {
          reason: 'authority_restarted',
        },
      },
    });
    expect(discoverEndpoint).toHaveBeenCalledTimes(2);
  });

  test('returns Coven health through the merged discovery and health helpers', async () => {
    const healthy = await runCli(['--json', 'coven', 'health'], runtime());

    expect(healthy.exitCode).toBe(0);
    expect(JSON.parse(healthy.stdout)).toEqual({
      command: 'coven health',
      data: {
        discovery: covenDiscovery,
        health: {
          status: 'ok',
          covenVersion: covenHealth.covenVersion,
          capabilities: covenHealth.capabilities,
        },
      },
      ok: true,
      version: cliVersion,
    });

    const failure = await runCli(
      ['--json', 'coven', 'health'],
      runtime({
        coven: {
          readHealth: () =>
            Promise.reject(
              Object.assign(new Error('admin token should stay secret'), {
                code: 'connect_failure',
                retryable: true,
                diagnostics: { phase: 'connect' },
              }),
            ),
        },
      }),
    );

    expect(JSON.parse(failure.stdout)).toEqual({
      command: 'coven health',
      data: {
        discovery: covenDiscovery,
      },
      error: {
        code: 'connect_failure',
        message: 'Could not connect to the Coven daemon.',
        retryable: true,
        action: 'Start Coven and retry once the local daemon is listening.',
        details: {
          phase: 'connect',
        },
      },
      ok: false,
      version: cliVersion,
    });
    expect(failure.stdout).not.toContain('admin token');
  });

  test('writes CLI output through the process entry point', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(main(['--version'])).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith(`${cliVersion}\n`);

    stdout.mockRestore();
  });
});
