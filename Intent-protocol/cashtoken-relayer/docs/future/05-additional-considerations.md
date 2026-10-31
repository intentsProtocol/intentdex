# Additional Considerations

**Added:** 2026-07-04

Everything else that surfaced while analyzing multi-solver, partial fills, and TWAP, that's worth tracking even though none of it was explicitly asked for.

## 1. Frontend fees aren't wired up yet, and multi-solver makes that more urgent

`contracts-bch-swap/contracts/LimitOrderSwapWithFee.cash` and `DutchAuctionSwapWithFee.cash` already exist — they add a third required output paying a fixed fee to a `feePkh` (a frontend's address), enforced by the covenant, so any solver who fills the order is cryptographically forced to pay it. This is the intended monetization path for frontends that don't want to run their own solver: they bake their fee into the covenant, and it's collected regardless of *which* solver fills it.

**Gap**: `src/index.ts` only loads and creates the plain `LimitOrderSwap`/`DutchAuctionSwap` artifacts — `WithFee` variants aren't reachable via `POST /intent/create` at all today, and `CauldronRouter.ts`/`DutchAuctionExecutor.ts` don't know how to construct the extra fee output even if they were. This matters more once multiple solvers exist: a frontend fee only works as "free money for the frontend" if *every* solver correctly includes that output — meaning any independent solver implementation (not just this repo's) needs to know how to detect a `WithFee`-shaped covenant and add the required fee output, or they'll simply be unable to fill those orders (the covenant will reject a fill missing the fee output). Worth documenting the `WithFee` fill requirements clearly for third-party solver implementers before this becomes a real integration, not just an unused contract sitting in the repo.

## 2. Solver liquidity aggregation — where this stands today vs. the intended end state

The intended architecture for solver-side liquidity sourcing (not part of this repo's shipped code, but part of the established plan) is three-tiered:
1. **Native pools** (not yet built) — solver-owned inventory with zero routing premium.
2. **External DEX aggregation** (Cauldron today; other BCH DEXs later) — "emergency suction," costs an AMM fee + slippage.
3. **Cross-chain sources** (future, tied to the separate ZK/STARK settlement work) — out of scope for this relayer.

What's actually shipped in this repo today is: `DIRECT` route (tier 1, but only opportunistic — whatever the solver happens to already hold from prior fills, not a deliberately-managed pool) and Cauldron routing (tier 2, fully built: `BCH_TO_TOKEN`/`TOKEN_TO_BCH`/`TOKEN_TO_TOKEN`/`INVENTORY_TO_TOKEN` in `CauldronRouter.ts`). There's no deliberate inventory-management layer that decides "should I hold more PUSD right now to enable more DIRECT fills" — it's purely incidental. That's a real, separate piece of future work (an inventory rebalancing job) that would directly increase DIRECT-route eligibility and reduce reliance on the "all-or-nothing Cauldron UTXO consumption" bottleneck already flagged in `MILESTONES.md`.

## 3. MEV / front-running exposure on BCH

Much smaller concern than on Ethereum — BCH doesn't have the equivalent of a public, pre-confirmation mempool auction market (no Flashbots-style MEV infrastructure in wide use), and transaction ordering isn't typically monetized the way it is on EVM chains. That said, it's not literally zero: a miner *could* in principle see a profitable fill transaction in their own mempool and choose to include a competing transaction of their own first (they'd need their own resolver key and a correct output structure — nothing stops a miner from *also* being a solver). Given BCH's actual mining landscape, this is a much lower practical risk than the same question would be for a high-value Ethereum intent system, but it's not a proof, just a "the incentive/infrastructure to do this doesn't really exist today" observation. Doesn't change any of the recommendations in `02-concurrent-fill-races.md` — this is just the same UTXO-race dynamic with a miner as one of the racers instead of an ordinary solver.

## 4. Stuck-order reconciliation (cross-referenced from `02-concurrent-fill-races.md`)

Worth restating here because it's useful independent of multi-solver: today, if a covenant's UTXO disappears from a scan without this bot's own code marking it `filled`/`refunded`/`cancelled`, the stored intent is simply never updated again — no periodic job checks "did something else happen to this address." This should be built regardless of whether a second solver ever exists, since it can also happen from: a maker manually building their own `cancel()`/`cancelEarly()` transaction without notifying the relayer (the covenant doesn't require them to), an operator manually sweeping an expired covenant, or any future integration this relayer doesn't control. See `02-concurrent-fill-races.md` for the concrete reconciliation design.

## 5. Solver bonding / reputation — probably premature

Some intent protocols require solvers to post a bond that's slashed for provable bad behavior (the EVM side of this project's cross-chain work already considered this — see `02-concurrent-fill-races.md`'s reference to "commit-before-send with bond/slash" for the cross-chain double-fill scenario). For the *same-chain* relayer specifically, there's no equivalent need: the covenant already makes fund theft or maker short-changing impossible regardless of solver behavior, and a lost race costs a solver at most a stranded pre-fill trade (their own money, held as their own inventory, not lost). The only "bad behavior" a bond would discourage here is wasteful competition (many solvers repeatedly pre-filling and losing), which is better addressed by the soft-reservation idea in `02-concurrent-fill-races.md` if it ever becomes a real problem, not by bonding — bonding adds real friction (capital lockup) for a same-chain risk that's already just wasted gas-equivalent, not lost principal.

## 6. Batch operations

Natural product follow-ons once single-order create/cancel are solid (both shipped this session): batch-cancel (cancel N orders in one UI action — mechanically just N calls to the existing `POST /intent/:id/cancel`, no new endpoint strictly required, though a dedicated batch endpoint would save round-trips), and batch-create (place a grid of limit orders at different price points in one action — same relationship to `POST /intent/create` that TWAP's tranche-splitting has, see `04-twap-orders.md`). Low priority relative to everything else in this folder, but cheap to build once there's demand, since neither needs contract changes.

## 7. Monitoring and alerting

Not covered by anything shipped this session beyond `/router/metrics` (predicted-vs-realized profit) and `/health` (basic liveness). Once running multiple solvers, or even just one solver at real mainnet volume, the operationally useful things to alert on: repeated `MAX_CONSECUTIVE_FAILURES` gives-up events (signals a genuinely stuck order, or a solver capital problem), a widening gap between predicted and realized profit in `ProfitLedger` (signals the quote model drifting from reality — the concurrency-testing session already found a real instance of this, see `STATUS.md`), and low solver wallet balance relative to open intent value (signals capital exhaustion before it causes a wave of failed fills). None of this exists today; it's a reasonable next milestone once the system is handling real order flow rather than test traffic.
