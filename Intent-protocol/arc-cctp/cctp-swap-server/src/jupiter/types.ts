/** Types for the Solana same-chain swap module (Jupiter Swap API v2, mainnet only). */

export type SwapStatus =
    | 'CREATED'    // order built, unsigned tx returned, waiting for the signed tx
    | 'SUBMITTED'  // signed tx handed to Jupiter /execute; result not known yet
    | 'COMPLETED'
    | 'FAILED'
    | 'EXPIRED';   // not signed before the order went stale

export const SWAP_TERMINAL: ReadonlySet<SwapStatus> = new Set<SwapStatus>(['COMPLETED', 'FAILED', 'EXPIRED']);

export interface SolanaSwap {
    id: string;
    taker: string;
    receiver?: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;            // base units
    quotedOutAmount: string;     // base units, before slippage
    minOutAmount: string;        // base units, after slippage
    slippageBps: number;
    feeBps: number;
    feeMint?: string;
    router: string;
    gasless: boolean;
    requestId: string;
    lastValidBlockHeight?: number;
    expireAt?: string;
    inUsdValue?: number;         // Jupiter's USD value of the input at quote time
    inSymbol?: string;
    outSymbol?: string;
    inDecimals?: number;         // token facts at creation, so a history row renders for unverified tokens too
    outDecimals?: number;
    inIcon?: string;
    outIcon?: string;
    referralFeeBps?: number;     // our fee on this swap (0 / absent = none)
    referralAccount?: string;
    feeCollected?: { mint: string; total: string; ours: string };   // from /execute amounts; ours = 80 %

    status: SwapStatus;
    signedTransaction?: string;  // kept so a lost /execute reply can be retried; never returned by the API
    signature?: string;
    inAmountSpent?: string;      // Jupiter totalInputAmount
    outAmount?: string;          // Jupiter totalOutputAmount (what reached the wallet)
    jupiterCode?: number;
    failReason?: string;

    createdAt: number;
    updatedAt: number;
    submittedAt?: number;
    completedAt?: number;
}

/** Subset of Jupiter's GET /swap/v2/order response that this server reads. */
export interface JupOrder {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpact?: number;        // percentage points: -0.1 = -0.1 %
    routePlan?: { percent: number; swapInfo: { label: string; inputMint: string; outputMint: string } }[];
    feeBps?: number;
    feeMint?: string;
    router: string;
    gasless?: boolean;
    transaction: string | null;  // null without a taker, '' when the tx could not be built
    requestId: string;
    lastValidBlockHeight?: number;
    expireAt?: string;
    inUsdValue?: number;
    outUsdValue?: number;
    errorCode?: number;
    errorMessage?: string;
}

export interface JupExecuteResult {
    status: 'Success' | 'Failed';
    signature?: string;
    code: number;
    error?: string;
    totalInputAmount?: string;
    totalOutputAmount?: string;
    inputAmountResult?: string;  // entering the swap, after input-side fees
    outputAmountResult?: string; // produced by the route, before output-side fees
}

/** Subset of Jupiter's Tokens API v2 mint object. */
export interface JupToken {
    id: string;
    name: string;
    symbol: string;
    icon?: string;
    decimals: number;
    tokenProgram?: string;
    freezeAuthority?: string | null;
    usdPrice?: number;
    liquidity?: number;
    mcap?: number;
    holderCount?: number;
    organicScore?: number;
    isVerified?: boolean;
    tags?: string[];
    audit?: { isSus?: boolean };
    stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number };
}

export type JupPrices = Record<string, {
    usdPrice: number; decimals: number; priceChange24h?: number; blockId?: number;
    stockData?: { id: string; price: number; mcap?: number; updatedAt?: string };
}>;

export interface JupiterApi {
    order(params: Record<string, string>): Promise<JupOrder>;
    execute(body: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }): Promise<JupExecuteResult>;
    verifiedTokens(): Promise<JupToken[]>;
    searchTokens(query: string): Promise<JupToken[]>;
    prices(ids: string[]): Promise<JupPrices>;
}

export class JupiterError extends Error {
    constructor(message: string, public status: number, public code?: number) { super(message); }
}
