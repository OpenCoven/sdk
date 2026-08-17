import { CaveClient } from '@opencoven/cave-client';
import { COVEN_DAEMON_PROTOCOL, CovenClient } from '@opencoven/coven-client';
import { createOpenCovenSdk } from '@opencoven/sdk';

const sdk = createOpenCovenSdk({
  cave: new CaveClient({
    transport: {
      health: () => Promise.resolve({ data: { status: 'ok' } }),
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

void sdk.health();
