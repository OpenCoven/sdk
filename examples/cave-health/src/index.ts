import { CaveClient } from '@opencoven/cave-client';

const phases: string[] = [];
const cave = new CaveClient({
  transport: {
    health: (context) => {
      if (context?.signal.aborted) {
        return Promise.reject(
          new Error('Cave health was aborted', { cause: context.signal.reason }),
        );
      }
      return Promise.resolve({
        apiVersion: '1.0',
        capabilities: ['health'],
        minimumClientVersion: '0.1.0',
        operations: ['health.read'],
        data: {
          instanceId: 'example-cave',
          pairingRequired: true,
          releaseVersion: '0.3.9',
        },
      });
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
