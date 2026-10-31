# Page Sections & Component Blueprints
**Cham Wallet Web Landing Page (`wallet.<domain>`)**

---

## 1. Page Section Map & Visual Hierarchy

```
[ Top Scroll Progress Bar (Neon Gradient 2px) ]
[ Section 0: Sticky Liquid-Glass Header (Cham Mark + Tone Picker + Language + CTA) ]
[ Section 1: Hero Showcase (Hero Copy + Cham Mascot + 3D Interactive Phone + Screen Switcher) ]
[ Section 2: Bento Grid Overview ("Designed for Everything You Do On-Chain") ]
[ Section 3: Multi-Chain Arc & Interactive Portfolio (BCH + Solana + EVM + Movement) ]
[ Section 4: Features Matrix Bento (Pure-JS Architecture + CashTokens + Fast Execution) ]
[ Section 5: Institutional-Grade Security & Cryptography ]
[ Section 6: Interactive Liquid-Glass FAQ Accordion ]
[ Section 7: Final Conversion Banner & Download Platform Modal ]
[ Section 8: Minimal Developer & Ecosystem Footer ]
```

---

## 2. Component Specifications

### Section 0: Sticky Liquid-Glass Header (`Header.tsx`)
- **Visuals**: Suspended pill or edge-to-edge navbar with `.lg-panel` backdrop blur, subtle bottom border (`border-white/10`).
- **Elements**:
  1. **Brand**: Square Cham mascot mark (`/logos/wallets/main.svg`), "Cham Wallet" in `Space Grotesk` font, "ALPHA" badge in emerald pill.
  2. **Navigation Links**: Overview, Multi-Chain, Features, Security, FAQ.
  3. **Tone Switcher Widget**: Miniature row of the 8 Cham swatch dots; clicking immediately updates `--cham-tone`.
  4. **Language Selector**: Compact dropdown (EN, ES, ZH, JA).
  5. **CTA Button**: "Open Web Wallet" (links to trading app) and "Download" button (triggers modal).

---

### Section 1: Hero Showcase (`WalletHero.tsx`)
- **Visuals**:
  - Deep obsidian `#050505` with dual ambient radial glows (`animate-pulse-glow`) matching current Cham tone.
  - Sub-surface noise grain (`.grainy`).
- **Left Column: Typography & Conversion**:
  - Badge: "NATIVE CASHTOKENS & DECENTRALIZED INTENTS"
  - Display Title:
    ```
    ONE WALLET.
    EVERY INTENT.
    ZERO BRIDGES.
    ```
  - Sub-headline: "The self-custody multi-chain wallet built for Bitcoin Cash, EVM, and Solana. Swap native assets with Dutch Auction covenants, hold CashTokens, and stay completely in control."
  - Primary CTA Group:
    - [Download Extension (Chrome Alpha)] - prominent liquid glass button with Cham tone glow.
    - [Launch Web Wallet] - outline button with border sheen.
  - Interactive Cham Companion: Floating SVG Chameleon (`<Chameleon />`) on a branch whose eye follows the mouse pointer.
- **Right Column: 3D Interactive Phone Model (`WalletPhoneModel.tsx`)**:
  - Sleek titanium bezel, dynamic reflection sheen, speaker notch / dynamic island.
  - **Screen Switcher Tabs**: [Swap Intent] | [Portfolio & Tokens] | [Security Keys]
  - **Live Screen Renderer (`WalletFlowScreens.tsx`)**:
    - *Screen 1 (Swap Intent)*: Live input (BCH → SOL / USDC), live Dutch Auction solver matching countdown, estimated route.
    - *Screen 2 (Portfolio & Tokens)*: Native BCH balance, CashTokens list, token icons, verified badges.
    - *Screen 3 (Security)*: Non-custodial key confirmation, P2SH covenant status, Electrum Fulcrum green indicator.

---

### Section 2: Bento Grid Overview (`WalletBentoOverview.tsx`)
Uniswap / Apple-inspired Bento layout highlighting key product pillars:
- **Card 1 (Large - 2 cols)**: **Bridge-less Intent Swaps** — Visual animation of solvers competing to fill orders via Dutch Auctions.
- **Card 2 (1 col)**: **CashTokens Native** — First-class Layer-1 token balances, metadata, and token transfers without smart contract complexity.
- **Card 3 (1 col)**: **Cham Pure-JS Core** — Zero-WASM, instant startup, ultra-lightweight client-side speed.
- **Card 4 (2 cols)**: **Multi-Chain Portfolios** — Track BCH, Solana, Ethereum, Base, and Movement in a unified single seed phrase view.

---

### Section 3: Multi-Chain Arc & Interactive Portfolio (`WalletChainsArc.tsx`)
- **Visuals**: Curved interactive chain selector orbiting a central Cham device display.
- **Supported Chains Illustrated**:
  - **Bitcoin Cash (BCH)**: Native UTXO & CashTokens
  - **Solana (SOL)**: High-speed SPL transfers & USDC
  - **Ethereum (ETH)**: Core smart contract security
  - **Movement (MOVE)**: Next-gen Move-EVM execution
  - **Base & Arbitrum**: Fast L2 micro-settlements
- **Interactivity**: Clicking any chain highlights network details, avg block time, transaction fee (< $0.001 on BCH), and sample assets.

---

### Section 4: Features Matrix Bento (`WalletFeaturesBento.tsx`)
- **Features Highlighted**:
  1. *Electrum Mesh Network*: Redundant WebSocket connections to Fulcrum nodes for zero-downtime balance lookups.
  2. *SIGHASH_UTXOS Signing*: Safe intent authorization without revealing private keys.
  3. *Customizable Wallet Looks*: 8 personality colors stored locally per account.
  4. *Privacy First*: Zero telemetry, zero analytics tracking, local encryption only.

---

### Section 5: Institutional-Grade Security (`WalletSecuritySection.tsx`)
- **Visuals**: Dark obsidian vault motif with cryptographic shield icons and interactive code snippets.
- **Key Points**:
  - Local Keystore encryption with PBKDF2 + AES-GCM.
  - Dual BIP-44 Derivation paths (`145'` standard & `0'` legacy).
  - Verifiable open-source codebase on GitHub.
  - Transparent Alpha disclosure and community audit timeline.

---

### Section 6: Interactive FAQ Accordion (`WalletFAQ.tsx`)
- **Visuals**: `.lg-well` containers with smooth spring-animated height expansion via Framer Motion.
- **Key Questions Answered**:
  - Is Cham Wallet non-custodial?
  - What are CashTokens and how does Cham Wallet support them?
  - How do intent-based swaps differ from traditional bridge swaps?
  - Where can I install the extension and mobile app?
  - Is Cham Wallet safe to use with mainnet funds?

---

### Section 7: Final Conversion Banner & Download Modal (`WalletDownloadBanner.tsx` & `WalletDownloadModal.tsx`)
- **Banner**: Full-width morphic gradient banner with Cham mascot celebrating with tongue flick (`mood="happy"`).
- **Download Modal**:
  - **Chrome Extension**: Direct download / Chrome store link (Alpha release).
  - **Web Application**: "Open in Browser" button linking to trading dApp.
  - **Mobile (iOS / Android)**: "In Development" badge with waitlist notification signup.
