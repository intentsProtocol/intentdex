# 🦎 Cham Wallet & Intents Protocol
### Self-Custodial Multi-Chain Ecosystem with On-Device AI Financial Agent

Built for the **AI Yako: Own Your AI** Hackathon (Tether × Node NBO Nairobi)  
**Track:** *Agentic Finance with WDK* (400 USDt track prize & 1,500 USDt overall)  
**Repository:** [https://github.com/intentsProtocol/intentdex](https://github.com/intentsProtocol/intentdex)

---

> ### 📢 Note for Hackathon Judges
> **Full Commit History & Chronological Timeline:** See [**DEVELOPMENT_HISTORY.md**](./DEVELOPMENT_HISTORY.md) for the complete, authentic 89-commit development timeline across all modules.
>
> **Primary Evaluation Target:** Please focus your evaluation primarily on **`bch-intents-wallet-app`** (our React Native mobile app powered by **QVAC** on-device AI and **WDK**) alongside **`wdk-wallet-bch`** (the Bitcoin Cash & CashTokens WDK wallet module).
> 
> These represent the core breakthrough engineered during the AI Yako hackathon: enabling users to plan complex multi-bin liquidity strategies, Bitcoin collateralized loans, and cross-chain swaps **100% offline in Airplane Mode**, and then safely sign and broadcast on-chain via WDK upon reconnecting.

---

## 1. Executive Summary & Vision

**Cham Wallet** is an intent-centric, self-custodial wallet ecosystem unified under **Tether’s WDK (Wallet Development Kit)** across Web, Browser Extension, and Mobile. 

During AI Yako, we brought **Tether’s QVAC local AI stack** into the mobile app (`bch-intents-wallet-app`) to create an autonomous on-device financial architect that works **without an active internet connection**.

### ✈️ The "Flight Mode" Scenario: Offline Strategy Planning
Imagine boarding a flight from Nairobi to London with zero in-flight Wi-Fi. In traditional Web3, decentralized applications freeze, balance queries fail, and strategy dashboards won't even load.

With Cham Wallet:
1. **In the Air (100% Offline / Airplane Mode):** You open Cham Wallet and chat naturally with your on-device AI assistant (powered by Tether's **QVAC** running Qwen3 locally on your device's NPU/CPU). The assistant analyzes your encrypted offline portfolio snapshot, models collateralized debt ratios, and designs sophisticated multi-bin liquidity strategies.
2. **Drafted into the Outbox:** The local agent executes mathematical proofs and bin distribution algorithms locally, placing declarative transaction drafts into your secure local **Outbox**.
3. **On Arrival (Back Online):** The moment your wheels touch down and your phone connects to the network, Cham Wallet flags that your actions are ready. You review the exact quote, verify slippage, and authorize transaction execution with your biometric PIN via **Tether WDK**.

Zero cloud surveillance. Zero API subscriptions. Zero key exposure. **Real financial autonomy on hardware you own.**

---

## 2. Core Architecture: Why Intents + AI Are the Perfect Match

### The Intents Protocol: "I want X for my Y"
Traditional decentralized transactions require users to specify *every imperative step*: which router to hit, which pool to swap against, how much gas to set, and what slippage tolerance to calculate. If conditions drift by 0.1%, the transaction reverts and gas is wasted.

Cham Wallet replaces this fragile model with our **Intents Protocol**:
- Instead of coding execution paths, you declare the desired outcome: **"I want X for my Y."**
- *Example:* **"Trade 1,000 USDT on Base for ETH at the best possible rate."**
- The user declares their intent, signs the condition, and off-chain solvers/fillers compete via Dutch auctions to fill the order with optimal execution and zero MEV frontrunning.

### Why Intents Work Naturally with Local AI Agents
Large Language Models are inherently outcome-driven, not execution-driven. When an AI processes human speech, it understands *intent* (*"swap my USDT to ETH"* or *"accumulate dips"*). Because our protocol is intent-native, the local AI agent simply translates conversational nuance into a cryptographically sound intent schema. There is zero risk of the AI mishandling complex smart contract calldata—the solver network takes care of optimal execution while the user’s intent guarantees final price protection.

---

## 3. Mesh Protocol: The Programmable Liquidity Layer

### The Problem with Standard LP Interfaces
Standard automated market maker (AMM) interfaces force liquidity providers into rigid, one-size-fits-all molds: full-range passive distributions (which suffer extreme impermanent loss) or clumsy manual range pickers with arbitrary tick boundaries.

Real liquidity providers and traders want **bespoke, asymmetric strategies**:
- Accumulate dips aggressively without selling on the way down.
- Take profit in staggered ladders across escalating price points.
- Anchor tighter spreads around pegged assets or mean-reverting tokens.

### How Cham Wallet’s Local AI Solves It
Our underlying liquidity engine, **Mesh Protocol**, provides discrete, bin-based concentrated liquidity. Whoever holds the position NFT owns and governs the bins.

Instead of forcing users through dozens of sliders and tick inputs, Cham Wallet’s on-device AI understands personalized strategy prompts and compiles them directly into Mesh V4 grid bytecode:
- **Accumulate Ladder:** *"Keep accumulating PUSDTEST cheaply with a quarter of my BCH."*  
  $\rightarrow$ The AI plans buy-only bins positioned exclusively below today’s market index, laddering bids with exponential or gentle curve weights.
- **Take-Profit Ladder:** *"Take profit on my tokens in 5% increments up to 2x."*  
  $\rightarrow$ The AI plans ask-only bins, automatically converting tokens back into native base assets as prices rise.
- **Dynamic Market Making:** Asymmetric bi-directional liquidity pools with customizable fee bin spreads.

With our pure client-side mathematical planner (`localPlanPosition`), these complex bin arrays, BCMR token registries, and bytecode commitments are calculated **completely offline** without depending on any remote server.

---

## 4. The WDK Ecosystem: One Passphrase, Infinite Surfaces

Cham Wallet started with a foundational mission: make self-custody seamless across platforms using **Tether’s WDK (Wallet Development Kit)**.

We built our technology progressively to meet users wherever they are:
1. **`cham-wallet-web` (Web App):** Browser-based self-custodial interface using WDK for multi-chain asset management and intent execution.
2. **`bch-intents-wallet-extension` (Browser Extension):** Desktop browser extension bringing WDK-powered intent signing and dApp connectivity directly into the browser.
3. **`bch-intents-wallet-app` (Mobile App with QVAC Local AI):** The primary focus of our hackathon submission—combining mobile WDK self-custodial infrastructure with on-device QVAC intelligence.

### Unified by One Passphrase
Thanks to the robust architectural design of Tether WDK, **the exact same passphrase (12-word seed) seamlessly unlocks your wallet across the Web App, Browser Extension, and Mobile App**. 

Your keys, addresses, and multi-chain identities (Bitcoin Cash, EVM, Solana, and Bitcoin) remain identical across all surfaces:
- **Web & Extension:** For active trading desks and desktop dApp connectivity.
- **Mobile App:** For daily mobile life and offline AI strategy planning in your pocket.

### The Strict WDK Security Partition
The AI assistant runs in unprivileged mobile userland and **never has access to your private keys or seed phrase**. It only inspects a sanitized local snapshot of balances. When an intent or Mesh position is drafted, transaction construction and signing execute inside the isolated background worklet (`react-native-bare-kit`) powered by WDK—unlocked solely when you input your biometric PIN via `PinGate`.

---

## 5. Monorepo Structure & Ecosystem Components

| Directory | Role in Ecosystem | Hackathon Focus |
| :--- | :--- | :---: |
| **`bch-intents-wallet-app`** | **Mobile React Native app with QVAC Local AI & WDK.** Offline intent drafting, liquid glass amount editing, and outbox execution. | ⭐ **PRIMARY FOCUS** |
| **`wdk-wallet-bch`** | **Custom Bitcoin Cash & CashTokens WDK wallet module.** Provides UTXO management, CashToken covenant support, and worklet signing. | ⭐ **PRIMARY FOCUS** |
| **`bch-intents-wallet-core`** | **Shared TypeScript logic library.** Houses `localPlanPosition`, agent tools (`tools.ts`), 0ms regex quick intents (`quick.ts`), and snapshot encryption. | ⭐ **CORE LOGIC** |
| **`cham-wallet-web`** | **Web Application.** Original browser dashboard built on WDK allowing shared-passphrase wallet access on desktop. | *Disclosed Reused Work* |
| **`bch-intents-wallet-extension`** | **Chrome/Brave Extension.** Browser extension utilizing WDK for dApp connection and background intent signing. | *Disclosed Reused Work* |
| **`meshprotocol`** | **Mesh Liquidity Protocol & AMM Server.** Indexer and liquidity management service tracking V4 bin states and pool analytics. | *Liquidity Layer* |
| **`arc-cctp/cctp-swap-server`** | **Cross-Chain Bridge Server.** Relayer daemon routing cross-chain USDC intents between EVM (Base/Sepolia) and Bitcoin Cash. | *Bridge Layer* |

---

## 6. How Judges Can Reproduce the Offline Demo

### Prerequisites
- Node.js 20+ (recommended v22+)
- Android device (Android 12+, 6GB+ RAM recommended) or Android Studio Emulator (`arm64-v8a`)

### Setup Instructions
```bash
# 1. Clone repository
git clone https://github.com/intentsProtocol/intentdex.git
cd intentdex/bch-intents-wallet-app

# 2. Install dependencies
npm install

# 3. Synchronize core and bundle WDK worklet
npm run sync
npm run bundle:worklet

# 4. Run automated test suite (100% passing across 167 tests)
npm test

# 5. Build and launch on Android
npm run android
```

*(Alternatively, build standalone release APK: `npm run build:apk` or `./gradlew assembleRelease` in the `android/` directory).*

### Step-by-Step Offline Demonstration:
1. **One-Time Model Download (Online):** Open Cham Wallet on your phone, navigate to the **Agent** tab, and complete the one-tap download of `Qwen3 1.7B` (~1.2 GB). Let the app perform an initial balance sync on Chipnet.
2. **Turn On Airplane Mode (100% Offline):** Switch your device to **Airplane Mode** (disable Wi-Fi and Cellular Data). Notice the agent status chip displays: *"Local AI: On this phone"*.
3. **Offline Balance Inquiries:** Type: *"What do I hold?"*  
   $\rightarrow$ The local AI parses the request and outputs a portfolio card from the local encrypted snapshot.
4. **Offline Mesh Strategy Design:** Type: *"Keep accumulating PUSDTEST cheaply with a quarter of my BCH"*  
   $\rightarrow$ The AI runs `plan_strategy`, calculates bin steps and reserves locally via `localPlanPosition`, and displays an interactive strategy card with a visual bin spectrum and Liquid Glass amount editor.
5. **Offline Loan Modeling:** Type: *"How much USDC could I borrow on my BTC safely?"*  
   $\rightarrow$ The AI invokes `plan_loan`, outputting a loan plan at 40% LTV with liquidation price alerts and a dynamic health gauge.
6. **Underfunded Top-Up Flow:** Type: *"Swap 50 BCH for PUSDTEST"*  
   $\rightarrow$ The agent never fails on low balance; it builds the draft, displays the exact missing satoshis, and shows a 1-tap **Top Up** button linking to the Receive screen.
7. **Reconnection & Safe Signing (Online):** Disable Airplane Mode. Tap **Review and Approve** on your drafted swap or strategy. Enter your PIN via `PinGate`. The transaction is signed inside the isolated WDK worklet and broadcast on-chain with a blockchain explorer receipt link.

---

## 7. Operational Separation: Offline AI vs. Network Actions

| Action | Operational Mode | Justification & Verification |
| :--- | :---: | :--- |
| **Conversational AI & Intent Parsing** | **100% Offline** | Runs locally on-device via `@qvac/sdk` (Qwen3 1.7B). |
| **Portfolio Audit & Balance Inquiries** | **100% Offline** | Loaded from encrypted local snapshot (`WalletSnapshot`). |
| **Mesh V4 Concentrated LP Grid & Bin Allocation** | **100% Offline** | Pure client-side mathematical allocation & BCMR metadata generation. |
| **Loan Collateral & LTV Liquidation Modeling** | **100% Offline** | Modeled locally using deterministic finance formulas (`planLoan`). |
| **Underfunded Deficit Calculation** | **100% Offline** | Computes missing units and top-up requirements locally. |
| **Live Relayer Quotes & Slippage Check** | Network Required | Verifies current Dutch auction depth and filler competition. |
| **On-Chain Transaction Broadcasting** | Network Required | Submits signed transactions to Bitcoin Cash Chipnet/Mainnet miners. |

---

## 8. What Was Built During AI Yako vs. Disclosed Reused Work

### 🛠️ Built During AI Yako (October 24–30, 2026):
1. **QVAC On-Device Integration:** Integrated `@qvac/sdk` 0.22.0 in React Native Bare Kit worker with streaming responses, fit evaluation (`assessModelFit`), and memory lifecycle management.
2. **Deterministic Agent Tool Suite (`bch-intents-wallet-core/src/agent/tools.ts`):** 10 structured tools (`wallet_balance`, `plan_swap`, `plan_strategy`, `plan_loan`, `analyze_history`, `analyze_positions`, `simulate_strategy`).
3. **Pure Client-Side Mesh LP Planner (`localPlanPosition`):** Built offline position planner that generates BCMR registries, bytecode commitments, and bin allocation math on-device without remote server dependence.
4. **Underfunded Draft Engine:** Engineered balance deficit detection and 1-tap Top-Up flows across all tools.
5. **Interactive Liquid Glass Amount Editor:** Developed `<AmountEditor>` on strategy and swap cards with live recalculations and preset chips (`[ 25% | 50% | 75% | MAX ]`).
6. **Zero-Latency Quick Intent Engine (`quick.ts`):** Built instant 0ms regex routing for immediate action matching.
7. **Offline Snapshot Persistence:** Built encrypted portfolio caching on the home screen (`wallet.tsx`) with offline status badges.

### 📦 Disclosed Reused Work:
- Pre-existing multi-chain wallet scaffolding from Cham Wallet Web App (`cham-wallet-web`) and Extension (`bch-intents-wallet-extension`).
- Core Tether WDK integration modules (`@tetherto/wdk`, `@bch-intents/wdk-wallet-bch`, and EVM/Solana/BTC wallet adapters).
- Third-party open-source libraries: `@noble/hashes`, `@noble/curves`, `zustand`, `expo`.
