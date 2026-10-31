import dotenv from 'dotenv';
import { Config } from 'mainnet-js';
import { KNOWN_AUCTIONS, KNOWN_LIMIT_ORDERS } from './registry.js';

dotenv.config();

(Config as any).EnforceCashScript = false;
// DefaultNetwork is set per-wallet (TestNetWallet = chipnet, Wallet = mainnet)
// Do NOT hardcode chipnet here — it breaks mainnet Electrum provider selection.

const envAddresses = (process.env.WATCH_ADDRESSES || '').split(',').filter(a => a.length > 0);
const registryAddresses = [
    ...KNOWN_AUCTIONS.map(a => a.address),
    ...KNOWN_LIMIT_ORDERS.map(a => a.address)
];

export const ENV = {
    NETWORK: process.env.NETWORK || 'chipnet',
    WALLET_PATH: process.env.WALLET_PATH || '../contracts-bch-swap/wallet.json',
    RELAYER_PRIVATE_KEY_WIF: process.env.RELAYER_PRIVATE_KEY_WIF,
    MAINNET_PRIVATE_KEY_WIF: process.env.MAINNET_PRIVATE_KEY_WIF,
    WATCH_ADDRESSES: Array.from(new Set([...envAddresses, ...registryAddresses])),
    SLEEP_MS: parseInt(process.env.SLEEP_MS || '10000', 10),

    // How many matched intents the bot will fill concurrently per scan cycle.
    // Each fill can involve up to 3 sequential on-chain steps (pre-fill, fill,
    // rebalance), each with a mempool-propagation wait of up to 60s — at
    // SOLVER_CONCURRENCY=1 (fully serial) a cycle with many simultaneously
    // fillable orders can take many minutes. Raising this trades a bit of
    // profit-ledger measurement precision (see ProfitLedger.ts) for much
    // lower per-order latency under load. UTXO safety is enforced by
    // UtxoReservation.ts regardless of this value.
    SOLVER_CONCURRENCY: parseInt(process.env.SOLVER_CONCURRENCY || '4', 10),

    // Profit / quant policy (defaults locked from the production plan)
    PROFIT_MIN_SATS:        BigInt(process.env.PROFIT_MIN_SATS    ?? '1500'),
    PROFIT_MIN_BPS:         parseInt(process.env.PROFIT_MIN_BPS    ?? '30', 10),
    MAX_SLIPPAGE_BPS:       parseInt(process.env.MAX_SLIPPAGE_BPS  ?? '500', 10),
    PROFIT_POLICY_FILE:     process.env.PROFIT_POLICY_FILE,

    // Optional separate address that receives the predicted-profit slice on every fill.
    // If unset, the executor logs a warning and keeps the profit in the operating wallet.
    RELAYER_PROFIT_ADDRESS: process.env.RELAYER_PROFIT_ADDRESS,

    // ── Lifecycle & discovery tuning ─────────────────────────────────────────
    // How long (seconds) a fully-decayed Dutch auction stays fillable at the
    // floor price before the bot triggers the permissionless cancel() refund.
    // Dutch has no maker cancelEarly() by design, so this refund is the maker's
    // ONLY exit — the grace window preserves the fill-at-floor upside first.
    DUTCH_FLOOR_GRACE_SEC:  parseInt(process.env.DUTCH_FLOOR_GRACE_SEC ?? '1800', 10),

    // How long (seconds) a created-but-never-funded intent stays watched before
    // being marked 'abandoned' and dropped from the scan set.
    FUNDING_DEADLINE_SEC:   parseInt(process.env.FUNDING_DEADLINE_SEC  ?? '3600', 10),

    // How many watched addresses the scanner queries Electrum for concurrently.
    // Serial scanning measured 97.9s for 85 addresses; bounded-8 measured ~3s.
    SCAN_CONCURRENCY:       parseInt(process.env.SCAN_CONCURRENCY      ?? '8', 10),

    // Base for exponential retry backoff on 'failed' intents (ms). A funded
    // covenant that failed N times is retried after BASE × 2^(N-1), capped at 1h.
    FAIL_BACKOFF_BASE_MS:   parseInt(process.env.FAIL_BACKOFF_BASE_MS  ?? '60000', 10),

    // Minimum BCH sats a token UTXO must carry for a DIRECT (inventory) fill to be
    // possible. The covenant enforces exactly 2 inputs, so the fill fee has to come
    // out of the token UTXO's own dust budget — a token UTXO below this is real
    // inventory that cannot actually be spent on a fill.
    //
    // This single value is authoritative for BOTH sides of the contract:
    //   · CauldronRouter uses it to decide whether DIRECT is viable at all
    //   · DutchAuctionExecutor uses it as the floor when it mints token change
    // They previously disagreed (3500 vs a hardcoded 1000), which meant every fill
    // emitted change below the router's own viability bar — a one-way ratchet that
    // permanently starved the solver out of the cheapest route. Keep them equal.
    MIN_TOKEN_UTXO_DUST_SATS: BigInt(process.env.MIN_TOKEN_UTXO_DUST_SATS ?? '3500'),

    // ── Covenant clock ───────────────────────────────────────────────────────
    // Every covenant deadline and every locktime is expressed as
    // `wallClockNow − backdate`. Because it is one clock, the backdate cancels out
    // of durations: an auction decays in real seconds and a limit order lives
    // exactly as long as its maker chose.
    //
    // The backdate exists because a timestamp locktime is only final once
    // `locktime <= MTP` (BIP113), and MTP necessarily trails the wall clock.
    // It must EXCEED the real MTP lag — measured ~4,300s on chipnet and ~2,000s on
    // mainnet, so 7,200 leaves comfortable margin. CovenantClock.checkClockSafety()
    // verifies this against the chain at startup and fails loudly if blocks slow
    // enough to erode it.
    //
    // Do NOT lower these to "reduce delay" — the backdate costs nothing in timing,
    // precisely because it cancels. And do NOT raise them while orders are live:
    // that moves the clock backwards, un-decaying running auctions.
    LOCKTIME_BACKDATE_CHIPNET_SEC: parseInt(process.env.LOCKTIME_BACKDATE_CHIPNET_SEC ?? '7200', 10),
    LOCKTIME_BACKDATE_MAINNET_SEC: parseInt(process.env.LOCKTIME_BACKDATE_MAINNET_SEC ?? '7200', 10),

    // ── Token whitelist ──────────────────────────────────────────────────────
    // Which tokens the solver will fill intents for. Resolution order, per network:
    //   1. TOKEN_CONFIG_FILE_{MAINNET,CHIPNET} — JSON { allow?, deny?, perToken? }
    //   2. FILL_TOKEN_WHITELIST_{MAINNET,CHIPNET} — comma-separated category hex
    //   3. FILL_TOKEN_WHITELIST — DEPRECATED, network-blind (see below)
    //   4. Default: derived from live Cauldron pools above MIN_POOL_TVL_SATS
    //
    // Deriving is the intended default: it is self-updating and degrades safely
    // (no pool ⇒ no route ⇒ nothing to whitelist). An explicit list has to be
    // maintained by hand and silently rots — a category with no pool can sit
    // "whitelisted" forever while being unfillable.
    //
    // FILL_TOKEN_WHITELIST is network-BLIND: the same list gates mainnet and
    // chipnet. Setting it to chipnet categories makes a mainnet relayer fill
    // nothing at all. Kept working for compatibility; warns loudly on load.
    FILL_TOKEN_WHITELIST:         process.env.FILL_TOKEN_WHITELIST,
    FILL_TOKEN_WHITELIST_MAINNET: process.env.FILL_TOKEN_WHITELIST_MAINNET,
    FILL_TOKEN_WHITELIST_CHIPNET: process.env.FILL_TOKEN_WHITELIST_CHIPNET,
    TOKEN_CONFIG_FILE_MAINNET:    process.env.TOKEN_CONFIG_FILE_MAINNET,
    TOKEN_CONFIG_FILE_CHIPNET:    process.env.TOKEN_CONFIG_FILE_CHIPNET,

    // Minimum Cauldron pool TVL (sats) for a token to be auto-whitelisted.
    // Filters out dust pools whose depth cannot support a fill without extreme
    // slippage. Ignored when an explicit allow-list is supplied.
    MIN_POOL_TVL_SATS: BigInt(process.env.MIN_POOL_TVL_SATS ?? '1000000'),

    // INVENTORY_TOKEN_IDS: comma-separated token category hex IDs the solver may use
    //   as supply in INVENTORY_TO_TOKEN (2-hop) routing. Defaults to all held tokens.
    INVENTORY_TOKEN_IDS: process.env.INVENTORY_TOKEN_IDS,
};
