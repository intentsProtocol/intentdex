/**
 * Shapes of the swap server's public API (arc-cctp/cctp-swap-server; reference: arc-cctp/jupdocs/04-frontend-api.md).
 *
 * One server, two products: cross-chain USDC through Circle CCTP and Solana swaps through Jupiter. Every amount
 * in an answer is a base-unit string; `display` carries the human-readable form.
 */

/** The codes the UI branches on. The server sends more; anything else is handled by its HTTP status. */
export type SwapServerErrorCode =
    | 'PAUSED' | 'ROUTE_CLOSED' | 'UNKNOWN_CHAIN' | 'SAME_CHAIN'
    | 'BELOW_MINIMUM' | 'ABOVE_MAXIMUM' | 'AMOUNT_TOO_SMALL' | 'INVALID_AMOUNT' | 'FAST_UNAVAILABLE'
    | 'INSUFFICIENT_FUNDS' | 'SWAP_NOT_BUILDABLE' | 'SWAP_TOO_LARGE' | 'TX_REJECTED' | 'TX_MISMATCH' | 'INVALID_SIGNED_TX'
    | 'STOCKS_DISABLED' | 'TOKEN_BLOCKED' | 'UNVERIFIED_DISABLED'
    | 'EXPIRED' | 'WRONG_STATE' | 'IN_PROGRESS' | 'BURN_ALREADY_REGISTERED' | 'NO_FEE_DUE'
    | 'RESULT_UNKNOWN' | 'UPSTREAM_ERROR' | 'RATE_LIMITED' | 'NOT_FOUND' | 'INVALID_REQUEST' | 'FORBIDDEN' | 'UNAVAILABLE' | 'INTERNAL'
    /** Set by the client when the server did not answer at all. */
    | 'UNREACHABLE';

// ── config ───────────────────────────────────────────────────────────────────

export interface CctpChain {
    key: string;                  // 'base-sepolia'
    name: string;                 // 'Base Sepolia'
    kind: 'evm' | 'solana';
    domain: number;
    chainId?: number;
    usdc: string;                 // token address, or mint on Solana
    fastSource: boolean;
    standardEtaSec: number;
    fastEtaSec?: number;
    minMaxFeePerGasGwei?: number; // Arc drops transactions priced below this
    explorerTx: string;           // '{tx}' placeholder
}

export interface SwapServerConfig {
    serverTime: number;
    cctp: {
        network: string;          // 'testnet' or 'mainnet': one server serves one of them
        paused: boolean;
        pauseReason?: string;
        relayEnabled: boolean;
        fastEnabled: boolean;
        minTransferUsdc: number;
        maxTransferUsdc: number;
        createdTtlSec: number;
        fee: { bps: number; minUsdc: number; maxUsdc: number; gasUsdc: Record<string, number>; enforced: boolean; collecting: { evm: boolean; solana: boolean } };
        chains: CctpChain[];
        closedRoutes: string[];   // 'src>dst'
    };
    solana: {
        enabled: boolean;
        network: 'mainnet';
        paused: boolean;
        pauseReason?: string;
        stocksEnabled: boolean;
        allowUnverified: boolean;
        slippage: { defaultBps: number; maxBps: number };
        maxSwapUsd: number;       // 0 = no limit
        orderTtlSec: number;
        nativeMint: string;
        fee: { referralFeeBps: number; stocksFeeBps: number | null; stablesFeeBps: number | null; active: boolean };
    };
}

// ── cross-chain USDC ─────────────────────────────────────────────────────────

export interface CctpQuote {
    src: string;
    dst: string;
    amount: string;               // what the user sends, our fee included
    protocolFee: string;          // our fee, paid to the treasury on the source chain
    feeRecipient?: string;
    burnAmount: string;           // amount − protocolFee
    speed: 'fast' | 'standard';
    feeBps: number;
    expectedFee: string;          // Circle's fee, taken from the mint
    maxFee: string;
    expectedReceive: string;
    etaSec: number;
    warnings: string[];
    /** Present on GET /quote; the quote inside POST /transfers has base units only. */
    display?: { amount: string; protocolFee: string; burnAmount: string; expectedFee: string; maxFee: string; expectedReceive: string };
}

export type TransferStatus =
    | 'CREATED' | 'BURN_SUBMITTED' | 'BURN_CONFIRMED' | 'ATTESTED' | 'MINT_SUBMITTED'
    | 'COMPLETED' | 'COMPLETED_EXTERNAL' | 'FAILED' | 'EXPIRED';

export type FeeStatus = 'none' | 'pending' | 'paid' | 'unpaid' | 'awaiting';

export interface Transfer {
    id: string;
    src: string;
    dst: string;
    sender: string;
    recipient: string;
    amount: string;               // burned
    grossAmount?: string;         // sent: amount + protocolFee
    protocolFee?: string;
    feeRecipient?: string;
    feeTxHash?: string;
    feeStatus?: FeeStatus;
    speed: 'fast' | 'standard';
    expectedFee: string;
    expectedReceive: string;
    status: TransferStatus;
    burnTxHash?: string;
    mintTxHash?: string;
    received?: string;
    lastError?: string;
    failReason?: string;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    expiresAt?: number;           // only while CREATED
    expiresInSec?: number;
    display: { amount: string; grossAmount: string; protocolFee: string; expectedFee: string; expectedReceive: string; received?: string };
    links: { burn?: string; mint?: string };
    /** Attested but not delivered: what a user needs to mint it themselves. */
    selfMint?: { chain: string; contract: string; method: string; message: string; attestation: string };
}

export interface EvmBuiltTx {
    kind: 'approve' | 'burn' | 'fee';
    chain: 'evm';
    chainId: number;
    to: string;
    data: string;
    value: '0';
    minMaxFeePerGasGwei?: number;
}

export interface SolanaBuiltTx {
    kind: 'burn';
    chain: 'solana';
    serializedTx: string;         // base64, already signed by the event-account key; sign as the owner and send
    eventAccount: string;
    lastValidBlockHeight: number;
}

export type BuiltTx = EvmBuiltTx | SolanaBuiltTx;

/** A wallet's USDC and gas on one CCTP chain, read by the server. */
export interface ChainBalance {
    chain: string;
    owner: string;
    usdc: string;
    display: string;
    native: string;               // wei or lamports; on Arc the same USDC balance at 18 decimals
    nativeDecimals: number;
    nativeSymbol: string;         // 'ETH' | 'SOL' | 'USDC'
}

export interface CreatedTransfer { transfer: Transfer; quote: CctpQuote; txs: BuiltTx[] }

// ── activity: transfers and swaps as one list ────────────────────────────────

export type ActivityPhase = 'awaiting_signature' | 'processing' | 'action_needed' | 'completed' | 'failed' | 'expired';

export interface ActivitySide {
    symbol?: string;
    decimals?: number;
    amount: string;
    display?: string;
    chain: string;                // CCTP chain key, or 'solana' for a swap
    chainName: string;
    token: string;
    icon?: string;
    estimated?: boolean;
}

export interface ActivityItem {
    id: string;
    kind: 'transfer' | 'swap';
    product: 'cctp' | 'jupiter';
    network: string;              // 'testnet' | 'mainnet'
    status: string;
    phase: ActivityPhase;
    terminal: boolean;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    expiresAt?: number;
    expiresInSec?: number;
    owner: string;
    recipient: string;
    sell: ActivitySide;
    buy: ActivitySide;
    usdValue?: number;
    fee?: { amount: string; display?: string; symbol?: string; token?: string; status: string };
    links: { source?: string; destination?: string };
    failReason?: string;
    transfer?: { src: string; dst: string; speed: string; feeStatus?: FeeStatus; burnTxHash?: string; mintTxHash?: string; selfMintAvailable: boolean };
    swap?: { inputMint: string; outputMint: string; signature?: string; slippageBps: number; gasless: boolean };
}

export interface ActivityPage { serverTime: number; items: ActivityItem[] }

// ── Solana swaps (mainnet) ───────────────────────────────────────────────────

export interface SolanaToken {
    mint: string;
    symbol: string;
    name: string;
    icon?: string;
    decimals: number;
    verified: boolean;
    suspicious: boolean;
    tags: string[];
    isStock: boolean;
    stockIssuer?: string;
    usdPrice?: number;
    priceChange24h?: number;      // percent
    volume24h?: number;
    liquidity?: number;
    mcap?: number;
}

export interface SolanaTokenPage { total: number; offset: number; limit: number; tokens: SolanaToken[]; issuers?: Record<string, number> }

export interface SolanaBalance {
    mint: string;
    native: boolean;          // SOL itself, reported under the wrapped-SOL mint
    amount: string;
    decimals: number;
    display: string;
    symbol?: string;
    name?: string;
    icon?: string;
    verified: boolean;
    isStock: boolean;
    usdPrice?: number;
    usdValue?: number;
}

export type SolanaPrices = Record<string, { usdPrice: number; decimals: number; priceChange24h?: number; stockData?: { price: number } }>;

export interface SolanaQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    minOutAmount: string;
    slippageBps: number;
    priceImpactPct?: number;      // percent points; negative is a loss
    feeBps: number;
    referralFeeBps: number;
    router: string;
    gasless: boolean;
    route: { label: string; percent: number; inputMint: string; outputMint: string }[];
    inUsdValue?: number;
    outUsdValue?: number;
    display: { inAmount?: string; outAmount?: string; minOutAmount?: string; inSymbol?: string; outSymbol?: string };
    warnings: string[];
    /** Only when the quote was asked with a taker. */
    takerCheck?: { ok: boolean; code?: number; message?: string };
}

export type SolanaSwapStatus = 'CREATED' | 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export interface SolanaSwap {
    id: string;
    taker: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    quotedOutAmount: string;
    minOutAmount: string;
    slippageBps: number;
    status: SolanaSwapStatus;
    terminal: boolean;
    signature?: string;
    outAmount?: string;
    failReason?: string;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    expiresInSec?: number;
    display: { inAmount?: string; quotedOutAmount?: string; minOutAmount?: string; outAmount?: string; inSymbol?: string; outSymbol?: string };
    links: { tx?: string };
}

export interface CreatedSolanaSwap {
    swap: SolanaSwap;
    quote: SolanaQuote;
    tx: { serializedTx: string; lastValidBlockHeight?: number; expiresInSec: number; expiresAt: number };
}
