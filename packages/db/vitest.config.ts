import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setup: [],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30000,
  },
});
