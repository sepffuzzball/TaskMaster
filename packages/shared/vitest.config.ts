import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setup: ['./test/setup.ts'],
    environment: 'node',
  },
});
