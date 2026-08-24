import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAVE_PAIRING_SCOPES } from '@opencoven/cave-client';
import { createMemorySecretStore } from '@opencoven/sdk-core';
import { formatCliOutput, main, runCli } from '@opencoven/dev-cli';
import { describe, expect, test, vi } from 'vitest';

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
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
    createSecretStore: () => createMemorySecretStore(),
    now: () => 1_755_730_000_000,
    sleep: () => Promise.resolve(),
    ...rest,
  };
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
