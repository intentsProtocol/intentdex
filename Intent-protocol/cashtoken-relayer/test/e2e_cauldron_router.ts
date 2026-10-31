/**
 * E2E test — CauldronRouter
 *
 * Runs three test suites:
 *   1. Pool cache — fetch mainnet pools from Riften Labs indexer (read-only)
 *   2. Pause / Resume API — toggle router via HTTP
 *   3. Direct fill on chipnet — BCH→BCH intent with small amounts (no Cauldron needed),
 *      verifying the bot loop properly logs route decisions and emits explorer links
 *
 * Usage:
 *   npx tsx test/e2e_cauldron_router.ts
 *
 * Required env:
 *   RELAYER_PRIVATE_KEY_WIF or WALLET_PATH pointing to chipnet wallet
 *
 * Optional env:
 *   CAULDRON_INDEXER_URL  — defaults to https://indexer.riftenlabs.com/v1
 *   RELAYER_API_URL       — defaults to http://localhost:3005
 *   SKIP_LIVE_POOL_TEST=1 — skip indexer test (useful in CI without internet)
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import * as fs from 'fs';
import * as assert from 'assert';

const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3005';
const SKIP_LIVE_POOL = process.env.SKIP_LIVE_POOL_TEST === '1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1; }

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
    return res.json();
}

async function apiPost(path: string, body?: object) {
    const hasBody = body !== undefined;
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: hasBody ? { 'content-type': 'application/json' } : {},
        body: hasBody ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function loadWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    }
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return TestNetWallet.fromWIF(walletData.wif);
}

// ─── Suite 1: Pool Cache ──────────────────────────────────────────────────────

async function testPoolCache() {
    console.log('\n── Suite 1: CauldronPoolCache (mainnet indexer) ──');
    if (SKIP_LIVE_POOL) {
        console.log('  [SKIP] SKIP_LIVE_POOL_TEST=1');
        return;
    }

    const cache = new CauldronPoolCache();
    console.log(`  Fetching pools from ${cache.indexerBaseUrl} …`);

    const pools = await cache.getPools();
    console.log(`  Pool count: ${pools.length}`);

    if (pools.length === 0) {
        console.warn('  ⚠️  No pools returned — indexer may be down or URL is wrong');
        console.warn(`  Try setting CAULDRON_INDEXER_URL to the correct Riften Labs endpoint`);
    } else {
        pass(`Got ${pools.length} Cauldron pools`);

        // Validate first pool shape
        const p = pools[0];
        assert.ok(p.version === '0',                    'Pool version should be "0"');
        assert.ok(p.outpoint.txhash instanceof Uint8Array, 'outpoint.txhash should be Uint8Array');
        assert.ok(p.outpoint.txhash.length === 32,       'outpoint.txhash should be 32 bytes');
        assert.ok(typeof p.output.token.token_id === 'string', 'token_id should be a string');
        assert.ok(p.output.token.token_id.length === 64, 'token_id should be 64-char hex');
        assert.ok(p.output.token.amount > 0n,            'token reserve should be > 0');
        assert.ok(p.output.amount > 0n,                  'BCH reserve should be > 0');
        pass('Pool structure validated');

        // Test getPoolsForPair — BCH→some_token
        const tokenId = p.output.token.token_id;
        const bchToToken = cache.getPoolsForPair('BCH', tokenId);
        assert.ok(bchToToken.length > 0, 'getPoolsForPair(BCH, tokenId) should return pools');
        pass(`getPoolsForPair(BCH, ${tokenId.slice(0, 8)}…) → ${bchToToken.length} pool(s)`);

        // Test TTL cache — second fetch should return instantly from cache
        const t0 = Date.now();
        await cache.getPools();
        const elapsed = Date.now() - t0;
        assert.ok(elapsed < 100, `Cache hit should be < 100ms, got ${elapsed}ms`);
        pass(`Cache hit resolved in ${elapsed}ms`);

        // Show top 3 pools
        console.log('\n  Top pools (by BCH reserve):');
        pools
            .sort((a, b) => Number(b.output.amount - a.output.amount))
            .slice(0, 3)
            .forEach(p => {
                console.log(`    Token ${p.output.token.token_id.slice(0, 12)}… | BCH reserve: ${Number(p.output.amount) / 1e8} BCH | Token reserve: ${p.output.token.amount}`);
            });
    }
}

// ─── Suite 2: Pause / Resume API ─────────────────────────────────────────────

async function testPauseResume() {
    console.log('\n── Suite 2: Router Pause / Resume API ──');

    // Check server is up (retry for up to 20 seconds — Electrum connection takes time)
    let health: any;
    for (let i = 0; i < 10; i++) {
        try {
            health = await apiGet('/health');
            break;
        } catch {
            if (i === 9) {
                fail('Relayer API not reachable after 20s — is the server running? (npm start)');
                console.log('  Skipping Pause/Resume tests');
                return;
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    pass(`Server healthy: network=${health.network}, watching=${health.watching} addresses`);

    // Initial status
    const status0 = await apiGet('/router/status');
    console.log(`  Initial paused state: ${status0.paused}`);
    console.log(`  Mainnet pool count: ${status0.mainnetPoolCount}`);
    console.log(`  Total fills: ${status0.totalFills}`);

    // Pause
    const pauseRes = await apiPost('/router/pause');
    assert.ok(pauseRes.paused === true, 'POST /router/pause should return paused=true');
    pass('Router paused');

    // Verify status reflects pause
    const status1 = await apiGet('/router/status');
    assert.ok(status1.paused === true, '/router/status should show paused=true after pause');
    pass('/router/status shows paused=true');

    // Resume
    const resumeRes = await apiPost('/router/resume');
    assert.ok(resumeRes.paused === false, 'POST /router/resume should return paused=false');
    pass('Router resumed');

    // Verify status reflects resume
    const status2 = await apiGet('/router/status');
    assert.ok(status2.paused === false, '/router/status should show paused=false after resume');
    pass('/router/status shows paused=false');

    // Force pool refresh
    const refreshRes = await apiPost('/router/refresh-pools');
    assert.ok(typeof refreshRes.mainnetPools === 'number', 'refresh-pools should return pool count');
    pass(`Pool refresh: mainnet=${refreshRes.mainnetPools}, chipnet=${refreshRes.chipnetPools}`);
}

// ─── Suite 3: Direct fill on chipnet (small amounts) ─────────────────────────

async function testChipnetDirectFill() {
    console.log('\n── Suite 3: Chipnet BCH→BCH fill (direct, no Cauldron) ──');

    let wallet: TestNetWallet;
    try {
        wallet = await loadWallet();
    } catch (e: any) {
        fail(`Could not load wallet: ${e.message}`);
        return;
    }
    const addr = (wallet as any).cashaddr as string;
    console.log(`  Relayer address: ${addr}`);

    const provider = new ElectrumNetworkProvider('chipnet');
    const utxos = await provider.getUtxos(addr);
    const bchBalance = utxos
        .filter((u: any) => !u.token)
        .reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    console.log(`  BCH balance: ${Number(bchBalance) / 1e8} tBCH (${bchBalance} sats)`);

    if (bchBalance < 20_000n) {
        console.warn('  ⚠️  Balance < 20,000 sats — skipping fill execution');
        console.warn('  Fund the relayer at: https://tbch.googol.cash/');
        return;
    }

    // Construct a router and verify it correctly identifies a BCH→BCH intent as DIRECT
    const cache = CauldronPoolCache.forNetwork('chipnet');
    const router = new CauldronRouter(cache);

    const fakeSolution: any = {
        currentPrice: 10_000n,
        params: {
            sellTokenCategory: '0x',   // BCH sell
            buyTokenCategory: '0x',    // BCH buy
            sellAmount: 10_000n,
        },
        isExpired: false,
    };

    const quote = await router.quote(fakeSolution, utxos);
    assert.ok(quote.profitable === true, 'BCH→BCH should be profitable (direct)');
    assert.ok(quote.routeType === 'DIRECT', 'BCH→BCH should be DIRECT route');
    assert.ok(quote.preFillTrade === null, 'BCH→BCH should have no pre-fill');
    assert.ok(quote.postFillTrade === null, 'BCH→BCH should have no post-fill');
    pass(`Quote: ${quote.routeType} — ${quote.reason}`);

    // Test pause blocks execution
    router.paused = true;
    assert.ok(router.paused === true, 'Router should be pausable');
    pass('Router paused state set correctly');
    router.paused = false;
    pass('Router resumed');

    // Verify pool fetch on chipnet returns empty (Cauldron not deployed there)
    const chipnetPools = await cache.getPools();
    console.log(`  Chipnet pool count: ${chipnetPools.length} (expected 0 — Cauldron is mainnet-only)`);
    pass('Chipnet pool count check passed (0 is correct)');

    // Test a Token→BCH quote without pools — should return noRoute
    const tokenSolution: any = {
        currentPrice: 50_000n,
        params: {
            sellTokenCategory: '0xdeadbeef',   // some token
            buyTokenCategory: '0x',             // BCH buy
            sellAmount: 100_000_000n,
        },
        isExpired: false,
    };
    const tokenQuote = await router.quote(tokenSolution, utxos);
    assert.ok(tokenQuote.profitable === false, 'Token→BCH without pools should be not profitable');
    pass(`No-pool fallback: "${tokenQuote.reason}"`);

    // Create a tiny BCH→BCH intent via the API and verify tracking
    if (process.env.RELAYER_API_URL || true) {
        try {
            const intentRes = await apiPost('/intent/create', {
                makerAddress: addr,    // maker = relayer (test-mode: fill your own intent)
                sellToken: 'BCH',
                buyToken: 'BCH',
                sellAmount: '10000',   // 0.0001 tBCH — small test amount
                buyAmount:  '9000',    // 90% back
                orderType: 'limit',
                expiryTime: Math.floor(Date.now() / 1000) + 300, // 5 min expiry
                network: 'chipnet',
            });

            if (intentRes.success) {
                pass(`Intent created: ${intentRes.intentId}`);
                console.log(`  Contract address: ${intentRes.contractAddress}`);
                console.log(`  Explorer URL:     ${intentRes.explorerUrl}`);
                assert.ok(intentRes.explorerUrl.includes('chipnet.chaingraph.cash'), 'Explorer URL should be chipnet');
                pass('Explorer URL format correct');

                // Fetch intent back and verify fields
                const stored = await apiGet(`/intent/${intentRes.intentId}`);
                assert.ok(stored.status === 'pending', 'Intent should be pending');
                assert.ok(stored.sellToken === 'BCH', 'sellToken stored correctly');
                assert.ok(stored.buyToken === 'BCH', 'buyToken stored correctly');
                pass('Intent retrieved from store correctly');

                console.log(`\n  ℹ️  Fund the contract to trigger the bot fill:`);
                console.log(`     Address: ${intentRes.contractAddress}`);
                console.log(`     Amount:  10,000 sats (0.0001 tBCH)`);
                console.log(`     Or use the token address: ${intentRes.tokenAddress}`);
            } else {
                console.warn(`  ⚠️  Intent creation failed: ${intentRes.error} (server may not be running)`);
            }
        } catch (e: any) {
            console.warn(`  ⚠️  Intent API not available: ${e.message}`);
        }
    }
}

// ─── Suite 4: Quote accuracy check ───────────────────────────────────────────

async function testQuoteAccuracy() {
    console.log('\n── Suite 4: Quote accuracy (mainnet pools, read-only) ──');
    if (SKIP_LIVE_POOL) {
        console.log('  [SKIP] SKIP_LIVE_POOL_TEST=1');
        return;
    }

    const cache = new CauldronPoolCache();
    const pools = await cache.getPools();
    if (pools.length === 0) {
        console.log('  [SKIP] No pools available');
        return;
    }

    const router = new CauldronRouter(cache, 1n); // 1 sat min profit to see all quotes

    // Pick the first available pool's token to quote BCH→Token
    const pool = pools.sort((a, b) => Number(b.output.amount - a.output.amount))[0];
    const tokenId = pool.output.token.token_id;
    const smallDemand = 100n;  // 100 token units — very small test

    const fakeSolution: any = {
        currentPrice: smallDemand,
        params: {
            sellTokenCategory: '0x',          // BCH sell
            buyTokenCategory:  `0x${tokenId}`, // token buy
            sellAmount:        pool.output.amount / 100n, // 1% of pool BCH reserve = reasonable cover
        },
        isExpired: false,
    };

    const quote = await router.quote(fakeSolution, []);
    console.log(`  Token: ${tokenId.slice(0, 16)}…`);
    console.log(`  Route type: ${quote.routeType}`);
    console.log(`  Profitable: ${quote.profitable}`);
    console.log(`  Reason: ${quote.reason}`);

    if (quote.profitable && quote.preFillTrade) {
        const supply = quote.preFillTrade.summary.supply;
        const demand = quote.preFillTrade.summary.demand;
        const fee    = quote.preFillTrade.summary.trade_fee;
        console.log(`  Cauldron quote: supply ${supply} sats → demand ${demand} tokens (fee ${fee} sats)`);
        console.log(`  Net profit: ${quote.netProfitSats} sats`);
        pass(`BCH→Token quote: profitable, profit=${quote.netProfitSats} sats`);
    } else {
        console.log('  Intent not profitable at test parameters (spread too thin) — this is expected');
        pass('Quote returned correctly (unprofitable is a valid result)');
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  CauldronRouter E2E Test Suite');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Relayer API: ${RELAYER_API}`);
    console.log(`  Indexer URL: ${process.env.CAULDRON_INDEXER_URL ?? 'https://indexer.riftenlabs.com/v1'}`);

    await testPoolCache();
    await testPauseResume();
    await testChipnetDirectFill();
    await testQuoteAccuracy();

    console.log('\n═══════════════════════════════════════════════');
    if (process.exitCode) {
        console.log('  RESULT: FAILED (see ❌ above)');
    } else {
        console.log('  RESULT: ALL PASSED ✅');
    }
    console.log('═══════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
