/**
 * tests/lib/env.ts — shared helpers for the cctp-swap-server test suites.
 * Server reachability + HTTP against the live API (port 3012).
 */
import dotenv from 'dotenv';
dotenv.config();

export const BASE = process.env.RELAYER_URL || `http://localhost:${process.env.PORT || 3012}`;

export async function http(method: string, path: string, body?: any): Promise<{ status: number; json: any }> {
    const opts: RequestInit = { method, headers: { 'content-type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    try {
        const res = await fetch(`${BASE}${path}`, { ...opts, signal: AbortSignal.timeout(15_000) });
        let json: any = null;
        try { json = JSON.parse(await res.text()); } catch { /* non-json */ }
        return { status: res.status, json };
    } catch (e: any) {
        return { status: 0, json: { error: e.message } };
    }
}

export async function serverUp(): Promise<boolean> {
    const { status } = await http('GET', '/health');
    return status === 200;
}

export function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
