# Intent Discovery & Queueing — Findings and Plan

Status: proposal · Measured 2026-07-29 against live chipnet relayer (port 3006, 85 open intents)

## 1. How the server groups intents today

**It doesn't.** There is no grouping, no funded/unfunded distinction, and no lifecycle
state beyond the `StoredIntent.status` string.

Discovery is one flat list scanned end to end:

```
ENV.WATCH_ADDRESSES: string[]          // config.ts:22 — one flat array
KNOWN_AUCTIONS:      DutchAuctionIntent[]   // registry.ts:23 — flat
KNOWN_LIMIT_ORDERS:  LimitOrderIntent[]     // registry.ts:24 — flat

botLoop()                              // index.ts:1201
  └─ scanner.scanAddresses()           // scanner.ts:35 — serial `for` over ALL addresses
       └─ provider.getUtxos(addr)      // one Electrum round-trip each
  └─ mapWithConcurrency(utxos, 4, processMatchedUtxo)
  └─ sleep(SLEEP_MS)
```

**How the solver "knows" an intent is funded:** it doesn't know — it re-derives it every
cycle. `getUtxos(addr)` returning a non-empty array *is* the funding signal. An address
that was never funded is indistinguishable from one funded a second ago, so both cost the
same full Electrum round-trip, forever.

**Address lifecycle** — added in two places, removed in three:

| Event | Effect on watch list | Location |
|---|---|---|
| `POST /intent/create` | added | index.ts:645 |
| startup rehydrate | re-added for **every** `pending` intent, no age or funding check | index.ts:850 |
| filled / refunded | removed | index.ts:1383 |
| maker cancels | removed | index.ts:796 |
| 5 consecutive failures | removed | index.ts:1350 |
| **never funded** | **never removed** | — |

That last row is the leak. There is no path by which an intent that was created and never
funded ever leaves the scan set, and `rehydrateRegistry()` faithfully restores all of them
on every restart.

## 2. Measured cost

From `test/bench_fill_latency.ts` and a 5-minute live observation:

| Measurement | Value |
|---|---|
| Open intents | 85 |
| **Never funded** (no UTXO, never evaluated) | **79 (93%)** — median age **66.5 days**, oldest **154 days** |
| Actually evaluated by the solver | 6 |
| `getUtxos` via `ElectrumNetworkProvider` | **1,143 ms** |
| `listunspent` on a warm persistent socket | **229 ms** |
| Serial sweep, 85 addresses | **97.9 s** |
| Observed solver re-evaluation cadence | **71.5 s** (with `SLEEP_MS=2000`) |
| Fills in 5 min | 0 |

93% of every scan cycle is spent asking a server about covenants that have been empty for
two months.

## 3. Root causes — three independent problems

### 3.1 Connection churn — 80% of per-call cost

`ElectrumNetworkProvider.performRequest()` opens and closes the socket around every
request unless `manualConnectionManagement` is set:

```js
if (this.shouldConnect()) await this.electrum.connect();      // concurrentRequests === 0
try { result = await this.electrum.request(name, ...params); }
finally { if (this.shouldDisconnect()) await this.electrum.disconnect(); }  // === 1
```

The relayer constructs the provider with defaults (`index.ts:129`), so
`manualConnectionManagement === false`. In a **serial** loop `concurrentRequests` is always
0 → 1 → 0, meaning a full TCP+TLS handshake per address.

- request itself: **229 ms**
- observed per call: **1,143 ms**
- **~914 ms (80%) is pure connection setup/teardown**

This also explains the parallel sweep being 71× faster (1.37 s for 85): concurrency keeps
`concurrentRequests > 0`, so only the first call connects and the last disconnects. And it
is the most likely driver of the known "disconnected server" wedge — thousands of
connect/disconnect cycles an hour against Fulcrum.

### 3.2 Serial iteration

`scanner.ts:35` is a plain `for` loop. Bounded-concurrency (8) measured **30×** faster,
full parallel **71×** faster.

### 3.3 No lifecycle partition, no GC

Funded and unfunded intents get identical treatment despite needing opposite strategies:

- **Unfunded** — state changes exactly once (when funding lands). Polling is pure waste;
  this is an *event*.
- **Funded but not yet fillable** — profitability genuinely changes over time (Dutch decay,
  pool drift), so it *does* need periodic re-evaluation — but re-quoting is CPU against a
  cached pool set, not an Electrum call per address.

## 4. Best-practice research — what the stack already supports

**Verified live against chipnet (`chipnet.bch.ninja`, Fulcrum 2.1.1, protocol 1.6):**

| Capability | Result |
|---|---|
| `blockchain.address.subscribe` | ✅ supported, 233 ms to subscribe |
| `blockchain.address.transaction.subscribe` | ❌ `Unsupported request` |
| Bulk subscribe, 60 covenant addresses, one socket | ✅ **463 ms total** |
| Push notifications delivered | ✅ `notification` events fire |
| Auto-resubscribe after reconnect | ✅ `ElectrumClient.resubscribeOnConnect` |

`@electrum-cash/network` (already a transitive dependency via cashscript) exposes
`subscribe()` / `unsubscribe()` and an EventEmitter `notification` channel. CashScript's
provider accepts an injected client via `new ElectrumNetworkProvider(net, { electrum })`,
so one shared, persistent, subscribed client can back both discovery *and* all existing
`getUtxos` / `sendRawTransaction` calls.

**This means funding detection can be push-based today, with no new dependency.**
Subscribing 85 addresses costs ~0.5 s once, versus 98 s every single cycle.

Standard patterns this maps onto:
- **Event-driven discovery with a reconciliation sweep** — trust push, but run an
  infrequent full sweep to heal missed notifications (never trust push alone).
- **State-partitioned work sets** — separate "waiting for an external event" from
  "actively being worked", and give each its own cadence.
- **TTL/reaper on pending work** — anything awaiting an external event needs a deadline.
- **Deduplicated priority queue + bounded worker pool** — an address already queued or
  in flight must never be enqueued twice.

## 5. Plan

### Phase 0 — Stop the bleeding (low risk, immediate)

Independent of the architecture work, ships in isolation.

1. **Persistent Electrum connection.** Construct one `ElectrumClient` per network, pass it
   into `ElectrumNetworkProvider` via `{ electrum }`, set
   `manualConnectionManagement: true`, and `connect()` once at startup with reconnect
   handling. Expected: 1,143 ms → ~230 ms per call (**5×**), and likely resolves the
   "disconnected server" wedge.
2. **Parallelize `Scanner.scanAddresses()`** with bounded concurrency (8). Expected: 98 s →
   ~3 s, and combined with (1), well under 1 s.
3. **Reap never-funded intents.** Mark `pending` intents with no UTXO after a funding
   deadline as `abandoned`; drop them from `WATCH_ADDRESSES` and the registry. Removes 79
   dead addresses immediately.
4. **Gate `rehydrateRegistry()`** on age + a one-shot funded check so zombies don't return
   on restart.

Phase 0 alone takes time-to-fill from ~100 s to roughly 5 s.

### Phase 1 — Push-based funding detection

5. **`SubscriptionManager`** over the shared client:
   - `watch(address)` → `subscribe('blockchain.address.subscribe', addr)`
   - `unwatch(address)` → `unsubscribe(...)` on any terminal state
   - `notification` handler → resolve address → enqueue
   - re-subscribe the full set on reconnect (client does this, but verify and log)
   - track subscription count; confirm headroom against the production Fulcrum's
     `max_subs` / `max_subs_per_ip` before relying on it at scale
6. **Reconciliation sweep** every 5 min: parallel bounded sweep of all watched addresses to
   catch anything push missed. This is the old scanner, demoted from primary to safety net.
7. **`POST /intent/:id/funded`** — the frontend already broadcasts the funding tx and then
   tells the relayer nothing (`BCHSwapContext.tsx:808`). A hint call makes discovery
   instant and gives a clean signal for the funding deadline.

### Phase 2 — Explicit lifecycle + work queue

8. **Discovery state on `StoredIntent`**, distinct from user-facing `status`:

   | State | Meaning | Cost model |
   |---|---|---|
   | `AWAITING_FUNDING` | created, no UTXO ever seen | subscription only, zero recurring |
   | `FUNDED` | UTXO seen, needs quote/fill | in the work queue |
   | `IN_FLIGHT` | executing | excluded from re-enqueue |
   | `ABANDONED` | funding deadline passed | unsubscribed, dropped |
   | terminal | filled / refunded / cancelled / expired | unsubscribed, dropped |

9. **Work queue** replacing the scan-then-map loop:
   - fed by: subscription notifications, Dutch-decay re-evaluation timers, reconciliation sweep
   - **deduplicated by address** — never enqueue an address already queued or in flight
   - bounded worker pool (`SOLVER_CONCURRENCY`)
   - priority: near-deadline Dutch auctions and high-predicted-profit first
   - bounded length with backpressure
10. **Re-evaluation timers for funded-but-unfillable orders.** A funded Dutch auction whose
    profit is below floor should be re-checked on a schedule derived from its decay curve
    (when it will cross the floor), not by brute-force rescanning. Pool-driven repricing
    piggybacks on the 30 s pool cache refresh.

### Sequencing

Phase 0 is independent and worth shipping first — it captures most of the win with the
least risk. Phase 1 depends on Phase 0's shared client. Phase 2 depends on Phase 1's event
feed. Each phase is independently verifiable with `test/bench_fill_latency.ts`.

### Success criteria

| Metric | Now | Target |
|---|---|---|
| Addresses polled per cycle | 85 | 0 (push) + safety sweep every 5 min |
| Per-address Electrum cost | 1,143 ms | ~230 ms |
| Solver re-evaluation cadence | 71.5 s | < 5 s |
| Funding → fill broadcast | ~100 s | < 10 s |
| Never-funded intents in scan set | 79 | 0 |
