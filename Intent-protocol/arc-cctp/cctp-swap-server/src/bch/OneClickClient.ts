/** Resilient HTTP Client for NEAR Intents 1Click API (https://1click.chaindefuser.com/v0). */
import type {
    OneClickToken,
    OneClickQuoteRequest,
    OneClickQuoteResponse,
    OneClickDepositAddressRequest,
    OneClickDepositAddressResponse,
    OneClickStatusResponse,
} from './types.js';

export interface OneClickClientConfig {
    baseUrl: string;
    partnerJwt?: string;
    timeoutMs?: number;
    maxRetries?: number;
}

export class OneClickClient {
    private baseUrl: string;
    private partnerJwt: string;
    private timeoutMs: number;
    private maxRetries: number;

    constructor(cfg: OneClickClientConfig) {
        this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
        this.partnerJwt = cfg.partnerJwt || '';
        this.timeoutMs = cfg.timeoutMs ?? 10_000;
        this.maxRetries = cfg.maxRetries ?? 3;
    }

    private async request<T>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
        const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        if (this.partnerJwt) {
            headers['Authorization'] = `Bearer ${this.partnerJwt}`;
        }

        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            if (attempt > 0) {
                const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                await new Promise(r => setTimeout(r, backoff));
            }

            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), this.timeoutMs);

                const res = await fetch(url, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!res.ok) {
                    const errText = await res.text();
                    let errMsg = `HTTP ${res.status} ${res.statusText}`;
                    try {
                        const parsed = JSON.parse(errText);
                        errMsg = parsed.message || parsed.error || errMsg;
                    } catch {
                        if (errText) errMsg += `: ${errText.slice(0, 200)}`;
                    }

                    // 4xx errors generally should not be retried except 429
                    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                        throw new Error(errMsg);
                    }
                    throw new Error(errMsg);
                }

                return (await res.json()) as T;
            } catch (err: any) {
                lastError = err;
                if (err.name === 'AbortError') {
                    lastError = new Error(`1Click request timed out after ${this.timeoutMs}ms`);
                }
                // Do not retry client validation errors
                if (err.message && !err.message.includes('429') && !err.message.includes('50') && !err.message.includes('timed out') && !err.message.includes('fetch failed')) {
                    throw err;
                }
            }
        }

        throw lastError || new Error(`Failed to request ${path}`);
    }

    /** GET /v0/tokens — Fetch catalog of supported multi-chain tokens */
    async getTokens(): Promise<OneClickToken[]> {
        const res = await this.request<any>('GET', '/tokens');
        if (Array.isArray(res)) return res;
        if (Array.isArray(res?.tokens)) return res.tokens;
        return [];
    }

    /** POST /v0/quote — Request swap quote with optional appFees */
    async getQuote(req: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
        return await this.request<OneClickQuoteResponse>('POST', '/quote', req);
    }

    /** POST /v0/deposit-address — Generate dedicated one-time deposit address */
    async getDepositAddress(req: OneClickDepositAddressRequest): Promise<OneClickDepositAddressResponse> {
        return await this.request<OneClickDepositAddressResponse>('POST', '/deposit-address', req);
    }

    /** GET /v0/status?depositAddress=... — Check on-chain deposit & solver execution status */
    async getStatus(depositAddress: string): Promise<OneClickStatusResponse> {
        return await this.request<OneClickStatusResponse>('GET', `/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    }

    /** POST /v0/deposit-tx — Optional registration of origin transaction hash */
    async submitDepositTx(depositAddress: string, txHash: string): Promise<any> {
        try {
            return await this.request<any>('POST', '/deposit-tx', { depositAddress, txHash });
        } catch (err) {
            // Some 1Click nodes track automatically; record notification error without failing
            return { error: (err as Error).message };
        }
    }
}
