import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src'), '@bch-intents/wallet-core': resolve(__dirname, '../bch-intents-wallet-core/src') } },
  // The extension's PostCSS/Tailwind setup is for the UI build; unit tests load no CSS.
  css: { postcss: { plugins: [] } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    environment: 'node',
    // One process, one file at a time: the suite is small, and parallel workers time out on a loaded machine.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
