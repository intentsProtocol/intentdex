/**
 * e2e_decay_both_directions.ts — does the Dutch decay problem affect both swap
 * directions, and what exactly is the problem?
 *
 * ⚠️  BROADCASTS REAL TRANSACTIONS. Chipnet only.
 *
 * Two Dutch auctions are created with identical timing but opposite directions:
 *
 *   A  BCH -> Token   (solver must BUY the token: pre-fill, then fill)
 *   B  Token -> BCH   (solver pays from BCH it holds: fill, then rebalance)
 *
 * Both are priced deliberately UNPROFITABLE at their start price, so neither can
 * fill until the price decays. The test then samples, once a minute:
 *
 *   · the price the covenant would compute right now (from tx.locktime)
 *   · the price a naive wall-clock reading would suggest
 *   · whether median-time-past has advanced
 *
 * The covenant computes `elapsed = tx.locktime - startTime`, and any locktime we
 * can stamp is bounded by MTP, which only moves when a block is mined. So decay
 * cannot be smooth — it advances in block-sized steps. On a chain with 10-25
 * minute blocks a short auction goes from 0% to 100% decayed in a single jump,
 * skipping the entire price curve between.
 *
 * That matters economically: the maker is meant to be filled at the best price a
 * solver will accept along the curve, and instead gets the floor.
 *
 * Run:  npx tsx test/e2e_decay_both_directions.ts [minutes]
 */
import { Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { TestNetWallet, Config } from 'mainnet-js';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ElectrumSupervisor } from '../src/electrum.js';
import { getMedianTimePast, covenantNow } from '../src/bot/CovenantClock.js';
import { ENV } from '../src/config.js';

(Config as any).EnforceCashScript = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUTCH_ARTIFACT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/artifacts/DutchAuctionSwap.json'), 'utf8'));
const TOKEN = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

const MINUTES = parseFloat(process.argv[2] || '8');
const DURATION = 600n;          // 10 min of MTP-time — long enough to observe partial decay
const SELL_SATS = 60_000n;      // A: BCH locked
const SELL_TOKENS = 250n;       // B: tokens locked

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hhmm = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const txUrl = (id: string) => `https://chipnet.chaingraph.cash/tx/${id}`;
const reverseHex = (h: string) => h.match(/.{2}/g)!.reverse().join('');
const p2pkh = (pkh: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
function lb(a: string) { const r = cashAddressToLockingBytecode(a); if (typeof r === 'string') throw new Error(r); return r.bytecode; }

/** The price the covenant computes for a given locktime — mirrors DutchAuctionSwap.cash. */
function covenantPrice(lock: number, start: bigint, dur: bigint, sb: bigint, eb: bigint): bigint {
    const elapsed = BigInt(lock) - start;
    if (elapsed < 0n) return sb;
    const clamped = elapsed < dur ? elapsed : dur;
    return sb - ((sb - eb) * clamped) / dur;
}

(async () => {
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║  DUTCH DECAY — both directions, observed against the real clock       ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    const wif = ENV.RELAYER_PRIVATE_KEY_WIF
        ?? JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', ENV.WALLET_PATH), 'utf8')).wif;
    const wallet: any = await TestNetWallet.fromWIF(wif);
    const sig = new SignatureTemplate(wif);
    const selfPkh: Uint8Array = wallet.publicKeyHash;
    const cashaddr = wallet.cashaddr as string;
    const tokenaddr = wallet.tokenaddr as string;

    const sup = new ElectrumSupervisor('chipnet');
    await sup.start();
    const provider = sup.provider;

    const mtp0 = await getMedianTimePast(provider, 'chipnet', { force: true });
    const start = BigInt(covenantNow('chipnet'));
    const wall0 = Math.floor(Date.now() / 1000);
    console.log(`\nMTP at start : ${new Date(mtp0 * 1000).toISOString()}  (lag ${((wall0 - mtp0) / 60).toFixed(1)} min)`);
    console.log(`startTime    : ${start}   duration ${DURATION}s\n`);

    // Both priced ABOVE what a solver will pay, so only decay can rescue them.
    const A_START = 26n, A_END = 10n;                 // BCH -> Token: maker wants 26 units, floor 10
    const B_START = 1_400_000n, B_END = 700_000n;     // Token -> BCH: maker wants 1.4M sats, floor 700k

    const dutchA = new Contract(DUTCH_ARTIFACT, [
        selfPkh, '0x', `0x${reverseHex(TOKEN)}`, SELL_SATS, A_START, A_END, start, DURATION,
    ], { provider });
    const dutchB = new Contract(DUTCH_ARTIFACT, [
        selfPkh, `0x${reverseHex(TOKEN)}`, '0x', SELL_TOKENS, B_START, B_END, start, DURATION,
    ], { provider });

    console.log(`A  BCH->Token : ${dutchA.address}`);
    console.log(`B  Token->BCH : ${dutchB.address}\n`);

    // ── Fund both ───────────────────────────────────────────────────────────
    const seen = new Set<string>();
    const all = [...await provider.getUtxos(cashaddr), ...await provider.getUtxos(tokenaddr)]
        .filter((u: any) => { const k = `${u.txid}:${u.vout}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const bchUtxo: any = all.filter((u: any) => !u.token)
        .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)))[0];
    const tokUtxo: any = all.filter((u: any) => u.token?.category === TOKEN)
        .sort((a: any, b: any) => Number(BigInt(b.token.amount) - BigInt(a.token.amount)))[0];
    if (!bchUtxo || !tokUtxo) { console.error('need both a BCH and a token UTXO'); process.exit(2); }

    const tb = new TransactionBuilder({ provider });
    tb.addInput({ txid: tokUtxo.txid, vout: tokUtxo.vout, satoshis: BigInt(tokUtxo.satoshis),
                  token: { amount: BigInt(tokUtxo.token.amount), category: TOKEN } }, sig.unlockP2PKH());
    tb.addInput({ txid: bchUtxo.txid, vout: bchUtxo.vout, satoshis: BigInt(bchUtxo.satoshis) }, sig.unlockP2PKH());
    tb.addOutput({ to: lb(dutchA.address), amount: SELL_SATS });                                        // A: BCH
    tb.addOutput({ to: lb(dutchB.tokenAddress), amount: 6000n, token: { amount: SELL_TOKENS, category: TOKEN } }); // B: tokens
    const tokChange = BigInt(tokUtxo.token.amount) - SELL_TOKENS;
    if (tokChange > 0n) tb.addOutput({ to: p2pkh(selfPkh), amount: 7000n, token: { amount: tokChange, category: TOKEN } });
    const satIn = BigInt(tokUtxo.satoshis) + BigInt(bchUtxo.satoshis);
    tb.addOutput({ to: p2pkh(selfPkh), amount: satIn - SELL_SATS - 6000n - (tokChange > 0n ? 7000n : 0n) - 3000n });
    const fr = await tb.send();
    console.log(`funded both: ${txUrl(fr.txid)}\n`);

    // ── Sample the decay ────────────────────────────────────────────────────
    console.log('time      MTP moved   on-chain elapsed   A price      B price      wall-clock would say');
    console.log('─'.repeat(94));
    const deadline = Date.now() + MINUTES * 60_000;
    let prevMtp = mtp0, jumps = 0;

    while (Date.now() < deadline) {
        const mtp = await getMedianTimePast(provider, 'chipnet', { force: true });
        const lock = covenantNow('chipnet');
        const onChain = Math.max(0, lock - Number(start));
        const wallElapsed = Math.floor(Date.now() / 1000) - wall0;

        const pA = covenantPrice(lock, start, DURATION, A_START, A_END);
        const pB = covenantPrice(lock, start, DURATION, B_START, B_END);
        const wA = covenantPrice(Number(start) + wallElapsed, start, DURATION, A_START, A_END);
        const wB = covenantPrice(Number(start) + wallElapsed, start, DURATION, B_START, B_END);

        const moved = mtp !== prevMtp;
        if (moved) jumps++;
        console.log(
            `${hhmm()}  ${(moved ? `+${mtp - prevMtp}s` : '—').padEnd(10)}  ` +
            `${String(onChain).padStart(6)}/${DURATION}s      ` +
            `${String(pA).padStart(4)} u      ${String(pB).padStart(9)} sat   ` +
            `A=${wA}u B=${wB}sat  (wall ${wallElapsed}s)`
        );
        prevMtp = mtp;

        for (const [tag, c] of [['A', dutchA], ['B', dutchB]] as const) {
            const u = await provider.getUtxos(c.address);
            if (u.length === 0) console.log(`          ${tag}: covenant SPENT — solver acted`);
        }
        await sleep(60_000);
    }

    console.log('\n' + '═'.repeat(94));
    console.log(`  MTP advanced ${jumps} time(s) in ${MINUTES} minutes of wall clock.`);
    console.log('  Both directions share one startTime/duration and one clock, so they decay');
    console.log('  identically — direction changes only HOW the solver fills, never WHEN the');
    console.log('  covenant lets it. Any difference in the two price columns above would be');
    console.log('  the curve shape (26->10 vs 1.4M->700k), not the timing.');
    console.log('═'.repeat(94));
    await sup.stop();
    process.exit(0);
})().catch(e => { console.error('CRASHED:', e); process.exit(1); });
