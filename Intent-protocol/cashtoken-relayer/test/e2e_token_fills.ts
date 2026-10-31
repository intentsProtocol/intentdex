/**
 * E2E test — BCH→Token fills with specific chipnet token categories
 *
 * Tests intent creation and optional fill for two known chipnet tokens.
 * The relayer fills if it holds the tokens directly; if not it logs the
 * Cauldron quote (which will be "no pools" on chipnet).
 *
 * Usage:
 *   npx tsx test/e2e_token_fills.ts
 *
 * Required env:
 *   RELAYER_PRIVATE_KEY_WIF  or  WALLET_PATH
 *
 * Optional:
 *   RELAYER_API_URL   (default http://localhost:3005)
 *   BUY_AMOUNT_SATS   token units to request (default 1000)
 */

import { TestNetWallet } from 'mainnet-js';
import { ElectrumNetworkProvider } from 'cashscript';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import * as fs from 'fs';

// ── Config ───────────────────────────────────────────────────────────────────

const TOKENS = [
    { name: 'Token A', category: 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b' },
    { name: 'Token B', category: '00929d9c87328052fe88af118e5d7e29ec24a1771fa8e826bd7485ced761d17f' },
];
const RELAYER_API = process.env.RELAYER_API_URL ?? 'http://localhost:3005';
const BUY_AMOUNT = BigInt(process.env.BUY_AMOUNT_SATS ?? '1000'); // token units to buy
const SELL_BCH_SATS = 10_000n;  // maker pays 10,000 sats for the tokens

// ── Helpers ──────────────────────────────────────────────────────────────────

const pass = (msg: string) => console.log(`  ✅ ${msg}`);
const warn = (msg: string) => console.warn(`  ⚠️  ${msg}`);
const info = (msg: string) => console.log(`  ℹ️  ${msg}`);

async function apiPost(path: string, body?: object) {
    const hasBody = body !== undefined;
    const res = await fetch(`${RELAYER_API}${path}`, {
        method: 'POST',
        headers: hasBody ? { 'content-type': 'application/json' } : {},
        body: hasBody ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function apiGet(path: string) {
    const res = await fetch(`${RELAYER_API}${path}`);
    return res.json();
}

async function waitForServer(maxWaitMs = 20_000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        try {
            await apiGet('/health');
            return true;
        } catch { await new Promise(r => setTimeout(r, 2000)); }
    }
    return false;
}

async function loadWallet(): Promise<TestNetWallet> {
    if (process.env.RELAYER_PRIVATE_KEY_WIF) {
        return TestNetWallet.fromWIF(process.env.RELAYER_PRIVATE_KEY_WIF);
    }
    const walletPath = process.env.WALLET_PATH ?? '../contracts-bch-swap/wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    return TestNetWallet.fromWIF(walletData.wif);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('════════════════════════════════════════════════');
    console.log('  BCH→Token Fill Test (chipnet)');
    console.log('════════════════════════════════════════════════');

    // Load wallet
    let wallet: TestNetWallet;
    try {
        wallet = await loadWallet();
    } catch (e: any) {
        console.error(`Cannot load wallet: ${e.message}`);
        process.exit(1);
    }
    const relayerAddr   = (wallet as any).cashaddr as string;
    const relayerTokAddr = (wallet as any).tokenaddr as string;
    console.log(`  Relayer address:  ${relayerAddr}`);
    console.log(`  Token address:    ${relayerTokAddr}`);

    // Check balances
    const provider = new ElectrumNetworkProvider('chipnet');
    const utxos1 = await provider.getUtxos(relayerAddr);
    const utxos2 = await provider.getUtxos(relayerTokAddr);
    const allUtxos = [...utxos1, ...utxos2];

    const bchBalance = allUtxos
        .filter((u: any) => !u.token)
        .reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);
    console.log(`  BCH balance:      ${Number(bchBalance) / 1e8} tBCH`);

    // Show token balances
    for (const { name, category } of TOKENS) {
        const bal = allUtxos
            .filter((u: any) => u.token?.category === category)
            .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);
        console.log(`  ${name} (${category.slice(0, 12)}…): ${bal} units`);
    }

    if (bchBalance < SELL_BCH_SATS + 5000n) {
        console.error(`  Insufficient BCH (need ${SELL_BCH_SATS + 5000n} sats min). Fund: https://tbch.googol.cash/`);
        process.exit(1);
    }

    // Check server
    console.log(`\n  Checking relayer API at ${RELAYER_API} …`);
    const serverUp = await waitForServer(15_000);
    if (!serverUp) {
        warn('Relayer API not reachable — start with "npm start" first');
        warn('Running quote-only tests (no intent creation)');
    } else {
        pass('Relayer API is up');
    }

    // ── Router quotes (read-only) ─────────────────────────────────────────────
    console.log('\n  ── Router Quotes ──');
    const cache  = CauldronPoolCache.forNetwork('chipnet');
    const router = new CauldronRouter(cache, 1n); // 1 sat min profit

    for (const { name, category } of TOKENS) {
        console.log(`\n  [${name}] category: ${category.slice(0, 16)}…`);
        console.log(`  Explorer: https://chipnet.chaingraph.cash/token/${category}`);

        const fakeSolution: any = {
            currentPrice: BUY_AMOUNT,
            params: {
                sellTokenCategory: '0x',           // maker sells BCH
                buyTokenCategory:  `0x${category}`, // maker wants this token
                sellAmount:        SELL_BCH_SATS,   // BCH the covenant locks
            },
            isExpired: false,
        };

        const quote = await router.quote(fakeSolution, allUtxos);
        console.log(`  Route type:  ${quote.routeType}`);
        console.log(`  Profitable:  ${quote.profitable}`);
        console.log(`  Reason:      ${quote.reason}`);

        // Check if relayer has inventory
        const relayerHasToken = allUtxos
            .filter((u: any) => u.token?.category === category)
            .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);

        if (relayerHasToken >= BUY_AMOUNT) {
            info(`Relayer holds ${relayerHasToken} units — can fill DIRECTLY (no Cauldron needed)`);
        } else {
            info(`Relayer holds ${relayerHasToken} units — needs Cauldron routing (chipnet: no pools available)`);
        }

        // ── Create intent ────────────────────────────────────────────────────
        if (!serverUp) { warn('Skipping intent creation (server offline)'); continue; }

        console.log(`\n  Creating BCH→Token intent for ${name}…`);
        console.log(`    Maker pays:  ${SELL_BCH_SATS} sats (${Number(SELL_BCH_SATS)/1e8} tBCH)`);
        console.log(`    Maker wants: ${BUY_AMOUNT} units of ${category.slice(0,12)}…`);

        let intentRes: any;
        try {
            intentRes = await apiPost('/intent/create', {
                makerAddress: relayerAddr,  // self-fill for test
                sellToken:    'BCH',
                buyToken:     category,
                sellAmount:   SELL_BCH_SATS.toString(),
                buyAmount:    BUY_AMOUNT.toString(),
                orderType:    'limit',
                expiryTime:   Math.floor(Date.now() / 1000) + 600,  // 10 min
                network:      'chipnet',
            });
        } catch (e: any) {
            warn(`Intent creation failed: ${e.message}`); continue;
        }

        if (!intentRes.success) {
            warn(`Intent creation error: ${intentRes.error}`); continue;
        }

        pass(`Intent created: ${intentRes.intentId}`);
        console.log(`\n  ┌─ Tracking Links ──────────────────────────────────────────`);
        console.log(`  │  Contract: ${intentRes.contractAddress}`);
        console.log(`  │  Explorer: ${intentRes.explorerUrl}`);
        console.log(`  │  Intent:   ${RELAYER_API}/intent/${intentRes.intentId}`);
        console.log(`  └───────────────────────────────────────────────────────────`);

        console.log(`\n  To trigger fill: send ${SELL_BCH_SATS} sats BCH to:`);
        console.log(`    ${intentRes.contractAddress}`);

        // Router status after intent creation
        const status = await apiGet('/router/status');
        console.log(`\n  Router status: paused=${status.paused}, mainnetPools=${status.mainnetPoolCount}`);
        console.log(`  Recent routes: ${status.recentRoutes.length} recorded`);
    }

    // ── Router status summary ─────────────────────────────────────────────────
    if (serverUp) {
        console.log('\n  ── Router Controls ──');
        console.log(`  Pause:   curl -X POST ${RELAYER_API}/router/pause`);
        console.log(`  Resume:  curl -X POST ${RELAYER_API}/router/resume`);
        console.log(`  Status:  curl ${RELAYER_API}/router/status`);
        console.log(`  Intents: curl ${RELAYER_API}/intents`);
    }

    console.log('\n════════════════════════════════════════════════');
    console.log('  Done.');
    console.log('════════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
