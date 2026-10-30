/**
 * Worker state machine with fake chain adapters and a fake Iris — covers the restart / double-mint /
 * external-mint / re-attest / backoff paths that are hard to force on a live testnet.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config, getChain, type ChainConfig } from '../../src/config.js';
import { evmToBytes32 } from '../../src/cctp/encoding.js';
import type { IrisApi, IrisMessage } from '../../src/cctp/iris.js';
import { MintError, type ChainAdapter } from '../../src/chains/adapter.js';
import { TransferStore } from '../../src/store/TransferStore.js';
import { MAX_MINT_ATTEMPTS, TransferWorker } from '../../src/worker/TransferWorker.js';
import type { BurnCheck, MintCheck, MintResult, ParsedBurn, Transfer } from '../../src/types.js';
import { buildMessage, sampleTransfer } from '../lib/fixtures.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/worker');

class FakeAdapter implements ChainAdapter {
    chain: ChainConfig;
    burn: BurnCheck = { state: 'pending' };
    nonceUsed = false;
    mintCalls = 0;
    prepared = 0;
    mintChecks = new Map<string, MintCheck>();
    mintImpl: (onSent: (h: string) => void) => Promise<MintResult> = async (onSent) => {
        onSent('0xmint1'); return { txHash: '0xmint1', received: 999_876n, feeCollected: 124n };
    };
    constructor(key: string) { this.chain = getChain(key)!; }
    validateAddress() { return true; }
    isValidTxHash() { return true; }
    mintRecipientFor(w: string) { return { mintRecipient: evmToBytes32(w) }; }
    async buildBurn() { return []; }
    async checkBurn() { return this.burn; }
    async minFeeAmount() { return 0n; }
    fee: 'paid' | 'missing' | 'pending' = 'paid';
    feeChecks = 0;
    async checkFee() { this.feeChecks++; return this.fee; }
    async prepareMint() { this.prepared++; }
    async isNonceUsed() { return this.nonceUsed; }
    async mint(_m: { message: string; attestation: string }, onSent: (h: string) => void) { this.mintCalls++; return this.mintImpl(onSent); }
    async checkMint(h: string) { return this.mintChecks.get(h) ?? { state: 'unknown' as const }; }
    relayerAddress() { return '0xrelayer'; }
    async relayerBalance() { return { amount: '1', symbol: 'ETH' }; }
    async usdcBalance() { return 0n; }
}

class FakeIris implements IrisApi {
    messages: IrisMessage[] | null = null;
    reattested: string[] = [];
    async getFees() { return []; }
    async getFastAllowance() { return 1e9; }
    async getMessages() { return this.messages; }
    async reattest(n: string) { this.reattested.push(n); }
}

function setup(over: Partial<Transfer> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-worker-'));
    const store = new TransferStore(dir);
    const src = new FakeAdapter('base-sepolia');
    const dst = new FakeAdapter('arc-testnet');
    const iris = new FakeIris();
    const worker = new TransferWorker(store, new Map<string, ChainAdapter>([[src.chain.key, src], [dst.chain.key, dst]]), iris,
        { ...config.worker, pollIntervalMs: 1_000, concurrency: 4 }, config.limits);
    const t = store.create(sampleTransfer({ status: 'BURN_SUBMITTED', burnTxHash: '0x' + 'aa'.repeat(32), burnSubmittedAt: Date.now(), ...over }));
    const get = () => store.get(t.id)!;
    return { dir, store, src, dst, iris, worker, t, get };
}

const goodBurn = (t: Transfer, over: Partial<ParsedBurn> = {}): BurnCheck => ({
    state: 'confirmed',
    burn: {
        amount: BigInt(t.amount), destinationDomain: t.dstDomain, mintRecipient: t.mintRecipient,
        destinationCaller: '0x' + '00'.repeat(32), maxFee: 156n, minFinalityThreshold: 1000,
        burnToken: evmToBytes32('0x036CbD53842c5426634e7929541eC2318f3dCF7e'), sender: evmToBytes32(t.sender), ...over,
    },
});

const readyMsg = (t: Transfer, over: Record<string, unknown> = {}): IrisMessage => ({
    status: 'complete', attestation: '0x' + 'ee'.repeat(65), eventNonce: '1',
    message: buildMessage({
        sourceDomain: t.srcDomain, destinationDomain: t.dstDomain, nonce: '0x' + 'cd'.repeat(32),
        burnToken: evmToBytes32('0x036CbD53842c5426634e7929541eC2318f3dCF7e'), mintRecipient: t.mintRecipient,
        amount: BigInt(t.amount), messageSender: evmToBytes32(t.sender), maxFee: 156n, feeExecuted: 124n, ...over,
    }),
});

const cleanups: string[] = [];

// 1. happy path
{
    const s = setup(); cleanups.push(s.dir);
    s.src.burn = goodBurn(s.t);
    await s.worker.runOnce();
    check('burn confirmed → BURN_CONFIRMED', s.get().status === 'BURN_CONFIRMED', { severity: 'HIGH' });
    check('destination prepared early (e.g. Solana token account)', s.dst.prepared === 1);
    await s.worker.runOnce();
    check('no attestation yet → stays BURN_CONFIRMED', s.get().status === 'BURN_CONFIRMED');
    s.iris.messages = [readyMsg(s.t)];
    await s.worker.runOnce();
    check('attestation ready → ATTESTED with nonce', s.get().status === 'ATTESTED' && s.get().nonce === '0x' + 'cd'.repeat(32), { severity: 'HIGH' });
    await s.worker.runOnce();
    const f = s.get();
    check('mint → COMPLETED with received amount', f.status === 'COMPLETED' && f.received === '999876' && f.mintTxHash === '0xmint1', { severity: 'CRITICAL', detail: `${f.status} ${f.received}` });
    check('exactly one mint call', s.dst.mintCalls === 1, { severity: 'CRITICAL' });
    await s.worker.runOnce();
    check('terminal transfer is not processed again', s.dst.mintCalls === 1, { severity: 'CRITICAL' });
}

// 2. burn does not match the transfer
{
    const s = setup(); cleanups.push(s.dir);
    s.src.burn = goodBurn(s.t, { amount: 5n });
    await s.worker.runOnce();
    check('amount mismatch → FAILED', s.get().status === 'FAILED' && /amount/.test(s.get().failReason ?? ''), { severity: 'CRITICAL' });
}
{
    const s = setup(); cleanups.push(s.dir);
    s.src.burn = goodBurn(s.t, { destinationCaller: evmToBytes32('0x9999999999999999999999999999999999999999') });
    await s.worker.runOnce();
    check('restricted destinationCaller → FAILED', s.get().status === 'FAILED', { severity: 'HIGH' });
}
{
    const s = setup(); cleanups.push(s.dir);
    s.src.burn = { state: 'failed', reason: 'burn transaction reverted' };
    await s.worker.runOnce();
    check('reverted burn → FAILED', s.get().status === 'FAILED', { severity: 'HIGH' });
}

// 3. attested message differs from the record (defence in depth)
{
    const s = setup({ status: 'BURN_CONFIRMED' }); cleanups.push(s.dir);
    s.iris.messages = [readyMsg(s.t, { mintRecipient: evmToBytes32('0x3333333333333333333333333333333333333333') })];
    await s.worker.runOnce();
    check('message for another recipient is never minted', s.get().status === 'BURN_CONFIRMED' && s.dst.mintCalls === 0, { severity: 'CRITICAL' });
}

// 4. Circle delay reason is surfaced
{
    const s = setup({ status: 'BURN_CONFIRMED' }); cleanups.push(s.dir);
    s.iris.messages = [{ status: 'pending_confirmations', attestation: 'PENDING', message: '0x', eventNonce: '', delayReason: 'insufficient_fee' }];
    await s.worker.runOnce();
    check('delayReason recorded in lastError', /insufficient_fee/.test(s.get().lastError ?? ''));
}

// 5. nonce already used before we mint → external
{
    const s = setup({ status: 'ATTESTED', nonce: '0x01', message: readyMsg(sampleTransfer()).message, attestation: '0xee' }); cleanups.push(s.dir);
    s.dst.nonceUsed = true;
    await s.worker.runOnce();
    check('nonce used by someone else → COMPLETED_EXTERNAL, no mint', s.get().status === 'COMPLETED_EXTERNAL' && s.dst.mintCalls === 0, { severity: 'CRITICAL' });
}

// 6. our broadcast landed but we saw "nonce used" (e.g. retry after timeout) → COMPLETED, not EXTERNAL
{
    const s = setup({ status: 'ATTESTED', nonce: '0x01', message: '0x', attestation: '0xee', mintTxHashes: ['0xours'] }); cleanups.push(s.dir);
    s.dst.mintImpl = async () => { throw new MintError('execution reverted: Nonce already used', 'nonce_used'); };
    s.dst.mintChecks.set('0xours', { state: 'success', result: { txHash: '0xours', received: 999_876n } });
    await s.worker.runOnce();
    check('own earlier mint found → COMPLETED', s.get().status === 'COMPLETED' && s.get().mintTxHash === '0xours', { severity: 'HIGH' });
}

// 7. message expired → re-attest once, back to BURN_CONFIRMED
{
    const s = setup({ status: 'ATTESTED', nonce: '0x02', message: '0x', attestation: '0xee' }); cleanups.push(s.dir);
    s.dst.mintImpl = async () => { throw new MintError('Message expired and must be re-signed', 'expired'); };
    await s.worker.runOnce();
    const g = s.get();
    check('expired → reattest requested + BURN_CONFIRMED', s.iris.reattested.join() === '0x02' && g.status === 'BURN_CONFIRMED' && g.reattestRequested === true && !g.attestation, { severity: 'HIGH' });
}

// 8. restart while MINT_SUBMITTED and the tx landed → COMPLETED without a second mint
{
    const s = setup({ status: 'MINT_SUBMITTED', nonce: '0x03', message: '0x', attestation: '0xee', mintTxHash: '0xm', mintTxHashes: ['0xm'], mintSubmittedAt: Date.now() }); cleanups.push(s.dir);
    s.dst.mintChecks.set('0xm', { state: 'success', result: { txHash: '0xm', received: 1n } });
    await s.worker.runOnce();
    check('restart: landed mint → COMPLETED, zero new mints', s.get().status === 'COMPLETED' && s.dst.mintCalls === 0, { severity: 'CRITICAL' });
}
{
    const s = setup({ status: 'MINT_SUBMITTED', nonce: '0x04', message: '0x', attestation: '0xee', mintTxHashes: ['0xp'], mintSubmittedAt: Date.now() }); cleanups.push(s.dir);
    s.dst.mintChecks.set('0xp', { state: 'pending' });
    await s.worker.runOnce();
    check('restart: pending mint → keep waiting', s.get().status === 'MINT_SUBMITTED' && s.dst.mintCalls === 0, { severity: 'CRITICAL' });
}
{
    const s = setup({ status: 'MINT_SUBMITTED', nonce: '0x05', message: '0x', attestation: '0xee', mintTxHashes: ['0xgone'], mintSubmittedAt: Date.now() - 10 * 60_000 }); cleanups.push(s.dir);
    await s.worker.runOnce();
    check('restart: dropped mint, nonce unused, >3 min → back to ATTESTED to resend', s.get().status === 'ATTESTED', { severity: 'HIGH' });
}

// 9. transient mint error → exponential backoff, not re-processed before retryAfter
{
    const s = setup({ status: 'ATTESTED', nonce: '0x06', message: '0x', attestation: '0xee' }); cleanups.push(s.dir);
    s.dst.mintImpl = async () => { throw new MintError('rpc timeout', 'transient'); };
    await s.worker.runOnce();
    const g = s.get();
    check('transient error → failCount 1 + retryAfter', g.failCount === 1 && (g.retryAfter ?? 0) > Date.now() && g.status === 'ATTESTED', { severity: 'HIGH' });
    await s.worker.runOnce();
    check('not retried before retryAfter', s.dst.mintCalls === 1);
}
{
    const s = setup({ status: 'ATTESTED', nonce: '0x07', message: '0x', attestation: '0xee', failCount: MAX_MINT_ATTEMPTS - 1 }); cleanups.push(s.dir);
    s.dst.mintImpl = async () => { throw new MintError('rpc timeout', 'transient'); };
    await s.worker.runOnce();
    check(`gives up after ${MAX_MINT_ATTEMPTS} attempts with manual-mint note`, s.get().status === 'FAILED' && /manual mint/.test(s.get().failReason ?? ''));
}

// 10. TTL
{
    const s = setup({ status: 'CREATED', burnTxHash: undefined, createdAt: Date.now() - (config.limits.createdTtlMin + 1) * 60_000 }); cleanups.push(s.dir);
    await s.worker.runOnce();
    check('CREATED past TTL → EXPIRED', s.get().status === 'EXPIRED');
}

// 11. tracked burn (details unknown until the attested message)
{
    const s = setup({
        origin: 'track', dst: '', dstDomain: -1, sender: '', recipient: '', mintRecipient: '', amount: '0', maxFee: '0',
    }); cleanups.push(s.dir);
    s.src.burn = { state: 'confirmed' };
    await s.worker.runOnce();
    check('tracked burn confirmed → BURN_CONFIRMED', s.get().status === 'BURN_CONFIRMED');
    s.iris.messages = [readyMsg(sampleTransfer({ amount: '2500000' }))];
    await s.worker.runOnce();
    const g = s.get();
    check('tracked: fields filled from the attested message', g.status === 'ATTESTED' && g.dst === 'arc-testnet' && g.amount === '2500000'
        && g.recipient === '0x2222222222222222222222222222222222222222', { severity: 'HIGH', detail: `${g.status} ${g.dst} ${g.amount} ${g.recipient}` });
}

// tick(): the live scheduler, with more open transfers than slots (the cap is 4 in these tests).
// Found live on 2026-10-08: unsigned transfers and burns that never land filled every slot on every tick,
// so a real transfer queued behind them was never looked at.
const settle = () => new Promise(r => setTimeout(r, 20));
const arcBurn = (s: ReturnType<typeof setup>) => s.store.create(sampleTransfer({
    src: 'arc-testnet', dst: 'base-sepolia', srcDomain: 26, dstDomain: 6, status: 'BURN_SUBMITTED', burnTxHash: '0x' + 'bb'.repeat(32), burnSubmittedAt: Date.now(),
}));
{
    const s = setup({ status: 'CREATED', burnTxHash: undefined, burnSubmittedAt: undefined });
    cleanups.push(s.dir);
    for (let i = 0; i < 9; i++) s.store.create(sampleTransfer({ status: 'CREATED' }));          // ten nobody signed, all older
    const real = arcBurn(s);
    s.dst.burn = { state: 'failed', reason: 'burn transaction reverted' };                      // any visible step will do
    s.worker.tick();
    await settle();
    check('tick: unsigned transfers take no slot, so a burn behind ten of them is processed at once', s.store.get(real.id)!.status === 'FAILED', { severity: 'CRITICAL', detail: s.store.get(real.id)!.status });
    check('tick: the unsigned transfers are left as they are', s.store.active().length === 10 && s.store.active().every(t => t.status === 'CREATED'));
}
{
    const s = setup();                                                                           // a burn on Base that never lands
    cleanups.push(s.dir);
    for (let i = 0; i < 9; i++) s.store.create(sampleTransfer({ status: 'BURN_SUBMITTED', burnTxHash: '0x' + i.toString().repeat(64), burnSubmittedAt: Date.now() }));
    const real = arcBurn(s);                                                                     // eleventh in the queue
    s.dst.burn = { state: 'failed', reason: 'burn transaction reverted' };
    let ticks = 0;
    while (s.store.get(real.id)!.status === 'BURN_SUBMITTED' && ticks < 6) { s.worker.tick(); ticks++; await settle(); }
    check('tick: with ten stuck burns ahead and four slots, the eleventh gets its turn by the third tick', s.store.get(real.id)!.status === 'FAILED' && ticks <= 3, { severity: 'CRITICAL', detail: `${s.store.get(real.id)!.status} after ${ticks} ticks` });
    check('tick: the stuck burns are still being checked, none dropped', s.store.active().length === 10 && s.store.active().every(t => t.status === 'BURN_SUBMITTED'));
}
{
    const s = setup({ status: 'CREATED', burnTxHash: undefined, burnSubmittedAt: undefined, createdAt: Date.now() - (config.limits.createdTtlMin + 1) * 60_000 });
    cleanups.push(s.dir);
    s.worker.tick();
    await settle();
    check('tick: an unsigned transfer past its TTL still expires', s.get().status === 'EXPIRED', { severity: 'HIGH' });
}

for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
process.exit(finish());
