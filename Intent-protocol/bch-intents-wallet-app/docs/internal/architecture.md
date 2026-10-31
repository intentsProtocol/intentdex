# Architecture

BCH Intents Wallet for phones: the same wallet as the browser extension, built with React Native and Expo on Tether's Wallet Development Kit (WDK).

## The two halves

```
┌──────────────────────────── React Native (Hermes) ────────────────────────────┐
│  screens (src/app)   state (src/state)   swap, connect, lib                    │
│  Reads balances over JSON-RPC. Builds transactions. Shows everything.          │
│  Never holds a key.                                                            │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                 │  HRPC: JSON in, JSON out   (src/wdk/bridge.ts)
┌───────────────────────────────▼────────────────────────────────────────────────┐
│  WDK worklet (Bare runtime, its own thread)                                    │
│  Holds the seed while unlocked. One wallet module per network:                 │
│    @tetherto/wdk-wallet-evm      10 EVM networks                               │
│    @tetherto/wdk-wallet-solana   devnet, mainnet                               │
│    @tetherto/wdk-wallet-btc      testnet, mainnet                              │
│    @bch-intents/wdk-wallet-bch   chipnet, mainnet   (ours: ../wdk-wallet-bch)  │
└────────────────────────────────────────────────────────────────────────────────┘
```

The seed is stored by WDK in the phone's keychain (hardware-backed where the phone has it). Unlocking loads it into the worklet; locking disposes it. The React Native side asks the worklet to derive an address, sign or send, and gets back public results only.

## Calling the worklet

`src/wdk/bridge.ts` is the one door: `call(network, accountIndex, method, ...args)`. It uses the same service WDK's `useAccount` hook uses, reached directly because the wallet works across sixteen networks and its swap flows are plain functions, not components.

What crosses is JSON. Rules that follow:

- Amounts go in as decimal strings and come back as strings. Convert with `BigInt()` on arrival.
- A method that returns nothing is treated by WDK as an error. Every method called returns a value.
- A `Uint8Array` comes back as an object with index keys. `bytesFromJson` in the shared package reads it.

## Networks

`vendor/wallet-core/src/chains.ts` is the table. A network's key is the same in that table, in `wdk.config.js` (which module signs for it), in `src/wdk/config.ts` (how the module is configured) and in every call. `tests/logic.test.ts` fails if `wdk.config.js` and the table disagree.

Both modes are registered in the worklet at once, so switching between testnet and mainnet does not restart it.

| Family | Derivation | Same address as |
|---|---|---|
| EVM | `m/44'/60'/0'/0/N` | MetaMask |
| Solana | `m/44'/501'/N'/0'` | Phantom |
| Bitcoin | `m/84'/coin'/0'/0/N` | native SegWit wallets |
| Bitcoin Cash | `m/44'/0'/0'/0/N` | the BCH Intents extension and web app |

Bitcoin Cash uses coin type 0, not 145, because that is the path the web app and extension already use (it is the default of the library they are built on). Electron Cash shows the same address only when its derivation path is set to `m/44'/0'/0'`.

## Reading and writing

| | EVM | Solana | Bitcoin | Bitcoin Cash |
|---|---|---|---|---|
| Balances | JSON-RPC from the app | JSON-RPC from the app, or the swap server on mainnet | worklet (Blockbook) | worklet (Fulcrum over WebSocket) |
| History | the wallet's own record | the wallet's own record | worklet | worklet |
| Sign | worklet | worklet | worklet | worklet |
| Broadcast | the app | worklet, or the swap server for swaps | worklet | worklet |

EVM transactions are filled in by the app (nonce, gas, fees with the chain's floor), signed in the worklet, and broadcast by the app. The split exists so the transaction hash is known before the broadcast: the bridge flow writes it to its journal first and can then never sign a second burn (`vendor/wallet-core/src/swap/flows.ts`).

## Shared code

Two sibling packages are copied into `vendor/` by `npm run sync`:

- `vendor/wallet-core` (`@bch-intents/wallet-core`): networks, assets, formatting, validation, translations, swap clients, routing and flows. TypeScript source, resolved by a Babel alias.
- `vendor/wdk-wallet-bch` (`@bch-intents/wdk-wallet-bch`): the Bitcoin Cash wallet module, installed as a `file:` dependency so the worklet bundler finds it.

They are copies because a cloud build uploads this repository only. `npm run sync:check` fails when a copy is stale.

## Screens

Routes are files under `src/app` (expo-router).

```
index                     waits for the worklet, then redirects by session
(onboarding)/             welcome → phrase → confirm → pin → done      (create)
                          welcome → import → pin → done                (import)
unlock                    PIN pad, biometric key
(app)/                    behind the lock: portfolio and dapp connections live here
  (tabs)/wallet|swap|activity|settings
  send  receive  scan  accounts  connect
  token/[id]   settings/[view]
```

`(app)/_layout.tsx` mounts `PortfolioProvider` and `ConnectProvider`. Locking unmounts both, so nothing reads or answers while the wallet is locked.

## State and storage

| What | Where | Notes |
|---|---|---|
| Seed | WDK keychain storage | never read by the app except to show the recovery phrase, after the PIN |
| PIN record | `expo-secure-store` (`bchi_pin_v1`) | salted PBKDF2 hash; attempts counted in `bchi_pin_attempts_v1` |
| Settings | AsyncStorage `wallet_settings_v1` | validated field by field on load |
| Accounts | AsyncStorage `wallet_accounts_v1` | count, active index, names |
| Activity | AsyncStorage `wallet_activity_v1` | the wallet's own record, 200 entries |
| Swap journal | AsyncStorage `swap_server_journal_v1` | hashes written before broadcast |
| CashToken metadata | AsyncStorage `cashtoken_meta_v1` | cache |
| WalletConnect sessions | AsyncStorage, WalletConnect's own keys | |
| Agent chats and outbox | AsyncStorage `agent_vault_v1:chats` | XChaCha20-Poly1305; key in `expo-secure-store` (`agent_vault_key_v1`) |
| Agent snapshot | AsyncStorage `agent_vault_v1:snapshot` | balances, prices, positions for offline answers; same encryption |
| Queued count | AsyncStorage `agent_queued_count_v1` | a number only, read by the background check |
| Model choice | AsyncStorage `agent_model_v1` | which model, and which are downloaded; the weights are in QVAC's cache |

## Swaps

`src/swap/useSwap.ts` holds the card's logic: token lists, routing, quotes, the run. `src/swap/runtime.ts` supplies the signing the shared flows need. The three products and their routing are the extension's.

| Pair | Service |
|---|---|
| BCH ↔ CashToken | cashtoken-relayer |
| USDC → USDC on another chain | cctp-swap-server (Circle CCTP) |
| Solana tokens, mainnet | cctp-swap-server (Jupiter) |

A service the build has no URL for is treated as absent: its tokens are not listed, and with none at all the tab says so.

## Dapp connections

`src/connect/`. WalletConnect v2 with three namespaces: `eip155`, `solana` and `bch` (the wc2-bch-bcr convention). `requests.ts` is pure: which chains a session gets, and what each request asks for. `ConnectProvider.tsx` runs the client and shows the approval sheet.

WizardConnect was evaluated and left out of this build: its packages depend on libauth, which needs WebAssembly and top-level `await`, and React Native's engine has neither. See [known limitations](known-limitations.md).

## The agent (QVAC)

A third runtime: `@qvac/sdk` starts its own Bare worker for the language model, beside the WDK worklet.

```
React Native ── src/agent (store, chats, outbox, review) ── shared agent core (tools, turn loop)
     │                                     │
     │ bridge.ts (JSON)                    │ @qvac/sdk (bare-rpc)
     ▼                                     ▼
WDK worklet: keys, signing           QVAC worker: Qwen3 1.7B / 0.6B (llama.cpp; GPU via Vulkan, else CPU)
```

- The model sees text only: the request, a short system prompt, and tool results (balances, prices, plans).
  It never sees a key, and nothing it writes is executed: tools return cards, and an action card is a draft.
- `src/agent/qvac.ts` downloads the model once (`downloadAsset`), loads it with `tools: true` on the GPU, falling
  back to the CPU, and adapts QVAC's completion events to the shared `LlmClient`.
- `src/agent/AgentProvider.tsx` (behind the lock) keeps the offline snapshot, watches the network, raises the
  "back online" banner and notification, and unloads the model on lock.
- Drafts go to the outbox. `src/app/(app)/agent/[id].tsx` is the only door from a draft to a transaction: fresh
  quote or pool price, PIN, then the ordinary flow (the swap hook, or `src/agent/mesh.ts` for a Mesh genesis).
- Mesh genesis: the server plans the outputs, `verifyPlan` (shared) checks them on the phone, and the BCH module's
  `sendOutputs` pays them exactly with the seed at input 0.

### Native addons of two workers

`react-native-bare-kit` 0.16 builds what sits in its `android/src/main/addons` folder and links nothing itself.
QVAC's Expo plugin empties that folder and links its worker's addons; `plugins/withWorkletAddons.js` applies
QVAC's plugin and then runs `scripts/link-wdk-addons.mjs`, which links the addons the WDK worklet bundle records
(`linked:lib….so` in its header). Both sets share the pinned `bare-*` versions. Run prebuild again after
`npm install`: the folder lives in `node_modules`.

## Design system

`src/ui/`. Colours come from `useTheme()` and are the extension's palette. `Glass` draws iOS 26 Liquid Glass where the system has it, a blurred backdrop on older iOS, and a translucent fill on Android. Touch targets are at least 44 points. `Chameleon` is Cham, in layers moved by native-driver transforms.
