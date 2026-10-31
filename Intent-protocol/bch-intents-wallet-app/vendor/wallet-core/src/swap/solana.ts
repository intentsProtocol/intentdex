/**
 * Solana swaps through the swap server and Jupiter (mainnet), without React.
 * Ported from frontend/src/swap-server/solana.ts.
 *
 * A token is identified by its mint, never by its symbol: copies of popular tokens share symbols. Amounts go to
 * the server as integer base units of the input token.
 */
import { SwapServerError, type SwapServerApi } from './api';
import { toBase64 } from './encoding';
import type { SignedSolanaTx } from './flows';
import type { SolanaSwap } from './types';

export type SwapStage = 'create' | 'sign' | 'landing';

export interface SwapDeps {
    api: Pick<SwapServerApi, 'createSolSwap' | 'executeSolSwap' | 'getSolSwap'>;
    /** Add the wallet's signature to Jupiter's transaction. */
    sign(base64Tx: string): SignedSolanaTx | Promise<SignedSolanaTx>;
    onStage?: (stage: SwapStage, swap?: SolanaSwap) => void;
    pollMs?: number;
    /** Give up polling an unknown result after this long; the activity row keeps following it. */
    pollTimeoutMs?: number;
}

/**
 * Create the swap, sign Jupiter's transaction and hand it back for execution. The wallet signs and never sends.
 * RESULT_UNKNOWN means the swap may still land: it is polled, and a second swap is never created.
 */
export async function runSolanaSwap(
    input: { inputMint: string; outputMint: string; amount: string; taker: string; slippageBps?: number }, deps: SwapDeps,
): Promise<SolanaSwap> {
    deps.onStage?.('create');
    const { swap, tx } = await deps.api.createSolSwap(input);
    deps.onStage?.('sign', swap);
    const signed = toBase64((await deps.sign(tx.serializedTx)).raw);
    deps.onStage?.('landing', swap);
    try {
        return await deps.api.executeSolSwap(swap.id, signed);
    } catch (e) {
        if (!(e instanceof SwapServerError) || (e.code !== 'RESULT_UNKNOWN' && e.code !== 'IN_PROGRESS')) throw e;
        const deadline = Date.now() + (deps.pollTimeoutMs ?? 180_000);
        for (;;) {
            await new Promise(r => setTimeout(r, deps.pollMs ?? 3000));
            const s = await deps.api.getSolSwap(swap.id).catch(() => undefined);
            if (s?.terminal) return s;
            if (Date.now() > deadline) return s ?? swap;
        }
    }
}
