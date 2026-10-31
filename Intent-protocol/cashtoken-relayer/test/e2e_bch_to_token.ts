/**
 * e2e_bch_to_token.ts — LIVE BCH → CashToken swap against the running relayer.
 *
 * ⚠️  BROADCASTS REAL TRANSACTIONS. Chipnet only.
 *
 * This is the route that actually matters commercially, and the one BCH→BCH
 * cannot exercise: a BCH→Token fill goes through the REAL router quote (not the
 * `overrideOK` shortcut), so it produces a genuine predicted profit, is gated by
 * ProfitPolicy, and should emit a profit-segregation output.
 *
 * Mirrors precisely what the frontend does for a market order:
 *
 *   POST /router/quote   → buyAmount (solver margin already deducted)
 *   POST /intent/create  → covenant address
 *   fund the covenant    → solver discovers, quotes, fills
 *
 * Then verifies on-chain that the maker actually received the token units and
 * reports which route the solver chose (DIRECT from inventory vs BCH_TO_TOKEN
 * via a Cauldron pre-fill) and how much profit was segregated.
 *
 * Run:  npx tsx test/e2e_bch_to_token.ts [orders] [sellSats]
 *       TOKEN=<categoryHex> npx tsx test/e2e_bch_to_token.ts 3 50000
 */
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { TestNetWallet, Config } from 'mainnet-js';
import { cashAddressToLockingBytecode, decodeTransaction, hexToBin, binToHex } from '@bitauth/libauth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ElectrumSupervisor } from '../src/electrum.js';
import { ENV } from '../src/config.js';

(Config as any).EnforceCashScript = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAYER = process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3006}`;
const TOKEN   = process.env.TOKEN || 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
const ORDERS  = parseInt(process.argv[2] || '3', 10);
const SELL    = BigInt(process.argv[3] || '50000');
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '240000', 10);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const txUrl = (id: string) => `https://chipnet.chaingraph.cash/tx/${id}`;

let passed = 0, failed = 0;
const ok  = (m: string) => { passed++; console.log(`  ✅ ${m}`); };
const bad = (m: string) => { failed++; console.error(`  ❌ ${m}`); };
const step = (m: string) => console.log(`\n${'─'.repeat(66)}\n── ${m}\n${'─'.repeat(66)}`);

function lb(a: string): Uint8Array {
    const r = cashAddressToLockingBytecode(a);
    if (typeof r === 'string') throw new Error(r);
    return r.bytecode;
}
function p2pkh(pkh: Uint8Array): Uint8Array {
    return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
}
async function api(method: 'GET' | 'POST', p: string, body?: any): Promise<any> {
    const res = await fetch(RELAYER + p, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : null;
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  LIVE BCH → CashToken swap test (REAL chipnet txs)              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`token=${TOKEN.slice(0, 16)}…  orders=${ORDERS}  sell=${SELL} sats each\n`);

    const health = await api('GET', '/health');
    if (health.routerPaused) { console.error('Router is PAUSED.'); process.exit(2); }
    console.log(`server: watching=${health.watching} active=${health.activeIntents} pools=${health.cauldronPools}`);

    const wallet: any = await TestNetWallet.fromWIF(
        ENV.RELAYER_PRIVATE_KEY_WIF
        || JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif,
    );
    const sig = new SignatureTemplate(
        ENV.RELAYER_PRIVATE_KEY_WIF
        || JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif,
    );
    const selfPkh: Uint8Array = wallet.publicKeyHash;
    const cashaddr = wallet.cashaddr as string;

    const sup = new ElectrumSupervisor('chipnet');
    await sup.start();
    const provider = sup.provider;

    // ── Step 1: quote exactly as the frontend does ──────────────────────────
    step('Step 1 — POST /router/quote (what the swap card shows the user)');
    const quote = await api('POST', '/router/quote', {
        sellToken: 'BCH', buyToken: TOKEN, sellAmount: SELL.toString(), network: 'chipnet',
    });
    const buyUnits = BigInt(quote.buyAmount);
    console.log(`  ${SELL} sats → ${buyUnits} units  (${(Number(SELL) / Number(buyUnits || 1n)).toFixed(0)} sats/unit)`);
    buyUnits > 0n ? ok('quote returned a fillable buyAmount') : bad('quote returned 0 — no route');
    if (buyUnits <= 0n) return finish(sup);

    const invBefore = await tokenBalance(provider, wallet, TOKEN);
    console.log(`  solver token inventory: ${invBefore.units} units across ${invBefore.utxos} UTXO(s)`);
    if (invBefore.utxos === 1 && ORDERS > 1) {
        console.log(`  ⚠️  only 1 token UTXO — a DIRECT fill reserves it, so later orders must`);
        console.log(`     route through a Cauldron pre-fill (that is itself worth observing)`);
    }

    // ── Step 2: create intents ──────────────────────────────────────────────
    step(`Step 2 — POST /intent/create × ${ORDERS}`);
    const orders: Array<{ id: string; address: string }> = [];
    for (let i = 0; i < ORDERS; i++) {
        const c = await api('POST', '/intent/create', {
            makerAddress: cashaddr,
            sellToken: 'BCH',
            buyToken: TOKEN,
            sellAmount: SELL.toString(),
            buyAmount: buyUnits.toString(),
            orderType: 'dutch',
            duration: 3600,
            network: 'chipnet',
        });
        orders.push({ id: c.intentId, address: c.contractAddress });
        console.log(`  ${c.intentId.slice(-6)}  ${c.contractAddress}`);
    }

    // ── Step 3: fund every covenant in one tx ───────────────────────────────
    step('Step 3 — fund covenants');
    const plain = (await provider.getUtxos(cashaddr)).filter((u: any) => !u.token)
        .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
    const src: any = plain[0];
    const need = SELL * BigInt(ORDERS) + 5000n;
    if (!src || BigInt(src.satoshis) < need) { bad(`no BCH UTXO ≥ ${need} sats`); return finish(sup); }

    const tb = new TransactionBuilder({ provider });
    tb.addInput({ txid: src.txid, vout: src.vout, satoshis: BigInt(src.satoshis) }, sig.unlockP2PKH());
    for (const o of orders) tb.addOutput({ to: lb(o.address), amount: SELL });
    tb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(src.satoshis) - SELL * BigInt(ORDERS) - 5000n });
    const fundRes = await tb.send();
    const t0 = Date.now();
    console.log(`  funding tx: ${txUrl(fundRes.txid)}`);
    console.log(`  ⏱  waiting for the solver…`);

    // ── Step 4: wait for settlement ─────────────────────────────────────────
    const settled = new Map<string, any>();
    while (Date.now() - t0 < TIMEOUT_MS && settled.size < orders.length) {
        await sleep(5000);
        for (const o of orders) {
            if (settled.has(o.id)) continue;
            const intent = await api('GET', `/intent/${o.id}`).catch(() => null);
            if (!intent) continue;
            if (['filled', 'refunded', 'cancelled', 'failed'].includes(intent.status)) {
                settled.set(o.id, intent);
                console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${o.id.slice(-6)} → ${intent.status}` +
                    ` route=${intent.routeType ?? '?'} ${intent.fillTxid ? txUrl(intent.fillTxid) : ''}`);
            }
        }
    }

    // ── Step 5: verify on-chain that the maker got the tokens ───────────────
    step('Step 5 — verify token delivery on-chain');
    const expectedMaker = binToHex(p2pkh(selfPkh));
    for (const o of orders) {
        const intent = settled.get(o.id);
        if (!intent) {
            const live = await api('GET', `/intent/${o.id}`).catch(() => null);
            bad(`${o.id.slice(-6)}: never settled (status=${live?.status ?? '?'})` +
                (live?.lastSkipReason ? `\n      skip: ${live.lastSkipReason.slice(0, 160)}` : ''));
            continue;
        }
        if (intent.status !== 'filled') { bad(`${o.id.slice(-6)}: status=${intent.status}`); continue; }

        const raw = await provider.getRawTransaction(intent.fillTxid);
        const tx = decodeTransaction(hexToBin(raw));
        if (typeof tx === 'string') { bad(`${o.id.slice(-6)}: cannot decode fill tx`); continue; }

        const out0 = tx.outputs[0];
        if (binToHex(out0.lockingBytecode) !== expectedMaker) { bad(`${o.id.slice(-6)}: output[0] not paid to maker`); continue; }
        if (!out0.token) { bad(`${o.id.slice(-6)}: output[0] carries no token`); continue; }
        const cat = binToHex(out0.token.category);
        const amt = out0.token.amount;
        if (cat !== TOKEN) { bad(`${o.id.slice(-6)}: wrong token category ${cat.slice(0, 16)}…`); continue; }
        amt >= buyUnits
            ? ok(`${o.id.slice(-6)}: maker received ${amt} units (≥ ${buyUnits}) via ${intent.routeType}`)
            : bad(`${o.id.slice(-6)}: maker received only ${amt} units, expected ≥ ${buyUnits}`);

        // Profit segregation — the thing BCH→BCH could never exercise
        const profitLbHex = ENV.RELAYER_PROFIT_ADDRESS ? binToHex(lb(ENV.RELAYER_PROFIT_ADDRESS)) : null;
        if (profitLbHex) {
            const seg = tx.outputs
                .filter(o2 => binToHex(o2.lockingBytecode) === profitLbHex)
                .reduce((s, o2) => s + o2.valueSatoshis, 0n);
            seg > 0n
                ? ok(`${o.id.slice(-6)}: profit segregated ${seg} sats → profit address`)
                : bad(`${o.id.slice(-6)}: NO profit output (predicted=${intent.expectedProfitAmount ?? '?'})`);
        }
        if (intent.preFillTxid) console.log(`      pre-fill (Cauldron): ${txUrl(intent.preFillTxid)}`);
    }

    const invAfter = await tokenBalance(provider, wallet, TOKEN);
    console.log(`\n  solver inventory: ${invBefore.units} → ${invAfter.units} units ` +
        `(delta ${invAfter.units - invBefore.units}), UTXOs ${invBefore.utxos} → ${invAfter.utxos}`);

    const routes = [...settled.values()].map(i => i.routeType).filter(Boolean);
    if (routes.length) console.log(`  routes chosen: ${routes.join(', ')}`);

    return finish(sup);
}

async function tokenBalance(provider: any, wallet: any, token: string) {
    const seen = new Set<string>();
    const utxos = [...await provider.getUtxos(wallet.cashaddr), ...await provider.getUtxos(wallet.tokenaddr)]
        .filter((u: any) => { const k = `${u.txid}:${u.vout}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .filter((u: any) => u.token?.category === token);
    return { units: utxos.reduce((s: bigint, u: any) => s + BigInt(u.token.amount), 0n), utxos: utxos.length };
}

async function finish(sup: ElectrumSupervisor) {
    await sup.stop();
    console.log(`\n${'═'.repeat(66)}`);
    console.log(`  RESULT: ${failed === 0 ? `ALL ${passed} CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
    console.log(`${'═'.repeat(66)}\n`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('\nTEST CRASHED:', e); process.exit(1); });
