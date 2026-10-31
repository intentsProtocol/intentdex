# Partial Order Fills

**Added:** 2026-07-04

## Current state: not possible, by contract design

Both covenants require the resolver to take (and pay for) the *entire* locked amount in one transaction:

```cashscript
// LimitOrderSwap.cash fill()
require(tx.outputs[1].tokenAmount >= sellAmount);   // resolver must receive at least the FULL sellAmount
```

There's no branch for "resolver takes 30% of `sellAmount` now, leaving 70% locked for later." A resolver technically *could* add extra outputs beyond what's checked (the contract only validates `outputs[0]` and `outputs[1]`; it doesn't forbid or require anything about `outputs[2]`), but nothing in the covenant would enforce that a partial-fill "remainder" output actually recreates a valid, correctly-priced continuation of the same order. Without that enforcement, a resolver could just... not bother, and there's no trustless partial fill — only a full fill or nothing.

## Why this matters

Right now, the only way to get "partial fill" behavior is orchestration-level: the maker (or the frontend on their behalf) splits a large order into several smaller, fully independent orders up front. That works today with zero contract changes (see the "pragmatic path" below) but it's decided at *creation* time, not adaptively — the maker can't say "fill whatever you can right now, keep the rest open" for a single order.

## What a real on-chain design needs

A new covenant function, something like:

```cashscript
function fillPartial(pubkey resolverPk, sig resolverSig, int fillAmount) {
    require(checkSig(resolverSig, resolverPk));
    require(fillAmount > 0 && fillAmount < sellAmount);   // 0 < partial < full (full fill still goes through fill())

    // Proportional payout to the maker
    int buyPortion = (buyAmount * fillAmount) / sellAmount;
    require(tx.outputs[0].tokenAmount >= buyPortion);      // (or .value, if buyToken is BCH)
    // ... locking bytecode / category checks as in fill() ...

    // Resolver receives exactly the partial amount
    require(tx.outputs[1].tokenAmount >= fillAmount);
    // ... locking bytecode / category checks ...

    // THE HARD PART: output[2] must recreate the SAME covenant, with the
    // remainder (sellAmount - fillAmount) locked, for someone to fill later.
    bytes remainderLockingBytecode = <recomputed hash of this exact contract,
                                       same makerPkh/tokens/price terms,
                                       sellAmount := sellAmount - fillAmount>;
    require(tx.outputs[2].lockingBytecode == remainderLockingBytecode);
    require(tx.outputs[2].tokenAmount >= sellAmount - fillAmount);
}
```

The genuinely hard part is the last piece: a **recursive, self-referencing covenant** — the contract must be able to verify that one of the transaction's outputs locks the remainder back into an instance of *itself* with one parameter changed. This is a known, provable BCH covenant pattern (this project's own `DutchAuctionSwap.cash` already uses the underlying idea conceptually — each set of constructor parameters is a "state" identified entirely by its derived address). Two ways to implement the self-check:

1. **Caller supplies the exact expected locking bytecode as an argument**, and the contract independently re-derives what that locking bytecode *should* be and requires equality. This needs the contract to embed enough of its own compiled-bytecode template to reconstruct its own address for a different `sellAmount` — doable, but intricate, and it's exactly the kind of repetitive derivation that benefits from the loop/function primitives below.
2. **A hash-commitment scheme** where the constructor takes a commitment to "the covenant template" once, and the remainder-output check just needs to verify the *parameters* changed correctly (fillAmount subtracted, everything else identical) rather than recompute a full address from scratch.

## The BCH 2026 upgrade changes the difficulty here — significantly

This repo's existing docs (`contracts-bch-swap/README.md`) describe `OP_BEGIN`/`OP_UNTIL` bounded loops as a *forthcoming* 2026 network upgrade that would eventually enable this kind of thing. **That upgrade — "Layla" — activated 2026-05-15** and shipped bounded loops, standardized Pay-to-Script (P2S) outputs, and reusable functions (`OP_DEFINE`/`OP_INVOKE`), on top of Bitwise operations. Concretely, for partial fills:

- **Functions (`OP_DEFINE`/`OP_INVOKE`)** let the "recompute my own locking bytecode with an updated `sellAmount`" logic be written once and invoked, instead of duplicated inline — directly reduces the complexity and script size of the recursive self-check above.
- **Pay-to-Script (P2S)** standardizes exactly the kind of "here's a script, verify it matches" output pattern a recursive covenant remainder needs, rather than relying on ad-hoc P2SH32 hash tricks.
- **Bounded loops** matter less for a *single* partial fill (which only ever produces one remainder), but become directly relevant for TWAP (`04-twap-orders.md`), where a single covenant validating a whole multi-tranche release schedule benefits from iterating rather than needing one hardcoded branch per tranche.

Net effect: a real on-chain partial-fill covenant is meaningfully more buildable today than the existing project docs imply — but it's still a **new, non-trivial contract** that needs its own adversarial security pass (see below), not a small patch to the existing `fill()`.

## Risks specific to partial fills (why this needs its own security pass, not a quick addition)

- **Dust griefing**: without a minimum partial-fill size, a resolver (or a hostile third party who can somehow trigger fills — shouldn't be possible, but audit for it) could fragment an order into many tiny partial fills, leaving the maker with an ever-shrinking, eventually dust-value remainder that's not worth anyone filling or refunding. Needs an explicit `require(fillAmount >= someMinimum || fillAmount == sellAmount)`-style guard.
- **Rounding-favorable-to-resolver math**: `buyPortion = (buyAmount * fillAmount) / sellAmount` is integer division — across many small partial fills, rounding-down errors could compound in the resolver's favor at the maker's expense. Needs either a rounding-up rule on the maker's payout side, or a per-fill minimum that makes the rounding error economically irrelevant.
- **Remainder re-derivation correctness**: if the recursive self-reference check has *any* bug, the remainder output could lock funds into an address nobody can ever spend from (permanent loss) or, worse, into an address whose terms are wrong (e.g. wrong `makerPkh`, silently letting someone else claim the remainder). This is exactly the class of bug the existing adversarial test suites in `contracts-bch-swap/test/` are built to catch for the current, simpler contracts — a partial-fill covenant needs the same treatment, scaled up, before it goes anywhere near mainnet funds.

## Pragmatic path that ships now, no contract changes, no new audit surface

Split a large order into N independent, ordinary `LimitOrderSwap`/`DutchAuctionSwap` covenants at creation time — e.g. a relayer endpoint like `POST /intent/create-split` that takes `{ totalSellAmount, totalBuyAmount, tranches }` and internally calls the existing `/intent/create` N times with `totalSellAmount/tranches` each. Any subset of the resulting orders can fill independently, by any solver, in any order, whenever each individually becomes profitable — which is functionally most of what "partial fill" is asked for in practice (the big order gets filled incrementally over time by different counterparties) without touching a single line of the audited contracts.

**Tradeoffs vs. true on-chain partial fill:**
- More funding transactions up front (N instead of 1) — more fees paid by the maker at creation time, though each individual fill is still exactly as cheap as today.
- The maker can't say "fill whatever you can of this ONE order right now" — they're deciding the granularity at creation time, not adaptively.
- No new contract risk. Ships as soon as the relayer endpoint exists.

**Recommendation**: build the orchestration-level split now if there's real demand for it; treat the true on-chain recursive covenant as a separate, fully-audited initiative — the fund-safety stakes of getting the self-referencing remainder logic wrong are high enough that it shouldn't be bundled in as an incremental change to the existing, already-proven contracts.
