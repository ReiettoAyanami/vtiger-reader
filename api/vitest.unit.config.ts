import { defineConfig } from 'vitest/config';

// Tests that need no database (*.unit.test.ts): the CRM client against a fake CRM, VTQL, the
// secret box, the configuration. They run anywhere: npm run test:unit.
export default defineConfig({
  test: {
    include: ['test/**/*.unit.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
