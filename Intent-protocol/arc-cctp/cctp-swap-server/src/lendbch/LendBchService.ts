/**
 * LendBchService — the read layer: the market view, the self-check, and loan lookup by address or loanTokenId.
 * No keys, no funds, no broadcasting; it reads the chain and derives risk numbers. The builders (P3) and the
 * prepare/submit flow (P4) land alongside this later.
 *
 * Linking a loan to its loanTokenId without any transaction history: the loan UTXO (paryonTokenId, 27-byte state)
 * and its sidecar (category = loanTokenId) are always created and updated in the same transaction, with the sidecar
 * one output after the loan. So the live loan and live sidecar share a txid, and sidecar.vout = loan.vout + 1. Two
 * getUtxos calls — one on the loan address, one on the sidecar address — map every loan to its token id.
 */
import type { Utxo } from 'cashscript';
import { HttpError } from '../types.js';
import type { EventLog } from '../ops/EventLog.js';
import { ChainClient, isThreadUtxo, pickThread, normalizeUtxo } from './chain.js';
import { deriveDeployment } from './deployment.js';
import { deriveFullDeployment } from './deployFull.js';
import { decodeLoan, decodeBorrowingPeriod, decodePrice } from './state.js';
import * as math from './math.js';
import { LendBchSettingsStore } from './SettingsStore.js';
import { LendBchLoanStore } from './LoanStore.js';
import {
    buildCreateLoanKeyTx,
    buildBorrowTx,
    buildManageTx,
    buildChangeRateTx,
    type BuildLoanKeyResult,
    type BuildBorrowResult,
    type BuildManageResult,
    type BuildChangeRateResult,
} from './builders/index.js';
import type {
    Deployment,
    DeploymentParams,
    DerivedContract,
    LoanView,
    MarketView,
    BorrowQuoteRequest,
    BorrowQuoteResponse,
    BuildLoanKeyRequest,
    BuildBorrowRequest,
    BuildManageRequest,
    BuildChangeRateRequest,
    PrepareBorrowRequest,
    PrepareBorrowResponse,
    PrepareManageRequest,
    PrepareManageResponse,
    PrepareRateRequest,
    PrepareRateResponse,
    SubmitRequest,
    SubmitResponse,
    TrackedLoan,
} from './types.js';

/** A live loan with its decoded state and the loanTokenId its sidecar carries. */
interface IndexedLoan {
    loanTokenId: string;
    utxo: Utxo;
    state: ReturnType<typeof decodeLoan>;
}

export interface SelfCheckResult {
    ok: boolean;
    reason: string | null;
    /** Which price variant is live (has threads), if any. */
    priceContract: DerivedContract | null;
    checkedAt: number;
}

export interface LendBchServiceOpts {
    params: DeploymentParams;
    settings: LendBchSettingsStore;
    loanStore?: LendBchLoanStore;
    chain?: ChainClient;
    events?: EventLog;
    /** Milliseconds to cache the loan index / market snapshot. 0 disables caching (tests). */
    cacheMs?: number;
    /** Fallback data directory if loanStore is not supplied. */
    dataDir?: string;
}

export class LendBchService {
    readonly deployment: Deployment;
    private chain: ChainClient;
    private settings: LendBchSettingsStore;
    readonly loanStore: LendBchLoanStore;
    private events?: EventLog;
    private cacheMs: number;

    private lastSelfCheck: SelfCheckResult = { ok: false, reason: 'not yet checked', priceContract: null, checkedAt: 0 };
    private indexCache: { at: number; loans: IndexedLoan[]; priceCents: number | null; period: number | null } | null = null;

    constructor(opts: LendBchServiceOpts) {
        this.settings = opts.settings;
        this.loanStore = opts.loanStore ?? new LendBchLoanStore(opts.dataDir ?? 'data');
        this.events = opts.events;
        this.cacheMs = opts.cacheMs ?? 15_000;
        this.chain = opts.chain ?? new ChainClient(opts.params.network);
        this.deployment = deriveDeployment(opts.params, this.chain.getProvider());
    }

    get network() {
        return this.deployment.params.network;
    }

    /** The underlying chain client (used by the live read-only test and, later, the poller). */
    chainClient(): ChainClient {
        return this.chain;
    }

    getSelfCheck(): SelfCheckResult {
        return { ...this.lastSelfCheck };
    }

    /**
     * Verify the deployment is in the shape we expect: a borrowing thread, a live price contract, and loan/manage
     * threads. A missing price thread is the signature of a price-contract migration (or a V2 cut-over), so when the
     * check fails the module treats itself as paused and logs an error. Returns the result and caches it.
     */
    async selfCheck(): Promise<SelfCheckResult> {
        const c = this.deployment.contracts;
        const paryon = this.deployment.params.tokenIds.paryonTokenId;
        try {
            const borrowingUtxos = await this.chain.getUtxos(c.borrowing.address);
            if (!pickThread(borrowingUtxos, paryon)) throw new Error('no borrowing thread found');

            // The price contract holds a mutable NFT of the paryon category (the "+ 0x01" in the contracts is the
            // mutable capability byte, not a separate category). The live variant is whichever still has a thread.
            let priceContract: DerivedContract | null = null;
            for (const variant of this.deployment.priceVariants) {
                const utxos = await this.chain.getUtxos(variant.address);
                if (utxos.some(u => isThreadUtxo(u, paryon))) { priceContract = variant; break; }
            }
            if (!priceContract) throw new Error('no price-contract thread found (possible migration or V2 cut-over)');

            const manageUtxos = await this.chain.getUtxos(c.manage.address);
            if (!manageUtxos.length) throw new Error('no manage threads found');

            const result: SelfCheckResult = { ok: true, reason: null, priceContract, checkedAt: Date.now() };
            this.lastSelfCheck = result;
            return result;
        } catch (e) {
            const reason = (e as Error).message;
            if (this.lastSelfCheck.ok || this.lastSelfCheck.reason !== reason) {
                this.events?.record({ section: 'lendbch', type: 'selfcheck.failed', severity: 'error', summary: `lendbch self-check failed: ${reason}`, subject: { kind: 'settings', id: 'lendbch' } });
            }
            const result: SelfCheckResult = { ok: false, reason, priceContract: null, checkedAt: Date.now() };
            this.lastSelfCheck = result;
            return result;
        }
    }

    /** Is the module serving? Admin pause OR a failed self-check both pause it. */
    private pauseState(): { paused: boolean; reason: string | null } {
        const s = this.settings.get();
        if (s.paused) return { paused: true, reason: s.pauseReason || 'paused by admin' };
        if (!this.lastSelfCheck.ok) return { paused: true, reason: this.lastSelfCheck.reason || 'self-check not passed' };
        return { paused: false, reason: null };
    }

    /** Build (or reuse a cached) index of every live loan plus the current price and period. */
    private async loadIndex(force = false): Promise<{ loans: IndexedLoan[]; priceCents: number | null; period: number | null }> {
        if (!force && this.indexCache && Date.now() - this.indexCache.at < this.cacheMs) return this.indexCache;
        const check = await this.selfCheck();
        const c = this.deployment.contracts;
        const paryon = this.deployment.params.tokenIds.paryonTokenId;

        const [loanUtxos, sidecarUtxos] = await Promise.all([
            this.chain.getUtxos(c.loan.address),
            this.chain.getUtxos(c.loanSidecar.address),
        ]);

        // sidecar key: `${txid}:${vout}` → loanTokenId (sidecar's own category).
        const sidecarByOutpoint = new Map<string, string>();
        for (const u of sidecarUtxos) {
            if (u.token?.nft && u.token.category !== paryon) sidecarByOutpoint.set(`${u.txid}:${u.vout}`, u.token.category);
        }

        const loans: IndexedLoan[] = [];
        for (const u of loanUtxos) {
            const nft = u.token?.nft;
            if (!nft || u.token!.category !== paryon || nft.capability !== 'mutable' || nft.commitment.length !== 54) continue;
            const loanTokenId = sidecarByOutpoint.get(`${u.txid}:${u.vout + 1}`);
            if (!loanTokenId) continue;   // no paired sidecar: not a standard loan, skip
            try { loans.push({ loanTokenId, utxo: u, state: decodeLoan(nft.commitment) }); } catch { /* malformed commitment: skip */ }
        }

        let priceCents: number | null = null;
        if (check.priceContract) {
            const priceUtxos = await this.chain.getUtxos(check.priceContract.address);
            const thread = pickThread(priceUtxos, paryon);
            if (thread?.token?.nft) { try { priceCents = decodePrice(thread.token.nft.commitment).priceCents; } catch { /* skip */ } }
        }

        let period: number | null = null;
        const borrowingUtxos = await this.chain.getUtxos(c.borrowing.address);
        const bThread = pickThread(borrowingUtxos, paryon);
        if (bThread?.token?.nft) { try { period = decodeBorrowingPeriod(bThread.token.nft.commitment); } catch { /* skip */ } }

        const snapshot = { at: Date.now(), loans, priceCents, period };
        this.indexCache = snapshot;
        return snapshot;
    }

    private toView(loan: IndexedLoan, priceCents: number | null): LoanView {
        const collateralSats = loan.utxo.satoshis;
        const debtCents = loan.state.borrowed;
        const price = priceCents != null ? BigInt(priceCents) : null;
        return {
            loanTokenId: loan.loanTokenId,
            txid: loan.utxo.txid,
            vout: loan.utxo.vout,
            collateralSats: collateralSats.toString(),
            debtCents: debtCents.toString(),
            status: loan.state.status,
            currentRate: loan.state.currentRate,
            nextRate: loan.state.nextRate,
            aprPct: math.rateToAprPct(loan.state.currentRate),
            collateralRatioPct: price != null ? math.collateralRatioPct(collateralSats, debtCents, price) : null,
            liquidationPriceCents: math.liquidationPriceCents(collateralSats, debtCents)?.toString() ?? null,
            beingRedeemedCents: loan.state.beingRedeemed.toString(),
            lastPeriodInterestPaid: loan.state.lastPeriodInterestPaid,
        };
    }

    async market(): Promise<MarketView> {
        const s = this.settings.get();
        const { loans, priceCents, period } = await this.loadIndex();
        const { paused, reason } = this.pauseState();

        let totalDebt = 0n;
        let totalCollateral = 0n;
        const rates: number[] = [];
        for (const l of loans) {
            totalDebt += l.state.borrowed;
            totalCollateral += l.utxo.satoshis;
            rates.push(l.state.currentRate);
        }
        const medianRate = math.median(rates);

        return {
            network: this.network,
            paused,
            pauseReason: reason,
            priceCents: priceCents != null ? String(priceCents) : null,
            totalDebtCents: totalDebt.toString(),
            totalCollateralSats: totalCollateral.toString(),
            loanCount: loans.length,
            rate: {
                minApr: rates.length ? math.rateToAprPct(Math.min(...rates)) : 0,
                medianApr: math.rateToAprPct(medianRate),
                maxApr: rates.length ? math.rateToAprPct(Math.max(...rates)) : 0,
                defaultApr: math.rateToAprPct(medianRate),   // D5: default rate = current on-chain median
            },
            fees: { borrowFeeBps: 25, frontendFeeBps: s.frontendFeeBps },
            limits: { minOpenRatioPct: s.minOpenRatioPct, warnRatioPct: s.warnRatioPct, minLoanCents: math.MIN_LOAN_CENTS.toString() },
            currentPeriod: period,
            priceContract: this.lastSelfCheck.priceContract?.name ?? null,
        };
    }

    /** One loan by its loanTokenId, or null if no live loan carries it. */
    async loanById(loanTokenId: string): Promise<LoanView | null> {
        const id = loanTokenId.toLowerCase();
        const { loans, priceCents } = await this.loadIndex();
        const found = loans.find(l => l.loanTokenId.toLowerCase() === id);
        return found ? this.toView(found, priceCents) : null;
    }

    /** Loans whose loan key (a minting/mutable NFT of the loanTokenId category) is held by one of these addresses. */
    async loansByAddress(addresses: string[]): Promise<LoanView[]> {
        const clean = addresses.map(a => a.trim()).filter(Boolean).slice(0, 5);
        if (!clean.length) return [];
        const { loans, priceCents } = await this.loadIndex();
        const byId = new Map(loans.map(l => [l.loanTokenId, l] as const));

        const heldCategories = new Set<string>();
        for (const addr of clean) {
            let utxos: Utxo[];
            try { utxos = await this.chain.getUtxos(addr); } catch { continue; }
            for (const u of utxos) if (u.token?.nft && byId.has(u.token.category)) heldCategories.add(u.token.category);
        }
        return [...heldCategories].map(cat => this.toView(byId.get(cat)!, priceCents));
    }

    publicConfig() {
        const { paused, reason } = this.pauseState();
        return { enabled: true, paused, pauseReason: reason, provider: 'paryon', network: this.network };
    }

    /**
     * Calculate loan parameters, fees, limits, and safety ratios for an intended borrow.
     */
    async quoteBorrow(req: BorrowQuoteRequest): Promise<BorrowQuoteResponse> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        const { priceCents, loans } = await this.loadIndex();
        if (priceCents == null) throw new HttpError(503, 'Price feed unavailable');

        const oraclePrice = BigInt(priceCents);
        const s = this.settings.get();

        let borrowCents = 0n;
        let collateralSats = 0n;

        if (req.borrowCents != null) {
            borrowCents = BigInt(req.borrowCents);
        }
        if (req.collateralSats != null) {
            collateralSats = BigInt(req.collateralSats);
        }

        // If user gave borrowCents but not collateralSats, compute minimum collateral at target opening ratio (e.g. 150%)
        if (borrowCents > 0n && collateralSats === 0n) {
            const targetRatio = BigInt(s.minOpenRatioPct);
            collateralSats = (borrowCents * targetRatio * 1_000_000n) / oraclePrice;
        } else if (collateralSats > 0n && borrowCents === 0n) {
            const targetRatio = BigInt(s.minOpenRatioPct);
            borrowCents = (collateralSats * oraclePrice) / (targetRatio * 1_000_000n);
        }

        const maxBorrow = math.maxBorrowCents(collateralSats, oraclePrice);
        const minCollateral = ((borrowCents * 100_000_000n * 11n) / (10n * oraclePrice)) + 1n;
        const ratio = math.collateralRatioPct(collateralSats, borrowCents, oraclePrice) ?? 0;
        const liqPrice = math.liquidationPriceCents(collateralSats, borrowCents) ?? 0n;
        const protoFee = math.protocolBorrowFeeSats(borrowCents, oraclePrice);
        const frontFee = math.frontendFeeSats(borrowCents, oraclePrice, s.frontendFeeBps);

        const medianRate = math.median(loans.map(l => l.state.currentRate));
        const aprPct = math.rateToAprPct(medianRate);

        let allowed = true;
        let rejectReason: string | undefined;

        if (borrowCents < math.MIN_LOAN_CENTS) {
            allowed = false;
            rejectReason = `Borrow amount must be at least 100.00 PUSD (${math.MIN_LOAN_CENTS} cents)`;
        } else if (ratio < 110) {
            allowed = false;
            rejectReason = `Collateral ratio ${ratio}% is below protocol liquidation minimum (110%)`;
        } else if (ratio < s.minOpenRatioPct) {
            allowed = false;
            rejectReason = `Collateral ratio ${ratio}% is below opening policy minimum (${s.minOpenRatioPct}%)`;
        }

        const warnLowRatio = ratio >= s.minOpenRatioPct && ratio < s.warnRatioPct;

        return {
            borrowCents: borrowCents.toString(),
            collateralSats: collateralSats.toString(),
            priceCents: oraclePrice.toString(),
            maxBorrowCents: maxBorrow.toString(),
            minCollateralSats: minCollateral.toString(),
            collateralRatioPct: ratio,
            liquidationPriceCents: liqPrice.toString(),
            protocolFeeSats: protoFee.toString(),
            frontendFeeSats: frontFee.toString(),
            aprPct,
            warnLowRatio,
            allowed,
            reason: rejectReason,
        };
    }

    /**
     * Build the transaction that mints the user's loan key NFT and its paired origin enforcer/proof.
     */
     async buildCreateLoanKey(req: BuildLoanKeyRequest): Promise<BuildLoanKeyResult> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        const genesisUtxo = normalizeUtxo(req.genesisUtxo);
        const feeUtxos = (req.feeUtxos || []).map(normalizeUtxo);
        let factoryUtxo = req.factoryUtxo ? normalizeUtxo(req.factoryUtxo) : undefined;
        if (!factoryUtxo) {
            const factoryUtxos = await this.chain.getUtxos(this.deployment.contracts.loanKeyFactory.address);
            const factoryTokenId = this.deployment.params.tokenIds.loanKeyFactoryTokenId;
            const thread = pickThread(factoryUtxos, factoryTokenId) || factoryUtxos[0];
            if (!thread) throw new HttpError(503, 'No available loanKeyFactory thread on chain');
            factoryUtxo = thread;
        }

        return buildCreateLoanKeyTx({
            params: this.deployment.params,
            provider: this.chain.getProvider(),
            userAddress: req.userAddress,
            genesisUtxo,
            factoryUtxo,
            feeUtxos,
            treasuryAddress: req.treasuryAddress,
        });
    }

    /**
     * Build the borrow transaction that locks collateral and mints borrowed PUSD tokens.
     */
    async buildBorrow(req: BuildBorrowRequest): Promise<BuildBorrowResult> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        const c = this.deployment.contracts;
        const paryon = this.deployment.params.tokenIds.paryonTokenId;

        // Resolve borrowingUtxo if not provided
        let borrowingUtxo = req.borrowingUtxo ? normalizeUtxo(req.borrowingUtxo) : undefined;
        if (!borrowingUtxo) {
            const borrowingUtxos = await this.chain.getUtxos(c.borrowing.address);
            const thread = pickThread(borrowingUtxos, paryon);
            if (!thread) throw new HttpError(503, 'No available borrowing thread on chain');
            borrowingUtxo = thread;
        }

        // Resolve priceUtxo if not provided
        let priceUtxo = req.priceUtxo ? normalizeUtxo(req.priceUtxo) : undefined;
        if (!priceUtxo) {
            const check = await this.selfCheck();
            if (!check.priceContract) throw new HttpError(503, 'No active price contract thread');
            const priceUtxos = await this.chain.getUtxos(check.priceContract.address);
            const thread = pickThread(priceUtxos, paryon);
            if (!thread) throw new HttpError(503, 'No available price contract thread');
            priceUtxo = thread;
        }

        const s = this.settings.get();
        const market = await this.market();
        const startingRate = req.startingRate ?? (market.rate.defaultApr ? math.aprPctToRate(market.rate.defaultApr) : 137);

        return buildBorrowTx({
            params: this.deployment.params,
            provider: this.chain.getProvider(),
            userAddress: req.userAddress,
            userTokenAddress: req.userTokenAddress,
            borrowingUtxo,
            priceUtxo,
            enforcerUtxo: normalizeUtxo(req.enforcerUtxo),
            proofUtxo: normalizeUtxo(req.proofUtxo),
            userBchUtxos: (req.userBchUtxos || []).map(normalizeUtxo),
            borrowCents: BigInt(req.borrowCents),
            collateralSats: BigInt(req.collateralSats),
            startingRate,
            frontendFeeBps: s.frontendFeeBps,
            frontendFeeAddress: req.frontendFeeAddress,
            minerFeeSats: req.minerFeeSats != null ? BigInt(req.minerFeeSats) : undefined,
        });
    }

    /**
     * Build the manage transaction: add collateral, withdraw collateral, repay debt, or close loan.
     */
    async buildManage(req: BuildManageRequest): Promise<BuildManageResult> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        const paryon = this.deployment.params.tokenIds.paryonTokenId;

        // Resolve priceUtxo
        const check = await this.selfCheck();
        if (!check.priceContract) throw new HttpError(503, 'No active price contract thread');
        const priceUtxos = await this.chain.getUtxos(check.priceContract.address);
        const priceThread = pickThread(priceUtxos, paryon);
        if (!priceThread) throw new HttpError(503, 'No active price contract thread');

        // Resolve active loan and sidecar by loanTokenId
        const { loans } = await this.loadIndex(true);
        const loanItem = loans.find(l => l.loanTokenId.toLowerCase() === req.loanTokenId.toLowerCase());
        if (!loanItem) throw new HttpError(404, `Active loan ${req.loanTokenId} not found`);

        const sidecarUtxos = await this.chain.getUtxos(this.deployment.contracts.loanSidecar.address);
        const sidecarUtxo = sidecarUtxos.find(u => u.txid === loanItem.utxo.txid && u.vout === loanItem.utxo.vout + 1);
        if (!sidecarUtxo) throw new HttpError(500, `Sidecar UTXO not found for loan ${req.loanTokenId}`);

        // Resolve manage function thread UTXO
        const manageUtxos = await this.chain.getUtxos(this.deployment.contracts.manage.address);
        const manageUtxo = manageUtxos.find(u => u.token?.category === paryon && u.token?.nft?.commitment === '02') || manageUtxos[0];
        if (!manageUtxo) throw new HttpError(503, 'No active manage function thread');

        return buildManageTx({
            params: this.deployment.params,
            provider: this.chain.getProvider(),
            userAddress: req.userAddress,
            userTokenAddress: req.userTokenAddress,
            priceUtxo: priceThread,
            loanUtxo: loanItem.utxo,
            sidecarUtxo,
            manageUtxo,
            loanKeyUtxo: normalizeUtxo(req.loanKeyUtxo),
            userBchUtxos: (req.userBchUtxos || []).map(normalizeUtxo),
            userPusdUtxos: req.userPusdUtxos?.map(normalizeUtxo),
            actionType: req.actionType,
            collateralDeltaSats: req.collateralDeltaSats != null ? BigInt(req.collateralDeltaSats) : undefined,
            repayCents: req.repayCents != null ? BigInt(req.repayCents) : undefined,
            minerFeeSats: req.minerFeeSats != null ? BigInt(req.minerFeeSats) : undefined,
        });
    }

    /**
     * Build the changeRate transaction to update next period interest rate.
     */
    async buildChangeRate(req: BuildChangeRateRequest): Promise<BuildChangeRateResult> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        const paryon = this.deployment.params.tokenIds.paryonTokenId;
        const full = deriveFullDeployment(this.deployment.params, this.chain.getProvider());

        // Resolve active loan and sidecar by loanTokenId
        const { loans } = await this.loadIndex(true);
        const loanItem = loans.find(l => l.loanTokenId.toLowerCase() === req.loanTokenId.toLowerCase());
        if (!loanItem) throw new HttpError(404, `Active loan ${req.loanTokenId} not found`);

        const sidecarUtxos = await this.chain.getUtxos(this.deployment.contracts.loanSidecar.address);
        const sidecarUtxo = sidecarUtxos.find(u => u.txid === loanItem.utxo.txid && u.vout === loanItem.utxo.vout + 1);
        if (!sidecarUtxo) throw new HttpError(500, `Sidecar UTXO not found for loan ${req.loanTokenId}`);

        // changeInterest function contract is full.loanFunctions[7] (commitment 0x08)
        const changeRateContract = full.loanFunctions[7];
        const changeRateUtxos = await this.chain.getUtxos(changeRateContract.address);
        const changeRateUtxo = changeRateUtxos.find(u => u.token?.category === paryon && u.token?.nft?.commitment === '08') || changeRateUtxos[0];
        if (!changeRateUtxo) throw new HttpError(503, 'No active changeInterest function thread');

        return buildChangeRateTx({
            params: this.deployment.params,
            provider: this.chain.getProvider(),
            userAddress: req.userAddress,
            userTokenAddress: req.userTokenAddress,
            loanUtxo: loanItem.utxo,
            sidecarUtxo,
            changeRateUtxo,
            loanKeyUtxo: normalizeUtxo(req.loanKeyUtxo),
            userBchUtxos: (req.userBchUtxos || []).map(normalizeUtxo),
            nextRate: req.nextRate,
            minerFeeSats: req.minerFeeSats != null ? BigInt(req.minerFeeSats) : undefined,
        });
    }

    /**
     * Broadcast a user-signed transaction hex string to the network.
     */
    async broadcast(txHex: string): Promise<{ txid: string }> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');
        const txid = await this.chain.broadcast(txHex);
        this.events?.record({
            section: 'lendbch',
            type: 'tx.broadcast',
            severity: 'info',
            summary: `Broadcast lendbch transaction ${txid}`,
            data: { txid, network: this.network },
        });
        return { txid };
    }

    /**
     * Prepare the full 2-step borrow flow:
     * Step 1: Create loan key NFT and enforcer/proof pair.
     * Step 2: Borrow PUSD against collateral using newly created enforcer/proof.
     */
    async prepareBorrow(req: PrepareBorrowRequest): Promise<PrepareBorrowResponse> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        if (!req.userAddress || !req.userTokenAddress || !req.borrowCents) {
            throw new HttpError(400, 'Missing userAddress, userTokenAddress, or borrowCents');
        }

        const borrowCents = BigInt(req.borrowCents);
        if (borrowCents < math.MIN_LOAN_CENTS) {
            throw new HttpError(400, `Borrow amount must be at least 100.00 PUSD`);
        }

        // Get user UTXOs
        let userUtxos = req.userUtxos?.map(normalizeUtxo) ?? [];
        if (!userUtxos.length) {
            userUtxos = await this.chain.getUtxos(req.userAddress);
        }
        if (!userUtxos.length) {
            throw new HttpError(400, `No UTXOs found for user address ${req.userAddress}`);
        }

        // Quote borrow to calculate required collateral if not provided
        let collateralSats: bigint;
        if (req.collateralSats != null) {
            collateralSats = BigInt(req.collateralSats);
        } else {
            const quote = await this.quoteBorrow({ borrowCents: req.borrowCents });
            if (!quote.allowed) {
                throw new HttpError(400, quote.reason || 'Borrow parameters not allowed');
            }
            collateralSats = BigInt(quote.collateralSats);
        }

        // CashToken category genesis requires a UTXO with vout === 0
        const genesisUtxo = userUtxos.find(u => u.vout === 0 && !u.token);
        if (!genesisUtxo) {
            throw new HttpError(400, 'A pure BCH UTXO with outpoint index 0 (vout: 0) is required to genesis a new CashToken category. Please send a transaction to yourself or split a UTXO.');
        }

        // Other UTXOs available for fee / collateral
        const otherUtxos = userUtxos.filter(u => u !== genesisUtxo && !u.token);

        // For tx1 (create loan key): needs ~5000 sats (4000 output dust + 1000 fee)
        const feeUtxosForTx1: Utxo[] = [];
        let curSatsTx1 = BigInt(genesisUtxo.satoshis);
        const needTx1 = 5000n;
        let otherIdx = 0;
        while (curSatsTx1 < needTx1 && otherIdx < otherUtxos.length) {
            feeUtxosForTx1.push(otherUtxos[otherIdx]);
            curSatsTx1 += BigInt(otherUtxos[otherIdx].satoshis);
            otherIdx++;
        }

        if (curSatsTx1 < needTx1) {
            throw new HttpError(400, `Insufficient BCH to create loan key. Have ${curSatsTx1} sats, need at least ${needTx1} sats.`);
        }

        // Build tx1
        const tx1 = await this.buildCreateLoanKey({
            userAddress: req.userAddress,
            genesisUtxo,
            feeUtxos: feeUtxosForTx1,
        });

        // Remaining user UTXOs for tx2 (borrow)
        const userUtxosForTx2 = otherUtxos.slice(otherIdx);
        const s = this.settings.get();
        const estFees = (collateralSats * BigInt(s.frontendFeeBps + 25)) / 10000n + 5000n;
        const totalNeedTx2 = collateralSats + estFees;
        const totalAvailForTx2 = userUtxosForTx2.reduce((acc, u) => acc + BigInt(u.satoshis), 0n);

        const syntheticEnforcerUtxo: Utxo = {
            txid: tx1.txid,
            vout: 2,
            satoshis: 1000n,
            token: {
                category: tx1.reservedTokenId,
                amount: 0n,
                nft: { capability: 'minting', commitment: '' },
            },
        };

        const syntheticProofUtxo: Utxo = {
            txid: tx1.txid,
            vout: 3,
            satoshis: 1000n,
            token: {
                category: this.deployment.params.tokenIds.loanKeyFactoryTokenId,
                amount: 0n,
                nft: { capability: 'none', commitment: '' },
            },
        };

        let tx2UserInputs = [...userUtxosForTx2];
        if (totalAvailForTx2 < totalNeedTx2) {
            const fixedOutputsSats = 4000n;
            const feeSats = 1000n;
            const tx1ChangeSats = curSatsTx1 - fixedOutputsSats - feeSats;
            if (tx1ChangeSats >= 1000n) {
                const tx1ChangeUtxo: Utxo = {
                    txid: tx1.txid,
                    vout: 4,
                    satoshis: tx1ChangeSats,
                };
                tx2UserInputs.push(tx1ChangeUtxo);
            }
        }

        const totalFinalTx2 = tx2UserInputs.reduce((acc, u) => acc + BigInt(u.satoshis), 0n);
        if (totalFinalTx2 < totalNeedTx2) {
            throw new HttpError(400, `Insufficient BCH for collateral and fees. Have ${totalFinalTx2} sats, need at least ${totalNeedTx2} sats.`);
        }

        // Build tx2
        const tx2 = await this.buildBorrow({
            userAddress: req.userAddress,
            userTokenAddress: req.userTokenAddress,
            borrowCents,
            collateralSats,
            startingRate: req.startingRate,
            enforcerUtxo: syntheticEnforcerUtxo,
            proofUtxo: syntheticProofUtxo,
            userBchUtxos: tx2UserInputs,
            frontendFeeAddress: req.frontendFeeAddress,
        });

        return {
            loanTokenId: tx1.reservedTokenId,
            steps: [
                {
                    step: 1,
                    name: 'create_loan_key',
                    txHex: tx1.txHex,
                    txid: tx1.txid,
                    wcPayload: tx1.wcPayload,
                },
                {
                    step: 2,
                    name: 'borrow',
                    txHex: tx2.txHex,
                    txid: tx2.txid,
                    wcPayload: tx2.wcPayload,
                },
            ],
        };
    }

    /**
     * Prepare a loan management transaction (add/withdraw collateral, repay debt, or close loan).
     */
    async prepareManage(req: PrepareManageRequest): Promise<PrepareManageResponse> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        if (!req.userAddress || !req.userTokenAddress || !req.loanTokenId || !req.actionType) {
            throw new HttpError(400, 'Missing userAddress, userTokenAddress, loanTokenId, or actionType');
        }

        let userUtxos = req.userUtxos?.map(normalizeUtxo) ?? [];
        if (!userUtxos.length) {
            userUtxos = await this.chain.getUtxos(req.userAddress);
        }

        let loanKeyUtxo = req.loanKeyUtxo ? normalizeUtxo(req.loanKeyUtxo) : undefined;
        if (!loanKeyUtxo) {
            const id = req.loanTokenId.toLowerCase();
            loanKeyUtxo = userUtxos.find(u => u.token?.category.toLowerCase() === id && (u.token.nft?.capability === 'mutable' || u.token.nft?.capability === 'minting'));
            if (!loanKeyUtxo) {
                throw new HttpError(404, `No loan key NFT found for category ${req.loanTokenId} in user wallet`);
            }
        }

        const userBchUtxos = userUtxos.filter(u => u !== loanKeyUtxo && !u.token);
        const paryonTokenId = this.deployment.params.tokenIds.paryonTokenId.toLowerCase();
        const userPusdUtxos = userUtxos.filter(u => u.token?.category.toLowerCase() === paryonTokenId && !u.token.nft);

        const res = await this.buildManage({
            userAddress: req.userAddress,
            userTokenAddress: req.userTokenAddress,
            loanTokenId: req.loanTokenId,
            actionType: req.actionType,
            collateralDeltaSats: req.collateralDeltaSats,
            repayCents: req.repayCents,
            loanKeyUtxo,
            userBchUtxos,
            userPusdUtxos: userPusdUtxos.length ? userPusdUtxos : undefined,
        });

        return {
            loanTokenId: req.loanTokenId,
            txHex: res.txHex,
            txid: res.txid,
            wcPayload: res.wcPayload,
        };
    }

    /**
     * Prepare a change interest rate transaction.
     */
    async prepareRate(req: PrepareRateRequest): Promise<PrepareRateResponse> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        if (!req.userAddress || !req.userTokenAddress || !req.loanTokenId || req.nextRate == null) {
            throw new HttpError(400, 'Missing userAddress, userTokenAddress, loanTokenId, or nextRate');
        }

        let userUtxos = req.userUtxos?.map(normalizeUtxo) ?? [];
        if (!userUtxos.length) {
            userUtxos = await this.chain.getUtxos(req.userAddress);
        }

        let loanKeyUtxo = req.loanKeyUtxo ? normalizeUtxo(req.loanKeyUtxo) : undefined;
        if (!loanKeyUtxo) {
            const id = req.loanTokenId.toLowerCase();
            loanKeyUtxo = userUtxos.find(u => u.token?.category.toLowerCase() === id && (u.token.nft?.capability === 'mutable' || u.token.nft?.capability === 'minting'));
            if (!loanKeyUtxo) {
                throw new HttpError(404, `No loan key NFT found for category ${req.loanTokenId} in user wallet`);
            }
        }

        const userBchUtxos = userUtxos.filter(u => u !== loanKeyUtxo && !u.token);

        const res = await this.buildChangeRate({
            userAddress: req.userAddress,
            userTokenAddress: req.userTokenAddress,
            loanTokenId: req.loanTokenId,
            nextRate: req.nextRate,
            loanKeyUtxo,
            userBchUtxos,
        });

        return {
            loanTokenId: req.loanTokenId,
            txHex: res.txHex,
            txid: res.txid,
            wcPayload: res.wcPayload,
        };
    }

    /**
     * Submit a signed sequence of transactions to broadcast, and track active loans.
     */
    async submit(req: SubmitRequest): Promise<SubmitResponse> {
        const { paused, reason } = this.pauseState();
        if (paused) throw new HttpError(503, reason || 'lendbch module paused');

        if (!req.signedTxs || !req.signedTxs.length) {
            throw new HttpError(400, 'Missing signedTxs array');
        }

        const txids: string[] = [];
        for (const txHex of req.signedTxs) {
            const res = await this.broadcast(txHex);
            txids.push(res.txid);
        }

        // Track loan in store
        if (req.kind === 'borrow' && req.loanTokenId && req.userAddress) {
            this.loanStore.put({
                loanTokenId: req.loanTokenId,
                userAddress: req.userAddress,
                userTokenAddress: req.userTokenAddress || req.userAddress,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                initialBorrowCents: req.borrowCents || '0',
                initialCollateralSats: req.collateralSats || '0',
                status: 'active',
                activity: [
                    {
                        type: 'borrow',
                        txid: txids[txids.length - 1],
                        timestamp: Date.now(),
                        details: { borrowCents: req.borrowCents, collateralSats: req.collateralSats, txids },
                    },
                ],
            });
        } else if (req.loanTokenId) {
            this.loanStore.recordActivity(req.loanTokenId, {
                type: req.kind,
                txid: txids[0],
                timestamp: Date.now(),
                details: { txids },
            });
        }

        return {
            txids,
            loanTokenId: req.loanTokenId,
        };
    }

    /**
     * Poller checks all active loans and logs warnings if collateral ratio drops near liquidation.
     */
    async pollHealth(): Promise<{ checked: number; warnings: number }> {
        const { priceCents, loans } = await this.loadIndex(true);
        if (priceCents == null || !loans.length) return { checked: 0, warnings: 0 };

        const price = BigInt(priceCents);
        let warnings = 0;

        for (const l of loans) {
            const ratio = math.collateralRatioPct(l.utxo.satoshis, l.state.borrowed, price);
            if (ratio != null) {
                if (ratio < 120) {
                    warnings++;
                    this.events?.record({
                        section: 'lendbch',
                        type: 'loan.health.critical',
                        severity: 'warn',
                        summary: `Loan ${l.loanTokenId.slice(0, 8)}… collateral ratio is critically low: ${ratio}% (liquidation at 110%)`,
                        subject: { kind: 'loan', id: l.loanTokenId },
                        data: { ratio, priceCents, debtCents: l.state.borrowed.toString(), collateralSats: l.utxo.satoshis.toString() },
                    });
                } else if (ratio < 130) {
                    warnings++;
                    this.events?.record({
                        section: 'lendbch',
                        type: 'loan.health.low',
                        severity: 'info',
                        summary: `Loan ${l.loanTokenId.slice(0, 8)}… collateral ratio is low: ${ratio}%`,
                        subject: { kind: 'loan', id: l.loanTokenId },
                        data: { ratio, priceCents, debtCents: l.state.borrowed.toString(), collateralSats: l.utxo.satoshis.toString() },
                    });
                }
            }
        }
        return { checked: loans.length, warnings };
    }

    /** Get tracked loans from store */
    getTrackedLoans(): TrackedLoan[] {
        return this.loanStore.all();
    }

    /** Get tracked loan by loanTokenId */
    getTrackedLoan(loanTokenId: string): TrackedLoan | undefined {
        return this.loanStore.get(loanTokenId);
    }
}

