/**
 * TxDelta — exact per-transaction profit measurement.
 *
 * Replaces the balance-snapshot approach the ProfitLedger used to rely on.
 *
 * Snapshotting total wallet balance before and after a fill only works when
 * nothing else touches the wallet in between. With SOLVER_CONCURRENCY > 1 that is
 * never true: a stress run of 12 concurrent fills reported 4,427,058 sats
 * "realized" against roughly 84,000 actual — a 50x overstatement — because each
 * snapshot caught other in-flight fills' inputs and change. The same approach also
 * *understated* a single TOKEN_TO_BCH fill by 99% (4,784 against a real 523,239),
 * because the snapshot landed after the rebalance had spent the fill's outputs but
 * before its own output propagated.
 *
 * Decoding the transactions is immune to both: a transaction's effect on a set of
 * addresses is a property of the transaction, not of when you look at the wallet.
 */
import type { ElectrumNetworkProvider } from 'cashscript';
import { decodeTransaction, hexToBin, binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';

export interface TxDeltaResult {
    txid: string;
    /** Net satoshis to the tracked addresses (outputs to − inputs from). */
    netSats: bigint;
    /** Net token movement per category, same sign convention. */
    tokenDeltas: Map<string, bigint>;
    /** True when at least one input's parent transaction could not be fetched. */
    incomplete: boolean;
}

/** Convert cashaddrs to the locking-bytecode hexes used for output matching. */
export function lockingSet(addresses: Array<string | undefined | null>): Set<string> {
    const out = new Set<string>();
    for (const a of addresses) {
        if (!a) continue;
        const r = cashAddressToLockingBytecode(a);
        if (typeof r !== 'string') out.add(binToHex(r.bytecode));
    }
    return out;
}

/**
 * Net effect of one transaction on the given locking scripts.
 *
 * Requires the parent transaction of each input to attribute the input side, so
 * this costs 1 + inputCount Electrum fetches. Cheap relative to a fill, and it runs
 * after the fill is already broadcast.
 */
export async function txDelta(
    provider: ElectrumNetworkProvider,
    txid: string,
    mine: Set<string>,
    parentCache?: Map<string, string>,
): Promise<TxDeltaResult> {
    const tokenDeltas = new Map<string, bigint>();
    const bump = (cat: string, d: bigint) => tokenDeltas.set(cat, (tokenDeltas.get(cat) ?? 0n) + d);

    const raw = await provider.getRawTransaction(txid);
    const tx = decodeTransaction(hexToBin(raw));
    if (typeof tx === 'string') throw new Error(`decode failed for ${txid}: ${tx}`);

    let outs = 0n;
    for (const o of tx.outputs) {
        if (!mine.has(binToHex(o.lockingBytecode))) continue;
        outs += o.valueSatoshis;
        if (o.token) bump(binToHex(o.token.category), o.token.amount);
    }

    let ins = 0n;
    let incomplete = false;
    for (const i of tx.inputs) {
        const ptxid = binToHex(i.outpointTransactionHash);
        try {
            let praw = parentCache?.get(ptxid);
            if (!praw) {
                praw = await provider.getRawTransaction(ptxid);
                parentCache?.set(ptxid, praw);
            }
            const ptx = decodeTransaction(hexToBin(praw));
            if (typeof ptx === 'string') { incomplete = true; continue; }
            const po = ptx.outputs[i.outpointIndex];
            if (!po || !mine.has(binToHex(po.lockingBytecode))) continue;
            ins += po.valueSatoshis;
            if (po.token) bump(binToHex(po.token.category), -po.token.amount);
        } catch {
            incomplete = true;
        }
    }

    return { txid, netSats: outs - ins, tokenDeltas, incomplete };
}

/**
 * Combined net effect of every transaction in a fill (pre-fill, fill, rebalance).
 *
 * Summing the legs is what makes the figure meaningful: a TOKEN_TO_BCH fill is
 * BCH-negative on its own (it pays the maker and receives tokens) and only turns
 * positive once the rebalance sells those tokens back. Measuring either leg alone
 * is guaranteed to mislead.
 */
export async function combinedDelta(
    provider: ElectrumNetworkProvider,
    txids: Array<string | undefined>,
    mine: Set<string>,
): Promise<{ netSats: bigint; tokenDeltas: Map<string, bigint>; legs: TxDeltaResult[]; incomplete: boolean }> {
    const parentCache = new Map<string, string>();
    const legs: TxDeltaResult[] = [];
    for (const t of txids) {
        if (!t) continue;
        legs.push(await txDelta(provider, t, mine, parentCache));
    }
    const tokenDeltas = new Map<string, bigint>();
    let netSats = 0n;
    let incomplete = false;
    for (const l of legs) {
        netSats += l.netSats;
        incomplete = incomplete || l.incomplete;
        for (const [cat, d] of l.tokenDeltas) tokenDeltas.set(cat, (tokenDeltas.get(cat) ?? 0n) + d);
    }
    return { netSats, tokenDeltas, legs, incomplete };
}
