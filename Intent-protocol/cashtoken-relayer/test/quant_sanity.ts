/**
 * Quant-sanity test — SpreadQuant against live chipnet pools.
 *
 *   1. Fetch chipnet Cauldron pools.
 *   2. Compute spot price for EGGS + ParyonUSD.
 *   3. Compute marginal price for 1k / 10k / 100k unit trades.
 *   4. Assert slippage grows monotonically with trade size.
 */

import * as SpreadQuant from '../src/bot/SpreadQuant.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import * as assert from 'assert';

const EGGS  = '00929d9c87328052fe88af118e5d7e29ec24a1771fa8e826bd7485ced761d17f';
const PUSD  = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };

async function probe(name: string, tokenId: string, pools: any[], sizes: bigint[]) {
    console.log(`\n  ── ${name} (${tokenId.slice(0, 12)}…) ──`);
    const spotFP = SpreadQuant.spotPriceSatsPerToken(pools, tokenId);
    console.log(`  spot (FP×1e8):   ${spotFP}`);
    console.log(`  spot (sats/tok): ${Number(spotFP) / 1e8}`);

    const slips: { bps: number; supplySats: bigint }[] = [];
    for (const size of sizes) {
        const q = SpreadQuant.marginalPriceForTrade(pools, 'BCH', tokenId, size);
        const fair = SpreadQuant.fairValueSats(pools, tokenId, size);
        console.log(`  trade=${String(size).padStart(8)} units: supplySats=${String(q.supplySats).padStart(10)}, fairValue=${String(fair).padStart(10)}, slip=${q.slippageBps}bps${q.insufficientLiquidity ? ' [INSUFFICIENT]' : ''}`);
        if (!q.insufficientLiquidity) slips.push({ bps: q.slippageBps, supplySats: q.supplySats });
    }

    // Slippage must grow monotonically with trade size — up to the estimator's
    // sat-quantization noise. marginalPriceForTrade ceil-rounds supplySats to a
    // whole sat, so each measurement carries up to (1 sat / supplySats) → in bps,
    // 10000/supplySats — of upward noise. At dust sizes (e.g. 275 sats) that is
    // ~36bps and can exceed the real curve movement between adjacent sizes; at
    // meaningful sizes the tolerance is ~0 and the assertion stays sharp.
    for (let i = 1; i < slips.length; i++) {
        const noiseBps = (s: bigint) => s > 0n ? Math.ceil(10_000 / Number(s)) : 0;
        const tolerance = noiseBps(slips[i - 1].supplySats) + noiseBps(slips[i].supplySats);
        assert.ok(
            slips[i].bps >= slips[i - 1].bps - tolerance,
            `slippage at size[${i}]=${slips[i].bps} < previous=${slips[i - 1].bps} beyond rounding tolerance (${tolerance}bps)`
        );
    }
    pass(`slippage monotonic (within sat-rounding tolerance) across ${slips.length} sizes`);
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Quant Sanity — SpreadQuant vs chipnet pools');
    console.log('═══════════════════════════════════════════════════════════');

    const cache = CauldronPoolCache.forNetwork('chipnet');
    const pools = await cache.getPools();
    console.log(`  Chipnet pools: ${pools.length}`);
    if (pools.length === 0) {
        fail('No chipnet pools — cannot run sanity check');
        return;
    }

    await probe('EGGS', EGGS, pools, [10n, 100n, 1_000n, 10_000n, 100_000n]);
    await probe('ParyonUSD', PUSD, pools, [10n, 100n, 1_000n, 10_000n, 100_000n]);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(process.exitCode ? '  RESULT: FAILED' : '  RESULT: PASSED ✅');
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
