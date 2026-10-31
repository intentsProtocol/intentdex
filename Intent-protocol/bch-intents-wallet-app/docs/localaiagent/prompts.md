# Local AI Agent Prompt Bank

This document contains a comprehensive collection of tested prompt examples for the **BCH Intents Local AI Wallet Assistant**. These prompts showcase what the on-device agent can execute entirely offline, what is deferred until back online, how it handles underfunded accounts with the "Top Up" flow, and its support for multilingual requests (English & Swahili).

> [!NOTE]
> **Understanding Mesh vs CashTokens**:
> **Mesh** is the liquidity protocol (**Mesh V4** decentralized automated market maker on Bitcoin Cash), **not a token ticker**. Mesh positions deploy liquidity into discrete logarithmic price bins for CashTokens against BCH. In the examples below, real CashTokens from Chipnet testnet (`PUSDTEST`, `FLDCH`, `CMINTB`) and Mainnet (`PUSD`, `MUSD`, `FURU`) are used as the traded assets paired with BCH.

---

## 1. Portfolio & Holdings Inquiries (100% Offline)

These queries read directly from the encrypted on-device `WalletSnapshot`. They provide instant answers about current balances, held tokens, active Mesh liquidity positions, and transaction history without contacting any remote server or exposing addresses.

| # | Prompt | Expected Tool | Result / Action |
|---|---|---|---|
| 1 | `What do I hold?` | `wallet_balance` | Displays portfolio card with network breakdown and USD valuations |
| 2 | `Show my balances` | `wallet_balance` | Shows all native tokens and CashTokens across BCH, EVM, Solana, and BTC |
| 3 | `What is my BCH balance?` | `wallet_balance` | Pinpoints BCH holdings with timestamp of last known balance snapshot |
| 4 | `Show my mesh positions` | `my_positions` | Displays active Mesh V4 LP positions, category, bin counts, and price ranges |
| 5 | `Do I have any open liquidity positions?` | `my_positions` | Inspects wallet NFTs for decoded Mesh commitments |
| 6 | `Show recent transactions` | `recent_activity` | Renders list of recent sends, receives, swaps, and intent executions |
| 7 | `Show my recent activity` | `recent_activity` | Shows status badges (`confirmed`, `pending`, `failed`) from local activity store |

---

## 2. Swaps & Token Exchanges (Offline Planning → Online Execution)

The agent resolves token tickers, parses amount words or percentages, detects the optimal swap route, and generates an actionable **Swap Draft**. If internet is unavailable, the draft waits in the outbox; when back online, it fetches a fresh quote and prompts for PIN authorization.

| # | Prompt | Route / Product | Offline Draft Behavior |
|---|---|---|---|
| 8 | `Swap 0.01 BCH for PUSDTEST` | `cashtoken` (Dutch auction) | Creates CashToken intent draft on BCH Chipnet |
| 9 | `Trade half my BCH to PUSD` | `cashtoken` | Resolves 50% of available BCH balance into base satoshis on Mainnet |
| 10 | `Sell 100 PUSDTEST for BCH` | `cashtoken` | Prepares sell order from held PUSDTEST tokens |
| 11 | `Buy FLDCH with 0.05 BCH` | `cashtoken` | Inverts natural language to sell BCH and receive FLDCH tokens |
| 12 | `Exchange 25% of my BCH into FURU` | `cashtoken` | Calculates 25% allocation and creates CashToken swap draft |
| 13 | `Convert all my BCH to PUSDTEST` | `cashtoken` | Allocates full available BCH balance into swap draft |
| 14 | `Bridge 10 USDC to base` | `cctp` (Circle CCTP) | Detects cross-chain USDC intent to Base chain |
| 15 | `Move 20 USDC on arbitrum to optimism` | `cctp` (Circle CCTP) | Cross-chain transfer between Arbitrum and OP Mainnet/Sepolia |
| 16 | `Send all my USDC on base to ethereum` | `cctp` (Circle CCTP) | Resolves all USDC on Base and prepares CCTP burn/mint |
| 17 | `Swap 1 SOL for USDC` | `jupiter` (Solana Mainnet) | Prepares Solana DEX routing via Jupiter integration |

---

## 3. Mesh Liquidity Strategies (All 6 Archetypes)

The local AI uses mathematical price-grid calculations to design automated liquidity positions based on user goals, budget, and risk parameters.

### A. Accumulate Ladder (Buy Dips)
*Places bid bins at geometric intervals below market price to automatically buy tokens if the price drops.*

| # | Prompt | Style | Behavior |
|---|---|---|---|
| 18 | `Accumulate PUSDTEST with 0.1 BCH` | `accumulate` | Designs 10-bin bid ladder below current market price |
| 19 | `Keep accumulating PUSDTEST cheaply with a quarter of my BCH` | `accumulate` | Resolves 25% BCH budget, sets `bidask` shape with heavier bids at lower prices |
| 20 | `Create an accumulate ladder for FLDCH with 0.05 BCH at low risk` | `accumulate` | Concentrates bins closer to market price (10% reach) |
| 21 | `Buy dips on PUSD using 0.2 BCH` | `accumulate` | Generates deposit layout and bin counts |

### B. Take-Profit Ladder (Sell Rises)
*Places ask bins at geometric intervals above market price to automatically take profit as the token surges.*

| # | Prompt | Style | Behavior |
|---|---|---|---|
| 22 | `Take profit on PUSDTEST with half my tokens` | `take-profit` | Allocates 50% of held PUSDTEST into selling bins above market |
| 23 | `Take profit on FLDCH with 500 FLDCH` | `take-profit` | Sets ask bins up to +30% to +60% depending on risk level |
| 24 | `Sell high on PUSD using all my tokens at high risk` | `take-profit` | Wide range reach (+60%) for parabolic upside capture |

### C. Range Liquidity (Two-Sided Spot Market Making)
*Places symmetric buy bins below and sell bins above market price.*

| # | Prompt | Style | Behavior |
|---|---|---|---|
| 25 | `Create a range strategy on PUSDTEST with 0.2 BCH` | `range` | Splits range across bids and asks around market price |
| 26 | `Provide liquidity for PUSDTEST with 0.5 BCH` | `range` | Calculates bin step bps and splits BCH deposit evenly |
| 27 | `Market make PUSD with 0.1 BCH at low risk` | `market-make` | Tight curve shape concentrating liquidity near mid-price |

### D. Peg Keeper (Stable Pairs)
*Ultra-tight liquidity band to maintain parity.*

| # | Prompt | Style | Behavior |
|---|---|---|---|
| 28 | `Keep peg on PUSD with 0.5 BCH` | `peg` | Tight 0.5%–1% range around current price with curve weighting |

### E. Single-Sided Limit Orders
*Executes an atomic limit order on the Mesh price grid at a specific price target.*

| # | Prompt | Style | Behavior |
|---|---|---|---|
| 29 | `Limit buy PUSDTEST at 0.0001 BCH with 0.05 BCH` | `limit` | Sets 1 target bin at exact 0.0001 BCH price level |
| 30 | `Limit order buy FLDCH at 0.0002 with 0.1 BCH` | `limit` | Maps price to discrete log-grid index and builds draft |

---

## 4. Underfunded Scenarios & "Top Up" Flow

Unlike traditional wallets that abort or error out when a user has insufficient funds, **BCH Intents Local AI allows strategies and swaps to be fully generated and configured**, identifying exactly how much is missing and presenting a **"Top Up"** action.

| # | Prompt | Wallet State | Behavior |
|---|---|---|---|
| 31 | `Accumulate PUSDTEST with 0.5 BCH` | BCH Balance: 0.01 BCH | Draft is created! Shows: `Top Up Required: Missing 0.49 BCH` with a direct **Top Up** button linking to Receive |
| 32 | `Swap 1 BCH for PUSDTEST` | BCH Balance: 0 BCH | Swap draft is created! Indicates insufficient funds with a one-tap **Top Up** button |
| 33 | `Take profit on PUSDTEST with 500 PUSDTEST` | Token Balance: 0 | Generates the take-profit ladder geometry and prompts the user to deposit tokens |
| 34 | `Range strategy on FLDCH with 2 BCH` | BCH Balance: 0.1 BCH | Prepares bin distribution and marks draft as underfunded with needed satoshis |

---

## 5. DeFi Loans & Collateral Planning (Offline Calculation)

Calculates safe borrowing capacity, Loan-To-Value (LTV) ratios, and liquidation prices using native BTC collateral models.

| # | Prompt | Expected Tool | Result / Action |
|---|---|---|---|
| 35 | `How much USDC could I borrow on my BTC safely?` | `plan_loan` | Calculates 40% LTV borrow amount, liquidation threshold, and health score |
| 36 | `Borrow USDC against 0.1 BTC` | `plan_loan` | Computes USDC loan value based on cached BTC price |
| 37 | `What is my liquidation price if I borrow 5000 USDC on 0.2 BTC?` | `plan_loan` | Simulates liquidation price level and health gauge |
| 38 | `Can I borrow USDC against half my Bitcoin?` | `plan_loan` | Uses 50% of held BTC to model loan terms |

---

## 6. Financial Glossary & Concept Explanations (100% Offline)

Instant on-device explanations of decentralized finance mechanics, Dutch auction intents, Mesh positions, and cryptographic self-custody.

| # | Prompt | Topic | Expected Explanation |
|---|---|---|---|
| 39 | `Explain dutch auction` | `dutch-auction` | Explains how Dutch auction intents start at a ceiling price and decay until matched by solvers |
| 40 | `What is an intent?` | `intent` | Clarifies how intent-based architecture lets users declare desired outcomes rather than managing raw transactions |
| 41 | `Explain mesh positions` | `mesh-position` | Explains Mesh V4 price-grid liquidity NFTs, bins, and non-custodial automated market making |
| 42 | `What are bins?` | `bins` | Explains discrete logarithmic price buckets on the Bitcoin Cash price grid |
| 43 | `What is LTV?` | `ltv` | Defines Loan-To-Value ratio and margin buffers |
| 44 | `Explain liquidation` | `liquidation` | Describes collateral liquidation triggers and health factor maintenance |
| 45 | `Explain CCTP` | `cctp` | Explains Circle's Cross-Chain Transfer Protocol for native 1:1 cross-chain USDC bridging |
| 46 | `Explain offline mode` | `offline` | Explains how local QVAC models and snapshot caches allow DeFi strategy design without internet |
| 47 | `Explain self custody` | `self-custody` | Explains private key sovereignty, worklet isolation, and why the local model never sees keys |

---

## 7. Multilingual & Swahili Prompts (Kiswahili)

Full natural language understanding for regional African users and localized hackathon requirements.

| # | Prompt (Kiswahili) | English Equivalent | Action |
|---|---|---|---|
| 48 | `Salio langu ni kiasi gani?` | What is my balance? | Calls `wallet_balance` |
| 49 | `Nipangie kubadilisha 0.01 BCH kuwa PUSDTEST` | Swap 0.01 BCH for PUSDTEST | Calls `plan_swap` |
| 50 | `Badilisha nusu ya BCH yangu kuwa PUSD` | Swap half my BCH for PUSD | Resolves Swahili fraction `nusu` (half) |
| 51 | `Weka robo ya BCH yangu kwenye ladder ya PUSDTEST` | Put a quarter of my BCH into PUSDTEST ladder | Resolves Swahili fraction `robo` (quarter) and calls `plan_strategy` |
| 52 | `Nionyeshe miamala ya hivi karibuni` | Show recent transactions | Calls `recent_activity` |
| 53 | `Nieleze kuhusu dutch auction` | Explain dutch auction | Calls `explain` with `dutch-auction` |
| 54 | `Nieleze kuhusu self custody` | Explain self custody | Calls `explain` with `self-custody` |

---

## 8. Summary of Offline vs. Online Capabilities

```
┌──────────────────────────────────────────────────────────────────┐
│                      WHAT RUNS OFFLINE                           │
├──────────────────────────────────────────────────────────────────┤
│  ✔ On-device QVAC inference (Qwen3 1.7B / 0.6B)                 │
│  ✔ Quick regex intent engine (0ms instant execution)             │
│  ✔ Portfolio & balance review from cached snapshots              │
│  ✔ Mesh liquidity position decoding & inspection                 │
│  ✔ Mesh ladder / take-profit / range / limit strategy planning   │
│  ✔ Underfunded strategy creation with Top Up calculation         │
│  ✔ Swap intent preparation & product routing                     │
│  ✔ BTC loan LTV & liquidation mathematics                        │
│  ✔ Complete financial glossary & explanations                   │
│  ✔ Encrypted thread & outbox persistence in Secure Keystore      │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼ Requires Internet Connection
┌──────────────────────────────────────────────────────────────────┐
│                      WHAT NEEDS NETWORK                          │
├──────────────────────────────────────────────────────────────────┤
│  ▲ Live real-time quote refresh from solvers                     │
│  ▲ Live Cauldron pool price discovery                            │
│  ▲ Broadcast of Dutch-auction intents to solver relayers         │
│  ▲ Mesh server position preview & category genesis registration  │
│  ▲ On-chain transaction broadcasting via Electrum/RPC            │
│  ▲ Worklet PIN/Biometric authorization and transaction signing   │
└──────────────────────────────────────────────────────────────────┘
```

