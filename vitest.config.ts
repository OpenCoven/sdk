import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    environment: 'node',
    include: ['packages/*/test/**/*.spec.ts', 'tests/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
