# CashToken Relayer: The Solver

The Solver (`DutchAuctionSolver.ts` / `LimitOrderSolver.ts`) evaluates the constraints of the covenant to determine the *exact current price* required to unlock the UTXO.

For **Limit Orders**, the price is fixed.
For **Dutch Auctions**, the price decays linearly over time.

## Dutch Auction Price Calculation
The Dutch Auction covenant uses introspection (`tx.locktime`) to verify the elapsed time. The Solver replicates this math off-chain:
```typescript
const elapsed = currentTime - startTime;
const priceDrop = startBuyAmount - endBuyAmount;
const dropAmount = (priceDrop * elapsed) / duration;
const currentPrice = startBuyAmount - dropAmount;
```
The solver returns an `AuctionSolution` which includes the `currentPrice` and the specific UTXO parameters.

## Dutch Auction Scheduler
The relayer employs a `DutchAuctionScheduler.ts` which uses "patience logic". It projects the profit curve into the future. If waiting 60 more seconds will yield a significantly higher profit margin because the price drops faster than the AMM slippage, the scheduler will **defer** the fill to a later cycle.
