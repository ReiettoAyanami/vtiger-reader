import { defineConfig } from 'vitest/config';

// Tests run against the real MySQL test database (TEST_DB_NAME, default `${DB_NAME}_test`).
// Files run one at a time because they share that database and truncate it before each test.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
