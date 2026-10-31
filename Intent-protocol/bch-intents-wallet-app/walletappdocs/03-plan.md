# 03 — Plan

Seven phases. Each ends with something that runs and a stated way to know it is done. Phase 0 exists to turn the unknowns in [01](01-research.md#what-reading-could-not-confirm) into facts before anything is built on them.

**On time:** the sizes below are estimates for one developer working on this full time, and they are guesses until Phase 0 is finished. WDK's React Native packages are beta; a breaking release mid-project is likely enough to plan for.

| Phase | What | Size |
|---|---|---|
| 0 | Proving the foundations | 1 to 2 weeks |
| 1 | Shared package | about 1 week |
| 2 | Bitcoin Cash module | 2 to 3 weeks |
| 3 | Wallet core app | 3 to 4 weeks |
| 4 | Swaps | about 2 weeks |
| 5 | WalletConnect and QR | 2 to 3 weeks |
| 6 | Hardening, iOS, release preparation | 2 to 3 weeks |

Phases 1 and 2 do not depend on each other and can overlap. Phase 3 needs both.

---

## Phase 0 — Proving the foundations

Throwaway code. The output is answers, written back into these documents.

| # | Task | Answers |
|---|---|---|
| 0.1 | Clone WDK's starter; build and run it on an Android device from this Windows machine | Does the toolchain work here at all? Node 22, Android SDK, Expo development client. |
| 0.2 | Find a set of package versions that builds: Expo SDK, `wdk-react-native-core`, `expo-crypto`, `react-native-bare-kit`, bundler, `pear-wrk-wdk`, secure storage | The version table for the real project |
| 0.3 | Swap the starter's ERC-4337 module for `wdk-wallet-evm`; add two EVM networks; import the Hardhat phrase | Standard EVM accounts work in the worklet; several networks share one package; the address is `0xf39F…2266`, and account 1 is `0x7099…79C8` |
| 0.4 | Add `wdk-wallet-solana` and `wdk-wallet-btc`; read a balance and sign a message on each | Both run inside Bare, with working network access |
| 0.5 | Read the source of `wdk-wallet-evm` and `wdk-wallet-solana` for transaction-signing methods; try signing a prepared EVM call and a serialised Solana transaction | Plan A or Plan B for [signing what a server built](02-architecture.md#signing-what-a-server-built) |
| 0.6 | Write a ten-line generic module; call it with `useModule`; from it, open a WebSocket to a Fulcrum server and make an HTTPS request | Custom code runs in the worklet; which networking the BCH module can use |
| 0.7 | In the same module, try `WebAssembly.instantiate` on a tiny binary, and try importing `@bitauth/libauth`'s encoding functions | Whether any of `libauth` is usable; confirms or relaxes the no-WebAssembly rule |
| 0.8 | Bundle a stub local wallet package under `networks` | The exact interface a wallet module must export |
| 0.9 | Measure worklet start-up and a lock-by-teardown cycle on a mid-range Android phone | Whether lock can destroy the worklet |
| 0.10 | Run one EAS build for iOS and install it on an iPhone | iOS is reachable from Windows; `convertEsmToCjs` works; Apple account and signing are in place |

**Done when:** every row has a written answer, and [04](04-risks-and-open-questions.md)'s top three risks are either retired or have a chosen fallback.

**If it goes badly:** 0.3, 0.4 or 0.5 failing does not end the project. The fallback is for `intents-signer` (or a set of our own modules) to carry more of the chain logic inside the worklet, using the same libraries the extension uses. That costs time in Phase 3, not feasibility.

---

## Phase 1 — Shared package

Move the platform-independent code out of the extension into `@bch-intents/wallet-core`, as listed in the [architecture](02-architecture.md#shared-code-bch-intentswallet-core).

1. Create the package with the extension's unit tests for those modules.
2. Replace build-time `import.meta.env` reads with a `configure()` call.
3. Put the signer and storage interfaces in front of the bridge flow, the BCH swap flow, the journal, the caches and the activity log.
4. Point the extension at the package; delete its copies.

**Done when:** the extension's typecheck, 63 unit tests and full end-to-end suite pass against the package, with no behaviour change.

---

## Phase 2 — Bitcoin Cash module

`wdk-wallet-bch`, as specified in the [architecture](02-architecture.md#the-bitcoin-cash-module-wdk-wallet-bch).

| Step | Deliverable |
|---|---|
| 2.1 | Scaffold with `create-wdk-module`; derivation and both address forms; vectors pass |
| 2.2 | Message signing; equal to `mainnet-js`'s output byte for byte |
| 2.3 | Electrum client; balances, coins, history |
| 2.4 | Transaction building and signing for BCH; byte-equal to `mainnet-js` for fixed inputs; a real send on chipnet |
| 2.5 | CashTokens: balances, sends, token change; a real token send on chipnet |
| 2.6 | Paying P2SH addresses; signing a prepared transaction with source outputs |
| 2.7 | Bundled into the worklet; all of the above from the phone |

**Done when:** every test class in [how we know it is right](02-architecture.md#how-we-know-it-is-right) passes, and BCH and a CashToken have been sent from a phone on chipnet and seen arriving in the extension.

This is the phase to have reviewed by someone who knows Bitcoin Cash transaction signing, before mainnet.

---

## Phase 3 — Wallet core app

The real project, started from the Phase 0 versions.

| Area | Screens and behaviour |
|---|---|
| Onboarding | Welcome with Cham; create (PIN → phrase → check three words → biometrics opt-in → done); import with phrase validation |
| Lock | Biometric prompt with PIN fallback; attempt limits; auto-lock on background and inactivity |
| Wallet | Portfolio card, per-chain filter, token list, token detail sheet, hide balances, pull to refresh |
| Accounts | Switcher, add, rename |
| Network | Testnet / mainnet switch with the mainnet confirmation |
| Receive | Address and QR per chain; BCH token-aware address |
| Send | Asset → recipient → amount → review → biometric confirm → sent; per-chain validation and fee checks from `wallet-core` |
| Activity | The wallet's own record, plus chain history where available |
| Settings | Theme, language, auto-lock, trading defaults, addresses, recovery phrase (re-authenticated), change PIN, biometrics toggle, services status, about, remove wallet |

**Done when:**
- the Hardhat phrase gives the extension's four addresses for accounts 0 and 1;
- a wallet created on the phone and imported into the extension shows the same addresses;
- a send and a receive have been done on testnet on each of the four families;
- killing the app mid-send leaves a correct Activity entry;
- an automated UI suite (Maestro or Detox, chosen in this phase) covers onboarding, lock, settings and account switching.

---

## Phase 4 — Swaps

The Swap tab, on `wallet-core`'s clients and routing.

1. Signers for the three flows (Plan A or B from Phase 0).
2. The card: token selector, quote, details, the blocking reasons on the button.
3. The runner: persisted steps, resume after backgrounding, Activity reconciliation, "pay the service fee" and "resume" actions.
4. Checking a server-built transaction against the quote before signing (also to be back-ported to the extension).

**Done when:** on testnet, from the phone: a BCH ↔ CashToken swap fills; one is left to expire and refunds; a USDC bridge delivers; a bridge interrupted by force-quitting the app after the burn is finished from Activity. On mainnet with small amounts: one Solana swap and one bridge.

Needs the two services deployed somewhere a phone can reach: `localhost` is not reachable from a device.

---

## Phase 5 — WalletConnect and QR

1. QR scanner and the payment-URI parser; Send prefilled from a scan.
2. WalletConnect pairing, session proposal and session list (Settings → Connected apps).
3. `bch` namespace: addresses, message signing, transaction signing. Tested against the Intents frontend, which already speaks this spec.
4. `eip155`: `personal_sign`, `eth_sendTransaction`, chain switching, then typed data with a readable display.
5. `solana`: message and transaction signing.

**Done when:** the phone connects to the Intents frontend by QR and completes a BCH swap there; connects to one well-known EVM dapp and one Solana dapp on testnet and signs a message and a transaction on each; every request type has a screen that says what is being signed.

---

## Phase 6 — Hardening, iOS, release preparation

| Area | Work |
|---|---|
| iOS | Run every flow on an iPhone from EAS builds; fix platform differences (blur, keychain behaviour, safe areas) |
| Security | Screenshot blocking, clipboard clearing, root/jailbreak warning, dependency audit; an external review of the BCH module and the signing paths |
| Reliability | Slow and offline networks, RPC failures, app killed at every step of every flow |
| Accessibility | Screen reader labels, large text, contrast in both themes |
| Translation | Native review of the Chinese text |
| Performance | Cold start, worklet start, list scrolling on a low-end Android device |
| Distribution | Android internal testing track and iOS TestFlight; store listings, privacy policy, icons, screenshots |
| Docs | User guide, and internal docs in the same three-part shape as the extension's |

**Done when:** a tester outside the team installs from the test tracks on both platforms and completes onboarding, a send, a swap and a WalletConnect session without help.

---

## What can be cut if time is short

In order, least painful first:

1. EVM typed-data signing and Solana over WalletConnect (keep BCH and basic EVM).
2. Solana swaps (mainnet only anyway).
3. iOS, to a following release.
4. WalletConnect entirely, to a following release. QR scan and pay stays.

Not cuttable: Phases 0 to 3, and the BCH module's test suite.

## Before Phase 0 can start

From the owner: answers to the [open questions](04-risks-and-open-questions.md#open-questions-for-the-owner), an Android phone for testing (Android 10 or newer), and Node 22 on the development machine.
