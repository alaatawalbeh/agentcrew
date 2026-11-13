// Tests for the vendored engine and its patches. They load the compiled engine from engine/work, so build it first:
//   npm run engine:prepare && npm run engine:build && npm run test:engine
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/engine/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
