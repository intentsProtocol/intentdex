import { defineConfig } from 'vitest/config'

// Its own config, so a config file in a parent folder is never picked up.
export default defineConfig({
  // No CSS here; without this a PostCSS config in a parent folder is loaded.
  css: { postcss: { plugins: [] } },
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000
  }
})
