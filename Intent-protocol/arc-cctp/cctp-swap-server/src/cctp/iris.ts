/**
 * iris.ts — Circle Iris (attestation service) client for CCTP V2.
 * Docs: developers.circle.com/cctp/references/technical-guide. Rate limit 40 req/s; we self-limit to ~10.
 */
import { logger } from '../log.js';

const log = logger('iris');

export interface IrisFee { finalityThreshold: number; minimumFee: number }

export interface IrisMessage {
    message: string;
    eventNonce: string;
    attestation: string | null;
    status: 'complete' | 'pending_confirmations' | string;
    delayReason?: string | null;
    cctpVersion?: number;
    decodedMessage?: unknown;
}

export interface IrisApi {
    getFees(srcDomain: number, dstDomain: number): Promise<IrisFee[]>;
    getFastAllowance(): Promise<number>;
    /** null = not indexed yet (404). */
    getMessages(srcDomain: number, txHash: string): Promise<IrisMessage[] | null>;
    reattest(nonce: string): Promise<void>;
}

export class IrisError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

export function isAttestationReady(m: IrisMessage): boolean {
    return m.status === 'complete'
        && typeof m.attestation === 'string'
        && m.attestation.startsWith('0x')
        && m.attestation.length > 2
        && typeof m.message === 'string'
        && m.message.length > 2;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class IrisClient implements IrisApi {
    private nextSlot = 0;
    private feeCache = new Map<string, { at: number; fees: IrisFee[] }>();
    private allowanceCache?: { at: number; value: number };

    constructor(private baseUrl: string, private minIntervalMs = 100, private timeoutMs = 10_000) {}

    private async slot() {
        const now = Date.now();
        const start = Math.max(now, this.nextSlot);
        this.nextSlot = start + this.minIntervalMs;
        if (start > now) await sleep(start - now);
    }

    private async req(method: 'GET' | 'POST', path: string): Promise<{ status: number; json: any }> {
        await this.slot();
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        let json: any = null;
        try { json = await res.json(); } catch { /* empty body */ }
        if (res.status === 429) throw new IrisError('Iris rate limited', 429);
        return { status: res.status, json };
    }

    async getFees(srcDomain: number, dstDomain: number): Promise<IrisFee[]> {
        const key = `${srcDomain}:${dstDomain}`;
        const hit = this.feeCache.get(key);
        if (hit && Date.now() - hit.at < 30_000) return hit.fees;
        const { status, json } = await this.req('GET', `/v2/burn/USDC/fees/${srcDomain}/${dstDomain}`);
        if (status !== 200 || !Array.isArray(json)) throw new IrisError(`fees ${key}: HTTP ${status}`, status);
        const fees = json.map((f: any) => ({ finalityThreshold: Number(f.finalityThreshold), minimumFee: Number(f.minimumFee) }));
        this.feeCache.set(key, { at: Date.now(), fees });
        return fees;
    }

    async getFastAllowance(): Promise<number> {
        if (this.allowanceCache && Date.now() - this.allowanceCache.at < 15_000) return this.allowanceCache.value;
        const { status, json } = await this.req('GET', '/v2/fastBurn/USDC/allowance');
        if (status !== 200 || typeof json?.allowance !== 'number') throw new IrisError(`allowance: HTTP ${status}`, status);
        this.allowanceCache = { at: Date.now(), value: json.allowance };
        return json.allowance;
    }

    async getMessages(srcDomain: number, txHash: string): Promise<IrisMessage[] | null> {
        const { status, json } = await this.req('GET', `/v2/messages/${srcDomain}?transactionHash=${encodeURIComponent(txHash)}`);
        if (status === 404) return null;
        if (status !== 200) throw new IrisError(`messages ${srcDomain}/${txHash}: HTTP ${status}`, status);
        return Array.isArray(json?.messages) ? json.messages : [];
    }

    async reattest(nonce: string): Promise<void> {
        const { status, json } = await this.req('POST', `/v2/reattest/${encodeURIComponent(nonce)}`);
        if (status < 200 || status >= 300) throw new IrisError(`reattest ${nonce}: HTTP ${status} ${JSON.stringify(json)}`, status);
        log.info('re-attestation requested', { nonce });
    }
}
