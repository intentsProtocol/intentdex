/**
 * Read-only check that the Liquidium SDK works from this server: lists the pools and prices, and runs one
 * LTV calculation. Creates nothing and moves no funds.
 *
 *   npx tsx scripts/lend_spike.ts
 */
import { LiquidiumClient } from '@liquidium/client';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x), 1);

const client = new LiquidiumClient();
const started = Date.now();
const [pools, prices] = await Promise.all([client.market.listPools(), client.market.getAssetPrices()]);
console.log(`loaded in ${Date.now() - started} ms: ${pools.length} pools`);
console.log('first pool:', json(pools[0]));
console.log('pools:', pools.map(p => `${p.asset}/${p.chain}`).join(', '));
console.log('prices:', json(prices).slice(0, 900));

const btc = pools.find(p => p.asset === 'BTC' && p.chain === 'BTC');
const usdc = pools.find(p => p.asset === 'USDC' && p.chain === 'ETH');
if (btc && usdc) {
    const ltv = client.quote.calculateLtv(
        { collateralPoolId: btc.id, borrowPoolId: usdc.id, collateralAmount: 2_000_000n, borrowAmount: 500_000_000n },
        pools, prices as never,
    );
    console.log('quote 0.02 BTC / 500 USDC:', json(ltv));
}

// The same data through this server's own module, as its clients will see it.
const Fastify = (await import('fastify')).default;
const rateLimit = (await import('@fastify/rate-limit')).default;
const { registerLend } = await import('../src/lend/routes.js');
const os = await import('os'); const fs = await import('fs'); const path = await import('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lend-spike-'));
const app = Fastify();
await app.register(rateLimit, { global: false });
const lend = await registerLend(app, { dataDir: dir, pollSec: 0 });
const markets = (await app.inject({ method: 'GET', url: '/lend/markets' })).json();
console.log('/lend/markets:', markets.markets.map((m: { asset: string; priceUsd: number; supplyApy: number; borrowApy: number; maxLtvBps: number }) =>
    `${m.asset} $${m.priceUsd} supply ${m.supplyApy}% borrow ${m.borrowApy}% maxLtv ${m.maxLtvBps}`).join(' | '));
const quoted = (await app.inject({ method: 'POST', url: '/lend/quote', payload: { collateralAsset: 'BTC', borrowAsset: 'USDC', collateralAmount: '2000000', borrowAmount: '500000000' } })).json();
console.log('/lend/quote:', json(quoted));
lend.stop(); await app.close(); fs.rmSync(dir, { recursive: true, force: true });
