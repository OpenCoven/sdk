import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/bin.ts', 'src/index.ts', 'src/main.ts'],
  format: ['esm'],
  target: 'node24',
});
