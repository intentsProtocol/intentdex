/** What the frontend relies on, without a network: error codes, /config, /activity rows, expiresAt, the swap sweep. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { config, getChain } from '../../src/config.js';
import { computeQuote, type QuoteInputs } from '../../src/cctp/quote.js';
import { parseAddresses, selectActivity, swapItem, transferItem } from '../../src/activity.js';
import { publicConfig } from '../../src/publicConfig.js';
import { SolanaSwapService, type SignatureCheck } from '../../src/jupiter/SolanaSwapService.js';
import { SwapStore } from '../../src/jupiter/SwapStore.js';
import { TokenCatalog, WSOL_MINT } from '../../src/jupiter/TokenCatalog.js';
import { JupiterError, type JupExecuteResult, type JupOrder, type JupToken, type JupiterApi, type SolanaSwap } from '../../src/jupiter/types.js';
import { TransferService } from '../../src/service/TransferService.js';
import { transferView } from '../../src/service/transferView.js';
import { Settings, type SolanaSettings } from '../../src/settings.js';
import { TransferStore } from '../../src/store/TransferStore.js';
import { Treasury } from '../../src/treasury/Treasury.js';
import { HttpError, defaultErrorCode, type Transfer, type TransferStatus } from '../../src/types.js';
import { sampleTransfer } from '../lib/fixtures.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/public_api');

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `cctp-${name}-`));
const codeOf = (fn: () => unknown): string => { try { fn(); return 'no error'; } catch (e) { return e instanceof HttpError ? `${e.statusCode} ${e.code}` : `not an HttpError: ${e}`; } };
const codeOfAsync = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return 'no error'; } catch (e) { return e instanceof HttpError ? `${e.statusCode} ${e.code}` : `not an HttpError: ${e}`; } };
const CHAIN_KEYS = config.chains.map(c => c.key);

// ── error codes: defaults ────────────────────────────────────────────────────
check('every status has a default code', [400, 403, 404, 409, 429, 502, 503, 500].map(defaultErrorCode).join()
    === 'INVALID_REQUEST,FORBIDDEN,NOT_FOUND,WRONG_STATE,RATE_LIMITED,UPSTREAM_ERROR,UNAVAILABLE,INTERNAL', { severity: 'HIGH' });
check('an error without a code takes the default; an explicit code wins', new HttpError(409, 'x').code === 'WRONG_STATE' && new HttpError(503, 'x', 'PAUSED').code === 'PAUSED', { severity: 'HIGH' });

// ── error codes: cross-chain quote ───────────────────────────────────────────
const base = getChain('base-sepolia')!, arb = getChain('arb-sepolia')!, arc = getChain('arc-testnet')!;
const FEES = [{ finalityThreshold: 1000, minimumFee: 1.3 }, { finalityThreshold: 2000, minimumFee: 0 }];
const q = (over: Partial<QuoteInputs>) => computeQuote({
    src: base, dst: arb, amount: 1_000_000n, pref: 'auto', fees: FEES, fastAllowanceUsdc: 1e9, onchainMinFee: 0n,
    feeBufferPct: 20, standardFastEnoughSec: 60, mintOverheadSec: 10, minTransfer: 1_000_000n, maxTransfer: 100_000_000n, ...over,
});
check('quote: below the minimum → 400 BELOW_MINIMUM', codeOf(() => q({ amount: 999_999n })) === '400 BELOW_MINIMUM', { severity: 'HIGH' });
check('quote: above the maximum → 400 ABOVE_MAXIMUM', codeOf(() => q({ amount: 100_000_001n })) === '400 ABOVE_MAXIMUM', { severity: 'HIGH' });
check('quote: same chain → 400 SAME_CHAIN', codeOf(() => q({ dst: base })) === '400 SAME_CHAIN');
check('quote: Fast from a Standard-only chain → 400 FAST_UNAVAILABLE', codeOf(() => q({ src: arc, pref: 'fast' })) === '400 FAST_UNAVAILABLE');
check('quote: Fast with no allowance left → 409 FAST_UNAVAILABLE', codeOf(() => q({ pref: 'fast', fastAllowanceUsdc: 0 })) === '409 FAST_UNAVAILABLE');
check('quote: fee eats the amount → 400 AMOUNT_TOO_SMALL', codeOf(() => q({ protocolFee: 1_000_000n })) === '400 AMOUNT_TOO_SMALL');

// ── error codes: transfers ───────────────────────────────────────────────────
const tdir = tmp('pub-t');
const settings = new Settings(tdir, CHAIN_KEYS);
const tstore = new TransferStore(tdir);
const fakeAdapter = (ok: boolean) => ({ validateAddress: () => ok, isValidTxHash: (h: string) => h.startsWith('0x') && h.length === 66 }) as any;
const adapters = new Map<string, any>([['base-sepolia', fakeAdapter(false)], ['arc-testnet', fakeAdapter(true)]]);
const tsvc = new TransferService(tstore, adapters, {} as any, settings);
const HASH = '0x' + 'ab'.repeat(32), HASH2 = '0x' + 'cd'.repeat(32);

check('unknown chain → 400 UNKNOWN_CHAIN', await codeOfAsync(() => tsvc.quote('nope', 'arc-testnet', '1', undefined)) === '400 UNKNOWN_CHAIN', { severity: 'HIGH' });
check('bad amount → 400 INVALID_AMOUNT', codeOf(() => TransferService.parseAmount('abc')) === '400 INVALID_AMOUNT' && codeOf(() => TransferService.parseAmount(undefined)) === '400 INVALID_AMOUNT');
check('bad speed → 400 INVALID_SPEED', codeOf(() => TransferService.parseSpeed('warp')) === '400 INVALID_SPEED');
check('bad sender → 400 INVALID_ADDRESS', await codeOfAsync(() => tsvc.create({ src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: 'x', recipient: 'y' })) === '400 INVALID_ADDRESS', { severity: 'HIGH' });
settings.patch({ cctp: { disabledRoutes: ['base-sepolia>arc-testnet'] } });
check('closed route → 503 ROUTE_CLOSED', await codeOfAsync(() => tsvc.quote('base-sepolia', 'arc-testnet', '1', undefined)) === '503 ROUTE_CLOSED', { severity: 'HIGH' });
settings.patch({ cctp: { disabledRoutes: [], fastEnabled: false } });
check('Fast switched off by the admin → 400 FAST_UNAVAILABLE', await codeOfAsync(() => tsvc.quote('base-sepolia', 'arc-testnet', '1', 'fast')) === '400 FAST_UNAVAILABLE');
settings.patch({ cctp: { fastEnabled: true, paused: true } });
check('paused → 503 PAUSED, for new transfers and for tracked burns', await codeOfAsync(() => tsvc.create({ src: 'base-sepolia', dst: 'arc-testnet', amount: '1', sender: 'x', recipient: 'y' })) === '503 PAUSED'
    && codeOf(() => tsvc.track('base-sepolia', HASH)) === '503 PAUSED', { severity: 'CRITICAL' });
settings.patch({ cctp: { paused: false } });

const plain = tstore.create(sampleTransfer());
check('unknown transfer → 404 NOT_FOUND', codeOf(() => tsvc.mustGet('nope')) === '404 NOT_FOUND');
check('fee hash for a transfer with no fee → 409 NO_FEE_DUE', codeOf(() => tsvc.submitFee(plain.id, HASH)) === '409 NO_FEE_DUE');
check('malformed burn hash → 400 INVALID_TX_HASH', codeOf(() => tsvc.submitBurn(plain.id, '0x1234')) === '400 INVALID_TX_HASH', { severity: 'HIGH' });
tsvc.submitBurn(plain.id, HASH);
check('a second, different burn hash → 409 WRONG_STATE', codeOf(() => tsvc.submitBurn(plain.id, HASH2)) === '409 WRONG_STATE', { severity: 'HIGH' });
const other = tstore.create(sampleTransfer());
check('a burn already claimed by another transfer → 409 BURN_ALREADY_REGISTERED', codeOf(() => tsvc.submitBurn(other.id, HASH)) === '409 BURN_ALREADY_REGISTERED', { severity: 'HIGH' });
const withFee = tstore.create(sampleTransfer({ protocolFee: '10000', feeStatus: 'pending', burnTxHash: HASH2, status: 'BURN_SUBMITTED' }));
check('the burn hash offered as the fee → 400 INVALID_TX_HASH', codeOf(() => tsvc.submitFee(withFee.id, HASH2)) === '400 INVALID_TX_HASH', { severity: 'HIGH' });

// ── Solana swaps against a fake Jupiter ──────────────────────────────────────
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const UNKNOWN = Keypair.generate().publicKey.toBase58();
const user = Keypair.generate();
const TAKER = user.publicKey.toBase58();
const TOKENS: JupToken[] = [
    { id: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL', decimals: 9, isVerified: true, tags: ['verified'], icon: 'https://img/sol.png' },
    { id: USDC, name: 'USD Coin', symbol: 'USDC', decimals: 6, isVerified: true, tags: ['verified', 'stable'], icon: 'https://img/usdc.png' },
    { id: TSLAX, name: 'Tesla xStock', symbol: 'TSLAx', decimals: 8, isVerified: true, tags: ['verified', 'xstocks', 'stocks'] },
];
const tx = (signer?: Keypair) => {
    const msg = new TransactionMessage({
        payerKey: user.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    }).compileToV0Message();
    const t = new VersionedTransaction(msg);
    if (signer) t.sign([signer]);
    return Buffer.from(t.serialize()).toString('base64');
};
class FakeJupiter implements JupiterApi {
    orderPatch: Partial<JupOrder> = {};
    orderError?: JupiterError;
    executeImpl: () => Promise<JupExecuteResult> = async () => ({ status: 'Success', code: 0, signature: 'sig', totalInputAmount: '1000000', totalOutputAmount: '8600000' });
    async order(p: Record<string, string>): Promise<JupOrder> {
        if (this.orderError) throw this.orderError;
        return {
            inputMint: p.inputMint, outputMint: p.outputMint, inAmount: p.amount, outAmount: '8700000', otherAmountThreshold: '8650000',
            slippageBps: Number(p.slippageBps ?? 50), feeBps: 2, feeMint: WSOL_MINT, router: 'metis', gasless: false, inUsdValue: 1,
            transaction: p.taker ? tx() : null, requestId: 'req-1', lastValidBlockHeight: 123, ...this.orderPatch,
        };
    }
    async execute(): Promise<JupExecuteResult> { return this.executeImpl(); }
    async verifiedTokens() { return TOKENS; }
    async searchTokens(query: string) { return query === UNKNOWN ? [{ id: UNKNOWN, name: 'Rug', symbol: 'RUG', decimals: 6, icon: 'https://img/rug.png' }] : []; }
    async prices() { return {}; }
}
const sdir = tmp('pub-s');
const api = new FakeJupiter();
const catalog = new TokenCatalog(api, 60_000);
const sstore = new SwapStore(sdir);
let onChain: 'confirmed' | 'failed' | 'unknown' = 'unknown';
const checkSig: SignatureCheck = async () => onChain;
let policy: Partial<SolanaSettings> = {};
const TTL = 120;
const ssvc = new SolanaSwapService(api, sstore, catalog, { maxSlippageBps: 1000, orderTtlSec: TTL, landTimeoutSec: 180, policy: () => policy }, checkSig);
await catalog.verified();
const order = (o: object = {}) => ({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER, ...o });

// error codes
check('swap: bad mint → 400 INVALID_MINT', await codeOfAsync(() => ssvc.quote(order({ inputMint: 'nope' }))) === '400 INVALID_MINT', { severity: 'HIGH' });
check('swap: same mint → 400 SAME_MINT', await codeOfAsync(() => ssvc.quote(order({ outputMint: USDC }))) === '400 SAME_MINT');
check('swap: decimal amount → 400 INVALID_AMOUNT', await codeOfAsync(() => ssvc.quote(order({ amount: '1.5' }))) === '400 INVALID_AMOUNT', { severity: 'HIGH' });
check('swap: slippage over the cap → 400 INVALID_SLIPPAGE', await codeOfAsync(() => ssvc.quote(order({ slippageBps: '5000' }))) === '400 INVALID_SLIPPAGE');
check('swap: bad taker → 400 INVALID_ADDRESS', await codeOfAsync(() => ssvc.quote(order({ taker: '0xabc' }))) === '400 INVALID_ADDRESS' && await codeOfAsync(() => ssvc.create(order({ taker: undefined }))) === '400 INVALID_ADDRESS');
policy = { stocksEnabled: false };
check('swap: stocks switched off → 403 STOCKS_DISABLED', await codeOfAsync(() => ssvc.quote(order({ outputMint: TSLAX }))) === '403 STOCKS_DISABLED', { severity: 'CRITICAL' });
check('swap: stocks off leaves other pairs open', (await ssvc.quote(order({ taker: undefined }))).outAmount === '8700000', { severity: 'HIGH' });
policy = { blockedMints: [USDC] };
check('swap: blocked mint → 403 TOKEN_BLOCKED', await codeOfAsync(() => ssvc.quote(order())) === '403 TOKEN_BLOCKED', { severity: 'HIGH' });
policy = { allowUnverified: false };
check('swap: unverified tokens switched off → 403 UNVERIFIED_DISABLED', await codeOfAsync(() => ssvc.quote(order({ outputMint: UNKNOWN }))) === '403 UNVERIFIED_DISABLED', { severity: 'HIGH' });
policy = { maxSwapUsd: 0.5 };
check('swap: above the size limit → 400 SWAP_TOO_LARGE', await codeOfAsync(() => ssvc.quote(order())) === '400 SWAP_TOO_LARGE');
policy = { paused: true };
check('swap: paused → 503 PAUSED', await codeOfAsync(() => ssvc.create(order())) === '503 PAUSED', { severity: 'CRITICAL' });
policy = {};
api.orderPatch = { transaction: '', errorCode: 1, errorMessage: 'Insufficient funds' };
check('swap: wallet cannot pay → 400 INSUFFICIENT_FUNDS', await codeOfAsync(() => ssvc.create(order())) === '400 INSUFFICIENT_FUNDS', { severity: 'HIGH' });
api.orderPatch = { transaction: '', errorMessage: 'Missing associated token account' };
check('swap: no transaction for another reason → 400 SWAP_NOT_BUILDABLE', await codeOfAsync(() => ssvc.create(order())) === '400 SWAP_NOT_BUILDABLE');
api.orderPatch = {};
api.orderError = new JupiterError('too many requests', 429);
check('swap: Jupiter rate limit → 429 RATE_LIMITED', await codeOfAsync(() => ssvc.quote(order())) === '429 RATE_LIMITED', { severity: 'HIGH' });
api.orderError = new JupiterError('Something unexpected occurred', 500);
check('swap: Jupiter failure → 502 UPSTREAM_ERROR', await codeOfAsync(() => ssvc.quote(order())) === '502 UPSTREAM_ERROR', { severity: 'HIGH' });
api.orderError = undefined;
check('swap: unknown id → 404 NOT_FOUND', await codeOfAsync(() => ssvc.get('nope')) === '404 NOT_FOUND');

// expiresAt on a swap
const t0 = Date.now();
const made = await ssvc.create(order());
check('created swap: expiresAt = createdAt + the order TTL, on the swap and on the tx', made.swap.expiresAt === made.swap.createdAt + TTL * 1000 && made.tx.expiresAt === made.swap.expiresAt
    && made.swap.expiresAt >= t0 + TTL * 1000, { severity: 'HIGH', detail: `${made.swap.expiresAt}` });
check('created swap: expiresInSec counts down from the TTL', made.swap.expiresInSec === TTL && made.tx.expiresInSec === TTL
    && ssvc.view(sstore.get(made.swap.id)!, made.swap.createdAt + 30_000).expiresInSec === TTL - 30 && ssvc.view(sstore.get(made.swap.id)!, made.swap.createdAt + 999_000).expiresInSec === 0, { severity: 'HIGH' });
check('created swap: token facts stored for the history row', sstore.get(made.swap.id)!.inDecimals === 6 && sstore.get(made.swap.id)!.outDecimals === 9
    && sstore.get(made.swap.id)!.inIcon === 'https://img/usdc.png' && made.swap.display.inAmount === '1.0', { severity: 'HIGH' });

check('swap: unsigned transaction → 400 INVALID_SIGNED_TX', await codeOfAsync(() => ssvc.execute(made.swap.id, tx())) === '400 INVALID_SIGNED_TX' && await codeOfAsync(() => ssvc.execute(made.swap.id, '')) === '400 INVALID_SIGNED_TX', { severity: 'CRITICAL' });
api.executeImpl = async () => { throw new JupiterError('Jupiter unreachable: timeout', 0); };
const signed = tx(user);
check('swap: no answer on execute → 502 RESULT_UNKNOWN', await codeOfAsync(() => ssvc.execute(made.swap.id, signed)) === '502 RESULT_UNKNOWN', { severity: 'CRITICAL' });
check('swap: a different transaction for a submitted swap → 409 TX_MISMATCH', await codeOfAsync(() => ssvc.execute(made.swap.id, tx(user))) === '409 TX_MISMATCH', { severity: 'HIGH' });
check('submitted swap: no expiry any more', ssvc.view(sstore.get(made.swap.id)!).expiresAt === undefined && ssvc.view(sstore.get(made.swap.id)!).expiresInSec === undefined, { severity: 'HIGH' });

// the sweep: lists read stored state, so something has to settle it
check('sweep: an unknown signature leaves the swap submitted', await ssvc.settleOpen() === 0 && sstore.get(made.swap.id)!.status === 'SUBMITTED');
check('list still reports SUBMITTED until the chain answers', ssvc.list(TAKER)[0].status === 'SUBMITTED');
onChain = 'confirmed';
check('sweep for another wallet does not touch this swap', await ssvc.settleOpen([Keypair.generate().publicKey.toBase58()]) === 0 && sstore.get(made.swap.id)!.status === 'SUBMITTED');
check('sweep: a lost reply is settled from the chain', await ssvc.settleOpen([TAKER]) === 1 && sstore.get(made.swap.id)!.status === 'COMPLETED', { severity: 'CRITICAL' });
onChain = 'unknown';
api.executeImpl = async () => ({ status: 'Success', code: 0, signature: 'sig', totalInputAmount: '1000000', totalOutputAmount: '8600000' });

const stale = await ssvc.create(order({ outputMint: UNKNOWN }));
check('unverified token: symbol, decimals and icon stored through search', sstore.get(stale.swap.id)!.outSymbol === 'RUG' && sstore.get(stale.swap.id)!.outDecimals === 6 && sstore.get(stale.swap.id)!.outIcon === 'https://img/rug.png', { severity: 'HIGH' });
check('unverified token: the view formats amounts with the stored decimals', stale.swap.display.quotedOutAmount === '8.7' && stale.swap.display.outSymbol === 'RUG', { severity: 'HIGH', detail: JSON.stringify(stale.swap.display) });
sstore.update(stale.swap.id, { createdAt: Date.now() - (TTL + 1) * 1000 });
check('list reports an unsigned swap as CREATED after its TTL', ssvc.list(TAKER).find(s => s.id === stale.swap.id)!.status === 'CREATED');
check('sweep: an unsigned swap past its TTL becomes EXPIRED', await ssvc.settleOpen() === 1 && sstore.get(stale.swap.id)!.status === 'EXPIRED', { severity: 'HIGH' });
check('swap: execute after expiry → 409 EXPIRED', await codeOfAsync(() => ssvc.execute(stale.swap.id, tx(user))) === '409 EXPIRED', { severity: 'HIGH' });
check('sweep with nothing open changes nothing', await ssvc.settleOpen() === 0);

// ── expiresAt on a transfer ──────────────────────────────────────────────────
const NOW = 1_800_000_000_000;
const ttlMs = config.limits.createdTtlMin * 60_000;
const fresh = transferView(sampleTransfer({ createdAt: NOW - 600_000 }), NOW);
check('unsigned transfer: expiresAt = createdAt + the created TTL', fresh.expiresAt === NOW - 600_000 + ttlMs && fresh.expiresInSec === (ttlMs - 600_000) / 1000, { severity: 'HIGH', detail: `${fresh.expiresInSec}s` });
check('unsigned transfer past its TTL: 0 seconds left, never negative', transferView(sampleTransfer({ createdAt: NOW - ttlMs - 5000 }), NOW).expiresInSec === 0);
check('a transfer whose burn is posted does not expire', (['BURN_SUBMITTED', 'BURN_CONFIRMED', 'ATTESTED', 'MINT_SUBMITTED', 'COMPLETED', 'FAILED', 'EXPIRED'] as TransferStatus[])
    .every(status => transferView(sampleTransfer({ status }), NOW).expiresAt === undefined), { severity: 'HIGH' });
check('a list mapped through the view keeps real countdowns (the map index is not the clock)', [sampleTransfer(), sampleTransfer()].map(t => transferView(t)).every(v => v.expiresInSec! > ttlMs / 1000 - 5), { severity: 'HIGH' });

// ── /config ──────────────────────────────────────────────────────────────────
const cdir = tmp('pub-c');
const cs = new Settings(cdir, CHAIN_KEYS);
const treasury = new Treasury(cdir);
let cfg = publicConfig(cs, treasury, config.chains, NOW);
check('/config: both products, networks, server time', cfg.serverTime === NOW && cfg.cctp.network === 'testnet' && cfg.solana.network === 'mainnet' && cfg.solana.nativeMint === WSOL_MINT, { severity: 'HIGH' });
check('/config: limits and TTLs match the settings and the env', cfg.cctp.minTransferUsdc === cs.cctp.minTransferUsdc && cfg.cctp.maxTransferUsdc === cs.cctp.maxTransferUsdc
    && cfg.cctp.createdTtlSec === config.limits.createdTtlMin * 60 && cfg.solana.orderTtlSec === config.jupiter.orderTtlSec
    && cfg.solana.slippage.maxBps === cs.solana.maxSlippageBps && cfg.solana.slippage.defaultBps === 0, { severity: 'HIGH' });
check('/config: every chain, with what a wallet needs and nothing private', cfg.cctp.chains.length === config.chains.length
    && cfg.cctp.chains.find(c => c.key === 'arc-testnet')?.minMaxFeePerGasGwei === 20 && cfg.cctp.chains.every(c => c.usdc && c.explorerTx)
    && !/rpc/i.test(JSON.stringify(cfg)), { severity: 'CRITICAL' });
check('/config: no fee collected without a rate', cfg.cctp.fee.bps === 0 && !cfg.cctp.fee.collecting.evm && !cfg.cctp.fee.collecting.solana && cfg.solana.fee.active === false);
cs.patch({ cctp: { feeBps: 25, feeMinUsdc: 0.01, gasFeeUsdc: { 'eth-sepolia': 0.05 } } });
cfg = publicConfig(cs, treasury, config.chains, NOW);
check('/config: a rate with no treasury wallet still collects nothing', cfg.cctp.fee.bps === 25 && cfg.cctp.fee.minUsdc === 0.01 && cfg.cctp.fee.gasUsdc['eth-sepolia'] === 0.05
    && !cfg.cctp.fee.collecting.evm && !cfg.cctp.fee.collecting.solana, { severity: 'HIGH' });
treasury.addExternal('evm', '0x6ccb65F44d1f33553e7DBC28b3C4870c8E0C5563');
cfg = publicConfig(cs, treasury, config.chains, NOW);
check('/config: collecting only where a treasury wallet exists', cfg.cctp.fee.collecting.evm && !cfg.cctp.fee.collecting.solana && cfg.cctp.fee.enforced === true, { severity: 'HIGH' });
cs.patch({ cctp: { paused: true, pauseReason: 'maintenance', disabledChains: ['op-sepolia'], disabledRoutes: ['base-sepolia>arc-testnet', 'op-sepolia>arc-testnet'] }, solana: { paused: true, stocksEnabled: false, defaultSlippageBps: 50, maxSwapUsd: 500 } });
cfg = publicConfig(cs, treasury, config.chains, NOW);
check('/config: pauses and their reason', cfg.cctp.paused && cfg.cctp.pauseReason === 'maintenance' && cfg.solana.paused, { severity: 'CRITICAL' });
check('/config: a closed chain is gone, and so are its routes', !cfg.cctp.chains.some(c => c.key === 'op-sepolia') && cfg.cctp.closedRoutes.join() === 'base-sepolia>arc-testnet', { severity: 'HIGH', detail: cfg.cctp.closedRoutes.join() });
check('/config: stocks switch, slippage default and size limit', cfg.solana.stocksEnabled === false && cfg.solana.slippage.defaultBps === 50 && cfg.solana.maxSwapUsd === 500, { severity: 'HIGH' });

// ── /activity rows ───────────────────────────────────────────────────────────
const titem = (over: Partial<Transfer>) => transferItem(transferView(sampleTransfer({ createdAt: NOW - 60_000, updatedAt: NOW, ...over }), NOW), getChain, 'testnet');
const PHASES: [TransferStatus, string][] = [
    ['CREATED', 'awaiting_signature'], ['BURN_SUBMITTED', 'processing'], ['BURN_CONFIRMED', 'processing'], ['ATTESTED', 'processing'], ['MINT_SUBMITTED', 'processing'],
    ['COMPLETED', 'completed'], ['COMPLETED_EXTERNAL', 'completed'], ['FAILED', 'failed'], ['EXPIRED', 'expired'],
];
check('transfer row: one phase for every status', PHASES.every(([status, phase]) => titem({ status }).phase === phase), { severity: 'HIGH', detail: PHASES.map(([s]) => `${s}→${titem({ status: s }).phase}`).join(' ') });
check('transfer row: terminal exactly for the four final statuses', PHASES.every(([status]) => titem({ status }).terminal === ['COMPLETED', 'COMPLETED_EXTERNAL', 'FAILED', 'EXPIRED'].includes(status)), { severity: 'HIGH' });
check('transfer row: held for our fee → action_needed', titem({ status: 'ATTESTED', protocolFee: '10000', feeStatus: 'awaiting' }).phase === 'action_needed'
    && titem({ status: 'ATTESTED', protocolFee: '10000', feeStatus: 'pending' }).phase === 'processing'
    && titem({ status: 'COMPLETED', protocolFee: '10000', feeStatus: 'awaiting' }).phase === 'completed', { severity: 'CRITICAL' });
const row = titem({ grossAmount: '1010000', amount: '1000000', protocolFee: '10000', feeStatus: 'pending', sender: '0xAbC0000000000000000000000000000000000001' });
check('transfer row: sell is what the user sent, on the source chain', row.sell.amount === '1010000' && row.sell.display === '1.01' && row.sell.symbol === 'USDC' && row.sell.decimals === 6
    && row.sell.chain === 'base-sepolia' && row.sell.chainName === 'Base Sepolia' && row.sell.token === base.usdc, { severity: 'HIGH', detail: JSON.stringify(row.sell) });
check('transfer row: buy is the expected amount until delivery, then the delivered amount', row.buy.amount === '999870' && row.buy.estimated === true && row.buy.chain === 'arc-testnet' && row.buy.token === arc.usdc
    && titem({ status: 'COMPLETED', received: '999871' }).buy.amount === '999871' && titem({ status: 'COMPLETED', received: '999871' }).buy.estimated === false, { severity: 'HIGH' });
check('transfer row: our fee with its status; none when there is no fee', row.fee?.amount === '10000' && row.fee.display === '0.01' && row.fee.status === 'pending' && titem({}).fee === undefined, { severity: 'HIGH' });
check('transfer row: owner, recipient, kind, product, USD value, countdown', row.owner === '0xAbC0000000000000000000000000000000000001' && row.kind === 'transfer' && row.product === 'cctp' && row.network === 'testnet'
    && row.usdValue === 1.01 && row.expiresInSec! > 0 && row.transfer?.src === 'base-sepolia' && row.transfer.selfMintAvailable === false);
const done = titem({ status: 'COMPLETED', burnTxHash: HASH, mintTxHash: HASH2, received: '999870' });
check('transfer row: links to both explorers', done.links.source === `https://sepolia.basescan.org/tx/${HASH}` && done.links.destination === `https://explorer.testnet.arc.io/tx/${HASH2}`, { severity: 'HIGH' });
check('transfer row: self-mint flagged while attested and not delivered', titem({ status: 'ATTESTED', message: '0x01', attestation: '0x02' }).transfer?.selfMintAvailable === true);
check('transfer row: a tracked burn with no destination yet still maps', titem({ origin: 'track', dst: '', status: 'BURN_SUBMITTED' }).buy.chain === '' && titem({ origin: 'track', dst: '', status: 'BURN_SUBMITTED' }).phase === 'processing');

const sitem = (id: string) => swapItem(ssvc.view(sstore.get(id)!));
const completed = sitem(made.swap.id), expired = sitem(stale.swap.id);
check('swap row: phases', completed.phase === 'completed' && completed.terminal && expired.phase === 'expired' && expired.terminal
    && swapItem(ssvc.view({ ...sstore.get(made.swap.id)!, status: 'CREATED' })).phase === 'awaiting_signature'
    && swapItem(ssvc.view({ ...sstore.get(made.swap.id)!, status: 'SUBMITTED' })).phase === 'processing'
    && swapItem(ssvc.view({ ...sstore.get(made.swap.id)!, status: 'FAILED', failReason: 'slippage' })).failReason === 'slippage', { severity: 'HIGH' });
check('swap row: both sides by mint, with symbol, decimals, icon and display', completed.sell.token === USDC && completed.sell.symbol === 'USDC' && completed.sell.decimals === 6 && completed.sell.display === '1.0'
    && completed.sell.icon === 'https://img/usdc.png' && completed.buy.token === WSOL_MINT && completed.buy.symbol === 'SOL' && completed.buy.chain === 'solana', { severity: 'HIGH', detail: JSON.stringify(completed.sell) });
check('swap row: settled from the chain has no delivered amount, so the quote is shown as an estimate', completed.buy.amount === '8700000' && completed.buy.estimated === true && completed.buy.display === '0.0087', { severity: 'HIGH' });
check('swap row: a delivered amount replaces the estimate', (() => { const r = swapItem(ssvc.view({ ...sstore.get(made.swap.id)!, outAmount: '8600000' })); return r.buy.amount === '8600000' && r.buy.estimated === false && r.buy.display === '0.0086'; })(), { severity: 'HIGH' });
check('swap row: an unverified token renders from the stored facts', expired.buy.symbol === 'RUG' && expired.buy.decimals === 6 && expired.buy.display === '8.7' && expired.buy.icon === 'https://img/rug.png', { severity: 'HIGH' });
check('swap row: owner, product, network, link, never the signed transaction', completed.owner === TAKER && completed.recipient === TAKER && completed.product === 'jupiter' && completed.network === 'mainnet'
    && completed.usdValue === 1 && completed.links.source?.startsWith('https://solscan.io/tx/') === true && !JSON.stringify(completed).includes(signed), { severity: 'CRITICAL' });

// ── /activity selection ──────────────────────────────────────────────────────
const A = '0xAAaa000000000000000000000000000000000001', B = '0xBBbb000000000000000000000000000000000002';
const S1 = Keypair.generate().publicKey.toBase58(), S2 = Keypair.generate().publicKey.toBase58();
const T = (id: string, createdAt: number, over: Partial<Transfer> = {}) => sampleTransfer({ id, createdAt, status: 'COMPLETED', ...over });
const SW = (id: string, createdAt: number, over: Partial<SolanaSwap> = {}): SolanaSwap => ({ ...sstore.get(made.swap.id)!, id, createdAt, taker: S1, receiver: undefined, status: 'COMPLETED', ...over });
const transfers = [
    T('t1', 100, { sender: A }), T('t2', 300, { sender: B, recipient: A }), T('t3', 500, { sender: B, recipient: S1 }),
    T('t4', 700, { sender: A, status: 'CREATED' }), T('t5', 900, { sender: A, status: 'EXPIRED' }), T('t6', 1100, { sender: B, status: 'FAILED', burnTxHash: HASH }),
];
const swaps = [SW('s1', 200), SW('s2', 400, { taker: S2, receiver: S1 }), SW('s3', 600, { taker: S2 }), SW('s4', 800, { status: 'CREATED' }), SW('s5', 1000, { status: 'SUBMITTED' })];
const ids = (addresses: string[], limit = 50, before?: number) => selectActivity(transfers, swaps, { addresses, limit, before }, {
    transfer: t => transferItem(transferView(t), getChain, 'testnet'), swap: s => swapItem(ssvc.view(s)),
}).map(i => i.id).join();

check('activity: a wallet sees what it sent and what it receives, newest first', ids([A]) === 't5,t4,t2,t1', { severity: 'CRITICAL', detail: ids([A]) });
check('activity: EVM addresses match in any letter case', ids([A.toLowerCase()]) === 't5,t4,t2,t1' && ids([A.toUpperCase().replace('0X', '0x')]) === 't5,t4,t2,t1', { severity: 'HIGH' });
check('activity: a Solana wallet sees its swaps, swaps sent to it and transfers sent to it', ids([S1]) === 's5,s4,t3,s2,s1', { severity: 'CRITICAL', detail: ids([S1]) });
check('activity: Solana addresses match exactly', ids([S1.toLowerCase()]) === '');
check('activity: an EVM and a Solana address give one merged list', ids([A, S1]) === 's5,t5,s4,t4,t3,s2,t2,s1,t1', { severity: 'CRITICAL', detail: ids([A, S1]) });
check('activity: another wallet sees nothing of these', ids(['0xCCcc000000000000000000000000000000000003']) === '', { severity: 'HIGH' });
check('activity: limit keeps the newest', ids([A, S1], 3) === 's5,t5,s4', { severity: 'HIGH' });
check('activity: before is a cursor on createdAt', ids([A, S1], 3, 800) === 't4,t3,s2' && ids([A, S1], 50, 100) === '', { severity: 'HIGH', detail: ids([A, S1], 3, 800) });
check('public feed: everything that reached a chain, nothing unsigned or expired', ids([]) === 't6,s5,s3,t3,s2,t2,s1,t1', { severity: 'CRITICAL', detail: ids([]) });
let mapped = 0;
selectActivity(transfers, swaps, { addresses: [], limit: 2 }, { transfer: t => { mapped++; return transferItem(transferView(t), getChain, 'testnet'); }, swap: s => { mapped++; return swapItem(ssvc.view(s)); } });
check('activity: only the rows of the page are mapped', mapped === 2);

check('addresses: repeated and comma-separated, trimmed, de-duplicated', parseAddresses([`${A}, ${S1}`, A]).join() === `${A},${S1}` && parseAddresses(A).join() === A && parseAddresses(undefined).length === 0 && parseAddresses('').length === 0, { severity: 'HIGH' });
check('addresses: more than five → 400 INVALID_ADDRESS', codeOf(() => parseAddresses(Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58()))) === '400 INVALID_ADDRESS', { severity: 'HIGH' });
check('addresses: anything that is not a wallet → 400 INVALID_ADDRESS', codeOf(() => parseAddresses('0x1234')) === '400 INVALID_ADDRESS' && codeOf(() => parseAddresses('<script>')) === '400 INVALID_ADDRESS'
    && codeOf(() => parseAddresses({ $ne: 1 })) === '400 INVALID_ADDRESS', { severity: 'HIGH' });

process.exit(finish());
