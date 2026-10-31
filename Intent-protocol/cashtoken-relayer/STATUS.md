# CashToken Relayer — Implementation Status

**Last updated:** 2026-07-06

## ✅ Mainnet-launch validation pass (2026-07-06)

Full pre-launch test sweep for the same-chain launch — all green:
49/49 contract security tests, contract unit suites, `test:concurrency`/`test:policy`/`test:scheduler`/`test:quant`,
live chipnet e2e limit-order fund→fill (`81282d80…c32a`), live cancelEarly e2e 9/9 (`0d2a7d80…b98e`).
Artifacts verified byte-identical across repos and against a fresh `cashc@0.12.1` compile.
`test:quant`'s slippage-monotonicity assertion now tolerates sat-rounding noise at dust trade
sizes (a 1-sat ceil on a ~275-sat trade is ~36bps — measurement artifact, not a curve bug).

**Deployment steps + env template + canary plan:** [`docs/mainnet-launch-runbook.md`](docs/mainnet-launch-runbook.md).
Found during the sweep: the deployed chipnet relayer URL (`cashtoken-relayer.up.railway.app`)
returns Railway 404 — needs redeploy alongside the new mainnet instance.

This document tracks what's implemented, tested, and verified in the CashToken Relayer (same-chain BCH ⇄ CashToken Limit Order / Dutch Auction solver), and what's still open ahead of mainnet.

## ✅ Core Protocol

| Feature | Status | Notes |
|---|---|---|
| Limit Order covenant (`LimitOrderSwap.cash`) | ✅ Done | Fixed-price fill, post-expiry `cancel()`, maker-initiated `cancelEarly()` (new — see below) |
| Dutch Auction covenant (`DutchAuctionSwap.cash`) | ✅ Done | Linear price decay, post-auction `cancel()` |
| Scanner → Solver → Router → Executor pipeline | ✅ Done | See `docs/overview.md`, `docs/solver-flow.md` |
| Cauldron AMM routing (DIRECT / BCH_TO_TOKEN / TOKEN_TO_BCH / TOKEN_TO_TOKEN / INVENTORY_TO_TOKEN) | ✅ Done | `src/bot/CauldronRouter.ts` |
| Profit policy (floor sats + bps + max slippage, per-token overrides) | ✅ Done | `src/bot/ProfitPolicy.ts`, `docs/profit.md` |
| Profit segregation (`RELAYER_PROFIT_ADDRESS`) | ✅ Done | On-chain split of predicted profit into a separate address every fill |
| Profit ledger (predicted vs. realized) | ✅ Done | `src/bot/ProfitLedger.ts` |
| Trustless post-expiry refund (`cancel()`) | ✅ Done | Documented in `docs/unfilled-orders.md`; MTP-lag-aware |
| REST API + Swagger + WebSocket order events | ✅ Done | `/intent/create`, `/intents`, `/intent/:id`, `/router/*`, `/health`, `/ws` |

## ✅ New: Maker-Initiated Early Cancellation (2026-07-04)

Previously, a Limit Order or Dutch Auction could only be reclaimed by the maker **after expiry** (plus the ~2h MTP lag) — there was no way to back out of an unfilled order early, on-chain or in the frontend. Fixed for **Limit Orders only** (by design — see rationale below):

- **Contract**: `LimitOrderSwap.cash` gained a `cancelEarly(pubkey makerPk, sig makerSig)` branch — maker-signed, no time constraint. Output constraints mirror `cancel()` exactly (funds must return to the maker's own address for the full `sellAmount`), so even a buggy client can't misdirect or short-change the refund. Full design + security rationale: [`contracts-bch-swap/docs/limit-order-early-cancel.md`](../contracts-bch-swap/docs/limit-order-early-cancel.md).
- **Security testing**: 13 new adversarial tests (`test/LimitOrderCancelEarly.security.test.ts` in `contracts-bch-swap`) — only the maker can invoke it, refunds can't be redirected/short-changed/mis-categorized. All 36 pre-existing security tests re-verified passing against the rebuilt artifact (no regression to `fill()`/`cancel()`).
- **Relayer**: `POST /intent/:id/cancel` — the maker builds/signs/broadcasts the `cancelEarly()` spend themselves (relayer never touches maker keys); the endpoint independently verifies the broadcast tx (matches the known covenant outpoint when known, checks the covenant is now empty, checks output[0] pays the maker their full `sellAmount`) before marking the intent `cancelled` and removing it from the watch list.
- **Frontend**: "Cancel" button on open Limit Orders in `LimitOrderHistory.tsx` / `BCHOrderTracker.tsx`, wired through `cancelSameChainOrder()` in `BCHSwapContext.tsx`. **WDK (internal) wallet only for now** — external wallets (Cashonize/WalletConnect) aren't wired up because covenant-unlock signing isn't something the generic `bch_signTransaction` dummy-unlocker path supports the way plain P2PKH funding is (see code comment in `BCHSwapContext.tsx`).
- **Live e2e-verified** (9/9 checks, `test/e2e_cancel_early.ts`, `npm run test:cancel-early`): create → fund → broadcast `cancelEarly()` → relayer verifies → order book shows `cancelled` → covenant empty → double-cancel rejected (409) → Dutch Auction cancel rejected (400).
- **Dutch Auctions intentionally excluded** — per product decision, only `cancel()` (post-auction, permissionless) exists there. Tracked as a possible future milestone if wanted (see MILESTONES.md).

## ✅ New: Concurrency — Bounded-Parallel Fill Execution (2026-07-04)

The bot loop previously processed matched intents **fully serially** — one `for` loop, one fill pipeline at a time, each involving up to 3 sequential on-chain steps with mempool waits up to 60s each. At real mainnet scale (many simultaneous orders), this meant a single scan cycle could take many minutes, with no visibility into *why* an order was still unfilled.

- **`src/bot/UtxoReservation.ts`** (new) — reserves a solver-wallet outpoint the instant it's selected as a trade input, synchronously, before any broadcast. Every coin-selection call site in `DutchAuctionExecutor.ts` and `CauldronRouter.ts` filters candidates through it and reserves the moment it picks one.
- **`SOLVER_CONCURRENCY`** env var (default `4`) — the bot loop now processes that many matched intents in parallel per scan cycle via a small worker-pool (`mapWithConcurrency`).
- **Router-pause fix**: `/router/pause` previously only gated the pre-fill/rebalance steps — a DIRECT-route fill (no pre-fill trade) would still execute while "paused". Now gates the fill step too, matching its documented behavior as an emergency stop.
- **Skip-reason observability**: unfilled `pending`/`active` intents now carry `lastSkipCategory` (`unprofitable_spread` | `slippage_too_high` | `insufficient_capital` | `no_pool` | `quote_error` | `other`), `lastSkipReason`, `lastSkipAt` — exposed via `/intent/:id` and `/intents` — so the frontend can eventually show *why* an order hasn't filled instead of a bare "pending".
- **Retry resilience**: a single execution failure (broadcast race, transient Electrum hiccup) no longer permanently kills an order. `markIntentFailed` now retries up to `MAX_CONSECUTIVE_FAILURES` (5) times before giving up and removing the address from the watch list — important under concurrency, where an occasional broadcast collision is expected, not fatal.

### Two real bugs found (and fixed) by actually running this live, at scale

This is the value of the live `e2e_concurrent_orders.ts` test — it surfaced problems that code review and offline unit tests would not have caught:

**1. A genuine broadcast race in `executePrefill()`.** The first live run (6 simultaneous profitable orders) showed `executePrefill()`'s Cauldron-routed fills using a `solverUtxos` snapshot captured **before** `quote()`/`markIntentActive()` — several `await`s earlier. Concurrent tasks that reached that point within milliseconds of each other all saw the same, not-yet-reserved BCH UTXOs and tried to spend them in conflicting transactions — 5 of 6 orders failed with "rejected by network rules" (a double-spend-shaped broadcast rejection), only 1 filled.

*Root cause & fix*: the reservation model is only race-safe when the fetch-and-reserve happens as one synchronous unit *immediately* adjacent to the actual coin selection — not when a stale snapshot is threaded through several `await` points first. The post-fill rebalance path already did this correctly (fetches fresh right before `executeRebalance`); the pre-fill path didn't. Fixed by refetching immediately before `executePrefill` too.

**2. A permanent-failure-on-transient-error bug.** Before the fix above, the 5 raced-out orders were marked permanently `failed` by a single broadcast rejection and stopped being watched entirely — with no way to recover short of manually restoring `pending` status. Fixed: `markIntentFailed` now retries up to `MAX_CONSECUTIVE_FAILURES` (5) times before giving up, since under concurrency an occasional broadcast collision is expected, not fatal.

**3. An architectural finding, not a bug: Cauldron-routed trades are "all-or-nothing" UTXO consumers.** After fixing the race, a second live run still only completed 2/6 orders within the test's 5-minute window — but investigation showed this was **not** a code defect. `CauldronRouter.ts`'s `executePrefill`/`executeRebalance` pass **every** currently-unreserved pure-BCH UTXO to CashLab's `createTradeTx` as trade inputs (a pre-existing design choice, not something this session changed) — so a single Cauldron-routed fill consumes the solver's *entire* spendable BCH balance in one transaction, leaving nothing for any other concurrent Cauldron fill until that trade's own change output confirms. The live test wallet also happened to hold its ~43 tBCH as a single UTXO (fragmented instead into ~30 small CashToken-dust UTXOs from prior test runs) — the worst case for this pattern. After fanning that single UTXO out into several, all 6 orders filled correctly with 6 distinct `fillTxid`s and zero collisions — just serialized (one Cauldron trade completing before the next could start), rather than truly parallel.

**Net effect**: `UtxoReservation` correctly prevents any double-spend or fund-safety issue regardless of this pattern — verified by 6/6 clean fills. But real concurrent *throughput* for Cauldron-routed routes (`BCH_TO_TOKEN`/`TOKEN_TO_BCH`/`TOKEN_TO_TOKEN`/`INVENTORY_TO_TOKEN`) is currently capped at ~1-in-flight-at-a-time by this "use everything" coin selection, no matter how high `SOLVER_CONCURRENCY` is set or how many BCH UTXOs the wallet holds when fragmented arbitrarily. `DIRECT` (inventory) fills via `DutchAuctionExecutor.execute()`, which select a bounded 1-2 UTXOs precisely, do NOT have this limitation and parallelize correctly today. Making Cauldron routes select a bounded, sufficient subset of BCH UTXOs (rather than the entire balance) is tracked as a follow-up milestone — see MILESTONES.md. It's flagged rather than fixed in this pass because it touches trade-construction/coin-selection logic that deserves its own careful design and test pass, not a rushed change to money-moving code.

This is exactly the kind of finding the concurrency work was meant to surface before mainnet, not after.

## 🧪 Test Coverage

| Suite | Type | What it proves |
|---|---|---|
| `test/concurrency_sanity.ts` (`npm run test:concurrency`) | Fast, offline, no chain | `UtxoReservation` race-safety at 20-25-way contention: no double-claim, capital-exhaustion handled gracefully, exact-fit contention succeeds for all |
| `test/e2e_cancel_early.ts` (`npm run test:cancel-early`) | Live chipnet | Full early-cancel lifecycle, 9/9 checks incl. negative cases |
| `test/e2e_concurrent_orders.ts` (`npm run test:concurrent-orders`) | Live chipnet | 6 simultaneous profitable orders — all 6 filled, 6 distinct fillTxids, zero collisions after the race fix + adequate BCH fragmentation (see finding #3 above; the test's fixed 5-min timeout can under-report if the wallet's BCH is under-fragmented, since Cauldron routes currently serialize — this is expected given finding #3, not a test flake) |
| Pre-existing suites (`test:limit`, `test:dutch`, `test:multi`, `test:unfilled`, `test:relayer`, `test:router`, etc.) | Live chipnet | Unchanged behavior — re-verified against this branch |
| `contracts-bch-swap` adversarial suites (`npm run test:security`) | Fast, offline VM | 49 tests across `fill()`, `cancel()`, `cancelEarly()` for both contracts |

## ⚠️ Known Gaps / Follow-ups

- **External-wallet early cancel** — Cashonize/WalletConnect users can't use the new Cancel button yet (WDK wallet only). See MILESTONES.md.
- **`ProfitLedger` measurement precision under concurrency** — realized-profit snapshots can include another in-flight fill's change landing in the same wallet between the two balance snapshots. Cosmetic/measurement-only, not a fund-safety issue.
- **`MAX_CONSECUTIVE_FAILURES` has no backoff/jitter** — 5 immediate retries in a row on a truly broken order will still burn 5 cycles before giving up. Fine at current `SLEEP_MS`, worth revisiting if cycle time drops much further.
- **Scanner is still sequential** (`for (const addr of addresses) await provider.getUtxos(addr)`) — with 100+ watched addresses this adds up per cycle. Not fixed in this pass; lower priority than the fill-execution concurrency since it doesn't block correctness, only adds latency.
- See MILESTONES.md for the full forward-looking roadmap.
