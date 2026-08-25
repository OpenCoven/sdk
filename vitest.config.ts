import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import packagesAndExamples from './vitest.workspace.js';

export default defineConfig({
  resolve: {
    alias: {
      '@opencoven/sdk-core/browser': fileURLToPath(
        new URL('./packages/core/src/browser.ts', import.meta.url),
      ),
      '@opencoven/sdk-core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@opencoven/cave-client/managed': fileURLToPath(
        new URL('./packages/cave/src/managed.ts', import.meta.url),
      ),
      '@opencoven/cave-client': fileURLToPath(new URL('./packages/cave/src/index.ts', import.meta.url)),
      '@opencoven/coven-client': fileURLToPath(new URL('./packages/coven/src/index.ts', import.meta.url)),
      '@opencoven/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
      '@opencoven/dev-cli': fileURLToPath(new URL('./packages/cli/src/index.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/index.ts',
        'packages/cli/src/bin.ts',
        'packages/*/src/schemas.ts',
        'packages/*/src/transport.ts',
      ],
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
        'packages/coven/src/discovery.ts': {
          branches: 88,
          functions: 98,
          lines: 91,
          statements: 91,
        },
        'packages/coven/src/transport-unix.ts': {
          branches: 78,
          functions: 98,
          lines: 86,
          statements: 86,
        },
        'packages/coven/src/transport-windows.ts': {
          branches: 94,
          functions: 90,
          lines: 91,
          statements: 91,
        },
      },
    },
    projects: [
      packagesAndExamples,
      {
        extends: true,
        test: {
          name: 'root',
          environment: 'node',
          fileParallelism: false,
          include: ['tests/**/*.spec.ts'],
        },
      },
    ],
  },
});
