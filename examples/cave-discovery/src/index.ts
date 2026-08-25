import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createDiscoveredCaveClient } from '@opencoven/cave-client';
import {
  createMemorySecretStore,
  createSecretStoreReference,
} from '@opencoven/sdk-core';

async function runUnixExample(): Promise<void> {
  const caveHome = mkdtempSync(
    resolve(realpathSync(tmpdir()), 'opencoven-cave-example-'),
  );

  try {
    chmodSync(caveHome, 0o700);
    writeFileSync(
      resolve(caveHome, 'client-v1-discovery.json'),
      `${JSON.stringify({
        version: 1,
        endpoint: 'http://127.0.0.1:43123',
        pid: process.pid,
        nonce: 'example-owner-local-cave',
        startedAt: '2026-08-20T20:20:12.617Z',
      })}\n`,
      { mode: 0o600 },
    );

    const cave = createDiscoveredCaveClient({
      credentials: {
        store: createMemorySecretStore(),
        reference: createSecretStoreReference('example-cave'),
      },
      discovery: {
        env: { COVEN_CAVE_HOME: caveHome },
      },
      fetch: (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (
          url !== 'http://127.0.0.1:43123/api/client/v1/health' ||
          init?.method !== 'GET' ||
          init.credentials !== 'omit' ||
          init.redirect !== 'error'
        ) {
          return Promise.reject(new Error('Unexpected Cave health request.'));
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              apiVersion: '1.0',
              minimumClientVersion: '0.1.0',
              capabilities: ['health', 'pairing'],
              operations: ['health.read', 'pairing.create'],
              data: {
                instanceId: '00000000-0000-4000-8000-000000000000',
                pairingRequired: true,
                releaseVersion: '0.3.9',
              },
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200,
            },
          ),
        );
      },
      operation: {
        timeoutMs: 1_000,
      },
    });
    const health = await cave.health();

    if (health.status !== 'ok' || health.instanceId.length === 0) {
      throw new Error('Expected owner-local Cave discovery to succeed.');
    }

    process.stdout.write('Cave discovery example passed.\n');
  } finally {
    rmSync(caveHome, { recursive: true, force: true });
  }
}

if (process.platform === 'win32') {
  process.stdout.write(
    'Cave discovery example skipped: Windows requires a reviewed native trust provider.\n',
  );
} else {
  await runUnixExample();
}
