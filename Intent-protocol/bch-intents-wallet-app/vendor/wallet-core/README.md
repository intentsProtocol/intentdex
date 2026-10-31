# @bch-intents/wallet-core

What the BCH Intents browser extension and mobile app have in common, in one place so they cannot drift apart.

No UI, no keys, no platform APIs.

| Module | What it holds |
|---|---|
| `platform` | `configure()`: the host's storage and service URLs |
| `chains` | The network table: every chain, both modes |
| `assets` | The asset row, what it is worth, how rows are ordered |
| `format` | Amounts as bigint base units, to and from text |
| `validation` | Is this address right for this chain? (EIP-55, CashAddr and base58 checks) |
| `prices`, `cashtokens`, `activity` | Price feed, CashToken metadata and pools, the wallet's own activity record |
| `i18n` | English and Simplified Chinese catalogues, typed against each other |
| `swap/api`, `swap/types` | Client for cctp-swap-server (USDC bridge, Solana swaps) |
| `swap/cashtoken` | Client and flow for cashtoken-relayer (BCH ↔ CashTokens) |
| `swap/tokens` | What can be swapped, and which service swaps it |
| `swap/journal` | Transaction hashes not yet reported to the swap server |

## Use

A host calls `configure()` once, before anything else:

```ts
import { configure } from '@bch-intents/wallet-core/platform'

configure({
  storage,                       // { getItem, setItem, removeItem }, all async
  services: { swapServerTestnet, swapServerMainnet, cashtokenRelayer },
  rpc: { 'base-sepolia': 'https://…' },   // optional overrides by network key
})
```

It is consumed as TypeScript source through a path alias (`@bch-intents/wallet-core/*` → `src/*`), from this folder sitting next to the project that uses it. See the extension's `vite.config.ts`, `tsconfig.json` and `src/lib/core-setup.ts`.

## Checks

```bash
npm run typecheck
```

The modules here are exercised by the browser extension's unit and end-to-end suites.
