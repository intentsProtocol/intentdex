# BCH Intents Wallet for mobile — Agent Context

A **self-custodial, multi-chain wallet for Android and iOS** (React Native, Expo 55) on Tether's WDK.
Read this before making changes. Deeper documents are in [`docs/`](docs/README.md); start with
[`docs/internal/architecture.md`](docs/internal/architecture.md).

---

## What This Is

- One BIP-39 phrase; addresses for BCH, EVM, Solana, BTC; several accounts per phrase
- Keys live in the **WDK worklet** (Bare runtime). The React Native side never holds one
- Sends and receives on sixteen networks; swaps through two first-party services
- Shows and transfers CashToken **NFTs**, including Mesh V4 liquidity positions (a position is an NFT)
- Dapp connections over WalletConnect v2: `eip155`, `solana`, `bch`
- The phone companion of `../bch-intents-wallet-extension`: same accounts, swaps and look

## Project Structure

```
├── wdk.config.js          network key → wallet module (bundled into the worklet)
├── app.json, eas.json     Expo and build configuration
├── scripts/               bundle-worklet (postinstall), sync-vendor, bare-smoke, make-icons, make-logos
├── vendor/                COPIES of ../bch-intents-wallet-core and ../wdk-wallet-bch — never edit here
├── tests/                 vitest; native modules mocked in tests/mocks
├── docs/                  user/, developers/, internal/
└── src/
    ├── app/               routes (expo-router): index, (onboarding)/, unlock, (app)/
    ├── wdk/               config, bridge (the one door to the worklet), session, pin, biometrics, AutoLock
    ├── state/             settings, accounts, portfolio (provider), onboarding, scan
    ├── lib/               assets, send, evm, fees, rpc, scan, activity, config, storage, core-setup
    ├── swap/              useSwap (the card's logic), runtime (signing for the shared flows)
    ├── connect/           requests (pure), ConnectProvider (client + approval sheet)
    ├── ui/                theme, primitives, Glass, Chameleon, PinPad, TokenIcon, …
    └── i18n/              strings only the app has (en, zh-CN) in front of the shared catalogue
```

## The Two Runtimes

| | Runs | Holds keys |
|---|---|---|
| React Native (Hermes) | screens, balance reads over JSON-RPC, building transactions | never |
| WDK worklet (Bare) | the four wallet modules: derive, sign, send | while unlocked |

They talk through `src/wdk/bridge.ts`: `call(network, accountIndex, method, ...args)`. **What crosses is JSON**:
amounts go as decimal strings, bigints come back as strings, a `Uint8Array` comes back as an index-keyed object,
and a method that returns `undefined` is reported as an error.

## Networks

`vendor/wallet-core/src/chains.ts` is the only table. The same key is used there, in `wdk.config.js`, in
`src/wdk/config.ts` and in every call. Both modes are registered in the worklet at once.

| Family | Module | Path |
|---|---|---|
| BCH | `@bch-intents/wdk-wallet-bch` (`coinType: 0`) | `m/44'/0'/0'/0/N` |
| EVM | `@tetherto/wdk-wallet-evm` | `m/44'/60'/0'/0/N` |
| Solana | `@tetherto/wdk-wallet-solana` | `m/44'/501'/N'/0'` |
| BTC | `@tetherto/wdk-wallet-btc` (Blockbook) | `m/84'/coin'/0'/0/N` |

## Checks

```bash
npm run typecheck
npm test
npm run sync:check
npx bare scripts/bare-smoke.cjs        # wallet modules under Bare, live testnets
npx expo export --platform android     # Metro bundle
```

There is no Android toolchain on the author's machine: device builds come from `eas build`. What is and is not
verified: `docs/internal/testing.md`.

## Commit Convention

```
feat(app): / fix(app): / chore(app): / refactor(app): / docs(app): / test(app):
```

---

## Rules

1. **Never** import a wallet module, `ethers`, `@solana/*` or `mainnet-js` on the React Native side. Signing goes
   through `src/wdk/bridge.ts`; reads go through `src/lib/rpc.ts`
2. **Never** edit `vendor/`. Change the sibling package, run its tests, then `npm run sync` and commit the result
3. **Never** put the recovery phrase in navigation params, AsyncStorage or a log. In memory only
   (`state/onboarding.ts`), and screens that show it call `useSecureScreen()`
4. **Never** store a secret in AsyncStorage. The seed is WDK's; the PIN record is in `expo-secure-store`
5. Amounts are `bigint` base units; they become text only through the shared package's `format.ts`
6. A new method called on the worklet must return a value, and take and return JSON-safe data
7. Screens take colours from `useTheme()`; no literal colours outside `src/ui/theme.tsx` (the QR code and the
   camera overlay are the exceptions, and say why)
8. Every user-visible string goes through `t()`. Shared strings live in the shared package, app-only ones in
   `src/i18n`, with a translation in each catalogue
9. A touch target is at least 44 points and has an `accessibilityLabel`
10. A screen file under `src/app` exports its screen and nothing another file imports
11. `process.env.EXPO_PUBLIC_*` is read only in `src/lib/config.ts`, each variable written out in full
12. After changing `wdk.config.js` or `wdk-wallet-bch`: `npm run bundle:worklet`
