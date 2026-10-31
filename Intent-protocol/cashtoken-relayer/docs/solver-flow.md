# CashToken Relayer: The Solver Flow

The "Solver" is the brain of the relayer that translates raw blockchain data into actionable arbitrage math. Here is the step-by-step flow of how the solver operates during each bot cycle.

## 1. UTXO Discovery
The `Scanner` continuously polls the Bitcoin Cash network (via Electrum) for all unspent UTXOs residing at any address in its `WATCH_ADDRESSES` list. When it finds a UTXO, it passes the raw data to the main bot loop.

## 2. Intent Matching
The bot loop takes the UTXO and queries the `intentStore` (backed by `intents.json`) to find the original order parameters that created this specific covenant address.
- It verifies that the UTXO token category matches the intent's `sellToken`.
- If matched, the intent and UTXO are packaged together and handed to the specific solver class (e.g., `DutchAuctionSolver.ts`).

## 3. The Resolution Math
Inside `DutchAuctionSolver.ts`, the solver's primary job is to answer one question: **"Exactly how much BCH (or tokens) do I need to pay right now to unlock this UTXO?"**

Because a Dutch Auction's price drops over time, the solver calculates the linear decay off-chain using the exact same formula the CashScript covenant enforces on-chain via `tx.locktime`.

```typescript
// 1. Calculate how much time has passed since the auction started
const elapsed = currentTime - intent.startTime;

// 2. Calculate the total price difference from start to end
const priceDrop = startBuyAmount - endBuyAmount;

// 3. Pro-rate the drop based on elapsed time vs total duration
const dropAmount = (priceDrop * elapsed) / duration;

// 4. Subtract the drop from the starting price
const currentPrice = startBuyAmount - dropAmount;
```

## 4. The MTP Guard
The solver also enforces network realities. The Bitcoin Cash network uses Median Time Past (MTP) to prevent time manipulation. MTP lags real time by ~2 hours. 
The solver ensures the projected `currentPrice` respects this lag by simulating the locktime requirements of the network, preventing the bot from building invalid transactions (`bad-txns-nonfinal`).

## 5. Yielding the Solution
Finally, the solver packages all this data into an `AuctionSolution` object:
- `currentPrice`: What the relayer must pay.
- `utxo`: The exact UTXO to spend.
- `targetLocktime`: The timestamp the executor must use for the TX.

This `AuctionSolution` is then passed to the `CauldronRouter`, which uses the `currentPrice` to quote the AMM pools and determine if the spread yields a profit.
