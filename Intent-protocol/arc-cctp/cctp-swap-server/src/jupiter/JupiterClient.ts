/**
 * JupiterClient — Jupiter Swap v2, Tokens v2 and Price v3 (developers.jup.ag/docs).
 *
 * The API key stays on this server. Requests are spaced to the plan's rate limit, which Jupiter counts per
 * organisation: 0.5 req/s without a key, 1 req/s on the free key. /swap/v2/execute has its own, larger bucket
 * and is not spaced.
 */
import { JupiterError, type JupExecuteResult, type JupOrder, type JupPrices, type JupToken, type JupiterApi } from './types.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class JupiterClient implements JupiterApi {
    private nextSlot = 0;
    private cache = new Map<string, { at: number; value: unknown }>();
    private minIntervalMs: number;
    private counters = { requests: 0, errors: 0, rateLimited: 0, lastError: undefined as string | undefined, lastErrorAt: undefined as number | undefined, lastOkAt: undefined as number | undefined, lastLatencyMs: undefined as number | undefined };

    constructor(private baseUrl: string, private apiKey: string, rps: number, private maxQueueMs = 10_000) {
        this.minIntervalMs = Math.ceil(1000 / rps);
    }

    /** Request counters since start, for the admin console. */
    stats() { return { ...this.counters, rps: 1000 / this.minIntervalMs, apiKey: !!this.apiKey, queueMs: Math.max(0, this.nextSlot - Date.now()) }; }

    private fail(e: JupiterError): never {
        this.counters.errors++;
        if (e.status === 429) this.counters.rateLimited++;
        this.counters.lastError = `${e.status || 'network'}: ${e.message}`.slice(0, 200);
        this.counters.lastErrorAt = Date.now();
        throw e;
    }

    private async slot() {
        const now = Date.now();
        const start = Math.max(now, this.nextSlot);
        if (start - now > this.maxQueueMs) this.fail(new JupiterError('swap service is busy, retry in a few seconds', 429));
        this.nextSlot = start + this.minIntervalMs;
        if (start > now) await sleep(start - now);
    }

    private async req<T>(method: 'GET' | 'POST', path: string, opts: { body?: unknown; timeoutMs?: number; spaced?: boolean } = {}): Promise<T> {
        if (opts.spaced !== false) await this.slot();
        const headers: Record<string, string> = {};
        if (this.apiKey) headers['x-api-key'] = this.apiKey;
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        let res: Response;
        const t0 = Date.now();
        this.counters.requests++;
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method, headers,
                body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
                signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
            });
        } catch (e: any) {
            this.fail(new JupiterError(`Jupiter unreachable: ${e?.message ?? e}`, 0));
        }
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); } catch { json = undefined; }
        if (!res.ok) this.fail(new JupiterError(json?.error || json?.message || text.slice(0, 200) || `HTTP ${res.status}`, res.status, json?.code));
        this.counters.lastOkAt = Date.now();
        this.counters.lastLatencyMs = Date.now() - t0;
        return json as T;
    }

    private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
        const value = await load();
        this.cache.set(key, { at: Date.now(), value });
        if (this.cache.size > 500) for (const [k, v] of this.cache) if (Date.now() - v.at > 60_000) this.cache.delete(k);
        return value;
    }

    /** Quote-only orders (no taker) are cached for 3 s; orders that carry a transaction never are. */
    order(params: Record<string, string>): Promise<JupOrder> {
        const path = `/swap/v2/order?${new URLSearchParams(params)}`;
        return params.taker ? this.req<JupOrder>('GET', path) : this.cached(path, 3000, () => this.req<JupOrder>('GET', path));
    }

    /** Jupiter lands the tx and answers when it is confirmed or dropped, so the timeout is long. */
    execute(body: { signedTransaction: string; requestId: string; lastValidBlockHeight?: string }): Promise<JupExecuteResult> {
        return this.req<JupExecuteResult>('POST', '/swap/v2/execute', { body, timeoutMs: 60_000, spaced: false });
    }

    private async tokenList(path: string, timeoutMs: number): Promise<JupToken[]> {
        const out = await this.req<unknown>('GET', path, { timeoutMs });
        // The Tokens API answers some bad requests with HTTP 200 and {status, message} in the body.
        if (!Array.isArray(out)) throw new JupiterError((out as any)?.message || 'unexpected token list response', 502);
        return out as JupToken[];
    }

    verifiedTokens(): Promise<JupToken[]> {
        return this.tokenList('/tokens/v2/tag?query=verified', 60_000);
    }

    searchTokens(query: string): Promise<JupToken[]> {
        const path = `/tokens/v2/search?query=${encodeURIComponent(query)}`;
        return this.cached(path, 30_000, () => this.tokenList(path, 15_000));
    }

    prices(ids: string[]): Promise<JupPrices> {
        const path = `/price/v3?ids=${ids.join(',')}`;
        return this.cached(path, 5000, () => this.req<JupPrices>('GET', path));
    }
}
