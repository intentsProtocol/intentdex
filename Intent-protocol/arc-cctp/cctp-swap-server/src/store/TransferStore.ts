/**
 * TransferStore — single JSON file for every transfer on every chain.
 * Saves on every change, atomically (write tmp, then rename), so a crash never leaves a half-written file
 * and a restart resumes exactly where the worker stopped.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TERMINAL_STATUSES, type Transfer } from '../types.js';

export class TransferStore {
    private transfers = new Map<string, Transfer>();
    private file: string;
    /** Called after every create (prev undefined) and update. */
    onChange?: (prev: Transfer | undefined, next: Transfer) => void;

    constructor(dataDir: string, fileName = 'transfers.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        this.load();
    }

    private load() {
        if (!fs.existsSync(this.file)) return;
        const raw = fs.readFileSync(this.file, 'utf8');
        if (!raw.trim()) return;
        const list: Transfer[] = JSON.parse(raw);
        for (const t of list) this.transfers.set(t.id, t);
    }

    private save() {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...this.transfers.values()], null, 2));
        fs.renameSync(tmp, this.file);
    }

    get(id: string): Transfer | undefined {
        const t = this.transfers.get(id);
        return t ? { ...t } : undefined;
    }

    create(t: Transfer): Transfer {
        if (this.transfers.has(t.id)) throw new Error(`duplicate transfer id ${t.id}`);
        this.transfers.set(t.id, { ...t });
        this.save();
        this.onChange?.(undefined, { ...t });
        return { ...t };
    }

    update(id: string, patch: Partial<Transfer>): Transfer {
        const cur = this.transfers.get(id);
        if (!cur) throw new Error(`unknown transfer ${id}`);
        const next: Transfer = { ...cur, ...patch, updatedAt: Date.now() };
        this.transfers.set(id, next);
        this.save();
        this.onChange?.({ ...cur }, { ...next });
        return { ...next };
    }

    active(): Transfer[] {
        return [...this.transfers.values()].filter(t => !TERMINAL_STATUSES.has(t.status)).map(t => ({ ...t }));
    }

    list(filter: { address?: string; limit?: number } = {}): Transfer[] {
        const addr = filter.address?.toLowerCase();
        let out = [...this.transfers.values()];
        if (addr) out = out.filter(t => t.sender.toLowerCase() === addr || t.recipient.toLowerCase() === addr);
        out.sort((a, b) => b.createdAt - a.createdAt);
        return out.slice(0, filter.limit ?? 100).map(t => ({ ...t }));
    }

    findByBurn(src: string, burnTxHash: string): Transfer | undefined {
        const h = burnTxHash.toLowerCase();
        for (const t of this.transfers.values()) {
            if (t.src === src && t.burnTxHash?.toLowerCase() === h) return { ...t };
        }
        return undefined;
    }

    all(): Transfer[] {
        return [...this.transfers.values()].map(t => ({ ...t }));
    }

    countByStatus(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const t of this.transfers.values()) out[t.status] = (out[t.status] ?? 0) + 1;
        return out;
    }
}
