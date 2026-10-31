# TWAP Orders

**Added:** 2026-07-04

TWAP (Time-Weighted Average Price) means executing a large trade as a series of smaller tranches spread across time, instead of all at once — the standard reason is reducing market impact and avoiding revealing the full order size to the market at once.

## The key insight: this mostly doesn't need a new covenant at all

TWAP is really two things bundled together: (1) splitting an amount into tranches, and (2) gating *when* each tranche becomes executable. This project's existing, unmodified `DutchAuctionSwap.cash` already has a `startTime` constructor parameter that gates `fill()` (`require(currentTime >= startTime)`). **A TWAP schedule is just N Dutch Auctions, each with a different `startTime`, all funded up front.**

Concretely: a maker who wants to sell 1,200 PUSD over 6 hours in 6 tranches doesn't need a new contract — they need the relayer (or the frontend/SDK) to create 6 separate `DutchAuctionSwap` covenants, each for 200 PUSD, with `startTime` staggered an hour apart. The maker funds all 6 in one session (or the frontend batches the funding transactions). Each tranche becomes independently fillable — by any solver — only once its own `startTime` arrives, exactly reproducing "release 1/6th of the order every hour" without touching a single line of the audited contract.

This is the same "orchestration over contract changes" pattern recommended for partial fills in `03-partial-order-fills.md` — and here it's an even better fit, because the *existing* contract already has the one gating primitive (`startTime`) that TWAP actually needs.

## What this orchestration-level version requires

1. **A new relayer endpoint**, e.g. `POST /intent/create-twap`:
   ```json
   {
     "makerAddress": "bitcoincash:...",
     "sellToken": "BCH", "buyToken": "<PUSD category>",
     "totalSellAmount": "1200000000", "totalBuyAmount": "1200",
     "tranches": 6,
     "intervalSeconds": 3600,
     "auctionDurationSeconds": 300
   }
   ```
   Internally: compute `sellAmount = totalSellAmount / tranches`, `buyAmount = totalBuyAmount / tranches` (careful with integer division remainder — put it in the first or last tranche, don't silently drop it), and call the existing Dutch Auction creation path `tranches` times with `startTime = now + i * intervalSeconds` for `i in 0..tranches-1`.
2. **A grouping concept in `intentStore.ts`** — right now every `StoredIntent` is independent; a TWAP schedule needs a `twapGroupId` (or similar) so the frontend can show "3 of 6 tranches filled" as one logical order instead of 6 unrelated rows in the order history.
3. **Batched funding UX** — the maker needs to fund 6 covenant addresses, ideally in one flow rather than 6 separate manual steps. This is a frontend/SDK concern (build one transaction with 6 outputs, one per tranche address, instead of 6 separate transactions) — no relayer or contract change needed for this part either, since `TransactionBuilder` already supports multiple outputs in one transaction.
4. **Cancellation semantics** — does cancelling a TWAP schedule cancel all not-yet-filled tranches, or just the next one? This needs a product decision, then a small addition: the early-cancel endpoint (`POST /intent/:id/cancel`, see `docs/unfilled-orders.md` §3a) would need a `POST /intent/twap/:groupId/cancel` sibling that cancels every remaining un-filled tranche in the group. Each tranche is still a Limit Order or Dutch Auction under the hood, so the existing `cancelEarly()` mechanism applies per-tranche with no contract changes — this is purely an API/orchestration convenience on top of what already exists.

None of this touches `LimitOrderSwap.cash` or `DutchAuctionSwap.cash`. It's new relayer/SDK code, not new audit surface.

## What a *true* on-chain TWAP covenant would need (bigger lift, sequence after partial fills)

A single covenant that enforces "at most X released per Y minutes elapsed" — rather than N separate contracts — is really the partial-fill problem (`03-partial-order-fills.md`) plus a schedule check:

```cashscript
// sketch, not a real contract
function fillTranche(pubkey resolverPk, sig resolverSig, int trancheAmount) {
    int elapsed = tx.locktime - startTime;
    int maxReleasedSoFar = (totalAmount * elapsed) / totalDuration;   // linear release schedule
    require(alreadyReleased + trancheAmount <= maxReleasedSoFar);      // can't release faster than schedule allows

    // ... proportional payout checks, same shape as fillPartial() ...
    // ... recursive remainder-covenant output, same requirement as partial fills ...
}
```

This is a strict superset of the partial-fill design — it needs everything partial fills need (the recursive remainder-covenant self-reference) *plus* a running "how much has already been released" state that has to be threaded through each remainder (since a single UTXO can't hold "amount already released" as separate state from "amount remaining" without also encoding it in the constructor params of each successive remainder covenant). This is exactly the kind of iterative, multi-step validation that benefits from the Layla upgrade's bounded loops and reusable functions (see `03-partial-order-fills.md` for why those primitives specifically help) — but it's meaningfully more contract complexity than partial fills alone, because of the added time-schedule state tracking.

**Recommendation**: don't build this before partial fills are solved and audited — it depends on the same recursive-covenant primitive, plus more state, plus its own schedule-manipulation attack surface (e.g. can a resolver manipulate `tx.locktime` — bounded by consensus rules to be within a narrow window of real time — to claim more of the schedule than intended? needs explicit adversarial testing). The orchestration-level version above should be the actual near-term deliverable; it gets makers real TWAP behavior today using contracts that are already live and audited.

## Where TWAP interacts with multi-solver competition

Splitting into tranches has a side benefit for the multi-solver story in `01-multi-solver-architecture.md`/`02-concurrent-fill-races.md`: each tranche is a *separate* covenant, so two solvers racing for "the TWAP order" are actually racing for one specific tranche at a time, not the whole schedule — collisions are naturally scoped to a single (smaller) tranche rather than the full order, which somewhat limits the blast radius of a lost race (a stranded pre-fill trade, if any, is sized to one-sixth of the total rather than the whole thing).
