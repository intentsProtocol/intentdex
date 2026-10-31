# CashToken Relayer: Unfilled Orders Lifecycle

Not every intent submitted to the relayer ends up getting filled. The bot handles several scenarios where an order remains unfulfilled. This document outlines exactly what happens to those orders, how expiry works, and the trustless refund mechanism.

> **Limit Orders can now also be cancelled early by the maker** — see [§3a below](#3a-maker-initiated-early-cancellation-cancelearly--limit-orders-only). This section otherwise describes the original post-expiry-only `cancel()` mechanism, which still applies to Dutch Auctions and is still the fallback for Limit Orders if the maker never cancels early.

## 1. Lack of Profitability (Margin Too Low)
The most common reason an order goes unfilled is that it's simply not profitable.
- During every cycle, the relayer calculates the exact `currentPrice` required to unlock the UTXO.
- It queries the `CauldronPoolCache` for the slippage.
- If the projected profit fails the `ProfitPolicy` (e.g., falls below `PROFIT_MIN_SATS` or `PROFIT_MIN_BPS`), the solver logs `[SKIP] Margin too low`.
- **What happens:** The bot simply ignores the UTXO for this cycle. Because the price on a Dutch Auction drops over time, an unprofitable order might *become* profitable later in its lifecycle. The bot will naturally pick it up once the math flips in its favor.

## 2. Expiry and the MTP (Median Time Past) Lag
Intents (both **Limit Orders** and **Dutch Auctions**) are created with a specific `duration` or `expiryTime`. However, the Bitcoin Cash network evaluates time using Median Time Past (MTP) to prevent block timestamp manipulation.
- MTP typically lags real wall-clock time by about **2 hours**.
- Because the covenant's `cancel()` function relies on `tx.time >= expiryTime`, the cancel function **cannot be invoked until MTP catches up to the expiry time**.
- **What happens:** The solver intentionally does *not* mark an order as "expired" strictly at the real wall-clock expiry time. Since `cancel()` is locked out by the MTP lag, the `fill()` function technically remains open (as the executor can still use a valid past `tx.locktime`). The relayer leaves the order active in the off-chance a massive price swing makes it profitable during that ~2-hour MTP lag window.

## 3. Trustless Refunds (`cancel()`)
If a Limit Order or Dutch Auction has truly expired *and* the network MTP has caught up, the covenant's `cancel()` branch unlocks.
- **Trustless:** Anyone can trigger the `cancel()` function, not just the original maker.
- **Refund Guarantee:** The `cancel()` branch explicitly enforces that the locked funds are sent directly back to the original `makerPkh`. It is impossible to steal the funds.
- **Execution:** The Relayer includes executor logic to construct this `cancel()` transaction (`contract.unlock.cancel()`). When triggered, the relayer pays the minuscule miner fee to broadcast the transaction, returning the unsold tokens/BCH back to the user, and records the `refundTxid`.

## 3a. Maker-Initiated Early Cancellation (`cancelEarly()` — Limit Orders only)

Waiting for expiry (plus the MTP lag above) is a long time to be stuck if a maker simply changes their mind or the market moves against them. As of 2026-07-04, `LimitOrderSwap.cash` has a second exit path: `cancelEarly(pubkey makerPk, sig makerSig)`, authorized purely by the maker's own signature, with **no time constraint at all**.

- **Maker-only**: only the holder of the private key behind `makerPkh` can invoke it — not the relayer, not a resolver, not anyone else.
- **Same refund guarantee as `cancel()`**: the covenant still enforces that funds return to the maker's own address for the full `sellAmount`, even though the maker is authorizing their own spend — a defense-in-depth measure against a buggy client.
- **Maker builds/broadcasts it themselves**: the relayer never holds maker keys. The frontend's `cancelSameChainOrder()` (in `BCHSwapContext.tsx`) reconstructs the covenant client-side and calls `contract.unlock.cancelEarly(...)` directly, exactly the way it already builds the funding transaction.
- **`POST /intent/:id/cancel`**: after broadcasting, the maker's client notifies the relayer with the txid. The relayer independently verifies the claim on-chain (checks the covenant is now spent, and that the payout shape matches a legitimate cancel) before marking the intent `cancelled` and removing it from the watch list — it does not just trust the client's claim.
- **Dutch Auctions are NOT covered** — only `cancel()` (post-auction-end, permissionless) exists for `DutchAuctionSwap.cash`. This was a deliberate scope decision; see [`contracts-bch-swap/docs/limit-order-early-cancel.md`](../../contracts-bch-swap/docs/limit-order-early-cancel.md) for the full rationale and security test coverage.

## 4. Unfunded or Stale Intents
Sometimes users create an intent in the database but fail to broadcast the actual on-chain funding transaction, leaving a "ghost" intent.
- **What happens:** The scanner searches the blockchain for UTXOs matching the intent's `contractAddress`. If 0 UTXOs are found, the intent is essentially dead weight.
- **Cleanup:** To prevent the `intents.json` store from bloating with stale records, the protocol includes a manual garbage collection script (`cleanup-unfunded-intents.mjs`). 
- Running `node cleanup-unfunded-intents.mjs` scans the intent registry, identifies any `pending` intents that have absolutely zero associated UTXOs on-chain, and permanently marks them as `cancelled` (with `cancelReason: 'unfunded-cleanup'`).
