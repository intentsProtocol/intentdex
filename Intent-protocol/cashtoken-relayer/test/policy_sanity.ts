/**
 * ProfitPolicy edge-case sanity. No network.
 */

import * as Policy from '../src/bot/ProfitPolicy.js';
import * as assert from 'assert';

const pass = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.error(`  ❌ ${m}`); process.exitCode = 1; };

const cfg: Policy.PolicyConfig = {
    minAbsoluteSats: 1500n,
    minBps:          30,
    maxSlippageBps:  500,
};

function check(name: string, input: Policy.EvalInput, expectAccept: boolean) {
    const r = Policy.evaluate(input, cfg);
    if (r.acceptable === expectAccept) pass(`${name} → ${r.acceptable} (${r.reason})`);
    else                                fail(`${name} → expected ${expectAccept}, got ${r.acceptable} (${r.reason})`);
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ProfitPolicy Sanity');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Policy: ${cfg.minAbsoluteSats} sats / ${cfg.minBps} bps / max slip ${cfg.maxSlippageBps} bps\n`);

    check('floor reject:      profit=500, value=10000, slip=10',  { profitSats:  500n, tradeValueSats: 10_000n, slippageBps:  10 }, false);
    check('bps reject:        profit=2000, value=10M, slip=10',   { profitSats: 2000n, tradeValueSats: 10_000_000n, slippageBps: 10 }, false);
    check('slippage reject:   profit=5000, value=10000, slip=600',{ profitSats: 5000n, tradeValueSats: 10_000n, slippageBps: 600 }, false);
    check('accept:            profit=2000, value=10000, slip=200',{ profitSats: 2000n, tradeValueSats: 10_000n, slippageBps: 200 }, true);
    check('accept (fat edge): profit=10000, value=20000, slip=0', { profitSats:10_000n, tradeValueSats: 20_000n, slippageBps:   0 }, true);
    check('zero trade value:  profit=1000, value=0,     slip=0',  { profitSats: 1000n, tradeValueSats:      0n, slippageBps:   0 }, false);

    // per-token override
    const cfgWithOverride: Policy.PolicyConfig = {
        ...cfg,
        perToken: { 'abc123': { minBps: 10, minAbsoluteSats: 500n } },
    };
    const r = Policy.evaluate(
        { profitSats: 500n, tradeValueSats: 10_000n, slippageBps: 5, tokenId: 'abc123' },
        cfgWithOverride
    );
    if (r.acceptable) pass(`per-token override applied (${r.reason})`);
    else              fail(`per-token override not applied (${r.reason})`);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(process.exitCode ? '  RESULT: FAILED' : '  RESULT: PASSED ✅');
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
