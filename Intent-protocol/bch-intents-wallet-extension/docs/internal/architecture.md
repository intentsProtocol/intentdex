# Architecture

Internal reference for people working on the extension. For what the wallet does from a user's point of view, see [`../user/`](../user/); for the API sites use, see [`../developers/provider-api.md`](../developers/provider-api.md).

## The four contexts

A Manifest V3 extension runs code in separate worlds that can only pass messages to each other. This one has four.

| Context | Entry | Built to | Has | Must not |
|---|---|---|---|---|
| **Wallet UI** | `src/popup/index.html` | `dist/src/popup/index.html` + chunks | DOM, React, WASM, the keys | — |
| **Service worker** | `src/background/service-worker.ts` | `dist/background/background.js` | `chrome.*`, no DOM | import mainnet-js, WDK or React |
| **Content script** | `src/content/inject.ts` | `dist/content/content.js` | the page's DOM (isolated world), `chrome.runtime` | import anything that produces code |
| **Inpage provider** | `src/inpage/provider.ts` | `dist/inpage/inpage.js` | the page's `window` (main world) | import anything that produces code |

The last two are loaded as classic scripts. An `import` in either is a syntax error that silently disables the provider on every site, so `vite.config.ts` fails the build if their output contains one. Type-only imports are fine.

### One UI document, four surfaces

The wallet UI is a single page. A `surface` query parameter says where it is showing, and `theme.css` sizes it from `data-surface` on `<html>`:

| Surface | URL | Opened by | Size |
|---|---|---|---|
| Side panel | `?surface=panel` | toolbar icon (default) | fills the panel |
| Popup | `?surface=popup` | toolbar icon, when the user chose "Popup" | 360 × 600 |
| Approval window | `?surface=popup&approval=1` | the service worker, for a dapp request | 380 × 640 window |
| Onboarding tab | `?surface=tab` | first install; or onboarding started from the popup | centred card |

The service worker's `applySurface()` implements the panel/popup choice: for the panel it clears the action's popup and calls `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`; for the popup it sets the popup back. It runs on install, on browser start, and whenever the settings record changes. A browser without `chrome.sidePanel` always gets the popup.

## Source layout

```
src/
├── popup/                 wallet UI
│   ├── main.tsx           polyfills, surface and theme before first paint, then dynamic import
│   ├── init.tsx           provider tree
│   ├── App.tsx            router
│   └── screens/           Onboarding, Unlock, Home, Send, Receive, Swap, Activity, Settings, Approval, shared
├── background/service-worker.ts
├── content/inject.ts
├── inpage/provider.ts
├── context/
│   ├── SettingsProvider   settings, theme, language (t)
│   ├── WDKProvider        seed, derivation, accounts, lock state, network mode
│   └── PortfolioProvider  assets and prices of the active account
├── design-system/         theme.css (tokens), primitives.tsx, Chameleon.tsx
├── lib/                   chains, assets, send, evm, solana, btc-esplora, cashtokens, prices, activity,
│                          settings, dapp, crypto, ext-storage, account-store, format, config, i18n/
├── swap/                  api, types, flows, journal, signers (ported from the frontend), solana, cashtoken,
│                          tokens (routing), runtime (glue)
└── shared/messages.ts     message names, storage keys, request types
```

## Provider tree and routing

```
SettingsProvider → WDKProvider → PortfolioProvider → App
```

`App.tsx` picks a screen by priority: booting → onboarding → unlock → approval (if the request queue is not empty) → wallet screens. A locked wallet with a waiting request shows Unlock first and the request right after.

## State and where it lives

| Key | Area | Written by | Content |
|---|---|---|---|
| `bch-intents-encrypted-wallet` | local | `lib/crypto.ts` | AES-GCM ciphertext of the seed phrase, salt, IV |
| `wdk_session_seed`, `wdk_session_last_active` | session | WDKProvider | the phrase while unlocked; last interaction time |
| `bch_accounts` | local | `lib/account-store.ts` | account indices, active index, labels, gradients, address cache |
| `wdk_bch_network` | local | WDKProvider | `chipnet` or `mainnet`: the one network switch |
| `wallet_settings_v1` | local | `lib/settings.ts` | preferences |
| `wallet_activity_v1` | local | `lib/activity.ts` | the wallet's own record of sends, swaps, approvals (200 entries) |
| `connected_sites` | local | `lib/dapp.ts` | origins allowed to see the address and ask for approvals |
| `dapp_queue`, `approval_window_id` | session | service worker | requests waiting for the user |
| `bch_active_address`, `bch_active_balance` | local | WDK / Portfolio providers | what the worker answers read-only dapp calls from |
| `swap_server_journal_v1` | local | `swap/journal.ts` | bridge transaction hashes not yet reported to the server |
| `cashtoken_meta_v1` | local | `lib/cashtokens.ts` | BCMR metadata cache |

`chrome.storage.session` is held in memory by the browser and cleared when it closes. Code never uses `localStorage` or `sessionStorage`.

Views stay in step through `chrome.storage.onChanged`, not messages: a setting changed in the side panel reaches an open approval window at once, and so do the network mode, the request queue and the site list.

## Keys and derivation

One BIP-39 phrase. Account *n* is derived the way the reference wallet of each chain derives its *n*-th account, so every account matches MetaMask (EVM) and Phantom (Solana). Bitcoin Cash follows the frontend rather than Electron Cash: see the note below.

| Chain | Library | Path for account *n* |
|---|---|---|
| EVM | `ethers.HDNodeWallet` | `m/44'/60'/0'/0/n` |
| Bitcoin Cash | `mainnet-js` | `m/44'/0'/0'/0/n` (see the note below) |
| Solana | `@tetherto/wdk-wallet-solana` | `m/44'/501'/n'/0'` (WDK's `getAccount(n)`) |
| Bitcoin | `@tetherto/wdk-wallet-btc`, BIP-84 | `m/84'/coin'/0'/0/n` (WDK's `getAccount(n)`), per network |

**Bitcoin Cash is not on its standard path.** `mainnet-js` derives its default wallet under Bitcoin's coin type (`m/44'/0'/0'/0/0`), not Bitcoin Cash's (`145`). The frontend has always shown that address, so the wallets keep it: the same phrase gives the same BCH address in the frontend, the extension and the mobile app, but a *different* one in Electron Cash unless its derivation path is set by hand. `wdk-wallet-bch` reproduces this with `coinType: 0`.

WDK managers are created once and cached in refs; switching account calls `getAccount(n)` on them. Bitcoin has two managers because the address format differs by network.

Bitcoin's network access goes through `lib/btc-esplora.ts`, an implementation of WDK's `IBtcClient` over an Esplora REST API. WDK's own transports need raw sockets or an Electrum WebSocket; an extension page has neither reliably.

## Networks

`lib/chains.ts` is the single table. A network's `key` equals the swap server's chain key wherever the server has one, so no mapping exists between "a network in the wallet" and "a chain in `/config`". The wallet has one mode, testnet or mainnet, stored as the BCH network; every family follows it.

## Assets

`PortfolioProvider` loads each family independently every 20 seconds while the view is visible, and on account or mode change. A family that fails keeps its previous rows and is reported in `stale`; a late answer for a previous account or mode is dropped by comparing a scope string.

Balances are `bigint` base units end to end. `lib/format.ts` is the only place they become strings.

Prices exist on mainnet only (testnet funds are shown as amounts). Native assets are priced by symbol from the price feed; Solana tokens by mint from the swap server; USDC is 1 unless the feed says otherwise.

## The dapp pipeline

```
page                 inpage/provider.ts      content/inject.ts        service-worker.ts          wallet UI
request() ──────────► postMessage ──────────► runtime.sendMessage ───► route
                                                                        ├─ read-only: answer from storage
                                                                        └─ needs approval: push to dapp_queue,
                                                                           open the UI if none is open ─────────► Approval
                                                                                                                   │ sign
                      ◄── postMessage ◄────── tabs.sendMessage ◄─────── pop from queue ◄──── APPROVAL_RESULT ◄────┘
```

Points that are easy to get wrong:

- **Origin** is taken from `sender.origin`, never from the request body.
- **Nothing is held in worker memory.** The queue is in `chrome.storage.session`; a worker that was stopped and restarted loses nothing.
- **Replies** always travel by `tabs.sendMessage` to the tab that asked, also for immediate answers, so there is one code path.
- **Approval results** are accepted only from the extension's own pages (a content script has the extension's id too, so the sender's tab URL is checked).
- **Closing the approval window** rejects everything in the queue (`windows.onRemoved`).
- **Events** go only to tabs whose origin is in `connected_sites`. Removing a site from that record, from settings or by `wallet_disconnect`, is what tells its tabs.
- **Signing happens in the UI context**, because that is where the keys are. The worker never sees a key.

## Swaps

Three products behind one card. `swap/tokens.ts#resolveRoute` decides by the pair; a pair nothing can execute resolves to `none` with a reason and the button is disabled. See [`swap-integration.md`](swap-integration.md).

## Theming

Every colour is a CSS variable in `design-system/theme.css`, defined once per theme. `MX` in `primitives.tsx` maps token names to `var(--mx-…)`, so screens keep using inline styles (the project rule) and work in both themes. `main.tsx` sets `data-theme` before React loads, so there is no flash.

`glass()` returns the liquid-glass surface (translucent fill, backdrop blur and saturation, lit top edge) used for bars, sheets and the portfolio card.

## Auto-lock

Two timers enforce the same rule. `WDKProvider` checks every 30 seconds while a view is open; the service worker's `autolock` alarm checks every minute when none is. Both compare `wdk_session_last_active` with the user's setting and remove the session seed.
