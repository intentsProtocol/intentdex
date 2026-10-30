/** Business logic service for Bitcoin Cash cross-chain swaps. */
import crypto from 'crypto';
import type { OneClickClient } from './OneClickClient.js';
import type { TokenCatalog } from './TokenCatalog.js';
import type { BchSwapStore } from './BchSwapStore.js';
import type {
    BchSwapRecord,
    BchQuoteRequestDto,
    CreateBchSwapDto,
    OneClickQuoteRequest,
    OneClickToken,
} from './types.js';
import { logger } from '../log.js';
import type { Settings } from '../settings.js';

const log = logger('bch-service');

export interface BchServiceConfig {
    client: OneClickClient;
    catalog: TokenCatalog;
    store: BchSwapStore;
    settings: Settings;
    defaultFeeBps?: number;
    feeRecipientNear?: string;
    minSwapUsd?: number;
    maxSwapUsd?: number;
}

export class BchSwapService {
    private client: OneClickClient;
    private catalog: TokenCatalog;
    private store: BchSwapStore;
    private settings: Settings;
    private defaultFeeBps: number;
    private feeRecipientNear: string;
    private minSwapUsd: number;
    private maxSwapUsd: number;

    constructor(cfg: BchServiceConfig) {
        this.client = cfg.client;
        this.catalog = cfg.catalog;
        this.store = cfg.store;
        this.settings = cfg.settings;
        this.defaultFeeBps = cfg.defaultFeeBps ?? 25;
        this.feeRecipientNear = cfg.feeRecipientNear || 'antony.near';
        this.minSwapUsd = cfg.minSwapUsd ?? 10;
        this.maxSwapUsd = cfg.maxSwapUsd ?? 25_000;
    }

    /** Helper: parse formatted decimal string into base units string */
    static parseUnits(amountStr: string, decimals: number): string {
        const clean = amountStr.trim();
        if (!clean || isNaN(Number(clean)) || Number(clean) <= 0) {
            throw new Error(`Invalid numeric amount "${amountStr}"`);
        }
        const [intPart, fracPart = ''] = clean.split('.');
        const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
        const full = `${intPart}${paddedFrac}`.replace(/^0+/, '');
        return full || '0';
    }

    /** Helper: format base units integer string into human-readable decimal */
    static formatUnits(baseAmount: string, decimals: number): string {
        const clean = baseAmount.trim().replace(/^0+/, '') || '0';
        if (clean === '0') return '0';
        if (clean.length <= decimals) {
            const padded = clean.padStart(decimals, '0');
            return `0.${padded}`.replace(/\.?0+$/, '');
        }
        const intPart = clean.slice(0, clean.length - decimals);
        const fracPart = clean.slice(clean.length - decimals).replace(/0+$/, '');
        return fracPart ? `${intPart}.${fracPart}` : intPart;
    }

    /** Validate address for a given chain */
    validateAddress(address: string, chain: string): boolean {
        const addr = address.trim();
        const c = chain.toLowerCase();

        if (c === 'bch' || c === 'bitcoincash') {
            // CashAddr format (with or without bitcoincash: prefix) or legacy 1/3
            const withoutPrefix = addr.replace(/^bitcoincash:/i, '');
            // CashAddr payload is 42 chars alphanumeric, legacy is 26-35 base58
            if (/^(q|p)[a-z0-9]{41}$/i.test(withoutPrefix)) return true;
            if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr)) return true;
            return false;
        }

        if (c === 'btc' || c === 'bitcoin') {
            return /^((bc1|tb1)[a-z0-9]{25,87}|(BC1|TB1)[A-Z0-9]{25,87}|[132mn][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(addr);
        }

        if (c === 'base' || c === 'arbitrum' || c === 'eth' || c === 'ethereum' || c === 'optimism' || c === 'polygon' || c === 'bsc' || c === 'avalanche') {
            return /^0x[a-fA-F0-9]{40}$/.test(addr);
        }

        if (c === 'solana') {
            return /^[1-9A-HJ-NP-za-km-z]{32,44}$/.test(addr);
        }

        if (c === 'near') {
            return /^[a-z0-9._-]+$/i.test(addr) && addr.length >= 2 && addr.length <= 64;
        }

        // Generic non-empty fallback for other chains
        return addr.length >= 10 && addr.length <= 128;
    }

    /** Explorer URL generator */
    getExplorerUrl(chain: string, type: 'tx' | 'address', hashOrAddr: string): string {
        const c = chain.toLowerCase();
        if (c === 'bch') {
            return `https://blockchair.com/bitcoin-cash/${type === 'tx' ? 'transaction' : 'address'}/${hashOrAddr}`;
        }
        if (c === 'base') {
            return `https://basescan.org/${type === 'tx' ? 'tx' : 'address'}/${hashOrAddr}`;
        }
        if (c === 'arbitrum') {
            return `https://arbiscan.io/${type === 'tx' ? 'tx' : 'address'}/${hashOrAddr}`;
        }
        if (c === 'solana') {
            return `https://solscan.io/${type === 'tx' ? 'tx' : 'account'}/${hashOrAddr}`;
        }
        if (c === 'eth') {
            return `https://etherscan.io/${type === 'tx' ? 'tx' : 'address'}/${hashOrAddr}`;
        }
        return '';
    }

    private getFeeSettings(): { feeBps: number; feeRecipient: string } {
        const s = this.settings.bch;
        const feeBps = s?.feeBps ?? this.defaultFeeBps;
        const feeRecipient = s?.feeRecipientNear || this.feeRecipientNear;
        return { feeBps, feeRecipient };
    }

    private checkOperational() {
        const bchSettings = this.settings.bch;
        if (bchSettings?.paused) {
            throw new Error(`BCH swaps are currently paused: ${bchSettings.pauseReason || 'maintenance'}`);
        }
        if (bchSettings?.enabled === false) {
            throw new Error('BCH swaps are currently disabled');
        }
    }

    /** Get Quote for a potential swap */
    async getQuote(req: BchQuoteRequestDto): Promise<{
        fromToken: OneClickToken;
        toToken: OneClickToken;
        amountIn: string;
        amountInFormatted: string;
        amountOut: string;
        amountOutFormatted: string;
        minAmountOut: string;
        minAmountOutFormatted: string;
        timeEstimateSec: number;
        priceImpact?: number;
        ourFeeBps: number;
        rawQuote: any;
    }> {
        this.checkOperational();

        const fromToken = this.catalog.resolve(req.fromAsset, req.fromChain);
        if (!fromToken) {
            throw new Error(`Unknown source asset: "${req.fromAsset}" on chain "${req.fromChain || 'any'}"`);
        }

        const toToken = this.catalog.resolve(req.toAsset, req.toChain);
        if (!toToken) {
            throw new Error(`Unknown destination asset: "${req.toAsset}" on chain "${req.toChain || 'any'}"`);
        }

        // At least one side must be BCH
        const isFromBch = fromToken.symbol.toUpperCase() === 'BCH' || fromToken.chain === 'bch';
        const isToBch = toToken.symbol.toUpperCase() === 'BCH' || toToken.chain === 'bch';
        if (!isFromBch && !isToBch) {
            throw new Error('At least one leg of the swap must be Bitcoin Cash (BCH)');
        }

        // Parse amount
        let baseAmount: string;
        if (req.amount.includes('.') || Number(req.amount) < 1000) {
            baseAmount = BchSwapService.parseUnits(req.amount, fromToken.decimals);
        } else {
            baseAmount = req.amount;
        }

        const { feeBps, feeRecipient } = this.getFeeSettings();
        const deadline = new Date(Date.now() + 3600_000).toISOString();
        const quoteReq: OneClickQuoteRequest = {
            dry: true,
            swapType: 'EXACT_INPUT',
            originAsset: fromToken.assetId,
            destinationAsset: toToken.assetId,
            amount: baseAmount,
            slippageTolerance: req.slippageBps ?? 50,
            depositType: 'ORIGIN_CHAIN',
            // Required by 1Click API even for dry (price-only) quotes
            refundTo: 'antony.near',
            refundType: 'INTENTS',
            recipient: 'antony.near',
            recipientType: 'INTENTS',
            deadline,
        };

        if (feeBps > 0 && feeRecipient) {
            quoteReq.appFees = [{ recipient: feeRecipient, fee: feeBps }];
        }

        const quoteRes = await this.client.getQuote(quoteReq);
        const amountOut = quoteRes.amountOut || quoteRes.quote?.amountOut || '0';
        const minAmountOut = quoteRes.minAmountOut || quoteRes.quote?.minAmountOut || amountOut;
        const timeEstimateSec = quoteRes.timeEstimate || quoteRes.quote?.timeEstimate || 180;
        const priceImpact = quoteRes.priceImpact || quoteRes.quote?.priceImpact;

        return {
            fromToken,
            toToken,
            amountIn: baseAmount,
            amountInFormatted: BchSwapService.formatUnits(baseAmount, fromToken.decimals),
            amountOut,
            amountOutFormatted: BchSwapService.formatUnits(amountOut, toToken.decimals),
            minAmountOut,
            minAmountOutFormatted: BchSwapService.formatUnits(minAmountOut, toToken.decimals),
            timeEstimateSec,
            priceImpact,
            ourFeeBps: feeBps,
            rawQuote: quoteRes,
        };
    }

    /** Create a Swap: requests deposit address and persists record */
    async createSwap(req: CreateBchSwapDto): Promise<BchSwapRecord> {
        this.checkOperational();

        // 1. Get quote
        const quoteResult = await this.getQuote({
            fromAsset: req.fromAsset,
            toAsset: req.toAsset,
            fromChain: req.fromChain,
            toChain: req.toChain,
            amount: req.amount,
            slippageBps: req.slippageBps,
        });

        const { fromToken, toToken, amountIn, amountOut, minAmountOut, timeEstimateSec, ourFeeBps, rawQuote } = quoteResult;

        // 2. Validate addresses
        if (!this.validateAddress(req.recipient, toToken.chain)) {
            throw new Error(`Invalid recipient address "${req.recipient}" for destination chain ${toToken.chain}`);
        }
        if (!this.validateAddress(req.refundTo, fromToken.chain)) {
            throw new Error(`Invalid refundTo address "${req.refundTo}" for origin chain ${fromToken.chain}`);
        }

        // 3. Request deposit address from 1Click
        const depositRes = await this.client.getDepositAddress({
            quote: rawQuote.quote || rawQuote,
            refundTo: req.refundTo,
            recipient: req.recipient,
        });

        const depositAddress = depositRes.address || rawQuote.depositAddress || rawQuote.quote?.depositAddress;
        if (!depositAddress) {
            throw new Error('1Click did not return a valid deposit address');
        }

        const swapId = `bch-swp_${crypto.randomBytes(6).toString('hex')}`;
        const deadline = depositRes.expiresAt || new Date(Date.now() + 3600_000).toISOString();

        // Estimate USD amounts
        const amountInNum = Number(quoteResult.amountInFormatted);
        const amountOutNum = Number(quoteResult.amountOutFormatted);
        const amountInUsd = fromToken.priceUsd ? amountInNum * fromToken.priceUsd : amountInNum;
        const expectedOutUsd = toToken.priceUsd ? amountOutNum * toToken.priceUsd : amountOutNum;
        const ourFeeUsd = (amountInUsd * ourFeeBps) / 10000;

        const record: BchSwapRecord = {
            id: swapId,
            status: 'PENDING_DEPOSIT',
            fromAsset: fromToken.assetId,
            toAsset: toToken.assetId,
            fromChain: fromToken.chain,
            toChain: toToken.chain,
            fromSymbol: fromToken.symbol,
            toSymbol: toToken.symbol,
            fromDecimals: fromToken.decimals,
            toDecimals: toToken.decimals,
            fromIcon: fromToken.icon,
            toIcon: toToken.icon,
            depositAddress,
            depositMemo: depositRes.memo,
            amountIn,
            amountInFormatted: quoteResult.amountInFormatted,
            amountInUsd,
            expectedOut: amountOut,
            expectedOutFormatted: quoteResult.amountOutFormatted,
            expectedOutUsd,
            minAmountOut,
            recipient: req.recipient,
            refundTo: req.refundTo,
            depositExplorerUrl: this.getExplorerUrl(fromToken.chain, 'address', depositAddress),
            deadline,
            timeEstimateSec,
            ourFeeBps,
            ourFeeUsd,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        this.store.create(record);
        log.info('[bch-swap] created swap', {
            id: swapId,
            from: `${fromToken.chain}:${fromToken.symbol}`,
            to: `${toToken.chain}:${toToken.symbol}`,
            depositAddress,
        });

        return record;
    }

    /** Register user deposit transaction */
    async registerDepositTx(swapId: string, txHash: string): Promise<BchSwapRecord> {
        const swap = this.store.get(swapId);
        if (!swap) throw new Error(`Swap not found: ${swapId}`);
        if (!txHash || txHash.length < 10) throw new Error('Invalid transaction hash');

        const depositExplorerUrl = this.getExplorerUrl(swap.fromChain, 'tx', txHash);
        const updated = this.store.update(swapId, {
            depositTxHash: txHash,
            depositExplorerUrl: depositExplorerUrl || swap.depositExplorerUrl,
            status: swap.status === 'PENDING_DEPOSIT' ? 'KNOWN_DEPOSIT_TX' : swap.status,
        });

        // Notify 1Click solver network
        this.client.submitDepositTx(swap.depositAddress, txHash).catch(err => {
            log.warn('[bch-swap] notify deposit tx warning', { swapId, err: (err as Error).message });
        });

        return updated;
    }

    getSwap(id: string): BchSwapRecord | undefined {
        return this.store.get(id);
    }

    listSwaps(filter?: { address?: string; limit?: number }): BchSwapRecord[] {
        return this.store.list(filter);
    }
}
