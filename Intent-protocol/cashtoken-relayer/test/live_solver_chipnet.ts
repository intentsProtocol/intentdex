/**
 * LIVE solver test on BCH chipnet — broadcasts REAL transactions.
 *
 * Unlike the other e2e scripts (which hand-build a "self-swap" tx and bypass
 * the solver), this drives the ACTUAL production solver classes end-to-end:
 *
 *     RelayerSolver.solve()  →  CauldronRouter.quote()  →  RelayerExecutor.execute()
 *
 * Scenario: a BCH→Token limit order filled from the relayer's own inventory
 * (the DIRECT route — no Cauldron pool dependency).
 *
 *   maker locks  SELL_SATS satoshis  in a LimitOrderSwap covenant
 *   maker wants  BUY_TOKENS units of TOKEN
 *   solver pays the tokens from inventory, claims the locked BCH, keeps the spread
 *
 * Real transactions broadcast (≈3):
 *   1. stage a token UTXO with enough BCH dust to fund a 2-input fill
 *   2. fund the covenant with SELL_SATS
 *   3. the solver's fill   (the thing under test)
 *
 * Run:  npx tsx test/live_solver_chipnet.ts
 * Needs: chipnet wallet (wallet.json or RELAYER_PRIVATE_KEY_WIF) with tBCH + the token.
 */
import { TestNetWallet, Config } from 'mainnet-js';
import { ElectrumNetworkProvider, Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RelayerSolver } from '../src/bot/DutchAuctionSolver.js';
import { RelayerExecutor } from '../src/bot/DutchAuctionExecutor.js';
import { CauldronPoolCache } from '../src/bot/CauldronPoolCache.js';
import { CauldronRouter } from '../src/bot/CauldronRouter.js';
import { loadPolicy } from '../src/bot/ProfitPolicy.js';
import { KNOWN_LIMIT_ORDERS } from '../src/registry.js';
import type { ScannedUtxo } from '../src/scanner.js';

(Config as any).EnforceCashScript = false;

// ── Parameters ─────────────────────────────────────────────────────────────────
const TOKEN = 'b4863d5773c7a269b6fe3b9f7ce2ce1098ab71c0b046ef2a39058d5e30b1f353'; // wallet holds 969k units
const BUY_TOKENS = 100n;     // tokens the maker wants
const SELL_SATS  = 30000n;   // BCH the maker locks (solver claims this)
const STAGE_TOKENS = 1000n;  // tokens parked on the fat inventory UTXO
const STAGE_SATS   = 8000n;  // dust on that UTXO (≥3500 so the DIRECT fill can pay its fee)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reverseHex = (h: string) => h.match(/.{2}/g)!.reverse().join('');
const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
const LIMIT_ARTIFACT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/artifacts/LimitOrderSwap.json'), 'utf8'));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const tx = (id: string) => `https://chipnet.chaingraph.cash/tx/${id}`;

let passed = 0, failed = 0;
const ok = (m: string) => { passed++; console.log(`  ✅ ${m}`); };
const bad = (m: string) => { failed++; console.error(`  ❌ ${m}`); };
const step = (m: string) => console.log(`\n── ${m} ──`);

function p2pkh(pkh: Uint8Array): Uint8Array {
    return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
}
function lb(address: string): Uint8Array {
    const r = cashAddressToLockingBytecode(address);
    if (typeof r === 'string') throw new Error(r);
    return r.bytecode;
}
async function dedupUtxos(provider: ElectrumNetworkProvider, cashaddr: string, tokenaddr: string) {
    const seen = new Set<string>();
    return [...await provider.getUtxos(cashaddr), ...await provider.getUtxos(tokenaddr)]
        .filter((u: any) => { const k = `${u.txid}:${u.vout}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
async function pollUtxo(provider: ElectrumNetworkProvider, address: string, txid: string, ms = 90_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const us = await provider.getUtxos(address);
        const hit = us.find((u: any) => u.txid === txid);
        if (hit) return hit;
        await sleep(3000);
    }
    return undefined;
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  LIVE Solver Test — BCH chipnet (broadcasts real transactions) ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    const wif = process.env.RELAYER_PRIVATE_KEY_WIF
        || JSON.parse(fs.readFileSync(path.resolve(__dirname, '../wallet.json'), 'utf8')).wif;
    const wallet: any = await TestNetWallet.fromWIF(wif);
    const provider = new ElectrumNetworkProvider('chipnet');
    const sig = new SignatureTemplate(wif);
    const selfPkh: Uint8Array = wallet.publicKeyHash;
    const cashaddr = wallet.cashaddr as string;
    const tokenaddr = wallet.tokenaddr as string;
    console.log(`Wallet: ${cashaddr}`);

    // ── Step 1: stage a fat token UTXO (so the DIRECT 2-input fill can pay its fee) ──
    step('Step 1 — stage inventory UTXO');
    let all = await dedupUtxos(provider, cashaddr, tokenaddr);
    let stagedUtxo = all.find((u: any) => u.token?.category === TOKEN && BigInt(u.satoshis) >= 3500n && BigInt(u.token.amount) >= BUY_TOKENS);
    if (stagedUtxo) {
        ok(`Already have a viable inventory UTXO (${(stagedUtxo as any).token.amount} tok / ${(stagedUtxo as any).satoshis} sats) — skipping staging`);
    } else {
        const tokenUtxo: any = all.find((u: any) => u.token?.category === TOKEN);
        if (!tokenUtxo) { bad(`No ${TOKEN.slice(0, 12)}… inventory to stage`); return done(); }
        const bchUtxo: any = all.filter((u: any) => !u.token).sort((a, b) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
        const totalTok = BigInt(tokenUtxo.token.amount);
        const tb = new TransactionBuilder({ provider });
        tb.addInput({ txid: tokenUtxo.txid, vout: tokenUtxo.vout, satoshis: BigInt(tokenUtxo.satoshis), token: { amount: totalTok, category: TOKEN } }, sig.unlockP2PKH());
        tb.addInput({ txid: bchUtxo.txid, vout: bchUtxo.vout, satoshis: BigInt(bchUtxo.satoshis) }, sig.unlockP2PKH());
        tb.addOutput({ to: p2pkh(selfPkh), amount: STAGE_SATS, token: { amount: STAGE_TOKENS, category: TOKEN } });
        if (totalTok > STAGE_TOKENS) tb.addOutput({ to: p2pkh(selfPkh), amount: 1000n, token: { amount: totalTok - STAGE_TOKENS, category: TOKEN } });
        tb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(tokenUtxo.satoshis) + BigInt(bchUtxo.satoshis) - STAGE_SATS - 1000n - 2000n });
        const r = await tb.send();
        console.log(`  staged tx: ${tx(r.txid)}`);
        stagedUtxo = await pollUtxo(provider, tokenaddr, r.txid);
        stagedUtxo ? ok(`Staged inventory UTXO confirmed in mempool`) : bad('staged UTXO did not appear');
        if (!stagedUtxo) return done();
    }

    // ── Step 2: build + fund the LimitOrderSwap covenant (maker sells BCH, wants TOKEN) ──
    step('Step 2 — create + fund the covenant');
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const contract = new Contract(LIMIT_ARTIFACT, [
        selfPkh,                       // makerPkh (maker == this wallet for the test)
        '0x',                          // sellTokenCategory = BCH
        `0x${reverseHex(TOKEN)}`,      // buyTokenCategory (little-endian)
        SELL_SATS, BUY_TOKENS, expiry,
    ], { provider });
    console.log(`  covenant: ${contract.address}`);

    all = await dedupUtxos(provider, cashaddr, tokenaddr);
    const fundBch: any = all.filter((u: any) => !u.token).sort((a, b) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
    const fundTb = new TransactionBuilder({ provider });
    fundTb.addInput({ txid: fundBch.txid, vout: fundBch.vout, satoshis: BigInt(fundBch.satoshis) }, sig.unlockP2PKH());
    fundTb.addOutput({ to: lb(contract.address), amount: SELL_SATS });
    fundTb.addOutput({ to: p2pkh(selfPkh), amount: BigInt(fundBch.satoshis) - SELL_SATS - 2000n });
    const fr = await fundTb.send();
    console.log(`  funding tx: ${tx(fr.txid)}`);
    const covUtxo: any = await pollUtxo(provider, contract.address, fr.txid);
    covUtxo ? ok(`Covenant funded with ${SELL_SATS} sats`) : bad('covenant UTXO did not appear');
    if (!covUtxo) return done();

    // ── Step 3: register the intent exactly as the API's /intent/create does ──
    step('Step 3 — register intent in the solver registry');
    KNOWN_LIMIT_ORDERS.length = 0;
    KNOWN_LIMIT_ORDERS.push({
        address: contract.address, makerPkh: selfPkh,
        sellTokenCategory: '0x', buyTokenCategory: `0x${TOKEN}`,
        sellAmount: SELL_SATS, buyAmount: BUY_TOKENS, expiryTime: expiry,
    });
    ok(`Registered limit order @ ${contract.address.slice(0, 24)}…`);

    // ── Step 4: SOLVER — match the on-chain UTXO to a known intent ──
    step('Step 4 — RelayerSolver.solve()');
    const scanned: ScannedUtxo = { address: contract.address, txid: covUtxo.txid, vout: covUtxo.vout, satoshis: BigInt(covUtxo.satoshis), token: covUtxo.token };
    const solver = new RelayerSolver('chipnet');
    const solution = solver.solve(scanned);
    if (!solution) { bad('solver returned no solution'); return done(); }
    ok(`Solver matched: type=${solution.type} price=${solution.currentPrice} (tokens to maker)`);
    console.log(`     sellAmount(claimed by solver)=${solution.params.sellAmount} sats, expired=${solution.isExpired}`);

    // ── Step 5: ROUTER — quote profitability + pick a route ──
    step('Step 5 — CauldronRouter.quote()');
    const cache = CauldronPoolCache.forNetwork('chipnet');
    const router = new CauldronRouter(cache, loadPolicy());
    const solverUtxos = await dedupUtxos(provider, cashaddr, tokenaddr);
    const quote = await router.quote(solution, solverUtxos as any);
    console.log(`     route=${quote.routeType} profitable=${quote.profitable} netProfit=${quote.netProfitSats} sats (${quote.effectiveBps}bps, slip ${quote.slippageBps}bps)`);
    console.log(`     reason: ${quote.reason}`);
    if (quote.profitable && quote.routeType === 'DIRECT') ok('Router chose DIRECT inventory fill and judged it profitable');
    else if (quote.profitable) ok(`Router judged profitable via ${quote.routeType}`);
    else bad(`Router rejected: ${quote.reason}`);

    // ── Step 6: EXECUTOR — build, sign and broadcast the fill ──
    step('Step 6 — RelayerExecutor.execute()  (broadcasts the fill)');
    solution.predictedProfitSats = quote.netProfitSats > 0n ? quote.netProfitSats : 0n;
    const executor = new RelayerExecutor();
    await executor.init(wallet, 'chipnet');
    const result = await executor.execute(solution);
    if (!result?.txid) { bad('executor returned no txid (see executor_debug.log)'); return done(); }
    console.log(`  FILL tx: ${tx(result.txid)}`);
    ok(`Fill broadcast: ${result.txid}`);

    // ── Step 7: VERIFY on-chain outcome ──
    step('Step 7 — verify outcome on-chain');
    await sleep(6000);
    const covAfter = await provider.getUtxos(contract.address);
    covAfter.length === 0 ? ok('Covenant UTXO consumed (order filled, not stranded)') : bad(`Covenant still has ${covAfter.length} UTXO(s)`);

    const fillUtxos = await provider.getUtxos(tokenaddr);
    const makerPaid = fillUtxos.find((u: any) => u.txid === result.txid && u.token?.category === TOKEN && BigInt(u.token.amount) >= BUY_TOKENS);
    makerPaid
        ? ok(`Maker received ${(makerPaid as any).token.amount} ${TOKEN.slice(0, 8)}… tokens (≥ ${BUY_TOKENS} required)`)
        : bad('Could not confirm maker token payout from the fill tx (may need a confirmation; check explorer)');

    done();
}

function done(): never {
    console.log(`\n═══ live_solver_chipnet: ${passed} passed, ${failed} failed ═══`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
