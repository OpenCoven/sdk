import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/managed.ts'],
  format: ['esm'],
  target: 'node24',
});
