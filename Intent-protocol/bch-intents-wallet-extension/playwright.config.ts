import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests load the built extension (dist/) into Chromium. Run `npm run build` first.
 * One worker: every test file launches its own browser profile with the extension in it.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  webServer: {
    command: 'node tests/e2e/static-server.mjs',
    port: 4173,
    reuseExistingServer: true,
  },
});
