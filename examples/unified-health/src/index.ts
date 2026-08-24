import { CaveClient } from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import { createOpenCovenSdk } from '@opencoven/sdk';

const sdk = createOpenCovenSdk({
  cave: new CaveClient({
    transport: {
      health: () => Promise.resolve({
        apiVersion: '1.0',
        capabilities: ['health'],
        minimumClientVersion: '0.1.0',
        operations: ['health.read'],
        data: {
          instanceId: 'example-cave',
          pairingRequired: true,
          releaseVersion: '0.3.9',
        },
      }),
    },
  }),
  coven: new CovenClient({
    transport: {
      health: () => Promise.resolve({
        ok: true,
        apiVersion: COVEN_DAEMON_PROTOCOL,
        covenVersion: '0.1.0',
        capabilities: {
          sessions: true,
          events: true,
          eventCursor: 'sequence',
          structuredErrors: true,
        },
      }),
    },
  }),
});

const report = await sdk.healthReport({
  timeoutMs: 1_000,
  cave: { timeoutMs: 500 },
  coven: { timeoutMs: 500 },
});

if (report.cave.status !== 'healthy' || report.coven.status !== 'healthy') {
  throw new Error('Expected both configured clients to be healthy.');
}

process.stdout.write('Unified health example passed.\n');
