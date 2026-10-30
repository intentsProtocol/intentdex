/** SwapStore — one JSON file for Solana swaps; same atomic save-on-every-change rule as TransferStore. */
import * as fs from 'fs';
import * as path from 'path';
import type { SolanaSwap } from './types.js';

export class SwapStore {
    private swaps = new Map<string, SolanaSwap>();
    private file: string;
    /** Called after every create (prev undefined) and update. */
    onChange?: (prev: SolanaSwap | undefined, next: SolanaSwap) => void;

    constructor(dataDir: string, fileName = 'solana-swaps.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        if (fs.existsSync(this.file)) {
            const raw = fs.readFileSync(this.file, 'utf8');
            if (raw.trim()) for (const s of JSON.parse(raw) as SolanaSwap[]) this.swaps.set(s.id, s);
        }
    }

    private save() {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...this.swaps.values()], null, 2));
        fs.renameSync(tmp, this.file);
    }

    get(id: string): SolanaSwap | undefined {
        const s = this.swaps.get(id);
        return s ? { ...s } : undefined;
    }

    create(s: SolanaSwap): SolanaSwap {
        if (this.swaps.has(s.id)) throw new Error(`duplicate swap id ${s.id}`);
        this.swaps.set(s.id, { ...s });
        this.save();
        this.onChange?.(undefined, { ...s });
        return { ...s };
    }

    update(id: string, patch: Partial<SolanaSwap>): SolanaSwap {
        const cur = this.swaps.get(id);
        if (!cur) throw new Error(`unknown swap ${id}`);
        const next: SolanaSwap = { ...cur, ...patch, updatedAt: Date.now() };
        this.swaps.set(id, next);
        this.save();
        this.onChange?.({ ...cur }, { ...next });
        return { ...next };
    }

    list(filter: { address?: string; limit?: number } = {}): SolanaSwap[] {
        let out = [...this.swaps.values()];
        if (filter.address) out = out.filter(s => s.taker === filter.address || s.receiver === filter.address);
        out.sort((a, b) => b.createdAt - a.createdAt);
        return out.slice(0, filter.limit ?? 100).map(s => ({ ...s }));
    }

    all(): SolanaSwap[] {
        return [...this.swaps.values()].map(s => ({ ...s }));
    }

    countByStatus(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const s of this.swaps.values()) out[s.status] = (out[s.status] ?? 0) + 1;
        return out;
    }
}
