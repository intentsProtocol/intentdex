# Mainnet Launch Runbook — Same-Chain CashToken Swap (Limit Orders + Dutch Auctions)

**Scope:** `cashtoken-relayer` + `contracts-bch-swap` only (same-chain BCH ⇄ CashToken).
Cross-chain / ZK (FRI) flows are explicitly **out of scope** for this launch — the FRI
Phase B-alpha forgeability blocker applies to the cross-chain stack, not this one.
The same-chain covenants use pure introspection; no ZK, no oracle, no relayer custody
of maker funds.

**Validated:** 2026-07-06 (see "Pre-launch test evidence" at the bottom).

---

## Deployment model

One **new, dedicated mainnet relayer instance** alongside the existing chipnet one.
The frontend already expects this split:

- chipnet: `VITE_CASHTOKEN_RELAYER_URL` (default `https://cashtoken-relayer.up.railway.app`)
- mainnet: `VITE_CASHTOKEN_RELAYER_MAINNET_URL` (default `https://cashtoken-relayer-mainnet.up.railway.app`)

Do **not** try to serve both networks from one instance: `RELAYER_PROFIT_ADDRESS` is a
single env var feeding both the chipnet and mainnet executors, so it can only be valid
for one network at a time, and `/router/wallet` only exposes the wallet of the
instance's own network.

> ⚠️ As of 2026-07-06, `https://cashtoken-relayer.up.railway.app/health` returns
> Railway "Application not found" — the chipnet deploy is down or was renamed.
> Re-deploy (or update the frontend default URL) as part of this launch, otherwise
> the chipnet path in production is dead too.

## Step 0 — Code hygiene (before any deploy)

- [ ] Commit both repos. `contracts-bch-swap` (cancelEarly branch, 4 security suites)
      and `cashtoken-relayer` (UtxoReservation, concurrency, cancel endpoint, quant fix)
      are largely **uncommitted working-tree state** right now. Deploy only from a commit.
- [ ] Tag the contract artifacts. `LimitOrderSwap.json` / `DutchAuctionSwap.json` are
      byte-identical across both repos and match a fresh `cashc@0.12.1` compile
      (verified 2026-07-06). Any future contract edit changes every covenant address —
      treat the artifact hash as a release artifact.

## Step 1 — Mainnet solver wallet

- [ ] Generate a **fresh mainnet WIF** (never reuse chipnet keys or keys that have
      touched test machines). This is a hot wallet — fund it only with working capital
      you accept losing to hot-wallet risk.
- [ ] Fund with starting BCH inventory. Start small (suggestion: 0.5–2 BCH) and scale
      with volume.
- [ ] **Fan out the BCH into 4–8 UTXOs** (known throughput ceiling: Cauldron-routed
      fills consume all unreserved pure-BCH UTXOs in one tx — see MILESTONES.md
      "bounded coin selection" follow-up. Fan-out is the operational mitigation).
- [ ] Optionally pre-stock CashToken inventory for DIRECT fills of the tokens you
      whitelist.
- [ ] Create a **separate mainnet profit address** (can be a cold/watch-only key —
      the relayer only sends to it).

## Step 2 — Mainnet env (new Railway service or equivalent)

```env
NETWORK=mainnet
PORT=3006

# Chipnet wallet is still REQUIRED at boot (botLoop initializes it unconditionally).
# Any throwaway chipnet WIF works; it needs no funds on the mainnet instance.
RELAYER_PRIVATE_KEY_WIF=<throwaway-or-existing-chipnet-wif>

# The actual mainnet solver hot wallet:
MAINNET_PRIVATE_KEY_WIF=<fresh-mainnet-wif>

# MUST be a bitcoincash: address on this instance (single var feeds both executors):
RELAYER_PROFIT_ADDRESS=bitcoincash:<profit-address>

# MAINNET token category IDs — the chipnet IDs in the current .env are meaningless
# on mainnet. Leave FILL_TOKEN_WHITELIST unset to auto-populate from live Cauldron
# pools, or pin the launch tokens explicitly (recommended for launch):
FILL_TOKEN_WHITELIST=<mainnet-category-hex,comma-separated>
INVENTORY_TOKEN_IDS=

# Profit policy — RE-DECIDE for mainnet, do not inherit chipnet defaults
# (chipnet-era: 1500 sats / 30 bps / 500 bps; see docs/profit.md).
# Suggested starting point for real fees + real capital risk:
PROFIT_MIN_SATS=3000
PROFIT_MIN_BPS=30
MAX_SLIPPAGE_BPS=300

SOLVER_CONCURRENCY=4
SLEEP_MS=10000
WATCH_ADDRESSES=
```

Notes:
- `intents.json` (the order book) is written to the working directory. On Railway,
  attach a **persistent volume** (or accept that a redeploy forgets open orders —
  maker funds are always safe on-chain regardless; makers can still `cancelEarly()`
  client-side, but the relayer would stop matching forgotten covenants).
- Cauldron mainnet indexer default `https://indexer.riften.net` is live (verified
  2026-07-06). Override with `CAULDRON_INDEXER_URL` if needed.

## Step 3 — Deploy + smoke-check (read-only confidence)

- [ ] Deploy; check `GET /health` → `{"status":"ok","network":"mainnet",...}`.
- [ ] `GET /router/status` → `mainnetPoolCount > 0` (Cauldron cache populated).
- [ ] `POST /router/quote` for BCH→(launch token) with a realistic size — sane number.
- [ ] `GET /router/wallet` → shows the mainnet solver address + fanned-out UTXO count.
- [ ] `POST /router/pause` → leave the router **paused** until step 5.

## Step 4 — Frontend switch

- [ ] Set `VITE_CASHTOKEN_RELAYER_MAINNET_URL` to the deployed URL (or confirm the
      default matches the Railway app name).
- [ ] Verify the wallet network toggle: `executeSameChainSwap` picks the mainnet
      relayer + `network: 'mainnet'` when the WDK wallet is on mainnet (already wired
      in `BCHSwapContext.tsx`).
- [ ] Remember the known limitation: the order-book **Cancel button is WDK-wallet-only**
      (external Cashonize/WalletConnect makers must wait for expiry `cancel()`).
      Consider surfacing that in the UI copy at launch.

## Step 5 — Canary trades with real (small) money

Run these yourself before announcing, with the router resumed:

1. **Limit order, BCH→token, small size** (e.g. ~$5 equivalent): create via the
   frontend, fund it, watch the bot fill it. Verify maker receives exact `buyAmount`,
   profit output lands at the profit address.
2. **cancelEarly() on mainnet**: create a deliberately overpriced limit order, cancel
   it from the frontend, verify full refund + order book shows `cancelled`.
3. **Dutch auction, small size**: create with a short duration, watch the decay fill.
4. **Post-expiry `cancel()`**: let one tiny order expire and confirm the trustless
   refund path (remember the ~2h MTP lag).

Abort criteria: any fill that pays the maker less than covenant terms (impossible by
covenant — if you see it, the artifact deployed is wrong; pause immediately), any
stuck `active` intent that doesn't retry, solver wallet balance drifting below the
sum of its trades' expected P&L.

## Step 6 — Operations

- [ ] Monitoring: poll `/health` + `/router/metrics` (predicted-vs-realized profit,
      hit rate); alert if `realized - predicted` goes materially negative or
      `totalFills` stalls while `activeIntents > 0`.
- [ ] Emergency stop: `POST /router/pause` (verified to gate ALL execution incl.
      DIRECT fills).
- [ ] Periodic BCH fan-out maintenance tx to keep 4+ pure-BCH UTXOs (until bounded
      coin selection ships).
- [ ] Key handling: WIFs only in the deploy platform's secret store; never in git —
      `wallet.json` must stay untracked.

## Known non-blockers (accepted for launch, tracked in MILESTONES.md)

| Item | Impact |
|---|---|
| Cauldron routes consume all pure-BCH UTXOs per trade | Throughput ceiling ~1 Cauldron fill in flight; mitigated by fan-out |
| Scanner scans addresses serially | Latency only, matters at 100+ watched addresses |
| External-wallet early cancel not wired | Cashonize/WC makers wait for expiry to reclaim |
| ProfitLedger noise under concurrency | Measurement precision only |
| Skip-reason not shown in frontend | UX only; API already exposes it |
| Order book lost on redeploy without a volume | Maker funds always safe on-chain |

## Pre-launch test evidence (2026-07-06)

| Suite | Result |
|---|---|
| `contracts-bch-swap npm run test:security` (4 adversarial suites: fill/cancel/cancelEarly/refund, both covenants) | 49/49 ✅ |
| `contracts-bch-swap npm run test:all` (unit: compilation, decay math, determinism, lifecycle) | all ✅ |
| Artifact integrity: repo artifacts ≡ relayer copies ≡ fresh `cashc@0.12.1` compile | ✅ |
| `test:concurrency` (UtxoReservation, 20–25-way contention) | ✅ |
| `test:policy`, `test:scheduler` | ✅ |
| `test:quant` (live chipnet pools; monotonicity assertion given sat-rounding tolerance at dust sizes — test fix, not a code bug) | ✅ |
| Live chipnet e2e: limit order fund→fill (`test:limit`) | ✅ fill tx `81282d80…c32a` |
| Live chipnet e2e: cancelEarly full stack (`test:cancel-early`) | 9/9 ✅ cancel tx `0d2a7d80…b98e` |
| Mainnet Cauldron indexer reachable | ✅ |
| Deployed chipnet relayer URL | ❌ Railway 404 — redeploy needed |
