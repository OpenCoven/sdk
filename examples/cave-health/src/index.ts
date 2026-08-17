import { CaveClient } from '@opencoven/cave-client';

const cave = new CaveClient({
  transport: {
    health: () => Promise.resolve({ data: { status: 'ok' } }),
  },
});

void cave.health();
