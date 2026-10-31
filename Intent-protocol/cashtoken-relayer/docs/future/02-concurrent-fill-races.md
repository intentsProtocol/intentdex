# What Happens If Two Solvers Fill the Same Order at the Same Time?

**Added:** 2026-07-04

## Short answer

Nothing bad happens to anyone's funds. Exactly one of the two fill transactions confirms; the other is rejected by the network as a double-spend attempt. The maker gets paid correctly either way (the covenant enforces that regardless of which resolver wins). The losing solver loses nothing except wasted effort — **unless** they'd already executed a Cauldron pre-fill trade before losing, in which case they're out the swap fee + slippage on that trade, though the tokens they bought are still theirs.

This is a solved problem in the sense that Bitcoin's own UTXO model solves it for free — not something this relayer had to build. What's *not* fully solved is **knowing, after the fact, that this is what happened** — see "The real gap" below.

## Why it's structurally safe

Both `LimitOrderSwap.fill()` and `DutchAuctionSwap.fill()` require:
```cashscript
require(tx.inputs.length == 2);   // covenant input + exactly one resolver-funding input
```
Two competing solvers building a fill transaction each construct: input[0] = the same covenant UTXO, input[1] = *their own* funding UTXO (never shared between solvers — each uses their own wallet). Only the covenant input is contested. Whichever transaction reaches a majority of the network / gets mined first spends that UTXO; the network will not accept a second transaction that tries to spend an already-spent output — full stop, no negotiation, no partial state. The losing solver's *own* funding UTXO was never actually spent (their transaction never confirmed), so they haven't lost that money either — it's immediately available for the next opportunity.

This is the exact same guarantee that makes any two conflicting Bitcoin transactions resolve safely — the covenant doesn't need special-case logic for "solver competition" because it's just describing ordinary transaction validity.

## The one real cost: a pre-fill trade that then loses the race

For `BCH_TO_TOKEN` (and the other Cauldron-routed types), `CauldronRouter.executePrefill()` runs *before* the actual covenant fill — the solver buys the token it needs from Cauldron first, waits for that to confirm, then re-checks the covenant is still open before attempting the fill:

```typescript
// index.ts, inside the pre-fill step
const covenantUtxos = await provider.getUtxos(u.address);
if (covenantUtxos.length === 0) {
    console.log(`   Intent already filled by another solver. Pre-fill tokens held as inventory.`);
    addRouteRecord({ ...routeRecord, error: 'Intent sniped after pre-fill' });
    broadcastWsEvent('router:sniped', { address: u.address, preFillTxid: preTxid });
    return;
}
```

This is the codebase already anticipating exactly this race — the "sniped after pre-fill" path exists specifically because a pre-fill trade is a real, confirmed, irreversible transaction, and there's a window (waiting for it to appear in the mempool, typically seconds to under a minute) during which another solver can legitimately win the actual fill. When that happens: **no funds are lost**, but the Cauldron swap fee + any slippage on that pre-fill trade was paid for nothing directly — the tokens just become part of this solver's ordinary inventory instead of flowing straight to a covenant fill.

`DIRECT` (inventory) fills have no equivalent exposure — there's no pre-fill step, so a lost race there costs only a rejected broadcast, nothing pre-committed on-chain.

## The real gap: no reconciliation when we lose

If our own fill attempt fails because another solver won (broadcast rejected — "rejected by network rules" or similar), our retry-resilience logic (`markIntentFailed`, see `STATUS.md`) will retry up to `MAX_CONSECUTIVE_FAILURES` times. But here's the actual gap: **once the covenant is spent by someone else, the scanner will never find a UTXO at that address again**, so `processMatchedUtxo` is never invoked for it again — no more retries happen, but the intent's stored status is left wherever it was (`active`, some `failCount`) rather than being resolved to `filled` (by someone else). It just sits there, stale, forever, unless something explicitly reconciles it.

This wasn't a problem before this session's concurrency work made losing a race a live possibility worth designing for carefully — a single solver only ever "loses" a race to expiry, which is already handled. It becomes a real gap the moment more than one solver can plausibly be filling from the same pool.

**Recommended fix** (not yet implemented): a periodic reconciliation pass, e.g. inside `botLoop()` or as a separate cron-style job:
1. For every intent in `active`/`pending` status whose contract address is *not* in the latest scan results (i.e. the covenant now has zero UTXOs) **and** our own bot didn't just complete it this cycle (no `fillTxid`/`refundTxid` recorded by us) — fetch that address's transaction history via Electrum, find the transaction that spent it, and decode its outputs.
2. If output[0] pays the maker in `buyToken` at `buyAmount` (or better) — it was filled, by someone. Mark the intent `filled`, and if the decoded resolver pubkey isn't ours, note that explicitly (e.g. `filledBy: 'external-solver'`) instead of implying we did it.
3. If output[0] pays the maker in `sellToken` at `sellAmount` — it was a `cancel()`/`cancelEarly()` refund, not a fill (mirrors the verification logic already built for `POST /intent/:id/cancel`).
4. If neither shape matches, flag it for manual review rather than guessing.

This is genuinely useful even in a single-solver world (it would have quietly caught the "5 orders raced against each other and needed the UTXO reservation fix" scenario from this session's own testing faster), and becomes necessary once a second, independently-operated solver exists.

## Reducing wasted collisions (optional, not currently needed)

For a small, cooperative solver set, the natural UTXO-race resolution above is sufficient — it costs nothing and only wastes an occasional pre-fill trade. If/when a genuinely permissionless, larger solver market causes measurable waste (lots of solvers racing the same profitable orders, lots of stranded pre-fill inventory), consider a **soft reservation** layer:

- A solver about to attempt a fill broadcasts a short-TTL claim (e.g. "I'm filling intent X, expires in 60s") to whatever shared discovery channel exists (today: could be a new relayer endpoint like `POST /intent/:id/claim`; later: a Nostr event, mirroring the pattern already designed for this protocol's cross-chain solver competition).
- Other solvers see the claim and skip that intent for the TTL window, avoiding a race they'd likely lose anyway.
- This is **advisory only** — nothing stops a non-compliant solver from ignoring the claim and filling anyway, since the covenant itself grants no special rights to a "claim." It only reduces waste among solvers that choose to cooperate; it can't and shouldn't try to enforce exclusivity, because that would require adding permissioning to a covenant that is intentionally permissionless.
- This mirrors the "Option B: soft reservation" design already worked out for this protocol's cross-chain (EVM↔BCH) solver competition, where the stakes are actually higher (a lost race there can cost a solver real bridged funds, not just a stranded pre-fill trade) — same-chain needs a much lighter version of the same idea, if it's needed at all.

**Recommendation**: don't build this yet. It's speculative infrastructure for a competitive dynamic that doesn't exist yet (this relayer is currently the only solver against its own pool). Build the reconciliation pass first — it's needed regardless of how many solvers exist, and is the actual missing piece today.
