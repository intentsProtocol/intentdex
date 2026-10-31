import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'path';
import { copyFileSync, readFileSync } from 'fs';

// Copy manifest.json into dist/ after every build, and check the two scripts that run inside web pages.
// A content script is loaded as a classic script: an `import` in it is a syntax error that silently disables
// the provider on every site. Fail the build instead.
const finishExtension = {
  name: 'finish-extension',
  writeBundle() {
    copyFileSync('manifest.json', 'dist/manifest.json');
    for (const file of ['dist/content/content.js', 'dist/inpage/inpage.js']) {
      const code = readFileSync(file, 'utf8');
      if (/^\s*import[\s{*"']|\bimport\(|^\s*export\s/m.test(code)) {
        throw new Error(`${file} must be self-contained, but it contains an import or export. Remove value imports from its source.`);
      }
    }
  },
};

export default defineConfig({
  plugins: [
    react(),
    // Node built-ins that WDK's Bitcoin stack reaches for (bitcoinjs-message → create-hash → stream). Without
    // them Bitcoin message signing throws "Cannot read properties of undefined (reading 'call')".
    // Globals stay off: main.tsx installs Buffer and process itself, and injected globals would add imports to
    // the content and inpage scripts, which must stay self-contained.
    nodePolyfills({
      include: ['events', 'stream', 'util', 'string_decoder'],
      globals: { Buffer: false, global: false, process: false },
    }),
    finishExtension,
  ],
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // The shared package is consumed as source, from its sibling repository.
      '@bch-intents/wallet-core': resolve(__dirname, '../bch-intents-wallet-core/src'),
      buffer: 'buffer/',
      // sodium-native is a C++ Node.js addon and cannot run in a browser. Without this alias WDK's Solana and
      // Bitcoin wallets fail to derive ("sodium_memzero is not a function"). The frontend has the same alias.
      'sodium-native': 'sodium-javascript',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // mainnet-js uses top-level await in its WASM crypto init; esnext is required
    target: 'esnext',
    rollupOptions: {
      input: {
        popup:      resolve(__dirname, 'src/popup/index.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content:    resolve(__dirname, 'src/content/inject.ts'),
        inpage:     resolve(__dirname, 'src/inpage/provider.ts'),
      },
      output: {
        // Keep each entry in its own subfolder to match manifest.json paths
        entryFileNames: (chunk) => `${chunk.name}/[name].js`,
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // Pre-bundle buffer so mainnet-js can use Buffer as a global
  optimizeDeps: {
    exclude: ['mainnet-js'],
    include: ['buffer'],
  },
});
