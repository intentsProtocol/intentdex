/**
 * e2e_full_matrix.ts — LIVE full-lifecycle matrix against the running relayer.
 *
 * ⚠️  BROADCASTS ~30 REAL TRANSACTIONS. Chipnet only.
 *
 * Every order type crossed with every exit path, driven through the public API so
 * the running server does the solving:
 *
 *   FILLS
 *     A  LIMIT  BCH→BCH    × 6   DIRECT route
 *     B  DUTCH  BCH→BCH    × 6   DIRECT route, mid-decay
 *     C  LIMIT  BCH→Token  × 2   DIRECT from inventory or BCH_TO_TOKEN pre-fill
 *     D  DUTCH  BCH→Token  × 2   same, decaying price
 *     E  LIMIT  Token→BCH  × 2   TOKEN_TO_BCH, fill + post-fill rebalance
 *
 *   EXITS
 *     F  DUTCH  refund     × 2   auction ends unfilled → permissionless cancel()
 *     G  LIMIT  refund     × 2   past MTP expiry → permissionless cancel()
 *     H  LIMIT  cancelEarly× 2   maker-signed, any time, verified by the relayer
 *     I  never funded      × 1   → abandoned by the reaper
 *
 * F and G are made unfillable on purpose by naming a buy token that has no pool
 * and no inventory, so the only way out is the refund path.
 *
 * Requires the relayer running with DUTCH_FLOOR_GRACE_SEC=0 and a short
 * FUNDING_DEADLINE_SEC, otherwise F and I are not reachable in-window.
 *
 * Run:  npx tsx test/e2e_full_matrix.ts
 */
import { Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';
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
const LIMIT_ARTIFACT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/artifacts/LimitOrderSwap.json'), 'utf8'));

const POOL_TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';
/** Fabricated category: no pool, no inventory ⇒ guaranteed unfillable. */
const DEAD_TOKEN = 'dead'.repeat(16);

const SELL = 50_000n;      // sats locked per BCH-sell covenant
const BUY  = 40_000n;      // sats paid to maker on BCH→BCH
const TOKEN_SELL = 200n;   // token units locked per Token-sell covenant

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const txUrl = (id: string) => `https://chipnet.chaingraph.cash/tx/${id}`;
const reverseHex = (h: string) => h.match(/.{2}/g)!.reverse().join('');

let passed = 0, failed = 0;
const ok  = (m: string) => { passed++; console.log(`  ✅ ${m}`); };
const bad = (m: string) => { failed++; console.error(`  ❌ ${m}`); };
const section = (m: string) => console.log(`\n${'═'.repeat(70)}\n  ${m}\n${'═'.repeat(70)}`);

function p2pkh(pkh: Uint8Array) { return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]); }
function lb(a: string) { const r = cashAddressToLockingBytecode(a); if (typeof r === 'string') throw new Error(r); return r.bytecode; }

async function api(method: 'GET' | 'POST', p: string, body?: any): Promise<any> {
    const res = await fetch(RELAYER + p, {
        method, headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
}

interface Case {
    group: string;
    label: string;
    intentId: string;
    address: string;
    tokenAddress: string;
    expect: 'filled' | 'refunded' | 'cancelled' | 'abandoned';
    sellsToken?: boolean;
    /** For H: params needed to rebuild the covenant and sign cancelEarly(). */
    limitParams?: { buyAmount: bigint; expiryTime: bigint; buyCatLE: string };
    settledAs?: string;
    settleTx?: string;
    elapsedSec?: number;
}

let broadcasts = 0;

(async () => {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║  FULL LIFECYCLE MATRIX — live chipnet, ~30 real transactions        ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');

    const health = await api('GET', '/health');
    console.log(`server: watching=${health.watching} active=${health.activeIntents} pools=${health.cauldronPools}`);
    if (health.routerPaused) { console.error('router paused'); process.exit(2); }

    const wif = ENV.RELAYER_PRIVATE_KEY_WIF
        ?? JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif;
    const wallet: any = await TestNetWallet.fromWIF(wif);
    const sig = new SignatureTemplate(wif);
    const selfPkh: Uint8Array = wallet.publicKeyHash;
    const cashaddr = wallet.cashaddr as string;
    const tokenaddr = wallet.tokenaddr as string;
    const makerPk: Uint8Array = wallet.publicKeyCompressed ?? wallet.publicKey;

    const sup = new ElectrumSupervisor('chipnet');
    await sup.start();
    const provider = sup.provider;

    // ── Step 1: split funding UTXOs so 12+ concurrent fills aren't starved ──
    section('STEP 1 — stage solver funding UTXOs');
    {
        const plain = (await provider.getUtxos(cashaddr)).filter((u: any) => !u.token)
            .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
        const usable = plain.filter((u: any) => BigInt(u.satoshis) >= 45_000n && BigInt(u.satoshis) <= 200_000n);
        console.log(`  plain utxos=${plain.length}, fill-ready=${usable.length}`);
        if (usable.length < 20) {
            const need = 22 - usable.length;
            const src: any = plain[0];
            const per = 60_000n;
            const tb = new TransactionBuilder({ provider });
            tb.addInput({ txid: src.txid, vout: src.vout, satoshis: BigInt(src.satoshis) }, sig.unlockP2PKH());
            for (let i = 0; i < need; i++) tb.addOutput({ to: p2pkh(selfPkh), amount: per });
            tb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(src.satoshis) - per * BigInt(need) - 6000n });
            const r = await tb.send(); broadcasts++;
            console.log(`  split ${need} UTXOs: ${txUrl(r.txid)}`);
            await sleep(6000);
        } else console.log('  sufficient — skipping split');
    }

    // ── Step 2: create every intent ─────────────────────────────────────────
    section('STEP 2 — create intents via POST /intent/create');
    const cases: Case[] = [];

    const create = async (c: {
        group: string; label: string; orderType: 'limit' | 'dutch';
        sellToken: string; buyToken: string; sellAmount: bigint; buyAmount: bigint;
        duration?: number; expiryTime?: number; expect: Case['expect']; sellsToken?: boolean;
    }) => {
        const r = await api('POST', '/intent/create', {
            makerAddress: cashaddr,
            sellToken: c.sellToken, buyToken: c.buyToken,
            sellAmount: c.sellAmount.toString(), buyAmount: c.buyAmount.toString(),
            orderType: c.orderType,
            duration: c.duration ?? 3600,
            expiryTime: c.expiryTime ?? nowSec() + 3600,
            network: 'chipnet',
        });
        const buyCatRaw = c.buyToken === 'BCH' ? '' : c.buyToken;
        cases.push({
            group: c.group, label: c.label, intentId: r.intentId,
            address: r.contractAddress, tokenAddress: r.tokenAddress,
            expect: c.expect, sellsToken: c.sellsToken,
            limitParams: c.orderType === 'limit' ? {
                buyAmount: c.buyAmount,
                expiryTime: BigInt(c.expiryTime ?? nowSec() + 3600),
                buyCatLE: buyCatRaw ? `0x${reverseHex(buyCatRaw)}` : '0x',
            } : undefined,
        });
        return r;
    };

    // Quote the token routes the way the frontend does, so prices are fillable.
    const qBchToken = await api('POST', '/router/quote', {
        sellToken: 'BCH', buyToken: POOL_TOKEN, sellAmount: SELL.toString(), network: 'chipnet',
    });
    const tokenBuyUnits = BigInt(qBchToken.buyAmount);
    const qTokenBch = await api('POST', '/router/quote', {
        sellToken: POOL_TOKEN, buyToken: 'BCH', sellAmount: TOKEN_SELL.toString(), network: 'chipnet',
    });
    const tokenSellPayout = BigInt(qTokenBch.buyAmount);
    console.log(`  quotes: ${SELL} sats → ${tokenBuyUnits} units | ${TOKEN_SELL} units → ${tokenSellPayout} sats`);
    if (tokenBuyUnits <= 0n || tokenSellPayout <= 0n) { bad('token quotes unavailable — aborting'); process.exit(1); }

    for (let i = 0; i < 6; i++) await create({ group: 'A', label: `LIMIT BCH→BCH #${i+1}`, orderType: 'limit', sellToken: 'BCH', buyToken: 'BCH', sellAmount: SELL, buyAmount: BUY, expect: 'filled' });
    for (let i = 0; i < 6; i++) await create({ group: 'B', label: `DUTCH BCH→BCH #${i+1}`, orderType: 'dutch', sellToken: 'BCH', buyToken: 'BCH', sellAmount: SELL, buyAmount: BUY, expect: 'filled' });
    for (let i = 0; i < 2; i++) await create({ group: 'C', label: `LIMIT BCH→Token #${i+1}`, orderType: 'limit', sellToken: 'BCH', buyToken: POOL_TOKEN, sellAmount: SELL, buyAmount: tokenBuyUnits, expect: 'filled' });
    for (let i = 0; i < 2; i++) await create({ group: 'D', label: `DUTCH BCH→Token #${i+1}`, orderType: 'dutch', sellToken: 'BCH', buyToken: POOL_TOKEN, sellAmount: SELL, buyAmount: tokenBuyUnits, expect: 'filled' });
    for (let i = 0; i < 2; i++) await create({ group: 'E', label: `LIMIT Token→BCH #${i+1}`, orderType: 'limit', sellToken: POOL_TOKEN, buyToken: 'BCH', sellAmount: TOKEN_SELL, buyAmount: tokenSellPayout, expect: 'filled', sellsToken: true });
    // F: short auction, unfillable buy token ⇒ decays out and refunds
    for (let i = 0; i < 2; i++) await create({ group: 'F', label: `DUTCH refund #${i+1}`, orderType: 'dutch', sellToken: 'BCH', buyToken: DEAD_TOKEN, sellAmount: SELL, buyAmount: 1000n, duration: 60, expect: 'refunded' });
    // G: expiry already inside the MTP window, so cancel() becomes valid in ~60s
    for (let i = 0; i < 2; i++) await create({ group: 'G', label: `LIMIT refund #${i+1}`, orderType: 'limit', sellToken: 'BCH', buyToken: DEAD_TOKEN, sellAmount: SELL, buyAmount: 1000n, expiryTime: nowSec() - 7200 + 75, expect: 'refunded' });
    // H: maker cancels early; unfillable so the solver never races us
    for (let i = 0; i < 2; i++) await create({ group: 'H', label: `LIMIT cancelEarly #${i+1}`, orderType: 'limit', sellToken: 'BCH', buyToken: DEAD_TOKEN, sellAmount: SELL, buyAmount: 1000n, expect: 'cancelled' });
    // I: created and deliberately never funded
    await create({ group: 'I', label: 'never funded', orderType: 'limit', sellToken: 'BCH', buyToken: 'BCH', sellAmount: SELL, buyAmount: BUY, expect: 'abandoned' });

    const byGroup = cases.reduce((a, c) => (a[c.group] = (a[c.group] ?? 0) + 1, a), {} as Record<string, number>);
    console.log(`  created ${cases.length} intents: ${Object.entries(byGroup).map(([g, n]) => `${g}=${n}`).join(' ')}`);

    // ── Step 3: fund them ───────────────────────────────────────────────────
    section('STEP 3 — fund covenants');
    const toFundBch = cases.filter(c => c.expect !== 'abandoned' && !c.sellsToken);
    const toFundTok = cases.filter(c => c.sellsToken);
    const t0 = Date.now();

    {
        const plain = (await provider.getUtxos(cashaddr)).filter((u: any) => !u.token)
            .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
        const src: any = plain[0];
        const total = SELL * BigInt(toFundBch.length) + 8000n;
        if (BigInt(src.satoshis) < total) { bad(`largest UTXO ${src.satoshis} < ${total}`); process.exit(1); }
        const tb = new TransactionBuilder({ provider });
        tb.addInput({ txid: src.txid, vout: src.vout, satoshis: BigInt(src.satoshis) }, sig.unlockP2PKH());
        for (const c of toFundBch) tb.addOutput({ to: lb(c.address), amount: SELL });
        tb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(src.satoshis) - SELL * BigInt(toFundBch.length) - 8000n });
        const r = await tb.send(); broadcasts++;
        console.log(`  BCH covenants (${toFundBch.length}): ${txUrl(r.txid)}`);
    }

    if (toFundTok.length) {
        const seen = new Set<string>();
        const all = [...await provider.getUtxos(cashaddr), ...await provider.getUtxos(tokenaddr)]
            .filter((u: any) => { const k = `${u.txid}:${u.vout}`; if (seen.has(k)) return false; seen.add(k); return true; });
        const tokUtxo: any = all.filter((u: any) => u.token?.category === POOL_TOKEN)
            .sort((a: any, b: any) => Number(BigInt(b.token.amount) - BigInt(a.token.amount)))[0];
        const bchUtxo: any = all.filter((u: any) => !u.token)
            .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
        const need = TOKEN_SELL * BigInt(toFundTok.length);
        if (!tokUtxo || BigInt(tokUtxo.token.amount) < need) { bad(`not enough ${POOL_TOKEN.slice(0,10)} to fund Token→BCH cases`); }
        else {
            const tb = new TransactionBuilder({ provider });
            tb.addInput({ txid: tokUtxo.txid, vout: tokUtxo.vout, satoshis: BigInt(tokUtxo.satoshis), token: { amount: BigInt(tokUtxo.token.amount), category: POOL_TOKEN } }, sig.unlockP2PKH());
            tb.addInput({ txid: bchUtxo.txid, vout: bchUtxo.vout, satoshis: BigInt(bchUtxo.satoshis) }, sig.unlockP2PKH());
            for (const c of toFundTok) tb.addOutput({ to: lb(c.tokenAddress), amount: 5000n, token: { amount: TOKEN_SELL, category: POOL_TOKEN } });
            const change = BigInt(tokUtxo.token.amount) - need;
            if (change > 0n) tb.addOutput({ to: p2pkh(selfPkh), amount: 7000n, token: { amount: change, category: POOL_TOKEN } });
            const satIn = BigInt(tokUtxo.satoshis) + BigInt(bchUtxo.satoshis);
            const used = 5000n * BigInt(toFundTok.length) + (change > 0n ? 7000n : 0n);
            tb.addOutput({ to: p2pkh(selfPkh), amount: satIn - used - 3000n });
            const r = await tb.send(); broadcasts++;
            console.log(`  Token covenants (${toFundTok.length}): ${txUrl(r.txid)}`);
        }
    }
    console.log(`  ⏱  clock started`);

    // ── Step 4: maker-side cancelEarly for group H ──────────────────────────
    section('STEP 4 — maker cancelEarly() for group H');
    await sleep(8000);   // let the funding land
    for (const c of cases.filter(x => x.group === 'H')) {
        try {
            const lp = c.limitParams!;
            const contract = new Contract(LIMIT_ARTIFACT, [
                selfPkh, '0x', lp.buyCatLE, SELL, lp.buyAmount, lp.expiryTime,
            ], { provider });
            if (contract.address !== c.address) { bad(`${c.label}: rebuilt address mismatch — cannot sign safely`); continue; }

            const cov = await provider.getUtxos(contract.address);
            if (!cov.length) { bad(`${c.label}: covenant not funded yet`); continue; }
            const covUtxo: any = cov[0];
            const feeUtxo: any = (await provider.getUtxos(cashaddr)).filter((u: any) => !u.token)
                .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];

            const tb = new TransactionBuilder({ provider });
            tb.addInput({ txid: covUtxo.txid, vout: covUtxo.vout, satoshis: BigInt(covUtxo.satoshis) },
                contract.unlock.cancelEarly(binToHex(makerPk), sig));
            tb.addInput({ txid: feeUtxo.txid, vout: feeUtxo.vout, satoshis: BigInt(feeUtxo.satoshis) }, sig.unlockP2PKH());
            tb.addOutput({ to: p2pkh(selfPkh), amount: SELL });                       // covenant enforces this
            tb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(feeUtxo.satoshis) - 2000n });
            const r = await tb.send(); broadcasts++;
            console.log(`  ${c.label}: cancelEarly broadcast ${txUrl(r.txid)}`);

            const resp = await api('POST', `/intent/${c.intentId}/cancel`, { txid: r.txid });
            resp?.success ? ok(`${c.label}: relayer verified the cancel on-chain`)
                          : bad(`${c.label}: relayer rejected the cancel claim`);
            c.settleTx = r.txid;
        } catch (e: any) {
            bad(`${c.label}: ${e.message.slice(0, 160)}`);
        }
    }

    // ── Step 5: wait for the solver + reaper ────────────────────────────────
    section('STEP 5 — watch settlement');
    const DEADLINE_MS = 6 * 60 * 1000;
    const pending = () => cases.filter(c => !c.settledAs);
    let lastLog = 0;

    while (Date.now() - t0 < DEADLINE_MS && pending().length > 0) {
        await sleep(5000);
        for (const c of pending()) {
            const intent = await api('GET', `/intent/${c.intentId}`).catch(() => null);
            if (!intent) continue;
            if (['filled', 'refunded', 'cancelled', 'abandoned'].includes(intent.status)) {
                c.settledAs = intent.status;
                c.settleTx = intent.fillTxid ?? intent.refundTxid ?? intent.cancelTxid ?? c.settleTx;
                c.elapsedSec = (Date.now() - t0) / 1000;
                const mark = c.settledAs === c.expect ? '✓' : '✗';
                console.log(`  [${c.elapsedSec.toFixed(0)}s] ${mark} ${c.group} ${c.label} → ${c.settledAs}` +
                    (intent.routeType ? ` (${intent.routeType})` : ''));
            }
        }
        const el = (Date.now() - t0) / 1000;
        if (el - lastLog >= 45) {
            lastLog = el;
            console.log(`  ── t+${el.toFixed(0)}s: ${cases.length - pending().length}/${cases.length} settled`);
        }
    }

    // ── Report ──────────────────────────────────────────────────────────────
    section('REPORT');
    const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const desc: Record<string, string> = {
        A: 'LIMIT BCH→BCH fill', B: 'DUTCH BCH→BCH fill', C: 'LIMIT BCH→Token fill',
        D: 'DUTCH BCH→Token fill', E: 'LIMIT Token→BCH fill', F: 'DUTCH refund (cancel)',
        G: 'LIMIT refund (cancel)', H: 'LIMIT cancelEarly (maker)', I: 'never funded → abandoned',
    };
    for (const g of groups) {
        const gc = cases.filter(c => c.group === g);
        if (!gc.length) continue;
        const good = gc.filter(c => c.settledAs === c.expect);
        const lat = gc.filter(c => c.elapsedSec !== undefined).map(c => c.elapsedSec!);
        const latTxt = lat.length ? ` p50 ${lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)].toFixed(0)}s` : '';
        if (good.length === gc.length) ok(`${g} ${desc[g].padEnd(28)} ${good.length}/${gc.length} → ${gc[0].expect}${latTxt}`);
        else {
            bad(`${g} ${desc[g].padEnd(28)} ${good.length}/${gc.length} → expected ${gc[0].expect}`);
            for (const c of gc.filter(x => x.settledAs !== x.expect)) {
                const live = await api('GET', `/intent/${c.intentId}`).catch(() => null);
                console.log(`       ${c.label}: got '${c.settledAs ?? live?.status ?? '?'}'` +
                    (live?.lastSkipReason ? `\n         skip: ${live.lastSkipReason.slice(0, 150)}` : '') +
                    (live?.failReason ? `\n         fail: ${live.failReason.slice(0, 150)}` : ''));
            }
        }
    }

    // Route coverage actually exercised
    const routes = new Map<string, number>();
    for (const c of cases) {
        const live = await api('GET', `/intent/${c.intentId}`).catch(() => null);
        if (live?.routeType) routes.set(live.routeType, (routes.get(live.routeType) ?? 0) + 1);
    }
    console.log(`\n  routes exercised: ${[...routes].map(([r, n]) => `${r}×${n}`).join(', ') || 'none'}`);

    const status = await api('GET', '/router/status').catch(() => null);
    const metrics = await api('GET', '/router/metrics').catch(() => null);
    if (status) console.log(`  router: fills=${status.totalFills} profit=${status.totalProfitSats} sats`);
    if (metrics?.ready) console.log(`  ledger: predicted=${metrics.totalPredictedSats} realized=${metrics.totalRealizedSats} hitRate=${(metrics.hitRate*100).toFixed(0)}%`);
    const errs = (status?.recentRoutes ?? []).filter((r: any) => r.error);
    if (errs.length) { console.log(`\n  route errors (${errs.length}):`); for (const e of errs.slice(0, 6)) console.log(`    ${e.routeType}: ${e.error}`); }

    console.log(`\n  transactions broadcast by this test: ${broadcasts} (plus the solver's own fills/refunds)`);
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${failed === 0 ? `ALL ${passed} GROUP CHECKS PASSED ✅` : `${failed} FAILED ❌ (${passed} passed)`}`);
    console.log('═'.repeat(70));

    await sup.stop();
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('\nMATRIX CRASHED:', e); process.exit(1); });
