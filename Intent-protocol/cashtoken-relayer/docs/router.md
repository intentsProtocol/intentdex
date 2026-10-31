# CashToken Relayer: Cauldron Router

The Router (`CauldronRouter.ts`) is the intelligence engine. It receives the `AuctionSolution` and determines the most profitable path to fulfill it, utilizing `CauldronPoolCache` (a synchronized cache of Cauldron DEX liquidity pools).

## Supported Route Types

1. **`DIRECT`**: The relayer already holds the required tokens in its own inventory. It fulfills the covenant directly. (Zero slippage, highest profit).
2. **`BCH_TO_TOKEN`**: The relayer uses its BCH to swap for the required tokens on Cauldron DEX, then fills the covenant.
3. **`TOKEN_TO_BCH`**: The relayer fills the covenant with BCH, receives tokens from the user, and immediately swaps those tokens back to BCH on Cauldron DEX.
4. **`INVENTORY_TO_TOKEN`**: A 2-hop route. The relayer sells a different token it holds for BCH, then uses that BCH to buy the required token.
5. **`TOKEN_TO_TOKEN`**: A 2-hop route. The user wants Token B, and is selling Token A. The relayer swaps A→BCH, then BCH→B.

## Fee Estimation
The router accurately estimates TX byte size based on the number of AMM pools required to route the swap (`estimateCauldronTxFee`) and the exact size of the covenant fill (`estimateFillTxFee`), ensuring zero "failed-due-to-fees" transactions.
