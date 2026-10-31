# Multi-Solver Architecture

**Added:** 2026-07-04

## What "multi-solver" means here

Today, exactly one process fills the intent pool this relayer creates: `botLoop()` in `src/index.ts`, using one wallet, watching `ENV.WATCH_ADDRESSES`. Multi-solver means: **more than one independent process** — different wallets, potentially different operators, possibly not even running this codebase — all watching the *same* pool of open intents and racing to fill whichever ones they find profitable.

This is not a hypothetical add-on. The covenants (`LimitOrderSwap.cash`, `DutchAuctionSwap.cash`) were written permissionless from day one: `fill()` only checks `checkSig(resolverSig, resolverPk)` against whatever pubkey the caller supplies — there is no allowlist of "approved" resolvers. **Anyone who can build a valid transaction can fill any open order.** The only thing stopping a second solver from competing today is that nobody else happens to be running one against this specific pool.

## What actually needs to change for a second solver to exist

Less than it might seem, because of how cleanly the roles are already separated:

| Component | Shared or per-solver? | Why |
|---|---|---|
| Covenant contracts | **Shared** | Same `LimitOrderSwap.json`/`DutchAuctionSwap.json` artifacts, same address derivation. Any solver reconstructs the exact same contract from the same public order parameters. |
| Intent pool (`/intent/create`, `/intents`, `/intent/:id`) | **Shared** | This relayer's HTTP API is the order book. A second solver doesn't create intents — it *reads* this API (or a future decentralized equivalent) to discover what's open. |
| Scanner → Solver → Router → Executor pipeline | **Per-solver** | Each solver operator runs their own instance of this pipeline (or their own implementation of it) against their own wallet. `src/bot/*.ts` in this repo is one reference implementation, not a required one. |
| `KNOWN_LIMIT_ORDERS` / `KNOWN_AUCTIONS` in-memory registry | **Per-solver** | Each solver populates its own view of "what's open" from whatever discovery source it uses — polling `/intents`, or (later) a gossip feed. |
| Profit policy (`PROFIT_MIN_SATS`/`PROFIT_MIN_BPS`) | **Per-solver** | Each operator sets their own risk tolerance. A more aggressive solver with a tighter margin wins more races; see `02-concurrent-fill-races.md`. |
| Wallet / capital | **Per-solver** | Every solver brings its own inventory. No shared custody, no coordination required for funds. |

The practical path to a second solver today, with zero code changes to this repo, is: someone else stands up their own scanner/solver/executor, points it at `GET https://<this-relayer>/intents` (or their own chain scan of known covenant addresses) to discover open orders, and fills using their own wallet. The covenant doesn't care who they are.

## What gets *harder* with more than one solver

1. **Wasted pre-fill trades.** A `BCH_TO_TOKEN` route (see `CauldronRouter.executePrefill`) buys the target token from Cauldron *before* attempting the actual covenant fill. If a competing solver wins the fill in the gap between our pre-fill trade confirming and our fill broadcast, our pre-fill purchase already happened and cost real Cauldron fees + slippage — for nothing directly, though the tokens land in our own inventory and aren't lost, just not immediately productive. This is a real cost of competition, and it gets more likely as more solvers watch the same pool. See `02-concurrent-fill-races.md` for the existing partial mitigation and remaining gap.
2. **No cross-solver reconciliation.** If our solver loses a race, our own `intents.json` never gets told "someone else filled this" — see the reconciliation gap described in `02-concurrent-fill-races.md` and `05-additional-considerations.md`.
3. **Profit compression.** More solvers racing for the same Dutch Auction decay curve means the auction gets filled earlier (closer to the maker's ask), at a smaller margin per solver — good for makers, worse for any single solver's revenue per fill. This is the intended effect, not a bug (see the README in this folder for the "solver competition is the answer to greedy waiting" argument).
4. **Inventory fragmentation risk compounds.** `MILESTONES.md` already documents that `CauldronRouter.ts`'s Cauldron-routed trades consume a solver's *entire* balance of the relevant currency per trade (not a bounded subset), capping that solver's own internal throughput to ~1-in-flight at a time. That's a per-solver problem, but it means: the more solvers there are, the more the ones running under-fragmented wallets will visibly lose races to the ones who fragmented their capital correctly. Solver-side capital management becomes a real competitive differentiator, not just an internal operations detail.

## Discovery: today vs. later

**Today**: HTTP polling of `/intents`. Works, simple, but the relayer operator is a single point of failure for order *discovery* (not for fund safety — funds are always covenant-enforced regardless of who's watching).

**Planned next step**: decentralized intent gossip, with Nostr as the leading candidate (publish intents as Nostr events; solvers subscribe to relays instead of polling one HTTP endpoint). This removes the discovery single-point-of-failure without touching the trust model at all — the covenant already doesn't care how a solver learned about an order, only that the fill transaction it produces satisfies the contract.

Concretely, moving from "poll `/intents`" to "subscribe to a gossip feed" only touches the **discovery** step of the solver pipeline (`Scanner`/registry population in this repo's terms) — `DutchAuctionSolver.ts`, `CauldronRouter.ts`, and `DutchAuctionExecutor.ts` don't need to know or care where the list of open intents came from.

## Recommended near-term steps (no contract or protocol changes required)

1. **Document the shared-pool contract explicitly** — right now nothing in this repo's docs states that `/intents` is meant to be polled by third-party solvers, or what stability/rate-limit guarantees it offers. Worth a short `docs/solver-integration.md` aimed at an external operator who wants to run a second solver against this pool.
2. **Expose whatever's needed for a competing solver to make good decisions without also being this codebase** — `GET /intents` already returns the parameters needed to reconstruct a covenant. Confirm it's sufficient (sell/buy token, amounts, expiry/duration, contract address) for an independent implementation to solve, quote, and fill without needing anything else from this relayer.
3. **Don't build coordination/reservation infrastructure prematurely.** For a small, cooperative solver set (the near-term reality), the natural UTXO-level race resolution described in `02-concurrent-fill-races.md` is sufficient — it costs nothing to implement (it's just how Bitcoin transactions already work) and loses nothing but occasional wasted pre-fill trades. Build a soft-reservation layer only once there's an actual permissionless solver market causing measurable waste (see that doc for the design if/when it's needed).
