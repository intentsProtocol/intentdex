# Content Copy Deck & Truthful Claims Guide
**Messaging Strategy, Brand Voice & Honest Product Claims**

---

## 1. Brand Voice: Confident, Technical, Transparent

Cham Wallet speaks directly to builders, traders, and crypto enthusiasts who value self-custody and real technology.
- **Tone**: Modern, punchy, technically grounded, playful (via Cham the Chameleon), and unapologetically transparent.
- **Rule of Truthfulness**: Never make false claims about store availability or user metrics. We earn trust by shipping real cryptography, not marketing vaporware.

---

## 2. Claims Audit: What Can and Cannot Be Claimed

As outlined in `HANDOVER.md` and `known-limitations.md`, the marketing copy must accurately reflect the software's true state:

| Unverified / False Claim (DO NOT USE) | Accurate / Verified Reality (USE THIS) |
|---|---|
| "Available on the Apple App Store & Google Play" | **"Mobile App Coming Soon. Built with Expo & Bare Worklet Architecture."** |
| "Download on TestFlight" | **"Join the Mobile Waitlist for Early Access."** |
| "Supported on Chrome, Firefox, Safari & Brave" | **"Available for Chromium Browsers (Chrome, Brave, Edge). Firefox & Safari in planning."** |
| "Trusted by thousands of daily users" | **"Built for the next generation of Bitcoin Cash & multi-chain intent traders."** |
| "Fully audited institutional security" | **"Open source, client-side cryptography. Alpha release: use chipnet or exercise caution on mainnet."** |
| "Instant bridge to every EVM token" | **"Native cross-chain intent settlement across BCH, Solana, Movement, Ethereum & USDC."** |

---

## 3. Section-by-Section Copy Deck

### Section 0: Header
- **Logo Text**: `Cham Wallet`
- **Pill Badge**: `ALPHA v0.2`
- **Nav Links**: `Overview` | `Networks` | `CashTokens` | `Security` | `FAQ`
- **CTAs**: `Open Web App` | `Install Extension`

---

### Section 1: Hero Section
- **Kicker / Tag**: `SELF-CUSTODY RE-ENGINEERED`
- **Hero Title**:
  ```
  ONE WALLET.
  EVERY INTENT.
  ZERO BRIDGES.
  ```
- **Hero Subtitle**:
  "The multi-chain self-custody wallet powered by Bitcoin Cash CashTokens, client-side cryptography, and peer-to-peer intent settlement. Swap native assets across BCH, Solana, and EVM without bridge lockups."
- **Primary CTAs**:
  - `Install Chrome Alpha` (Opens download instructions / package unpacker)
  - `Launch Web Wallet` (Direct link to `/trade`)
- **Micro-Copy**: `100% Non-Custodial • Pure Client-Side Keys • Zero WASM Overhead`

---

### Section 2: Bento Grid Overview
- **Kicker**: `THE ARCHITECTURE`
- **Section Heading**: `Built for what you actually do on-chain.`
- **Card 1 (Intent Settlement)**:
  - *Title*: **Bridge-less Intent Swaps**
  - *Body*: "Never lock funds in vulnerable cross-chain bridges again. State what you want to trade and let competitive solvers execute Dutch Auctions via CashScript covenants."
- **Card 2 (CashTokens L1)**:
  - *Title*: **Native CashTokens on Bitcoin Cash**
  - *Body*: "First-class token management on BCH Layer 1. Send, receive, and swap fungible CashTokens with zero Ethereum gas spikes."
- **Card 3 (Pure-JS Engine)**:
  - *Title*: **Cham Pure-JS Core**
  - *Body*: "Built with pure JavaScript cryptography (`@noble` primitives). Zero WebAssembly bloat for sub-millisecond wallet spin-up."
- **Card 4 (Unified Seed)**:
  - *Title*: **One Phrase. Multiple Blockchains.**
  - *Body*: "Derive Bitcoin Cash (`145'` and legacy `0'`), Solana, Ethereum, and Movement accounts from a single BIP-39 recovery phrase."

---

### Section 3: Multi-Chain Arc
- **Kicker**: `INTEROPERABILITY`
- **Section Heading**: `Native assets. Unified liquidity.`
- **Chain Badges & Stats**:
  - **Bitcoin Cash (BCH)**: `< $0.001 Avg Fee` • `CashTokens Native` • `Instant UTXO P2P`
  - **Solana (SOL)**: `400ms Confirmation` • `USDC Settlement` • `High Frequency`
  - **Ethereum & EVM**: `Standard Security` • `Base & Arbitrum L2s` • `Zero Bridge Risk`
  - **Movement (MOVE)**: `Move-EVM Security` • `Viridian Speed` • `Intent Integration`

---

### Section 4: Deep Security & Cryptography
- **Kicker**: `NON-CUSTODIAL PURITY`
- **Section Heading**: `Security without compromise.`
- **Pillars**:
  - **Client-Side Keystore**: "Keys never leave your browser or device. PBKDF2 encryption with salted local storage."
  - **Covenant Verification**: "Every transaction commitment is signed with `SIGHASH_UTXOS`, mathematically enforcing payout conditions."
  - **Independent Node Connectivity**: "Direct Fulcrum Electrum WebSocket connections. No centralized RPC choke-points."
  - **Open Source Transparency**: "Inspect every line of code on GitHub. No closed backdoors, no telemetry trackers."

---

### Section 5: FAQ Accordion
- **Q1: What makes Cham Wallet different from MetaMask or Phantom?**
  - *A*: "Most Web3 wallets are locked to a single chain family (EVM or Solana) and rely on centralized bridge contracts for cross-chain activity. Cham Wallet brings native Bitcoin Cash CashTokens together with EVM and Solana through peer-to-peer intent resolution and unified multi-chain key derivation."
- **Q2: Does Cham Wallet hold my private keys?**
  - *A*: "Never. Cham Wallet is 100% self-custodial. Your keys are generated locally from your BIP-39 seed phrase and encrypted strictly on your device. We have no servers, no databases, and zero access to your funds."
- **Q3: What platforms can I run Cham Wallet on today?**
  - *A*: "Today, Cham Wallet runs natively as a Web Wallet inside the trading dApp, and as an Alpha Chromium Extension (Chrome, Brave, Edge). The mobile app (Expo / React Native) is currently in active development."
- **Q4: How do intent swaps work without bridges?**
  - *A*: "Instead of depositing funds into a multisig bridge vault, you sign an intent expressing your desired trade. Solvers compete in Dutch Auctions to fill your order directly, unlocking settlement via atomic covenants. If an order isn't filled, your funds remain securely in your wallet."

---

### Section 6: Final Download Banner
- **Heading**: `Ready to experience true intent-based self-custody?`
- **Subtitle**: `Join the Cham Wallet alpha today on Chrome or launch directly in your browser.`
- **Buttons**: `Get Chrome Extension` • `Launch Web App`
