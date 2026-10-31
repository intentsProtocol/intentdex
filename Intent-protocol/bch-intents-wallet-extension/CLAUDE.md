# BCH Intents Wallet Extension — Agent Context

A **self-custodial, multi-chain browser wallet extension** (Chrome, Manifest V3) for the BCH Intents protocol.
Read this before making changes. Deeper documents are in [`docs/`](docs/README.md); start with
[`docs/internal/architecture.md`](docs/internal/architecture.md).

---

## What This Is

- Stores one BIP-39 seed phrase and derives addresses for BCH, EVM, Solana, BTC
- Sends and receives on every chain; swaps through two first-party services
- Exposes `window.bchIntents` to dapps: BCH methods, plus signing and sending on every chain
- Multiple accounts per seed: account N is address index N (MetaMask's scheme), Solana account N (Phantom's)
- Opens docked in the browser's side panel by default; the popup is a setting
- Standalone: no dependency on the frontend dapp at runtime

**Seed portability:** the same phrase works in this extension, the frontend app (`Intent-protocol/frontend/`),
MetaMask (EVM) and Phantom (Solana). BCH matches the frontend, not Electron Cash's default path.

---

## Project Structure

```
├── manifest.json            MV3: side panel, service worker, two content scripts
├── vite.config.ts           4 entry points; fails the build if a page script has an import
├── docs/                    user/, developers/, internal/
├── tests/unit/              vitest, in-memory chrome.storage
├── tests/e2e/               Playwright against dist/
├── test-extension.html      test dapp for the provider
└── src/
    ├── popup/               wallet UI (one document for panel, popup, approval window, onboarding tab)
    │   ├── main.tsx         polyfills, surface + theme before first paint
    │   ├── App.tsx          router: boot → onboarding → unlock → approval → screens
    │   └── screens/         Onboarding, Unlock, Home, Send, Receive, Swap, Activity, Settings, Approval, shared
    ├── background/service-worker.ts   surface choice, dapp routing, request queue, events, auto-lock
    ├── content/inject.ts              relay only; self-contained
    ├── inpage/provider.ts             window.bchIntents; self-contained
    ├── context/             SettingsProvider, WDKProvider, PortfolioProvider
    ├── design-system/       theme.css (tokens per theme), primitives.tsx, Chameleon.tsx
    ├── lib/                 assets, send, evm, solana, btc-esplora, settings, dapp, crypto, ext-storage,
    │                        account-store, config, core-setup; chains, format, prices, cashtokens, activity
    │                        and i18n re-export the shared package
    ├── swap/                api, types, flows, signers, journal (ported from frontend/src/swap-server),
    │                        solana, cashtoken, tokens (routing), runtime
    └── shared/messages.ts   message names, storage keys, request types
```

---

## The 4 Entry Points

| Entry | File | Runs in |
|-------|------|---------|
| popup | `src/popup/index.html` | Wallet UI: side panel, popup, approval window, onboarding tab |
| background | `src/background/service-worker.ts` | MV3 service worker (no DOM) |
| content | `src/content/inject.ts` | Every http(s) page, isolated world |
| inpage | `src/inpage/provider.ts` | Every http(s) page, main world (`"world": "MAIN"` in the manifest) |

**WASM / mainnet-js / WDK only run in the wallet UI.** Keys never exist anywhere else.

---

## Networks

One switch, testnet or mainnet (stored as `wdk_bch_network`: `chipnet` | `mainnet`); every family follows it.
The table lives in the shared package (`../bch-intents-wallet-core/src/chains.ts`). A network's `key` equals the swap server's chain key where it has one.

| Family | Testnet | Mainnet |
|---|---|---|
| BCH | chipnet | mainnet |
| EVM | eth-sepolia, base-sepolia, arb-sepolia, op-sepolia, arc-testnet | ethereum, base, arbitrum, optimism, arc |
| Solana | solana-devnet | solana |
| BTC | btc-testnet | btc-mainnet |

## Swaps

| Pair | Service | Module |
|---|---|---|
| BCH ↔ CashToken | cashtoken-relayer (`../cashtoken-relayer`), Dutch-auction intent | `swap/cashtoken.ts` |
| USDC ↔ USDC across chains | cctp-swap-server (`../arc-cctp/cctp-swap-server`), Circle CCTP | `swap/flows.ts` |
| Solana tokens, mainnet | cctp-swap-server, Jupiter | `swap/solana.ts` |

`swap/tokens.ts#resolveRoute` picks by pair; anything else is `none` and the button is disabled.
Service URLs are `VITE_` build variables with localhost defaults (`src/lib/config.ts`).

---

## Storage

**Never use `localStorage` or `sessionStorage`.** Use `extLocal` / `extSession` from `@/lib/ext-storage`, or
`chrome.storage` directly in modules the service worker shares. The key table is in
`docs/internal/architecture.md`.

- Encrypted seed: `bch-intents-encrypted-wallet` in local (AES-GCM, PBKDF2)
- Session seed: `wdk_session_seed` in session; removed on lock and auto-lock
- Views sync through `chrome.storage.onChanged`, not messages

## WDKProvider Behaviour

- Derives EVM (`ethers.HDNodeWallet`), Solana (`WalletManagerSolana`), BTC testnet and mainnet
  (`WalletManagerBtc` with an Esplora client), BCH chipnet and mainnet (`mainnet-js`) from one seed
- Managers are cached in refs — call `manager.getAccount(index)` to switch accounts, never recreate
- `setupWallet(phrase, password)` is onboarding in one call; nothing is stored before it
- Auto-lock time comes from settings; the service worker's alarm enforces it when no view is open

## BCH (mainnet-js 3.x)

- `Wallet.fromSeed(seed, path?)` / `TestNetWallet.fromSeed(seed, path?)` — the second argument is the path
- Account 0 uses the library default, which is `m/44'/0'/0'/0/0` (Bitcoin's coin type, **not** 145). Account N: `m/44'/0'/0'/0/N`
- `getBalance()` returns **bigint satoshis**; `send([{ cashaddr, value: bigint }])`; tokens with `TokenSendRequest`
- `.cashaddr`, `.tokenaddr`, `.sign(message)`, `.getAllTokenBalances()`, `.getHistory()`

---

## window.bchIntents

Reference: `docs/developers/provider-api.md`. Methods: `bch_requestAccounts`, `bch_accounts`, `bch_getNetwork`,
`bch_getBalance`, `bch_sendTransaction`, `bch_signTransaction` (WalletConnect-BCH payload, `lib/bch-sign.ts`),
`personal_sign` / `bch_signMessage`, `wallet_disconnect`.
Events: `accountsChanged`, `networkChanged`, `connect`, `disconnect`. Errors carry a `code` (4001, 4100, 4200, 4900).

---

## Design System

`src/design-system/`. `MX` values are CSS variables (`var(--mx-…)`) defined per theme in `theme.css`, so inline
styles work in light and dark. `glass()` is the liquid-glass surface. Design notes: `docs/internal/design-system.md`.

**Design source:** `../devrel-agent-context/wdk-wallet/wallet-extension-bundle/`

---

## Checks

```bash
npm run typecheck
npm test              # vitest, single process
npm run build
npm run test:e2e      # Playwright; needs the build and `npx playwright install chromium`
```

What is and is not verified: `docs/internal/testing.md`. What the alpha does not do:
`docs/internal/known-limitations.md`.

---

## Commit Convention

```
feat(ext): <description>      new screen or feature
fix(ext): <description>       bug fix
chore(ext): <description>     config, deps, tooling
refactor(ext): <description>  restructure without behaviour change
docs(ext): / test(ext):       documentation, tests
```

---

## Rules

1. **Never** use `localStorage` / `sessionStorage` — always `extLocal` / `extSession` / `chrome.storage`
2. **Never** import `mainnet-js`, WDK or React in the service worker, content script or inpage provider
3. **Never** give the content script or inpage provider an import that produces code — they are classic scripts
4. **Never** store the raw seed phrase in `chrome.storage.local` — always AES-GCM encrypted
5. **Always** cache WDK managers in refs; never recreate per account switch
6. Screens use **inline styles** with `MX` tokens — no Tailwind, and no literal colours (add a token for both themes)
7. Every user-visible string is a key in `src/lib/i18n/en.ts`, used through `t()`, with a translation in each catalogue
8. Amounts are `bigint` base units; `lib/format.ts` is the only place they become text
9. The dapp origin comes from the browser (`sender.origin`), never from the request
10. `src/swap/signers.ts` is a port of `frontend/src/swap-server/signers.ts`, and the shared package's
    `swap/flows.ts` of its `flows.ts` — keep them in step. The flows sign through `EvmSender` / `SolanaSender`,
    which `src/swap/runtime.ts` implements with ethers and a Solana keypair
11. Platform-independent logic belongs in `../bch-intents-wallet-core` (`@bch-intents/wallet-core`), shared with the
    mobile app. It has no UI, no keys and no platform APIs; hosts call `configure()` (see `src/lib/core-setup.ts`)
