import { CaveClient } from '@opencoven/cave-client';

const phases: string[] = [];
const cave = new CaveClient({
  transport: {
    health: (context) => {
      if (context?.signal.aborted) {
        return Promise.reject(context.signal.reason);
      }
      return Promise.resolve({ data: { status: 'ok' } });
    },
  },
});

const health = await cave.health({
  timeoutMs: 1_000,
  observer: {
    onEvent(event) {
      phases.push(event.phase);
    },
    onObserverError(error) {
      throw error;
    },
  },
});

if (
  health.status !== 'ok' ||
  phases.join(',') !== 'start,success'
) {
  throw new Error('Expected Cave to report healthy.');
}

process.stdout.write('Cave health example passed.\n');
