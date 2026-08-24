import type { CaveCredentialMetadata } from '@opencoven/cave-client';
import { describe, expect, test } from 'vitest';

const credential: CaveCredentialMetadata = {
  id: '018f4f1a-77c2-7a31-8a15-55a25aaba002',
  appName: 'OpenCoven CLI',
  installationId: 'opencoven-cli',
  scopes: ['chat:read'],
  createdAt: 1_755_730_812_617,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
};

async function loadCli() {
  return await import('@opencoven/dev-cli');
}

describe('opencoven CLI binary defaults', () => {
  test('uses the native secret-store path for production cave pairing', async () => {
    const { runCli } = await loadCli();

    const result = await runCli(
      ['--json', 'cave', 'pair'],
      {
        cave: {
          createClient: ({ credentials }: { credentials: { reference: { key: string }; store: object } }) => ({
            health: () => Promise.resolve({ status: 'ok' as const }),
            credentialStatus: () => Promise.resolve({ status: 'missing' as const }),
            forgetCredential: () => Promise.resolve(false),
            createPairing: () => {
              expect(credentials.reference.key).toBe('opencoven.cli.cave.credential');
              expect(
                Reflect.get(
                  credentials.store,
                  Symbol.for('@opencoven/dev-cli/native-secret-store'),
                ),
              ).toBe(true);

              return Promise.resolve({
                requestId: 'production-native-store',
                expiresAt: Date.now() + 10_000,
                poll: () => Promise.resolve({
                  id: 'production-native-store',
                  status: 'approved' as const,
                  expiresAt: Date.now() + 10_000,
                }),
                exchange: () => Promise.resolve(credential),
              });
            },
          }),
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'cave pair',
      ok: true,
      data: {
        requestId: 'production-native-store',
      },
    });
  });

  test('keeps package-entry help machine-readable without dependency injection', async () => {
    const { runCli, CLI_USAGE, DEV_CLI_VERSION } = await loadCli();
    const result = await runCli(['--json', '--help']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      command: 'help',
      data: {
        name: 'opencoven',
        usage: CLI_USAGE,
      },
      ok: true,
      version: DEV_CLI_VERSION,
    });
  });
});
