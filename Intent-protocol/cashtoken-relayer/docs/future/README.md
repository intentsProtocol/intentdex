# Future Architecture: Multi-Solver, Partial Fills, TWAP

**Added:** 2026-07-04

This folder is forward-looking analysis, not implemented code. It answers four questions about where the CashToken Relayer goes next:

1. [**Multi-Solver Architecture**](./01-multi-solver-architecture.md) — how multiple independent solvers can compete for the same shared order book, and what changes (or doesn't) as a result.
2. [**Concurrent Fill Races**](./02-concurrent-fill-races.md) — the specific question: *what happens if two solvers try to fill the same order at the same time?*
3. [**Partial Order Fills**](./03-partial-order-fills.md) — why they don't exist today, what a real on-chain design looks like, and a pragmatic path that ships without touching the covenants.
4. [**TWAP Orders**](./04-twap-orders.md) — same tradeoff: an orchestration-layer version that works today with zero contract changes, and what a true on-chain version would need.
5. [**Additional Considerations**](./05-additional-considerations.md) — everything adjacent that fell out of this analysis: stuck-order reconciliation, frontend-fee wiring, solver liquidity aggregation tiers, MEV exposure, monitoring.

## One important, easy-to-miss fact that shapes all four

This repo's own docs (`contracts-bch-swap/README.md`, `COVENANT_ARCHITECTURE.md`) describe Bitcoin Cash's "Bounded Loops (`OP_BEGIN`/`OP_UNTIL`)" as a **future** 2026 upgrade. **It already activated** — the "Layla" network upgrade went live **2026-05-15**, more than seven weeks before this document was written, and shipped four CHIPs: Loops (`OP_BEGIN`/`OP_UNTIL`), Pay-to-Script (standardized P2S outputs), Functions (`OP_DEFINE`/`OP_INVOKE`), and Bitwise operations.

That means the on-chain building blocks for real partial fills and on-chain TWAP tranching — which the existing project docs treat as "not possible yet" — are live on mainnet today. The recommendations in this folder are written with that in mind. (Worth a follow-up: `contracts-bch-swap/README.md` and `COVENANT_ARCHITECTURE.md` should be updated to stop describing Layla as forthcoming.)

## How this relates to the already-decided product direction

This isn't the first time multi-solver competition has been discussed for this protocol — prior architecture notes (not part of this repo, kept in the team's working context) already establish the intended model, which this analysis builds on rather than replaces:

- The relayer's `/intent/create` + `/intents` HTTP API is meant to function as a **shared intent pool** — any number of independently-operated solvers watch it and race to fill profitable orders. This is the same shape as CoW Protocol / UniswapX / 1inch Fusion's resolver model. Today, this repo's own bot loop is the only solver actually running against that pool, but the API was never meant to be solver-exclusive.
- Discovery is HTTP-based today; the intended next step is a decentralized intent-gossip layer (Nostr was specifically named as the leading candidate) so no single relayer is a point of failure for order discovery.
- **Covenant-enforced frontend fees** are part of the plan: a frontend can require an extra covenant output paying itself a commission, and any solver that fills the order is cryptographically forced to pay it. `LimitOrderSwapWithFee.cash` / `DutchAuctionSwapWithFee.cash` already exist in `contracts-bch-swap/contracts/` for exactly this, but — see `05-additional-considerations.md` — the relayer's execution engine doesn't wire them up yet.
- **Solver competition is the intended answer to "won't a solver just wait for the best price?"** With one solver, yes, they could wait out a Dutch Auction's decay for maximum profit. With several competing solvers watching the same pool, waiting means losing the fill to someone willing to take a smaller margin sooner. This is the same dynamic covered in `02-concurrent-fill-races.md`.
