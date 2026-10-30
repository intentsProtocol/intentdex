/**
 * SolanaSwapService — token → token on Solana through Jupiter (Swap API v2 /order + /execute).
 *
 * Same custody rule as the CCTP side: the user's wallet signs, this server never holds funds or keys.
 * Jupiter builds the transaction and lands it; the server proxies both calls (keeping the API key private),
 * records the swap and reports its status.
 */
import { randomUUID } from 'crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { formatUnits } from 'ethers';
import { errMsg, logger } from '../log.js';
import { HttpError } from '../types.js';
import type { SolanaSettings } from '../settings.js';
import { collectedFee, referralBpsFor } from '../fees.js';
import type { SwapStore } from './SwapStore.js';
import type { TokenCatalog, TokenView } from './TokenCatalog.js';
import { JupiterError, SWAP_TERMINAL, type JupOrder, type JupiterApi, type SolanaSwap } from './types.js';

const log = logger('solana-swap');

export interface SolanaSwapOptions {
    referralAccount?: string;
    referralFeeBps?: number;     // 50-255 when a referral account is set
    maxSlippageBps: number;
    orderTtlSec: number;         // an unsigned order older than this is EXPIRED
    landTimeoutSec: number;      // a submitted tx not seen on chain after this is FAILED
    policy?: () => Partial<SolanaSettings>;   // admin settings, read on every request; overrides the values above
}

/** On-chain state of a signature, used when Jupiter's /execute reply was lost. */
export type SignatureCheck = (signature: string) => Promise<'confirmed' | 'failed' | 'unknown'>;

export interface QuoteInput { inputMint: unknown; outputMint: unknown; amount: unknown; slippageBps?: unknown; taker?: unknown }
export interface CreateSwapInput extends QuoteInput { receiver?: unknown }

function isPubkey(v: unknown): v is string {
    if (typeof v !== 'string') return false;
    try { return new PublicKey(v).toBase58() === v; } catch { return false; }
}

function isWallet(v: unknown): v is string {
    return isPubkey(v) && PublicKey.isOnCurve(new PublicKey(v).toBytes());
}

function toHttp(e: unknown): HttpError {
    if (e instanceof HttpError) return e;
    if (e instanceof JupiterError) {
        if (e.status === 400) return new HttpError(400, e.message);
        if (e.status === 429) return new HttpError(429, 'rate limited, retry in a few seconds', 'RATE_LIMITED');
        // Jupiter answers 500 "Something unexpected occurred" for a mint it does not know.
        return new HttpError(502, `Jupiter error: ${e.message}`);
    }
    return new HttpError(500, errMsg(e));
}

export class SolanaSwapService {
    private executing = new Set<string>();
    private settling = false;

    constructor(
        private api: JupiterApi,
        private store: SwapStore,
        private catalog: TokenCatalog,
        private opts: SolanaSwapOptions,
        private checkSignature?: SignatureCheck,
    ) {}

    /** The rules in force right now: env defaults overlaid with the admin settings. */
    private policy(): SolanaSettings {
        return {
            paused: false, stocksEnabled: true, allowUnverified: true,
            maxSlippageBps: this.opts.maxSlippageBps, defaultSlippageBps: 0, maxSwapUsd: 0, minStockLiquidityUsd: 0,
            referralFeeBps: this.opts.referralFeeBps ?? 0, stocksFeeBps: null, stablesFeeBps: null, referralAccount: '', blockedMints: [],
            ...this.opts.policy?.(),
        } as SolanaSettings;
    }

    /** Refuse tokens the admin has closed: blocked mints, stocks when off, unverified tokens when off. */
    private checkTokens(p: SolanaSettings, mints: string[]) {
        for (const mint of mints) {
            if (p.blockedMints.includes(mint)) throw new HttpError(403, `${this.catalog.cached(mint)?.symbol ?? 'This token'} is not available for swapping here`, 'TOKEN_BLOCKED');
            const t = this.catalog.cached(mint);
            if (t?.isStock && !p.stocksEnabled) throw new HttpError(403, 'Tokenized stocks are not available', 'STOCKS_DISABLED');
            if (!t && !p.allowUnverified && this.catalog.ready) throw new HttpError(403, 'Only verified tokens can be swapped', 'UNVERIFIED_DISABLED');
        }
    }

    private checkSize(p: SolanaSettings, o: JupOrder) {
        if (p.maxSwapUsd > 0 && (o.inUsdValue ?? 0) > p.maxSwapUsd) throw new HttpError(400, `swap is above the maximum size of $${p.maxSwapUsd}`, 'SWAP_TOO_LARGE');
    }

    // ── quote ─────────────────────────────────────────────────────────────────
    private orderParams(i: QuoteInput, taker?: string, receiver?: string): Record<string, string> {
        if (!isPubkey(i.inputMint)) throw new HttpError(400, 'inputMint is not a valid Solana mint address', 'INVALID_MINT');
        if (!isPubkey(i.outputMint)) throw new HttpError(400, 'outputMint is not a valid Solana mint address', 'INVALID_MINT');
        if (i.inputMint === i.outputMint) throw new HttpError(400, 'inputMint and outputMint must differ', 'SAME_MINT');
        const amount = typeof i.amount === 'number' ? String(i.amount) : i.amount;
        if (typeof amount !== 'string' || !/^[1-9]\d{0,29}$/.test(amount)) {
            throw new HttpError(400, 'amount is required: a positive integer in the input token\'s base units (e.g. "1000000" for 1 USDC)', 'INVALID_AMOUNT');
        }
        const pol = this.policy();
        this.checkTokens(pol, [i.inputMint, i.outputMint]);
        const p: Record<string, string> = { inputMint: i.inputMint, outputMint: i.outputMint, amount };
        if (i.slippageBps !== undefined && i.slippageBps !== '') {
            const s = Number(i.slippageBps);
            if (!Number.isInteger(s) || s < 0 || s > pol.maxSlippageBps) {
                throw new HttpError(400, `slippageBps must be an integer from 0 to ${pol.maxSlippageBps}`, 'INVALID_SLIPPAGE');
            }
            p.slippageBps = String(s);
        } else if (pol.defaultSlippageBps > 0) {
            p.slippageBps = String(pol.defaultSlippageBps);
        }
        if (taker) p.taker = taker;
        if (receiver) p.receiver = receiver;
        const fee = this.referral(pol, i.inputMint, i.outputMint);
        if (fee) {
            p.referralAccount = fee.account;
            p.referralFee = String(fee.bps);
        }
        return p;
    }

    /** Our referral fee for this pair, or undefined when there is no account or the rate is 0. */
    private referral(pol: SolanaSettings, inputMint: string, outputMint: string): { account: string; bps: number } | undefined {
        const account = pol.referralAccount || this.opts.referralAccount;
        const bps = referralBpsFor(pol, this.catalog.cached(inputMint), this.catalog.cached(outputMint));
        return account && bps > 0 ? { account, bps } : undefined;
    }

    private display(amount: string | undefined, token?: TokenView): string | undefined {
        return amount !== undefined && token ? formatUnits(amount, token.decimals) : undefined;
    }

    private warnings(o: JupOrder): string[] {
        const w: string[] = [];
        const tokens = [this.catalog.cached(o.inputMint), this.catalog.cached(o.outputMint)];
        const out = tokens[1];
        if (this.catalog.ready && !out) w.push('The output token is not on Jupiter\'s verified list. Check the mint address before swapping.');
        if (out?.suspicious) w.push(`${out.symbol} is flagged as suspicious by Jupiter.`);
        if (out && !out.isStock && (out.liquidity ?? 0) < 50_000) w.push(`${out.symbol} has low liquidity; large swaps will move the price.`);
        if (tokens.some(t => t?.isStock)) {
            w.push('Tokenized stock: the issuer restricts who may hold it (not offered to US persons), the issuer can freeze the token, and the price can differ from the reference share price, mostly outside market hours.');
        }
        if (o.priceImpact !== undefined && o.priceImpact <= -1) w.push(`Price impact is ${o.priceImpact.toFixed(2)} %.`);
        return w;
    }

    private quoteView(o: JupOrder) {
        const tin = this.catalog.cached(o.inputMint), tout = this.catalog.cached(o.outputMint);
        return {
            inputMint: o.inputMint, outputMint: o.outputMint,
            inAmount: o.inAmount, outAmount: o.outAmount, minOutAmount: o.otherAmountThreshold,
            slippageBps: o.slippageBps,
            priceImpactPct: o.priceImpact,
            feeBps: o.feeBps ?? 0, feeMint: o.feeMint,
            referralFeeBps: this.referral(this.policy(), o.inputMint, o.outputMint)?.bps ?? 0,
            router: o.router, gasless: o.gasless === true,
            route: (o.routePlan ?? []).map(r => ({ label: r.swapInfo.label, percent: r.percent, inputMint: r.swapInfo.inputMint, outputMint: r.swapInfo.outputMint })),
            inUsdValue: o.inUsdValue, outUsdValue: o.outUsdValue,
            display: {
                inAmount: this.display(o.inAmount, tin), outAmount: this.display(o.outAmount, tout),
                minOutAmount: this.display(o.otherAmountThreshold, tout),
                inSymbol: tin?.symbol, outSymbol: tout?.symbol,
            },
            warnings: this.warnings(o),
        };
    }

    /**
     * Price check. With `taker`, Jupiter also checks the wallet's balances and applies its slippage estimate;
     * the answer then carries `takerCheck`. No transaction is returned here.
     */
    async quote(i: QuoteInput) {
        if (i.taker !== undefined && i.taker !== '' && !isWallet(i.taker)) throw new HttpError(400, 'taker is not a valid Solana wallet address', 'INVALID_ADDRESS');
        const taker = i.taker ? (i.taker as string) : undefined;
        try {
            const o = await this.api.order(this.orderParams(i, taker));
            this.checkSize(this.policy(), o);
            return {
                ...this.quoteView(o),
                takerCheck: taker ? (o.transaction ? { ok: true } : { ok: false, code: o.errorCode, message: o.errorMessage ?? 'transaction could not be built' }) : undefined,
            };
        } catch (e) { throw toHttp(e); }
    }

    // ── create → execute ──────────────────────────────────────────────────────
    async create(i: CreateSwapInput) {
        const pol = this.policy();
        if (pol.paused) throw new HttpError(503, 'new swaps are paused', 'PAUSED');
        if (!isWallet(i.taker)) throw new HttpError(400, 'taker is required: the Solana wallet that signs the swap', 'INVALID_ADDRESS');
        if (i.receiver !== undefined && i.receiver !== '' && !isPubkey(i.receiver)) throw new HttpError(400, 'receiver is not a valid Solana address', 'INVALID_ADDRESS');
        const receiver = i.receiver && i.receiver !== i.taker ? (i.receiver as string) : undefined;
        let o: JupOrder;
        try { o = await this.api.order(this.orderParams(i, i.taker, receiver)); } catch (e) { throw toHttp(e); }
        if (!o.transaction) {
            // Jupiter's order codes 1 and 2 are a wallet short of the input token or of SOL for the network fee.
            const short = o.errorCode === 1 || o.errorCode === 2 || /insufficient/i.test(o.errorMessage ?? '');
            throw new HttpError(400, o.errorMessage || 'Jupiter could not build a transaction for this swap', short ? 'INSUFFICIENT_FUNDS' : 'SWAP_NOT_BUILDABLE');
        }
        this.checkSize(pol, o);
        const [tin, tout] = await Promise.all([this.tokenFacts(o.inputMint), this.tokenFacts(o.outputMint)]);

        const now = Date.now();
        const swap = this.store.create({
            id: randomUUID(),
            taker: i.taker, receiver,
            inputMint: o.inputMint, outputMint: o.outputMint,
            inAmount: o.inAmount, quotedOutAmount: o.outAmount, minOutAmount: o.otherAmountThreshold,
            slippageBps: o.slippageBps, feeBps: o.feeBps ?? 0, feeMint: o.feeMint,
            router: o.router, gasless: o.gasless === true,
            requestId: o.requestId, lastValidBlockHeight: o.lastValidBlockHeight, expireAt: o.expireAt,
            inUsdValue: o.inUsdValue,
            inSymbol: tin?.symbol, outSymbol: tout?.symbol, inDecimals: tin?.decimals, outDecimals: tout?.decimals, inIcon: tin?.icon, outIcon: tout?.icon,
            ...(() => { const f = this.referral(pol, o.inputMint, o.outputMint); return f ? { referralFeeBps: f.bps, referralAccount: f.account } : {}; })(),
            status: 'CREATED', createdAt: now, updatedAt: now,
        });
        return {
            swap: this.view(swap),
            quote: this.quoteView(o),
            tx: {
                serializedTx: o.transaction,       // base64 VersionedTransaction; sign it, do not send it
                lastValidBlockHeight: o.lastValidBlockHeight,
                expireAt: o.expireAt,
                expiresInSec: this.opts.orderTtlSec,
                expiresAt: swap.createdAt + this.opts.orderTtlSec * 1000,
            },
        };
    }

    /** Hand the signed transaction to Jupiter. Safe to call again with the same transaction. */
    async execute(id: string, signedTransaction: unknown) {
        let swap = this.mustGet(id);
        if (swap.status === 'COMPLETED' || swap.status === 'FAILED') return this.view(swap);
        if (swap.status === 'EXPIRED') throw new HttpError(409, 'swap expired before it was signed; create a new one', 'EXPIRED');
        if (typeof signedTransaction !== 'string' || !signedTransaction) throw new HttpError(400, 'signedTransaction is required (base64)', 'INVALID_SIGNED_TX');

        let signature: string;
        try {
            const tx = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
            const keys = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
            const idx = keys.findIndex(k => k.toBase58() === swap.taker);
            if (idx < 0 || tx.signatures[idx].every(b => b === 0)) throw new Error('not signed by the taker');
            signature = bs58.encode(tx.signatures[0]);
        } catch (e) {
            throw new HttpError(400, `signedTransaction is not valid: ${errMsg(e)}`, 'INVALID_SIGNED_TX');
        }
        if (swap.signedTransaction && swap.signedTransaction !== signedTransaction) throw new HttpError(409, 'a different transaction was already submitted for this swap', 'TX_MISMATCH');
        if (this.executing.has(id)) throw new HttpError(409, 'execution in progress; poll GET /solana/swaps/:id', 'IN_PROGRESS');

        this.executing.add(id);
        try {
            swap = this.store.update(id, { status: 'SUBMITTED', signedTransaction, signature, submittedAt: swap.submittedAt ?? Date.now() });
            const r = await this.api.execute({
                signedTransaction, requestId: swap.requestId,
                lastValidBlockHeight: swap.lastValidBlockHeight === undefined ? undefined : String(swap.lastValidBlockHeight),
            });
            swap = r.status === 'Success'
                ? this.store.update(id, {
                    status: 'COMPLETED', signature: r.signature ?? signature, inAmountSpent: r.totalInputAmount, outAmount: r.totalOutputAmount, jupiterCode: r.code, completedAt: Date.now(),
                    feeCollected: swap.referralFeeBps ? collectedFee(r, swap.feeMint, swap.inputMint, swap.outputMint) : undefined,
                })
                : this.store.update(id, { status: 'FAILED', signature: r.signature ?? signature, jupiterCode: r.code, failReason: r.error || `Jupiter code ${r.code}` });
            log.info('swap executed', { id, status: swap.status, signature: swap.signature, code: r.code });
            return this.view(swap);
        } catch (e) {
            // A 4xx is Jupiter refusing the transaction (expired order, bad signature): nothing was sent.
            if (e instanceof JupiterError && e.status >= 400 && e.status < 500 && e.status !== 429) {
                return this.view(this.store.update(id, { status: 'FAILED', jupiterCode: e.code, failReason: e.message }));
            }
            // Anything else may have landed. Stay SUBMITTED; get() settles it from the chain.
            log.warn('execute reply lost', { id, signature, err: errMsg(e) });
            throw new HttpError(502, 'no answer from Jupiter; the swap may still land. Poll GET /solana/swaps/:id', 'RESULT_UNKNOWN');
        } finally {
            this.executing.delete(id);
        }
    }

    /** Read a swap, first settling states that only time or the chain can decide. */
    async get(id: string) {
        let swap = this.mustGet(id);
        const now = Date.now();
        if (swap.status === 'CREATED' && now - swap.createdAt > this.opts.orderTtlSec * 1000) {
            swap = this.store.update(id, { status: 'EXPIRED', failReason: 'not signed in time' });
        } else if (swap.status === 'SUBMITTED' && swap.signature && !this.executing.has(id)) {
            const state = await this.checkSignature?.(swap.signature).catch(() => 'unknown' as const) ?? 'unknown';
            if (state === 'confirmed') swap = this.store.update(id, { status: 'COMPLETED', completedAt: now });
            else if (state === 'failed') swap = this.store.update(id, { status: 'FAILED', failReason: 'transaction failed on chain' });
            else if (now - (swap.submittedAt ?? swap.createdAt) > this.opts.landTimeoutSec * 1000) {
                swap = this.store.update(id, { status: 'FAILED', failReason: 'transaction did not land before it expired' });
            }
        }
        return this.view(swap);
    }

    /**
     * Settle every open swap that time or the chain can decide, as get() does for one. Lists and the activity
     * feed read stored state, so this is what keeps them true. Returns how many swaps changed.
     */
    async settleOpen(addresses?: string[]): Promise<number> {
        if (this.settling) return 0;
        this.settling = true;
        let changed = 0;
        try {
            for (const s of this.store.all()) {
                if (SWAP_TERMINAL.has(s.status)) continue;
                if (addresses && !addresses.includes(s.taker) && !(s.receiver && addresses.includes(s.receiver))) continue;
                const after = await this.get(s.id).catch(() => undefined);
                if (after && after.status !== s.status) changed++;
            }
        } finally {
            this.settling = false;
        }
        return changed;
    }

    /**
     * Symbol, decimals and icon for a mint: the verified list, else Jupiter search. Never fails the caller and
     * never holds a swap up for long: the order's transaction is already ageing.
     */
    private async tokenFacts(mint: string): Promise<TokenView | undefined> {
        const hit = this.catalog.cached(mint);
        if (hit) return hit;
        const giveUp = new Promise<undefined>(resolve => { const t = setTimeout(() => resolve(undefined), 3000); t.unref?.(); });
        return Promise.race([this.catalog.get(mint).catch(() => undefined), giveUp]);
    }

    list(address?: string, limit?: number) {
        return this.store.list({ address, limit }).map(s => this.view(s));
    }

    private mustGet(id: string): SolanaSwap {
        const s = this.store.get(id);
        if (!s) throw new HttpError(404, 'swap not found');
        return s;
    }

    /** The public shape of a swap: no signed transaction, plus display amounts, links and the countdown while unsigned. */
    view(s: SolanaSwap, now = Date.now()) {
        const { signedTransaction: _omit, ...pub } = s;
        const tin = this.catalog.cached(s.inputMint), tout = this.catalog.cached(s.outputMint);
        // The verified list first; a token outside it is shown with the facts stored when the swap was created.
        const inDec = tin?.decimals ?? s.inDecimals, outDec = tout?.decimals ?? s.outDecimals;
        const fmt = (amount: string | undefined, decimals: number | undefined) => amount !== undefined && decimals !== undefined ? formatUnits(amount, decimals) : undefined;
        const expiresAt = s.status === 'CREATED' ? s.createdAt + this.opts.orderTtlSec * 1000 : undefined;
        return {
            ...pub,
            terminal: SWAP_TERMINAL.has(s.status),
            expiresAt,
            expiresInSec: expiresAt === undefined ? undefined : Math.max(0, Math.round((expiresAt - now) / 1000)),
            display: {
                inAmount: fmt(s.inAmount, inDec), quotedOutAmount: fmt(s.quotedOutAmount, outDec),
                minOutAmount: fmt(s.minOutAmount, outDec), outAmount: fmt(s.outAmount, outDec),
                inSymbol: tin?.symbol ?? s.inSymbol, outSymbol: tout?.symbol ?? s.outSymbol,
            },
            links: { tx: s.signature ? `https://solscan.io/tx/${s.signature}` : undefined },
        };
    }
}
