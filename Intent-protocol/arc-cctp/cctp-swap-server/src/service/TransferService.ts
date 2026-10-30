/**
 * TransferService — API-facing logic: quote, create (build unsigned txs), register the burn, track foreign burns.
 */
import { randomUUID } from 'crypto';
import { getChain, type ChainConfig } from '../config.js';
import { parseUsdc } from '../cctp/encoding.js';
import type { QuoteService } from '../cctp/quote.js';
import type { ChainAdapter } from '../chains/adapter.js';
import type { TransferStore } from '../store/TransferStore.js';
import type { Settings } from '../settings.js';
import type { Treasury } from '../treasury/Treasury.js';
import { protocolFeeFor } from '../fees.js';
import { HttpError, type BuiltTx, type Quote, type SpeedPref, type Transfer } from '../types.js';

export interface CreateTransferInput {
    src: string; dst: string; amount: string; sender: string; recipient: string; speed?: SpeedPref;
}

export class TransferService {
    private pausedLocal = false;

    constructor(
        private store: TransferStore,
        private adapters: Map<string, ChainAdapter>,
        private quotes: QuoteService,
        private settings?: Settings,      // admin-set pause, limits and closed chains; absent in tests
        private treasury?: Treasury,      // where our fee goes; no active wallet for the source chain = no fee
    ) {}

    /** Our fee for this transfer and where it goes, or undefined when there is none. */
    feeFor(s: ChainConfig, d: ChainConfig, amount: bigint): { amount: bigint; recipient: string } | undefined {
        const recipient = this.treasury?.active(s.kind)?.address;
        if (!this.settings || !recipient) return undefined;
        const fee = protocolFeeFor(amount, this.settings.cctp, d.key);
        return fee > 0n ? { amount: fee, recipient } : undefined;
    }

    get paused(): boolean { return this.settings ? this.settings.cctp.paused : this.pausedLocal; }
    set paused(v: boolean) { if (this.settings) this.settings.patch({ cctp: { paused: v } }); else this.pausedLocal = v; }

    /** Quote under the admin settings: closed routes, Fast switched off, transfer limits, fee buffer. */
    private quoteFor(s: ChainConfig, d: ChainConfig, amount: bigint, pref: SpeedPref): Promise<Quote> {
        const c = this.settings?.cctp;
        if (this.settings && s.key !== d.key && !this.settings.routeOpen(s.key, d.key)) {
            throw new HttpError(503, `${s.name} → ${d.name} is temporarily closed`, 'ROUTE_CLOSED');
        }
        if (c && !c.fastEnabled) {
            if (pref === 'fast') throw new HttpError(400, 'Fast transfers are turned off; use speed=standard or auto', 'FAST_UNAVAILABLE');
            pref = 'standard';
        }
        return this.quotes.quote(s, d, amount, pref, c ?? {}, this.feeFor(s, d, amount));
    }

    chainAndAdapter(key: unknown): { chain: ChainConfig; adapter: ChainAdapter } {
        if (typeof key !== 'string' || !key) throw new HttpError(400, 'chain is required', 'UNKNOWN_CHAIN');
        const chain = getChain(key);
        const adapter = chain && this.adapters.get(chain.key);
        if (!chain || !adapter) throw new HttpError(400, `unknown or disabled chain '${key}'`, 'UNKNOWN_CHAIN');
        return { chain, adapter };
    }

    static parseAmount(v: unknown): bigint {
        if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, 'amount is required (decimal USDC, e.g. "1.5")', 'INVALID_AMOUNT');
        try { return parseUsdc(v); } catch (e: any) { throw new HttpError(400, e.message, 'INVALID_AMOUNT'); }
    }

    static parseSpeed(v: unknown): SpeedPref {
        if (v === undefined || v === null || v === '') return 'auto';
        if (v === 'auto' || v === 'fast' || v === 'standard') return v;
        throw new HttpError(400, "speed must be 'auto', 'fast' or 'standard'", 'INVALID_SPEED');
    }

    async quote(src: unknown, dst: unknown, amount: unknown, speed: unknown): Promise<Quote> {
        const s = this.chainAndAdapter(src);
        const d = this.chainAndAdapter(dst);
        return this.quoteFor(s.chain, d.chain, TransferService.parseAmount(amount), TransferService.parseSpeed(speed));
    }

    async create(input: CreateTransferInput): Promise<{ transfer: Transfer; quote: Quote; txs: BuiltTx[] }> {
        if (this.paused) throw new HttpError(503, 'new transfers are paused', 'PAUSED');
        const s = this.chainAndAdapter(input.src);
        const d = this.chainAndAdapter(input.dst);
        if (typeof input.sender !== 'string' || !s.adapter.validateAddress(input.sender)) {
            throw new HttpError(400, `sender is not a valid ${s.chain.name} wallet address`, 'INVALID_ADDRESS');
        }
        if (typeof input.recipient !== 'string' || !d.adapter.validateAddress(input.recipient)) {
            throw new HttpError(400, `recipient is not a valid ${d.chain.name} wallet address`, 'INVALID_ADDRESS');
        }
        const amount = TransferService.parseAmount(input.amount);
        const quote = await this.quoteFor(s.chain, d.chain, amount, TransferService.parseSpeed(input.speed));
        const { mintRecipient, tokenAccount } = d.adapter.mintRecipientFor(input.recipient);

        const protocolFee = BigInt(quote.protocolFee);
        const burnAmount = BigInt(quote.burnAmount);
        const txs = await s.adapter.buildBurn({
            owner: input.sender, amount: burnAmount, dstDomain: d.chain.domain, mintRecipient,
            maxFee: BigInt(quote.maxFee), minFinalityThreshold: quote.minFinalityThreshold,
            fee: protocolFee > 0n && quote.feeRecipient ? { recipient: quote.feeRecipient, amount: protocolFee } : undefined,
        });
        const solBurn = txs.find(t => t.chain === 'solana');

        const now = Date.now();
        const transfer = this.store.create({
            id: randomUUID(),
            origin: 'api',
            src: s.chain.key, dst: d.chain.key, srcDomain: s.chain.domain, dstDomain: d.chain.domain,
            sender: input.sender, recipient: input.recipient,
            mintRecipient, recipientTokenAccount: tokenAccount,
            amount: burnAmount.toString(), grossAmount: amount.toString(),
            protocolFee: protocolFee.toString(), feeRecipient: quote.feeRecipient, feeStatus: protocolFee > 0n ? 'pending' : 'none',
            speed: quote.speed, minFinalityThreshold: quote.minFinalityThreshold,
            maxFee: quote.maxFee, feeBps: quote.feeBps, expectedFee: quote.expectedFee, expectedReceive: quote.expectedReceive,
            status: 'CREATED',
            eventAccount: solBurn && solBurn.chain === 'solana' ? solBurn.eventAccount : undefined,
            failCount: 0, createdAt: now, updatedAt: now,
        });
        return { transfer, quote, txs };
    }

    /** Solana: a fresh tx when the blockhash expired before the user signed. */
    async rebuild(id: string): Promise<{ transfer: Transfer; txs: BuiltTx[] }> {
        const t = this.mustGet(id);
        if (t.status !== 'CREATED') throw new HttpError(409, `transfer is ${t.status}; only CREATED transfers can be rebuilt`);
        const s = this.chainAndAdapter(t.src);
        const txs = await s.adapter.buildBurn({
            owner: t.sender, amount: BigInt(t.amount), dstDomain: t.dstDomain, mintRecipient: t.mintRecipient,
            maxFee: BigInt(t.maxFee), minFinalityThreshold: t.minFinalityThreshold,
            fee: t.protocolFee && t.protocolFee !== '0' && t.feeRecipient ? { recipient: t.feeRecipient, amount: BigInt(t.protocolFee) } : undefined,
        });
        const solBurn = txs.find(x => x.chain === 'solana');
        const transfer = this.store.update(id, {
            eventAccount: solBurn && solBurn.chain === 'solana' ? solBurn.eventAccount : t.eventAccount,
        });
        return { transfer, txs };
    }

    /** EVM sources: the hash of the separate fee transfer (Solana carries the fee inside the burn). */
    submitFee(id: string, txHash: unknown): Transfer {
        const t = this.mustGet(id);
        const s = this.chainAndAdapter(t.src);
        if (!t.protocolFee || t.protocolFee === '0') throw new HttpError(409, 'this transfer has no service fee', 'NO_FEE_DUE');
        if (s.chain.kind !== 'evm') throw new HttpError(409, 'on Solana the fee is part of the burn transaction', 'NO_FEE_DUE');
        if (typeof txHash !== 'string' || !s.adapter.isValidTxHash(txHash)) throw new HttpError(400, `txHash is not a valid ${s.chain.name} transaction hash`, 'INVALID_TX_HASH');
        if (t.feeStatus === 'paid') return t;
        if (t.burnTxHash?.toLowerCase() === txHash.toLowerCase()) throw new HttpError(400, 'that is the burn transaction; send the fee transfer hash', 'INVALID_TX_HASH');
        return this.store.update(id, { feeTxHash: txHash, feeStatus: t.feeStatus === 'awaiting' ? 'pending' : t.feeStatus, retryAfter: undefined });
    }

    submitBurn(id: string, txHash: unknown, feeTxHash?: unknown): Transfer {
        if (feeTxHash !== undefined && feeTxHash !== null && feeTxHash !== '') {
            const t = this.submitBurnOnly(id, txHash);
            return this.submitFee(t.id, feeTxHash);
        }
        return this.submitBurnOnly(id, txHash);
    }

    private submitBurnOnly(id: string, txHash: unknown): Transfer {
        const t = this.mustGet(id);
        const s = this.chainAndAdapter(t.src);
        if (typeof txHash !== 'string' || !s.adapter.isValidTxHash(txHash)) throw new HttpError(400, `txHash is not a valid ${s.chain.name} transaction hash`, 'INVALID_TX_HASH');
        if (t.status !== 'CREATED') {
            if (t.burnTxHash?.toLowerCase() === txHash.toLowerCase()) return t;   // idempotent
            throw new HttpError(409, `transfer is already ${t.status}`);
        }
        const other = this.store.findByBurn(t.src, txHash);
        if (other && other.id !== id) throw new HttpError(409, `burn already registered to transfer ${other.id}`, 'BURN_ALREADY_REGISTERED');
        return this.store.update(id, { status: 'BURN_SUBMITTED', burnTxHash: txHash, burnSubmittedAt: Date.now() });
    }

    /** Recover any CCTP burn (e.g. made outside our API). Details are filled from the chain / Iris message. */
    track(src: unknown, txHash: unknown): Transfer {
        if (this.paused) throw new HttpError(503, 'new transfers are paused', 'PAUSED');
        const s = this.chainAndAdapter(src);
        if (typeof txHash !== 'string' || !s.adapter.isValidTxHash(txHash)) throw new HttpError(400, `txHash is not a valid ${s.chain.name} transaction hash`, 'INVALID_TX_HASH');
        const existing = this.store.findByBurn(s.chain.key, txHash);
        if (existing) return existing;
        const now = Date.now();
        return this.store.create({
            id: randomUUID(), origin: 'track',
            src: s.chain.key, dst: '', srcDomain: s.chain.domain, dstDomain: -1,
            sender: '', recipient: '', mintRecipient: '',
            amount: '0', speed: 'standard', minFinalityThreshold: 0, maxFee: '0', feeBps: 0, expectedFee: '0', expectedReceive: '0',
            status: 'BURN_SUBMITTED', burnTxHash: txHash, burnSubmittedAt: now,
            failCount: 0, createdAt: now, updatedAt: now,
        });
    }

    mustGet(id: string): Transfer {
        const t = this.store.get(id);
        if (!t) throw new HttpError(404, 'transfer not found');
        return t;
    }
}
