/**
 * Wallet UI entry point — polyfills MUST run before any other module loads.
 *
 * ES module static imports are hoisted: every `import` at the top of this
 * file is resolved/evaluated BEFORE the module body executes. That means
 * `(globalThis as any).Buffer = Buffer` would run AFTER React, WDKProvider,
 * and their transitive deps (mainnet-js → bchaddrjs → Buffer) have already
 * been evaluated, causing "Buffer is not defined".
 *
 * Fix: this file has static imports only for the polyfill and the theme, and sets
 * the globals. Then it uses a dynamic `import()` to load the actual app. Dynamic
 * import creates a hard sequencing barrier — init.tsx and all its transitive deps
 * are fetched & evaluated only after the polyfill assignment has executed.
 *
 * Vite config already has `target: 'esnext'`, so top-level await is fine.
 */

import { Buffer } from 'buffer';
import '@/design-system/theme.css';

(globalThis as any).Buffer = Buffer;
(window as any).Buffer = Buffer;

// Define process shim globally before dynamic import
const processShim = {
  env: {
    NODE_ENV: 'production',
    NODE_DEBUG: 'false',
    DEBUG: '',
  },
  browser: true,
  version: 'v20.0.0',
  versions: { node: '20.0.0' },
  platform: 'browser',
  nextTick: (cb: any, ...args: any[]) => queueMicrotask(() => cb(...args)),
  stderr: { write: console.error.bind(console) },
  stdout: { write: console.log.bind(console) }
};

(globalThis as any).process = processShim;
(window as any).process = processShim;

// Which surface this document is: the docked side panel, the action popup (also the approval window), or the
// onboarding tab. theme.css sizes the page from it.
const params = new URLSearchParams(window.location.search);
const surface = params.get('surface');
document.documentElement.setAttribute('data-surface', surface === 'panel' || surface === 'tab' ? surface : 'popup');

// The theme before the first paint, so a light-theme user never sees a dark flash.
let initialSettings: unknown;
try {
  const stored = await chrome.storage.local.get('wallet_settings_v1');
  initialSettings = stored.wallet_settings_v1 ? JSON.parse(stored.wallet_settings_v1) : undefined;
} catch { /* first run, or storage unavailable: defaults */ }
const pref = (initialSettings as { theme?: string } | undefined)?.theme;
const light = pref === 'light' || (pref !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches);
document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');

// Dynamic import — guarantees Buffer and process are globally available before any
// React / mainnet-js / WDK code is evaluated.
const { default: init } = await import('./init');
init(initialSettings);
