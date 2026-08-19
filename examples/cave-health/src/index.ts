import { CaveClient } from '@opencoven/cave-client';

const cave = new CaveClient({
  transport: {
    health: () => Promise.resolve({ data: { status: 'ok' } }),
  },
});

const health = await cave.health();

if (health.status !== 'ok') {
  throw new Error('Expected Cave to report healthy.');
}

process.stdout.write('Cave health example passed.\n');
