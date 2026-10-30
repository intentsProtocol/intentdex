/**
 * e2e_solana_swap.ts — one real Jupiter swap on Solana MAINNET through a running server, playing the user with
 * E2E_SOLANA_KEY: create the swap, sign the returned transaction, execute it, and check the wallet balances moved
 * by what the server recorded. Real money: keep the amounts tiny.
 *   PAIR=USDC-SOL AMOUNT=1 npx tsx scripts/e2e_solana_swap.ts      # 1 USDC → SOL
 *   PAIR=SOL-USDC AMOUNT=0.005 npx tsx scripts/e2e_solana_swap.ts  # 0.005 SOL → USDC
 *   PAIR=USDC-SPYx AMOUNT=1 ...                                    # any verified symbols the server knows
 */
import * as fs from 'fs';
import * as path from 'path';
import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { config } from '../src/config.js';
import { getSecret } from '../src/secrets.js';
import { parseSolanaSecret } from '../src/solana/SolanaAdapter.js';
import { BASE } from './e2e_lib.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const wallet = parseSolanaSecret(getSecret('E2E_SOLANA_KEY', { required: true }));
const owner = wallet.publicKey;
const conn = new Connection(config.jupiter.solanaRpcUrl, 'confirmed');

async function http(method: string, p: string, body?: unknown) {
    const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
}

async function token(symbol: string) {
    const r = await http('GET', `/solana/tokens?q=${encodeURIComponent(symbol)}&limit=1`);
    const t = r.json?.tokens?.[0];
    if (!t || t.symbol.toLowerCase() !== symbol.toLowerCase()) throw new Error(`token ${symbol} not found on the verified list`);
    return t as { mint: string; symbol: string; decimals: number; tokenProgram?: string };
}

/** Base-unit balance: lamports for SOL, the associated token account otherwise. */
async function balance(t: { mint: string; tokenProgram?: string }): Promise<bigint> {
    if (t.mint === WSOL) return BigInt(await conn.getBalance(owner));
    const program = t.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(new PublicKey(t.mint), owner, false, program);
    const b = await conn.getTokenAccountBalance(ata).catch(() => null);
    return b ? BigInt(b.value.amount) : 0n;
}

const [inSym, outSym] = (process.env.PAIR || 'USDC-SOL').split('-');
const ui = process.env.AMOUNT || (inSym === 'SOL' ? '0.005' : '1');
const tin = await token(inSym), tout = await token(outSym);
const amount = BigInt(Math.round(Number(ui) * 10 ** tin.decimals)).toString();

console.log(`wallet ${owner.toBase58()}  SOL ${(await conn.getBalance(owner)) / LAMPORTS_PER_SOL}`);
console.log(`swap ${ui} ${tin.symbol} → ${tout.symbol} (${amount} base units)`);
const inBefore = await balance(tin), outBefore = await balance(tout);
const solBefore = BigInt(await conn.getBalance(owner));

const t0 = Date.now();
const created = await http('POST', '/solana/swaps', { inputMint: tin.mint, outputMint: tout.mint, amount, taker: owner.toBase58() });
if (created.status !== 201) { console.log(`create refused: ${created.status} ${created.json?.error}`); process.exit(1); }
const { swap, quote, tx } = created.json;
console.log(`  swap ${swap.id}  router ${quote.router}  quoted ${quote.display.outAmount} ${tout.symbol} (min ${quote.display.minOutAmount})  fee ${quote.feeBps} bps  gasless ${quote.gasless}`);
for (const w of quote.warnings) console.log(`  warning: ${w}`);

const vtx = VersionedTransaction.deserialize(Buffer.from(tx.serializedTx, 'base64'));
vtx.sign([wallet]);
const tSigned = Date.now();
const exec = await http('POST', `/solana/swaps/${swap.id}/execute`, { signedTransaction: Buffer.from(vtx.serialize()).toString('base64') });
let s = exec.json;
if (exec.status === 502) {
    console.log('  execute reply lost; polling');
    for (let i = 0; i < 60 && !s?.terminal; i++) { await new Promise(r => setTimeout(r, 3000)); s = (await http('GET', `/solana/swaps/${swap.id}`)).json; }
} else if (exec.status !== 200) { console.log(`execute refused: ${exec.status} ${s?.error}`); process.exit(1); }
const tDone = Date.now();
console.log(`  ${s.status}  ${s.failReason ?? ''}  tx ${s.signature}`);

await new Promise(r => setTimeout(r, 4000));
const inAfter = await balance(tin), outAfter = await balance(tout), solAfter = BigInt(await conn.getBalance(owner));
const outDelta = (outAfter - outBefore).toString(), inDelta = (inBefore - inAfter).toString();
const ok = s.status === 'COMPLETED' && (tout.mint === WSOL ? true : outDelta === s.outAmount) && BigInt(outDelta) >= BigInt(s.minOutAmount) - (tout.mint === WSOL ? 10_000_000n : 0n);
console.log(`  received ${outDelta} (server says ${s.outAmount}, min ${s.minOutAmount})  spent ${inDelta} (server says ${s.inAmountSpent})  SOL change ${(Number(solAfter - solBefore) / LAMPORTS_PER_SOL).toFixed(6)}`);
console.log(`  timings: signed ${((tSigned - t0) / 1000).toFixed(1)} s · landed ${((tDone - tSigned) / 1000).toFixed(1)} s after signing`);
console.log(ok ? 'RESULT PASS' : 'RESULT FAIL');

fs.appendFileSync(path.resolve('tests', 'solana-swaps.jsonl'), JSON.stringify({
    at: new Date().toISOString(), pair: `${tin.symbol}-${tout.symbol}`, amount, ok, status: s.status, router: quote.router, gasless: quote.gasless,
    quoted: quote.outAmount, min: quote.minOutAmount, received: s.outAmount, balanceDelta: outDelta, signature: s.signature, landSec: (tDone - tSigned) / 1000, failReason: s.failReason,
}) + '\n');
process.exit(ok ? 0 : 1);
