/** Types for the Bitcoin Cash (BCH) cross-chain swap module via NEAR Intents 1Click API. */

export type BchSwapStatus =
    | 'PENDING_DEPOSIT'     // Quote created, waiting for user deposit on origin chain
    | 'KNOWN_DEPOSIT_TX'    // Deposit transaction hash registered
    | 'PROCESSING'          // Deposit confirmed, solvers fulfilling
    | 'SUCCESS'             // Target asset delivered to recipient
    | 'REFUNDED'            // Failed or timed out, funds refunded
    | 'FAILED'              // Irrecoverable failure
    | 'EXPIRED';            // Deadline passed without deposit

export const BCH_SWAP_TERMINAL: ReadonlySet<BchSwapStatus> = new Set<BchSwapStatus>([
    'SUCCESS',
    'REFUNDED',
    'FAILED',
    'EXPIRED',
]);

export interface BchSwapRecord {
    id: string;                      // e.g. "bch-swp_8f93e2b10a"
    status: BchSwapStatus;
    fromAsset: string;               // 1Click assetId, e.g. "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"
    toAsset: string;                 // 1Click assetId, e.g. "nep141:bch.omft.near"
    fromChain: string;               // e.g. "base" or "bch"
    toChain: string;                 // e.g. "bch" or "base"
    fromSymbol: string;              // e.g. "USDC" or "BCH"
    toSymbol: string;                // e.g. "BCH" or "USDC"
    fromDecimals: number;
    toDecimals: number;
    fromIcon?: string;
    toIcon?: string;
    depositAddress: string;          // Address user sends funds to
    depositMemo?: string;            // Optional memo/tag if required
    amountIn: string;                // Base units (integer string)
    amountInFormatted: string;       // Decimal formatted string (e.g. "100.5")
    amountInUsd: number;             // Approximate USD value
    expectedOut: string;             // Base units
    expectedOutFormatted: string;    // Decimal formatted string
    expectedOutUsd: number;          // Approximate USD value
    minAmountOut: string;            // Slippage protected min output
    sender?: string;                 // Origin wallet
    recipient: string;               // Destination payout address
    refundTo: string;                // Refund address on origin chain
    depositTxHash?: string;          // Tx hash on origin chain
    settleTxHash?: string;           // Tx hash on destination chain
    depositExplorerUrl?: string;     // Explorer link for deposit
    settleExplorerUrl?: string;      // Explorer link for settlement
    deadline: string;                // ISO timestamp
    timeEstimateSec: number;
    ourFeeBps: number;
    ourFeeUsd?: number;
    createdAt: number;
    updatedAt: number;
    lastPolledAt?: number;
    lastError?: string;
}

/** 1Click Token definition from GET /v0/tokens */
export interface OneClickToken {
    assetId: string;
    symbol: string;
    name: string;
    decimals: number;
    chain: string;
    contractAddress?: string;
    icon?: string;
    priceUsd?: number;
}

/** 1Click AppFee entry */
export interface OneClickAppFee {
    recipient: string;
    fee: number; // basis points (integer)
}

/** 1Click POST /v0/quote request body */
export interface OneClickQuoteRequest {
    dry?: boolean;
    swapType?: 'EXACT_INPUT' | 'EXACT_OUTPUT';
    originAsset: string;
    destinationAsset: string;
    amount: string; // base units
    slippageTolerance?: number; // basis points (e.g. 50 = 0.5%)
    appFees?: OneClickAppFee[];
    depositType?: 'ORIGIN_CHAIN' | 'DEFUSE';
    referral?: string;
    // Required by 1Click API even for dry quotes
    refundTo?: string;
    refundType?: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
    recipient?: string;
    recipientType?: 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
    deadline?: string; // ISO 8601
}

/** 1Click POST /v0/quote response */
export interface OneClickQuoteResponse {
    quote?: {
        depositAddress?: string;
        depositMemo?: string;
        amountIn?: string;
        amountOut?: string;
        minAmountOut?: string;
        deadline?: string;
        timeEstimate?: number; // seconds
        priceImpact?: number;
    };
    amountIn?: string;
    amountOut?: string;
    minAmountOut?: string;
    deadline?: string;
    timeEstimate?: number;
    priceImpact?: number;
    depositAddress?: string;
    depositMemo?: string;
    error?: string;
    message?: string;
}

/** 1Click POST /v0/deposit-address request body */
export interface OneClickDepositAddressRequest {
    quote: any;
    refundTo: string;
    recipient: string;
}

/** 1Click POST /v0/deposit-address response */
export interface OneClickDepositAddressResponse {
    address: string;
    memo?: string;
    depositType?: string;
    minDepositAmount?: string;
    expiresAt?: string;
}

/** 1Click GET /v0/status?depositAddress=... response */
export interface OneClickStatusResponse {
    status: 'PENDING_DEPOSIT' | 'KNOWN_DEPOSIT_TX' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED';
    depositTxHash?: string;
    settleTxHash?: string;
    amountIn?: string;
    amountOut?: string;
    error?: string;
    updatedAt?: string;
}

/** Client Quote Request DTO */
export interface BchQuoteRequestDto {
    fromAsset: string; // symbol or assetId, e.g. "USDC" (on Base) or full assetId
    toAsset: string;   // symbol or assetId, e.g. "BCH"
    fromChain?: string; // e.g. "base", "arbitrum", "solana", "bch"
    toChain?: string;   // e.g. "bch" or "base"
    amount: string;     // human formatted or base units
    slippageBps?: number;
}

/** Client Create Swap Request DTO */
export interface CreateBchSwapDto {
    fromAsset: string;
    toAsset: string;
    fromChain?: string;
    toChain?: string;
    amount: string;
    recipient: string;
    refundTo: string;
    slippageBps?: number;
}

/** Submit Deposit Tx DTO */
export interface SubmitDepositTxDto {
    txHash: string;
}
