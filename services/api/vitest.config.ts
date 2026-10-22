import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 120_000, // first run downloads embedded Postgres binaries
    hookTimeout: 180_000,
    fileParallelism: false, // single embedded Postgres instance per run
  },
});
