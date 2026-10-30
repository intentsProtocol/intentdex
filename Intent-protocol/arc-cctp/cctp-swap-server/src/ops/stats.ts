/** Read models for the admin console, computed from the stores on request. Pure functions. */
import { TERMINAL_STATUSES, type Transfer } from '../types.js';
import { SWAP_TERMINAL, type SolanaSwap } from '../jupiter/types.js';

const DAY = 24 * 3600_000;
const HOUR = 3600_000;

export function median(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const sec = (a?: number, b?: number) => (a && b && b >= a ? (b - a) / 1000 : undefined);
const defined = (xs: (number | undefined)[]) => xs.filter((x): x is number => x !== undefined);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** 24 hourly buckets ending at the current hour. */
function hourly<T>(items: T[], now: number, created: (x: T) => number, done: (x: T) => number | undefined, failed: (x: T) => number | undefined) {
    const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
    const buckets = Array.from({ length: 24 }, (_, i) => ({ t: start + i * HOUR, created: 0, completed: 0, failed: 0 }));
    const put = (at: number | undefined, k: 'created' | 'completed' | 'failed') => {
        if (at === undefined || at < start) return;
        const b = buckets[Math.floor((at - start) / HOUR)];
        if (b) b[k]++;
    };
    for (const x of items) { put(created(x), 'created'); put(done(x), 'completed'); put(failed(x), 'failed'); }
    return buckets;
}

const cctpDone = (t: Transfer) => t.status === 'COMPLETED' || t.status === 'COMPLETED_EXTERNAL';

export function cctpStats(all: Transfer[], now: number, stuckMin: number) {
    const done = all.filter(cctpDone);
    const failed = all.filter(t => t.status === 'FAILED');
    const active = all.filter(t => !TERMINAL_STATUSES.has(t.status));
    const byStatus: Record<string, number> = {};
    for (const t of all) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

    const routes = new Map<string, Transfer[]>();
    for (const t of all) {
        if (!t.dst) continue;
        const k = `${t.src}>${t.dst}`;
        if (!routes.has(k)) routes.set(k, []);
        routes.get(k)!.push(t);
    }
    const last = all.filter(t => t.createdAt >= now - DAY);
    const stuckBefore = now - stuckMin * 60_000;

    return {
        total: all.length, byStatus,
        active: active.length,
        awaitingBurn: byStatus.CREATED ?? 0,
        completed: done.length, failed: failed.length, expired: byStatus.EXPIRED ?? 0,
        successRate: done.length + failed.length ? done.length / (done.length + failed.length) : null,
        volume: sum(done.map(t => BigInt(t.amount))).toString(),
        received: sum(done.map(t => BigInt(t.received ?? t.expectedReceive))).toString(),
        fees: sum(done.map(t => BigInt(t.amount) - BigInt(t.received ?? t.expectedReceive))).toString(),
        last24h: {
            created: last.length, completed: last.filter(cctpDone).length, failed: last.filter(t => t.status === 'FAILED').length,
            volume: sum(last.filter(cctpDone).map(t => BigInt(t.amount))).toString(),
        },
        timingSec: {
            burnToConfirmed: median(defined(done.map(t => sec(t.burnSubmittedAt, t.burnConfirmedAt)))),
            confirmedToAttested: median(defined(done.map(t => sec(t.burnConfirmedAt, t.attestedAt)))),
            attestedToMinted: median(defined(done.map(t => sec(t.attestedAt, t.completedAt)))),
            total: median(defined(done.map(t => sec(t.burnSubmittedAt, t.completedAt)))),
        },
        byRoute: [...routes.entries()].map(([route, ts]) => ({
            route, src: ts[0].src, dst: ts[0].dst, count: ts.length,
            completed: ts.filter(cctpDone).length, failed: ts.filter(t => t.status === 'FAILED').length,
            volume: sum(ts.filter(cctpDone).map(t => BigInt(t.amount))).toString(),
            medianSec: median(defined(ts.filter(cctpDone).map(t => sec(t.burnSubmittedAt, t.completedAt)))),
        })).sort((a, b) => b.count - a.count),
        stuck: active.filter(t => t.status !== 'CREATED' && t.updatedAt < stuckBefore).map(t => t.id),
        retrying: active.filter(t => t.failCount > 0).length,
        hourly: hourly(all, now, t => t.createdAt, t => (cctpDone(t) ? t.completedAt : undefined), t => (t.status === 'FAILED' ? t.updatedAt : undefined)),
    };
}

export function solanaStats(all: SolanaSwap[], now: number) {
    const done = all.filter(s => s.status === 'COMPLETED');
    const failed = all.filter(s => s.status === 'FAILED');
    const byStatus: Record<string, number> = {};
    for (const s of all) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    const usd = (xs: SolanaSwap[]) => xs.reduce((a, s) => a + (s.inUsdValue ?? 0), 0);

    const pairs = new Map<string, SolanaSwap[]>();
    for (const s of all) {
        const k = `${s.inputMint}>${s.outputMint}`;
        if (!pairs.has(k)) pairs.set(k, []);
        pairs.get(k)!.push(s);
    }
    const routers: Record<string, number> = {};
    for (const s of done) routers[s.router] = (routers[s.router] ?? 0) + 1;
    const last = all.filter(s => s.createdAt >= now - DAY);

    return {
        total: all.length, byStatus,
        active: all.filter(s => !SWAP_TERMINAL.has(s.status)).length,
        submitted: byStatus.SUBMITTED ?? 0,
        completed: done.length, failed: failed.length, expired: byStatus.EXPIRED ?? 0,
        successRate: done.length + failed.length ? done.length / (done.length + failed.length) : null,
        volumeUsd: usd(done),
        gasless: done.filter(s => s.gasless).length,
        last24h: { created: last.length, completed: last.filter(s => s.status === 'COMPLETED').length, failed: last.filter(s => s.status === 'FAILED').length, volumeUsd: usd(last.filter(s => s.status === 'COMPLETED')) },
        medianLandSec: median(defined(done.map(s => sec(s.submittedAt, s.completedAt)))),
        byPair: [...pairs.entries()].map(([pair, ss]) => ({
            pair, inputMint: ss[0].inputMint, outputMint: ss[0].outputMint, inSymbol: ss[0].inSymbol, outSymbol: ss[0].outSymbol,
            count: ss.length, completed: ss.filter(s => s.status === 'COMPLETED').length, failed: ss.filter(s => s.status === 'FAILED').length,
            volumeUsd: usd(ss.filter(s => s.status === 'COMPLETED')),
        })).sort((a, b) => b.count - a.count).slice(0, 20),
        byRouter: routers,
        failReasons: Object.entries(failed.reduce<Record<string, number>>((m, s) => { const k = s.failReason ?? 'unknown'; m[k] = (m[k] ?? 0) + 1; return m; }, {}))
            .map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
        hourly: hourly(all, now, s => s.createdAt, s => (s.status === 'COMPLETED' ? s.completedAt : undefined), s => (s.status === 'FAILED' ? s.updatedAt : undefined)),
    };
}

// ── profits ──────────────────────────────────────────────────────────────────

const addTo = (m: Record<string, number>, k: string, v: number) => { m[k] = (m[k] ?? 0) + v; };

/**
 * What we earned. Cross-chain fees are exact (USDC seen arriving at the treasury). Solana fees come from
 * Jupiter's /execute amounts where available, with a USD estimate from the quote; the referral token account
 * balances are the ground truth for those.
 */
export function profitStats(transfers: Transfer[], swaps: SolanaSwap[], now: number, days = 14) {
    const day0 = Math.floor(now / DAY) * DAY - (days - 1) * DAY;
    const daily = Array.from({ length: days }, (_, i) => ({ day: day0 + i * DAY, cctpFees: 0n, cctpCount: 0, solanaUsd: 0, solanaCount: 0 }));
    const bucket = (at?: number) => (at === undefined || at < day0 ? undefined : daily[Math.floor((at - day0) / DAY)]);

    const withFee = transfers.filter(t => t.protocolFee && t.protocolFee !== '0');
    const paid = withFee.filter(t => t.feeStatus === 'paid');
    const unpaid = withFee.filter(t => t.feeStatus === 'unpaid');
    // on hold for the fee, or burned with the fee still to be confirmed; a transfer that was never burned owes nothing
    const awaiting = withFee.filter(t => !TERMINAL_STATUSES.has(t.status) && t.status !== 'CREATED' && (t.feeStatus === 'awaiting' || t.feeStatus === 'pending'));
    const byChain = new Map<string, { chain: string; count: number; fees: bigint }>();
    for (const t of paid) {
        const c = byChain.get(t.src) ?? { chain: t.src, count: 0, fees: 0n };
        c.count++; c.fees += BigInt(t.protocolFee!);
        byChain.set(t.src, c);
        const b = bucket(t.feePaidAt ?? t.updatedAt);
        if (b) { b.cctpFees += BigInt(t.protocolFee!); b.cctpCount++; }
    }
    const relayCost: Record<string, number> = {};
    let relayed = 0;
    for (const t of transfers) if (t.relayCost) { addTo(relayCost, t.relayCost.symbol, Number(t.relayCost.amount)); relayed++; }
    const paid24 = paid.filter(t => (t.feePaidAt ?? 0) >= now - DAY);

    const feeSwaps = swaps.filter(s => s.status === 'COMPLETED' && (s.referralFeeBps ?? 0) > 0);
    const byMint = new Map<string, { mint: string; count: number; total: bigint; ours: bigint }>();
    let estimatedUsd = 0, estimatedUsd24 = 0;
    for (const s of feeSwaps) {
        const usd = (s.inUsdValue ?? 0) * (s.referralFeeBps! / 10_000) * 0.8;
        estimatedUsd += usd;
        if ((s.completedAt ?? 0) >= now - DAY) estimatedUsd24 += usd;
        const b = bucket(s.completedAt);
        if (b) { b.solanaUsd += usd; b.solanaCount++; }
        if (s.feeCollected) {
            const m = byMint.get(s.feeCollected.mint) ?? { mint: s.feeCollected.mint, count: 0, total: 0n, ours: 0n };
            m.count++; m.total += BigInt(s.feeCollected.total); m.ours += BigInt(s.feeCollected.ours);
            byMint.set(s.feeCollected.mint, m);
        }
    }

    return {
        cctp: {
            paid: sum(paid.map(t => BigInt(t.protocolFee!))).toString(), paidCount: paid.length,
            unpaid: sum(unpaid.map(t => BigInt(t.protocolFee!))).toString(), unpaidCount: unpaid.length,
            awaiting: sum(awaiting.map(t => BigInt(t.protocolFee!))).toString(), awaitingCount: awaiting.length,
            last24h: { paid: sum(paid24.map(t => BigInt(t.protocolFee!))).toString(), count: paid24.length },
            byChain: [...byChain.values()].map(c => ({ ...c, fees: c.fees.toString() })).sort((a, b) => b.count - a.count),
            relayCost, relayed,
        },
        solana: {
            swapsWithFee: feeSwaps.length, estimatedUsd, last24h: { estimatedUsd: estimatedUsd24, count: feeSwaps.filter(s => (s.completedAt ?? 0) >= now - DAY).length },
            byMint: [...byMint.values()].map(m => ({ ...m, total: m.total.toString(), ours: m.ours.toString() })),
        },
        daily: daily.map(d => ({ ...d, cctpFees: d.cctpFees.toString() })),
    };
}
