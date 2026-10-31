/**
 * ProfitLedger — record of predicted vs realized fill profit.
 *
 * "Realized" is the **exact net effect of the fill's own transactions** on the
 * relayer's addresses, decoded from the chain (see TxDelta.ts) and summed across
 * the pre-fill, fill and rebalance legs.
 *
 * It used to snapshot total wallet balance before and after each fill instead.
 * That only works when nothing else touches the wallet in between, which under
 * SOLVER_CONCURRENCY > 1 is never true. Measured failures, both real:
 *   · 12 concurrent fills reported 4,427,058 sats against ~84,000 actual — each
 *     snapshot caught other in-flight fills' inputs and change.
 *   · a single TOKEN_TO_BCH fill reported 4,784 against a real 523,239, because
 *     the snapshot landed after the rebalance had spent the fill's outputs but
 *     before its own output propagated.
 * The old header comment predicted exactly this and recommended per-tx deltas.
 *
 * Records persist to disk, so a restart no longer erases profit history (the
 * process is long-lived but does get redeployed, and /router/metrics returning an
 * empty byRouteType after every restart made the numbers untrustworthy anyway).
 */

import * as fs from 'fs';
import type { ElectrumNetworkProvider } from 'cashscript';
import { combinedDelta, lockingSet } from './TxDelta.js';

const BPS_DEN = 10_000n;

export interface FillRecord {
    intentId:        string;
    routeType:       string;
    predictedSats:   bigint;
    realizedSats:    bigint | null;
    deltaBps:        number | null;   // (realized − predicted) / predicted × 10000
    slippageBps:     number;
    txids:           { preFillTxid?: string; fillTxid?: string; postFillTxid?: string };
    startedAt:       number;
    confirmedAt:     number | null;
    error?:          string;
}

export interface LedgerMetrics {
    totalFills:           number;
    totalPredictedSats:   string;
    totalRealizedSats:    string;
    totalAbsDeltaSats:    string;
    avgSlippageBps:       number;
    hitRate:              number;   // realized > 0 / fills
    avgDeltaBps:          number;   // mean of |delta| in bps
    byRouteType:          Record<string, { fills: number; predictedSats: string; realizedSats: string }>;
    recentFills:          FillRecord[];
}

export class ProfitLedger {
    private records: FillRecord[] = [];
    private predictedIndex = new Map<string, FillRecord>();
    /** Locking scripts counted as "ours" when attributing transaction outputs. */
    private readonly mine: Set<string>;

    constructor(
        readonly relayerAddrs: string[],   // [cashaddr, tokenaddr, profitAddr?]
        readonly maxRecent = 100,
        private readonly storeFile: string | null = 'profit-ledger.json',
    ) {
        this.mine = lockingSet(relayerAddrs);
        this.load();
    }

    // ── Persistence ─────────────────────────────────────────────────────────
    private load(): void {
        if (!this.storeFile) return;
        try {
            if (!fs.existsSync(this.storeFile)) return;
            const raw = JSON.parse(fs.readFileSync(this.storeFile, 'utf8')) as any[];
            this.records = raw.map(r => ({
                ...r,
                predictedSats: BigInt(r.predictedSats ?? '0'),
                realizedSats:  r.realizedSats === null || r.realizedSats === undefined
                    ? null : BigInt(r.realizedSats),
            }));
            for (const r of this.records) this.predictedIndex.set(r.intentId, r);
            console.log(`[ProfitLedger] restored ${this.records.length} fill record(s) from ${this.storeFile}`);
        } catch (e: any) {
            console.warn(`[ProfitLedger] could not restore ${this.storeFile}: ${e.message}`);
        }
    }

    private save(): void {
        if (!this.storeFile) return;
        try {
            fs.writeFileSync(this.storeFile, JSON.stringify(this.records.map(r => this.serialize(r)), null, 2));
        } catch { /* non-fatal: metrics are observability, not correctness */ }
    }

    /**
     * Exact realized profit for a fill: the summed net effect of its own
     * transactions on our addresses.
     *
     * Summing the legs is what makes it meaningful — a TOKEN_TO_BCH fill is
     * BCH-negative in isolation (pays the maker, receives tokens) and only turns
     * positive once the rebalance sells those tokens. Any single leg misleads.
     */
    async measureRealized(
        provider: ElectrumNetworkProvider,
        txids: { preFillTxid?: string; fillTxid?: string; postFillTxid?: string },
    ): Promise<{ netSats: bigint; incomplete: boolean }> {
        const { netSats, incomplete } = await combinedDelta(
            provider, [txids.preFillTxid, txids.fillTxid, txids.postFillTxid], this.mine,
        );
        return { netSats, incomplete };
    }

    /** Begin tracking an in-flight fill. Returns the in-progress record. */
    recordPredicted(intentId: string, routeType: string, predictedSats: bigint, slippageBps: number): FillRecord {
        const existing = this.predictedIndex.get(intentId);
        if (existing) return existing;

        const rec: FillRecord = {
            intentId, routeType, predictedSats,
            realizedSats: null, deltaBps: null,
            slippageBps,
            txids: {},
            startedAt: Date.now(),
            confirmedAt: null,
        };
        this.records.unshift(rec);
        if (this.records.length > this.maxRecent) this.records.pop();
        this.predictedIndex.set(intentId, rec);
        this.save();
        return rec;
    }

    attachTxids(intentId: string, txids: Partial<FillRecord['txids']>): void {
        const r = this.predictedIndex.get(intentId);
        if (!r) return;
        r.txids = { ...r.txids, ...txids };
        this.save();
    }

    /** Mark a fill as confirmed and capture realized BCH delta. */
    recordRealized(intentId: string, realizedSats: bigint, error?: string): FillRecord | null {
        const r = this.predictedIndex.get(intentId);
        if (!r) return null;
        r.realizedSats = realizedSats;
        r.confirmedAt = Date.now();
        if (error) r.error = error;
        if (r.predictedSats > 0n) {
            const diff = realizedSats - r.predictedSats;
            const sign = diff < 0n ? -1n : 1n;
            r.deltaBps = Number((sign * diff * BPS_DEN) / r.predictedSats) * Number(sign);
        } else {
            r.deltaBps = 0;
        }
        this.save();
        return r;
    }

    /** JSON-safe version of a record (bigints → decimal strings). */
    private serialize(r: FillRecord): any {
        return {
            ...r,
            predictedSats: r.predictedSats.toString(),
            realizedSats:  r.realizedSats === null ? null : r.realizedSats.toString(),
        };
    }

    /** Pull aggregate analytics for `/router/metrics`. */
    metrics(): LedgerMetrics {
        let predicted = 0n;
        let realized  = 0n;
        let absDelta  = 0n;
        let slipSum   = 0;
        let slipN     = 0;
        let realizedFills = 0;
        let positiveFills = 0;
        let deltaBpsSum = 0;
        let deltaBpsN   = 0;
        const byRoute: Record<string, { fills: number; predictedSats: bigint; realizedSats: bigint }> = {};

        for (const r of this.records) {
            predicted += r.predictedSats;
            slipSum   += r.slippageBps;
            slipN     += 1;

            const bucket = byRoute[r.routeType] ??= { fills: 0, predictedSats: 0n, realizedSats: 0n };
            bucket.fills        += 1;
            bucket.predictedSats += r.predictedSats;

            if (r.realizedSats !== null) {
                realized += r.realizedSats;
                bucket.realizedSats += r.realizedSats;
                realizedFills += 1;
                if (r.realizedSats > 0n) positiveFills += 1;
                const d = r.realizedSats - r.predictedSats;
                absDelta += d < 0n ? -d : d;
                if (r.deltaBps !== null) {
                    deltaBpsSum += Math.abs(r.deltaBps);
                    deltaBpsN   += 1;
                }
            }
        }

        return {
            totalFills:         this.records.length,
            totalPredictedSats: predicted.toString(),
            totalRealizedSats:  realized.toString(),
            totalAbsDeltaSats:  absDelta.toString(),
            avgSlippageBps:     slipN ? Math.round(slipSum / slipN) : 0,
            hitRate:            realizedFills ? positiveFills / realizedFills : 0,
            avgDeltaBps:        deltaBpsN ? Math.round(deltaBpsSum / deltaBpsN) : 0,
            byRouteType: Object.fromEntries(
                Object.entries(byRoute).map(([k, v]) => [k, {
                    fills: v.fills,
                    predictedSats: v.predictedSats.toString(),
                    realizedSats:  v.realizedSats.toString(),
                }])
            ),
            recentFills: this.records.slice(0, 20).map(r => this.serialize(r)),
        };
    }

    /** Look up an in-flight or completed record. */
    get(intentId: string): FillRecord | undefined {
        return this.predictedIndex.get(intentId);
    }
}
