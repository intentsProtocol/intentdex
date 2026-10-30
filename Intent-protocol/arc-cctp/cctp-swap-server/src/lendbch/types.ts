/**
 * lendbch types — BCH → PUSD borrowing through the ParyonUSD contracts.
 *
 * All token amounts are integers in their smallest unit: BCH in satoshis, PUSD in cents (2 decimals), and the
 * oracle price in US cents (so $276.59 is 27659). Interest rates are the on-chain unit: per 10-million per
 * 144-block period. Nothing here imports from `src/lend` (Liquidium); the two modules share no code.
 */

export type LendBchNetwork = 'mainnet' | 'chipnet';

/** The five token categories and the global parameters a Paryon deployment is built from. */
export interface DeploymentParams {
    /** Human label, e.g. 'mainnet-v1'. */
    id: string;
    network: LendBchNetwork;
    tokenIds: {
        paryonTokenId: string;
        poolTokenId: string;
        redeemerTokenId: string;
        loanKeyFactoryTokenId: string;
        oracleMigrationKeyTokenId: string;
    };
    contractParams: {
        oraclePublicKey: string;
        /** Locking bytecode (hex) the protocol borrow fee is paid to. */
        protocolFeeLockingBytecode: string;
        startBlockHeight: number;
        periodLengthBlocks: number;
        timeLockRedemption: number;
    };
}

/** One contract's derived on-chain identity. `address` is the p2sh32 cashaddr; `lockingBytecode` is its scriptPubKey. */
export interface DerivedContract {
    name: string;
    address: string;
    tokenAddress: string;
    lockingBytecode: string;
}

/** The full derived deployment: every address lendbch reads, plus the price-contract variants to probe. */
export interface Deployment {
    params: DeploymentParams;
    contracts: {
        borrowing: DerivedContract;
        loan: DerivedContract;
        loanSidecar: DerivedContract;
        loanKeyFactory: DerivedContract;
        loanKeyOriginEnforcer: DerivedContract;
        loanKeyOriginProof: DerivedContract;
        stabilityPool: DerivedContract;
        stabilityPoolSidecar: DerivedContract;
        collector: DerivedContract;
        payout: DerivedContract;
        addLiquidity: DerivedContract;
        manage: DerivedContract;
    };
    /** Price contracts in preference order (Guarded first, then the original). The live one is whichever has threads. */
    priceVariants: DerivedContract[];
}

/** Decoded 27-byte loan state (NFT commitment on the loan UTXO). */
export interface LoanState {
    /** PUSD debt in cents. */
    borrowed: bigint;
    /** PUSD being redeemed against this loan, in cents. */
    beingRedeemed: bigint;
    /** 0 = new, 1 = single-period, 2 = mature. */
    status: number;
    lastPeriodInterestPaid: number;
    currentRate: number;
    nextRate: number;
    interestManager: number;
    minRateManager: number;
    maxRateManager: number;
}

/** Decoded price-contract state. */
export interface PriceState {
    sequence: number;
    /** BCH/USD price in US cents (e.g. 27659 = $276.59). */
    priceCents: number;
}

/** A loan as served to clients: on-chain facts plus the derived risk numbers. */
export interface LoanView {
    loanTokenId: string;
    txid: string;
    vout: number;
    /** Collateral held on the loan UTXO, in satoshis. */
    collateralSats: string;
    /** PUSD debt in cents. */
    debtCents: string;
    status: number;
    currentRate: number;
    nextRate: number;
    aprPct: number;
    collateralRatioPct: number | null;
    liquidationPriceCents: string | null;
    beingRedeemedCents: string;
    lastPeriodInterestPaid: number;
}

export interface MarketView {
    network: LendBchNetwork;
    paused: boolean;
    pauseReason: string | null;
    priceCents: string | null;
    /** Aggregate protocol state. */
    totalDebtCents: string;
    totalCollateralSats: string;
    loanCount: number;
    rate: { minApr: number; medianApr: number; maxApr: number; defaultApr: number };
    fees: { borrowFeeBps: number; frontendFeeBps: number };
    limits: { minOpenRatioPct: number; warnRatioPct: number; minLoanCents: string };
    currentPeriod: number | null;
    priceContract: string | null;
}

export interface BorrowQuoteRequest {
    borrowCents?: string | number;
    collateralSats?: string | number;
}

export interface BorrowQuoteResponse {
    borrowCents: string;
    collateralSats: string;
    priceCents: string;
    maxBorrowCents: string;
    minCollateralSats: string;
    collateralRatioPct: number;
    liquidationPriceCents: string;
    protocolFeeSats: string;
    frontendFeeSats: string;
    aprPct: number;
    warnLowRatio: boolean;
    allowed: boolean;
    reason?: string;
}

export interface BuildLoanKeyRequest {
    userAddress: string;
    genesisUtxo: import('cashscript').Utxo;
    feeUtxos: import('cashscript').Utxo[];
    factoryUtxo?: import('cashscript').Utxo;
    treasuryAddress?: string;
}

export interface BuildBorrowRequest {
    userAddress: string;
    userTokenAddress: string;
    borrowCents: string | number | bigint;
    collateralSats: string | number | bigint;
    startingRate?: number;
    userBchUtxos: import('cashscript').Utxo[];
    enforcerUtxo: import('cashscript').Utxo;
    proofUtxo: import('cashscript').Utxo;
    borrowingUtxo?: import('cashscript').Utxo;
    priceUtxo?: import('cashscript').Utxo;
    frontendFeeAddress?: string;
    minerFeeSats?: string | number | bigint;
}

export interface BuildManageRequest {
    userAddress: string;
    userTokenAddress: string;
    loanTokenId: string;
    actionType: 'add' | 'withdraw' | 'repay' | 'close';
    collateralDeltaSats?: string | number | bigint;
    repayCents?: string | number | bigint;
    userBchUtxos: import('cashscript').Utxo[];
    userPusdUtxos?: import('cashscript').Utxo[];
    loanKeyUtxo: import('cashscript').Utxo;
    minerFeeSats?: string | number | bigint;
}

export interface BuildChangeRateRequest {
    userAddress: string;
    userTokenAddress: string;
    loanTokenId: string;
    nextRate: number;
    userBchUtxos: import('cashscript').Utxo[];
    loanKeyUtxo: import('cashscript').Utxo;
    minerFeeSats?: string | number | bigint;
}

export interface BroadcastRequest {
    txHex: string;
}

export interface LoanActivity {
    type: 'borrow' | 'add' | 'withdraw' | 'repay' | 'close' | 'rate' | 'manage';
    txid: string;
    timestamp: number;
    details?: Record<string, unknown>;
}

export interface TrackedLoan {
    loanTokenId: string;
    userAddress: string;
    userTokenAddress: string;
    createdAt: number;
    updatedAt: number;
    initialBorrowCents: string;
    initialCollateralSats: string;
    lastKnownDebtCents?: string;
    lastKnownCollateralSats?: string;
    status: 'active' | 'closed';
    activity: LoanActivity[];
}

export interface PrepareBorrowRequest {
    userAddress: string;
    userTokenAddress: string;
    borrowCents: string | number;
    collateralSats?: string | number;
    startingRate?: number;
    userUtxos?: import('cashscript').Utxo[];
    frontendFeeAddress?: string;
}

export interface PrepareBorrowResponse {
    loanTokenId: string;
    steps: Array<{
        step: number;
        name: 'create_loan_key' | 'borrow';
        txHex: string;
        txid: string;
        wcPayload: any;
    }>;
}

export interface PrepareManageRequest {
    userAddress: string;
    userTokenAddress: string;
    loanTokenId: string;
    actionType: 'add' | 'withdraw' | 'repay' | 'close';
    collateralDeltaSats?: string | number;
    repayCents?: string | number;
    userUtxos?: import('cashscript').Utxo[];
    loanKeyUtxo?: import('cashscript').Utxo;
}

export interface PrepareManageResponse {
    loanTokenId: string;
    txHex: string;
    txid: string;
    wcPayload: any;
}

export interface PrepareRateRequest {
    userAddress: string;
    userTokenAddress: string;
    loanTokenId: string;
    nextRate: number;
    userUtxos?: import('cashscript').Utxo[];
    loanKeyUtxo?: import('cashscript').Utxo;
}

export interface PrepareRateResponse {
    loanTokenId: string;
    txHex: string;
    txid: string;
    wcPayload: any;
}

export interface SubmitRequest {
    kind: 'borrow' | 'manage' | 'rate';
    signedTxs: string[];
    loanTokenId?: string;
    userAddress?: string;
    userTokenAddress?: string;
    borrowCents?: string;
    collateralSats?: string;
}

export interface SubmitResponse {
    txids: string[];
    loanTokenId?: string;
}
