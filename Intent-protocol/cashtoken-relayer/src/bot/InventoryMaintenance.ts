/**
 * InventoryMaintenance — keep the solver's token UTXOs spendable.
 *
 * A DIRECT (inventory) fill has to pay its fee from the token UTXO's own sats,
 * because the covenant enforces exactly 2 inputs. So a token UTXO carrying fewer
 * than `MIN_TOKEN_UTXO_DUST_SATS` is real inventory that cannot actually be used —
 * every intent for that token has to detour through a Cauldron pre-fill instead,
 * paying an extra transaction, swap fee, LP fee and mempool wait.
 *
 * The executor now mints token change at the shared floor, so fills are
 * self-sustaining going forward. This module handles the two things that fix
 * cannot:
 *
 *   1. `summarize()` — report which holdings are actually DIRECT-usable, so the
 *      difference between "14444 units" and "14444 unusable units" is visible
 *      rather than silently misleading.
 *   2. `redust()` — repair a backlog of already-starved UTXOs by consolidating
 *      each token into one UTXO topped up above the floor.
 *
 * Read-only by default; `redust()` is the only function that broadcasts.
 */
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import type { ElectrumNetworkProvider } from 'cashscript';
import { ENV } from '../config.js';
import { filterAvailable, reserveOutpoint } from './UtxoReservation.js';

export interface TokenHolding {
    tokenId: string;
    /** Total units held, across every UTXO. */
    units: bigint;
    /** Units sitting on UTXOs that carry enough dust for a DIRECT fill. */
    usableUnits: bigint;
    utxoCount: number;
    usableUtxoCount: number;
    /** Largest single-UTXO unit balance that is DIRECT-usable — the real fill ceiling. */
    largestUsableUnits: bigint;
}

export interface InventorySummary {
    dustFloorSats: bigint;
    holdings: TokenHolding[];
    /** Tokens held in quantity but with nothing DIRECT-usable — the starved set. */
    starvedTokenIds: string[];
}

interface WalletAddrs { cashaddr: string; tokenaddr: string }

async function dedupedUtxos(provider: ElectrumNetworkProvider, w: WalletAddrs): Promise<any[]> {
    const seen = new Set<string>();
    const [a, b] = await Promise.all([
        provider.getUtxos(w.cashaddr),
        provider.getUtxos(w.tokenaddr),
    ]);
    return [...a, ...b].filter((u: any) => {
        const k = `${u.txid}:${u.vout}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** Classify the solver's token holdings by DIRECT-fill usability. Read-only. */
export async function summarize(
    provider: ElectrumNetworkProvider,
    wallet: WalletAddrs,
    dustFloorSats: bigint = ENV.MIN_TOKEN_UTXO_DUST_SATS,
): Promise<InventorySummary> {
    const utxos = await dedupedUtxos(provider, wallet);
    const byToken = new Map<string, any[]>();
    for (const u of utxos) {
        if (!u.token?.category) continue;
        const list = byToken.get(u.token.category) ?? [];
        list.push(u);
        byToken.set(u.token.category, list);
    }

    const holdings: TokenHolding[] = [];
    for (const [tokenId, list] of byToken) {
        const usable = list.filter(u => BigInt(u.satoshis) >= dustFloorSats);
        holdings.push({
            tokenId,
            units:       list.reduce((s, u) => s + BigInt(u.token.amount), 0n),
            usableUnits: usable.reduce((s, u) => s + BigInt(u.token.amount), 0n),
            utxoCount: list.length,
            usableUtxoCount: usable.length,
            largestUsableUnits: usable.reduce(
                (m, u) => (BigInt(u.token.amount) > m ? BigInt(u.token.amount) : m), 0n),
        });
    }
    holdings.sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0));

    return {
        dustFloorSats,
        holdings,
        starvedTokenIds: holdings.filter(h => h.units > 0n && h.usableUnits === 0n).map(h => h.tokenId),
    };
}

export interface RedustResult {
    tokenId: string;
    txid?: string;
    consumedOutpoints: string[];
    unitsConsolidated: bigint;
    satsAttached: bigint;
    skipped?: string;
}

/**
 * Consolidate one token's UTXOs into a single UTXO carrying `targetSats`, so the
 * DIRECT route becomes available again.
 *
 * BROADCASTS a transaction. Spends the token UTXOs for `tokenId` plus one plain BCH
 * UTXO to supply the dust and fee.
 */
export async function redustToken(
    provider: ElectrumNetworkProvider,
    wallet: WalletAddrs & { privateKeyWif: string; publicKeyHash: Uint8Array },
    tokenId: string,
    targetSats: bigint = ENV.MIN_TOKEN_UTXO_DUST_SATS * 2n,
): Promise<RedustResult> {
    const sig = new SignatureTemplate(wallet.privateKeyWif);
    const p2pkh = Uint8Array.from([0x76, 0xa9, 0x14, ...wallet.publicKeyHash, 0x88, 0xac]);
    const FEE = 2000n;

    const all = filterAvailable(await dedupedUtxos(provider, wallet));
    const tokenUtxos = all.filter((u: any) => u.token?.category === tokenId);
    if (tokenUtxos.length === 0) {
        return { tokenId, consumedOutpoints: [], unitsConsolidated: 0n, satsAttached: 0n, skipped: 'no UTXOs for this token' };
    }

    const units = tokenUtxos.reduce((s: bigint, u: any) => s + BigInt(u.token.amount), 0n);
    const tokenSats = tokenUtxos.reduce((s: bigint, u: any) => s + BigInt(u.satoshis), 0n);

    // Already fine — don't churn a transaction (and a fee) for nothing.
    if (tokenUtxos.length === 1 && BigInt(tokenUtxos[0].satoshis) >= ENV.MIN_TOKEN_UTXO_DUST_SATS) {
        return { tokenId, consumedOutpoints: [], unitsConsolidated: units, satsAttached: tokenSats, skipped: 'already consolidated above the dust floor' };
    }

    const needFromBch = targetSats + FEE > tokenSats ? targetSats + FEE - tokenSats : 0n;
    const bchUtxos = all
        .filter((u: any) => !u.token)
        .sort((a: any, b: any) => Number(BigInt(b.satoshis) - BigInt(a.satoshis)));
    const funder: any = bchUtxos.find((u: any) => BigInt(u.satoshis) >= needFromBch + 546n);
    if (needFromBch > 0n && !funder) {
        return { tokenId, consumedOutpoints: [], unitsConsolidated: units, satsAttached: 0n, skipped: `no BCH UTXO covering ${needFromBch} sats of top-up` };
    }

    const tb = new TransactionBuilder({ provider });
    const consumed: string[] = [];
    for (const u of tokenUtxos) {
        tb.addInput(
            { txid: u.txid, vout: u.vout, satoshis: BigInt(u.satoshis), token: { amount: BigInt(u.token.amount), category: tokenId } },
            sig.unlockP2PKH(),
        );
        consumed.push(`${u.txid}:${u.vout}`);
    }
    let inputSats = tokenSats;
    if (funder) {
        tb.addInput({ txid: funder.txid, vout: funder.vout, satoshis: BigInt(funder.satoshis) }, sig.unlockP2PKH());
        consumed.push(`${funder.txid}:${funder.vout}`);
        inputSats += BigInt(funder.satoshis);
    }

    // Output 0: the whole token balance on a comfortably-dusted UTXO.
    tb.addOutput({ to: p2pkh, amount: targetSats, token: { amount: units, category: tokenId } });
    // Output 1: BCH change.
    const change = inputSats - targetSats - FEE;
    if (change >= 546n) tb.addOutput({ to: p2pkh, amount: change });

    const res = await tb.send();
    for (const op of consumed) reserveOutpoint(op);
    return { tokenId, txid: res.txid, consumedOutpoints: consumed, unitsConsolidated: units, satsAttached: targetSats };
}

/** Re-dust every starved token. BROADCASTS one transaction per token. */
export async function redustStarved(
    provider: ElectrumNetworkProvider,
    wallet: WalletAddrs & { privateKeyWif: string; publicKeyHash: Uint8Array },
    opts: { tokenIds?: string[]; targetSats?: bigint } = {},
): Promise<RedustResult[]> {
    const summary = await summarize(provider, wallet);
    const targets = opts.tokenIds ?? summary.starvedTokenIds;
    const out: RedustResult[] = [];
    for (const tokenId of targets) {
        try {
            out.push(await redustToken(provider, wallet, tokenId, opts.targetSats));
        } catch (e: any) {
            out.push({ tokenId, consumedOutpoints: [], unitsConsolidated: 0n, satsAttached: 0n, skipped: `failed: ${e.message}` });
        }
    }
    return out;
}
