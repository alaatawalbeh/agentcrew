import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Engine tests need the engine built: run them with `npm run test:engine`.
    exclude: ['test/engine/**', 'node_modules/**'],
    environment: 'node',
  },
});
