/** Our margin: fee maths, the treasury store, fee settings, and the rule that a mint waits for its fee. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config, getChain, type ChainConfig } from '../../src/config.js';
import { evmToBytes32 } from '../../src/cctp/encoding.js';
import type { IrisApi, IrisMessage } from '../../src/cctp/iris.js';
import { QuoteService, computeQuote } from '../../src/cctp/quote.js';
import type { BuildBurnParams, ChainAdapter } from '../../src/chains/adapter.js';
import { collectedFee, protocolFeeFor, referralBpsFor } from '../../src/fees.js';
import { profitStats } from '../../src/ops/stats.js';
import { TransferService } from '../../src/service/TransferService.js';
import { Settings } from '../../src/settings.js';
import { TransferStore } from '../../src/store/TransferStore.js';
import { Treasury } from '../../src/treasury/Treasury.js';
import { HttpError, type BuiltTx, type FeeCheck, type MintResult } from '../../src/types.js';
import { TransferWorker } from '../../src/worker/TransferWorker.js';
import { buildMessage, sampleTransfer } from '../lib/fixtures.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/fees');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-fees-'));
const throws = (fn: () => unknown, code = 400) => { try { fn(); return false; } catch (e) { return e instanceof HttpError && e.statusCode === code; } };
const rejects = async (fn: () => Promise<unknown>, code: number) => { try { await fn(); return false; } catch (e) { return e instanceof HttpError && e.statusCode === code; } };
const none = { feeBps: 0, feeMinUsdc: 0, feeMaxUsdc: 0, gasFeeUsdc: {} };

// ── fee maths ────────────────────────────────────────────────────────────────
check('no settings → no fee', protocolFeeFor(1_000_000n, none, 'arc-testnet') === 0n, { severity: 'CRITICAL' });
check('10 bps of 100 USDC = 0.1 USDC', protocolFeeFor(100_000_000n, { ...none, feeBps: 10 }, 'x') === 100_000n, { severity: 'CRITICAL' });
check('fractional bps and rounding up to a base unit', protocolFeeFor(1_000_001n, { ...none, feeBps: 2.5 }, 'x') === 251n, { severity: 'HIGH' });
check('minimum applies to small transfers', protocolFeeFor(1_000_000n, { ...none, feeBps: 10, feeMinUsdc: 0.05 }, 'x') === 50_000n, { severity: 'HIGH' });
check('maximum caps large transfers', protocolFeeFor(1_000_000_000_000n, { ...none, feeBps: 10, feeMaxUsdc: 25 }, 'x') === 25_000_000n, { severity: 'HIGH' });
check('destination gas charge is added on top, for that destination only', protocolFeeFor(100_000_000n, { ...none, feeBps: 10, gasFeeUsdc: { 'eth-sepolia': 0.5 } }, 'eth-sepolia') === 600_000n
    && protocolFeeFor(100_000_000n, { ...none, feeBps: 10, gasFeeUsdc: { 'eth-sepolia': 0.5 } }, 'arc-testnet') === 100_000n, { severity: 'HIGH' });
check('a flat fee with no bps works (minimum only)', protocolFeeFor(5_000_000n, { ...none, feeMinUsdc: 0.02 }, 'x') === 20_000n);

const pol = { referralFeeBps: 50, stocksFeeBps: null as number | null, stablesFeeBps: null as number | null };
check('Jupiter fee: default rate', referralBpsFor(pol, { tags: ['verified'] }, { tags: ['verified'] }) === 50, { severity: 'HIGH' });
check('Jupiter fee: stocks rate when either side is a stock', referralBpsFor({ ...pol, stocksFeeBps: 100 }, { tags: ['stable'] }, { isStock: true }) === 100 && referralBpsFor({ ...pol, stocksFeeBps: 100 }, { isStock: true }, {}) === 100, { severity: 'HIGH' });
check('Jupiter fee: stable-to-stable rate, only when both are stable', referralBpsFor({ ...pol, stablesFeeBps: 0 }, { tags: ['stable'] }, { tags: ['stable'] }) === 0 && referralBpsFor({ ...pol, stablesFeeBps: 0 }, { tags: ['stable'] }, { tags: [] }) === 50, { severity: 'HIGH' });
check('Jupiter fee: unknown tokens get the default', referralBpsFor({ ...pol, stocksFeeBps: 100 }, undefined, undefined) === 50);

check('collected fee on the output side: ours is 80 %', JSON.stringify(collectedFee({ outputAmountResult: '1000000', totalOutputAmount: '995000' }, 'OUT', 'IN', 'OUT')) === JSON.stringify({ mint: 'OUT', total: '5000', ours: '4000' }), { severity: 'HIGH' });
check('collected fee on the input side', collectedFee({ totalInputAmount: '1000000', inputAmountResult: '990000' }, 'IN', 'IN', 'OUT')?.ours === '8000', { severity: 'HIGH' });
check('no amounts from Jupiter → unknown, not zero', collectedFee({}, 'IN', 'IN', 'OUT') === undefined && collectedFee({ totalInputAmount: '1' }, undefined, 'IN', 'OUT') === undefined);

// ── quote with a fee ─────────────────────────────────────────────────────────
const base = getChain('base-sepolia')!, arc = getChain('arc-testnet')!;
const fees = [{ finalityThreshold: 1000, minimumFee: 1.3 }, { finalityThreshold: 2000, minimumFee: 0 }];
const q = computeQuote({ src: base, dst: arc, amount: 100_000_000n, pref: 'fast', fees, fastAllowanceUsdc: 1e9, onchainMinFee: 0n, protocolFee: 100_000n, feeRecipient: '0xTreasury' });
check('quote: amount is what the user sends; burn = amount − our fee', q.amount === '100000000' && q.protocolFee === '100000' && q.burnAmount === '99900000' && q.feeRecipient === '0xTreasury', { severity: 'CRITICAL' });
check('quote: Circle\'s fee is computed on the burned amount; receive = burn − Circle fee', q.expectedFee === '12987' && q.expectedReceive === (99_900_000n - 12_987n).toString(), { severity: 'CRITICAL', detail: `${q.expectedFee} ${q.expectedReceive}` });
check('quote without a fee is unchanged', computeQuote({ src: base, dst: arc, amount: 1_000_000n, pref: 'fast', fees, fastAllowanceUsdc: 1e9, onchainMinFee: 0n }).burnAmount === '1000000');
check('fee that eats the whole amount → 400', throws(() => computeQuote({ src: base, dst: arc, amount: 1_000_000n, pref: 'fast', fees, fastAllowanceUsdc: 1e9, onchainMinFee: 0n, protocolFee: 1_000_000n })), { severity: 'HIGH' });

// ── treasury ─────────────────────────────────────────────────────────────────
const tr = new Treasury(dir);
const e1 = tr.generate('evm', 'Main EVM');
check('generated EVM wallet: valid address, first one is active', ethers.isAddress(e1.address) && e1.active && e1.origin === 'generated', { severity: 'CRITICAL' });
check('the key file opens the same address', new ethers.Wallet(tr.secretOf(e1.address)!).address === e1.address, { severity: 'CRITICAL' });
check('the wallet list never carries a secret', !JSON.stringify(tr.list()).includes(tr.secretOf(e1.address)!) && !('secret' in tr.list()[0]), { severity: 'CRITICAL' });
const s1 = tr.generate('solana');
check('generated Solana wallet: key matches, active for its own kind', Keypair.fromSecretKey(bs58.decode(tr.secretOf(s1.address)!)).publicKey.toBase58() === s1.address && s1.active && tr.active('evm')?.id === e1.id, { severity: 'CRITICAL' });
const ext = tr.addExternal('evm', '0x000000000000000000000000000000000000dEaD', 'Cold wallet');
check('external wallet: watch-only, not active until chosen, no key', ext.origin === 'external' && !ext.active && tr.secretOf(ext.address) === undefined, { severity: 'HIGH' });
check('bad addresses rejected', throws(() => tr.addExternal('evm', '0x123')) && throws(() => tr.addExternal('solana', '0x000000000000000000000000000000000000dEaD')) && throws(() => tr.addExternal('evm', undefined)), { severity: 'HIGH' });
check('the same address twice → 409', throws(() => tr.addExternal('evm', '0x000000000000000000000000000000000000dEaD'), 409));
check('the active wallet cannot be archived (409)', throws(() => tr.archive(e1.id), 409), { severity: 'HIGH' });
tr.activate(ext.id);
check('activate switches the recipient; one active wallet per kind', tr.active('evm')?.id === ext.id && tr.list().filter(w => w.kind === 'evm' && w.active).length === 1 && tr.active('solana')?.id === s1.id, { severity: 'CRITICAL' });
tr.archive(e1.id);
check('archived wallets stay listed but cannot be activated', tr.get(e1.id)?.archived === true && throws(() => tr.activate(e1.id), 409));
check('archiving keeps the key file', !!tr.secretOf(e1.address), { severity: 'HIGH' });
check('wallets survive a restart', new Treasury(dir).active('evm')?.address === ext.address && new Treasury(dir).list().length === 3, { severity: 'CRITICAL' });

// ── fee settings ─────────────────────────────────────────────────────────────
const st = new Settings(dir, ['eth-sepolia', 'base-sepolia', 'arc-testnet', 'solana-devnet']);
check('defaults: no fee, enforcement on', st.cctp.feeBps === 0 && st.cctp.feeEnforced && st.solana.referralFeeBps === 0 && st.solana.stocksFeeBps === null, { severity: 'HIGH' });
check('fee settings accepted', st.patch({ cctp: { feeBps: 12.5, feeMinUsdc: 0.01, feeMaxUsdc: 50, gasFeeUsdc: { 'eth-sepolia': 0.25, 'arc-testnet': 0 } } }).length === 4 && st.cctp.gasFeeUsdc['eth-sepolia'] === 0.25 && !('arc-testnet' in st.cctp.gasFeeUsdc), { severity: 'HIGH' });
check('bps above 1000 (10 %) rejected', throws(() => st.patch({ cctp: { feeBps: 1500 } })), { severity: 'HIGH' });
check('minimum above maximum rejected', throws(() => st.patch({ cctp: { feeMinUsdc: 60 } })));
check('gas charge for an unknown chain rejected', throws(() => st.patch({ cctp: { gasFeeUsdc: { mars: 1 } } })) && throws(() => st.patch({ cctp: { gasFeeUsdc: [] } })));
check('Solana fee without a referral account rejected', throws(() => st.patch({ solana: { referralFeeBps: 60 } })) && throws(() => st.patch({ solana: { stocksFeeBps: 100 } })), { severity: 'CRITICAL' });
const referralAcct = Keypair.generate().publicKey.toBase58();
st.patch({ solana: { referralAccount: referralAcct, referralFeeBps: 60, stocksFeeBps: 100, stablesFeeBps: 0 } });
check('with a referral account: default, stocks and stable rates saved', st.referralAccount() === referralAcct && st.solana.referralFeeBps === 60 && st.solana.stocksFeeBps === 100 && st.solana.stablesFeeBps === 0, { severity: 'HIGH' });
check('rates of 1-49 bps rejected for every category', throws(() => st.patch({ solana: { stocksFeeBps: 20 } })) && throws(() => st.patch({ solana: { stablesFeeBps: 49 } })), { severity: 'HIGH' });
check('null puts a category back on the default', st.patch({ solana: { stocksFeeBps: null } }).join() === 'solana.stocksFeeBps' && st.solana.stocksFeeBps === null);
check('removing the account while a fee is on is rejected', throws(() => st.patch({ solana: { referralAccount: '' } })), { severity: 'HIGH' });
check('bad referral account rejected', throws(() => st.patch({ solana: { referralAccount: 'nope' } })));

// ── fakes ────────────────────────────────────────────────────────────────────
class Fake implements ChainAdapter {
    chain: ChainConfig;
    fee: FeeCheck = 'missing';
    feeChecks: Array<{ tx: string; to: string; amount: bigint }> = [];
    built: BuildBurnParams[] = [];
    mints = 0;
    ensured: string[] = [];
    constructor(key: string) { this.chain = getChain(key)!; }
    validateAddress() { return true; }
    isValidTxHash(h: string) { return /^0x[0-9a-f]{64}$/.test(h) || h.length > 60; }
    mintRecipientFor(w: string) { return { mintRecipient: evmToBytes32('0x2222222222222222222222222222222222222222'), tokenAccount: w.length > 42 ? w : undefined }; }
    async buildBurn(p: BuildBurnParams): Promise<BuiltTx[]> { this.built.push(p); return []; }
    async checkBurn() { return { state: 'pending' as const }; }
    async minFeeAmount() { return 0n; }
    async checkFee(tx: string, f: { from: string; to: string; amount: bigint }) { this.feeChecks.push({ tx, to: f.to, amount: f.amount }); return this.fee; }
    async ensureUsdcAccount(o: string) { this.ensured.push(o); }
    async isNonceUsed() { return false; }
    async mint(_m: unknown, onSent: (h: string) => void): Promise<MintResult> { this.mints++; onSent('0xmint'); return { txHash: '0xmint', received: 999_000n, gasCost: { amount: '0.0002', symbol: 'ETH' } }; }
    async checkMint() { return { state: 'unknown' as const }; }
    relayerAddress() { return '0xrelayer'; }
    async relayerBalance() { return { amount: '1', symbol: 'ETH' }; }
    async usdcBalance() { return 0n; }
}
const iris: IrisApi = { async getFees() { return fees; }, async getFastAllowance() { return 1e9; }, async getMessages(): Promise<IrisMessage[] | null> { return null; }, async reattest() { /* unused */ } };

// ── the service builds the fee into the transfer ─────────────────────────────
{
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-fees-svc-'));
    const store = new TransferStore(d2);
    const settings = new Settings(d2);
    const treasury = new Treasury(d2);
    const src = new Fake('base-sepolia'), dst = new Fake('arc-testnet'), sol = new Fake('solana-devnet');
    const adapters = new Map<string, ChainAdapter>([[src.chain.key, src], [dst.chain.key, dst], [sol.chain.key, sol]]);
    const svc = new TransferService(store, adapters, new QuoteService(iris, adapters), settings, treasury);
    const input = { src: 'base-sepolia', dst: 'arc-testnet', amount: '100', sender: '0x1111111111111111111111111111111111111111', recipient: '0x2222222222222222222222222222222222222222' };

    settings.patch({ cctp: { feeBps: 10 } });
    const noWallet = await svc.create(input);
    check('a fee rate with no treasury wallet charges nothing (nowhere to send it)', noWallet.quote.protocolFee === '0' && noWallet.transfer.feeStatus === 'none' && src.built.at(-1)!.fee === undefined, { severity: 'CRITICAL' });

    const evmT = treasury.generate('evm');
    const c = await svc.create(input);
    check('with a wallet: quote carries the fee and the treasury address', c.quote.protocolFee === '100000' && c.quote.feeRecipient === evmT.address && c.quote.burnAmount === '99900000', { severity: 'CRITICAL' });
    check('the burn is built for amount − fee, with the fee transfer attached', src.built.at(-1)!.amount === 99_900_000n && src.built.at(-1)!.fee?.amount === 100_000n && src.built.at(-1)!.fee?.recipient === evmT.address, { severity: 'CRITICAL' });
    check('the record keeps what was burned, what the user sent, the fee and its recipient', c.transfer.amount === '99900000' && c.transfer.grossAmount === '100000000' && c.transfer.protocolFee === '100000'
        && c.transfer.feeRecipient === evmT.address && c.transfer.feeStatus === 'pending', { severity: 'CRITICAL' });
    check('a Solana source gets no fee until a Solana treasury wallet exists', (await svc.create({ ...input, src: 'solana-devnet', sender: Keypair.generate().publicKey.toBase58() })).quote.protocolFee === '0', { severity: 'HIGH' });
    const solT = treasury.generate('solana');
    check('then it does, paid to the Solana treasury', (await svc.create({ ...input, src: 'solana-devnet', sender: Keypair.generate().publicKey.toBase58() })).quote.feeRecipient === solT.address, { severity: 'HIGH' });

    const id = c.transfer.id;
    const burn = '0x' + 'ab'.repeat(32), feeTx = '0x' + 'cd'.repeat(32);
    check('fee hash: garbage → 400; the burn hash offered as the fee → 400', throws(() => svc.submitFee(id, 'zz')) && (() => { svc.submitBurn(id, burn); return throws(() => svc.submitFee(id, burn)); })(), { severity: 'HIGH' });
    check('fee hash accepted and stored', svc.submitFee(id, feeTx).feeTxHash === feeTx, { severity: 'HIGH' });
    const both = await svc.create(input);
    check('burn and fee hashes can be posted together', svc.submitBurn(both.transfer.id, '0x' + '12'.repeat(32), '0x' + '34'.repeat(32)).feeTxHash === '0x' + '34'.repeat(32) && store.get(both.transfer.id)!.status === 'BURN_SUBMITTED', { severity: 'HIGH' });
    check('fee hash on a transfer without a fee → 409', throws(() => svc.submitFee(noWallet.transfer.id, feeTx), 409));
    check('a transfer keeps its quoted recipient when the treasury changes later', (() => { treasury.activate(treasury.addExternal('evm', '0x000000000000000000000000000000000000dEaD').id); return store.get(id)!.feeRecipient === evmT.address; })(), { severity: 'HIGH' });
    settings.patch({ cctp: { feeBps: 1000, feeMinUsdc: 200 } });
    check('a fee larger than the amount → 400', await rejects(() => svc.create(input), 400), { severity: 'HIGH' });
    fs.rmSync(d2, { recursive: true, force: true });
}

// ── the worker holds the mint until the fee is seen ──────────────────────────
function attested(over: Record<string, unknown> = {}, enforced = true) {
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cctp-fees-w-'));
    const store = new TransferStore(d3);
    const src = new Fake('base-sepolia'), dst = new Fake('arc-testnet');
    const worker = new TransferWorker(store, new Map<string, ChainAdapter>([[src.chain.key, src], [dst.chain.key, dst]]), iris,
        { ...config.worker, concurrency: 4 }, config.limits, () => true, () => enforced);
    const base = sampleTransfer();
    const t = store.create(sampleTransfer({
        status: 'ATTESTED', burnTxHash: '0x' + 'aa'.repeat(32), nonce: '0x' + 'cd'.repeat(32), attestation: '0x' + 'ee'.repeat(65),
        message: buildMessage({ sourceDomain: 6, destinationDomain: 26, nonce: '0x' + 'cd'.repeat(32), burnToken: evmToBytes32('0x036CbD53842c5426634e7929541eC2318f3dCF7e'), mintRecipient: base.mintRecipient, amount: 1_000_000n, messageSender: evmToBytes32(base.sender) }),
        protocolFee: '1000', feeRecipient: '0xTreasury', feeStatus: 'pending', grossAmount: '1001000', ...over,
    }));
    return { d3, store, src, dst, worker, get: () => store.get(t.id)!, id: t.id };
}
{
    const s = attested();
    await s.worker.runOnce();
    check('no fee hash, enforced → mint held, status says why', s.dst.mints === 0 && s.get().status === 'ATTESTED' && s.get().feeStatus === 'awaiting' && /service fee/.test(s.get().lastError ?? ''), { severity: 'CRITICAL', detail: s.get().lastError });
    s.store.update(s.id, { feeTxHash: '0x' + 'fe'.repeat(32), retryAfter: undefined });
    s.src.fee = 'pending';
    await s.worker.runOnce();
    check('fee tx not confirmed yet → still held', s.dst.mints === 0 && /confirm/.test(s.get().lastError ?? ''), { severity: 'HIGH' });
    s.store.update(s.id, { retryAfter: undefined });
    s.src.fee = 'missing';
    await s.worker.runOnce();
    check('a tx that does not pay the treasury → still held', s.dst.mints === 0 && /did not pay/.test(s.get().lastError ?? ''), { severity: 'CRITICAL' });
    s.store.update(s.id, { retryAfter: undefined });
    s.src.fee = 'paid';
    await s.worker.runOnce();
    check('fee seen → marked paid and minted once', s.dst.mints === 1 && s.get().status === 'COMPLETED' && s.get().feeStatus === 'paid' && !!s.get().feePaidAt, { severity: 'CRITICAL' });
    check('the check asked for the right recipient and amount', s.src.feeChecks.at(-1)!.to === '0xTreasury' && s.src.feeChecks.at(-1)!.amount === 1000n, { severity: 'HIGH' });
    check('the relayer\'s gas cost is recorded', s.get().relayCost?.symbol === 'ETH' && s.get().relayCost?.amount === '0.0002', { severity: 'HIGH' });
    fs.rmSync(s.d3, { recursive: true, force: true });
}
{
    const s = attested({}, false);
    await s.worker.runOnce();
    check('not enforced → minted anyway, fee recorded as unpaid', s.dst.mints === 1 && s.get().status === 'COMPLETED' && s.get().feeStatus === 'unpaid', { severity: 'CRITICAL' });
    fs.rmSync(s.d3, { recursive: true, force: true });
}
{
    const s = attested({ protocolFee: '0', feeStatus: 'none', feeRecipient: undefined });
    await s.worker.runOnce();
    check('no fee on the transfer → minted without any fee check', s.dst.mints === 1 && s.src.feeChecks.length === 0, { severity: 'CRITICAL' });
    fs.rmSync(s.d3, { recursive: true, force: true });
}
{
    const s = attested({ feeStatus: 'paid' });
    await s.worker.runOnce();
    check('already paid → not checked again', s.dst.mints === 1 && s.src.feeChecks.length === 0);
    fs.rmSync(s.d3, { recursive: true, force: true });
}

// ── profit read model ────────────────────────────────────────────────────────
const now = Date.now();
const p = profitStats([
    sampleTransfer({ src: 'base-sepolia', protocolFee: '100000', feeStatus: 'paid', feePaidAt: now - 3600_000, status: 'COMPLETED', relayCost: { amount: '0.0002', symbol: 'ETH' } }),
    sampleTransfer({ src: 'base-sepolia', protocolFee: '50000', feeStatus: 'paid', feePaidAt: now - 3 * 86_400_000, status: 'COMPLETED', relayCost: { amount: '0.0003', symbol: 'ETH' } }),
    sampleTransfer({ src: 'solana-devnet', protocolFee: '20000', feeStatus: 'unpaid', status: 'COMPLETED_EXTERNAL' }),
    sampleTransfer({ src: 'arc-testnet', protocolFee: '30000', feeStatus: 'awaiting', status: 'ATTESTED' }),
    sampleTransfer({ protocolFee: '0', feeStatus: 'none', status: 'COMPLETED', relayCost: { amount: '0.01', symbol: 'USDC' } }),
    sampleTransfer({ protocolFee: '99000', feeStatus: 'pending', status: 'CREATED' }),   // quoted, never burned: owes nothing
], [
    { id: 'a', taker: 'T', inputMint: 'USDC', outputMint: 'SOL', inAmount: '1', quotedOutAmount: '1', minOutAmount: '1', slippageBps: 0, feeBps: 50, router: 'metis', gasless: false, requestId: 'r', status: 'COMPLETED', createdAt: now, updatedAt: now, completedAt: now - 1000, inUsdValue: 1000, referralFeeBps: 50, feeCollected: { mint: 'SOL', total: '5000', ours: '4000' } },
    { id: 'b', taker: 'T', inputMint: 'USDC', outputMint: 'SOL', inAmount: '1', quotedOutAmount: '1', minOutAmount: '1', slippageBps: 0, feeBps: 2, router: 'metis', gasless: false, requestId: 'r', status: 'COMPLETED', createdAt: now, updatedAt: now, completedAt: now, inUsdValue: 500 },
    { id: 'c', taker: 'T', inputMint: 'USDC', outputMint: 'SOL', inAmount: '1', quotedOutAmount: '1', minOutAmount: '1', slippageBps: 0, feeBps: 50, router: 'metis', gasless: false, requestId: 'r', status: 'FAILED', createdAt: now, updatedAt: now, inUsdValue: 900, referralFeeBps: 50 },
], now);
check('cross-chain: paid, unpaid and awaiting are kept apart', p.cctp.paid === '150000' && p.cctp.paidCount === 2 && p.cctp.unpaid === '20000' && p.cctp.awaiting === '30000' && p.cctp.last24h.paid === '100000', { severity: 'CRITICAL', detail: JSON.stringify(p.cctp).slice(0, 200) });
check('cross-chain: by source chain, and relayer gas summed per currency', p.cctp.byChain[0].chain === 'base-sepolia' && p.cctp.byChain[0].fees === '150000' && Math.abs(p.cctp.relayCost.ETH - 0.0005) < 1e-12 && p.cctp.relayCost.USDC === 0.01 && p.cctp.relayed === 3, { severity: 'HIGH' });
check('solana: only completed swaps that carried our fee count; estimate = value × bps × 80 %', p.solana.swapsWithFee === 1 && Math.abs(p.solana.estimatedUsd - 4) < 1e-9 && p.solana.byMint[0].ours === '4000', { severity: 'CRITICAL', detail: JSON.stringify(p.solana) });
check('daily series: 14 days, today holds today\'s fees', p.daily.length === 14 && p.daily.at(-1)!.cctpFees === '100000' && p.daily.at(-1)!.solanaCount === 1 && p.daily.reduce((a, d) => a + d.cctpCount, 0) === 2, { severity: 'HIGH' });

fs.rmSync(dir, { recursive: true, force: true });
process.exit(finish());
