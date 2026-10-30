import type { ChainConfig } from '../config.js';
import type { BuiltTx, BurnCheck, FeeCheck, MintCheck, MintResult, Transfer } from '../types.js';

export interface BuildBurnParams {
    owner: string;               // source wallet
    amount: bigint;
    dstDomain: number;
    mintRecipient: string;       // bytes32 hex
    maxFee: bigint;
    minFinalityThreshold: number;
    fee?: { recipient: string; amount: bigint };   // our fee: EVM adds a transfer tx, Solana adds a transfer instruction
}

export interface ChainAdapter {
    readonly chain: ChainConfig;

    /** Is `a` a valid wallet address on this chain? */
    validateAddress(a: string): boolean;
    isValidTxHash(h: string): boolean;
    /** bytes32 mintRecipient when this chain is the destination (Solana: the wallet's USDC token account). */
    mintRecipientFor(wallet: string): { mintRecipient: string; tokenAccount?: string };

    /** Source side. */
    buildBurn(p: BuildBurnParams): Promise<BuiltTx[]>;
    checkBurn(txHash: string, hint?: { eventAccount?: string }): Promise<BurnCheck>;
    minFeeAmount(amount: bigint): Promise<bigint>;
    /** Did `txHash` move at least `amount` USDC from `from` to `to` on this chain? */
    checkFee(txHash: string, f: { from: string; to: string; amount: bigint }): Promise<FeeCheck>;
    /** Make sure `owner` can receive USDC here (Solana: create its token account, paid by the relayer). */
    ensureUsdcAccount?(owner: string): Promise<void>;

    /** Destination side. */
    prepareMint?(t: Transfer): Promise<void>;
    isNonceUsed(nonce: string): Promise<boolean>;
    mint(m: { message: string; attestation: string }, onSent: (txHash: string) => void): Promise<MintResult>;
    checkMint(txHash: string): Promise<MintCheck>;

    /** Ops. */
    relayerAddress(): string | undefined;
    relayerBalance(): Promise<{ amount: string; symbol: string }>;
    usdcBalance(wallet: string): Promise<bigint>;
}

export type MintErrorKind = 'nonce_used' | 'expired' | 'bad_attestation' | 'transient';

export class MintError extends Error {
    constructor(message: string, public kind: MintErrorKind) { super(message); }
}

export function classifyMintError(msg: string): MintErrorKind {
    if (/nonce already used|already in use|NonceAlreadyUsed/i.test(msg)) return 'nonce_used';
    if (/expired/i.test(msg)) return 'expired';
    if (/invalid attestation|invalid signature|not attester|InvalidAttestation|InvalidSignature/i.test(msg)) return 'bad_attestation';
    return 'transient';
}
