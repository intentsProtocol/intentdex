/**
 * src/lendbch/LoanStore.ts — persistent store for tracked LendBCH loans and activity.
 * Atomic writes on every update to data/lendbch-loans.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { TrackedLoan, LoanActivity } from './types.js';

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

export class LendBchLoanStore {
    private loans = new Map<string, TrackedLoan>();
    private file: string;
    /** Called after every create (prev undefined) and update. */
    onChange?: (prev: TrackedLoan | undefined, next: TrackedLoan) => void;

    constructor(dataDir: string, fileName = 'lendbch-loans.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        for (const l of readJson<TrackedLoan[]>(this.file, [])) {
            this.loans.set(l.loanTokenId.toLowerCase(), l);
        }
    }

    get(loanTokenId: string): TrackedLoan | undefined {
        const l = this.loans.get(loanTokenId.toLowerCase());
        return l ? structuredClone(l) : undefined;
    }

    /** Insert or replace tracked loan. */
    put(next: TrackedLoan): TrackedLoan {
        const key = next.loanTokenId.toLowerCase();
        const prev = this.loans.get(key);
        const copy = structuredClone(next);
        copy.loanTokenId = key;
        copy.updatedAt = Date.now();
        this.loans.set(key, copy);
        writeAtomic(this.file, [...this.loans.values()]);
        this.onChange?.(prev ? structuredClone(prev) : undefined, structuredClone(copy));
        return structuredClone(copy);
    }

    /** Record an action (borrow, manage, changeRate) on an existing loan. */
    recordActivity(loanTokenId: string, activity: LoanActivity): TrackedLoan | undefined {
        const existing = this.get(loanTokenId);
        if (!existing) return undefined;
        existing.activity.push(activity);
        if (activity.type === 'close') {
            existing.status = 'closed';
        }
        return this.put(existing);
    }

    all(): TrackedLoan[] {
        return [...this.loans.values()].map(l => structuredClone(l)).sort((a, b) => b.createdAt - a.createdAt);
    }

    byAddress(address: string): TrackedLoan[] {
        const a = address.toLowerCase();
        return this.all().filter(l => l.userAddress.toLowerCase() === a || l.userTokenAddress.toLowerCase() === a);
    }
}
