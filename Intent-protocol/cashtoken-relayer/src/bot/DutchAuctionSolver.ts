import { KNOWN_AUCTIONS, KNOWN_LIMIT_ORDERS, DutchAuctionIntent, LimitOrderIntent } from '../registry.js';
import { ScannedUtxo } from '../scanner.js';
import { ENV } from '../config.js';
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DUTCH_ARTIFACT_PATH = path.resolve(__dirname, '../artifacts/DutchAuctionSwap.json');
const dutchArtifact = JSON.parse(fs.readFileSync(DUTCH_ARTIFACT_PATH, 'utf8'));

const LIMIT_ARTIFACT_PATH = path.resolve(__dirname, '../artifacts/LimitOrderSwap.json');
const limitArtifact = JSON.parse(fs.readFileSync(LIMIT_ARTIFACT_PATH, 'utf8'));

export interface AuctionSolution {
    utxo: ScannedUtxo;
    params: DutchAuctionIntent | LimitOrderIntent;
    currentPrice: bigint;
    contract: Contract;
    type: 'DUTCH_AUCTION' | 'LIMIT_ORDER';
    isExpired: boolean;
    /**
     * The exact locktime the executor must stamp on this spend.
     *
     * Not a hint: the covenant recomputes the Dutch price from tx.locktime, so the
     * price in `currentPrice` is only valid for THIS value. Deriving it again
     * downstream — even a few seconds later, even from the same MTP — reintroduces
     * the mismatch this field exists to prevent.
     */
    lockTimeSec: number;
    /** Predicted profit (BCH sats) — used by executor for profit-address segregation. */
    predictedProfitSats?: bigint;
}

/**
 * A Dutch auction whose startTime is still ahead of the covenant clock, so no
 * spendable fill exists yet. Distinguished from `null` (not ours / not matched)
 * because the caller should surface the wait to the maker, not stay silent.
 */
export interface NotYetStarted {
    notYetStarted: true;
    opensInSec: number;
}

export function isNotYetStarted(r: AuctionSolution | NotYetStarted | null): r is NotYetStarted {
    return r !== null && 'notYetStarted' in r;
}

export class RelayerSolver {
    private provider: ElectrumNetworkProvider;
    public network: string;

    /**
     * @param provider  Optional shared provider. Pass the process-wide supervised
     *                  connection (see electrum.ts) so contracts built here reuse
     *                  the persistent socket instead of spinning up a second
     *                  provider that reconnects on every request.
     */
    constructor(network: string = 'chipnet', provider?: ElectrumNetworkProvider) {
        this.network = network;
        this.provider = provider ?? new ElectrumNetworkProvider(network as any);
    }

    /**
     * @param lockTimeSec The locktime that will be stamped on the resulting spend —
     *   NOT raw median-time-past. `getSpendLocktime()` subtracts a safety margin from
     *   MTP, and the covenant evaluates against the stamped value, so pricing against
     *   raw MTP quotes a number the contract rejects. (Observed: solver quoted 39,834
     *   for a fresh auction whose contract demanded 40,000, because it priced 60s
     *   further along the decay curve than the locktime implied.) It is returned on
     *   the solution so the executor uses the identical value.
     */
    public solve(utxo: ScannedUtxo, lockTimeSec: number): AuctionSolution | NotYetStarted | null {
        // 1. Check if UTXO address matches any known intent
        const auction = KNOWN_AUCTIONS.find(a => a.address === utxo.address);
        const limitOrder = KNOWN_LIMIT_ORDERS.find(l => l.address === utxo.address);

        const params = (auction || limitOrder) as DutchAuctionIntent | LimitOrderIntent;
        if (!params) return null;

        const isDutch = !!auction;

        // 2. Check token category on the UTXO matches the sell intent
        if (params.sellTokenCategory !== '0x') {
            if (!utxo.token || `0x${utxo.token.category}` !== params.sellTokenCategory) {
                return null;
            }
        }

        // Helper to formatting
        const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
        const reverseHex = (hex: string) => hex.match(/.{2}/g)!.reverse().join('');

        const sellCat = params.sellTokenCategory === '0x' || params.sellTokenCategory === ''
            ? '0x'
            : `0x${reverseHex(stripHex(params.sellTokenCategory))}`;

        const buyCat = params.buyTokenCategory === '0x' || params.buyTokenCategory === ''
            ? '0x'
            : `0x${reverseHex(stripHex(params.buyTokenCategory))}`;

        // 3. Process according to type
        let price: bigint;
        let contract: Contract;
        let isExpired = false;

        // Every covenant time comparison is against tx.locktime. Pricing against the
        // exact value that will be stamped is what keeps solver decisions and on-chain
        // validity in agreement — see the note on solve()'s parameter.
        const nowMTP = BigInt(lockTimeSec);

        if (isDutch) {
            const da = params as DutchAuctionIntent;
            price = da.startBuyAmount;

            // Dutch lifecycle: decay → fill-at-floor grace window → trustless refund.
            //
            // Dutch has no maker cancelEarly() BY DESIGN (a committed auction), so the
            // permissionless cancel() branch is the maker's ONLY exit. Timing note:
            // startTime is recorded in MTP-space at creation and the refund locktime is
            // read from real MTP, so both sides share one clock — cancel() becomes
            // broadcastable once MTP has advanced `duration` past startTime, which is
            // approximately `duration` real seconds later.
            //
            // The grace window preserves the fill-at-floor upside: a fully-decayed
            // auction stays fillable at endBuyAmount for DUTCH_FLOOR_GRACE_SEC before
            // the bot gives up on a fill and refunds the maker.
            // Not open yet. fill() requires `locktime >= startTime`, so building a
            // transaction here would be broadcasting one the covenant is guaranteed to
            // reject — burning an attempt and tripping the failure backoff.
            //
            // Normally unreachable, since startTime is written from this same clock at
            // creation. It becomes reachable when the clock changes underneath live
            // orders: raising a backdate, or the MTP-clock → covenant-clock migration,
            // moves `now` backwards past startTimes already baked into on-chain
            // covenants. Those orders are not lost — they open once the clock catches
            // up — so report the wait rather than failing them.
            if (nowMTP < da.startTime) {
                return { notYetStarted: true, opensInSec: Number(da.startTime - nowMTP) };
            }

            const endTime = da.startTime + da.duration;
            const graceEnd = endTime + BigInt(ENV.DUTCH_FLOOR_GRACE_SEC);
            if (nowMTP >= graceEnd) {
                // Floor-price grace elapsed with no profitable fill → refund the maker.
                price = da.endBuyAmount;
                isExpired = true;
            } else if (nowMTP >= endTime) {
                // Auction ended: fill at endBuyAmount (fill() clamps to endBuyAmount).
                price = da.endBuyAmount;
            } else if (nowMTP > da.startTime) {
                const timeElapsed = nowMTP - da.startTime;
                const priceDiff = da.startBuyAmount - da.endBuyAmount;
                const decay = (priceDiff * timeElapsed) / da.duration;
                price = da.startBuyAmount - decay;
            }
            if (price < da.endBuyAmount) price = da.endBuyAmount;

            contract = new Contract(dutchArtifact, [
                da.makerPkh,
                sellCat,
                buyCat,
                da.sellAmount,
                da.startBuyAmount,
                da.endBuyAmount,
                da.startTime,
                da.duration
            ], { provider: this.provider });

        } else {
            const lo = params as LimitOrderIntent;
            price = lo.buyAmount;

            // Expiry handling — both covenant branches key off tx.locktime, which the
            // executor stamps from real MTP so the node accepts the tx as final:
            //
            //   fill()   requires locktime <  expiryTime  → holds while nowMTP <  expiryTime
            //   cancel() requires tx.time  >= expiryTime  → holds while nowMTP >= expiryTime
            //
            // They are exactly complementary: there is NO window in which both are
            // invalid. The single nowMTP comparison below is therefore the whole
            // rule — fillable right up to the instant it becomes refundable.
            //
            // (This previously also returned null once nowReal >= expiryTime, which
            // blacked out ~2h of still-fillable time per order for no consensus
            // reason. The maker's chosen expiry is effectively +2h on-chain; that is
            // surfaced as fillableUntil / refundableFrom rather than hidden by
            // declining fills the covenant would have accepted.)
            if (nowMTP >= lo.expiryTime) {
                isExpired = true;
            }

            contract = new Contract(limitArtifact, [
                lo.makerPkh,
                sellCat,
                buyCat,
                lo.sellAmount,
                lo.buyAmount,
                lo.expiryTime
            ], { provider: this.provider });
        }


        return {
            utxo,
            params,
            currentPrice: price,
            contract,
            lockTimeSec,
            type: isDutch ? 'DUTCH_AUCTION' : 'LIMIT_ORDER',
            isExpired
        };
    }
}
