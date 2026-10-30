/** Admin layer without a network: runtime settings, the event log, the read models, and the switches they drive. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import { Settings } from '../../src/settings.js';
import { EventLog } from '../../src/ops/EventLog.js';
import { cctpStats, median, solanaStats } from '../../src/ops/stats.js';
import { SolanaSwapService } from '../../src/jupiter/SolanaSwapService.js';
import { SwapStore } from '../../src/jupiter/SwapStore.js';
import { TokenCatalog, WSOL_MINT } from '../../src/jupiter/TokenCatalog.js';
import type { JupOrder, JupToken, JupiterApi, SolanaSwap } from '../../src/jupiter/types.js';
import { TransferStore } from '../../src/store/TransferStore.js';
import { HttpError } from '../../src/types.js';
import { sampleTransfer } from '../lib/fixtures.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/admin');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-admin-'));
const CHAINS = ['eth-sepolia', 'base-sepolia', 'arc-testnet', 'solana-devnet'];
const throws = (fn: () => unknown, code = 400) => { try { fn(); return false; } catch (e) { return e instanceof HttpError && e.statusCode === code; } };
const rejects = async (fn: () => Promise<unknown>, code: number) => { try { await fn(); return false; } catch (e) { return e instanceof HttpError && e.statusCode === code; } };

// ── settings ─────────────────────────────────────────────────────────────────
const s = new Settings(dir, CHAINS);
check('defaults: nothing paused, stocks and unverified tokens allowed', !s.cctp.paused && !s.solana.paused && s.solana.stocksEnabled && s.solana.allowUnverified && s.cctp.relayEnabled, { severity: 'HIGH' });
check('patch reports exactly the fields that changed', s.patch({ cctp: { paused: true, pauseReason: 'gas', maxTransferUsdc: s.cctp.maxTransferUsdc } }).join() === 'cctp.paused,cctp.pauseReason', { severity: 'HIGH' });
check('saved to disk and restored after a restart', new Settings(dir, CHAINS).cctp.paused === true && new Settings(dir, CHAINS).cctp.pauseReason === 'gas', { severity: 'CRITICAL' });
s.patch({ cctp: { paused: false } });
check('resuming clears the pause reason', s.cctp.pauseReason === undefined);
check('unknown setting rejected', throws(() => s.patch({ cctp: { nope: 1 } })) && throws(() => s.patch({ solana: { nope: 1 } })), { severity: 'HIGH' });
check('wrong type rejected', throws(() => s.patch({ cctp: { paused: 'yes' } })) && throws(() => s.patch({ solana: { maxSlippageBps: 12.5 } })), { severity: 'HIGH' });
check('min above max rejected', throws(() => s.patch({ cctp: { minTransferUsdc: 500, maxTransferUsdc: 100 } })), { severity: 'HIGH' });
check('default slippage above the cap rejected', throws(() => s.patch({ solana: { defaultSlippageBps: 2000, maxSlippageBps: 500 } })));
check('unknown chain in disabledChains rejected', throws(() => s.patch({ cctp: { disabledChains: ['mars'] } })), { severity: 'HIGH' });
check('malformed route rejected', throws(() => s.patch({ cctp: { disabledRoutes: ['eth-sepolia>eth-sepolia'] } })) && throws(() => s.patch({ cctp: { disabledRoutes: ['eth-sepolia'] } })));
check('bad mint in blockedMints rejected', throws(() => s.patch({ solana: { blockedMints: ['nope'] } })), { severity: 'HIGH' });
check('fee of 1-49 bps rejected (Jupiter minimum is 50)', throws(() => s.patch({ solana: { referralFeeBps: 20 } })), { severity: 'HIGH' });
check('fee refused without a referral account in env', throws(() => s.patch({ solana: { referralFeeBps: 50 } })), { severity: 'HIGH' });
check('a rejected patch changes nothing', !s.cctp.paused && s.cctp.disabledChains.length === 0 && s.solana.referralFeeBps === 0, { severity: 'CRITICAL' });
s.patch({ cctp: { disabledChains: ['arc-testnet'], disabledRoutes: ['eth-sepolia>base-sepolia'] } });
check('closed chain shuts it as source and destination', !s.chainOpen('arc-testnet') && !s.routeOpen('arc-testnet', 'base-sepolia') && !s.routeOpen('base-sepolia', 'arc-testnet'), { severity: 'HIGH' });
check('closed route shuts one direction only', !s.routeOpen('eth-sepolia', 'base-sepolia') && s.routeOpen('base-sepolia', 'eth-sepolia'), { severity: 'HIGH' });
s.reset('cctp');
check('reset returns one product to the env defaults', s.cctp.disabledChains.length === 0 && s.cctp.disabledRoutes.length === 0 && s.routeOpen('eth-sepolia', 'base-sepolia'));
check('all() is a copy', (() => { const a = s.all(); a.cctp.paused = true; return !s.cctp.paused; })());

// ── event log ────────────────────────────────────────────────────────────────
const log = new EventLog(dir);
log.record({ section: 'cctp', type: 'transfer.created', severity: 'info', summary: 'a', subject: { kind: 'transfer', id: 't1' } });
log.record({ section: 'cctp', type: 'transfer.failed', severity: 'error', summary: 'b', subject: { kind: 'transfer', id: 't1' } });
log.record({ section: 'solana', type: 'swap.completed', severity: 'success', summary: 'c', subject: { kind: 'swap', id: 's1' } });
log.record({ section: 'system', type: 'admin.note', severity: 'info', summary: 'd' });
check('newest first, numbered in order', log.query().events.map(e => e.summary).join('') === 'dcba' && log.query().latestSeq === 4, { severity: 'HIGH' });
check('filter by section, severity, type prefix and subject', log.query({ section: 'cctp' }).total === 2 && log.query({ severity: 'error' }).total === 1
    && log.query({ type: 'transfer.' }).total === 2 && log.query({ subject: 's1' }).events[0].summary === 'c', { severity: 'HIGH' });
check('limit and offset page through', log.query({ limit: 1, offset: 1 }).events[0].summary === 'c' && log.query({ limit: 1 }).total === 4);
check('counts by severity since a time', log.countSince(0).error === 1 && log.countSince(0, 'solana').success === 1 && log.countSince(Date.now() + 1000).info === 0);
const reloaded = new EventLog(dir);
check('events survive a restart and numbering continues', reloaded.query().total === 4 && reloaded.record({ section: 'system', type: 'x', severity: 'info', summary: 'e' }).seq === 5, { severity: 'CRITICAL' });
fs.appendFileSync(path.join(dir, 'events.jsonl'), '{"torn":');
check('a torn last line is skipped on load', new EventLog(dir).query().total === 5, { severity: 'HIGH' });
check('memory-only log works without a data dir', new EventLog().record({ section: 'system', type: 'x', severity: 'info', summary: 'm' }).seq === 1);

// ── store hooks ──────────────────────────────────────────────────────────────
const ts = new TransferStore(dir);
const seen: string[] = [];
ts.onChange = (prev, next) => seen.push(`${prev?.status ?? 'new'}>${next.status}`);
const t0 = ts.create(sampleTransfer({ status: 'CREATED' }));
ts.update(t0.id, { status: 'BURN_SUBMITTED' });
ts.update(t0.id, { failCount: 1 });
check('transfer store reports create and every update with the previous record', seen.join() === 'new>CREATED,CREATED>BURN_SUBMITTED,BURN_SUBMITTED>BURN_SUBMITTED', { severity: 'HIGH', detail: seen.join() });

// ── read models ──────────────────────────────────────────────────────────────
check('median of odd, even and empty lists', median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5 && median([]) === null);
const now = Date.now();
const at = (min: number) => now - min * 60_000;
const transfers = [
    sampleTransfer({ src: 'eth-sepolia', dst: 'arc-testnet', status: 'COMPLETED', amount: '2000000', received: '1999000', expectedReceive: '1999500', createdAt: at(30), burnSubmittedAt: at(29), burnConfirmedAt: at(28.5), attestedAt: at(28), completedAt: at(27.5), updatedAt: at(27.5) }),
    sampleTransfer({ src: 'eth-sepolia', dst: 'arc-testnet', status: 'COMPLETED_EXTERNAL', amount: '1000000', expectedReceive: '999900', createdAt: at(20), burnSubmittedAt: at(19), completedAt: at(18), updatedAt: at(18) }),
    sampleTransfer({ src: 'arc-testnet', dst: 'base-sepolia', status: 'FAILED', amount: '5000000', createdAt: at(15), updatedAt: at(14) }),
    sampleTransfer({ src: 'arc-testnet', dst: 'base-sepolia', status: 'ATTESTED', amount: '1000000', failCount: 2, createdAt: at(90), updatedAt: at(60) }),
    sampleTransfer({ src: 'arc-testnet', dst: 'base-sepolia', status: 'CREATED', amount: '1000000', createdAt: at(120), updatedAt: at(120) }),
    sampleTransfer({ src: 'eth-sepolia', dst: 'arc-testnet', status: 'COMPLETED', amount: '9000000', received: '9000000', createdAt: now - 3 * 86_400_000, completedAt: now - 3 * 86_400_000 + 60_000, burnSubmittedAt: now - 3 * 86_400_000, updatedAt: now - 3 * 86_400_000 }),
];
const c = cctpStats(transfers, now, 20);
check('cctp: totals, in flight, success rate', c.total === 6 && c.active === 2 && c.awaitingBurn === 1 && c.completed === 3 && c.failed === 1 && c.successRate === 0.75, { severity: 'HIGH', detail: JSON.stringify({ a: c.active, s: c.successRate }) });
check('cctp: volume counts completed transfers only; fees = sent − received', c.volume === '12000000' && c.received === '11998900' && c.fees === '1100', { severity: 'HIGH', detail: `${c.volume} ${c.received} ${c.fees}` });
check('cctp: last 24 h excludes the 3-day-old transfer', c.last24h.created === 5 && c.last24h.completed === 2 && c.last24h.volume === '3000000', { severity: 'HIGH' });
check('cctp: stuck = in flight, burned, no progress past the limit; awaiting-burn is never stuck', c.stuck.length === 1 && c.retrying === 1, { severity: 'HIGH' });
check('cctp: median timings in seconds', c.timingSec.burnToConfirmed === 30 && c.timingSec.total === 60, { detail: JSON.stringify(c.timingSec) });
check('cctp: per-route rows, busiest first', c.byRoute[0].count === 3 && c.byRoute.find(r => r.route === 'arc-testnet>base-sepolia')?.failed === 1);
check('cctp: 24 hourly buckets, counts add up', c.hourly.length === 24 && c.hourly.reduce((a, h) => a + h.created, 0) === 5 && c.hourly.reduce((a, h) => a + h.completed, 0) === 2 && c.hourly.reduce((a, h) => a + h.failed, 0) === 1, { severity: 'HIGH' });

const swap = (p: Partial<SolanaSwap>): SolanaSwap => ({
    id: Math.random().toString(36).slice(2), taker: 'T', inputMint: 'USDC', outputMint: 'SOL', inAmount: '1', quotedOutAmount: '1', minOutAmount: '1', slippageBps: 50, feeBps: 2,
    router: 'metis', gasless: false, requestId: 'r', status: 'COMPLETED', createdAt: at(10), updatedAt: at(10), inUsdValue: 10, ...p,
});
const sol = solanaStats([
    swap({ submittedAt: at(10), completedAt: at(10) + 4000, gasless: true }),
    swap({ submittedAt: at(9), completedAt: at(9) + 6000, router: 'jupiterz', inUsdValue: 25 }),
    swap({ status: 'FAILED', failReason: 'Slippage exceeded', updatedAt: at(8) }),
    swap({ status: 'FAILED', failReason: 'Slippage exceeded', updatedAt: at(7), inputMint: 'SOL', outputMint: 'TSLAx' }),
    swap({ status: 'SUBMITTED' }), swap({ status: 'CREATED' }), swap({ status: 'EXPIRED' }),
], now);
check('solana: volume in USD from completed swaps only', sol.volumeUsd === 35 && sol.completed === 2 && sol.failed === 2 && sol.successRate === 0.5, { severity: 'HIGH' });
check('solana: open swaps, gasless count, median time to land', sol.active === 2 && sol.submitted === 1 && sol.gasless === 1 && sol.medianLandSec === 5);
check('solana: by router and grouped failure reasons', sol.byRouter.metis === 1 && sol.byRouter.jupiterz === 1 && sol.failReasons[0].reason === 'Slippage exceeded' && sol.failReasons[0].count === 2);
check('solana: pairs, busiest first', sol.byPair[0].pair === 'USDC>SOL' && sol.byPair[0].count === 6 && sol.byPair.length === 2);
check('empty stores give null rates, not NaN', cctpStats([], now, 20).successRate === null && solanaStats([], now).medianLandSec === null && cctpStats([], now, 20).volume === '0', { severity: 'HIGH' });

// ── Solana policy: the settings an admin flips apply to the next request ──────
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const UNKNOWN = Keypair.generate().publicKey.toBase58();
const TAKER = Keypair.generate().publicKey.toBase58();
const TOKENS: JupToken[] = [
    { id: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL', decimals: 9, isVerified: true, tags: ['verified'], liquidity: 9e8 },
    { id: USDC, name: 'USD Coin', symbol: 'USDC', decimals: 6, isVerified: true, tags: ['verified'], liquidity: 5e8 },
    { id: TSLAX, name: 'Tesla xStock', symbol: 'TSLAx', decimals: 8, isVerified: true, tags: ['verified', 'xstocks', 'stocks'], liquidity: 1.5e6 },
];
const orders: Record<string, string>[] = [];
const api: JupiterApi = {
    async order(p): Promise<JupOrder> {
        orders.push(p);
        return { inputMint: p.inputMint, outputMint: p.outputMint, inAmount: p.amount, outAmount: '1', otherAmountThreshold: '1', slippageBps: Number(p.slippageBps ?? 0), router: 'metis', transaction: p.taker ? 'AAAA' : null, requestId: 'r', inUsdValue: 500 };
    },
    async execute() { return { status: 'Success', code: 0 }; },
    async verifiedTokens() { return TOKENS; },
    async searchTokens() { return []; },
    async prices() { return {}; },
};
const catalog = new TokenCatalog(api, 60_000);
await catalog.verified();
const policy = new Settings(fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-pol-')), CHAINS);
const svc = new SolanaSwapService(api, new SwapStore(dir), catalog, { maxSlippageBps: 1000, orderTtlSec: 120, landTimeoutSec: 180, policy: () => policy.solana });
const q = (o: object = {}) => svc.quote({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', ...o });
const mk = (o: object = {}) => svc.create({ inputMint: USDC, outputMint: WSOL_MINT, amount: '1000000', taker: TAKER, ...o });

check('running: quote and create work', (await q()).outAmount === '1' && (await mk()).swap.status === 'CREATED', { severity: 'CRITICAL' });
policy.patch({ solana: { paused: true } });
check('paused: new swaps refused with 503, quotes still answer', await rejects(() => mk(), 503) && (await q()).outAmount === '1', { severity: 'CRITICAL' });
policy.patch({ solana: { paused: false, stocksEnabled: false } });
check('stocks off: a stock is refused as output and as input (403)', await rejects(() => q({ outputMint: TSLAX }), 403) && await rejects(() => mk({ inputMint: TSLAX, outputMint: USDC }), 403), { severity: 'CRITICAL' });
check('stocks off: other tokens still swap', (await q()).outAmount === '1');
policy.patch({ solana: { stocksEnabled: true, allowUnverified: false } });
check('unverified off: an unlisted mint is refused (403), verified ones pass', await rejects(() => q({ outputMint: UNKNOWN }), 403) && (await q({ outputMint: TSLAX })).outAmount === '1', { severity: 'CRITICAL' });
policy.patch({ solana: { allowUnverified: true, blockedMints: [USDC] } });
check('blocked mint refused on either side (403)', await rejects(() => q(), 403) && await rejects(() => q({ inputMint: WSOL_MINT, outputMint: USDC }), 403), { severity: 'CRITICAL' });
policy.patch({ solana: { blockedMints: [], maxSlippageBps: 100 } });
check('lowering the slippage cap applies at once', await rejects(() => q({ slippageBps: 150 }), 400) && (await q({ slippageBps: 100 })).slippageBps === 100, { severity: 'HIGH' });
policy.patch({ solana: { defaultSlippageBps: 75 } });
await q();
check('default slippage sent when the client gives none', orders.at(-1)!.slippageBps === '75', { severity: 'HIGH' });
await q({ slippageBps: 10 });
check('the client\'s own slippage wins over the default', orders.at(-1)!.slippageBps === '10');
policy.patch({ solana: { maxSwapUsd: 100 } });
check('swap above the size limit refused for quote and create (400)', await rejects(() => q(), 400) && await rejects(() => mk(), 400), { severity: 'HIGH' });
policy.patch({ solana: { maxSwapUsd: 0 } });
check('size limit 0 means no limit', (await mk()).swap.inUsdValue === 500);

fs.rmSync(dir, { recursive: true, force: true });
process.exit(finish());
