/** In-memory cached token catalog for 1Click NEAR Intents assets. */
import type { OneClickClient } from './OneClickClient.js';
import type { OneClickToken } from './types.js';
import { logger } from '../log.js';

const log = logger('bch-catalog');

// Well-known fallback tokens if initial network fetch is delayed
const DEFAULT_FALLBACK_TOKENS: OneClickToken[] = [
    {
        assetId: 'nep141:bch.omft.near',
        symbol: 'BCH',
        name: 'Bitcoin Cash',
        decimals: 8,
        chain: 'bch',
        icon: 'https://cryptologos.cc/logos/bitcoin-cash-bch-logo.svg',
    },
    {
        assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
        symbol: 'USDC',
        name: 'USD Coin (Base)',
        decimals: 6,
        chain: 'base',
        contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        icon: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
    },
    {
        assetId: 'nep141:arbitrum-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
        symbol: 'USDC',
        name: 'USD Coin (Arbitrum)',
        decimals: 6,
        chain: 'arbitrum',
        contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        icon: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
    },
    {
        assetId: 'nep141:solana-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.omft.near',
        symbol: 'USDC',
        name: 'USD Coin (Solana)',
        decimals: 6,
        chain: 'solana',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        icon: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
    },
    {
        assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
        symbol: 'USDC',
        name: 'USD Coin (Ethereum)',
        decimals: 6,
        chain: 'eth',
        contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        icon: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
    },
];

export class TokenCatalog {
    private client: OneClickClient;
    private tokens = new Map<string, OneClickToken>(); // key: normalized assetId
    private aliasMap = new Map<string, string>();     // key: chain:symbol -> assetId
    private refreshIntervalMs: number;
    private timer?: NodeJS.Timeout;
    private initialized = false;

    constructor(client: OneClickClient, refreshIntervalMin = 10) {
        this.client = client;
        this.refreshIntervalMs = Math.max(1, refreshIntervalMin) * 60_000;
        // Populate fallbacks immediately
        this.loadTokens(DEFAULT_FALLBACK_TOKENS);
    }

    private normalizeChain(chain: string): string {
        const c = chain.toLowerCase().trim();
        if (c === 'ethereum') return 'eth';
        if (c === 'bitcoin-cash' || c === 'bitcoincash') return 'bch';
        if (c === 'arbitrum') return 'arb';
        if (c === 'solana') return 'sol';
        if (c === 'opt' || c === 'optimistic' || c === 'optimism') return 'op';
        if (c === 'poly' || c === 'polygon') return 'pol';
        if (c === 'avalanche') return 'avax';
        if (c === 'binance' || c === 'binance-smart-chain') return 'bsc';
        return c;
    }

    private loadTokens(tokens: OneClickToken[]) {
        for (const t of tokens) {
            const assetId = t.assetId;
            // The 1Click API returns `blockchain` (actual source chain like 'eth', 'sol')
            // and `chain` (always 'near' since these are NEAR-wrapped tokens).
            // Use `blockchain` as the canonical chain for filtering/aliasing.
            const chain = this.normalizeChain((t as any).blockchain || t.chain || 'near');
            const symbol = t.symbol.toUpperCase();

            this.tokens.set(assetId, { ...t, chain });

            // Alias: chain:symbol, e.g. "base:USDC"
            this.aliasMap.set(`${chain}:${symbol}`.toLowerCase(), assetId);

            // Also index contract address if available
            if (t.contractAddress) {
                const addr = t.contractAddress.toLowerCase();
                this.aliasMap.set(`${chain}:${addr}`, assetId);
                this.aliasMap.set(addr, assetId);
            }

            // Special alias for unique symbols like BCH
            if (symbol === 'BCH') {
                this.aliasMap.set('bch', assetId);
                this.aliasMap.set('bch:bch', assetId);
            }
        }
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;
        await this.refresh();
        this.timer = setInterval(() => {
            this.refresh().catch(err => {
                log.warn('[bch-catalog] background token refresh failed', { err: (err as Error).message });
            });
        }, this.refreshIntervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    async refresh(): Promise<void> {
        try {
            const remoteTokens = await this.client.getTokens();
            if (remoteTokens && remoteTokens.length > 0) {
                this.loadTokens(remoteTokens);
                log.info('[bch-catalog] loaded tokens from 1Click', { count: this.tokens.size });
            }
        } catch (err) {
            log.warn('[bch-catalog] could not fetch remote tokens, using cached/fallback', {
                err: (err as Error).message,
                cachedCount: this.tokens.size,
            });
        }
    }

    /**
     * Resolves an asset identifier or friendly symbol/chain pair to a OneClickToken.
     * Examples:
     * - "nep141:bch.omft.near"
     * - "BCH"
     * - "USDC", chain: "base"
     * - "base:USDC"
     */
    resolve(assetOrSymbol: string, chain?: string): OneClickToken | undefined {
        const query = assetOrSymbol.trim();

        // 1. Exact match on assetId
        if (this.tokens.has(query)) {
            return this.tokens.get(query);
        }

        // 2. Format: "chain:symbol"
        if (query.includes(':') && !query.startsWith('nep141:')) {
            const [c, s] = query.split(':');
            const normChain = this.normalizeChain(c);
            const mappedId = this.aliasMap.get(`${normChain}:${s.toUpperCase()}`.toLowerCase());
            if (mappedId && this.tokens.has(mappedId)) {
                return this.tokens.get(mappedId);
            }
        }

        // 3. With explicit chain parameter
        if (chain) {
            const normChain = this.normalizeChain(chain);
            const mappedId = this.aliasMap.get(`${normChain}:${query.toUpperCase()}`.toLowerCase());
            if (mappedId && this.tokens.has(mappedId)) {
                return this.tokens.get(mappedId);
            }
        }

        // 4. Default symbol lookup
        const directAlias = this.aliasMap.get(query.toLowerCase());
        if (directAlias && this.tokens.has(directAlias)) {
            return this.tokens.get(directAlias);
        }

        // 5. Scan tokens by symbol (matching chain if provided, or first match)
        for (const t of this.tokens.values()) {
            if (t.symbol.toUpperCase() === query.toUpperCase()) {
                if (!chain || this.normalizeChain(t.chain) === this.normalizeChain(chain)) {
                    return t;
                }
            }
        }

        return undefined;
    }

    list(chainFilter?: string): OneClickToken[] {
        let list = [...this.tokens.values()];
        if (chainFilter) {
            const norm = this.normalizeChain(chainFilter);
            list = list.filter(t => this.normalizeChain(t.chain) === norm);
        }
        return list;
    }

    getBchToken(): OneClickToken {
        const bch = this.resolve('BCH');
        if (!bch) {
            return DEFAULT_FALLBACK_TOKENS[0];
        }
        return bch;
    }
}
