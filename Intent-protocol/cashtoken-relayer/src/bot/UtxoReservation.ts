/**
 * UtxoReservation — cross-task "this outpoint is spoken for" registry.
 *
 * The bot loop processes several intents concurrently (see SOLVER_CONCURRENCY
 * in index.ts). Two concurrent fills must never pick the SAME solver-wallet
 * UTXO as a funding/trade input — Electrum won't show a UTXO as spent until
 * the spending tx has propagated (seconds to ~a minute), so two tasks racing
 * a fraction of a second apart would otherwise both see it as available and
 * build conflicting transactions.
 *
 * The fix: reserve an outpoint the INSTANT it's selected as an input —
 * synchronously, before any broadcast — not just after the spend completes.
 * Every UTXO-selection call site in DutchAuctionExecutor.ts and
 * CauldronRouter.ts filters candidates through `filterAvailable()` and calls
 * `reserve()` the moment it picks one.
 *
 * TTL matches the previous single-loop `recentlySpent` map this replaces:
 * Electrum can lag a broadcast by up to ~60s, so entries are kept for 5
 * minutes (a generous multiple) before being pruned, covering worst-case
 * propagation delay across a whole batch of concurrent fills.
 */

const RESERVATION_TTL_MS = 5 * 60 * 1000;

const reserved = new Map<string, number>(); // "txid:vout" -> reservedAtMs

function outpointOf(u: { txid: string; vout: number }): string {
    return `${u.txid}:${u.vout}`;
}

/** Reserve a single outpoint (string form "txid:vout"). */
export function reserveOutpoint(outpoint: string): void {
    reserved.set(outpoint, Date.now());
}

/** Reserve every outpoint in a list (string form "txid:vout"). */
export function reserveOutpoints(outpoints: string[]): void {
    for (const op of outpoints) reserveOutpoint(op);
}

export function isReserved(outpoint: string): boolean {
    return reserved.has(outpoint);
}

/** Drop UTXOs that are currently reserved by another in-flight task. */
export function filterAvailable<T extends { txid: string; vout: number }>(utxos: T[]): T[] {
    return utxos.filter(u => !reserved.has(outpointOf(u)));
}

/** Prune reservations older than the TTL — call once per scan cycle. */
export function pruneExpired(): void {
    const now = Date.now();
    for (const [op, ts] of reserved) {
        if (now - ts > RESERVATION_TTL_MS) reserved.delete(op);
    }
}

/** Test/diagnostic helper — current reservation count. */
export function reservationCount(): number {
    return reserved.size;
}

/** Test-only helper — wipe all reservations. Never call this from the bot loop. */
export function clearReservations(): void {
    reserved.clear();
}
