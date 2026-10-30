/**
 * LendService — markets, quotes and loans for /lend/*.
 *
 * It turns the protocol's pools into `Market`s, checks an amount pair into a `LendQuote`, creates a loan once,
 * and keeps every loan it has seen in the LoanStore, refreshed by `poll()`.
 *
 * Rules that protect the user:
 *   - a loan is created at most once per request; a failure after the remote create is read back, not retried
 *   - the pool is re-read before creating, because fees and rates move between the quote and the confirm
 *   - nothing here signs or sends: the deposit and the repayment are transfers the user's wallet makes
 */
import { HttpError } from '../types.js';
import type { EventLog } from '../ops/EventLog.js';
import type { LendSettingsStore, LoanStore } from './LoanStore.js';
import type { ProfileStore } from './ProfileStore.js';
import {
    OPEN_PHASES, type CreateLoanBody, type LendProtocol, type LendQuote, type LoanPhase, type LoanRecord, type LoanTarget, type LoanView,
    type Market, type RawLoan, type RawPool, type RawPrices,
    type CreateAccountBody, type PrepareCreateAccountBody, type PrepareCreateAccountView, type PortfolioView, type AdvancedPositionView,
    type PrepareBorrowBody, type PrepareBorrowView, type SubmitBorrowBody,
    type PrepareWithdrawBody, type PrepareWithdrawView, type SubmitWithdrawBody,
    type SupplyTargetBody, type SupplyTargetView, type SubmitInflowBody, type OutflowReceiptView,
    type AdminLendUsersResponse, type AdminLendUserSummary, type AdminLendUserDetail,
} from './types.js';

const RAY = 10n ** 27n;
/** A ray rate as a percent with four decimals: 3.2339e24 → 0.3234. */
const rayPct = (v: bigint) => Number((v * 1_000_000n) / RAY) / 10_000;
const toNum = (amount: bigint, decimals: number) => Number(amount) / 10 ** decimals;

/** Simple loans must open at least this far under the pool's maximum LTV. */
export const MIN_LTV_BUFFER_BPS = 200;
const DEFAULT_DEPOSIT_WINDOW_MIN = 60;

const ADDRESS: Record<string, RegExp> = {
    BTC: /^((bc1|tb1)[a-z0-9]{25,87}|(BC1|TB1)[A-Z0-9]{25,87}|[132mn][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    ETH: /^0x[0-9a-fA-F]{40}$/,
};

export function phaseOf(status: { operation: string; state: string }): LoanPhase {
    const { operation, state } = status;
    if (state === 'expired') return 'expired';
    if (state === 'failed') return 'failed';
    if (operation === 'liquidation') return 'liquidated';
    if (operation === 'deposit') return state === 'action_required' ? 'awaiting_deposit' : 'confirming';
    if (operation === 'borrow') return state === 'completed' || state === 'active' ? 'active' : 'confirming';
    if (operation === 'repayment') return state === 'completed' ? 'closed' : state === 'active' || state === 'action_required' ? 'active' : 'repaying';
    if (operation === 'withdrawal') return state === 'completed' ? 'closed' : 'repaying';
    return 'confirming';
}

/** An account as the protocol describes it, reduced to the address a person would recognise. */
function addressOf(account: unknown): string {
    if (typeof account === 'string') return account;
    const a = account as Record<string, unknown> | null;
    return String(a?.address ?? a?.principal ?? a?.accountIdentifier ?? a?.owner ?? '');
}

function parseAmount(text: unknown, name: string): bigint {
    if (typeof text !== 'string' || !/^\d{1,40}$/.test(text)) throw new HttpError(400, `${name} must be an integer string of base units`);
    const v = BigInt(text);
    if (v <= 0n) throw new HttpError(400, `${name} must be above zero`);
    return v;
}

export interface LendDeps {
    protocol: LendProtocol;
    store: LoanStore;
    profileStore?: ProfileStore;
    settings: LendSettingsStore;
    events?: EventLog;
    now?: () => number;
    marketTtlMs?: number;
}

export class LendService {
    private cache: { at: number; pools: RawPool[]; prices: RawPrices } | null = null;
    private lastOk = 0;
    private lastError = '';
    private polling = false;

    constructor(private d: LendDeps) {}

    private now() { return (this.d.now ?? Date.now)(); }

    private record(type: string, severity: 'info' | 'success' | 'warn' | 'error', summary: string, ref?: string, data?: Record<string, unknown>) {
        this.d.events?.record({ section: 'lend', type, severity, summary, ...(ref ? { subject: { kind: 'loan', id: ref } } : {}), data });
    }

    /** Whether the protocol answered recently, for /health and the admin overview. */
    health() { return { lastOkAt: this.lastOk || null, lastError: this.lastError || null }; }

    private async upstream<T>(what: string, fn: () => Promise<T>): Promise<T> {
        try {
            const out = await fn();
            this.lastOk = this.now();
            this.lastError = '';
            return out;
        } catch (e) {
            if (e instanceof HttpError) throw e;
            const msg = (e as Error)?.message ?? String(e);
            this.lastError = `${what}: ${msg}`.slice(0, 300);
            throw new HttpError(502, `The lending service could not ${what}: ${msg}`);
        }
    }

    private async data(force = false) {
        const ttl = this.d.marketTtlMs ?? 30_000;
        if (!force && this.cache && this.now() - this.cache.at < ttl) return this.cache;
        const [pools, prices] = await this.upstream('load its markets', () => Promise.all([this.d.protocol.listPools(), this.d.protocol.getPrices()]));
        this.cache = { at: this.now(), pools, prices };
        return this.cache;
    }

    private market(p: RawPool, prices: RawPrices): Market {
        return {
            poolId: p.id, asset: p.asset, chain: p.chain, name: p.displayName ?? p.asset, decimals: Number(p.decimals),
            priceUsd: prices[p.asset] ?? 0,
            supplyApy: rayPct(p.estimatedLendingApy), borrowApy: rayPct(p.estimatedBorrowingApy), utilization: rayPct(p.utilizationRate),
            availableLiquidity: p.availableLiquidity.toString(), totalSupply: p.totalSupply.toString(), totalDebt: p.totalDebt.toString(),
            maxLtvBps: Number(p.maxLtv), liquidationThresholdBps: Number(p.liquidationThreshold), liquidationBonusBps: Number(p.liquidationBonus),
            activationFeeBps: Number(p.activationFee), frozen: p.frozen,
        };
    }

    async markets(): Promise<{ markets: Market[]; updatedAt: number }> {
        const { pools, prices, at } = await this.data();
        return { markets: pools.map(p => this.market(p, prices)), updatedAt: at };
    }

    private pool(pools: RawPool[], asset: string, role: string): RawPool {
        const p = pools.find(x => x.asset === String(asset).toUpperCase());
        if (!p) throw new HttpError(400, `${asset} is not available as ${role}`);
        return p;
    }

    private async quoteWith(body: Pick<CreateLoanBody, 'collateralAsset' | 'borrowAsset' | 'collateralAmount' | 'borrowAmount' | 'ltvBufferBps'>, force: boolean) {
        const { pools, prices } = await this.data(force);
        const collateralPool = this.pool(pools, body.collateralAsset, 'collateral');
        const borrowPool = this.pool(pools, body.borrowAsset, 'the borrowed asset');
        const collateralAmount = parseAmount(body.collateralAmount, 'collateralAmount');
        const borrowAmount = parseAmount(body.borrowAmount, 'borrowAmount');
        const buffer = Math.max(MIN_LTV_BUFFER_BPS, Math.min(5000, Math.round(body.ltvBufferBps ?? MIN_LTV_BUFFER_BPS)));

        const errors: string[] = [];
        if (collateralPool.id === borrowPool.id) errors.push('Collateral and the borrowed asset must differ.');
        if (collateralPool.frozen) errors.push(`${collateralPool.asset} deposits are paused by the protocol.`);
        if (borrowPool.frozen) errors.push(`${borrowPool.asset} borrowing is paused by the protocol.`);
        if (borrowAmount > borrowPool.availableLiquidity) errors.push(`Only ${toNum(borrowPool.availableLiquidity, Number(borrowPool.decimals))} ${borrowPool.asset} is available to borrow right now.`);

        const ltv = this.d.protocol.calculateLtv({ collateralPoolId: collateralPool.id, borrowPoolId: borrowPool.id, collateralAmount, borrowAmount }, pools, prices);
        for (const e of ltv.validationErrors ?? []) {
            const text = typeof e === 'string' ? e : String((e as { message?: string; code?: string })?.message ?? (e as { code?: string })?.code ?? 'The amounts are not valid.');
            errors.push(text);
        }
        const maxLtvBps = Math.max(0, Number(collateralPool.maxLtv) - buffer);
        const ltvBps = Number(ltv.ltvBps);
        if (ltvBps > maxLtvBps) errors.push(`This loan would open at ${(ltvBps / 100).toFixed(1)}% LTV. The most allowed is ${(maxLtvBps / 100).toFixed(1)}%: add collateral or borrow less.`);

        const collateralPrice = prices[collateralPool.asset] ?? 0;
        const borrowPrice = prices[borrowPool.asset] ?? 0;
        const debt = toNum(ltv.openingDebtAmount, Number(borrowPool.decimals)) * borrowPrice;
        const units = toNum(collateralAmount, Number(collateralPool.decimals));
        const threshold = Number(collateralPool.liquidationThreshold);
        const maxUsd = this.d.settings.get().maxBorrowUsd;
        if (maxUsd > 0 && debt > maxUsd) errors.push(`The most that can be borrowed here is $${maxUsd.toLocaleString('en-US')}.`);

        const quote: LendQuote = {
            collateral: { asset: collateralPool.asset, chain: collateralPool.chain, amount: collateralAmount.toString(), usd: units * collateralPrice },
            borrow: { asset: borrowPool.asset, chain: borrowPool.chain, amount: borrowAmount.toString(), usd: toNum(borrowAmount, Number(borrowPool.decimals)) * borrowPrice },
            ltvBps, maxLtvBps, liquidationThresholdBps: threshold,
            activationFee: ltv.activationFeeAmount.toString(), openingDebt: ltv.openingDebtAmount.toString(),
            borrowApy: rayPct(borrowPool.estimatedBorrowingApy),
            liquidationPrice: units > 0 && threshold > 0 ? debt / (units * (threshold / 10_000)) : 0,
            collateralPrice, errors,
        };
        return { quote, collateralPool, borrowPool, collateralAmount, borrowAmount, maxLtvBps };
    }

    async quote(body: Parameters<LendService['quoteWith']>[0]): Promise<LendQuote> {
        return (await this.quoteWith(body, false)).quote;
    }

    private view(raw: RawLoan, pools: RawPool[], prices: RawPrices, createdAt: number): LoanView {
        const collateralPool = pools.find(p => p.id === raw.collateral.poolId);
        const borrowPool = pools.find(p => p.id === raw.borrow.poolId);
        const cDec = Number(raw.collateral.decimals), bDec = Number(raw.borrow.decimals);
        const targets = (t: RawLoan['repayment']['targets']): LoanTarget[] => Object.entries(t ?? {}).flatMap(([chain, q]) =>
            (q ? [{ chain, address: q.target.address, amount: q.amount.toString(), feeAmount: q.inflowFeeAmount.toString() }] : []));
        const phase = phaseOf(raw.status);

        // Before the deposit lands the position is empty: show the terms the loan was created with.
        const funded = raw.position.collateralAmount > 0n;
        const collateral = funded ? raw.position.collateralAmount : raw.collateral.amount;
        const debt = raw.position.totalDebtAmount > 0n ? raw.position.totalDebtAmount : raw.repayment.debtAmount > 0n ? raw.repayment.debtAmount : raw.borrow.amount;
        const collateralPrice = prices[raw.collateral.asset] ?? 0;
        const collateralUsd = toNum(collateral, cDec) * collateralPrice;
        const debtUsd = toNum(debt, bDec) * (prices[raw.borrow.asset] ?? 0);
        const threshold = Number(collateralPool?.liquidationThreshold ?? 0n);
        const closed = !OPEN_PHASES.includes(phase);

        return {
            ref: raw.ref, provider: 'liquidium', phase,
            status: { operation: raw.status.operation, state: raw.status.state, confirmations: raw.status.confirmations, requiredConfirmations: raw.status.requiredConfirmations },
            collateral: { asset: raw.collateral.asset, chain: collateralPool?.chain ?? raw.collateral.asset, decimals: cDec, amount: raw.collateral.amount.toString() },
            borrow: { asset: raw.borrow.asset, chain: raw.borrow.chain ?? borrowPool?.chain ?? '', decimals: bDec, amount: raw.borrow.amount.toString(), destination: addressOf(raw.borrow.destination) },
            refundDestination: addressOf(raw.refundDestination),
            deposit: {
                amount: raw.initialDeposit.collateralAmount.toString(), targets: targets(raw.initialDeposit.targets),
                expiresAt: raw.initialDeposit.expiryTimestamp ? Number(raw.initialDeposit.expiryTimestamp) * 1000 : null,
                detectedAt: raw.initialDeposit.detectedTimestamp ? Number(raw.initialDeposit.detectedTimestamp) * 1000 : null,
            },
            repayment: { debt: raw.repayment.debtAmount.toString(), targets: targets(raw.repayment.targets) },
            position: {
                collateral: raw.position.collateralAmount.toString(), borrowed: raw.position.borrowedAmount.toString(),
                interest: raw.position.debtInterestAmount.toString(), totalDebt: raw.position.totalDebtAmount.toString(),
            },
            ltvBps: closed || collateralUsd <= 0 ? 0 : Math.round((debtUsd / collateralUsd) * 10_000),
            liquidationThresholdBps: threshold,
            liquidationPrice: closed || threshold <= 0 || collateral <= 0n ? 0 : debtUsd / (toNum(collateral, cDec) * (threshold / 10_000)),
            borrowApy: borrowPool ? rayPct(borrowPool.estimatedBorrowingApy) : 0,
            createdAt, updatedAt: this.now(),
        };
    }

    /** Write what the protocol says about a loan into the store, and say so in the event log when it moved on. */
    private remember(raw: RawLoan, pools: RawPool[], prices: RawPrices): LoanRecord {
        const prev = this.d.store.get(raw.ref);
        const now = this.now();
        const view = this.view(raw, pools, prices, prev?.createdAt ?? now);
        const history = prev?.history ?? [];
        const moved = !prev || prev.view.phase !== view.phase || prev.view.status.state !== view.status.state || prev.view.status.operation !== view.status.operation;
        if (moved) history.push({ at: now, phase: view.phase, state: `${view.status.operation}/${view.status.state}` });

        let warnedBps = prev?.warnedBps;
        const warnAt = this.d.settings.get().warnLtvBps;
        if (view.phase === 'active' && view.ltvBps >= warnAt && (warnedBps ?? 0) < warnAt) {
            warnedBps = warnAt;
            this.record('loan.ltv_warning', 'warn', `Loan ${view.ref} is at ${(view.ltvBps / 100).toFixed(1)}% LTV; it can be liquidated at ${(view.liquidationThresholdBps / 100).toFixed(0)}%`, view.ref, { ltvBps: view.ltvBps });
        } else if (view.ltvBps < warnAt - 300) warnedBps = undefined;

        const record = this.d.store.put({
            ref: view.ref, loanId: raw.loanId.toString(), view,
            addresses: [...new Set([view.borrow.destination, view.refundDestination, ...(prev?.addresses ?? [])].filter(Boolean))],
            history: history.slice(-50), warnedBps, createdAt: prev?.createdAt ?? now, updatedAt: now,
        });
        if (prev && prev.view.phase !== view.phase) {
            const severity = view.phase === 'failed' || view.phase === 'liquidated' ? 'error' : view.phase === 'expired' ? 'warn' : view.phase === 'active' || view.phase === 'closed' ? 'success' : 'info';
            this.record(`loan.${view.phase}`, severity, `Loan ${view.ref}: ${prev.view.phase} → ${view.phase}`, view.ref, { from: prev.view.phase, to: view.phase });
        }
        return record;
    }

    async create(body: CreateLoanBody): Promise<LoanView> {
        const settings = this.d.settings.get();
        if (settings.paused) throw new HttpError(503, settings.pauseReason || 'New loans are paused right now.');
        // Re-read the pools: the quote the user saw may be a minute old.
        const { quote, collateralPool, borrowPool, collateralAmount, borrowAmount, maxLtvBps } = await this.quoteWith(body, true);
        if (quote.errors.length) throw new HttpError(400, quote.errors[0]);

        const check = (address: unknown, chain: string, name: string): string => {
            let a = String(address ?? '').trim();
            if (chain === 'ETH' && !a.startsWith('0x') && /^[0-9a-fA-F]{40}$/.test(a)) {
                a = `0x${a}`;
            }
            if (chain === 'BTC' && (a.startsWith('BC1') || a.startsWith('TB1') || a.startsWith('bc1') || a.startsWith('tb1'))) {
                a = a.toLowerCase();
            }
            const rule = ADDRESS[chain];
            if (!a || (rule && !rule.test(a))) throw new HttpError(400, `${name} is not a valid ${chain} address`);
            return a;
        };
        const borrowDestination = check(body.borrowDestination, borrowPool.chain, 'borrowDestination');
        const refundDestination = check(body.refundDestination, collateralPool.chain, 'refundDestination');
        const windowMin = Math.max(15, Math.min(24 * 60, Math.round(body.depositWindowMinutes ?? DEFAULT_DEPOSIT_WINDOW_MIN)));

        const raw = await this.upstream('create the loan', () => this.d.protocol.create({
            collateral: { poolId: collateralPool.id, asset: collateralPool.asset, amount: collateralAmount },
            borrow: { poolId: borrowPool.id, asset: borrowPool.asset, chain: borrowPool.chain, amount: borrowAmount, destination: borrowDestination },
            refund: { chain: collateralPool.chain, destination: refundDestination },
            ltvMaxBps: BigInt(maxLtvBps),
            depositWindowSeconds: BigInt(windowMin * 60),
        }));
        const { pools, prices } = await this.data();
        const record = this.remember(raw, pools, prices);
        this.record('loan.created', 'info', `Loan ${record.ref}: ${toNum(borrowAmount, Number(borrowPool.decimals))} ${borrowPool.asset} against ${toNum(collateralAmount, Number(collateralPool.decimals))} ${collateralPool.asset}`, record.ref, {
            collateral: quote.collateral, borrow: quote.borrow, ltvBps: quote.ltvBps,
        });
        return record.view;
    }

    /** A loan by reference. Read from the protocol when it is not known here, or when `fresh` is asked for. */
    async get(ref: string, fresh = false): Promise<LoanView> {
        const key = String(ref ?? '').trim();
        if (!/^[A-Za-z0-9]{4,16}$/.test(key)) throw new HttpError(400, 'not a loan reference');
        const known = this.d.store.get(key);
        if (known && !fresh) return known.view;
        try {
            const raw = await this.upstream('read the loan', () => this.d.protocol.get(known?.ref ?? key));
            const { pools, prices } = await this.data();
            return this.remember(raw, pools, prices).view;
        } catch (e) {
            if (known) return known.view;          // the protocol is unreachable: the last known state is better than nothing
            if (e instanceof HttpError && e.statusCode === 502) throw new HttpError(404, 'loan not found');
            throw e;
        }
    }

    /** Loans that belong to an address: the ones made here, plus any the protocol knows for it (a restored wallet). */
    async find(query: string): Promise<LoanView[]> {
        const q = String(query ?? '').trim();
        if (q.length < 4 || q.length > 100) throw new HttpError(400, 'enter a loan ID or an address');
        const out = new Map<string, LoanView>();
        for (const l of this.d.store.byAddress(q)) out.set(l.ref, l.view);
        const byRef = this.d.store.get(q);
        if (byRef) out.set(byRef.ref, byRef.view);
        const remote = await this.d.protocol.find(q).catch(() => [] as { ref: string }[]);
        for (const { ref } of remote.slice(0, 20)) {
            if (out.has(ref)) continue;
            const view = await this.get(ref, true).catch(() => null);
            if (view) out.set(ref, view);
        }
        return [...out.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Refresh every open loan. Called on a timer; one run at a time. */
    async poll(): Promise<number> {
        if (this.polling) return 0;
        this.polling = true;
        let refreshed = 0;
        try {
            const open = this.d.store.all().filter(l => OPEN_PHASES.includes(l.view.phase));
            if (!open.length) return 0;
            const { pools, prices } = await this.data(true);
            for (const l of open) {
                // A loan nobody ever funded stops being asked about a day after its window closed.
                if (l.view.phase === 'awaiting_deposit' && l.view.deposit.expiresAt && this.now() - l.view.deposit.expiresAt > 24 * 3_600_000) continue;
                try {
                    this.remember(await this.d.protocol.get(l.ref), pools, prices);
                    this.lastOk = this.now();
                    refreshed++;
                } catch (e) {
                    this.lastError = `read loan ${l.ref}: ${(e as Error)?.message ?? e}`.slice(0, 300);
                }
            }
        } catch { /* markets unreachable: the next run tries again */ } finally {
            this.polling = false;
        }
        return refreshed;
    }

    /** Figures for the admin overview. */
    async overview() {
        const all = this.d.store.all();
        const prices = this.cache?.prices ?? {};
        const byPhase: Record<string, number> = {};
        let collateralUsd = 0, debtUsd = 0, ltvSum = 0, active = 0;
        for (const l of all) {
            byPhase[l.view.phase] = (byPhase[l.view.phase] ?? 0) + 1;
            if (l.view.phase !== 'active' && l.view.phase !== 'repaying') continue;
            collateralUsd += toNum(BigInt(l.view.position.collateral), l.view.collateral.decimals) * (prices[l.view.collateral.asset] ?? 0);
            debtUsd += toNum(BigInt(l.view.position.totalDebt), l.view.borrow.decimals) * (prices[l.view.borrow.asset] ?? 0);
            ltvSum += l.view.ltvBps;
            active++;
        }
        const warnAt = this.d.settings.get().warnLtvBps;
        return {
            total: all.length, byPhase, active, collateralUsd, debtUsd,
            averageLtvBps: active ? Math.round(ltvSum / active) : 0,
            atRisk: all.filter(l => l.view.phase === 'active' && l.view.ltvBps >= warnAt).map(l => l.view),
            settings: this.d.settings.get(), provider: { name: 'liquidium', ...this.health() },
        };
    }

    // ── Advanced Mode: Profiles, Portfolios, Borrow, Withdraw, Supply ──

    async resolveProfile(address: string): Promise<{ profileId: string | null; address: string }> {
        const clean = (address ?? '').trim();
        if (!clean) throw new HttpError(400, 'Address is required');
        const isBtc = ADDRESS.BTC.test(clean);
        const normEth = clean.startsWith('0x') ? clean : `0x${clean}`;
        const isEth = ADDRESS.ETH.test(normEth);
        if (!isBtc && !isEth) throw new HttpError(400, `${clean} is not a valid BTC or EVM address`);
        const target = isEth ? normEth : clean;
        const profileId = await this.upstream('resolve profile', () => this.d.protocol.getProfileId ? this.d.protocol.getProfileId(target) : Promise.resolve(null));
        if (profileId) {
            this.d.profileStore?.upsert(profileId, target, isBtc ? 'BTC' : 'ETH');
        }
        return { profileId, address: target };
    }

    async prepareCreateProfile(body: PrepareCreateAccountBody): Promise<PrepareCreateAccountView> {
        const clean = (body?.account ?? '').trim();
        const normEth = clean.startsWith('0x') ? clean : `0x${clean}`;
        const isBtc = ADDRESS.BTC.test(clean);
        const isEth = ADDRESS.ETH.test(normEth);
        if (!isBtc && !isEth) throw new HttpError(400, `${clean} is not a valid BTC or EVM address`);
        const target = isEth ? normEth : clean;
        if (!this.d.protocol.prepareCreateProfile) throw new HttpError(501, 'Profile preparation is not supported by this protocol instance');
        const prep = await this.upstream('prepare profile creation', () => this.d.protocol.prepareCreateProfile!(target));
        return {
            account: prep.account,
            message: prep.message,
            expiryTimestamp: prep.expiryTimestamp.toString(),
            actionType: prep.actionType,
        };
    }

    async createProfile(body: CreateAccountBody): Promise<{ profileId: string; account: string }> {
        const clean = (body?.account ?? '').trim();
        const normEth = clean.startsWith('0x') ? clean : `0x${clean}`;
        const isBtc = ADDRESS.BTC.test(clean);
        const isEth = ADDRESS.ETH.test(normEth);
        if (!isBtc && !isEth) throw new HttpError(400, `${clean} is not a valid BTC or EVM address`);
        const target = isEth ? normEth : clean;

        // If the wallet already has a registered profile on the canister, return it immediately
        if (this.d.protocol.getProfileId) {
            const existing = await this.d.protocol.getProfileId(target).catch(() => null);
            if (existing) {
                this.d.profileStore?.upsert(existing, target, isBtc ? 'BTC' : 'ETH');
                return { profileId: existing, account: target };
            }
        }

        if (!body.signature) throw new HttpError(400, 'Signature is required');
        if (!body.expiryTimestamp) throw new HttpError(400, 'Expiry timestamp is required');
        if (!this.d.protocol.createProfile) throw new HttpError(501, 'Profile creation is not supported by this protocol instance');

        let profileId: string;
        try {
            profileId = await this.upstream('create profile', () => this.d.protocol.createProfile!(target, body.chain, body.signature, BigInt(body.expiryTimestamp)));
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            const m = msg.match(/already linked to profile ([a-z0-9\-]+)/i);
            if (m && m[1]) {
                profileId = m[1];
            } else if (this.d.protocol.getProfileId) {
                const existing = await this.d.protocol.getProfileId(target).catch(() => null);
                if (existing) {
                    profileId = existing;
                } else {
                    throw e;
                }
            } else {
                throw e;
            }
        }

        this.d.profileStore?.upsert(profileId, target, body.chain);
        this.record('profile.create', 'success', `Connected Liquidium profile for ${target}: ${profileId}`, undefined, { profileId, account: target });
        return { profileId, account: target };
    }

    async portfolio(profileId: string): Promise<PortfolioView> {
        const pid = (profileId ?? '').trim();
        if (!pid) throw new HttpError(400, 'profileId is required');
        const { pools, prices } = await this.data();
        const [summary, reserves, hfData] = await Promise.all([
            this.d.protocol.getUserPositionSummary ? this.d.protocol.getUserPositionSummary(pid).catch(() => null) : null,
            this.d.protocol.getUserReserves ? this.d.protocol.getUserReserves(pid).catch(() => []) : [],
            this.d.protocol.getHealthFactor ? this.d.protocol.getHealthFactor(pid).catch(() => null) : null,
        ]);

        const supplied: AdvancedPositionView[] = [];
        const borrowed: AdvancedPositionView[] = [];
        let suppliedUsd = 0;
        let borrowedUsd = 0;

        for (const r of (reserves ?? [])) {
            const p = r.pool;
            const pos = r.position;
            const asset = p.asset;
            const decimals = Number(p.decimals);
            const price = r.priceUsd || (prices[asset] ?? 0);
            const depAmount = BigInt(pos.deposited ?? 0n);
            const debtAmount = BigInt(pos.borrowed ?? 0n);
            const earnedInterest = BigInt(pos.earnedInterest ?? 0n);
            const debtInterest = BigInt(pos.debtInterest ?? 0n);

            if (depAmount > 0n) {
                const usd = Number(r.suppliedUsd ? Number(r.suppliedUsd) / 10 ** Number(r.usdDecimals ?? 27) : toNum(depAmount, decimals) * price);
                suppliedUsd += usd;
                supplied.push({
                    asset,
                    poolId: p.id,
                    amount: depAmount.toString(),
                    usd,
                    apy: rayPct(p.estimatedLendingApy),
                    interest: earnedInterest.toString(),
                });
            }

            if (debtAmount > 0n) {
                const usd = Number(r.borrowedUsd ? Number(r.borrowedUsd) / 10 ** Number(r.usdDecimals ?? 27) : toNum(debtAmount, decimals) * price);
                borrowedUsd += usd;
                borrowed.push({
                    asset,
                    poolId: p.id,
                    amount: debtAmount.toString(),
                    usd,
                    apy: rayPct(p.estimatedBorrowingApy),
                    interest: debtInterest.toString(),
                });
            }
        }

        // Summary fallbacks
        if (summary) {
            const usdDec = Number(summary.usdDecimals ?? 27);
            if (summary.totalCollateralUsd) suppliedUsd = Number(summary.totalCollateralUsd) / 10 ** usdDec;
            if (summary.totalDebtUsd) borrowedUsd = Number(summary.totalDebtUsd) / 10 ** usdDec;
        }

        const thresholdBps = 7400;
        const maxLtv = 0.65;
        const netValueUsd = suppliedUsd - borrowedUsd;
        const earn = supplied.reduce((s, p) => s + p.usd * p.apy, 0);
        const pay = borrowed.reduce((s, p) => s + p.usd * p.apy, 0);
        const netApy = netValueUsd > 0 ? (earn - pay) / netValueUsd : 0;
        const netInterestUsd = supplied.reduce((s, p) => s + toNum(BigInt(p.interest || '0'), 8) * (prices[p.asset] ?? 1), 0)
            - borrowed.reduce((s, p) => s + toNum(BigInt(p.interest || '0'), 8) * (prices[p.asset] ?? 1), 0);

        let healthPct = 100;
        let healthFactor: number | null = null;
        if (hfData && hfData.healthFactor !== null) {
            const hfDec = Number(hfData.healthFactorDecimals ?? 18);
            healthFactor = Number(hfData.healthFactor) / 10 ** hfDec;
            healthPct = Math.min(100, Math.max(0, Math.round((healthFactor - 1.0) * 100)));
        } else if (borrowedUsd > 0 && suppliedUsd > 0) {
            const used = borrowedUsd / (suppliedUsd * (thresholdBps / 10_000));
            healthPct = Math.max(0, Math.min(100, Math.round((1 - used) * 100)));
        }

        const room = Math.max(0, suppliedUsd * maxLtv - borrowedUsd);
        const borrowable: Record<string, string> = {};
        for (const p of pools) {
            const isSupplied = supplied.some(s => s.asset === p.asset);
            if (isSupplied) {
                borrowable[p.asset] = '0';
                continue;
            }
            const price = prices[p.asset] ?? 1;
            const dec = Number(p.decimals);
            const units = (room / price) * 10 ** Math.min(dec, 8);
            borrowable[p.asset] = BigInt(Math.floor(units)).toString() + '0'.repeat(Math.max(0, dec - 8));
        }

        return {
            profileId: pid,
            supplied,
            borrowed,
            suppliedUsd,
            borrowedUsd,
            healthPct,
            healthFactor,
            netApy,
            netValueUsd,
            netInterestUsd,
            borrowable,
            wallet: {},
        };
    }

    async prepareBorrow(body: PrepareBorrowBody): Promise<PrepareBorrowView> {
        if (!this.d.protocol.prepareBorrow) throw new HttpError(501, 'Borrowing not supported');
        const amount = parseAmount(body.amount, 'amount');
        const prep = await this.upstream('prepare borrow', () => this.d.protocol.prepareBorrow!({
            profileId: body.profileId,
            poolId: body.poolId,
            amount,
            chain: body.chain,
            receiver: body.receiver,
            signerWalletAddress: body.signerWalletAddress,
        }));
        return {
            message: prep.message,
            expiryTimestamp: prep.expiryTimestamp.toString(),
            actionType: prep.actionType ?? '',
            data: prep.data,
        };
    }

    async submitBorrow(body: SubmitBorrowBody): Promise<OutflowReceiptView> {
        if (!this.d.protocol.submitBorrow) throw new HttpError(501, 'Submit borrow not supported');
        const { pools, prices } = await this.data();
        const pool = pools.find(p => p.id === body.poolId);
        const res = await this.upstream('submit borrow', () => this.d.protocol.submitBorrow!(
            {
                profileId: body.profileId,
                poolId: body.poolId,
                amount: body.amount,
                chain: body.chain,
                receiver: body.receiver,
                signerWalletAddress: body.signerWalletAddress,
                expiryTimestamp: body.expiryTimestamp,
            },
            {
                signature: body.signature,
                chain: body.signingChain,
                account: body.signerWalletAddress,
            }
        ));
        const dec = pool ? Number(pool.decimals) : 8;
        const price = pool ? (prices[pool.asset] ?? 0) : 0;
        const usd = toNum(BigInt(body.amount), dec) * price;
        this.record('borrow.outflow', 'info', `Borrow outflow submitted for ${body.amount} (${pool?.asset ?? ''})`, undefined, { id: res.id, txid: res.txid });
        return {
            id: res.id,
            txid: res.txid,
            asset: pool?.asset ?? 'USDC',
            amount: body.amount,
            usd,
            status: String(res.status ?? 'active'),
            etaMinutes: body.chain.toUpperCase() === 'BTC' ? 40 : 15,
        };
    }

    async prepareWithdraw(body: PrepareWithdrawBody): Promise<PrepareWithdrawView> {
        if (!this.d.protocol.prepareWithdraw) throw new HttpError(501, 'Withdraw not supported');
        const amount = parseAmount(body.amount, 'amount');
        const prep = await this.upstream('prepare withdraw', () => this.d.protocol.prepareWithdraw!({
            profileId: body.profileId,
            poolId: body.poolId,
            amount,
            chain: body.chain,
            receiver: body.receiver,
            signerWalletAddress: body.signerWalletAddress,
        }));
        return {
            message: prep.message,
            expiryTimestamp: prep.expiryTimestamp.toString(),
            actionType: prep.actionType ?? '',
            data: prep.data,
        };
    }

    async submitWithdraw(body: SubmitWithdrawBody): Promise<OutflowReceiptView> {
        if (!this.d.protocol.submitWithdraw) throw new HttpError(501, 'Submit withdraw not supported');
        const { pools, prices } = await this.data();
        const pool = pools.find(p => p.id === body.poolId);
        const res = await this.upstream('submit withdraw', () => this.d.protocol.submitWithdraw!(
            {
                profileId: body.profileId,
                poolId: body.poolId,
                amount: body.amount,
                chain: body.chain,
                receiver: body.receiver,
                signerWalletAddress: body.signerWalletAddress,
                expiryTimestamp: body.expiryTimestamp,
            },
            {
                signature: body.signature,
                chain: body.signingChain,
                account: body.signerWalletAddress,
            }
        ));
        const dec = pool ? Number(pool.decimals) : 8;
        const price = pool ? (prices[pool.asset] ?? 0) : 0;
        const usd = toNum(BigInt(body.amount), dec) * price;
        this.record('withdraw.outflow', 'info', `Withdraw outflow submitted for ${body.amount} (${pool?.asset ?? ''})`, undefined, { id: res.id, txid: res.txid });
        return {
            id: res.id,
            txid: res.txid,
            asset: pool?.asset ?? 'BTC',
            amount: body.amount,
            usd,
            status: String(res.status ?? 'active'),
            etaMinutes: body.chain.toUpperCase() === 'BTC' ? 40 : 15,
        };
    }

    async supplyTarget(body: SupplyTargetBody): Promise<SupplyTargetView> {
        if (!this.d.protocol.supplyTarget) throw new HttpError(501, 'Supply target not supported');
        const flow = await this.upstream('resolve supply target', () => this.d.protocol.supplyTarget!(body.profileId, body.poolId, body.action, body.chain));
        return {
            targetAddress: flow.target.address,
            poolId: body.poolId,
            action: body.action,
            chain: body.chain,
            type: flow.type,
        };
    }

    async submitInflow(body: SubmitInflowBody): Promise<{ txid: string; operation: string }> {
        if (!this.d.protocol.submitInflow) throw new HttpError(501, 'Submit inflow not supported');
        const res = await this.upstream('submit inflow', () => this.d.protocol.submitInflow!(body.txid, body.operation, body.chain));
        return { txid: res.txid, operation: body.operation };
    }

    // ── Admin: User and Account Tracking ──

    async adminUsers(query: { q?: string; limit?: number; offset?: number } = {}): Promise<AdminLendUsersResponse> {
        const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
        const offset = Math.max(Number(query.offset) || 0, 0);
        const needle = (query.q ?? '').trim().toLowerCase();

        let profiles = this.d.profileStore ? this.d.profileStore.all() : [];

        // Also discover addresses from LoanStore if they don't have a profile yet
        const loans = this.d.store.all();
        const knownAddresses = new Set<string>();
        for (const p of profiles) {
            knownAddresses.add(p.primaryAddress.toLowerCase());
            for (const w of p.wallets) knownAddresses.add(w.address.toLowerCase());
        }

        for (const l of loans) {
            for (const a of l.addresses) {
                const cleanA = a.toLowerCase();
                if (!knownAddresses.has(cleanA) && cleanA.length >= 26) {
                    knownAddresses.add(cleanA);
                    const isBtc = ADDRESS.BTC.test(a);
                    profiles.push({
                        profileId: `wallet:${a.slice(0, 8)}...${a.slice(-4)}`,
                        primaryAddress: a,
                        wallets: [{ address: a, chain: isBtc ? 'BTC' : 'ETH', addedAt: l.createdAt }],
                        createdAt: l.createdAt,
                        lastSeenAt: l.updatedAt || l.createdAt,
                    });
                }
            }
        }

        if (needle) {
            profiles = profiles.filter(p =>
                p.profileId.toLowerCase().includes(needle) ||
                p.primaryAddress.toLowerCase().includes(needle) ||
                p.wallets.some(w => w.address.toLowerCase().includes(needle)) ||
                (p.notes && p.notes.toLowerCase().includes(needle))
            );
        }

        const total = profiles.length;
        const page = profiles.slice(offset, offset + limit);

        const userSummaries: AdminLendUserSummary[] = await Promise.all(page.map(async (prof) => {
            let pf: PortfolioView | null = null;
            if (!prof.profileId.startsWith('wallet:')) {
                try {
                    pf = await this.portfolio(prof.profileId);
                } catch {
                    pf = null;
                }
            }

            const userAddrs = new Set([prof.primaryAddress.toLowerCase(), ...prof.wallets.map(w => w.address.toLowerCase())]);
            const matchingLoans = loans.filter(l => l.addresses.some(a => userAddrs.has(a.toLowerCase())));

            return {
                profileId: prof.profileId,
                primaryAddress: prof.primaryAddress,
                wallets: prof.wallets,
                createdAt: prof.createdAt,
                lastSeenAt: prof.lastSeenAt,
                notes: prof.notes,
                portfolio: pf ? {
                    suppliedUsd: pf.suppliedUsd,
                    borrowedUsd: pf.borrowedUsd,
                    netValueUsd: pf.netValueUsd,
                    netApy: pf.netApy,
                    healthFactor: pf.healthFactor,
                    healthPct: pf.healthPct,
                    suppliedCount: pf.supplied.length,
                    borrowedCount: pf.borrowed.length,
                } : undefined,
                loansCount: matchingLoans.length,
            };
        }));

        let totalSuppliedUsd = 0;
        let totalBorrowedUsd = 0;
        let activeBorrowers = 0;
        let atRiskCount = 0;

        for (const u of userSummaries) {
            if (u.portfolio) {
                totalSuppliedUsd += u.portfolio.suppliedUsd;
                totalBorrowedUsd += u.portfolio.borrowedUsd;
                if (u.portfolio.borrowedUsd > 0) activeBorrowers++;
                if (u.portfolio.healthFactor !== null && u.portfolio.healthFactor < 1.3 && u.portfolio.borrowedUsd > 0) {
                    atRiskCount++;
                }
            }
        }

        return {
            total,
            offset,
            limit,
            stats: {
                totalUsers: total,
                activeBorrowers,
                totalSuppliedUsd,
                totalBorrowedUsd,
                atRiskCount,
            },
            users: userSummaries,
        };
    }

    async adminUserDetail(profileId: string): Promise<AdminLendUserDetail> {
        const pid = (profileId ?? '').trim();
        if (!pid) throw new HttpError(400, 'profileId is required');

        let prof = this.d.profileStore?.get(pid);
        if (!prof) {
            prof = this.d.profileStore?.byAddress(pid);
        }

        if (!prof) {
            const isBtc = ADDRESS.BTC.test(pid);
            const normEth = pid.startsWith('0x') ? pid : `0x${pid}`;
            const isEth = ADDRESS.ETH.test(normEth);
            if (isBtc || isEth) {
                const target = isEth ? normEth : pid;
                const resolvedId = this.d.protocol.getProfileId ? await this.d.protocol.getProfileId(target).catch(() => null) : null;
                if (resolvedId) {
                    prof = this.d.profileStore?.upsert(resolvedId, target, isBtc ? 'BTC' : 'ETH') ?? {
                        profileId: resolvedId,
                        primaryAddress: target,
                        wallets: [{ address: target, chain: isBtc ? 'BTC' : 'ETH', addedAt: this.now() }],
                        createdAt: this.now(),
                        lastSeenAt: this.now(),
                    };
                }
            }
        }

        if (!prof) {
            prof = {
                profileId: pid,
                primaryAddress: pid,
                wallets: [],
                createdAt: this.now(),
                lastSeenAt: this.now(),
            };
        }

        let pf: PortfolioView;
        try {
            pf = await this.portfolio(prof.profileId);
        } catch {
            pf = {
                profileId: prof.profileId,
                supplied: [],
                borrowed: [],
                suppliedUsd: 0,
                borrowedUsd: 0,
                healthPct: 100,
                healthFactor: null,
                netApy: 0,
                netValueUsd: 0,
                netInterestUsd: 0,
                borrowable: {},
                wallet: {},
            };
        }

        const userAddrs = new Set([prof.primaryAddress.toLowerCase(), ...prof.wallets.map(w => w.address.toLowerCase())]);
        const loans = this.d.store.all().filter(l => l.addresses.some(a => userAddrs.has(a.toLowerCase()))).map(l => l.view);

        const events = this.d.events ? this.d.events.query({ section: 'lend', limit: 50 }).events.filter(e => {
            const text = JSON.stringify(e).toLowerCase();
            return text.includes(prof!.profileId.toLowerCase()) || [...userAddrs].some(a => a.length >= 8 && text.includes(a));
        }) : [];

        return {
            profile: prof,
            portfolio: pf,
            loans,
            events,
        };
    }

    async adminTrackUser(addressOrProfileId: string): Promise<AdminLendUserDetail> {
        const q = (addressOrProfileId ?? '').trim();
        if (!q) throw new HttpError(400, 'Address or profile ID is required');

        const isBtc = ADDRESS.BTC.test(q);
        const normEth = q.startsWith('0x') ? q : `0x${q}`;
        const isEth = ADDRESS.ETH.test(normEth);

        let profileId: string | null = null;
        let address = q;
        let chain = 'ETH';

        if (isBtc || isEth) {
            address = isEth ? normEth : q;
            chain = isBtc ? 'BTC' : 'ETH';
            if (this.d.protocol.getProfileId) {
                profileId = await this.d.protocol.getProfileId(address).catch(() => null);
            }
            if (!profileId) {
                throw new HttpError(404, `No Liquidium profile found for wallet address ${address}`);
            }
        } else {
            profileId = q;
        }

        this.d.profileStore?.upsert(profileId, isBtc || isEth ? address : '', chain);
        this.record('admin.user.track', 'info', `Tracked lending profile: ${profileId}`, undefined, { profileId, address });

        return this.adminUserDetail(profileId);
    }

    adminSetUserNotes(profileId: string, notes: string): { profileId: string; notes: string } {
        const updated = this.d.profileStore?.updateNotes(profileId, notes);
        if (!updated) throw new HttpError(404, 'Profile not found');
        return { profileId: updated.profileId, notes: updated.notes ?? '' };
    }
}

