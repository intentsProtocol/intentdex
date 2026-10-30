export type TransferStatus =
    | 'CREATED'            // quote accepted, unsigned txs returned, waiting for the user's burn
    | 'BURN_SUBMITTED'     // client posted the burn tx hash
    | 'BURN_CONFIRMED'     // burn landed and matches the record; waiting for Circle's attestation
    | 'ATTESTED'           // message + attestation stored; ready to mint
    | 'MINT_SUBMITTED'     // relayer broadcast receiveMessage (hash saved before waiting)
    | 'COMPLETED'          // relayer mint confirmed
    | 'COMPLETED_EXTERNAL' // nonce already used: the user, Circle or another relayer minted
    | 'FAILED'
    | 'EXPIRED';           // no burn posted before the TTL

export const TERMINAL_STATUSES: ReadonlySet<TransferStatus> = new Set<TransferStatus>([
    'COMPLETED', 'COMPLETED_EXTERNAL', 'FAILED', 'EXPIRED',
]);

export type Speed = 'fast' | 'standard';
export type SpeedPref = Speed | 'auto';

export const FINALITY = { fast: 1000, standard: 2000 } as const;

export interface Quote {
    src: string;
    dst: string;
    amount: string;          // USDC base units (6 dp): what the user sends, our fee included
    protocolFee: string;     // our fee, sent to the treasury on the source chain (0 = none)
    feeRecipient?: string;   // treasury address on the source chain
    burnAmount: string;      // amount − protocolFee: what is burned
    speed: Speed;
    minFinalityThreshold: number;
    feeBps: number;          // from Iris /v2/burn/USDC/fees
    expectedFee: string;
    maxFee: string;          // expectedFee + buffer, floored at the on-chain minimum
    expectedReceive: string; // burnAmount − Circle's fee
    etaSec: number;
    fastAllowanceOk?: boolean;
    warnings: string[];
}

export interface Transfer {
    id: string;
    origin: 'api' | 'track';
    src: string;
    dst: string;
    srcDomain: number;
    dstDomain: number;
    sender: string;               // source wallet (EVM address / Solana pubkey); '' until known for tracked burns
    recipient: string;            // destination wallet
    mintRecipient: string;        // bytes32 hex used in the burn (EVM padded address or Solana USDC token account)
    recipientTokenAccount?: string; // Solana destination: base58 USDC token account
    amount: string;               // burned (what CCTP sees)
    grossAmount?: string;         // what the user sent: amount + protocolFee
    protocolFee?: string;         // our fee in USDC base units
    feeRecipient?: string;        // treasury address on the source chain
    feeTxHash?: string;           // EVM: the separate fee transfer; Solana: the fee is inside the burn tx
    feeStatus?: 'none' | 'pending' | 'paid' | 'unpaid' | 'awaiting';
    feePaidAt?: number;
    relayCost?: { amount: string; symbol: string };   // gas the relayer paid for the mint
    speed: Speed;
    minFinalityThreshold: number;
    maxFee: string;
    feeBps: number;
    expectedFee: string;
    expectedReceive: string;

    status: TransferStatus;
    burnTxHash?: string;
    eventAccount?: string;        // Solana source: MessageSent event account (rent reclaimable later)

    nonce?: string;
    message?: string;
    attestation?: string;
    reattestRequested?: boolean;

    mintTxHash?: string;
    mintTxHashes?: string[];      // every broadcast hash (fee bumps / resends)
    feeExecuted?: string;
    received?: string;

    failCount: number;
    retryAfter?: number;
    lastError?: string;
    failReason?: string;

    createdAt: number;
    updatedAt: number;
    burnSubmittedAt?: number;
    burnConfirmedAt?: number;
    attestedAt?: number;
    mintSubmittedAt?: number;
    completedAt?: number;
}

/** Unsigned transaction handed to the user's wallet. */
export type BuiltTx =
    | { kind: 'approve' | 'burn' | 'fee'; chain: 'evm'; chainId: number; to: string; data: string; value: '0'; minMaxFeePerGasGwei?: number }
    | { kind: 'burn'; chain: 'solana'; serializedTx: string; eventAccount: string; lastValidBlockHeight: number };

/** Fields decoded from a burn (source event, Solana event account, or Iris message). */
export interface ParsedBurn {
    amount: bigint;
    destinationDomain: number;
    mintRecipient: string;       // bytes32 hex, lowercase
    destinationCaller: string;   // bytes32 hex, lowercase
    maxFee: bigint;
    minFinalityThreshold: number;
    burnToken: string;           // bytes32 hex, lowercase
    sender: string;              // bytes32 hex, lowercase (depositor / messageSender)
}

export type BurnCheck =
    | { state: 'pending' }
    | { state: 'failed'; reason: string }
    | { state: 'confirmed'; burn?: ParsedBurn };

export interface MintResult {
    txHash: string;
    received?: bigint;
    feeCollected?: bigint;
    gasCost?: { amount: string; symbol: string };
}

export type FeeCheck = 'paid' | 'missing' | 'pending';

export type MintCheck =
    | { state: 'unknown' }                     // not found (dropped or not yet indexed)
    | { state: 'pending' }
    | { state: 'reverted'; reason?: string }
    | { state: 'success'; result: MintResult };

/** Machine-readable reason sent next to `error` on every non-2xx answer, so a client never has to match English. */
export type ErrorCode =
    // defaults, one per HTTP status
    | 'INVALID_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'WRONG_STATE' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'UNAVAILABLE' | 'INTERNAL'
    // the product is closed
    | 'PAUSED' | 'ROUTE_CLOSED' | 'STOCKS_DISABLED' | 'TOKEN_BLOCKED' | 'UNVERIFIED_DISABLED'
    // input
    | 'UNKNOWN_CHAIN' | 'SAME_CHAIN' | 'INVALID_AMOUNT' | 'BELOW_MINIMUM' | 'ABOVE_MAXIMUM' | 'AMOUNT_TOO_SMALL'
    | 'INVALID_SPEED' | 'FAST_UNAVAILABLE' | 'INVALID_ADDRESS' | 'INVALID_TX_HASH'
    | 'INVALID_MINT' | 'SAME_MINT' | 'INVALID_SLIPPAGE' | 'INVALID_SIGNED_TX'
    // the wallet cannot do it
    | 'INSUFFICIENT_FUNDS' | 'SWAP_NOT_BUILDABLE' | 'SWAP_TOO_LARGE' | 'TX_REJECTED'
    // the record is not in a state that allows the call
    | 'EXPIRED' | 'IN_PROGRESS' | 'TX_MISMATCH' | 'BURN_ALREADY_REGISTERED' | 'NO_FEE_DUE'
    // execute got no answer: the swap may still land, so poll it and never create another
    | 'RESULT_UNKNOWN';

export function defaultErrorCode(statusCode: number): ErrorCode {
    switch (statusCode) {
        case 400: return 'INVALID_REQUEST';
        case 403: return 'FORBIDDEN';
        case 404: return 'NOT_FOUND';
        case 409: return 'WRONG_STATE';
        case 429: return 'RATE_LIMITED';
        case 502: return 'UPSTREAM_ERROR';
        case 503: return 'UNAVAILABLE';
        default: return statusCode >= 500 ? 'INTERNAL' : 'INVALID_REQUEST';
    }
}

export class HttpError extends Error {
    code: ErrorCode;
    constructor(public statusCode: number, message: string, code?: ErrorCode) {
        super(message);
        this.code = code ?? defaultErrorCode(statusCode);
    }
}
