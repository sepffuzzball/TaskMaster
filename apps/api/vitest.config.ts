import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    setup: ['./test/setup.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@taskmaster/db': resolve(__dirname, '../../packages/db/src'),
      '@taskmaster/db/migrations/001-initial': resolve(__dirname, '../../packages/db/src/migrations/001-initial.ts'),
      '@taskmaster/db/migrations/002-oidc-transactions': resolve(__dirname, '../../packages/db/src/migrations/002-oidc-transactions.ts'),
      '@taskmaster/db/migrations/003-task-tags': resolve(__dirname, '../../packages/db/src/migrations/003-task-tags.ts'),
      '@taskmaster/db/migrations/004-ensure-task-tags': resolve(__dirname, '../../packages/db/src/migrations/004-ensure-task-tags.ts'),
      '@taskmaster/shared': resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
