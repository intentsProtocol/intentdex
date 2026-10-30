/**
 * quote.ts — fee / maxFee / receive amount / ETA / speed selection.
 * computeQuote() is pure (unit-tested); QuoteService fetches its inputs.
 */
import type { ChainConfig } from '../config.js';
import { config } from '../config.js';
import { FINALITY, HttpError, type Quote, type Speed, type SpeedPref } from '../types.js';
import { ceilDiv, formatUsdc, parseUsdc } from './encoding.js';
import type { IrisApi, IrisFee } from './iris.js';

export interface QuoteInputs {
    src: ChainConfig;
    dst: ChainConfig;
    amount: bigint;
    pref: SpeedPref;
    fees: IrisFee[];
    fastAllowanceUsdc: number | null;   // null = unknown (Iris unreachable)
    onchainMinFee: bigint;              // TokenMessenger minimum for this amount (0 when none)
    feeBufferPct?: number;
    standardFastEnoughSec?: number;
    mintOverheadSec?: number;
    minTransfer?: bigint;
    maxTransfer?: bigint;
    protocolFee?: bigint;               // our fee, taken out of `amount` before the burn
    feeRecipient?: string;
}

/** Fee for `amount` at `bps` (bps may be fractional, e.g. 1.3), rounded up to the next base unit. */
export function feeForBps(amount: bigint, bps: number): bigint {
    const centiBps = BigInt(Math.round(bps * 100));
    if (centiBps <= 0n) return 0n;
    return ceilDiv(amount * centiBps, 1_000_000n);
}

export function chooseSpeed(
    src: ChainConfig, pref: SpeedPref, amount: bigint, fastAllowanceUsdc: number | null, standardFastEnoughSec: number,
): { speed: Speed; allowanceOk?: boolean } {
    const allowanceOk = fastAllowanceUsdc === null ? undefined : fastAllowanceUsdc * 1e6 >= Number(amount);
    if (pref === 'fast') {
        if (!src.fastSource) throw new HttpError(400, `${src.name} is not a Fast Transfer source; use speed=standard or auto`, 'FAST_UNAVAILABLE');
        if (allowanceOk === false) throw new HttpError(409, 'Circle Fast Transfer allowance is too low for this amount; use speed=standard', 'FAST_UNAVAILABLE');
        return { speed: 'fast', allowanceOk };
    }
    if (pref === 'standard') return { speed: 'standard', allowanceOk };
    // auto: Standard when it is already quick (Arc ~0.5 s, Solana ~25 s); otherwise Fast if allowed.
    if (src.standardEtaSec <= standardFastEnoughSec || !src.fastSource) return { speed: 'standard', allowanceOk };
    if (allowanceOk === false) return { speed: 'standard', allowanceOk };
    return { speed: 'fast', allowanceOk };
}

export function computeQuote(q: QuoteInputs): Quote {
    const buffer = q.feeBufferPct ?? config.quote.feeBufferPct;
    const minT = q.minTransfer ?? parseUsdc(config.limits.minTransferUsdc);
    const maxT = q.maxTransfer ?? parseUsdc(config.limits.maxTransferUsdc);

    if (q.src.key === q.dst.key) throw new HttpError(400, 'source and destination chains must differ', 'SAME_CHAIN');
    if (q.amount < minT) throw new HttpError(400, `amount below minimum ${formatUsdc(minT)} USDC`, 'BELOW_MINIMUM');
    if (q.amount > maxT) throw new HttpError(400, `amount above maximum ${formatUsdc(maxT)} USDC`, 'ABOVE_MAXIMUM');

    const { speed, allowanceOk } = chooseSpeed(
        q.src, q.pref, q.amount, q.fastAllowanceUsdc, q.standardFastEnoughSec ?? config.quote.standardFastEnoughSec);
    const threshold = FINALITY[speed];

    const feeRow = q.fees.find(f => f.finalityThreshold === threshold);
    if (!feeRow) throw new HttpError(502, `Iris returned no fee for finality ${threshold}`);

    const protocolFee = q.protocolFee ?? 0n;
    if (protocolFee >= q.amount) throw new HttpError(400, 'amount too small to cover the service fee', 'AMOUNT_TOO_SMALL');
    const burnAmount = q.amount - protocolFee;
    const bpsFee = feeForBps(burnAmount, feeRow.minimumFee);
    const expectedFee = bpsFee > q.onchainMinFee ? bpsFee : q.onchainMinFee;
    let maxFee = bpsFee > 0n ? ceilDiv(bpsFee * BigInt(100 + buffer), 100n) : 0n;
    if (maxFee < q.onchainMinFee) maxFee = q.onchainMinFee;
    if (maxFee >= burnAmount) throw new HttpError(400, 'amount too small to cover the transfer fee', 'AMOUNT_TOO_SMALL');

    const warnings: string[] = [];
    if (q.src.minMaxFeePerGasGwei) warnings.push(`Gas on ${q.src.name} is paid in USDC: keep a little USDC beyond the transfer amount.`);
    if (q.dst.kind === 'solana') warnings.push('The recipient USDC token account is created automatically if it does not exist.');
    if (speed === 'standard' && q.src.standardEtaSec > (q.standardFastEnoughSec ?? config.quote.standardFastEnoughSec)) {
        warnings.push(`Standard transfers from ${q.src.name} take about ${Math.round(q.src.standardEtaSec / 60)} minutes.`);
    }
    if (q.fastAllowanceUsdc === null && speed === 'fast') warnings.push('Could not read the Fast Transfer allowance; transfer may fall back to Standard timing.');

    const etaAttest = speed === 'fast' ? (q.src.fastEtaSec ?? q.src.standardEtaSec) : q.src.standardEtaSec;

    return {
        src: q.src.key,
        dst: q.dst.key,
        amount: q.amount.toString(),
        protocolFee: protocolFee.toString(),
        feeRecipient: protocolFee > 0n ? q.feeRecipient : undefined,
        burnAmount: burnAmount.toString(),
        speed,
        minFinalityThreshold: threshold,
        feeBps: feeRow.minimumFee,
        expectedFee: expectedFee.toString(),
        maxFee: maxFee.toString(),
        expectedReceive: (burnAmount - expectedFee).toString(),
        etaSec: etaAttest + (q.mintOverheadSec ?? config.quote.mintOverheadSec),
        fastAllowanceOk: allowanceOk,
        warnings,
    };
}

export interface MinFeeReader { minFeeAmount(amount: bigint): Promise<bigint> }

export class QuoteService {
    constructor(private iris: IrisApi, private minFeeReaders: Map<string, MinFeeReader>) {}

    /** `limits` carries the admin-set limits; without it the env defaults apply. */
    async quote(src: ChainConfig, dst: ChainConfig, amount: bigint, pref: SpeedPref,
                limits: { minTransferUsdc?: number; maxTransferUsdc?: number; feeBufferPct?: number } = {},
                fee?: { amount: bigint; recipient: string }): Promise<Quote> {
        if (src.key === dst.key) throw new HttpError(400, 'source and destination chains must differ', 'SAME_CHAIN');
        const [fees, allowance, minFee] = await Promise.all([
            this.iris.getFees(src.domain, dst.domain).catch(e => { throw new HttpError(502, `fee lookup failed: ${e.message}`); }),
            this.iris.getFastAllowance().catch(() => null),
            this.minFeeReaders.get(src.key)?.minFeeAmount(amount).catch(() => 0n) ?? Promise.resolve(0n),
        ]);
        return computeQuote({
            src, dst, amount, pref, fees, fastAllowanceUsdc: allowance, onchainMinFee: minFee,
            feeBufferPct: limits.feeBufferPct, protocolFee: fee?.amount, feeRecipient: fee?.recipient,
            minTransfer: limits.minTransferUsdc === undefined ? undefined : parseUsdc(limits.minTransferUsdc),
            maxTransfer: limits.maxTransferUsdc === undefined ? undefined : parseUsdc(limits.maxTransferUsdc),
        });
    }
}
