# 02 — Architecture

The proposed design. Where it rests on something not yet confirmed, it says so and points at the Phase 0 task that confirms it.

## Overview

```
┌─────────────────────────── React Native (Hermes) ───────────────────────────┐
│  Expo Router screens      Onboarding · Wallet · Send · Receive · Swap ·     │
│                           Activity · Settings · Approvals (WalletConnect)   │
│                                                                             │
│  App services             Auth gate (biometrics + PIN) · WalletConnect ·    │
│                           Portfolio · Activity · Swap runner                │
│                                                                             │
│  @bch-intents/wallet-core (shared with the extension)                       │
│                           networks · swap clients + routing · formatting ·  │
│                           address validation · translations                 │
│                                                                             │
│  @tetherto/wdk-react-native-core     hooks, stores (MMKV), HRPC client      │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │ HRPC  (no key ever crosses this line)
┌───────────────────────────────────┴─────────── Bare worklet ────────────────┐
│  wdk-wallet-evm     wdk-wallet-solana     wdk-wallet-btc     wdk-wallet-bch │
│                                                              (ours)         │
│  intents-signer (ours, generic module): signs server-built transactions     │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
          Device keychain / keystore: encrypted seed, encryption key
```

Outside the device: public RPC endpoints and indexers, the two swap services, the WalletConnect relay.

## Project shape

- **Expo, development client.** Not Expo Go (native modules), not bare React Native (Expo's build tooling and EAS are worth having, especially for iOS from Windows).
- **Expo Router** for navigation; **TypeScript** throughout.
- **Start from WDK's starter** for the wiring (provider, bundler config, Metro and TypeScript settings that the beta packages need), then replace its screens with ours.

```
bch-intents-wallet-app/
├── app/                     Expo Router routes
│   ├── (onboarding)/        welcome, create, import, pin, done
│   ├── (tabs)/              wallet, swap, activity, settings
│   ├── send/  receive/  scan/
│   └── approve/             WalletConnect session and request screens
├── src/
│   ├── auth/                PIN, biometrics, lock state
│   ├── wallet/              thin wrappers over WDK hooks; account and network mode
│   ├── portfolio/           assets and prices
│   ├── swap/                runner that drives wallet-core's flows with worklet signers
│   ├── walletconnect/       session store, request handlers per namespace
│   ├── design/              theme tokens, components, Cham
│   └── storage/             MMKV adapters for wallet-core's storage interfaces
├── worklet/
│   └── intents-signer/      generic module (see "Signing what a server built")
├── wdk.config.js            networks → wallet packages
└── walletappdocs/
```

## Networks

The same table as the extension (`wallet-core`'s `chains.ts`), one switch for testnet or mainnet.

The bundler wants one entry per network, each naming its wallet package, and `wdkConfigs` supplies the runtime settings (RPC URL, chain id):

```js
// wdk.config.js (sketch)
const evm = { package: '@tetherto/wdk-wallet-evm' }
module.exports = {
  networks: {
    'ethereum': evm, 'base': evm, 'arbitrum': evm, 'optimism': evm, 'arc': evm,
    'eth-sepolia': evm, 'base-sepolia': evm, 'arb-sepolia': evm, 'op-sepolia': evm, 'arc-testnet': evm,
    'solana': { package: '@tetherto/wdk-wallet-solana' }, 'solana-devnet': { package: '@tetherto/wdk-wallet-solana' },
    'btc-mainnet': { package: '@tetherto/wdk-wallet-btc' }, 'btc-testnet': { package: '@tetherto/wdk-wallet-btc' },
    'bch-mainnet': { package: './packages/wdk-wallet-bch' }, 'bch-chipnet': { package: './packages/wdk-wallet-bch' },
  },
  modules: { 'intents-signer': { package: './worklet/intents-signer' } },
  transport: 'hrpc',
  options: { convertEsmToCjs: true },
}
```

Network keys match the swap server's chain keys, as in the extension, so a bridge route needs no mapping.

*Unconfirmed:* that sixteen entries, ten of them sharing one package, behave well (start-up time, memory). Phase 0.

## Accounts and addresses

Same phrase, same addresses as the extension:

| Chain | Path for account *n* | Matches |
|---|---|---|
| EVM | `m/44'/60'/0'/0/n` | MetaMask, the extension |
| Solana | `m/44'/501'/n'/0'` | Phantom, the extension |
| Bitcoin | `m/84'/coin'/0'/0/n` | the extension |
| Bitcoin Cash | `m/44'/145'/0'/0/n` | Electron Cash, the extension |

WDK's `getAccount(n)` already gives the Solana and Bitcoin paths. `wdk-wallet-evm`'s default must be checked against the EVM row; if it differs, the module's `getAccountByPath` is used. The BCH module is ours and implements its row directly.

**The acceptance test for the whole wallet layer:** import the Hardhat test phrase on the phone and compare all four addresses, for accounts 0 and 1, with the extension's. The extension's end-to-end suite already pins those values.

## The Bitcoin Cash module: `wdk-wallet-bch`

A WDK wallet module, scaffolded with `create-wdk-module`, extending the base classes in `@tetherto/wdk-wallet` the way `wdk-wallet-solana` does. It lives in the shared repository so the extension and frontend can adopt it later and drop `mainnet-js`.

### What it must do

| Capability | Notes |
|---|---|
| Derive | BIP-32 secp256k1, path above; P2PKH address in CashAddr form, plus the token-aware form (`z…`) |
| Balance | BCH satoshis; fungible CashToken balances by category |
| Send BCH | Coin selection that never spends a token-carrying coin for a plain payment |
| Send CashTokens | Fungible tokens, with token change returned to the token-aware address |
| Pay a contract address | P2SH20 and P2SH32 destinations: the swap covenant lives at one |
| Sign a message | Bitcoin signed-message format, byte-for-byte what `mainnet-js` produces |
| Sign a prepared transaction | For WalletConnect's `bch_signTransaction`: an unsigned transaction plus its source outputs |
| History | Recent transactions with the balance change of each |
| Fee | 1 sat/byte default, with an estimate before sending |

Not in the first version: NFTs, minting, multiple addresses per account, Schnorr multisig.

### How

- **Cryptography without WebAssembly:** `@noble/curves` (secp256k1, RFC 6979 signatures), `@noble/hashes` (SHA-256, RIPEMD-160), `@scure/bip32` and `@scure/bip39`. These are audited, pure JavaScript, and already what much of the ecosystem uses.
- **Encoding:** CashAddr, the CashTokens output prefix (CHIP-2022-02), transaction serialisation and the BCH signature hash (BIP-143 style with `SIGHASH_FORKID`, extended for tokens). This is a few hundred lines with published test vectors. `@bitauth/libauth` implements all of it, but initialises its hashing and curve code through WebAssembly; whether its pure encoding functions can be imported without triggering that is worth an hour in Phase 0, because reusing them would be safer than writing our own.
- **Network:** an Electrum Cash (Fulcrum) client over WebSocket for coins, balances, history and broadcast: the protocol `mainnet-js` speaks. *Unconfirmed:* WebSocket from a custom module inside Bare. Fallback: an HTTPS indexer behind the same small interface.
- **Token metadata** (names, icons) is not the module's job: it stays in `wallet-core` (BCMR lookups), as in the extension.

### How we know it is right

A wallet module that is subtly wrong loses money, so this is tested harder than anything else:

1. **Address vectors:** known phrases to known addresses, for accounts 0 to 3, both networks, both address forms. Taken from the extension, which takes them from `mainnet-js`.
2. **Signature equality:** message signatures are deterministic, so the module's output must equal `mainnet-js`'s exactly for the same key and message.
3. **Transaction equality:** for a fixed set of coins and a fixed payment, build with `mainnet-js` in Node and with the module, and compare the bytes (after fixing coin order).
4. **Published vectors:** CashAddr, CashTokens encoding, signature-hash vectors from the specifications.
5. **Chipnet, for real:** send BCH, send a token, fund a swap covenant, and check the result with the extension.

## Signing what a server built

The swap flows do not ask the wallet to "send 5 USDC to X". They hand it a transaction:

| Flow | What arrives | What must happen |
|---|---|---|
| USDC bridge, EVM | `{ to, data, chainId }` for approve, burn, fee | Fill in nonce, gas and fees; sign; **know the hash before broadcasting** (the journal rule); broadcast |
| USDC bridge, Solana | A serialised transaction already signed by a second key | Add our signature; return the bytes to the server |
| Solana swap | A serialised versioned transaction from Jupiter | Add our signature; return the bytes |
| BCH swap | A covenant address | A normal payment: the BCH module's `send` |

In the extension the keys are in the page, so `ethers` and `@solana/web3.js` do this directly. In the app the keys are in the worklet.

**Plan A:** WDK's modules already expose enough. `wdk-wallet-evm`'s account may accept `{ to, data, value }` and expose `signTransaction`; `wdk-wallet-solana` may expose signing of a serialised transaction. Read their source in Phase 0.

**Plan B:** `intents-signer`, a generic module of ours in the worklet. Its factory receives the seed; it exposes exactly the operations the flows need and nothing else:

```
signEvmTransaction({ network, accountIndex, to, data, value, nonce, gas, fees })  → { signed, hash }
signSolanaTransaction({ accountIndex, serializedTx })                              → { signed, signature }
```

Broadcasting stays in the app or with the server. `allowedModuleMethods` in the bundler config restricts the worklet to these calls.

Either way, the app side implements the small signer interface `wallet-core`'s flows take, so the flow code is the extension's code.

This is also where the security gap noted in the extension's docs should be closed for both wallets: decode what the server sent and check it against the quote *before* it goes to the signer.

## Shared code: `@bch-intents/wallet-core`

What moves out of the extension, unchanged in behaviour:

| Module | From the extension's | Change needed |
|---|---|---|
| Networks | `lib/chains.ts` | RPC overrides passed in, not read from `import.meta.env` |
| Configuration | `lib/config.ts` | A `configure({ … })` call each host makes at start |
| Formatting | `lib/format.ts` | None |
| Address validation | `lib/send.ts` (the validation half) | None |
| Translations | `lib/i18n/` | None |
| Swap server client and types | `swap/api.ts`, `types.ts` | None |
| Bridge flow | `swap/flows.ts`, `signers.ts` | Take a signer interface instead of `ethers.Signer` and a Solana `Keypair` |
| Journal | `swap/journal.ts` | Already takes a storage interface |
| Relayer client and BCH swap flow | `swap/cashtoken.ts` | Take a `send` function instead of a `mainnet-js` wallet |
| Token lists and routing | `swap/tokens.ts` | None |
| CashToken metadata, prices | `lib/cashtokens.ts`, `lib/prices.ts` | Storage interface for the cache |
| Activity model | `lib/activity.ts` | Storage interface |

What stays platform-specific: storage, key handling, UI, the dapp transport (content scripts there, WalletConnect here).

The extension's 63 unit tests mostly cover exactly these modules and move with them. The extension then depends on the package, and its end-to-end suite proves the move broke nothing.

*To decide:* where the package lives. The extension is its own git repository; the app folder is inside the parent `Intent-protocol` repository. See open questions.

## Security

| Layer | Design |
|---|---|
| Seed at rest | Encrypted by WDK's secret manager; ciphertext and key in the keychain (iOS) or keystore-backed storage (Android) through `wdk-react-native-secure-storage`, with `requireBiometrics` on key reads where the device supports it |
| Unlock | Biometrics first; a 6-digit PIN as fallback and as the only method on devices without biometrics |
| PIN | Never stored. A slow key-derivation over the PIN and a random salt unwraps a second copy of the encryption key. Attempts are counted in secure storage: growing delays, and a wipe after a fixed number of failures (number to be decided; the phrase restores the wallet). |
| Before every signature | A fresh biometric or PIN check for every send, swap and signature: a phone left unlocked on a table should not be able to pay |
| Auto-lock | On background after a short grace period, and after inactivity; same options as the extension |
| Phrase screens | Screenshots and screen recording blocked (`FLAG_SECURE` on Android; a privacy overlay on iOS), hidden in the app switcher |
| Clipboard | Copying the phrase warns and clears the clipboard after a minute |
| Device state | Warn, do not block, on a rooted or jailbroken device or one with no screen lock |
| Keys | Never in React Native's JavaScript context. Only in the worklet. |
| Network | HTTPS only; no analytics or third-party SDKs with network access in the first version |

WDK is explicit that `lock()` does not prove keys left the worklet's memory. To make lock mean something, the app also tears the worklet down on lock if that proves cheap enough to do (Phase 0 measures start-up time).

## Swaps

The same three products, the same routing, the same card logic as the extension, from `wallet-core`. The app supplies:

- signers (above),
- storage for the journal (MMKV),
- a runner that survives the app being backgrounded mid-swap: state is persisted at each step, and on return the runner reconciles with the service exactly as the extension's Activity screen does. Mobile operating systems suspend apps freely, so "the view closed halfway" is the normal case here, not the edge case.

## WalletConnect

Reown WalletKit on the wallet side. One session can carry several namespaces:

| Namespace | Chains | Methods |
|---|---|---|
| `bch` | `bch:bitcoincash`, `bch:bchtest` | `bch_getAddresses`, `bch_signTransaction`, `bch_signMessage` (the `wc2-bch-bcr` spec the frontend uses with Cashonize) |
| `eip155` | the ten EVM networks | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, `wallet_switchEthereumChain` |
| `solana` | mainnet, devnet | `solana_signTransaction`, `solana_signMessage` |

Flow: scan a QR (or open a `wc:` deep link) → session proposal screen showing the site, the chains and the methods it wants → approve with biometrics → requests arrive and are shown one at a time, with the same rules as the extension's approval screen: the wallet shows what will be signed in its own words, validates before enabling the button, and refuses what it cannot display.

`eth_signTypedData_v4` and arbitrary `eth_sendTransaction` are new ground: the extension does not expose EVM to sites. They need a readable rendering of typed data and of contract calls, and are the largest part of the WalletConnect work.

Needs a Reown project id (free; see open questions).

## QR scan and pay

- **Receive:** QR of the address, as in the extension; optionally with an amount as a payment URI.
- **Scan:** the camera reads a plain address, a `bitcoincash:` / `bitcoin:` / `ethereum:` / `solana:` payment URI, or a `wc:` URI, and routes to Send (prefilled, on the right chain) or to WalletConnect. The parser is pure logic and goes in `wallet-core` with tests.

## Interface

- **Same design language:** the Morphic tokens become a theme object (light, dark, system), with the same names as the extension's `MX` so designs translate directly.
- **Glass:** `expo-blur` for bars and sheets. Android's blur is costlier than iOS's; fall back to a translucent solid on low-end devices.
- **Cham:** the same drawing in `react-native-svg`, animated with Reanimated. On a phone there is no pointer to follow, so the eye follows touches and tilts with the device.
- **Navigation:** bottom tabs (Wallet, Swap, Activity, Settings), with Send, Receive, Scan and approvals as modal stacks.
- **Mobile behaviours the extension did not need:** pull to refresh, haptics on confirm, safe-area handling, keyboard avoidance on amount entry, large-text support.
- **Languages:** the shared catalogues; English and Simplified Chinese (still awaiting review).

WDK's React Native UI Kit is available. It is worth using for unglamorous pieces (amount keypad, QR scanner frame) if its styling can take our theme; the look of the app is ours.

## What the app adds over the extension

- EVM and Solana dapp connectivity, through WalletConnect.
- Transaction history for EVM and Bitcoin, if we get a WDK Indexer key.
- Biometric approval on every signature.
- Camera payments.
