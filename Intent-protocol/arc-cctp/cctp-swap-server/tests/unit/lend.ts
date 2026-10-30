/** Lend module against a stand-in protocol: markets, quote rules, create-once, status mapping, find, polling events, admin. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { phaseOf } from '../../src/lend/LendService.js';
import { registerLend } from '../../src/lend/routes.js';
import type { LendProtocol, RawCreate, RawLoan, RawPool } from '../../src/lend/types.js';
import { EventLog } from '../../src/ops/EventLog.js';
import { HttpError } from '../../src/types.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/lend');

const RAY = 10n ** 27n;
const pool = (asset: string, chain: string, decimals: bigint, extra: Partial<RawPool> = {}): RawPool => ({
    id: `${asset.toLowerCase()}-pool`, asset, chain, decimals, displayName: asset, frozen: false,
    totalSupply: 10n ** 12n, totalDebt: 10n ** 11n, availableLiquidity: 10n ** 12n,
    maxLtv: 6500n, liquidationThreshold: 7400n, liquidationBonus: 500n, activationFee: 50n,
    estimatedLendingApy: RAY / 100n, estimatedBorrowingApy: (RAY * 468n) / 10_000n, utilizationRate: RAY / 2n, ...extra,
});
const PRICES = { BTC: 80_000, USDC: 1, ETH: 2500 };
const BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ETH_ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

class FakeProtocol implements LendProtocol {
    pools = [pool('BTC', 'BTC', 8n), pool('USDC', 'ETH', 6n)];
    loans = new Map<string, RawLoan>();
    creates: RawCreate[] = [];
    down = false;

    async listPools() { if (this.down) throw new Error('unreachable'); return this.pools; }
    async getPrices() { return PRICES; }
    calculateLtv(req: { collateralAmount: bigint; borrowAmount: bigint }) {
        const fee = (req.borrowAmount * 50n) / 10_000n;
        const collateralUsd = (Number(req.collateralAmount) / 1e8) * PRICES.BTC;
        const debtUsd = Number(req.borrowAmount + fee) / 1e6;
        return {
            activationFeeAmount: fee, openingDebtAmount: req.borrowAmount + fee,
            borrowUsd: BigInt(Math.round(debtUsd * 1e8)), collateralUsd: BigInt(Math.round(collateralUsd * 1e8)),
            ltvBps: BigInt(Math.round((debtUsd / collateralUsd) * 10_000)), maxAllowedLtvBps: 6500n, validationErrors: [] as unknown[],
        };
    }
    async create(req: RawCreate) {
        this.creates.push(req);
        const ref = `LN${this.creates.length}AB`;
        const loan: RawLoan = {
            loanId: BigInt(this.creates.length), ref,
            status: { operation: 'deposit', state: 'action_required', confirmations: null, requiredConfirmations: 4 },
            terms: { ltvMaxBps: req.ltvMaxBps, depositWindowSeconds: req.depositWindowSeconds },
            collateral: { poolId: req.collateral.poolId, asset: 'BTC', decimals: 8n, amount: req.collateral.amount },
            borrow: { poolId: req.borrow.poolId, asset: 'USDC', chain: 'ETH', decimals: 6n, amount: req.borrow.amount, destination: { address: req.borrow.destination, type: 'evm' } },
            refundDestination: { address: req.refund.destination, type: 'btc' },
            initialDeposit: { collateralAmount: req.collateral.amount, targets: { BTC: { amount: req.collateral.amount + 100n, inflowFeeAmount: 100n, target: { address: 'bc1qdeposit000000000000000000000000000000' } } }, detectedTimestamp: null, expiryTimestamp: BigInt(Math.floor(Date.now() / 1000) + 3600) },
            repayment: { debtAmount: 0n, targets: {} },
            position: { collateralAmount: 0n, borrowedAmount: 0n, debtInterestAmount: 0n, totalDebtAmount: 0n },
        };
        this.loans.set(ref, loan);
        return loan;
    }
    async getProfileId(addr: string) { return addr.toLowerCase().includes('known') ? 'profile-123' : null; }
    async prepareCreateProfile(addr: string) { return { message: 'Sign to create', expiryTimestamp: 1234567890n, actionType: 'create-account', account: addr }; }
    async createProfile(addr: string) { return 'profile-created-456'; }
    async getUserPositionSummary(id: string) { return { totalCollateralUsd: 1000000000000000000000000000n, totalDebtUsd: 200000000000000000000000000n, usdDecimals: 27n }; }
    async getUserReserves(id: string) { return []; }
    async getHealthFactor(id: string) { return { healthFactor: 2000000000000000000n, healthFactorDecimals: 18n }; }
    async supplyTarget(pid: string, poolId: string, action: string, chain: string) { return { target: { address: 'bc1qsupplytarget' }, type: 'transfer' }; }
    async submitInflow(txid: string, op: string) { return { txid }; }
    async get(ref: string) {
        const l = this.loans.get(ref);
        if (!l) throw new Error('not found');
        return l;
    }
    async find(query: string) {
        return [...this.loans.values()].filter(l => JSON.stringify(l, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(query)).map(l => ({ ref: l.ref }));
    }
    /** The deposit landed and the loan is live. */
    activate(ref: string, collateral: bigint, debt: bigint) {
        const l = this.loans.get(ref)!;
        l.status = { operation: 'repayment', state: 'active', confirmations: null, requiredConfirmations: null };
        l.position = { collateralAmount: collateral, borrowedAmount: debt, debtInterestAmount: 0n, totalDebtAmount: debt };
        l.repayment = { debtAmount: debt, targets: { ETH: { amount: debt, inflowFeeAmount: 0n, target: { address: '0x2222222222222222222222222222222222222222' } } } };
    }
}

// ── status mapping ──
const P = (operation: string, state: string) => phaseOf({ operation, state });
check('phase: a new loan waits for its deposit', P('deposit', 'action_required') === 'awaiting_deposit');
check('phase: deposit seen and borrow in flight are "confirming"', P('deposit', 'confirming') === 'confirming' && P('borrow', 'processing') === 'confirming');
check('phase: repayment/active is the live loan', P('repayment', 'active') === 'active');
check('phase: a repayment in flight is "repaying", a finished one "closed"', P('repayment', 'confirming') === 'repaying' && P('repayment', 'completed') === 'closed');
check('phase: expired, failed and liquidated are terminal', P('deposit', 'expired') === 'expired' && P('borrow', 'failed') === 'failed' && P('liquidation', 'processing') === 'liquidated');

// ── the module over HTTP ──
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lend-'));
process.env.ADMIN_API_KEY = 'test-admin-key';
const events = new EventLog();
const protocol = new FakeProtocol();
const app = Fastify();
await app.register(rateLimit, { global: false });
app.setErrorHandler((e, _req, reply) => { reply.status(e instanceof HttpError ? e.statusCode : 500).send({ error: e.message }); });
const lend = await registerLend(app, { dataDir: dir, events, protocol, pollSec: 0 });
const call = async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, payload: body as never, headers });
    return { status: res.statusCode, json: res.json() as any };
};
const admin = { 'x-admin-key': 'test-admin-key' };

const markets = await call('GET', '/lend/markets');
const btc = markets.json.markets?.find((m: any) => m.asset === 'BTC');
check('markets: pools become markets with rates as percents and limits in bps',
    markets.status === 200 && btc?.maxLtvBps === 6500 && btc?.liquidationThresholdBps === 7400 && btc?.activationFeeBps === 50 && Math.abs(btc.supplyApy - 1) < 1e-6 && btc.priceUsd === 80_000,
    { evidence: JSON.stringify(btc) });
const usdc = markets.json.markets?.find((m: any) => m.asset === 'USDC');
check('markets: a borrow rate of 4.68% reads as 4.68', Math.abs(usdc?.borrowApy - 4.68) < 1e-6 && usdc?.utilization === 50);

const base = { collateralAsset: 'BTC', borrowAsset: 'USDC', collateralAmount: '2000000', borrowAmount: '500000000' };   // 0.02 BTC, 500 USDC
const q = await call('POST', '/lend/quote', base);
check('quote: LTV, fee, opening debt and liquidation price', q.status === 200 && q.json.ltvBps === 3141 && q.json.activationFee === '2500000' && q.json.openingDebt === '502500000'
    && Math.abs(q.json.liquidationPrice - 502.5 / (0.02 * 0.74)) < 0.01 && q.json.errors.length === 0, { evidence: JSON.stringify(q.json) });
check('quote: the most a simple loan may open at is the pool maximum less the buffer', q.json.maxLtvBps === 6300);

const high = await call('POST', '/lend/quote', { ...base, borrowAmount: '1020000000' });   // ~64% LTV: under the pool's 65, over the 63 allowed
check('quote: a loan inside the buffer is refused with a sentence', high.json.errors.some((e: string) => /most allowed is 63\.0%/.test(e)), { evidence: JSON.stringify(high.json.errors) });
const same = await call('POST', '/lend/quote', { ...base, borrowAsset: 'BTC', borrowAmount: '1000' });
check('quote: collateral and borrowed asset must differ', same.json.errors.some((e: string) => /must differ/.test(e)));
check('quote: amounts must be integer strings', (await call('POST', '/lend/quote', { ...base, borrowAmount: '1.5' })).status === 400 && (await call('POST', '/lend/quote', { ...base, collateralAmount: '0' })).status === 400);
check('quote: an unknown asset is a 400', (await call('POST', '/lend/quote', { ...base, collateralAsset: 'DOGE' })).status === 400);

// ── create ──
const addresses = { borrowDestination: ETH_ADDR, refundDestination: BTC_ADDR };
check('create: a bad destination address is refused before anything is created',
    (await call('POST', '/lend/loans', { ...base, ...addresses, borrowDestination: 'bc1qnotanevmaddress' })).status === 400
    && (await call('POST', '/lend/loans', { ...base, ...addresses, refundDestination: ETH_ADDR })).status === 400 && protocol.creates.length === 0);
check('create: a loan over the allowed LTV is refused before anything is created', (await call('POST', '/lend/loans', { ...base, ...addresses, borrowAmount: '1020000000' })).status === 400 && protocol.creates.length === 0);

const created = await call('POST', '/lend/loans', { ...base, ...addresses });
const loan = created.json;
check('create: answers 201 with the loan, waiting for its deposit', created.status === 201 && loan.ref === 'LN1AB' && loan.phase === 'awaiting_deposit' && protocol.creates.length === 1);
check('create: the deposit target carries the fee-inclusive amount to send', loan.deposit?.targets?.[0]?.chain === 'BTC' && loan.deposit.targets[0].amount === '2000100' && loan.deposit.targets[0].address.startsWith('bc1qdeposit'));
check('create: passes the buffered LTV limit and a one-hour window to the protocol', protocol.creates[0].ltvMaxBps === 6300n && protocol.creates[0].depositWindowSeconds === 3600n);
check('create: destinations are kept as plain addresses', loan.borrow.destination === ETH_ADDR && loan.refundDestination === BTC_ADDR);
check('create: before the deposit, LTV comes from the loan\'s terms', loan.ltvBps === 3125, { evidence: String(loan.ltvBps) });
check('create: recorded in the event log', events.query({ section: 'lend', type: 'loan.created' }).events.length === 1);

// ── read, find ──
check('get: a known loan is served from the store', (await call('GET', '/lend/loans/LN1AB')).json.ref === 'LN1AB');
check('get: an unknown loan is a 404, a malformed reference a 400', (await call('GET', '/lend/loans/NOPE99')).status === 404 && (await call('GET', '/lend/loans/!!')).status === 400);
check('find: by the address the funds go to, and by the refund address',
    (await call('GET', `/lend/loans?address=${ETH_ADDR}`)).json.loans.length === 1 && (await call('GET', `/lend/loans?address=${BTC_ADDR}`)).json.loans.length === 1);
check('find: by loan ID', (await call('GET', '/lend/loans?address=LN1AB')).json.loans[0]?.ref === 'LN1AB');

// A loan this server never created, known to the protocol for the same wallet: a restored wallet finds it.
await protocol.create({ collateral: { poolId: 'btc-pool', asset: 'BTC', amount: 1_000_000n }, borrow: { poolId: 'usdc-pool', asset: 'USDC', chain: 'ETH', amount: 100_000_000n, destination: ETH_ADDR }, refund: { chain: 'BTC', destination: BTC_ADDR }, ltvMaxBps: 6300n, depositWindowSeconds: 3600n });
check('find: loans made elsewhere for the same address are discovered and remembered',
    (await call('GET', `/lend/loans?address=${ETH_ADDR}`)).json.loans.length === 2 && !!lend.store.get('LN2AB'));

// ── following a loan ──
protocol.activate('LN1AB', 2_000_000n, 502_500_000n);
check('poll: refreshes open loans', (await lend.service.poll()) === 2);
const live = (await call('GET', '/lend/loans/LN1AB')).json;
check('poll: the loan is active with its position, debt and repayment target', live.phase === 'active' && live.position.totalDebt === '502500000' && live.repayment.targets[0]?.chain === 'ETH' && live.ltvBps === 3141);
check('poll: the change is in the event log and the loan\'s history', events.query({ section: 'lend', type: 'loan.active' }).events.length === 1 && lend.store.get('LN1AB')!.history.length === 2);

protocol.activate('LN1AB', 2_000_000n, 1_120_000_000n);   // debt grew to 70% LTV
await lend.service.poll();
await lend.service.poll();
check('poll: an LTV warning is raised once, not on every refresh', events.query({ section: 'lend', type: 'loan.ltv_warning' }).events.length === 1);

protocol.down = true;
const stale = await call('GET', '/lend/loans/LN1AB');
check('with the protocol unreachable, a known loan is still served', stale.status === 200 && stale.json.phase === 'active');
check('with the protocol unreachable, a forced refresh keeps the last known state', (await call('POST', '/lend/loans/LN1AB/refresh')).json.phase === 'active');
protocol.down = false;

// ── admin ──
check('admin: needs the key', (await call('GET', '/admin/lend/overview')).status === 401);
const overview = (await call('GET', '/admin/lend/overview', undefined, admin)).json;
check('admin overview: counts, totals and the at-risk list', overview.total === 2 && overview.active === 1 && overview.byPhase.awaiting_deposit === 1 && overview.atRisk.length === 1 && Math.abs(overview.debtUsd - 1120) < 0.01, { evidence: JSON.stringify(overview).slice(0, 300) });
check('admin loans: filter by phase and search by address',
    (await call('GET', '/admin/lend/loans?phase=open', undefined, admin)).json.total === 2 && (await call('GET', '/admin/lend/loans?phase=active', undefined, admin)).json.total === 1
    && (await call('GET', `/admin/lend/loans?q=${BTC_ADDR.slice(0, 12)}`, undefined, admin)).json.total === 2);
check('admin loan: the full record with history', (await call('GET', '/admin/lend/loans/LN1AB', undefined, admin)).json.history?.length >= 2);

check('admin settings: an unknown or nonsensical setting is refused', (await call('POST', '/admin/lend/settings', { warnLtvBps: 5 }, admin)).status === 400 && (await call('POST', '/admin/lend/settings', { nope: 1 }, admin)).status === 400);
const paused = await call('POST', '/admin/lend/settings', { paused: true, pauseReason: 'maintenance' }, admin);
check('admin settings: pausing is saved and reported in /config', paused.json.changed.includes('paused') && lend.publicConfig().paused && lend.publicConfig().pauseReason === 'maintenance');
const refused = await call('POST', '/lend/loans', { ...base, ...addresses });
check('paused: no new loan is created, and the reason is given', refused.status === 503 && /maintenance/.test(refused.json.error) && protocol.creates.length === 2);
check('paused: existing loans are still readable', (await call('GET', '/lend/loans/LN1AB')).status === 200);
await call('POST', '/admin/lend/settings', { paused: false, maxBorrowUsd: 300 }, admin);
check('a borrow limit set by the operator is enforced', (await call('POST', '/lend/loans', { ...base, ...addresses })).status === 400);

// ── advanced mode endpoints ──
const resKnown = await call('GET', `/lend/account/resolve/${ETH_ADDR}`);
check('account resolve: known address returns profileId or null', resKnown.status === 200 && 'profileId' in resKnown.json);

const prepCreate = await call('POST', '/lend/account/prepare-create', { account: ETH_ADDR });
check('prepare create: generates signable message', prepCreate.status === 200 && prepCreate.json.message === 'Sign to create');

const createdProf = await call('POST', '/lend/account/create', { account: ETH_ADDR, chain: 'ETH', signature: '0x123', expiryTimestamp: '1234567890' });
check('create profile: returns created profileId', createdProf.status === 201 && createdProf.json.profileId === 'profile-created-456');

const portf = await call('GET', '/lend/account/profile-123/portfolio');
check('portfolio: returns supplied, borrowed, and healthPct', portf.status === 200 && Array.isArray(portf.json.supplied) && Array.isArray(portf.json.borrowed) && typeof portf.json.healthPct === 'number');

const supTarget = await call('POST', '/lend/account/supply-target', { profileId: 'profile-123', poolId: 'btc-pool', action: 'deposit', chain: 'BTC' });
check('supply target: returns deposit target address', supTarget.status === 200 && supTarget.json.targetAddress === 'bc1qsupplytarget');

const inflow = await call('POST', '/lend/account/submit-inflow', { txid: '0xabc', operation: 'deposit', chain: 'BTC' });
check('submit inflow: accepts transaction id', inflow.status === 200 && inflow.json.txid === '0xabc');

// ── admin user tracking ──
const usersRes = await call('GET', '/admin/lend/users', undefined, admin);
check('admin users: returns tracked users and statistics', usersRes.status === 200 && usersRes.json.total >= 1 && Array.isArray(usersRes.json.users));

const userDetail = await call('GET', '/admin/lend/users/profile-created-456', undefined, admin);
check('admin user detail: returns profile, portfolio, and matching loans', userDetail.status === 200 && userDetail.json.profile.profileId === 'profile-created-456');

const trackRes = await call('POST', '/admin/lend/users/track', { addressOrProfileId: 'profile-999-new' }, admin);
check('admin track user: tracks new profile', trackRes.status === 200 && trackRes.json.profile.profileId === 'profile-999-new');

const noteRes = await call('POST', '/admin/lend/users/profile-created-456/notes', { notes: 'VIP borrower' }, admin);
check('admin user notes: updates notes', noteRes.status === 200 && noteRes.json.notes === 'VIP borrower');

lend.stop();
await app.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = finish();
