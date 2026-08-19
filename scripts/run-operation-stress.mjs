import { spawnSync } from 'node:child_process';

const seeds = [20260819, 104729, 2147483647];

for (const seed of seeds) {
  process.stdout.write(`Running operation properties with seed ${seed}.\n`);
  const result = spawnSync(
    'corepack',
    [
      'pnpm@10.34.0',
      'vitest',
      'run',
      'tests/operation-control.property.spec.ts',
    ],
    {
      env: {
        ...process.env,
        FAST_CHECK_SEED: String(seed),
      },
      stdio: 'inherit',
    },
  );

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
