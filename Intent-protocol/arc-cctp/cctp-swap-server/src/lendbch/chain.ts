/**
 * lendbch chain client — all Electrum reads for the read layer, with the health-check-and-reconnect discipline the
 * relayer taught us (see the "electrum wedge" lesson: a shared cashscript provider can silently die into a
 * permanent "disconnected server" state, and calling `disconnect()` throws when connection management is automatic).
 *
 * So instead of reusing one wedged provider forever, this client times every request, and when a request errors or
 * hangs it throws the old provider away and builds a fresh one on the next call. Nothing here signs or broadcasts.
 */
import { ElectrumNetworkProvider, Network, type Utxo } from 'cashscript';
import type { LendBchNetwork } from './types.js';

const NETWORK: Record<LendBchNetwork, Network> = { mainnet: Network.MAINNET, chipnet: Network.CHIPNET };

export interface ChainHealth {
    ok: boolean;
    blockHeight: number | null;
    lastError: string | null;
    lastOkAt: number | null;
    reconnects: number;
}

/** Wrap a promise in a timeout so a wedged socket can't hang a request forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
}

export class ChainClient {
    readonly network: LendBchNetwork;
    private provider: ElectrumNetworkProvider;
    private timeoutMs: number;
    private health: ChainHealth = { ok: false, blockHeight: null, lastError: null, lastOkAt: null, reconnects: 0 };

    constructor(network: LendBchNetwork, opts: { timeoutMs?: number } = {}) {
        this.network = network;
        // Chipnet Electrum is markedly slower than mainnet (busy-address getUtxos scans can run well past 15s),
        // so give it more headroom; mainnet keeps the tighter bound.
        this.timeoutMs = opts.timeoutMs ?? (network === 'chipnet' ? 40_000 : 15_000);
        this.provider = new ElectrumNetworkProvider(NETWORK[network]);
    }

    /** The current cashscript provider, for the derivation in deployment.ts (no network call needed). */
    getProvider(): ElectrumNetworkProvider {
        return this.provider;
    }

    getHealth(): ChainHealth {
        return { ...this.health };
    }

    /** Drop the wedged provider and build a fresh one; the next request uses it. */
    private reconnect(): void {
        this.provider = new ElectrumNetworkProvider(NETWORK[this.network]);
        this.health.reconnects += 1;
    }

    /** Run a provider call with a timeout; on failure, rebuild the provider and retry once. */
    private async call<T>(label: string, fn: (p: ElectrumNetworkProvider) => Promise<T>): Promise<T> {
        try {
            const out = await withTimeout(fn(this.provider), this.timeoutMs, label);
            this.health = { ...this.health, ok: true, lastError: null, lastOkAt: Date.now() };
            return out;
        } catch (first) {
            this.reconnect();
            try {
                const out = await withTimeout(fn(this.provider), this.timeoutMs, label);
                this.health = { ...this.health, ok: true, lastError: null, lastOkAt: Date.now() };
                return out;
            } catch (second) {
                this.health = { ...this.health, ok: false, lastError: (second as Error).message };
                throw second;
            }
        }
    }

    async getBlockHeight(): Promise<number> {
        const h = await this.call('getBlockHeight', p => p.getBlockHeight());
        this.health.blockHeight = h;
        return h;
    }

    async getUtxos(address: string): Promise<Utxo[]> {
        return this.call(`getUtxos(${address.slice(0, 16)}…)`, p => p.getUtxos(address));
    }

    /** A verbose raw transaction (Electrum `blockchain.transaction.get` with verbose=true), for setup verification. */
    async getRawTransaction(txid: string): Promise<any> {
        return this.call(`getRawTransaction(${txid.slice(0, 12)}…)`, p => p.performRequest('blockchain.transaction.get', txid, true) as Promise<any>);
    }

    /** Broadcast a raw transaction hex string to the network. */
    async broadcast(txHex: string): Promise<string> {
        return this.call('broadcast', p => p.performRequest('blockchain.transaction.broadcast', txHex) as Promise<string>);
    }
}

/** A UTXO holds a thread of this contract: it carries a mutable or minting NFT of `category`. */
export function isThreadUtxo(u: Utxo, category: string): boolean {
    return u.token?.category === category && (u.token.nft?.capability === 'mutable' || u.token.nft?.capability === 'minting');
}

/** Pick a random thread UTXO (the builders retry on another if a broadcast conflicts). Null if none. */
export function pickThread(utxos: Utxo[], category: string): Utxo | null {
    const threads = utxos.filter(u => isThreadUtxo(u, category));
    if (!threads.length) return null;
    return threads[Math.floor(Math.random() * threads.length)];
}

/**
 * Normalizes a UTXO (e.g. from JSON HTTP body or Electrum) to ensure satoshis and token amounts are BigInt.
 */
export function normalizeUtxo(u: any): Utxo {
    if (!u) return u;
    return {
        txid: u.txid,
        vout: Number(u.vout),
        satoshis: BigInt(u.satoshis ?? 0),
        token: u.token ? {
            category: u.token.category,
            amount: BigInt(u.token.amount ?? 0),
            nft: u.token.nft ? {
                capability: u.token.nft.capability,
                commitment: u.token.nft.commitment ?? '',
            } : undefined,
        } : undefined,
    };
}
