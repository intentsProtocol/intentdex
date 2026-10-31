import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The two reference implementations the tests compare against are loaded from the browser extension's install
// next door, so this package's own dependency tree stays small. Without that install those tests are skipped.
const neighbour = join(dirname(fileURLToPath(import.meta.url)), '..', 'bch-intents-wallet-extension', 'node_modules')
const reference = {
  'mainnet-js': join(neighbour, 'mainnet-js/dist/module/index.js'),
  '@bitauth/libauth': join(neighbour, '@bitauth/libauth/build/index.js')
}

export default defineConfig({
  // No CSS here; without this a PostCSS config in a parent folder is loaded.
  css: { postcss: { plugins: [] } },
  resolve: { alias: Object.fromEntries(Object.entries(reference).filter(([, file]) => existsSync(file))) },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000
  }
})
