# BCH Intents Wallet — mobile app

Research and plan for the React Native wallet, written on 2026-10-09 before any code existed.

> **The app has since been built.** What exists is described in [`../docs`](../docs/README.md), and where the two differ, that folder is right. The differences worth knowing:
>
> - The app is on Expo 55, React Native 0.83 and `@tetherto/wdk-react-native-core` 1.0.0-beta.17, the versions of Tether's starter, not the ones listed here.
> - Bitcoin Cash is derived at `m/44'/0'/0'/0/N` (coin type 0), the path the web app and extension already use. These documents say 145.
> - Reads for EVM and Solana go over JSON-RPC from the app; only signing, and Bitcoin and Bitcoin Cash reads, go through the worklet.
> - WalletConnect covers Bitcoin Cash as well (the `bch` namespace). WizardConnect was evaluated and cannot run in React Native's engine; the reason is in `../docs/internal/known-limitations.md`.
> - The shared package and the Bitcoin Cash module live next to this folder (`../bch-intents-wallet-core`, `../wdk-wallet-bch`) and are copied into `vendor/`.

WDK's React Native packages are in beta and change often: re-check versions before upgrading.

| Document | What it answers |
|---|---|
| [01 — Research](01-research.md) | What WDK offers for React Native, what was read, what could not be confirmed |
| [02 — Architecture](02-architecture.md) | How the app is put together: worklet, the BCH module, shared code, security, swaps, WalletConnect, UI |
| [03 — Plan](03-plan.md) | Phases, what each delivers, and how we know each is done |
| [04 — Risks and open questions](04-risks-and-open-questions.md) | What could go wrong, and what still needs an answer from the owner |

## Decisions already made

Answered by the project owner on 2026-10-09.

| Topic | Decision |
|---|---|
| Bitcoin Cash | A custom WDK wallet module, `wdk-wallet-bch`, with pure-JavaScript cryptography (no WebAssembly) |
| EVM accounts | Standard accounts: the same addresses as the extension and MetaMask. Not ERC-4337. |
| Platforms | Android first, developed locally on Windows. iOS through Expo's cloud build (EAS). |
| Dapp connection | WalletConnect v2 |
| First release | Wallet core, swaps, WalletConnect, QR scan and pay |
| Unlock | Biometrics, with a 6-digit app PIN as fallback |
| Code sharing | One shared package used by the extension and the app |
| This step | Research and plan only |

## In one paragraph

The app is an Expo (development client) React Native app built on `@tetherto/wdk-react-native-core`, which runs the wallet engine in an isolated Bare worklet so keys stay out of the React Native JavaScript context. EVM, Solana and Bitcoin use WDK's own wallet modules. Bitcoin Cash, which WDK does not ship, is a module we write and bundle into the same worklet. Everything that is not platform-specific (the network table, swap clients and routing, formatting, translations) moves out of the extension into a shared package so the two wallets cannot drift apart. The same recovery phrase gives the same addresses on the phone as in the browser.

## The three things most likely to change the plan

1. **Signing transactions a server built.** Both swap services return transactions for the wallet to sign. In the worklet model the app never holds a key, so this needs a signing path inside the worklet that WDK's documented hooks may not provide. Phase 0 settles it.
2. **Whether WDK's Solana and Bitcoin modules run in the worklet as they do in the browser.** The official starter covers Bitcoin; Solana is not in its list.
3. **Version alignment.** The starter is on Expo 54 while the core package's current beta asks for a newer `expo-crypto`. The first task is finding a set of versions that builds.

Details in [04](04-risks-and-open-questions.md).
