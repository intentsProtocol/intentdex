/** Solana swap module against a fake Jupiter: token/stock classification, validation, create → execute, recovery. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { SolanaSwapService, type SignatureCheck } from '../../src/jupiter/SolanaSwapService.js';
import { SwapStore } from '../../src/jupiter/SwapStore.js';
import { TokenCatalog, WSOL_MINT, toTokenView } from '../../src/jupiter/TokenCatalog.js';
import { JupiterError, type JupExecuteResult, type JupOrder, type JupToken, type JupiterApi } from '../../src/jupiter/types.js';
import { HttpError } from '../../src/types.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/jupiter');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const UNKNOWN = Keypair.generate().publicKey.toBase58();
const user = Keypair.generate();
const TAKER = user.publicKey.toBase58();

const TOKENS: JupToken[] = [
    { id: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL', decimals: 9, isVerified: true, tags: ['verified'], liquidity: 9e8 },
    { id: USDC, name: 'USD Coin', symbol: 'USDC', decimals: 6, isVerified: true, tags: ['verified', 'stable'], liquidity: 5e8, freezeAuthority: 'x' },
    { id: TSLAX, name: 'Tesla xStock', symbol: 'TSLAx', decimals: 8, isVerified: true, tags: ['verified', 'xstocks', 'stocks', 'rwa'], liquidity: 1.5e6, freezeAuthority: 'x', stats24h: { buyVolume: 10, sellVolume: 5 } },
    { id: Keypair.generate().publicKey.toBase58(), name: 'Tesla (Ondo)', symbol: 'TSLAon', decimals: 9, isVerified: true, tags: ['verified', 'ondo', 'stocks'], liquidity: 2e5 },
];

function signedTx(signer: Keypair, payer = signer): string {
    const msg = new TransactionMessage({
        payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([signer]);
    return Buffer.from(tx.serialize()).toString('base64');
}
const unsignedTx = () => {
    const msg = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message();
    return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
};

class FakeJupiter implements JupiterApi {
    orders: Record<string, string>[] = [];
    executes = 0;
    orderPatch: Partial<JupOrder> = {};
    executeImpl: () => Promise<JupExecuteResult> = async () => ({ status: 'Success', code: 0, signature: 'sig', totalInputAmount: '1000000', totalOutputAmount: '8600000' });
    async order(p: Record<string, string>): Promise<JupOrder> {
        this.orders.push(p);
        return {
            inputMint: p.inputMint, outputMint: p.outputMint, inAmount: p.amount, outAmount: '8700000', otherAmountThreshold: '8650000',
            slippageBps: Number(p.slippageBps ?? 50), priceImpact: -0.01, feeBps: 2, feeMint: WSOL_MINT, router: 'metis', gasless: false,
            routePlan: [{ percent: 100, swapInfo: { label: 'Whirlpool', inputMint: p.inputMint, outputMint: p.outputMint } }],
            transaction: p.taker ? unsignedTx() : null, requestId: 'req-1', lastValidBlockHeight: 123, ...this.orderPatch,
        };
    }
    async execute(): Promise<JupExecuteResult> { this.executes++; return this.executeImpl(); }
    async verifiedTokens() { return TOKENS; }
    async searchTokens(q: string) { return q === UNKNOWN ? [{ id: UNKNOWN, name: 'Rug', symbol: 'RUG', decimals: 6, tags: ['unknown'], audit: { isSus: true } }] : []; }
    async prices() { return {}; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-jup-'));
const api = new FakeJupiter();
const catalog = new TokenCatalog(api, 60_000);
const store = new SwapStore(dir);
let chain: 'confirmed' | 'failed' | 'unknown' = 'unknown';
const checkSig: SignatureCheck = async () => chain;
const opts = { maxSlippageBps: 1000, orderTtlSec: 120, landTimeoutSec: 180 };
const svc = new SolanaSwapService(api, store, catalog, opts, checkSig);
await catalog.verified();

const rejects = async (fn: () => Promise<unknown>, code: number) => { try { await fn(); return false; } catch (e) { return e instanceof HttpError && e.statusCode === code; } };

// tokens + stocks
const tsla = toTokenView(TOKENS[2]);
check('stock token: isStock, issuer from tags, freeze authority, 24h volume', tsla.isStock && tsla.stockIssuer === 'xstocks' && tsla.hasFreezeAuthority && tsla.volume24h === 15, { severity: 'HIGH' });
check('non-stock token has no issuer', !toTokenView(TOKENS[1]).isStock && toTokenView(TOKENS[1]).stockIssuer === undefined);
check('stocks filter + issuer filter', (await catalog.filter({ stocksOnly: true })).length === 2 && (await catalog.filter({ stocksOnly: true, issuer: 'ondo' }))[0].symbol === 'TSLAon', { severity: 'HIGH' });
check('q matches symbol, name and exact mint', (await catalog.filter({ q: 'tesla' })).length === 2 && (await catalog.filter({ q: USDC })).length === 1);
check('q ranks the exact symbol above longer matches', (await catalog.filter({ q: 'tslax', sort: 'liquidity' }))[0].symbol === 'TSLAx' && (await catalog.filter({ q: 'tsla' }))[0].symbol.startsWith('TSLA'));
check('sort=liquidity is descending', (await catalog.filter({ sort: 'liquidity' }))[0].symbol === 'SOL');
check('unverified token found through search, flagged', (await catalog.get(UNKNOWN))?.verified === false && (await catalog.get(UNKNOWN))?.suspicious === true, { severity: 'HIGH' });
check('stockIssuers counts', catalog.stockIssuers().xstocks === 1 && catalog.stockIssuers().ondo === 1);

// quote validation
const q = (o: object) => svc.quote({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', ...o });
check('quote rejects bad mint (400)', await rejects(() => q({ inputMint: 'nope' }), 400), { severity: 'HIGH' });
check('quote rejects same mint (400)', await rejects(() => q({ outputMint: USDC }), 400));
check('quote rejects decimal amount (400)', await rejects(() => q({ amount: '1.5' }), 400), { severity: 'HIGH' });
check('quote rejects zero amount (400)', await rejects(() => q({ amount: '0' }), 400));
check('quote rejects slippage above the cap (400)', await rejects(() => q({ slippageBps: '5000' }), 400), { severity: 'HIGH' });
check('quote rejects bad taker (400)', await rejects(() => q({ taker: '0xabc' }), 400));

const quote = await q({});
check('quote: amounts, min out, fee, route, display', quote.outAmount === '8700000' && quote.minOutAmount === '8650000' && quote.feeBps === 2
    && quote.route[0].label === 'Whirlpool' && quote.display.inAmount === '1.0' && quote.display.outAmount === '0.0087' && quote.takerCheck === undefined, { severity: 'HIGH', detail: JSON.stringify(quote.display) });
check('quote without taker sends no taker to Jupiter', api.orders.at(-1)!.taker === undefined);
check('quote to a stock warns about issuer restrictions', (await q({ outputMint: TSLAX })).warnings.some(w => /Tokenized stock/.test(w)), { severity: 'HIGH' });
check('quote to an unverified token warns', (await q({ outputMint: UNKNOWN })).warnings.some(w => /not on Jupiter's verified list/.test(w)), { severity: 'HIGH' });
api.orderPatch = { transaction: '', errorCode: 1, errorMessage: 'Insufficient funds' };
const qt = await q({ taker: TAKER });
check('quote with taker reports the balance check, never a transaction', qt.takerCheck?.ok === false && qt.takerCheck.message === 'Insufficient funds' && !('transaction' in qt) && !('tx' in qt), { severity: 'HIGH' });
check('create with insufficient funds → 400 with Jupiter\'s message', await rejects(() => svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER }), 400), { severity: 'HIGH' });
api.orderPatch = {};

// referral fee is sent only when configured
const withFee = new SolanaSwapService(api, store, catalog, { ...opts, referralAccount: 'RefAcct', referralFeeBps: 50 });
await withFee.quote({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1' });
check('referral account + fee passed to Jupiter when configured', api.orders.at(-1)!.referralAccount === 'RefAcct' && api.orders.at(-1)!.referralFee === '50', { severity: 'HIGH' });
await q({});
check('no referral params when not configured', api.orders.at(-1)!.referralAccount === undefined);

// create
check('create requires a taker (400)', await rejects(() => svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000' }), 400), { severity: 'HIGH' });
const c = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER, slippageBps: 100 });
check('create: CREATED, base64 tx, requestId kept server-side', c.swap.status === 'CREATED' && c.tx.serializedTx.length > 50 && c.swap.requestId === 'req-1' && c.swap.slippageBps === 100, { severity: 'CRITICAL' });
check('create: receiver equal to taker is dropped', (await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1', taker: TAKER, receiver: TAKER })).swap.receiver === undefined);

// execute
const id = c.swap.id;
check('execute rejects garbage (400)', await rejects(() => svc.execute(id, 'AAAA'), 400), { severity: 'HIGH' });
check('execute rejects a tx signed by someone else (400)', await rejects(() => svc.execute(id, signedTx(Keypair.generate())), 400), { severity: 'CRITICAL' });
check('execute rejects an unsigned tx (400)', await rejects(() => svc.execute(id, unsignedTx()), 400), { severity: 'CRITICAL' });
check('rejected executes never reached Jupiter', api.executes === 0 && store.get(id)?.status === 'CREATED', { severity: 'HIGH' });
const done = await svc.execute(id, signedTx(user));
check('execute success → COMPLETED with the delivered amount', done.status === 'COMPLETED' && done.outAmount === '8600000' && done.display.outAmount === '0.0086' && /solscan/.test(done.links.tx ?? ''), { severity: 'CRITICAL' });
check('the signed transaction is not exposed by the API', !('signedTransaction' in done) && !!store.get(id)?.signedTransaction, { severity: 'HIGH' });
const again = await svc.execute(id, signedTx(user));
check('execute on a finished swap is a no-op', again.status === 'COMPLETED' && api.executes === 1, { severity: 'HIGH' });

// Jupiter says Failed
const f = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
api.executeImpl = async () => ({ status: 'Failed', code: -1000, error: 'Failed to land', signature: 'sig2' });
const failed = await svc.execute(f.swap.id, signedTx(user));
check('execute Failed → FAILED with reason + code', failed.status === 'FAILED' && failed.failReason === 'Failed to land' && failed.jupiterCode === -1000, { severity: 'HIGH' });

// Jupiter refuses (4xx): nothing was sent
const r = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
api.executeImpl = async () => { throw new JupiterError('Order expired', 400, -1); };
check('execute 4xx from Jupiter → FAILED', (await svc.execute(r.swap.id, signedTx(user))).status === 'FAILED', { severity: 'HIGH' });

// reply lost: stays SUBMITTED, settled from the chain
const l = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
const lostTx = signedTx(user);
api.executeImpl = async () => { throw new JupiterError('Jupiter unreachable: timeout', 0); };
check('execute with no answer → 502, swap stays SUBMITTED', await rejects(() => svc.execute(l.swap.id, lostTx), 502) && store.get(l.swap.id)?.status === 'SUBMITTED', { severity: 'CRITICAL' });
check('a different tx for a submitted swap → 409', await rejects(() => svc.execute(l.swap.id, signedTx(user)), 409), { severity: 'HIGH' });
check('SUBMITTED + chain unknown → still SUBMITTED', (await svc.get(l.swap.id)).status === 'SUBMITTED');
chain = 'confirmed';
check('SUBMITTED + chain confirmed → COMPLETED', (await svc.get(l.swap.id)).status === 'COMPLETED', { severity: 'CRITICAL' });

const l2 = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
await svc.execute(l2.swap.id, signedTx(user)).catch(() => undefined);
chain = 'failed';
check('SUBMITTED + chain failed → FAILED', (await svc.get(l2.swap.id)).status === 'FAILED', { severity: 'HIGH' });

const l3 = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
const tx3 = signedTx(user);
await svc.execute(l3.swap.id, tx3).catch(() => undefined);
chain = 'unknown';
api.executeImpl = async () => ({ status: 'Success', code: 0, signature: 'sig3', totalOutputAmount: '1' });
check('same tx can be re-submitted after a lost reply', (await svc.execute(l3.swap.id, tx3)).status === 'COMPLETED', { severity: 'HIGH' });

const l4 = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
api.executeImpl = async () => { throw new JupiterError('boom', 500); };
await svc.execute(l4.swap.id, signedTx(user)).catch(() => undefined);
store.update(l4.swap.id, { submittedAt: Date.now() - 181_000 });
check('SUBMITTED, never seen on chain past the land timeout → FAILED', (await svc.get(l4.swap.id)).status === 'FAILED', { severity: 'HIGH' });

// expiry
const e = await svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER });
store.update(e.swap.id, { createdAt: Date.now() - 121_000 });
check('CREATED past the order TTL → EXPIRED', (await svc.get(e.swap.id)).status === 'EXPIRED', { severity: 'HIGH' });
check('execute on an EXPIRED swap → 409', await rejects(() => svc.execute(e.swap.id, signedTx(user)), 409));

// store + list
const s2 = new SwapStore(dir);
check('store reload keeps every swap and status', s2.get(id)?.status === 'COMPLETED' && s2.countByStatus().FAILED >= 3, { severity: 'CRITICAL' });
check('list by address', svc.list(TAKER).length >= 8 && svc.list(Keypair.generate().publicKey.toBase58()).length === 0);
check('unknown swap → 404', await rejects(() => svc.get('nope'), 404));

fs.rmSync(dir, { recursive: true, force: true });
process.exit(finish());
