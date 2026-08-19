import { fileURLToPath } from 'node:url';

import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@opencoven/sdk-core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@opencoven/cave-client': fileURLToPath(new URL('./packages/cave/src/index.ts', import.meta.url)),
      '@opencoven/coven-client': fileURLToPath(new URL('./packages/coven/src/index.ts', import.meta.url)),
      '@opencoven/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
      '@opencoven/dev-cli': fileURLToPath(new URL('./packages/cli/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'packages-and-examples',
    environment: 'node',
    include: ['packages/*/test/**/*.spec.ts', 'examples/*/test/**/*.spec.ts'],
  },
});
