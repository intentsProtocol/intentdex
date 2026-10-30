/**
 * /solana/* against a running server and the live Jupiter API (mainnet, read-only: nothing is signed).
 * Without JUPITER_API_KEY the server spaces Jupiter calls 2 s apart, so this suite takes about a minute.
 */
import { Keypair } from '@solana/web3.js';
import { http, serverUp } from '../lib/env.js';
import { check, finish, skip, suite } from '../lib/report.js';

suite('short/solana_swap');
if (!(await serverUp())) { skip('all Solana swap checks', 'server not running (npm run dev)'); process.exit(finish()); }

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const EMPTY = Keypair.generate().publicKey.toBase58();

const h = await http('GET', '/health');
if (!h.json?.solanaSwaps?.enabled) { skip('all Solana swap checks', 'JUPITER_ENABLED=false'); process.exit(finish()); }
check('/health reports the Solana swap module on mainnet', h.json.solanaSwaps.network === 'mainnet', { detail: JSON.stringify(h.json.solanaSwaps) });
// The operator can hold tokenized stocks back; the stock checks below follow the switch.
const stocksOn: boolean = (await http('GET', '/config')).json.solana.stocksEnabled;

// tokens
const tokens = await http('GET', '/solana/tokens?limit=5');
if (tokens.status !== 200 || !tokens.json?.total) { skip('live checks', `Jupiter not reachable from the server (${tokens.status} ${tokens.json?.error ?? ''})`); process.exit(finish()); }
check('GET /solana/tokens: verified list, paged', tokens.json.total > 1000 && tokens.json.tokens.length === 5 && tokens.json.tokens.every((t: any) => t.verified), { severity: 'HIGH', detail: `total ${tokens.json.total}` });
const usdc = await http('GET', `/solana/tokens/${USDC}`);
check('GET /solana/tokens/:mint: USDC, 6 decimals', usdc.status === 200 && usdc.json.symbol === 'USDC' && usdc.json.decimals === 6, { severity: 'HIGH' });
const byQ = await http('GET', '/solana/tokens?q=usdc&sort=liquidity&limit=3');
check('GET /solana/tokens?q=: the exact symbol ranks first', byQ.json.tokens[0]?.mint === USDC, { detail: byQ.json.tokens.map((t: any) => t.symbol).join(',') });
const search = await http('GET', '/solana/tokens/search?q=TSLAx');
check(`search returns unverified look-alikes, flagged${stocksOn ? ', next to the verified stock' : '; the stock itself is held back'}`, search.status === 200
    && search.json.tokens.some((t: any) => t.mint === TSLAX && t.verified) === stocksOn && search.json.tokens.some((t: any) => !t.verified), { severity: 'HIGH', detail: `${search.json.tokens?.length} results` });
check('search: short query → 400', (await http('GET', '/solana/tokens/search?q=a')).status === 400);
check('token: bad mint → 400', (await http('GET', '/solana/tokens/nope')).status === 400);
check('token: bad mint → code INVALID_MINT; short search → INVALID_REQUEST', (await http('GET', '/solana/tokens/nope')).json?.code === 'INVALID_MINT'
    && (await http('GET', '/solana/tokens/search?q=a')).json?.code === 'INVALID_REQUEST', { severity: 'HIGH' });

// stocks
if (stocksOn) {
    const stocks = await http('GET', '/solana/stocks?limit=10');
    check('GET /solana/stocks: stock tokens, most liquid first, with issuers', stocks.status === 200 && stocks.json.total > 100
        && stocks.json.tokens.every((t: any) => t.isStock && t.verified && t.stockIssuer) && stocks.json.issuers.xstocks > 0, { severity: 'HIGH', detail: `total ${stocks.json.total} ${JSON.stringify(stocks.json.issuers)}` });
    check('stocks sorted by liquidity', stocks.json.tokens[0].liquidity >= stocks.json.tokens[9].liquidity);
    const ondo = await http('GET', '/solana/stocks?issuer=ondo&limit=3');
    check('stocks?issuer=ondo', ondo.json.tokens.length > 0 && ondo.json.tokens.every((t: any) => t.stockIssuer === 'ondo'));
    check('stocks?minLiquidity filters', (await http('GET', '/solana/stocks?minLiquidity=100000')).json.total < stocks.json.total);
} else {
    const off = await http('GET', '/solana/stocks?limit=10');
    check('stocks held back: GET /solana/stocks → 403 STOCKS_DISABLED', off.status === 403 && off.json?.code === 'STOCKS_DISABLED', { severity: 'CRITICAL', detail: `${off.status} ${off.json?.code}` });
    check('stocks held back: none in the token list, and the stock mint is not found', (await http('GET', '/solana/tokens?tag=stocks&limit=5')).json.total === 0
        && (await http('GET', `/solana/tokens/${TSLAX}`)).status === 404, { severity: 'CRITICAL' });
}

// prices
const px = await http('GET', `/solana/prices?ids=${SOL},${TSLAX}`);
check('GET /solana/prices: SOL price, stock reference price', px.status === 200 && px.json[SOL]?.usdPrice > 0 && px.json[TSLAX]?.stockData?.price > 0, { detail: `SOL ${px.json?.[SOL]?.usdPrice}` });
check('prices: no ids → 400', (await http('GET', '/solana/prices')).status === 400);
check('prices: bad mint → code INVALID_MINT', (await http('GET', '/solana/prices?ids=nope')).json?.code === 'INVALID_MINT');

// quotes
const q = await http('GET', `/solana/quote?inputMint=${USDC}&outputMint=${SOL}&amount=10000000`);
check('quote 10 USDC → SOL: amounts, route, display', q.status === 200 && BigInt(q.json.outAmount) > 0n && q.json.route.length > 0
    && q.json.display.inAmount === '10.0' && q.json.display.outSymbol === 'SOL', { severity: 'CRITICAL', detail: `${q.json?.display?.outAmount} SOL via ${q.json?.router}, fee ${q.json?.feeBps} bps` });
const qs = await http('GET', `/solana/quote?inputMint=${USDC}&outputMint=${TSLAX}&amount=100000000`);
if (!stocksOn) check('stocks held back: a quote into a stock → 403 STOCKS_DISABLED', qs.status === 403 && qs.json?.code === 'STOCKS_DISABLED', { severity: 'CRITICAL', detail: `${qs.status} ${qs.json?.code}` });
else check('quote 100 USDC → TSLAx: stock warning', qs.status === 200 && qs.json.warnings.some((w: string) => /Tokenized stock/.test(w)), { severity: 'HIGH', detail: `${qs.json?.display?.outAmount} TSLAx, fee ${qs.json?.feeBps} bps` });
const qt = await http('GET', `/solana/quote?inputMint=${USDC}&outputMint=${SOL}&amount=10000000&taker=${EMPTY}`);
check('quote with an empty taker: takerCheck fails, no transaction leaked', qt.status === 200 && qt.json.takerCheck?.ok === false && !JSON.stringify(qt.json).includes('"transaction"'), { severity: 'HIGH', detail: JSON.stringify(qt.json?.takerCheck) });
for (const [name, path, errorCode] of [
    ['bad mint', `/solana/quote?inputMint=nope&outputMint=${SOL}&amount=1000`, 'INVALID_MINT'],
    ['same mint', `/solana/quote?inputMint=${SOL}&outputMint=${SOL}&amount=1000`, 'SAME_MINT'],
    ['decimal amount', `/solana/quote?inputMint=${USDC}&outputMint=${SOL}&amount=1.5`, 'INVALID_AMOUNT'],
    ['slippage over cap', `/solana/quote?inputMint=${USDC}&outputMint=${SOL}&amount=1000000&slippageBps=5000`, 'INVALID_SLIPPAGE'],
    ['bad taker', `/solana/quote?inputMint=${USDC}&outputMint=${SOL}&amount=1000000&taker=0xabc`, 'INVALID_ADDRESS'],
] as const) {
    const r = await http('GET', path);
    check(`quote rejects ${name} (400)`, r.status === 400, { detail: `${r.status} ${r.json?.error}` });
    check(`quote rejects ${name} with code ${errorCode}`, r.json?.code === errorCode, { severity: 'HIGH', detail: `${r.json?.code}` });
}

// swaps: an empty wallet cannot get a transaction
const c = await http('POST', '/solana/swaps', { inputMint: USDC, outputMint: SOL, amount: '10000000', taker: EMPTY });
// the wording depends on which router won the quote: Metis says "Insufficient funds", JupiterZ "Missing associated token account"
check('POST /solana/swaps with an empty wallet → 400 with the reason Jupiter gives', c.status === 400 && /insufficient|missing associated token account/i.test(c.json?.error ?? ''), { severity: 'HIGH', detail: `${c.status} ${c.json?.error}` });
check('POST /solana/swaps without taker → 400', (await http('POST', '/solana/swaps', { inputMint: USDC, outputMint: SOL, amount: '10000000' })).status === 400, { severity: 'HIGH' });
check('swap for an empty wallet: the code says the wallet cannot do it', c.json?.code === 'INSUFFICIENT_FUNDS' || c.json?.code === 'SWAP_NOT_BUILDABLE', { severity: 'HIGH', detail: `${c.json?.code}: ${c.json?.error}` });
check('codes: no taker → INVALID_ADDRESS, unknown swap → NOT_FOUND', (await http('POST', '/solana/swaps', { inputMint: USDC, outputMint: SOL, amount: '10000000' })).json?.code === 'INVALID_ADDRESS'
    && (await http('GET', '/solana/swaps/nope')).json?.code === 'NOT_FOUND', { severity: 'HIGH' });
check('GET unknown swap → 404', (await http('GET', '/solana/swaps/nope')).status === 404);
check('execute on unknown swap → 404', (await http('POST', '/solana/swaps/nope/execute', { signedTransaction: 'AAAA' })).status === 404);
const list = await http('GET', `/solana/swaps?address=${EMPTY}`);
check('GET /solana/swaps?address= → empty list', list.status === 200 && Array.isArray(list.json) && list.json.length === 0);
const bal = await http('GET', `/solana/balances?owner=${EMPTY}`);
check('GET /solana/balances: an empty wallet has 0 SOL and no tokens', bal.status === 200 && bal.json.balances.length === 1 && bal.json.balances[0].native === true && bal.json.balances[0].amount === '0' && bal.json.balances[0].symbol === 'SOL', { severity: 'HIGH', detail: JSON.stringify(bal.json).slice(0, 200) });
check('balances: bad owner → 400 INVALID_ADDRESS', (await http('GET', '/solana/balances?owner=nope')).json?.code === 'INVALID_ADDRESS');
const act = await http('GET', `/activity?address=${EMPTY}`);
check('GET /activity for a wallet with no history → no rows', act.status === 200 && Array.isArray(act.json.items) && act.json.items.length === 0);

process.exit(finish());
