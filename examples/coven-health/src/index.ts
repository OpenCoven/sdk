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

void coven.health();
