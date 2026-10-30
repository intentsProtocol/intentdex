/**
 * activity — transfers and swaps as one list of rows: a wallet's history, and the public feed.
 *
 * Pure mapping and selection over the two record types; the route in index.ts supplies the records and the
 * views. A row keeps the product's own `status` and adds a `phase` both products share, so a client can draw
 * one list without knowing either state machine.
 */
import { formatUnits } from 'ethers';
import { formatUsdc } from './cctp/encoding.js';
import type { ChainConfig } from './config.js';
import type { SolanaSwap } from './jupiter/types.js';
import type { BchSwapRecord } from './bch/types.js';
import { HttpError, type Transfer } from './types.js';
import type { TransferView } from './service/transferView.js';

export type ActivityPhase = 'awaiting_signature' | 'processing' | 'action_needed' | 'completed' | 'failed' | 'expired';

export interface ActivitySide {
    symbol?: string;
    decimals?: number;
    amount: string;          // base units
    display?: string;        // absent when the token's decimals are not known
    chain: string;           // CCTP chain key, or 'solana' for a swap
    chainName: string;
    token: string;           // token address or mint
    icon?: string;
    estimated?: boolean;     // buy side only: true until the delivered amount is known
}

export interface ActivityItem {
    id: string;
    kind: 'transfer' | 'swap';
    product: 'cctp' | 'jupiter' | 'bch';
    network: string;
    status: string;
    phase: ActivityPhase;
    terminal: boolean;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    expiresAt?: number;
    expiresInSec?: number;
    owner: string;           // the wallet that signs: sender or taker
    recipient: string;
    sell: ActivitySide;
    buy: ActivitySide;
    usdValue?: number;       // USDC is counted at 1 USD; a swap carries Jupiter's value at quote time
    fee?: { amount: string; display?: string; symbol?: string; token?: string; status: string };
    links: { source?: string; destination?: string };
    failReason?: string;
    transfer?: { src: string; dst: string; speed: string; feeStatus?: string; burnTxHash?: string; mintTxHash?: string; selfMintAvailable: boolean };
    swap?: { inputMint: string; outputMint: string; signature?: string; slippageBps: number; gasless: boolean };
}

const TRANSFER_PHASE: Record<Transfer['status'], ActivityPhase> = {
    CREATED: 'awaiting_signature',
    BURN_SUBMITTED: 'processing', BURN_CONFIRMED: 'processing', ATTESTED: 'processing', MINT_SUBMITTED: 'processing',
    COMPLETED: 'completed', COMPLETED_EXTERNAL: 'completed',
    FAILED: 'failed', EXPIRED: 'expired',
};

const SWAP_PHASE: Record<SolanaSwap['status'], ActivityPhase> = {
    CREATED: 'awaiting_signature', SUBMITTED: 'processing', COMPLETED: 'completed', FAILED: 'failed', EXPIRED: 'expired',
};

export function transferItem(v: TransferView, chain: (key: string) => ChainConfig | undefined, network: string): ActivityItem {
    const src = chain(v.src), dst = v.dst ? chain(v.dst) : undefined;
    const sent = v.grossAmount ?? v.amount;
    const hasFee = !!v.protocolFee && v.protocolFee !== '0';
    const phase = TRANSFER_PHASE[v.status];
    const usdc = { symbol: 'USDC', decimals: 6 };
    return {
        id: v.id, kind: 'transfer', product: 'cctp', network,
        status: v.status,
        // Attested but held for our fee: the user has to send the fee transaction (or mint themselves).
        phase: phase === 'processing' && v.feeStatus === 'awaiting' ? 'action_needed' : phase,
        terminal: phase === 'completed' || phase === 'failed' || phase === 'expired',
        createdAt: v.createdAt, updatedAt: v.updatedAt, completedAt: v.completedAt,
        expiresAt: v.expiresAt, expiresInSec: v.expiresInSec,
        owner: v.sender, recipient: v.recipient,
        sell: { ...usdc, amount: sent, display: formatUsdc(sent), chain: v.src, chainName: src?.name ?? v.src, token: src?.usdc ?? '' },
        buy: {
            ...usdc, amount: v.received ?? v.expectedReceive, display: formatUsdc(v.received ?? v.expectedReceive),
            chain: v.dst, chainName: dst?.name ?? v.dst, token: dst?.usdc ?? '', estimated: !v.received,
        },
        usdValue: Number(formatUsdc(sent)),
        fee: hasFee ? { amount: v.protocolFee!, display: formatUsdc(v.protocolFee!), symbol: 'USDC', token: src?.usdc, status: v.feeStatus ?? 'pending' } : undefined,
        links: { source: v.links.burn, destination: v.links.mint },
        failReason: v.failReason,
        transfer: { src: v.src, dst: v.dst, speed: v.speed, feeStatus: v.feeStatus, burnTxHash: v.burnTxHash, mintTxHash: v.mintTxHash, selfMintAvailable: !!v.selfMint },
    };
}

/** The swap view as SolanaSwapService.view() returns it. */
export type SwapView = Omit<SolanaSwap, 'signedTransaction'> & {
    terminal: boolean; expiresAt?: number; expiresInSec?: number;
    display: { inAmount?: string; quotedOutAmount?: string; outAmount?: string; inSymbol?: string; outSymbol?: string };
    links: { tx?: string };
};

export function swapItem(v: SwapView): ActivityItem {
    const spent = v.inAmountSpent ?? v.inAmount;
    const out = v.outAmount ?? v.quotedOutAmount;
    const fmt = (amount: string, decimals?: number) => decimals === undefined ? undefined : formatUnits(amount, decimals);
    return {
        id: v.id, kind: 'swap', product: 'jupiter', network: 'mainnet',
        status: v.status, phase: SWAP_PHASE[v.status], terminal: v.terminal,
        createdAt: v.createdAt, updatedAt: v.updatedAt, completedAt: v.completedAt,
        expiresAt: v.expiresAt, expiresInSec: v.expiresInSec,
        owner: v.taker, recipient: v.receiver ?? v.taker,
        sell: {
            symbol: v.display.inSymbol, decimals: v.inDecimals, amount: spent, display: fmt(spent, v.inDecimals) ?? v.display.inAmount,
            chain: 'solana', chainName: 'Solana', token: v.inputMint, icon: v.inIcon,
        },
        buy: {
            symbol: v.display.outSymbol, decimals: v.outDecimals, amount: out, display: fmt(out, v.outDecimals) ?? v.display.outAmount ?? v.display.quotedOutAmount,
            chain: 'solana', chainName: 'Solana', token: v.outputMint, icon: v.outIcon, estimated: !v.outAmount,
        },
        usdValue: v.inUsdValue,
        fee: v.feeCollected ? { amount: v.feeCollected.total, token: v.feeCollected.mint, status: 'paid' } : undefined,
        links: { source: v.links.tx },
        failReason: v.failReason,
        swap: { inputMint: v.inputMint, outputMint: v.outputMint, signature: v.signature, slippageBps: v.slippageBps, gasless: v.gasless },
    };
}

export function bchItem(s: BchSwapRecord): ActivityItem {
    const isDone = s.status === 'SUCCESS';
    const isTerm = s.status === 'SUCCESS' || s.status === 'FAILED' || s.status === 'EXPIRED' || s.status === 'REFUNDED';
    let phase: ActivityPhase = 'processing';
    if (s.status === 'PENDING_DEPOSIT') phase = 'awaiting_signature';
    else if (s.status === 'SUCCESS') phase = 'completed';
    else if (s.status === 'FAILED') phase = 'failed';
    else if (s.status === 'EXPIRED') phase = 'expired';

    return {
        id: s.id,
        kind: 'swap',
        product: 'bch',
        network: 'mainnet',
        status: s.status,
        phase,
        terminal: isTerm,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        owner: s.sender || s.depositAddress,
        recipient: s.recipient,
        sell: {
            symbol: s.fromSymbol,
            decimals: s.fromDecimals,
            amount: s.amountIn,
            display: s.amountInFormatted,
            chain: s.fromChain,
            chainName: s.fromChain.toUpperCase(),
            token: s.fromAsset,
            icon: s.fromIcon,
        },
        buy: {
            symbol: s.toSymbol,
            decimals: s.toDecimals,
            amount: s.expectedOut,
            display: s.expectedOutFormatted,
            chain: s.toChain,
            chainName: s.toChain.toUpperCase(),
            token: s.toAsset,
            icon: s.toIcon,
            estimated: !isDone,
        },
        usdValue: s.amountInUsd,
        fee: s.ourFeeUsd ? { amount: String(s.ourFeeUsd), display: `$${s.ourFeeUsd.toFixed(2)}`, status: 'collected' } : undefined,
        links: { source: s.depositExplorerUrl, destination: s.settleExplorerUrl },
        failReason: s.lastError,
    };
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BCH_CASHADDR = /^(bitcoincash:)?[qp][a-z0-9]{41}$/i;
const BCH_LEGACY = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
export const MAX_ACTIVITY_ADDRESSES = 5;

/** `address` from the query string: repeated, comma-separated or both. */
export function parseAddresses(raw: unknown): string[] {
    const parts = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
    const out = [...new Set(parts)];
    if (out.length > MAX_ACTIVITY_ADDRESSES) throw new HttpError(400, `at most ${MAX_ACTIVITY_ADDRESSES} addresses`, 'INVALID_ADDRESS');
    for (const a of out) {
        if (!EVM_ADDRESS.test(a) && !SOLANA_ADDRESS.test(a) && !BCH_CASHADDR.test(a) && !BCH_LEGACY.test(a)) {
            throw new HttpError(400, `not a wallet address: ${a.slice(0, 64)}`, 'INVALID_ADDRESS');
        }
    }
    return out;
}

export interface ActivityQuery { addresses: string[]; limit: number; before?: number }

/**
 * Pick the rows for one page, newest first, and map only those. With addresses: every record the wallet sent or
 * receives. Without: the public feed, which leaves out records that never reached a chain.
 */
export function selectActivity(
    transfers: Transfer[], swaps: SolanaSwap[], q: ActivityQuery,
    map: { transfer: (t: Transfer) => ActivityItem; swap: (s: SolanaSwap) => ActivityItem; bch?: (b: BchSwapRecord) => ActivityItem },
    bchSwaps: BchSwapRecord[] = [],
): ActivityItem[] {
    const evm = new Set(q.addresses.filter(a => EVM_ADDRESS.test(a)).map(a => a.toLowerCase()));
    const bch = new Set(q.addresses.filter(a => BCH_CASHADDR.test(a) || BCH_LEGACY.test(a)).map(a => a.toLowerCase().replace(/^bitcoincash:/i, '')));
    const exact = new Set(q.addresses);
    const mine = (...owners: (string | undefined)[]) => owners.some(o => !!o && (exact.has(o) || evm.has(o.toLowerCase()) || bch.has(o.toLowerCase().replace(/^bitcoincash:/i, ''))));
    const onChain = (status: string) => status !== 'CREATED' && status !== 'EXPIRED';
    const feed = q.addresses.length === 0;

    const rows: { createdAt: number; item: () => ActivityItem }[] = [];
    for (const t of transfers) {
        if (feed ? onChain(t.status) : mine(t.sender, t.recipient)) rows.push({ createdAt: t.createdAt, item: () => map.transfer(t) });
    }
    for (const s of swaps) {
        if (feed ? onChain(s.status) : mine(s.taker, s.receiver)) rows.push({ createdAt: s.createdAt, item: () => map.swap(s) });
    }
    if (map.bch) {
        const bchMapper = map.bch;
        for (const b of bchSwaps) {
            if (feed ? (b.status !== 'PENDING_DEPOSIT' && b.status !== 'EXPIRED') : mine(b.sender, b.recipient, b.refundTo, b.depositAddress)) {
                rows.push({ createdAt: b.createdAt, item: () => bchMapper(b) });
            }
        }
    }
    return rows
        .filter(r => q.before === undefined || r.createdAt < q.before)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, q.limit)
        .map(r => r.item());
}
