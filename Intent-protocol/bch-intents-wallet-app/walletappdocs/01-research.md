# 01 — Research

What WDK provides for React Native, read from Tether's documentation on 2026-10-09. Nothing here was run: these are findings from reading, and the last section lists what reading could not settle.

## How WDK works on React Native

In the browser extension, WDK's wallet classes are imported and called directly, and the keys live in the page's JavaScript. On React Native the model is different.

- The wallet engine runs in a **Bare worklet**: a separate JavaScript runtime (Bare, from the Pear/Holepunch project) started by `react-native-bare-kit`, off the UI thread and outside React Native's own JavaScript engine.
- The app talks to it over **HRPC**, through `@tetherto/wdk-react-native-core`.
- The code that runs in the worklet is a **bundle generated at build time** by `@tetherto/wdk-worklet-bundler` from a `wdk.config.js` that names one wallet package per network.
- Seeds are encrypted and kept in the device keychain through `@tetherto/wdk-react-native-secure-storage`.

So the app never touches a private key. It asks the worklet to derive, sign and send.

## Packages

| Package | Version seen | Role |
|---|---|---|
| `@tetherto/wdk-react-native-core` | 1.0.0-beta.19 | Provider, hooks, stores |
| `react-native-bare-kit` | ≥ 0.14.5 (peer) | Runs the Bare worklet |
| `@tetherto/wdk-worklet-bundler` | 1.0.0-beta.13 | Builds the worklet bundle (`.wdk/`) |
| `@tetherto/pear-wrk-wdk` | 1.0.0-beta.14 | Worklet transport and handlers |
| `@tetherto/wdk-react-native-secure-storage` | 1.0.0-beta.5 (beta.4 advised) | Keychain storage, built on `react-native-keychain` |
| `@tetherto/wdk-secret-manager` | — | Seed encryption |
| `expo-crypto` | ≥ 55, < 57 (peer of core beta.19) | Entropy |
| WDK React Native UI Kit | — | Optional ready-made components |

Wallet modules, one per chain family:

| Chain | Module | In the official starter |
|---|---|---|
| EVM, standard accounts | `@tetherto/wdk-wallet-evm` | No (the starter uses the ERC-4337 variant) |
| EVM, smart accounts | `@tetherto/wdk-wallet-evm-erc-4337` | Yes |
| Bitcoin | `@tetherto/wdk-wallet-btc` | Yes |
| Solana | `@tetherto/wdk-wallet-solana` | Not listed |
| TON, Tron, Spark | their own modules | TON and Tron yes |
| **Bitcoin Cash** | **none** | — |

## Requirements

- Node.js 22 or newer
- React Native 0.81 or newer; the starter is on Expo ~54, React Native 0.81.4, React 19.1, New Architecture on
- Android: minimum SDK 29 (Android 10)
- iOS: deployment target 15.1
- An Expo **development client**: `react-native-bare-kit` is a native module, so Expo Go cannot run the app

## The app-side API

```tsx
<WdkAppProvider bundle={{ bundle }} wdkConfigs={wdkConfigs}>
  <Stack />
</WdkAppProvider>
```

| Hook | Gives |
|---|---|
| `useWdkApp()` | App state: `INITIALIZING`, `REINITIALIZING`, `NO_WALLET`, `LOCKED`, `READY`, `ERROR` |
| `useWalletManager()` | `createWallet(id)`, `restoreWallet()`, `unlock(id)`, `lock()`, `switchWallet()`, delete |
| `useAccount({ network, accountIndex })` | `address`, `send({ to, asset, amount })`, sign, verify, estimate fee |
| `useBalance`, `useBalancesForWallet(s)`, `useRefreshBalance` | Balances, cached with TanStack Query |
| `useAddresses` | Addresses across networks |
| `useProtocol` | Swap, bridge, lending and fiat protocol modules |
| `useModule` | Calls into custom "generic" modules in the worklet, and their events |

State lives in Zustand stores; the wallet list, addresses and balances persist to MMKV.

## The bundler, and why it matters for Bitcoin Cash

`wdk.config.js` maps a network name to a wallet package:

```js
module.exports = {
  networks: {
    ethereum: { package: '@tetherto/wdk-wallet-evm' },
    bitcoin:  { package: '@tetherto/wdk-wallet-btc' },
  },
  transport: 'hrpc',
}
```

Two documented features make a custom chain possible:

- **A wallet package can be a local directory.** "The loader also accepts local paths that resolve relative to the config file's directory." A `wdk-wallet-bch` we write can be bundled without publishing it.
- **Generic modules.** An optional `modules` map loads arbitrary code into the worklet through a factory that receives `{ seed, config, capabilities, emit }`. The app calls it with `useModule`. This is the documented way to run our own code next to the keys.

`@tetherto/create-wdk-module` scaffolds a wallet module (`npx @tetherto/create-wdk-module@latest wallet bch`) with tests, types and CI. A wallet module extends the base classes in `@tetherto/wdk-wallet`; `wdk-wallet-solana` is the reference to copy from.

For iOS, the bundler's `convertEsmToCjs` option must be on: Bare's iOS engine cannot load ES modules.

## Security behaviour WDK states plainly

- **Biometrics are not enforced** by the core package: "The current release does not enforce biometrics or another authentication policy." The app must authenticate the user before any create, restore, unlock or signing call.
- **The app chooses which wallet to unlock**, by id. The SDK never auto-unlocks.
- **`lock()` is an access boundary, not memory erasure.** It clears the active wallet in the app; the docs say it is not proof that keys were wiped from the worklet.
- Secure storage offers `requireBiometrics` on reads of the encryption key, device-security checks, and typed errors. It does not generate seeds, does not encrypt plaintext by itself, and does not do cloud backup.

## Things WDK offers that we are not planning to use at first

| Feature | Why not yet |
|---|---|
| ERC-4337 smart accounts and gasless transfers | Different addresses from the extension. Could be added later as an optional second account type. |
| WDK swap (Velora), bridge (USD₮0), lending (Aave), fiat (MoonPay) protocol modules | Our swaps go through our own two services. MoonPay is the obvious later addition for a "Buy" button. |
| WDK Indexer API | Needs an API key. Useful for EVM and Bitcoin history, which the extension lacks. Worth asking for. |
| Cloud backup tool | A product decision (see open questions). |
| TON, Tron, Spark/Lightning | Not chains the protocol uses today. |

## Rough edges the documentation admits

- The starter is labelled **alpha**; the core packages are **beta** with breaking changes between releases.
- `wdk-react-native-core` beta.19 ships `src/index.ts` without the compiled `dist/` its `package.json` points to. TypeScript needs `moduleResolution: "bundler"` and `customConditions: ["react-native"]`, and Metro must keep the `react-native` export condition.
- Secure storage beta.5 has the same packaging problem; the docs suggest pinning beta.4.
- The lifecycle mutex is fail-fast: a second guarded operation is rejected, not queued. The app has to serialise calls and retry a pending lock.
- The bundler does not enforce the version pairing with `pear-wrk-wdk`.

## What reading could not confirm

Each of these is a Phase 0 task in the [plan](03-plan.md).

| Question | Why it matters |
|---|---|
| **Can the worklet sign a transaction it did not build?** | Both swap services hand the wallet a transaction to sign (EVM calldata, a Solana versioned transaction). `useAccount` documents `send` and `sign`; signing an arbitrary serialised transaction is not described. |
| **Do `wdk-wallet-solana` and `wdk-wallet-btc` work inside Bare?** | They work in the extension's browser build. Bare is a different runtime with its own networking modules. The starter proves Bitcoin; nothing proves Solana. |
| **Does `wdk-wallet-evm` (not the 4337 variant) work in the worklet, and does it accept one network entry per EVM chain?** | We need ten EVM networks across the two modes. |
| **Does Bare run WebAssembly, on both platforms?** | Decides how much of `libauth` the BCH module may use. The plan assumes no. |
| **Which networking does Bare give a custom module?** | The BCH module needs WebSocket or HTTP to reach Electrum or an indexer. |
| **Which Expo SDK goes with core beta.19?** | The starter says Expo 54; the core package's peer range for `expo-crypto` starts at 55. |
| **What interface exactly must a wallet module export to be bundled?** | The bundler page does not say; the scaffold and `wdk-wallet-solana`'s source will. |

## Other technology the plan relies on

Not WDK, and not researched beyond common knowledge. Versions to be confirmed when work starts.

| Need | Candidate |
|---|---|
| WalletConnect v2 wallet side | Reown WalletKit (the successor to `@walletconnect/web3wallet`) |
| BCH over WalletConnect | The `wc2-bch-bcr` spec the frontend already uses with Cashonize |
| Navigation | Expo Router |
| Camera / QR | `expo-camera` |
| Biometrics | `expo-local-authentication` |
| Blur for glass surfaces | `expo-blur` |
| Vector graphics and animation (Cham) | `react-native-svg`, `react-native-reanimated` |
| Fast key-value storage | `react-native-mmkv` (already used by WDK core) |
| Cloud builds | EAS Build |

## Sources

- [React Native Quickstart](https://docs.wdk.tether.io/start-building/react-native-quickstart/)
- [React Native Starter (Alpha)](https://docs.wdk.tether.io/examples-and-starters/react-native-starter/)
- [React Native Core](https://docs.wdk.tether.io/tools/react-native-core/)
- [React Native Secure Storage](https://docs.wdk.tether.io/tools/react-native-secure-storage/)
- [Worklet Bundler configuration](https://docs.wdk.tether.io/tools/worklet-bundler/configuration/)
- [Create WDK Module](https://docs.wdk.tether.io/tools/create-wdk-module/)
- [wdk-starter-react-native on GitHub](https://github.com/tetherto/wdk-starter-react-native)
- [Using Bare standalone (Pear docs)](https://docs.pears.com/explanation/use-bare-standalone/)
- Local: `devrel-agent-context/wdk-wallet/01-wdk-overview.md`, `02-bch-path.md`; the extension's `docs/internal/`
