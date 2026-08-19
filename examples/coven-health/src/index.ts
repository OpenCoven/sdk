import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';

const coven = new CovenClient({
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
});

const health = await coven.health();

if (health.status !== 'ok') {
  throw new Error('Expected Coven to report healthy.');
}

process.stdout.write('Coven health example passed.\n');
