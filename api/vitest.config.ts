import { defineConfig } from 'vitest/config';

// Tests with a database: SQLite in memory, one per test file (test/support/db.ts), so the files run
// side by side.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Those without a database run on their own: vitest.unit.config.ts.
    exclude: ['test/**/*.unit.test.ts'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
