/**
 * e2e_lib.ts — plays the user against a running cctp-swap-server:
 * create transfer → sign the returned txs with the E2E wallet → post burn hash → poll until terminal →
 * check the recipient balance moved by exactly `received`. Records timings for docs/04-measurements.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { Transaction } from '@solana/web3.js';
import { getChain } from '../src/config.js';
import { getSecret } from '../src/secrets.js';
import { formatUsdc } from '../src/cctp/encoding.js';
import { EvmAdapter } from '../src/evm/EvmAdapter.js';
import { TxSender } from '../src/evm/TxSender.js';
import { SolanaAdapter, parseSolanaSecret } from '../src/solana/SolanaAdapter.js';
import type { BuiltTx, SpeedPref } from '../src/types.js';

export const BASE = process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3012}`;

export interface Route { n: number; src: string; dst: string; speed: SpeedPref; slow?: boolean; note: string }

export const ROUTES: Route[] = [
    { n: 1, src: 'eth-sepolia', dst: 'arc-testnet', speed: 'auto', note: 'Fast; mint on Arc (20 gwei floor, USDC gas)' },
    { n: 2, src: 'arc-testnet', dst: 'base-sepolia', speed: 'auto', note: 'Standard from Arc (~0.5 s attestation)' },
    { n: 3, src: 'base-sepolia', dst: 'arb-sepolia', speed: 'auto', note: 'Fast L2 → L2' },
    { n: 4, src: 'arb-sepolia', dst: 'solana-devnet', speed: 'auto', note: 'Solana mint: token account + receive_message' },
    { n: 5, src: 'solana-devnet', dst: 'arc-testnet', speed: 'auto', note: 'Solana burn: partly signed tx + event keypair' },
    { n: 6, src: 'solana-devnet', dst: 'base-sepolia', speed: 'auto', note: 'Standard from Solana (~25 s)' },
    { n: 7, src: 'base-sepolia', dst: 'op-sepolia', speed: 'standard', slow: true, note: 'Standard 15-19 min path' },
    { n: 8, src: 'eth-sepolia', dst: 'solana-devnet', speed: 'auto', note: 'Fast L1 → Solana mint' },
    { n: 9, src: 'solana-devnet', dst: 'eth-sepolia', speed: 'auto', note: 'Solana burn → L1 mint' },
    { n: 10, src: 'arc-testnet', dst: 'eth-sepolia', speed: 'auto', note: 'Arc burn (USDC gas) → L1 mint' },
    { n: 11, src: 'arc-testnet', dst: 'solana-devnet', speed: 'auto', note: 'Arc burn → Solana mint' },
    { n: 12, src: 'eth-sepolia', dst: 'solana-devnet', speed: 'standard', slow: true, note: 'Standard from Ethereum (15-19 min)' },
    { n: 13, src: 'eth-sepolia', dst: 'op-sepolia', speed: 'auto', note: 'Fast L1 → OP mint' },
    { n: 14, src: 'op-sepolia', dst: 'base-sepolia', speed: 'auto', note: 'Fast OP → Base' },
    { n: 15, src: 'base-sepolia', dst: 'solana-devnet', speed: 'auto', note: 'Fast Base → Solana mint' },
    { n: 16, src: 'solana-devnet', dst: 'op-sepolia', speed: 'auto', note: 'Solana burn → OP mint' },
    { n: 17, src: 'op-sepolia', dst: 'arc-testnet', speed: 'auto', note: 'Fast OP → Arc' },
    { n: 18, src: 'base-sepolia', dst: 'eth-sepolia', speed: 'auto', note: 'Fast Base → L1' },
    { n: 19, src: 'op-sepolia', dst: 'solana-devnet', speed: 'auto', note: 'Fast OP → Solana' },
    { n: 20, src: 'arb-sepolia', dst: 'eth-sepolia', speed: 'auto', note: 'Fast Arbitrum → L1' },
    { n: 21, src: 'op-sepolia', dst: 'arb-sepolia', speed: 'auto', note: 'Fast OP → Arbitrum' },
    { n: 22, src: 'arb-sepolia', dst: 'arc-testnet', speed: 'auto', note: 'Fast Arbitrum → Arc' },
    { n: 23, src: 'solana-devnet', dst: 'arb-sepolia', speed: 'auto', note: 'Solana burn → Arbitrum mint' },
];

export interface RouteResult {
    route: Route; ok: boolean; id?: string; status?: string; error?: string;
    amount: string; received?: string; balanceDelta?: string; speed?: string;
    sec?: { signed: number; burnConfirmed?: number; attested?: number; minted?: number; total: number };
    burnTx?: string; mintTx?: string;
    fee?: { amount: string; treasuryDelta: string; status?: string; tx?: string };
}

async function http(method: string, p: string, body?: unknown) {
    const res = await fetch(`${BASE}${p}`, {
        method, headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${json?.error ?? ''}`);
    return json;
}

export function e2eWallets() {
    const evm = getSecret('E2E_EVM_KEY', { required: true });
    const sol = getSecret('E2E_SOLANA_KEY', { required: true });
    return { evm: new ethers.Wallet(evm), sol: parseSolanaSecret(sol) };
}

const adapterFor = (key: string) => {
    const c = getChain(key)!;
    return c.kind === 'evm' ? new EvmAdapter(c) : new SolanaAdapter(c);
};

export async function signAndSend(srcKey: string, txs: BuiltTx[], opts: { skipFee?: boolean } = {}): Promise<{ burnHash: string; feeHash?: string }> {
    const w = e2eWallets();
    const chain = getChain(srcKey)!;
    let burnHash = '';
    let feeHash: string | undefined;
    for (const tx of txs) {
        if (tx.chain === 'evm') {
            if (tx.kind === 'fee' && opts.skipFee) continue;
            const a = new EvmAdapter(chain);
            const sender = new TxSender(w.evm.connect(a.provider), chain.chainId!, {
                floorGwei: tx.minMaxFeePerGasGwei, waitTimeoutMs: 120_000, maxBumps: 2, chainKey: `e2e:${chain.key}`,
            });
            const r = await sender.send({ to: tx.to, data: tx.data }, () => undefined);
            if (r.status !== 1) throw new Error(`${tx.kind} reverted: ${r.hash}`);
            if (tx.kind === 'burn') burnHash = r.hash;
            if (tx.kind === 'fee') feeHash = r.hash;
        } else {
            const a = new SolanaAdapter(chain);
            const t = Transaction.from(Buffer.from(tx.serializedTx, 'base64'));
            t.partialSign(w.sol);
            const sig = await a.connection.sendRawTransaction(t.serialize());
            const res = await a.connection.confirmTransaction({ signature: sig, blockhash: t.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight }, 'confirmed');
            if (res.value.err) throw new Error(`solana burn failed: ${JSON.stringify(res.value.err)}`);
            burnHash = sig;
        }
    }
    return { burnHash, feeHash };
}

const TERMINAL = new Set(['COMPLETED', 'COMPLETED_EXTERNAL', 'FAILED', 'EXPIRED']);

/** Create a transfer, sign and send its burn, report the hash; does not wait for delivery. For scenario tests. */
export async function startRoute(route: Route, amount = '1', opts: { skipFee?: boolean } = {}) {
    const w = e2eWallets();
    const srcC = getChain(route.src)!, dstC = getChain(route.dst)!;
    const sender = srcC.kind === 'evm' ? w.evm.address : w.sol.publicKey.toBase58();
    const recipient = dstC.kind === 'evm' ? w.evm.address : w.sol.publicKey.toBase58();
    const dstA = adapterFor(route.dst);
    const before = await dstA.usdcBalance(recipient);
    const created = await http('POST', '/transfers', { src: route.src, dst: route.dst, amount, sender, recipient, speed: route.speed });
    const id: string = created.transfer.id;
    let sent: { burnHash: string; feeHash?: string };
    try { sent = await signAndSend(route.src, created.txs, opts); }
    catch (e: any) {
        if (srcC.kind !== 'solana' || !/blockhash|expired/i.test(e.message)) throw e;
        sent = await signAndSend(route.src, (await http('POST', `/transfers/${id}/rebuild`)).txs, opts);
    }
    const burnTx = sent.burnHash;
    await http('POST', `/transfers/${id}/burn`, { txHash: burnTx, feeTxHash: sent.feeHash });
    return { id, burnTx, feeTx: sent.feeHash, txs: created.txs as BuiltTx[], recipient, before, quote: created.quote, balance: () => dstA.usdcBalance(recipient) };
}

/** Poll a transfer until it is terminal (or `until` returns true), tolerating a server that is briefly down. */
export async function waitTransfer(id: string, timeoutMs: number, until?: (t: any) => boolean): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let t: any;
    for (;;) {
        try { t = await http('GET', `/transfers/${id}`); } catch { t = undefined; }
        if (t && (TERMINAL.has(t.status) || until?.(t))) return t;
        if (Date.now() > deadline) throw new Error(`timeout in ${t?.status ?? 'unreachable server'} (${t?.lastError ?? ''})`);
        await new Promise(r => setTimeout(r, 1_000));
    }
}

export async function runRoute(route: Route, amount = process.env.AMOUNT || '1', log = console.log): Promise<RouteResult> {
    const out: RouteResult = { route, ok: false, amount };
    const w = e2eWallets();
    const srcC = getChain(route.src)!, dstC = getChain(route.dst)!;
    const sender = srcC.kind === 'evm' ? w.evm.address : w.sol.publicKey.toBase58();
    const recipient = dstC.kind === 'evm' ? w.evm.address : w.sol.publicKey.toBase58();
    const dstA = adapterFor(route.dst);
    try {
        const before = await dstA.usdcBalance(recipient);
        const t0 = Date.now();
        const created = await http('POST', '/transfers', { src: route.src, dst: route.dst, amount, sender, recipient, speed: route.speed });
        out.id = created.transfer.id; out.speed = created.quote.speed;
        const ourFee = BigInt(created.quote.protocolFee ?? '0');
        const treasury: string | undefined = created.quote.feeRecipient;
        const srcA = adapterFor(route.src);
        const treasuryBefore = ourFee > 0n && treasury ? await srcA.usdcBalance(treasury) : 0n;
        log(`  [${route.n}] ${route.src} → ${route.dst}  ${created.quote.speed}  fee≈${formatUsdc(created.quote.expectedFee)}${ourFee > 0n ? `  our fee ${formatUsdc(ourFee)}` : ''}  eta≈${created.quote.etaSec}s  id=${out.id}`);

        let txs: BuiltTx[] = created.txs;
        let sent: { burnHash: string; feeHash?: string };
        try { sent = await signAndSend(route.src, txs); }
        catch (e: any) {
            if (srcC.kind !== 'solana' || !/blockhash|expired/i.test(e.message)) throw e;
            txs = (await http('POST', `/transfers/${out.id}/rebuild`)).txs;
            sent = await signAndSend(route.src, txs);
        }
        const burnTx = sent.burnHash;
        out.burnTx = burnTx;
        const tSigned = Date.now();
        await http('POST', `/transfers/${out.id}/burn`, { txHash: burnTx, feeTxHash: sent.feeHash });
        log(`      burn ${burnTx}`);

        const deadline = Date.now() + (route.slow ? 40 : 8) * 60_000;
        let t: any;
        for (;;) {
            t = await http('GET', `/transfers/${out.id}`);
            if (TERMINAL.has(t.status)) break;
            if (Date.now() > deadline) throw new Error(`timeout in ${t.status} (${t.lastError ?? ''})`);
            await new Promise(r => setTimeout(r, 2_000));
        }
        out.status = t.status; out.received = t.received; out.mintTx = t.mintTxHash;
        const s = (x?: number) => (x ? Math.round((x - t0) / 100) / 10 : undefined);
        out.sec = { signed: s(tSigned)!, burnConfirmed: s(t.burnConfirmedAt), attested: s(t.attestedAt), minted: s(t.completedAt), total: s(Date.now())! };
        if (t.status !== 'COMPLETED') throw new Error(`ended ${t.status}: ${t.failReason ?? t.lastError ?? ''}`);

        // balance can lag on some RPCs; retry briefly
        let delta = 0n;
        for (let i = 0; i < 10; i++) {
            delta = (await dstA.usdcBalance(recipient)) - before;
            if (delta.toString() === t.received) break;
            await new Promise(r => setTimeout(r, 2_000));
        }
        out.balanceDelta = delta.toString();
        out.ok = delta.toString() === t.received;
        let feeNote = '';
        if (ourFee > 0n && treasury) {
            const got = (await srcA.usdcBalance(treasury)) - treasuryBefore;
            out.fee = { amount: ourFee.toString(), treasuryDelta: got.toString(), status: t.feeStatus, tx: sent.feeHash };
            const feeOk = got === ourFee && t.feeStatus === 'paid';
            out.ok = out.ok && feeOk;
            feeNote = `  fee ${feeOk ? 'PAID' : 'NOT VERIFIED'} ${formatUsdc(ourFee)} → treasury +${formatUsdc(got)} (${t.feeStatus})`;
        }
        log(`      ${out.ok ? 'OK' : 'MISMATCH'} received=${formatUsdc(t.received)} delta=${formatUsdc(delta)}${feeNote} mint=${t.mintTxHash}  timings(s)=${JSON.stringify(out.sec)}`);
    } catch (e: any) {
        out.error = e.message;
        log(`      ERROR ${e.message}`);
    }
    recordMeasurement(out);
    return out;
}

// ── measurements → tests/measurements.jsonl + ../docs/04-measurements.md ─────────
const MEAS = path.resolve('tests', 'measurements.jsonl');
const DOC = path.resolve('..', 'docs', '04-measurements.md');

function recordMeasurement(r: RouteResult) {
    fs.mkdirSync(path.dirname(MEAS), { recursive: true });
    fs.appendFileSync(MEAS, JSON.stringify({ at: new Date().toISOString(), src: r.route.src, dst: r.route.dst, speed: r.speed, ok: r.ok, status: r.status, error: r.error, amount: r.amount, received: r.received, sec: r.sec, burnTx: r.burnTx, mintTx: r.mintTx, fee: r.fee }) + '\n');
    try { renderMeasurements(); } catch { /* docs folder missing: jsonl still has the data */ }
}

export function renderMeasurements() {
    const rows = fs.readFileSync(MEAS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const ok = rows.filter(r => r.ok && r.sec);
    const byRoute = new Map<string, any[]>();
    for (const r of ok) { const k = `${r.src} → ${r.dst} (${r.speed})`; if (!byRoute.has(k)) byRoute.set(k, []); byRoute.get(k)!.push(r); }
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
    let md = `# 04 · Measured CCTP transfer times (testnet)\n\nGenerated by \`cctp-swap-server/scripts/e2e_lib.ts\` on ${new Date().toISOString().slice(0, 10)}. `
        + `Seconds from \`POST /transfers\` to each step, including the user signing and our relayer's mint. Testnet timings can differ from mainnet.\n\n`
        + `| Route | Runs | Burn confirmed (median) | Attested (median) | Minted (median) | Minted (max) |\n|---|---|---|---|---|---|\n`;
    for (const [k, rs] of byRoute) {
        const col = (f: string) => med(rs.map(r => r.sec[f]).filter((x: any) => typeof x === 'number'));
        md += `| ${k} | ${rs.length} | ${col('burnConfirmed')} | ${col('attested')} | ${col('minted')} | ${Math.max(...rs.map(r => r.sec.minted ?? 0))} |\n`;
    }
    const failed = rows.filter(r => !r.ok);
    if (failed.length) {
        md += `\n## Failed runs\n\n| When | Route | Status | Error |\n|---|---|---|---|\n`;
        for (const r of failed) md += `| ${r.at} | ${r.src} → ${r.dst} | ${r.status ?? '-'} | ${(r.error ?? '').replace(/\|/g, '\\|').slice(0, 160)} |\n`;
    }
    fs.writeFileSync(DOC, md);
}
