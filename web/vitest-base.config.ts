import { defineConfig } from 'vitest/config';

// Read by `ng test` (angular.json, runnerConfig). A page's first test also compiles its components
// and their Material modules: under a full parallel run that can pass Vitest's 5 s.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
