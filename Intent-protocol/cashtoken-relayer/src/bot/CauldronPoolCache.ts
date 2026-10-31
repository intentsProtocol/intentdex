import { createHash } from 'crypto';
import type { PoolV0 } from '@cashlab/cauldron';
import { buildPoolV0RedeemScriptBytecode } from '@cashlab/cauldron/binutil.js';

// ── Indexer base URLs ────────────────────────────────────────────────────────
const MAINNET_INDEXER = process.env.CAULDRON_INDEXER_URL        ?? 'https://indexer.riften.net';
const CHIPNET_INDEXER = process.env.CAULDRON_CHIPNET_INDEXER_URL ?? 'https://indexer-chipnet.riften.net';

// Limit pool fetch on mainnet to top N by TVL (chipnet fetches all)
const MAINNET_POOL_LIMIT = 150;

// ── CauldronPoolCache ─────────────────────────────────────────────────────────

export class CauldronPoolCache {
    private pools: PoolV0[] = [];
    /**
     * token category → TVL in sats, as reported by the indexer's token list.
     *
     * The refresh already fetches TVL in order to rank tokens, and used to throw it
     * away. Retaining it lets the fill whitelist be *derived* (auto-admit any token
     * whose pool is deep enough) instead of hand-maintained, which is what
     * InventoryConfig's docstring always claimed happened.
     */
    private tokenTvl = new Map<string, bigint>();
    private lastFetchMs = 0;
    private readonly TTL_MS = 30_000;

    constructor(
        readonly indexerBaseUrl: string = MAINNET_INDEXER,
        private readonly poolLimit: number = MAINNET_POOL_LIMIT,
    ) {}

    static forNetwork(network: 'mainnet' | 'chipnet'): CauldronPoolCache {
        return network === 'chipnet'
            ? new CauldronPoolCache(CHIPNET_INDEXER, 0)  // 0 = no limit (chipnet is small)
            : new CauldronPoolCache(MAINNET_INDEXER, MAINNET_POOL_LIMIT);
    }

    async getPools(): Promise<PoolV0[]> {
        if (Date.now() - this.lastFetchMs < this.TTL_MS && this.pools.length > 0) {
            return this.pools;
        }
        await this.refresh();
        return this.pools;
    }

    async refresh(): Promise<void> {
        if (!this.indexerBaseUrl) return;
        try {
            // Step 1: get token list sorted by TVL
            const tokensRes = await fetch(`${this.indexerBaseUrl}/cauldron/tokens/list_cached`);
            if (!tokensRes.ok) {
                console.warn(`[CauldronPoolCache] tokens/list_cached → ${tokensRes.status} (${this.indexerBaseUrl})`);
                return;
            }
            let tokens: Array<{ token_id: string; tvl_sats: number }> = await tokensRes.json();
            // Sort by TVL descending, apply limit if set
            tokens = tokens.sort((a, b) => b.tvl_sats - a.tvl_sats);
            if (this.poolLimit > 0) tokens = tokens.slice(0, this.poolLimit);

            // Keep the TVL figures — the derived fill whitelist needs them.
            const tvl = new Map<string, bigint>();
            for (const t of tokens) {
                tvl.set(t.token_id, BigInt(Math.max(0, Math.floor(t.tvl_sats ?? 0))));
            }

            // Step 2: fetch pool UTXOs for each token (parallel, capped at 10 concurrent)
            const allPools: PoolV0[] = [];
            const CHUNK = 10;
            for (let i = 0; i < tokens.length; i += CHUNK) {
                const chunk = tokens.slice(i, i + CHUNK);
                const results = await Promise.allSettled(
                    chunk.map(t => this.fetchPoolsForToken(t.token_id))
                );
                for (const r of results) {
                    if (r.status === 'fulfilled') allPools.push(...r.value);
                }
            }

            this.pools = allPools;
            this.tokenTvl = tvl;
            this.lastFetchMs = Date.now();
            console.log(`[CauldronPoolCache] ${this.pools.length} pool UTXOs across ${tvl.size} tokens from ${this.indexerBaseUrl}`);
        } catch (e: any) {
            console.warn(`[CauldronPoolCache] refresh failed: ${e.message}`);
        }
    }

    /** Fetch and build PoolV0 objects for a single token category. */
    async fetchPoolsForToken(tokenId: string): Promise<PoolV0[]> {
        const res = await fetch(`${this.indexerBaseUrl}/cauldron/pool/active?token=${tokenId}`);
        if (!res.ok) return [];
        const body: { active?: RawPoolActive[] } = await res.json();
        return (body.active ?? []).map(p => parseRawPoolActive(p, tokenId));
    }

    getPoolsForPair(supplyId: string, demandId: string): PoolV0[] {
        const tokenId = supplyId === 'BCH' ? demandId : supplyId;
        return this.pools.filter(p => p.output.token.token_id === tokenId);
    }

    /** Returns all unique token category IDs that have at least one active pool. */
    getTokensWithPools(): string[] {
        return [...new Set(this.pools.map(p => p.output.token.token_id))];
    }

    /** Indexer-reported pool TVL (sats) for a token, or 0 if unknown. */
    getTokenTvl(tokenId: string): bigint {
        return this.tokenTvl.get(tokenId) ?? 0n;
    }

    /**
     * Token categories with at least one active pool AND indexer TVL ≥ minTvlSats.
     *
     * This is the input to the derived fill whitelist. A token whose pool is too
     * shallow can technically be routed but only at ruinous slippage, so filtering
     * here is cheaper than letting ProfitPolicy reject it on every scan cycle.
     */
    getTokensWithPoolsAboveTvl(minTvlSats: bigint): string[] {
        return this.getTokensWithPools().filter(id => this.getTokenTvl(id) >= minTvlSats);
    }

    getPoolCount(): number { return this.pools.length; }
    getLastFetchAge(): number { return Date.now() - this.lastFetchMs; }
}

// ── Raw API types ─────────────────────────────────────────────────────────────

interface RawPoolActive {
    owner_pkh: string;      // 20-byte hex
    sats: number;           // BCH satoshis in pool
    tokens: number;         // token units in pool
    token_id: string;       // token category hex
    txid: string;           // outpoint txid
    tx_pos: number;         // outpoint index
    pool_id?: string;
}

// ── PoolV0 builder ────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Uint8Array.from(Buffer.from(clean, 'hex'));
}

/**
 * Build the P2SH32 locking bytecode for a PoolV0 UTXO from the owner PKH.
 *
 * P2SH32 locking script = OP_HASH256 <sha256d(redeemScript)> OP_EQUAL
 *                        = 0xaa 0x20 <32 bytes> 0x87
 */
function buildPoolV0LockingBytecode(ownerPkh: Uint8Array): Uint8Array {
    const redeemScript = buildPoolV0RedeemScriptBytecode({ withdraw_pubkey_hash: ownerPkh });
    const hash = sha256d(redeemScript);
    return Uint8Array.from([0xaa, 0x20, ...hash, 0x87]);
}

function sha256d(data: Uint8Array): Buffer {
    const first  = createHash('sha256').update(data).digest();
    return createHash('sha256').update(first).digest();
}

function parseRawPoolActive(raw: RawPoolActive, tokenId: string): PoolV0 {
    const ownerPkh       = hexToBytes(raw.owner_pkh);
    const lockingBytecode = buildPoolV0LockingBytecode(ownerPkh);
    return {
        version: '0',
        parameters: { withdraw_pubkey_hash: ownerPkh },
        outpoint: {
            txhash: hexToBytes(raw.txid),
            index:  raw.tx_pos,
        },
        output: {
            locking_bytecode: lockingBytecode,
            token: { amount: BigInt(raw.tokens), token_id: tokenId },
            amount: BigInt(raw.sats),
        },
    };
}
