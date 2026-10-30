/**
 * Lending: the shapes this server speaks to its clients, and the narrow view of the lending protocol it needs.
 *
 * Clients (the web app, the browser extension, the mobile app) never talk to the protocol. They get `Market`,
 * `LendQuote` and `LoanView` from /lend/*, where every amount is a decimal string of base units (satoshis,
 * 6-decimal USDC) and every percentage is basis points or a plain percent number.
 *
 * The server holds no keys and no funds here: it forwards to the protocol and remembers what was created.
 */

// ── what the protocol gives us (the part of @liquidium/client this module relies on) ──

export interface RawPool {
    id: string;
    asset: string;
    displayName?: string;
    chain: string;
    decimals: bigint;
    frozen: boolean;
    totalSupply: bigint;
    totalDebt: bigint;
    availableLiquidity: bigint;
    maxLtv: bigint;                  // bps
    liquidationThreshold: bigint;    // bps
    liquidationBonus: bigint;        // bps
    activationFee: bigint;           // bps
    estimatedLendingApy: bigint;     // ray: 1e27 = 100%
    estimatedBorrowingApy: bigint;   // ray
    utilizationRate: bigint;         // ray
}

export type RawPrices = Record<string, number>;

export interface RawLtv {
    activationFeeAmount: bigint;
    openingDebtAmount: bigint;
    borrowUsd: bigint;               // 8 decimals
    collateralUsd: bigint;           // 8 decimals
    ltvBps: bigint;
    maxAllowedLtvBps: bigint;
    validationErrors: unknown[];
}

export interface RawTarget { amount: bigint; inflowFeeAmount: bigint; target: { address: string; chain?: string } }

export interface RawLoan {
    loanId: bigint;
    ref: string;
    status: { operation: string; state: string; confirmations: number | null; requiredConfirmations: number | null };
    terms: { ltvMaxBps: bigint; depositWindowSeconds: bigint };
    collateral: { poolId: string; asset: string; decimals: bigint; amount: bigint };
    borrow: { poolId: string; asset: string; chain?: string; decimals: bigint; amount: bigint; destination: unknown };
    refundDestination: unknown;
    initialDeposit: { collateralAmount: bigint; targets: Record<string, RawTarget | undefined>; detectedTimestamp: bigint | null; expiryTimestamp: bigint | null };
    repayment: { debtAmount: bigint; targets: Record<string, RawTarget | undefined> };
    position: { collateralAmount: bigint; borrowedAmount: bigint; debtInterestAmount: bigint; totalDebtAmount: bigint };
}

export interface RawCreate {
    collateral: { poolId: string; asset: string; amount: bigint };
    borrow: { poolId: string; asset: string; chain: string; amount: bigint; destination: string };
    refund: { chain: string; destination: string };
    ltvMaxBps: bigint;
    depositWindowSeconds: bigint;
}

/** The protocol, as far as this module uses it. The real one is LiquidiumClient.ts; tests pass a stand-in. */
export interface LendProtocol {
    listPools(): Promise<RawPool[]>;
    getPrices(): Promise<RawPrices>;
    calculateLtv(req: { collateralPoolId: string; borrowPoolId: string; collateralAmount: bigint; borrowAmount: bigint }, pools: RawPool[], prices: RawPrices): RawLtv;
    /** Creates the loan exactly once. If the loan exists remotely but could not be read back, it is fetched, never created again. */
    create(req: RawCreate): Promise<RawLoan>;
    get(ref: string): Promise<RawLoan>;
    /** Loans that mention this reference, address or transaction id. */
    find(query: string): Promise<{ ref: string }[]>;

    // Advanced Mode: Accounts, Portfolio, Borrow, Withdraw, Supply
    getProfileId?(address: string): Promise<string | null>;
    prepareCreateProfile?(account: string): Promise<{ message: string; expiryTimestamp: bigint; actionType: string; account: string }>;
    createProfile?(account: string, chain: string, signature: string, expiryTimestamp: bigint): Promise<string>;
    getUserPositionSummary?(profileId: string): Promise<any>;
    getUserReserves?(profileId: string): Promise<any[]>;
    getHealthFactor?(profileId: string): Promise<any>;
    prepareBorrow?(req: { profileId: string; poolId: string; amount: bigint; chain: string; receiver: string; signerWalletAddress: string }): Promise<{ message: string; expiryTimestamp: bigint; actionType?: string; data: any }>;
    submitBorrow?(data: any, signatureInfo: { signature: string; chain: string; account?: string }): Promise<any>;
    prepareWithdraw?(req: { profileId: string; poolId: string; amount: bigint; chain: string; receiver: string; signerWalletAddress: string }): Promise<{ message: string; expiryTimestamp: bigint; actionType?: string; data: any }>;
    submitWithdraw?(data: any, signatureInfo: { signature: string; chain: string; account?: string }): Promise<any>;
    supplyTarget?(profileId: string, poolId: string, action: 'deposit' | 'repay', chain: string): Promise<any>;
    submitInflow?(txid: string, operation: 'deposit' | 'repayment', chain?: string): Promise<any>;
}

// ── what clients get ──

export interface Market {
    poolId: string;
    asset: string;
    chain: string;
    name: string;
    decimals: number;
    priceUsd: number;
    /** Percent per year, e.g. 4.68. */
    supplyApy: number;
    borrowApy: number;
    /** 0 to 100. */
    utilization: number;
    availableLiquidity: string;
    totalSupply: string;
    totalDebt: string;
    maxLtvBps: number;
    liquidationThresholdBps: number;
    liquidationBonusBps: number;
    activationFeeBps: number;
    frozen: boolean;
}

export interface LendQuote {
    collateral: { asset: string; chain: string; amount: string; usd: number };
    borrow: { asset: string; chain: string; amount: string; usd: number };
    ltvBps: number;
    /** The most a loan may open at: the pool's maximum less the safety buffer. */
    maxLtvBps: number;
    liquidationThresholdBps: number;
    activationFee: string;
    /** What is owed the moment the loan opens: the amount borrowed plus the activation fee. */
    openingDebt: string;
    borrowApy: number;
    /** Price of the collateral asset, in USD, at which the loan can be liquidated. */
    liquidationPrice: number;
    collateralPrice: number;
    errors: string[];
}

export type LoanPhase = 'awaiting_deposit' | 'confirming' | 'active' | 'repaying' | 'closed' | 'expired' | 'failed' | 'liquidated';
export const OPEN_PHASES: LoanPhase[] = ['awaiting_deposit', 'confirming', 'active', 'repaying'];

export interface LoanTarget { chain: string; address: string; amount: string; feeAmount: string }

export interface LoanView {
    ref: string;
    provider: 'liquidium';
    phase: LoanPhase;
    status: { operation: string; state: string; confirmations: number | null; requiredConfirmations: number | null };
    collateral: { asset: string; chain: string; decimals: number; amount: string };
    borrow: { asset: string; chain: string; decimals: number; amount: string; destination: string };
    refundDestination: string;
    deposit: { amount: string; targets: LoanTarget[]; expiresAt: number | null; detectedAt: number | null };
    repayment: { debt: string; targets: LoanTarget[] };
    position: { collateral: string; borrowed: string; interest: string; totalDebt: string };
    ltvBps: number;
    liquidationThresholdBps: number;
    liquidationPrice: number;
    borrowApy: number;
    createdAt: number;
    updatedAt: number;
}

export interface LoanRecord {
    ref: string;
    loanId: string;
    view: LoanView;
    /** Addresses that may list this loan: where the borrowed funds go and where the collateral returns. */
    addresses: string[];
    history: { at: number; phase: LoanPhase; state: string }[];
    /** The LTV warning already raised for this loan, so it is raised once per level. */
    warnedBps?: number;
    createdAt: number;
    updatedAt: number;
}

export interface LendSettings {
    /** Stop new loans. Existing ones are still read and followed. */
    paused: boolean;
    pauseReason: string;
    /** Largest loan this server will create, in USD. 0 = no limit of ours. */
    maxBorrowUsd: number;
    /** Raise a warning event when a loan's LTV reaches this. */
    warnLtvBps: number;
}

export interface CreateLoanBody {
    collateralAsset: string;
    borrowAsset: string;
    collateralAmount: string;
    borrowAmount: string;
    /** Where the borrowed funds are sent. */
    borrowDestination: string;
    /** Where the collateral returns after repayment. */
    refundDestination: string;
    /** Safety buffer under the pool's maximum LTV, in bps. */
    ltvBufferBps?: number;
    depositWindowMinutes?: number;
}

// ── Advanced Mode Types ──

export interface PrepareCreateAccountBody {
    account: string;
}

export interface PrepareCreateAccountView {
    account: string;
    message: string;
    expiryTimestamp: string;
    actionType: string;
}

export interface CreateAccountBody {
    account: string;
    chain: 'BTC' | 'ETH';
    signature: string;
    expiryTimestamp: string;
}

export interface AdvancedPositionView {
    asset: string;
    poolId: string;
    amount: string;
    usd: number;
    apy: number;
    interest: string;
}

export interface PortfolioView {
    profileId: string;
    supplied: AdvancedPositionView[];
    borrowed: AdvancedPositionView[];
    suppliedUsd: number;
    borrowedUsd: number;
    healthPct: number;
    healthFactor: number | null;
    netApy: number;
    netValueUsd: number;
    netInterestUsd: number;
    borrowable: Record<string, string>;
    wallet: Record<string, string>;
}

export interface PrepareBorrowBody {
    profileId: string;
    poolId: string;
    amount: string;
    chain: string;
    receiver: string;
    signerWalletAddress: string;
}

export interface PrepareBorrowView {
    message: string;
    expiryTimestamp: string;
    actionType: string;
    data: any;
}

export interface SubmitBorrowBody {
    profileId: string;
    poolId: string;
    amount: string;
    chain: string;
    receiver: string;
    signerWalletAddress: string;
    expiryTimestamp: string;
    signature: string;
    signingChain: 'BTC' | 'ETH';
}

export interface PrepareWithdrawBody {
    profileId: string;
    poolId: string;
    amount: string;
    chain: string;
    receiver: string;
    signerWalletAddress: string;
}

export interface PrepareWithdrawView {
    message: string;
    expiryTimestamp: string;
    actionType: string;
    data: any;
}

export interface SubmitWithdrawBody {
    profileId: string;
    poolId: string;
    amount: string;
    chain: string;
    receiver: string;
    signerWalletAddress: string;
    expiryTimestamp: string;
    signature: string;
    signingChain: 'BTC' | 'ETH';
}

export interface OutflowReceiptView {
    id: string;
    txid?: string;
    asset: string;
    amount: string;
    usd: number;
    status: string;
    etaMinutes: number;
}

export interface SupplyTargetBody {
    profileId: string;
    poolId: string;
    action: 'deposit' | 'repay';
    chain: string;
}

export interface SupplyTargetView {
    targetAddress: string;
    poolId: string;
    action: 'deposit' | 'repay';
    chain: string;
    type: string;
}

export interface SubmitInflowBody {
    txid: string;
    operation: 'deposit' | 'repayment';
    chain?: string;
}

// ── Admin User Tracking Types ──

export interface AdminLendUserSummary {
    profileId: string;
    primaryAddress: string;
    wallets: { address: string; chain: string; addedAt: number }[];
    createdAt: number;
    lastSeenAt: number;
    notes?: string;
    portfolio?: {
        suppliedUsd: number;
        borrowedUsd: number;
        netValueUsd: number;
        netApy: number;
        healthFactor: number | null;
        healthPct: number;
        suppliedCount: number;
        borrowedCount: number;
    };
    loansCount: number;
}

export interface AdminLendUsersResponse {
    total: number;
    offset: number;
    limit: number;
    stats: {
        totalUsers: number;
        activeBorrowers: number;
        totalSuppliedUsd: number;
        totalBorrowedUsd: number;
        atRiskCount: number;
    };
    users: AdminLendUserSummary[];
}

export interface AdminLendUserDetail {
    profile: {
        profileId: string;
        primaryAddress: string;
        wallets: { address: string; chain: string; addedAt: number }[];
        createdAt: number;
        lastSeenAt: number;
        notes?: string;
    };
    portfolio: PortfolioView;
    loans: LoanView[];
    events?: unknown[];
}

