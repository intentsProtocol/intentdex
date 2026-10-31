# Cham Wallet & Intents Protocol — Development History & Commit Logs

> **Hackathon Track:** Agentic Finance with WDK (Tether × Node NBO Nairobi)  
> **Author & Lead Developer:** tonybanks90 (`antonygitonga90@gmail.com`)  
> **Repository:** [intentsProtocol/intentdex](https://github.com/intentsProtocol/intentdex)  
> **Directory:** `/Intent-protocol`

This document preserves the comprehensive, chronological Git commit logs and development milestones across all core modules developed for the hackathon.

---

## 📊 Development Summary

| Module | Purpose | Commits | Primary Milestones |
| :--- | :--- | :---: | :--- |
| **`bch-intents-wallet-app`** | React Native / Expo Bare on-device AI mobile wallet | **34** | QVAC local LLM engine, Mesh LP management, CashToken NFTs, WDK worklet, liquid glass UI |
| **`bch-intents-wallet-extension`** | Manifest V3 multi-chain browser wallet extension | **28** | Inpage provider (`window.bch`), approval workflows, multi-chain signing (BCH, EVM, Solana, BTC) |
| **`bch-intents-wallet-core`** | Shared agent logic, offline Mesh planner & solver rules | **17** | Intent parser, local position planner fallback, strategy simulation, multi-gateway resolution |
| **`cham-wallet-web`** | Morphic liquid-glass web showcase & interactive portal | **5** | Morphic Chameleon mascot, download banner, local AI showcase, responsive bento grid |
| **`wdk-wallet-bch`** | WDK core adapter for Bitcoin Cash & CashTokens | **5** | Electrum RPC over WebSocket stream, CashToken NFT commitments, offline tx broadcast |
| **Total** | | **89 Commits** | **Full-Stack Autonomous Agentic Wallet Ecosystem** |

---

## 🛠️ Detailed Module Commit Logs

### 1. `bch-intents-wallet-app` (Mobile Wallet App)
* **4dedcba** - *2026-10-31* - chore: ignore pitchfolderdocs (tonybanks90)
* **02c1081** - *2026-10-30* - feat(ui): add liquid glass editable amount container, history/position analysis cards, and fix Android keyboard floating (tonybanks90)
* **9807458** - *2026-10-30* - chore: sync vendor wallet-core with local mesh position planner (tonybanks90)
* **c9dad80** - *2026-10-29* - feat(ui): add IPFS multi-gateway logo resolution, display token names in list, and 1-tap copy for token addresses (tonybanks90)
* **1abb5e4** - *2026-10-29* - fix(agent): use real CashTokens in chips and prompts, clarifying Mesh as the AMM protocol (tonybanks90)
* **e330ff8** - *2026-10-29* - docs: add 54-prompt eval bank and update offline agent architecture plan (tonybanks90)
* **a854b9e** - *2026-10-29* - feat(ui): add underfunded draft top-up flow, offline snapshot balance persistence, rich chat formatting, and dynamic token autocomplete (tonybanks90)
* **c78413e** - *2026-10-29* - feat(core): sync agent core with underfunded drafts and token suggestions (tonybanks90)
* **ffec98c** - *2026-10-26* - chore(app): tsconfig as Expo writes it (tonybanks90)
* **b1cbfa8** - *2026-10-26* - fix(app): unknown-token reply lists the tokens the agent knows (tonybanks90)
* **5febeeb** - *2026-10-26* - fix(app): CPU unless chosen otherwise, and a two-minute limit per answer (tonybanks90)
* **f011b2a** - *2026-10-26* - fix(app): recover when QVAC's worker drops its connection; quick intents on the phone (tonybanks90)
* **8548c02** - *2026-10-26* - perf(app): run the model on the CPU by default, no thinking, and a second download source (tonybanks90)
* **379b6be** - *2026-10-26* - fix(app): a spam-flooded address no longer freezes the wallet (tonybanks90)
* **c293009** - *2026-10-26* - fix(app): model download no longer floods the app; engine starts only when needed (tonybanks90)
* **fa63011** - *2026-10-26* - feat(app): model manager — choose, download, use and delete on-phone models (tonybanks90)
* **4e6126c** - *2026-10-26* - docs(app): the agent in architecture, storage, testing and known limits (tonybanks90)
* **2671cbd** - *2026-10-26* - feat(app): create Mesh positions from the agent's plans (tonybanks90)
* **3f3a3b1** - *2026-10-26* - chore(app): development builds need no keystore either (tonybanks90)
* **9aef53e** - *2026-10-26* - feat(app): the Agent tab — an on-phone assistant that plans swaps, Mesh strategies and loans (tonybanks90)
* **cdf1c19** - *2026-10-26* - chore(app): QVAC on the phone next to the WDK worklet (tonybanks90)
* **82e6b8d** - *2026-10-26* - docs(app): plan for the on-device AI agent (QVAC + WDK) (tonybanks90)
* **c43361e** - *2026-10-26* - feat(app): CashToken NFTs and Mesh V4 positions in the wallet (tonybanks90)
* **40b0e15** - *2026-10-10* - fix(app): pin the Bare stack to the versions of Tether's starter (tonybanks90)
* **e72c03e** - *2026-10-10* - chore(app): preview builds carry the live service URLs (tonybanks90)
* **ec43c40** - *2026-10-10* - fix(app): Bare runtime new enough for the addons the worklet loads (tonybanks90)
* **7a58f13** - *2026-10-10* - chore(app): declare worklet-bundler peer deps (tonybanks90)
* **3838581** - *2026-10-10* - chore(app): make npm ci on EAS happy (tonybanks90)
* **58e09ab** - *2026-10-09* - docs(app): who deploys the relayer, and why (tonybanks90)
* **338d4f9** - *2026-10-09* - chore(app): link the EAS project (tonybanks90)
* **aed259d** - *2026-10-09* - chore(app): pass Expo's project checks; preview builds need no keystore (tonybanks90)
* **1bab077** - *2026-10-09* - fix(app): text decoding, keyboard and PIN pad hold up without help from the engine (tonybanks90)
* **9a088a4** - *2026-10-09* - feat(app): the wallet: onboarding, PIN and biometrics, accounts, send, receive, scan, swaps, dapp connections (tonybanks90)
* **076b885** - *2026-10-09* - chore: scaffold the mobile app on the WDK worklet (tonybanks90)

---

### 2. `bch-intents-wallet-extension` (Browser Extension)
* **f489119** - *2026-10-31* - feat(extension): update portfolio assets, popup UI, and borrow implementation plan (tonybanks90)
* **d4e9bc1** - *2026-10-12* - feat: replace lightning icon with Cham spiral logo in browser extension (tonybanks90)
* **706688f** - *2026-10-10* - fix(ext): open the approval window even when its usual place is off screen (tonybanks90)
* **fe687f6** - *2026-10-10* - docs(ext): bch_signTransaction reference and limits (tonybanks90)
* **3833d8a** - *2026-10-10* - feat(ext): bch_signTransaction, the WalletConnect-BCH payload through the provider (tonybanks90)
* **b88241a** - *2026-10-10* - chore(ext): default to the live Railway services (tonybanks90)
* **5682129** - *2026-10-09* - refactor(ext): swap flows come from the shared package (tonybanks90)
* **c64cccd** - *2026-10-09* - refactor(ext): consume the shared wallet-core package; fix BCH account path and CashAddr checks (tonybanks90)
* **a0b7a8f** - *2026-10-09* - feat(ext): MetaMask-style accounts and signing on every chain through the provider (tonybanks90)
* **d219282** - *2026-10-09* - test(ext): fresh-wallet fixtures; docs for testing, limitations and release (tonybanks90)
* **8a6a716** - *2026-10-09* - fix(ext): Solana and Bitcoin derivation, lost dapp requests, unlock error (tonybanks90)
* **06d98b0** - *2026-10-09* - test(ext): unit tests, end-to-end tests and documentation (tonybanks90)
* **0e46b67** - *2026-10-09* - feat(ext): onboarding, home, send, receive, swap, activity, settings and approval screens (tonybanks90)
* **37bf73d** - *2026-10-09* - feat(ext): side panel by default, dapp permissions and a persistent request queue (tonybanks90)
* **5ec194f** - *2026-10-09* - feat(ext): swap clients for cashtoken-relayer and cctp-swap-server (tonybanks90)
* **9119374** - *2026-10-09* - feat(ext): multi-chain balances and sending for BCH, EVM, Solana and Bitcoin (tonybanks90)
* **1d7a610** - *2026-10-09* - feat(ext): theme tokens, light and dark mode, liquid glass, i18n and Cham (tonybanks90)
* **b401670** - *2026-10-09* - feat(ext): multi-account store, account switcher, settings and activity screens (tonybanks90)
* **1f45e2a** - *2026-05-20* - fix(popup): resolve Buffer/process global errors and add independent testing suite (tonybanks90)
* **e0d73cf** - *2026-05-20* - feat(ui): implement Morphic-styled connection and signing approval screens (tonybanks90)
* **077ebec** - *2026-05-20* - feat(extension): resolve race conditions, inject checks, and storage fallbacks (tonybanks90)
* **dd2687e** - *2026-05-20* - fix(ext): polyfill Buffer global for mainnet-js/libauth in browser context (tonybanks90)
* **53c2ffe** - *2026-05-20* - fix(ext): align manifest paths with Vite output; auto-copy manifest to dist/ (tonybanks90)
* **59f9c96** - *2026-05-20* - fix(build): set target=esnext to allow mainnet-js top-level await in WASM init (tonybanks90)
* **f5147a3** - *2026-05-20* - feat(ext): wire wallet logo from public/icons in MTopBar with PNG fallback (tonybanks90)
* **35cc6ff** - *2026-05-20* - feat(ext): Phase 3 — main wallet screens (Home, Addresses, Send, Receive) (tonybanks90)
* **ad4a460** - *2026-05-20* - feat(ext): Phase 2 — Morphic design system + onboarding & unlock screens (tonybanks90)
* **4af3910** - *2026-05-20* - feat(ext): Phase 1 — project scaffold, wallet providers, and all 4 entry points (tonybanks90)

---

### 3. `bch-intents-wallet-core` (Shared Protocol & Agent Core)
* **5f65487** - *2026-10-30* - feat(types): add destinationGasWarning to SwapDraft (tonybanks90)
* **6887fe8** - *2026-10-30* - feat(agent): add analyze_history, analyze_positions, simulate_strategy tools and underfunded loan/swap flow (tonybanks90)
* **7863f78** - *2026-10-30* - fix(mesh): add local on-device position planner fallback for offline and unconfigured server resilience (tonybanks90)
* **415adec** - *2026-10-29* - feat(agent): support underfunded drafts, quick intent regexes, and token suggestions (tonybanks90)
* **35ee36b** - *2026-10-26* - fix(agent): name the tokens it knows when one is unknown (tonybanks90)
* **8f49546** - *2026-10-26* - feat: a 'slow' error for answers stopped by the host's time limit (tonybanks90)
* **efbf44f** - *2026-10-26* - feat: clear requests skip the model; tool-call JSON is never shown (tonybanks90)
* **3fbac1c** - *2026-10-26* - perf: a shorter, unchanging system prompt and terser tool descriptions (tonybanks90)
* **24c248c** - *2026-10-26* - feat: cashAddressToLockingBytecode, to check a plan pays this wallet (tonybanks90)
* **9a442a9** - *2026-10-26* - feat: Mesh V4 position creation — plan client and on-device plan checks (tonybanks90)
* **5918478** - *2026-10-26* - feat: formatSig for rates; snapshots keep token prices while offline (tonybanks90)
* **ae7d8e1** - *2026-10-26* - feat: on-device agent core — tools, turn loop, chats and outbox (tonybanks90)
* **378ec7b** - *2026-10-26* - feat: CashToken NFTs and Mesh V4 position NFTs (tonybanks90)
* **dad4316** - *2026-10-10* - feat: approval text for signing a transaction a site built (tonybanks90)
* **229c8de** - *2026-10-09* - feat: Solana wire format, for wallets that sign outside the page (tonybanks90)
* **733b0f1** - *2026-10-09* - feat: swap flows with wallet-neutral signers; hand-encoded EVM calls (tonybanks90)
* **24f523c** - *2026-10-09* - feat: shared wallet logic for the extension and the mobile app (tonybanks90)

---

### 4. `cham-wallet-web` (Web Showcase & Landing Portal)
* **4ccba42** - *2026-10-31* - feat(web): add wallet hero, download modal, bento features, and local AI section (tonybanks90)
* **b1bd330** - *2026-10-12* - feat: dynamic color-morphing ChamLogo, unboxed hero mascot, and Chameleon tongue camouflage arena (tonybanks90)
* **04f3b88** - *2026-10-12* - chore: set package name to camwallet (tonybanks90)
* **ccd7ecc** - *2026-10-12* - feat: integrate Cham spiral logo and Vercel deployment configuration (tonybanks90)
* **37dcdd6** - *2026-10-11* - feat: initial scaffold of Cham Wallet landing site with morphic liquid-glass design (tonybanks90)

---

### 5. `wdk-wallet-bch` (WDK Core Bitcoin Cash Module)
* **363d359** - *2026-10-26* - feat: sendOutputs and quoteOutputs — pay outputs another party planned (tonybanks90)
* **9c73c64** - *2026-10-26* - feat: NFT holdings and transferNft, keeping commitment and capability (tonybanks90)
* **9c5f3f4** - *2026-10-09* - feat: broadcastTransaction, for a transaction signed in an earlier step (tonybanks90)
* **5976ff3** - *2026-10-09* - feat: Electrum client works with a Bare worklet's stream WebSocket (tonybanks90)
* **0c15508** - *2026-10-09* - feat: WDK wallet module for Bitcoin Cash (tonybanks90)

