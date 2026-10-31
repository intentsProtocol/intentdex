# CashToken Relayer — Mainnet-Readiness Milestones

**Last updated:** 2026-07-04

Forward-looking roadmap. See `STATUS.md` for what's already done and verified.

## Milestone: Limit Order early cancellation — ✅ Shipped 2026-07-04

- [x] `cancelEarly()` covenant branch (Limit Orders only)
- [x] 13 new adversarial security tests + 36 pre-existing tests re-verified
- [x] `POST /intent/:id/cancel` with on-chain verification
- [x] Frontend Cancel button (WDK wallet)
- [x] Live e2e proof (9/9 checks)
- [x] Design doc: `contracts-bch-swap/docs/limit-order-early-cancel.md`

### Follow-up: External-wallet early cancel
Cashonize/WalletConnect users currently can't use the Cancel button — `cancelEarly()` needs a real signature over a custom covenant redeem script, which is a different problem from the plain-P2PKH `getDummyUnlocker` pattern used for funding transactions. Needs its own design pass:
- Investigate whether Cashonize's WC2 `bch_signTransaction` implementation can sign an arbitrary P2SH covenant input given the correct `sourceOutputs` locking bytecode (some CashScript-aware wallets support this properly).
- If not supported generically, the fallback is: maker exports/copies a pre-built unsigned tx + redeem script for manual signing, or the relayer offers a "request early cancel" flow that still ultimately requires an internal-wallet signature.

### Follow-up: Dutch Auction early cancellation
Explicitly out of scope for this milestone per product decision — Dutch Auctions still only support post-auction `cancel()`. If wanted later, do NOT copy-paste the Limit Order design without a fresh review: auction makers have different incentives (the whole mechanism relies on price decay pressure), and any early-cancel path needs the same defense-in-depth adversarial testing this milestone got.

## Milestone: Concurrent fill execution — ✅ Shipped 2026-07-04

- [x] `UtxoReservation.ts` — synchronous claim-on-select for solver-wallet coins
- [x] `SOLVER_CONCURRENCY` bounded-parallel bot loop (default 4)
- [x] `/router/pause` now actually gates all execution (was leaking DIRECT-route fills)
- [x] Skip-reason classification (`lastSkipCategory`/`lastSkipReason`/`lastSkipAt`)
- [x] Transient-failure retry resilience (`MAX_CONSECUTIVE_FAILURES`, was previously a single-strike permanent failure)
- [x] Fast offline race-safety test (`concurrency_sanity.ts`) — 20-25-way contention
- [x] Live e2e proof (`e2e_concurrent_orders.ts`) — found and fixed a real broadcast race in `executePrefill`'s coin selection, and a permanent-failure-on-transient-error bug, during this work (see STATUS.md)

### Follow-up: bounded coin selection for Cauldron-routed trades (found during this milestone, not yet fixed)
`CauldronRouter.ts`'s `executePrefill`/`_executeTwoHopPrefill`/`executeRebalance` currently pass **every** unreserved matching UTXO to CashLab's `createTradeTx` as inputs — a pre-existing design choice, not something introduced by the concurrency work. This means a single Cauldron-routed fill (`BCH_TO_TOKEN`, `TOKEN_TO_BCH`, `TOKEN_TO_TOKEN`, `INVENTORY_TO_TOKEN`) consumes the solver's *entire* spendable balance of that currency in one transaction, capping real concurrent throughput for those routes to ~1-in-flight-at-a-time regardless of `SOLVER_CONCURRENCY` or wallet UTXO fragmentation. `DIRECT` (inventory) fills, which select a bounded 1-2 UTXOs precisely via `DutchAuctionExecutor.execute()`, don't have this limitation.
- **Not a fund-safety issue** — `UtxoReservation` still correctly prevents any double-spend; this is a throughput ceiling, verified live (6/6 orders filled correctly, just serialized rather than parallel — see STATUS.md finding #3).
- **Fix**: change the BCH/token candidate selection in `CauldronRouter.ts` to pick a bounded, sufficient subset (smallest set of UTXOs covering trade cost + fees + a safety margin) instead of the entire balance — freeing the rest for concurrent trades.
- **Why not fixed now**: this touches trade-construction/coin-selection logic for money-moving transactions. It deserves its own design + test pass (proper sizing logic, dust handling, fee re-estimation as the input set shrinks) rather than a rushed change appended to an already-large session.
- **Operational mitigation in the meantime**: keep the solver wallet's BCH split across multiple UTXOs (a periodic "fan-out" maintenance tx, same technique used to unblock the live test) so that a request queue at least has more than one wallet-balance's worth of pure-BCH capital to serialize through per cycle, even before the coin-selection fix lands.

### Follow-up: Scanner concurrency
`Scanner.scanAddresses()` still queries watched addresses one at a time (`for (const addr of addresses) await provider.getUtxos(addr)`). Not a correctness issue, just added latency per cycle at high watch-list counts (100+ addresses). Lower priority than fill-execution concurrency was, since it doesn't block correctness — but worth revisiting once watch-list size grows meaningfully past a few hundred.

### Follow-up: Frontend skip-reason surfacing
The relayer now tracks *why* an order hasn't filled (`lastSkipCategory` etc. on `GET /intent/:id`), but the frontend doesn't display it yet. Next step: `LimitOrderHistory.tsx`/`BCHOrderTracker.tsx` should show something like "queued — waiting for solver liquidity" instead of a bare "Pending" badge when `lastSkipCategory === 'insufficient_capital'`.

### Follow-up: ProfitLedger precision under concurrency
Realized-profit measurement (`ProfitLedger.snapshotBalance` before/after a fill) can be slightly noisy when another concurrent fill's change lands in the same wallet between the two snapshots. This is a measurement-precision tradeoff, not a fund-safety issue — revisit only if the predicted-vs-realized delta metrics become operationally important to get exact.

## Milestone: Profit-margin configuration hygiene — ✅ Shipped 2026-07-04

- [x] `.env.example` now documents every supported env var (`PROFIT_MIN_SATS`, `PROFIT_MIN_BPS`, `MAX_SLIPPAGE_BPS`, `PROFIT_POLICY_FILE`, `RELAYER_PROFIT_ADDRESS`, `FILL_TOKEN_WHITELIST`, `INVENTORY_TOKEN_IDS`, `MAINNET_PRIVATE_KEY_WIF`, `SOLVER_CONCURRENCY`, `PORT`) — previously only 5 of ~13 supported vars were documented, meaning a fresh mainnet deploy would silently inherit chipnet-era defaults.
- [x] `contracts-bch-swap`'s `build` script pinned to `cashc@0.12.1` — the unpinned `npx cashc` was silently resolving to `0.13.2`, which rejects this repo's `pragma cashscript ^0.12.0` and would break a fresh clone's build.

### Follow-up: Mainnet profit-policy review
Before flipping this relayer to mainnet, the actual `PROFIT_MIN_SATS`/`PROFIT_MIN_BPS`/`MAX_SLIPPAGE_BPS` values should be explicitly re-decided rather than left at the chipnet-era defaults (1500 sats / 30 bps / 500 bps). Chipnet defaults were tuned for testing with cheap play-money fees; mainnet transaction fees, real capital risk, and competition from other solvers may warrant different floors. This is a business/ops decision, not a code change — flagging it here so it doesn't get missed.

## Not yet started

- **Scanner concurrency** (see follow-up above)
- **External-wallet early cancel** (see follow-up above)
- **Frontend skip-reason display** (see follow-up above)
- **Dutch Auction early cancellation** (explicitly deferred — see above)
