/**
 * TokenCatalog — Jupiter's verified token list, kept in memory and refreshed in the background.
 *
 * The verified list is what the token picker shows by default. Any other mint is still swappable: it is found
 * through search() and marked `verified: false`. Tokenized stocks are verified tokens tagged `stocks`
 * (Jupiter's /tag endpoint rejects `stocks`, so they are filtered from the verified list here).
 */
import { errMsg, logger } from '../log.js';
import type { JupToken, JupiterApi } from './types.js';

const log = logger('tokens');

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Issuer tags on stock tokens, in the order they are checked. */
const STOCK_ISSUERS = ['xstocks', 'ondo', 'backpack', 'prestocks', 'tessera', 'shift'] as const;

export interface TokenView {
    mint: string;
    symbol: string;
    name: string;
    icon?: string;
    decimals: number;
    tokenProgram?: string;
    verified: boolean;
    suspicious: boolean;
    tags: string[];
    isStock: boolean;
    stockIssuer?: string;
    hasFreezeAuthority: boolean;
    usdPrice?: number;
    priceChange24h?: number;
    volume24h?: number;
    liquidity?: number;
    mcap?: number;
    holderCount?: number;
    organicScore?: number;
}

export function toTokenView(t: JupToken): TokenView {
    const tags = t.tags ?? [];
    const isStock = tags.includes('stocks');
    const s = t.stats24h;
    return {
        mint: t.id, symbol: t.symbol, name: t.name, icon: t.icon, decimals: t.decimals, tokenProgram: t.tokenProgram,
        verified: t.isVerified === true,
        suspicious: t.audit?.isSus === true,
        tags, isStock,
        stockIssuer: isStock ? (STOCK_ISSUERS.find(i => tags.includes(i)) ?? 'other') : undefined,
        hasFreezeAuthority: !!t.freezeAuthority,
        usdPrice: t.usdPrice,
        priceChange24h: s?.priceChange,
        volume24h: s ? (s.buyVolume ?? 0) + (s.sellVolume ?? 0) : undefined,
        liquidity: t.liquidity, mcap: t.mcap, holderCount: t.holderCount, organicScore: t.organicScore,
    };
}

export interface TokenFilter { q?: string; tag?: string; issuer?: string; minLiquidity?: number; stocksOnly?: boolean; sort?: string }

export class TokenCatalog {
    private list: TokenView[] = [];
    private byMint = new Map<string, TokenView>();
    private loadedAt = 0;
    private loading?: Promise<void>;
    private timer?: NodeJS.Timeout;

    constructor(private api: JupiterApi, private refreshMs: number) {}

    /** Load now and keep refreshing. A failed refresh keeps the previous list. */
    start() {
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), this.refreshMs);
        this.timer.unref();
    }

    stop() { if (this.timer) clearInterval(this.timer); }

    get ready(): boolean { return this.loadedAt > 0; }
    get size(): number { return this.list.length; }
    get ageSec(): number | undefined { return this.loadedAt ? Math.round((Date.now() - this.loadedAt) / 1000) : undefined; }

    refresh(): Promise<void> {
        this.loading ??= (async () => {
            try {
                const raw = await this.api.verifiedTokens();
                const list = raw.map(toTokenView);
                this.list = list;
                this.byMint = new Map(list.map(t => [t.mint, t]));
                this.loadedAt = Date.now();
                log.info('verified token list loaded', { tokens: list.length, stocks: list.filter(t => t.isStock).length });
            } catch (e) {
                log.warn('verified token list refresh failed', { err: errMsg(e), keeping: this.list.length });
            } finally {
                this.loading = undefined;
            }
        })();
        return this.loading;
    }

    /** The verified list, loading it first if this is the first call. */
    async verified(): Promise<TokenView[]> {
        if (!this.ready) await this.refresh();
        return this.list;
    }

    /** Verified-list lookup, no network. */
    cached(mint: string): TokenView | undefined { return this.byMint.get(mint); }

    /** The most liquid verified token with exactly this symbol (e.g. 'USDC'), no network. */
    find(symbol: string): TokenView | undefined {
        const s = symbol.toLowerCase();
        return this.list.filter(t => t.symbol.toLowerCase() === s).sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0];
    }

    /** Any token by mint: the verified list first, then Jupiter search. */
    async get(mint: string): Promise<TokenView | undefined> {
        await this.verified();
        return this.byMint.get(mint) ?? (await this.search(mint)).find(t => t.mint === mint);
    }

    /** Live search over every token Jupiter indexes, verified or not. */
    async search(q: string): Promise<TokenView[]> {
        return (await this.api.searchTokens(q)).map(toTokenView);
    }

    async filter(f: TokenFilter): Promise<TokenView[]> {
        let out = await this.verified();
        if (f.stocksOnly) out = out.filter(t => t.isStock);
        if (f.tag) out = out.filter(t => t.tags.includes(f.tag!));
        if (f.issuer) out = out.filter(t => t.stockIssuer === f.issuer);
        if (f.minLiquidity !== undefined) out = out.filter(t => (t.liquidity ?? 0) >= f.minLiquidity!);
        if (f.q) {
            const q = f.q.toLowerCase();
            out = out.filter(t => t.mint === f.q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
        }
        const key = f.sort === 'volume' ? 'volume24h' : f.sort === 'mcap' ? 'mcap' : f.sort === 'liquidity' ? 'liquidity' : undefined;
        if (key) out = [...out].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
        if (f.q) {
            // Exact symbol first, then symbols that start with the query (the sort is stable).
            const q = f.q.toLowerCase();
            const rank = (t: TokenView) => { const sym = t.symbol.toLowerCase(); return sym === q ? 0 : sym.startsWith(q) ? 1 : 2; };
            out = [...out].sort((a, b) => rank(a) - rank(b));
        }
        return out;
    }

    stockIssuers(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const t of this.list) if (t.stockIssuer) out[t.stockIssuer] = (out[t.stockIssuer] ?? 0) + 1;
        return out;
    }
}
