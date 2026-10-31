# Cham Core Engine: Under-The-Hood Architecture & Superpowers
**The Cryptographic Foundation of Cham Wallet**

> **Branding Directive:**
> **NEVER mention external library names or vendor SDKs on the public landing page or in UI copy.**
> The brand and product identity is strictly **Cham Wallet** / **Cham Core Engine**. The underlying modular architecture is internal engineering detail.

---

## 1. Executive Summary: The Cham Wallet Core Engine

Cham Wallet is built on a custom, lightweight, modular cryptographic engine (`Cham Core Engine`). 

While typical Web3 wallets rely on bloated RPC nodes, heavy WebAssembly runtimes, or centralized custodial infrastructure, Cham Wallet uses a lean, pure-JavaScript cryptographic pipeline that treats Bitcoin Cash with the exact same high-level interface as EVM and Solana chains.

---

## 2. The 8 Unique Architectural Superpowers of Cham Wallet

### 1. Pure JavaScript Cryptography (Zero WASM, Zero Bloat)
- **How it works**: Uses `@noble/curves`, `@noble/hashes`, and `@scure/bip32` — audited, ultra-lightweight JavaScript primitives.
- **The User Benefit**: No bulky WebAssembly blobs to compile or load. The wallet launches instantaneously in web browsers, Chrome extension background service workers, and phone runtimes (Bare worklets on iOS and Android).

### 2. Universal Mobile & Worklet Compatibility (Bare Runtime)
- **How it works**: Standard Node/Web APIs often break in mobile background threads. Cham's engine decouples the WebSocket constructor and network transport (`globalThis.WebSocket` / custom socket injection).
- **The User Benefit**: Seamless operation inside mobile Bare worklets (Expo / React Native) with zero crash risk from missing Node polyfills.

### 3. Dual-Derivation Multi-Account Strategy (`coinType: 145` & `coinType: 0`)
- **How it works**:
  - Standard BCH wallets (Electron Cash): `m/44'/145'/0'/0/n`
  - Legacy web wallets & `mainnet-js`: `m/44'/0'/0'/0/0` (Bitcoin coinType 0)
- **The User Benefit**: Full backward and forward compatibility. Cham Wallet supports seamless derivation paths so users never lose funds regardless of where their seed phrase originated.

### 4. Native CashTokens L1 Engine & Smart Covenants
- **How it works**: Full native support for Bitcoin Cash's May 2023 CashTokens upgrade.
  - Derives token-aware addresses (`bchtest:z...` / `bitcoincash:z...`)
  - Tracks fungible token categories with BigInt precision
  - Automatically calculates token change and BCH miner fee change outputs in a single atomic transaction
  - Spends Pay-to-Script-Hash (P2SH) covenants (both 20-byte and 32-byte hash commitments)

### 5. Resilient Electrum Fulcrum WebSocket Mesh
- **How it works**: Instead of fragile single-RPC endpoints, Cham Wallet connects directly to a pool of high-speed Fulcrum Electrum WebSocket servers.
- **The User Benefit**: Real-time UTXO subscriptions, sub-second transaction broadcast, automatic failover if a server goes offline, and zero reliance on centralized third-party indexers like Infura or Alchemy.

### 6. Intent Protocol & `SIGHASH_UTXOS` Dapp Signing
- **How it works**: Implements `bch_signTransaction` and `SIGHASH_UTXOS` commitments. Connected dapps (like the BCH Intents swap engine) construct complex covenants; Cham Wallet verifies inputs, calculates precise spend amounts, and signs cryptographically.
- **The User Benefit**: Safe participation in Dutch Auctions and peer-to-peer intent matching without ever exposing private keys.

### 7. Absolute Non-Custodial Security & Local Keystore
- **How it works**: All keys are generated on-device, encrypted in local storage with salted PBKDF2/AES-GCM, and wiped from memory upon locking. No analytics servers, no remote key vaults, no telemetry tracking.

### 8. Unified Multi-Chain Intent Alignment
- **How it works**: Cham's unified account manager pattern coordinates intent swaps seamlessly across Bitcoin Cash, Solana, Ethereum, Base, Arbitrum, and Movement from a single seed phrase.

---

## 3. How to Present These Superpowers on the Marketing Landing Page

On `wallet.<domain>`, frame every capability through **Cham Wallet's** signature speed, safety, and autonomy:

| Technical Feature | Landing Page Headline | Marketing Benefit Copy |
|---|---|---|
| Pure JS, Zero-WASM | **Instant Startup, Zero Bloat** | "Loads in milliseconds. No heavy WebAssembly downloads. Just blazing-fast, audited client-side cryptography." |
| Native CashTokens | **Real Layer-1 Tokens** | "Send, receive, and trade CashTokens natively on Bitcoin Cash without wrapped contracts or L2 bridges." |
| P2SH Covenants | **Smart Contract Precision** | "Unlock decentralized Dutch Auctions, limit orders, and atomic intent swaps powered by BCH covenants." |
| Electrum WebSocket Mesh | **Unstoppable P2P Networking** | "Direct connection to the decentralized Fulcrum server mesh. No single point of failure. Real-time balance updates." |
| Self-Custodial Derivation | **Your Keys. Your Sovereignty.** | "Standard BIP-39/BIP-44 derivation. Compatible with your existing recovery phrases. Always in your control." |
