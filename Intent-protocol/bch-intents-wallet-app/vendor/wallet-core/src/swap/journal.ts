/**
 * The signing journal: transaction hashes of a transfer, written before each transaction is broadcast.
 *
 * The server is the source of truth for history, but there is one moment it cannot see: the wallet has sent the
 * burn and the popup closes before the hash is reported. Without a record, "resume" would build and sign a second
 * burn. With it, the hash is reported on the next open and nothing is signed twice.
 *
 * Ported from frontend/src/swap-server/journal.ts. The difference is storage: chrome.storage.local is async, so
 * `set` and `delete` return a promise that settles when the entry is on disk, and callers await `set` before they
 * broadcast. Reads are served from memory after `load()`.
 */
import { storage } from '../platform';

export interface JournalEntry { burn?: string; fee?: string; at: number }

export interface Journal {
    get(id: string): JournalEntry | undefined;
    set(id: string, patch: { burn?: string; fee?: string }): Promise<void>;
    delete(id: string): Promise<void>;
    all(): Record<string, JournalEntry>;
}

const KEY = 'swap_server_journal_v1';
const MAX_AGE_MS = 24 * 60 * 60_000;

export interface JournalStore { read(): Promise<string | null>; write(value: string): Promise<void> }

const hostStore: JournalStore = { read: () => storage().getItem(KEY), write: v => storage().setItem(KEY, v) };

/** Load the journal from storage. Await this once before the first transfer. */
export async function loadJournal(store: JournalStore = hostStore, now: () => number = Date.now): Promise<Journal> {
    let entries: Record<string, JournalEntry> = {};
    try { entries = JSON.parse((await store.read()) ?? '{}') as Record<string, JournalEntry>; } catch { entries = {}; }
    const fresh = (): Record<string, JournalEntry> => {
        const out: Record<string, JournalEntry> = {};
        for (const [id, e] of Object.entries(entries)) if (e && typeof e.at === 'number' && now() - e.at < MAX_AGE_MS) out[id] = e;
        return out;
    };
    const persist = () => store.write(JSON.stringify(fresh())).catch(() => { /* full or blocked: memory still has it */ });
    return {
        get: id => fresh()[id],
        set: (id, patch) => { entries[id] = { ...entries[id], ...patch, at: now() }; return persist(); },
        delete: id => { if (!(id in entries)) return Promise.resolve(); delete entries[id]; return persist(); },
        all: fresh,
    };
}
