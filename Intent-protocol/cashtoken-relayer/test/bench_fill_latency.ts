/**
 * bench_fill_latency.ts — where does time-to-fill actually go?
 *
 * READ-ONLY. Broadcasts nothing. Safe to run against a live relayer.
 *
 * Decomposes the maker-funds-covenant → solver-broadcasts-fill latency into
 * its four stages and measures each against the real chipnet/mainnet Electrum
 * servers and the real Cauldron indexer:
 *
 *   Stage 1  DISCOVERY   Scanner.scanAddresses() — one serial Electrum
 *                        getUtxos() per watched address. Grows O(N) with the
 *                        watch list, and the bot sleeps SLEEP_MS on top.
 *   Stage 2  SOLVE       RelayerSolver.solve() — pure CPU (price decay math +
 *                        Contract construction).
 *   Stage 3  QUOTE       CauldronRouter.quote() — pool cache (network on TTL
 *                        miss) + ExchangeLab route search.
 *   Stage 4  EXECUTE     tx build + broadcast + the mempool-propagation waits
 *                        the bot loop does between pre-fill / fill / rebalance.
 *                        Measured here as the wallet-UTXO fetch the executor
 *                        does; the waits themselves are reported from their
 *                        configured values since they can't be timed without
 *                        broadcasting.
 *
 * Run:  npx tsx test/bench_fill_latency.ts
 *       RELAYER_URL=http://localhost:3006 npx tsx test/bench_fill_latency.ts
 */
import { ElectrumNetworkProvider, Contract } from 'cashscript';
import { Config, TestNetWallet } from 'mainnet-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RelayerSolver } from '../src/bot/DutchAuctionSolver.js';
import { ElectrumSupervisor } from '../src/electrum.js';
import { Scanner } from '../src/scanner.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import { loadPolicy } from '../src/bot/ProfitPolicy.js';
import { KNOWN_AUCTIONS, KNOWN_LIMIT_ORDERS } from '../src/registry.js';
import { ENV } from '../src/config.js';
import type { ScannedUtxo } from '../src/scanner.js';

(Config as any).EnforceCashScript = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAYER_URL = process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3006}`;
const NETWORK = (process.env.NETWORK || 'chipnet') as 'chipnet' | 'mainnet';
const REPEATS = parseInt(process.env.BENCH_REPEATS || '3', 10);

// ── stats helpers ────────────────────────────────────────────────────────────
const ms = () => Number(process.hrtime.bigint() / 1_000_000n);
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
    const t = ms();
    const v = await fn();
    return [v, ms() - t];
}
function stats(xs: number[]) {
    if (!xs.length) return { n: 0, min: 0, p50: 0, p90: 0, max: 0, mean: 0 };
    const s = [...xs].sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    return {
        n: s.length, min: s[0], p50: at(0.5), p90: at(0.9), max: s[s.length - 1],
        mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    };
}
const fmt = (s: ReturnType<typeof stats>) =>
    `n=${s.n} min=${s.min}ms p50=${s.p50}ms p90=${s.p90}ms max=${s.max}ms mean=${s.mean}ms`;

// ── watch list: prefer the live relayer's view, fall back to local config ────
async function getWatchAddresses(): Promise<string[]> {
    try {
        const r = await fetch(`${RELAYER_URL}/intents`, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
            const body: any = await r.json();
            const active = body.active ?? body.intents ?? [];
            const addrs = active.map((i: any) => i.contractAddress).filter(Boolean);
            if (addrs.length) return [...new Set<string>(addrs)];
        }
    } catch { /* relayer not up — fall through */ }
    return ENV.WATCH_ADDRESSES;
}

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
    console.log('=== FILL LATENCY BENCHMARK (read-only) ===');
    console.log(`network=${NETWORK}  relayer=${RELAYER_URL}  repeats=${REPEATS}`);

    // LEGACY provider: constructed the way the relayer used to, i.e. with
    // manualConnectionManagement defaulting to false, so every request opens and
    // closes its own socket. Kept purely as the baseline to measure against.
    const legacyProvider = new ElectrumNetworkProvider(NETWORK);

    // LIVE provider: the supervised persistent connection the relayer now uses.
    const supervisor = new ElectrumSupervisor(NETWORK);
    await supervisor.start();
    const provider = supervisor.provider;

    const addresses = await getWatchAddresses();
    console.log(`watch list: ${addresses.length} addresses\n`);

    // ── Stage 1: DISCOVERY ───────────────────────────────────────────────────
    console.log('── Stage 1: DISCOVERY (Electrum getUtxos per watched address) ──');

    // Baseline: per-call cost when the socket is torn down between requests.
    const legacyPerCall: number[] = [];
    for (let i = 0; i < Math.min(10, addresses.length); i++) {
        const [, dt] = await timed(() => legacyProvider.getUtxos(addresses[i]).catch(() => []));
        legacyPerCall.push(dt);
    }
    const legacyCall = stats(legacyPerCall);
    console.log(`  per-address, RECONNECTING : ${fmt(legacyCall)}   ← old default-provider behaviour`);

    const perCall: number[] = [];
    for (let i = 0; i < Math.min(10, addresses.length); i++) {
        const [, dt] = await timed(() => provider.getUtxos(addresses[i]).catch(() => []));
        perCall.push(dt);
    }
    const warmCall = stats(perCall);
    console.log(`  per-address, PERSISTENT   : ${fmt(warmCall)}   ← current (electrum.ts supervisor)`);
    if (legacyCall.p50 && warmCall.p50) {
        console.log(`  → persistent connection is ${(legacyCall.p50 / warmCall.p50).toFixed(1)}× faster per call\n`);
    }

    // Full sweep, serial, over the persistent connection — the old scan shape.
    const serialTotals: number[] = [];
    for (let r = 0; r < REPEATS; r++) {
        const t0 = ms();
        for (const addr of addresses) {
            await provider.getUtxos(addr).catch(() => []);
        }
        serialTotals.push(ms() - t0);
    }
    const serial = stats(serialTotals);
    console.log(`  SERIAL full sweep    : ${fmt(serial)}`);

    // The real thing: Scanner.scanAddresses() as the bot loop calls it.
    // Scanner reads ENV.WATCH_ADDRESSES, so point it at the same set we just
    // measured serially — otherwise it would only sweep this process's local
    // config and the comparison would be meaningless.
    ENV.WATCH_ADDRESSES = addresses;
    const scanner = new Scanner(provider, provider);
    const scanTotals: number[] = [];
    for (let r = 0; r < REPEATS; r++) {
        const [, dt] = await timed(() => scanner.scanAddresses());
        scanTotals.push(dt);
    }
    const live = stats(scanTotals);
    console.log(`  LIVE Scanner sweep   : ${fmt(live)}   ← what the bot loop actually runs now`);

    const speedup = live.p50 > 0 ? (serial.p50 / Math.max(1, live.p50)).toFixed(1) : '—';
    console.log(`  → live scanner is ${speedup}× faster than the serial equivalent\n`);
    const bounded = live;

    // ── Stage 2: SOLVE ───────────────────────────────────────────────────────
    console.log('── Stage 2: SOLVE (RelayerSolver.solve — pure CPU) ──');
    const solver = new RelayerSolver(NETWORK);
    const sampleIntent = KNOWN_AUCTIONS[0] ?? KNOWN_LIMIT_ORDERS[0];
    const solveTimes: number[] = [];
    let sampleSolution: any = null;
    if (sampleIntent) {
        const fakeUtxo: ScannedUtxo = {
            address: sampleIntent.address,
            txid: '00'.repeat(32), vout: 0,
            satoshis: BigInt((sampleIntent as any).sellAmount ?? 100000n),
            token: (sampleIntent.sellTokenCategory && sampleIntent.sellTokenCategory !== '0x')
                ? { amount: BigInt((sampleIntent as any).sellAmount ?? 1000n),
                    category: sampleIntent.sellTokenCategory.replace(/^0x/, '') }
                : undefined,
        };
        for (let i = 0; i < 50; i++) {
            const t0 = ms();
            sampleSolution = solver.solve(fakeUtxo) ?? sampleSolution;
            solveTimes.push(ms() - t0);
        }
        console.log(`  solve()              : ${fmt(stats(solveTimes))}`);
    } else {
        console.log('  (no registry intents to solve against — skipped)');
    }
    console.log('');

    // ── Stage 3: QUOTE ───────────────────────────────────────────────────────
    console.log('── Stage 3: QUOTE (pool cache + Cauldron route search) ──');
    const cache = CauldronPoolCache.forNetwork(NETWORK);
    const [, coldFetch] = await timed(() => cache.refresh());
    console.log(`  pool cache COLD fetch: ${coldFetch}ms  (${cache.getPoolCount()} pool UTXOs, TTL=30s)`);
    const warmTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
        const [, dt] = await timed(() => cache.getPools());
        warmTimes.push(dt);
    }
    console.log(`  pool cache WARM read : ${fmt(stats(warmTimes))}`);

    if (sampleSolution) {
        const router = new CauldronRouter(cache, loadPolicy(), !!process.env.RELAYER_PROFIT_ADDRESS);
        // Quote against an empty solver wallet — isolates route-search cost from
        // wallet-UTXO fetch cost (measured separately in stage 4).
        const quoteTimes: number[] = [];
        for (let i = 0; i < REPEATS; i++) {
            const [q, dt] = await timed(() => router.quote(sampleSolution, []));
            quoteTimes.push(dt);
            if (i === 0) console.log(`  sample quote         : ${q.routeType} profitable=${q.profitable} — ${q.reason}`);
        }
        console.log(`  quote() warm cache   : ${fmt(stats(quoteTimes))}`);
    }
    console.log('');

    // ── Stage 4: EXECUTE ─────────────────────────────────────────────────────
    console.log('── Stage 4: EXECUTE (wallet UTXO fetch + fixed propagation waits) ──');
    try {
        const wif = ENV.RELAYER_PRIVATE_KEY_WIF
            ?? JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif;
        const wallet: any = await TestNetWallet.fromWIF(wif);
        const walletFetch: number[] = [];
        for (let i = 0; i < REPEATS; i++) {
            const [, dt] = await timed(async () => {
                await provider.getUtxos(wallet.cashaddr);
                await provider.getUtxos(wallet.tokenaddr);
            });
            walletFetch.push(dt);
        }
        console.log(`  solver wallet UTXOs  : ${fmt(stats(walletFetch))}  (fetched 2-3× per fill)`);
    } catch (e: any) {
        console.log(`  (wallet fetch skipped: ${e.message})`);
    }
    console.log('  waitForUtxo poll     : 3000ms interval, 60000ms timeout (CauldronRouter.waitForUtxo)');
    console.log('    · after pre-fill   : up to 60s   (only on BCH_TO_TOKEN / TOKEN_TO_TOKEN / INVENTORY routes)');
    console.log('    · before rebalance : up to 60s   (only on TOKEN_TO_BCH / TOKEN_TO_TOKEN routes)');
    console.log('    · ledger settle    : up to 30s   (every fill, AFTER the fill is already broadcast)');
    console.log('');

    // ── Budget ───────────────────────────────────────────────────────────────
    console.log('── TIME-TO-FILL BUDGET (funding broadcast → fill broadcast) ──');
    const sleep = ENV.SLEEP_MS;
    const discoveryWorst = sleep + serial.p90;
    const discoveryMean = sleep / 2 + serial.p50;
    console.log(`  SLEEP_MS                        : ${sleep}ms`);
    console.log(`  discovery (mean: ½ sleep + scan): ~${Math.round(discoveryMean)}ms`);
    console.log(`  discovery (worst: sleep + scan) : ~${Math.round(discoveryWorst)}ms`);
    console.log(`  + solve + quote                 : ~${Math.round(stats(solveTimes).p50 + 50)}ms (warm cache)`);
    console.log(`  + fill build/broadcast          : ~1500-3000ms (2 wallet fetches + sign + broadcast)`);
    console.log(`  ────────────────────────────────`);
    console.log(`  DIRECT route  (no pre-fill)     : ~${((discoveryMean + 2500) / 1000).toFixed(1)}s typical`);
    console.log(`  CAULDRON route (pre-fill first) : ~${((discoveryMean + 2500 + 8000) / 1000).toFixed(1)}s typical, up to ${((discoveryWorst + 2500 + 60000) / 1000).toFixed(0)}s worst`);
    console.log('');
    console.log('  NOTE: for Dutch auctions add the DutchAuctionScheduler defer time — it holds');
    console.log('        off filling while projected profit keeps rising, until profit ≥ 2× the');
    console.log('        minAbsoluteSats floor or the auction is within 60s of its end.');

    await supervisor.stop();
    process.exit(0);
})().catch(e => {
    console.error('BENCH FAILED:', e);
    process.exit(1);
});
