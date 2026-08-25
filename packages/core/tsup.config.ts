import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/browser.ts'],
  format: ['esm'],
  target: 'node24',
});
