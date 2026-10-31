import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// The tests cover the app's logic that needs no phone: parsing, validation, the PIN record, WalletConnect
// requests. Native modules are replaced by small stand-ins in tests/mocks.
export default defineConfig({
  // No CSS here; without this a PostCSS config in a parent folder is loaded.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: join(root, 'src/$1') },
      { find: /^@bch-intents\/wallet-core\/(.*)$/, replacement: join(root, 'vendor/wallet-core/src/$1') },
      { find: '@bch-intents/wallet-core', replacement: join(root, 'vendor/wallet-core/src/index.ts') },
      { find: '@react-native-async-storage/async-storage', replacement: join(root, 'tests/mocks/async-storage.ts') },
      { find: 'expo-secure-store', replacement: join(root, 'tests/mocks/secure-store.ts') },
      { find: 'expo-crypto', replacement: join(root, 'tests/mocks/expo-crypto.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
