/**
 * Intent Store — Persists intents to disk + in-memory for fast access.
 * Used by both the HTTP API and the bot loop.
 */
import * as fs from 'fs';

const STORE_FILE = 'intents.json';

export type IntentStatus =
    | 'pending'    // created, waiting to be funded / picked up by the solver
    | 'active'     // solver is currently executing (pre-fill swap, fill, rebalance in-flight)
    | 'filled'     // fill transaction confirmed
    | 'refunded'   // covenant cancelled, funds returned to maker
    | 'expired'    // past its fill window; refund attempted but not yet broadcast (retrying)
    | 'failed'     // repeated execution failures — still funded and still watched, on backoff
    | 'cancelled'  // maker-initiated cancelEarly()
    | 'abandoned'; // created but never funded before FUNDING_DEADLINE_SEC — dropped from the scan set

/** Statuses that are done forever — never rehydrated, never watched. */
export const TERMINAL_STATUSES: ReadonlySet<IntentStatus> = new Set<IntentStatus>([
    'filled', 'refunded', 'cancelled', 'abandoned',
]);

/**
 * Statuses that still need watching / can still transition.
 *
 * Derived from TERMINAL_STATUSES rather than listed separately — two hand-written
 * lists of the same concept drift, and a status missing from one of them either
 * orphans a funded covenant or resurrects a settled one.
 */
export const ALL_STATUSES: ReadonlyArray<IntentStatus> = [
    'pending', 'active', 'filled', 'refunded', 'expired', 'failed', 'cancelled', 'abandoned',
];

export const isNonTerminalStatus = (s: IntentStatus) => !TERMINAL_STATUSES.has(s);

export const NON_TERMINAL_STATUSES: ReadonlyArray<IntentStatus> =
    ALL_STATUSES.filter(isNonTerminalStatus);

export interface StoredIntent {
    id: string;
    type: 'LIMIT_ORDER' | 'DUTCH_AUCTION';
    makerAddress: string;
    contractAddress: string;
    tokenAddress: string;
    sellToken: string;            // category ID or 'BCH'
    buyToken: string;             // category ID or 'BCH'
    sellAmount: string;           // stringified bigint
    buyAmount: string;            // stringified bigint
    status: IntentStatus;

    // Timestamps (all Unix seconds unless noted)
    createdAt: number;            // ms since epoch (legacy — divide by 1000 for seconds)
    updatedAt?: number;           // ms — updated on every status change
    expiryTime?: number;          // Unix seconds — the WALL-CLOCK expiry the maker chose
    startTime?: number;           // Unix seconds — Dutch auction start (wall clock, display)
    duration?: number;            // seconds — Dutch auction duration

    /**
     * The exact constructor arguments baked into the covenant address, on the
     * covenant clock (`wallClockNow − BACKDATE` — see bot/CovenantClock.ts).
     *
     * These MUST be stored rather than recomputed. The address is a hash of the
     * constructor arguments, so rebuilding an intent with a re-derived value produces
     * a different address and the order silently stops being recognised — which is
     * what the "[rehydrate] address mismatch" warnings in the logs were.
     *
     * They are not wall clock, because tx.locktime must be <= median-time-past to be
     * final, so the covenant's deadlines have to be written on the same shifted clock
     * the locktime comes from. The shift cancels out of every duration.
     */
    covenantStartTime?: number;   // DUTCH: startTime argument
    covenantExpiry?: number;      // LIMIT: expiryTime argument

    // The TRUE on-chain windows, in wall-clock Unix seconds for display. These are
    // exact, not estimates: the covenant clock advances 1:1 with the wall clock, so a
    // deadline's distance in clock seconds is its distance in real seconds.
    //   LIMIT: fill() and cancel() are complementary, so both flip at one instant.
    //   DUTCH: refundableFrom = startTime + duration;
    //          fillableUntil  = that + DUTCH_FLOOR_GRACE_SEC (fill-at-floor grace)
    fillableUntil?: number;       // Unix seconds — solver stops attempting fills after this
    refundableFrom?: number;      // Unix seconds — cancel() becomes broadcastable at this point

    // Dutch auction pricing
    startBuyAmount?: string;
    endBuyAmount?: string;
    fillPrice?: string;           // actual price at fill time (sats or token units)
    fillRatio?: number;           // 0–1, fraction of duration elapsed at fill

    // Transaction chain
    fundingTxid?: string;         // UTXO funding covenant
    fundingVout?: number;         // vout of the funding covenant UTXO (paired with fundingTxid)
    preFillTxid?: string;         // Cauldron pre-fill swap (BCH→Token)
    fillTxid?: string;            // covenant fill transaction
    rebalanceTxid?: string;       // Cauldron post-fill rebalance
    refundTxid?: string;          // cancel() transaction (refund to maker, post-expiry)
    cancelTxid?: string;          // cancelEarly() transaction (maker-initiated, pre-expiry)

    // URLs
    explorerUrl?: string;         // block explorer link for contract address
    fillExplorerUrl?: string;     // block explorer link for fill tx

    // P&L
    expectedProfitAmount?: string; // predicted profit (sats) at quote time
    pnlSats?: number;              // realized profit (sats) measured by ledger
    txFeeSats?: number;            // total fee paid across all transactions
    profitTx?: string;             // profit segregation tx (if separate)

    // Error tracking
    failReason?: string;           // human-readable error if status === 'failed'
    failCount?: number;            // consecutive execution failures (broadcast races, transient
                                    // Electrum errors, etc.) — reset on any successful active/fill.
                                    // Past MAX_CONSECUTIVE_FAILURES the intent shows 'failed' but the
                                    // funded covenant STAYS watched, retried on exponential backoff.
    retryAfter?: number;           // ms epoch — skip execution attempts until this time
                                    // (exponential backoff for repeatedly-failing funded intents)
    routeType?: string;            // DIRECT | BCH_TO_TOKEN | TOKEN_TO_BCH | INVENTORY_TO_TOKEN

    // Why a still-open (pending/active) intent hasn't filled yet — updated every
    // cycle the solver considers it but declines to fill. Lets the frontend show
    // e.g. "queued — waiting for solver liquidity" instead of a bare "pending".
    lastSkipCategory?: 'unprofitable_spread' | 'slippage_too_high' | 'insufficient_capital' | 'no_pool' | 'quote_error' | 'not_yet_started' | 'other';
    lastSkipReason?: string;        // human-readable detail (raw router reason string)
    lastSkipAt?: number;            // ms since epoch
}

let intents: StoredIntent[] = [];

function loadFromDisk() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            intents = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        }
    } catch { /* ignore */ }
}

function saveToDisk() {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(intents, null, 2));
    } catch { /* ignore */ }
}

// Init
loadFromDisk();

export function addIntent(intent: StoredIntent) {
    intents.unshift(intent);
    if (intents.length > 500) intents.pop();
    saveToDisk();
}

export function getIntent(id: string): StoredIntent | undefined {
    return intents.find(i => i.id === id);
}

export function getIntentByContract(contractAddress: string): StoredIntent | undefined {
    return intents.find(i => i.contractAddress === contractAddress);
}

export interface Outpoint { txid: string; vout: number }

/**
 * Pick the intent record a given covenant UTXO belongs to.
 *
 * Contract addresses are NOT unique per intent: constructor params are baked into
 * the P2SH32 address, and both order types derive a time field at second
 * granularity (`startTime = now − 7200` for Dutch, `expiryTime = now + preset` for
 * limit), so two identical orders created in the same second collide onto ONE
 * address. A double-clicked swap button is enough to trigger it.
 *
 * Matching on address alone meant every UTXO at a collided address resolved to the
 * *first* record: one fill marked one record done, the address was unwatched, and
 * the sibling funded UTXOs were orphaned with their records stuck 'pending'
 * forever. Observed live — 100,000 sats stranded.
 *
 * Order of preference: exact outpoint, then any record that has not yet claimed an
 * outpoint (so N UTXOs distribute 1:1 across N records), then address-only for
 * callers with no outpoint to hand.
 *
 * Pure over the passed list so it can be unit-tested without touching the store.
 */
export function pickIntentForOutpoint(
    candidates: StoredIntent[],
    contractAddress: string,
    outpoint?: Outpoint,
    statuses: ReadonlyArray<IntentStatus> = NON_TERMINAL_STATUSES,
): StoredIntent | undefined {
    const atAddress = candidates.filter(
        i => i.contractAddress === contractAddress && statuses.includes(i.status),
    );
    if (atAddress.length === 0) return undefined;

    if (outpoint) {
        const exact = atAddress.find(
            i => i.fundingTxid === outpoint.txid && i.fundingVout === outpoint.vout,
        );
        if (exact) return exact;
        const unclaimed = atAddress.find(i => i.fundingTxid === undefined);
        if (unclaimed) return unclaimed;
    }
    return atAddress[0];
}

/** True while any non-terminal intent still points at this address. */
export function hasOpenIntentsAt(candidates: StoredIntent[], contractAddress: string): boolean {
    return candidates.some(
        i => i.contractAddress === contractAddress && isNonTerminalStatus(i.status),
    );
}

export function updateIntent(id: string, updates: Partial<StoredIntent>) {
    const intent = intents.find(i => i.id === id);
    if (intent) {
        Object.assign(intent, { ...updates, updatedAt: Date.now() });
        saveToDisk();
    }
}

/** Returns all intents that are still in-flight (not yet terminal). */
export function getActiveIntents(): StoredIntent[] {
    return intents.filter(i => i.status === 'pending' || i.status === 'active');
}

export function getCompletedIntents(): StoredIntent[] {
    return intents.filter(i => i.status !== 'pending' && i.status !== 'active');
}

export function getAllIntents(): StoredIntent[] {
    return intents;
}

export interface IntentQuery {
    maker?: string;
    status?: string;
    sellToken?: string;
    buyToken?: string;
    type?: string;
    limit?: number;
    offset?: number;
}

export function queryIntents(query: IntentQuery): { intents: StoredIntent[], total: number } {
    let filtered = intents;

    if (query.maker) {
        filtered = filtered.filter(i => i.makerAddress === query.maker);
    }
    if (query.status) {
        filtered = filtered.filter(i => i.status === query.status);
    }
    if (query.type) {
        filtered = filtered.filter(i => i.type === query.type);
    }
    if (query.sellToken) {
        const st = query.sellToken.startsWith('0x') ? query.sellToken.slice(2) : query.sellToken;
        filtered = filtered.filter(i => i.sellToken === st);
    }
    if (query.buyToken) {
        const bt = query.buyToken.startsWith('0x') ? query.buyToken.slice(2) : query.buyToken;
        filtered = filtered.filter(i => i.buyToken === bt);
    }

    const total = filtered.length;
    const offset = query.offset || 0;
    const limit = Math.min(query.limit || 50, 200);

    return { intents: filtered.slice(offset, offset + limit), total };
}
