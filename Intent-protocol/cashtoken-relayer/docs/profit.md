# CashToken Relayer: Profit System

Before any route is executed, it must pass the stringent checks of the **Profit Policy** (`src/bot/ProfitPolicy.ts`).

> **A quote is only executed if it passes ALL 3 thresholds simultaneously.**

The thresholds are configured globally in `.env`:
1. **`PROFIT_MIN_SATS` (Floor)**: The absolute minimum profit in satoshis (default: 1500). Ensures the bot doesn't work for dust and covers minor fee miscalculations.
2. **`PROFIT_MIN_BPS` (Margin)**: The minimum profit margin in Basis Points (default: 30 bps = 0.3%). Ensures capital efficiency.
3. **`MAX_SLIPPAGE_BPS` (Slippage)**: The maximum allowed slippage against the Cauldron AMM (default: 500 bps = 5%). Prevents the bot from wrecking itself against illiquid pools.

```typescript
// Router logic calculation example
const profit = tradeValue - requiredCovenantPayout - networkFees - swapFees;
const effectiveBps = (profit / tradeValue) * 10000;
```

---

## 1. How to Adjust the Current Profit Policy

You have two ways to adjust the relayer's profit mechanisms:

### Method A: Global Adjustments via `.env`
If you want to quickly increase or decrease the global profit targets, modify these variables in your `.env` file and restart the bot:
```env
PROFIT_MIN_SATS=3000   # Raise the absolute floor to 3000 sats (~$0.006)
PROFIT_MIN_BPS=50      # Raise the minimum margin to 0.5%
MAX_SLIPPAGE_BPS=300   # Tighten slippage tolerance to 3%
```

### Method B: Per-Token Overrides via `PROFIT_POLICY_FILE`
If you want granular control (e.g., lower margins for stablecoins, higher margins for volatile memecoins), you can use the `PROFIT_POLICY_FILE`.

1. Create a file named `profit_overrides.json`:
```json
{
  "minAbsoluteSats": 1500,
  "minBps": 50,
  "perToken": {
    "dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b": {
      "minBps": 10,
      "maxSlippageBps": 100
    }
  }
}
```
*In this example, the global minimum is 50 bps, but the PUSD stablecoin (`dfe5...`) only requires 10 bps because it has zero volatility risk.*
2. Add `PROFIT_POLICY_FILE=./profit_overrides.json` to your `.env` file.

---

## 2. Suggested Profit Mechanisms (Architecture Upgrades)

If you want to upgrade the bot's architecture beyond simple `BPS` and `SATS` floors, here are some advanced profit mechanisms you could implement:

### A. Volatility-Adjusted Margins
**How it works:** Instead of hardcoding BPS per token, the bot dynamically queries the Cauldron DEX for the 24-hour price volatility of the token.
- **Low Volatility:** Demands a 15 bps profit.
- **High Volatility (Memecoins):** Demands a 200 bps profit to act as an insurance premium against the price dropping between the time the bot sends the transaction and the time the block is mined.

### B. Route-Specific Discounts (Inventory Hedging)
**How it works:** The relayer charges different profit margins based on the *Route Type* it takes.
- `BCH_TO_TOKEN` (Cauldron Route): Requires 50 bps, because the bot has to pay Cauldron swap fees and suffer slippage.
- `DIRECT` (Inventory Route): Requires only 10 bps. Because the bot is selling its own tokens, there is zero slippage and no Cauldron swap fee. The bot can pass those savings on to the user, making it hyper-competitive against other relayers.

### C. Flat "Gas-Relay" Fee Model
**How it works:** Used for micro-transactions or high-frequency intent fulfillment.
- Instead of taking a percentage (`minBps`), the bot takes a strictly fixed fee (e.g., `4,000 sats flat`) regardless of the trade size.
- This acts like a standard Web3 "Gas Relayer" where the user just pays a fixed convenience fee for not having to pay their own gas.

### D. Dutch Auction Time-Decay Maximization
**How it works:** When users create Dutch Auctions, the price of the asset slowly decays in favor of the solver over time.
- Right now, the bot fills the intent *the moment* it hits the `minBps` threshold.
- **Upgrade:** The bot evaluates if there are competing relayers in the mempool. If the mempool is quiet, the bot intentionally waits and lets the Dutch Auction decay further, maximizing its profit margin to 100 bps or 200 bps before finally executing the fill.

---

## 3. Address for Profit & Segregation

By default, profit naturally accrues as BCH in the relayer's operating wallet. However, the relayer supports **Profit Segregation**.

> Use `RELAYER_PROFIT_ADDRESS` in `.env` to route profits to a cold storage or operational treasury wallet automatically.

### How Segregation Works (`DutchAuctionExecutor.ts` & `CauldronRouter.ts`):
When the executor performs the final step of a trade (e.g., returning change back to the solver), the router intercepts the payout rules and splits the change.

```typescript
// Split satChange into [operating change, profit slice]
const { profitSlice, operatingChange } = splitProfit(satChange, predictedProfit, !!this.profitLockingBytecode);

// 1. Send the profit slice to the cold wallet
if (profitSlice > 0n && this.profitLockingBytecode) {
    tb.addOutput({ to: this.profitLockingBytecode, amount: profitSlice });
}

// 2. Send the remaining BCH back to the operating wallet
if (operatingChange > 546n) {
    tb.addOutput({ to: p2pkhLockingBytecode, amount: operatingChange });
}
```

## The Profit Ledger (`ProfitLedger.ts`)
The bot maintains a `ProfitLedger` that snapshots the Electrum UTXO balance before a trade, and compares it to the balance after the trade. It logs the delta between `Predicted Profit` (from the quote) and `Realized Profit` (what actually landed in the wallet), ensuring the AMM math perfectly matches the network reality.
