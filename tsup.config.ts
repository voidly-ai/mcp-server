import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  clean: true,
  minify: true,
  treeshake: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
