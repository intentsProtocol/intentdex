/**
 * Quick script to check relayer profit status, filled intents, and wallet balance.
 */

import { ElectrumNetworkProvider } from 'cashscript';

const API = process.env.RELAYER_API_URL ?? 'http://localhost:3006';

async function main() {
    // 1. Health
    const health = await fetch(API + '/health').then(r => r.json());
    console.log('\n═══ RELAYER HEALTH ═══');
    console.log('  Status:', health.status);
    console.log('  Network:', health.network);
    console.log('  Watching:', health.watching, 'addresses');
    console.log('  Active intents:', health.activeIntents);
    console.log('  Router paused:', health.routerPaused);
    console.log('  Cauldron pools:', health.cauldronPools);

    // 2. Router status
    const status = await fetch(API + '/router/status').then(r => r.json());
    console.log('\n═══ ROUTER STATUS ═══');
    console.log('  Paused:', status.paused);
    console.log('  Mainnet pools:', status.mainnetPoolCount);
    console.log('  Chipnet pools:', status.chipnetPoolCount);
    console.log('  Total fills:', status.totalFills);
    console.log('  Total profit:', status.totalProfitSats, 'sats');
    console.log('  Recent routes:', status.recentRoutes.length);

    if (status.recentRoutes.length > 0) {
        console.log('\n  ── Recent Routes ──');
        for (const r of status.recentRoutes.slice(0, 10)) {
            const time = new Date(r.timestamp).toISOString();
            console.log('    ' + time + ' | ' + r.routeType + ' | profit=' + r.netProfitSats + ' sats | fill=' + (r.fillTxid || 'none') + (r.error ? ' | ERROR: ' + r.error : ''));
            if (r.fillExplorerUrl) console.log('      Explorer: ' + r.fillExplorerUrl);
            if (r.preFillExplorerUrl) console.log('      Pre-fill: ' + r.preFillExplorerUrl);
            if (r.postFillExplorerUrl) console.log('      Rebalance: ' + r.postFillExplorerUrl);
        }
    }

    // 3. Profit metrics
    const metrics = await fetch(API + '/router/metrics').then(r => r.json());
    console.log('\n═══ PROFIT METRICS ═══');
    if (!metrics.ready) {
        console.log('  Not ready:', metrics.reason);
    } else {
        console.log('  Policy:');
        console.log('    Min absolute:', metrics.policy.minAbsoluteSats, 'sats');
        console.log('    Min bps:', metrics.policy.minBps);
        console.log('    Max slippage:', metrics.policy.maxSlippageBps, 'bps');
        console.log('    Profit address:', metrics.policy.profitAddress || '(not set — stays in operating wallet)');
        console.log('  Totals:');
        console.log('    Total fills:', metrics.totalFills);
        console.log('    Total predicted:', metrics.totalPredictedSats, 'sats');
        console.log('    Total realized:', metrics.totalRealizedSats, 'sats');
        console.log('    Avg delta:', metrics.avgDeltaBps, 'bps');
        console.log('    Hit rate:', metrics.hitRate);
        console.log('    Avg slippage:', metrics.avgSlippageBps, 'bps');

        if (metrics.recentFills && metrics.recentFills.length > 0) {
            console.log('\n  ── Recent Fills (predicted vs realized) ──');
            for (const f of metrics.recentFills.slice(0, 10)) {
                console.log('    ' + f.routeType + ' | predicted=' + f.predictedSats + ' | realized=' + f.realizedSats + ' | delta=' + f.deltaBps + 'bps');
            }
        }

        if (metrics.byRouteType && Object.keys(metrics.byRouteType).length > 0) {
            console.log('\n  ── By Route Type ──');
            for (const [type, data] of Object.entries(metrics.byRouteType) as any) {
                console.log('    ' + type + ': fills=' + data.count + ' predicted=' + data.predictedSats + ' realized=' + data.realizedSats);
            }
        }
    }

    // 4. Completed intents (filled)
    const intents = await fetch(API + '/intents').then(r => r.json());
    const filled = (intents.completed || []).filter((i: any) => i.status === 'filled');
    const refunded = (intents.completed || []).filter((i: any) => i.status === 'refunded');

    console.log('\n═══ INTENT HISTORY ═══');
    console.log('  Active:', intents.active?.length || 0);
    console.log('  Completed:', intents.completed?.length || 0);
    console.log('  Filled:', filled.length);
    console.log('  Refunded:', refunded.length);

    if (filled.length > 0) {
        console.log('\n  ── Filled Intents (last 10) ──');
        for (const f of filled.slice(-10)) {
            const sell = f.sellToken === 'BCH' ? 'BCH' : f.sellToken.slice(0, 8) + '…';
            const buy = f.buyToken === 'BCH' ? 'BCH' : f.buyToken.slice(0, 8) + '…';
            console.log('    ' + f.id + ' | ' + sell + '→' + buy + ' | sell=' + f.sellAmount + ' buy=' + f.buyAmount);
            if (f.fillTxid) console.log('      Fill tx: ' + f.fillTxid);
            if (f.explorerUrl) console.log('      Explorer: ' + f.explorerUrl);
        }
    } else {
        console.log('\n  No intents have been filled yet by the solver.');
    }

    // 5. Wallet balance on chipnet
    console.log('\n═══ WALLET BALANCE (chipnet) ═══');
    try {
        const provider = new ElectrumNetworkProvider('chipnet');
        const relayerAddr = 'bchtest:qqmhr60gt2w2kz7aps6ds9rgv2e3f4ksdg3gye8det';
        const tokenAddr   = 'bchtest:zqmhr60gt2w2kz7aps6ds9rgv2e3f4ksdgkzh8ftxc';
        const utxos1 = await provider.getUtxos(relayerAddr);
        const utxos2 = await provider.getUtxos(tokenAddr);
        const all = [...utxos1, ...utxos2];

        const bchSats = all.filter((u: any) => !u.token).reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
        console.log('  tBCH: ' + (Number(bchSats) / 1e8).toFixed(8) + ' tBCH (' + bchSats + ' sats)');

        // Token balances
        const tokenMap = new Map<string, bigint>();
        for (const u of all) {
            if ((u as any).token) {
                const cat = (u as any).token.category;
                tokenMap.set(cat, (tokenMap.get(cat) || 0n) + BigInt((u as any).token.amount));
            }
        }

        // Fetch Cauldron token metadata for the active network
        const indexerUrl = health.network === 'mainnet'
            ? 'https://indexer.riften.net'
            : 'https://indexer-chipnet.riften.net';

        let cauldronTokens: any[] = [];
        try {
            const listRes = await fetch(`${indexerUrl}/cauldron/tokens/list_cached`);
            if (listRes.ok) {
                cauldronTokens = await listRes.json();
            }
        } catch (e: any) {
            console.log('  [Warning] Failed to fetch token list from Cauldron indexer:', e.message);
        }

        const symbolMap = new Map<string, string>();
        const decimalsMap = new Map<string, number>();
        for (const t of cauldronTokens) {
            const symbol = t.bcmr?.token?.symbol || t.display_symbol || 'UNKNOWN';
            const decimals = t.bcmr?.token?.decimals ?? 0;
            symbolMap.set(t.token_id, symbol);
            decimalsMap.set(t.token_id, decimals);
        }

        if (tokenMap.size > 0) {
            console.log('  CashToken Balances:');
            for (const [cat, amt] of tokenMap) {
                const symbol = symbolMap.get(cat) || 'UNKNOWN';
                const decimals = decimalsMap.get(cat) ?? 0;
                const formatted = decimals > 0
                    ? (Number(amt) / Math.pow(10, decimals)).toFixed(decimals)
                    : amt.toString();
                console.log(`    - ${symbol} (${cat.slice(0, 12)}…): ${formatted} units (raw: ${amt})`);
            }
        } else {
            console.log('  No CashTokens held in the wallet.');
        }
    } catch (e: any) {
        console.log('  Error fetching balance: ' + e.message);
    }

    console.log('\n═══════════════════════════════════════');
    if (filled.length > 0 || Number(metrics.totalRealizedSats || 0) > 0) {
        console.log('  💰 PROFIT STATUS: Active — fills recorded');
    } else {
        console.log('  📊 PROFIT STATUS: No fills executed yet');
        console.log('  The solver is scanning but has not filled any intents.');
        console.log('  This means either:');
        console.log('    1. No funded intents are on-chain (contracts need BCH/tokens deposited)');
        console.log('    2. Available intents are not profitable under current policy');
        console.log('       (min 1,500 sats AND 30 bps, max 500 bps slippage)');
        console.log('    3. The relayer lacks token inventory for direct fills');
    }
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
