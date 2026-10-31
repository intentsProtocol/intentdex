/**
 * CovenantClock — the single clock every covenant deadline is expressed in.
 *
 *     covenantNow = wallClockNow − BACKDATE
 *
 * Every timestamp the covenants ever compare — Dutch `startTime`, limit
 * `expiryTime`, and the `tx.locktime` they are compared against — is written in
 * this clock. Because it is one clock, the backdate cancels out of every duration:
 * an auction created at `covenantNow` and filled `d` seconds later has decayed
 * exactly `d` seconds, and a limit order lives exactly as long as its maker chose.
 *
 * ── Why backdate at all ─────────────────────────────────────────────────────
 * A timestamp locktime is only *final* — relayable and mineable — once
 * `locktime <= MTP`, the median of the previous 11 block timestamps (BIP113). MTP
 * necessarily trails the wall clock, so the locktime must sit in the past.
 *
 * ── Why not just use MTP as the clock ───────────────────────────────────────
 * That was the previous design, and it was wrong in a way that only shows up on
 * chain. MTP advances when a *block* lands, not when time passes, so it moves in
 * jumps. Measured on chipnet: over 8 minutes of wall clock MTP advanced twice,
 * once by 2,232 seconds. A 600-second Dutch auction went from 0/600 to 2232/600 in
 * a single step — 0% to 100% decayed, every price on the curve between them
 * skipped. The auction stopped auctioning: makers were handed the floor price
 * rather than the best price a solver would have taken on the way down. Two live
 * orders filled at 141 and 162 units where the curve started at 282 and 325.
 *
 * A constant backdate advances 1:1 with the wall clock, so the whole curve exists.
 *
 * ── Why the backdate is safe, and how we know ───────────────────────────────
 * `covenantNow <= MTP` iff `BACKDATE >= (now − MTP)`, the current MTP lag. So the
 * backdate is not a guess to be tuned by feel: MTP is read from the chain and used
 * to *validate* it. Measured lags — chipnet ~4,300 s, mainnet ~2,000 s — sit
 * comfortably under the 7,200 s default, and `assertClockSafe()` fails loudly if a
 * slow-block stretch ever erodes that margin.
 *
 * ── Why the backdate must not adapt ─────────────────────────────────────────
 * It is tempting to derive BACKDATE from the live lag. Do not. Raising it moves
 * `covenantNow` *backwards*, which un-decays running auctions and can flip an
 * expired limit order back to fillable. The value must be stable for the lifetime
 * of the orders it stamps; if the real lag ever exceeds it, the correct response is
 * to stop and alert, not to silently move the clock.
 */
import type { ElectrumNetworkProvider } from 'cashscript';
import { ENV } from '../config.js';

/** BIP113: median over the previous 11 blocks. */
const MTP_WINDOW = 11;

/** MTP only changes when a block lands, so a short cache costs nothing. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry { mtp: number; fetchedAt: number; height: number }
const cache = new Map<string, CacheEntry>();

export type Network = 'mainnet' | 'chipnet';

/** Backdate for this network, in seconds. */
export function backdateFor(network: string): number {
    return network === 'mainnet' ? ENV.LOCKTIME_BACKDATE_MAINNET_SEC : ENV.LOCKTIME_BACKDATE_CHIPNET_SEC;
}

/**
 * "Now" on the covenant clock. Advances 1:1 with the wall clock.
 *
 * Use for BOTH the locktime stamped on a spend AND the deadlines written into a
 * covenant's constructor. Mixing clocks between those two is what produced the
 * original limit-order skew, where a "1 hour" order was fillable for three.
 */
export function covenantNow(network: string): number {
    return Math.floor(Date.now() / 1000) - backdateFor(network);
}

/** Parse the little-endian uint32 timestamp at bytes 68..72 of an 80-byte header. */
function timestampFromHeaderHex(hex: string): number {
    return parseInt(hex.slice(136, 144).match(/../g)!.reverse().join(''), 16);
}

/**
 * Current median-time-past. Used to VALIDATE the backdate, not to drive the clock.
 *
 * One batched `blockchain.block.headers` call (~230 ms warm) rather than 11 fetches.
 */
export async function getMedianTimePast(
    provider: ElectrumNetworkProvider,
    network: string,
    opts: { force?: boolean } = {},
): Promise<number> {
    const hit = cache.get(network);
    if (!opts.force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.mtp;

    const p = provider as unknown as {
        performRequest(name: string, ...args: (string | number | boolean)[]): Promise<any>;
    };
    const tip = await p.performRequest('blockchain.headers.subscribe');
    const height: number = tip.height ?? tip.block_height;

    const res = await p.performRequest('blockchain.block.headers', height - (MTP_WINDOW - 1), MTP_WINDOW);
    const hex: string = res.hex;
    const count: number = res.count ?? Math.floor(hex.length / 160);
    if (!hex || count < 1) throw new Error(`blockchain.block.headers returned nothing for ${network}`);

    const stamps: number[] = [];
    for (let i = 0; i < count; i++) stamps.push(timestampFromHeaderHex(hex.slice(i * 160, (i + 1) * 160)));
    stamps.sort((a, b) => a - b);
    const mtp = stamps[Math.floor(stamps.length / 2)];

    cache.set(network, { mtp, fetchedAt: Date.now(), height });
    return mtp;
}

/** How far MTP currently trails the wall clock. */
export function mtpLagSeconds(mtp: number): number {
    return Math.floor(Date.now() / 1000) - mtp;
}

export interface ClockSafety {
    network: string;
    backdate: number;
    mtp: number;
    lagSec: number;
    /** Seconds of margin before transactions would start being rejected as non-final. */
    marginSec: number;
    safe: boolean;
}

/**
 * Check that the configured backdate still clears the real MTP lag.
 *
 * Call at startup and periodically. A shrinking margin means blocks are coming
 * slowly; once it goes negative every covenant spend would be non-final and
 * rejected, so this is a stop-and-alert condition rather than something to absorb.
 */
export async function checkClockSafety(
    provider: ElectrumNetworkProvider,
    network: string,
): Promise<ClockSafety> {
    const mtp = await getMedianTimePast(provider, network, { force: true });
    const lagSec = mtpLagSeconds(mtp);
    const backdate = backdateFor(network);
    return { network, backdate, mtp, lagSec, marginSec: backdate - lagSec, safe: backdate >= lagSec };
}

/**
 * The locktime to stamp on a covenant spend.
 *
 * Identical to `covenantNow`, verified against live MTP so a stalled chain fails
 * here rather than by having the node silently reject the transaction.
 */
export async function getSpendLocktime(
    provider: ElectrumNetworkProvider,
    network: string,
): Promise<number> {
    const lock = covenantNow(network);
    const mtp = await getMedianTimePast(provider, network);
    if (lock > mtp) {
        throw new Error(
            `Covenant clock unsafe on ${network}: locktime ${lock} > MTP ${mtp} ` +
            `(lag ${mtpLagSeconds(mtp)}s exceeds backdate ${backdateFor(network)}s). ` +
            `Blocks are arriving too slowly; raise LOCKTIME_BACKDATE_${network.toUpperCase()}_SEC ` +
            `for NEW orders — never mid-flight, as it moves the clock backwards.`,
        );
    }
    if (lock < 500_000_000) {
        throw new Error(`Computed locktime ${lock} would be read as a block height (network ${network})`);
    }
    return lock;
}

/** Test seam. */
export function _clearMtpCache(): void { cache.clear(); }
