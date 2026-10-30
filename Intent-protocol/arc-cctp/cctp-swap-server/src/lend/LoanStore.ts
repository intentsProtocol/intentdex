/** LoanStore — one JSON file for loans, and one for the lend settings; the same atomic save-on-every-change rule as TransferStore. */
import * as fs from 'fs';
import * as path from 'path';
import type { LendSettings, LoanRecord } from './types.js';

function writeAtomic(file: string, value: unknown) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? (JSON.parse(raw) as T) : fallback;
}

export class LoanStore {
    private loans = new Map<string, LoanRecord>();
    private file: string;
    /** Called after every create (prev undefined) and update. */
    onChange?: (prev: LoanRecord | undefined, next: LoanRecord) => void;

    constructor(dataDir: string, fileName = 'lend-loans.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        for (const l of readJson<LoanRecord[]>(this.file, [])) this.loans.set(l.ref, l);
    }

    get(ref: string): LoanRecord | undefined {
        const l = this.loans.get(ref.toUpperCase()) ?? this.loans.get(ref);
        return l ? structuredClone(l) : undefined;
    }

    /** Insert or replace. */
    put(next: LoanRecord): LoanRecord {
        const prev = this.loans.get(next.ref);
        this.loans.set(next.ref, structuredClone(next));
        writeAtomic(this.file, [...this.loans.values()]);
        this.onChange?.(prev ? structuredClone(prev) : undefined, structuredClone(next));
        return structuredClone(next);
    }

    all(): LoanRecord[] {
        return [...this.loans.values()].map(l => structuredClone(l)).sort((a, b) => b.createdAt - a.createdAt);
    }

    byAddress(address: string): LoanRecord[] {
        const a = address.toLowerCase();
        return this.all().filter(l => l.addresses.some(x => x.toLowerCase() === a));
    }
}

export const DEFAULT_LEND_SETTINGS: LendSettings = { paused: false, pauseReason: '', maxBorrowUsd: 0, warnLtvBps: 6800 };

export class LendSettingsStore {
    private state: LendSettings;
    private file: string;

    constructor(dataDir: string, fileName = 'lend-settings.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        this.state = { ...DEFAULT_LEND_SETTINGS, ...readJson<Partial<LendSettings>>(this.file, {}) };
    }

    get(): LendSettings { return { ...this.state }; }

    /** Apply a partial change. Returns the names of the settings that changed; throws on a value that makes no sense. */
    patch(p: Record<string, unknown>): string[] {
        const next = { ...this.state };
        for (const [k, v] of Object.entries(p)) {
            switch (k) {
                case 'paused': if (typeof v !== 'boolean') throw new Error('paused must be true or false'); next.paused = v; break;
                case 'pauseReason': next.pauseReason = String(v ?? '').slice(0, 200); break;
                case 'maxBorrowUsd': { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error('maxBorrowUsd must be 0 or more'); next.maxBorrowUsd = n; break; }
                case 'warnLtvBps': { const n = Number(v); if (!Number.isInteger(n) || n < 1000 || n > 9900) throw new Error('warnLtvBps must be between 1000 and 9900'); next.warnLtvBps = n; break; }
                default: throw new Error(`unknown lend setting '${k}'`);
            }
        }
        const changed = (Object.keys(next) as (keyof LendSettings)[]).filter(k => next[k] !== this.state[k]);
        if (changed.length) { this.state = next; writeAtomic(this.file, next); }
        return changed;
    }
}
