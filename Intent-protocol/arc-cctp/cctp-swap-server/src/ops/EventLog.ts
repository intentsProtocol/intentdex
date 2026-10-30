/**
 * EventLog — one stream of what happened on the server: transfer and swap status changes, admin actions,
 * warnings. Appended to data/events.jsonl and kept in memory (latest 5,000) for the admin console.
 */
import * as fs from 'fs';
import * as path from 'path';

export type Section = 'cctp' | 'solana' | 'lend' | 'lendbch' | 'system' | 'bch';
export type Severity = 'info' | 'success' | 'warn' | 'error';

export interface OpsEvent {
    seq: number;
    at: number;                  // ms
    section: Section;
    type: string;                // e.g. 'transfer.completed', 'swap.failed', 'admin.pause'
    severity: Severity;
    summary: string;
    subject?: { kind: 'transfer' | 'swap' | 'loan' | 'chain' | 'settings' | 'token'; id: string };
    data?: Record<string, unknown>;
}

const KEEP = 5000;

export class EventLog {
    private events: OpsEvent[] = [];
    private seq = 0;
    private file?: string;

    /** Without a dataDir the log is memory-only (tests). */
    constructor(dataDir?: string) {
        if (!dataDir) return;
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, 'events.jsonl');
        if (fs.existsSync(this.file)) {
            for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
                if (!line.trim()) continue;
                try { this.events.push(JSON.parse(line)); } catch { /* skip a torn line */ }
            }
            this.events = this.events.slice(-KEEP);
            this.seq = this.events.at(-1)?.seq ?? 0;
        }
    }

    record(e: Omit<OpsEvent, 'seq' | 'at'>): OpsEvent {
        const ev: OpsEvent = { seq: ++this.seq, at: Date.now(), ...e };
        this.events.push(ev);
        if (this.events.length > KEEP) this.events.splice(0, this.events.length - KEEP);
        if (this.file) { try { fs.appendFileSync(this.file, JSON.stringify(ev) + '\n'); } catch { /* disk full: keep serving */ } }
        return ev;
    }

    /** Newest first. */
    query(f: { section?: string; severity?: string; type?: string; subject?: string; sinceMs?: number; limit?: number; offset?: number } = {}) {
        let out = this.events;
        if (f.section) out = out.filter(e => e.section === f.section);
        if (f.severity) out = out.filter(e => e.severity === f.severity);
        if (f.type) out = out.filter(e => e.type.startsWith(f.type!));
        if (f.subject) out = out.filter(e => e.subject?.id === f.subject);
        if (f.sinceMs) out = out.filter(e => e.at >= f.sinceMs!);
        const total = out.length;
        const offset = f.offset ?? 0;
        const events = out.slice().reverse().slice(offset, offset + (f.limit ?? 100));
        return { total, latestSeq: this.seq, events };
    }

    countSince(sinceMs: number, section?: Section): Record<Severity, number> {
        const out: Record<Severity, number> = { info: 0, success: 0, warn: 0, error: 0 };
        for (const e of this.events) if (e.at >= sinceMs && (!section || e.section === section)) out[e.severity]++;
        return out;
    }
}
