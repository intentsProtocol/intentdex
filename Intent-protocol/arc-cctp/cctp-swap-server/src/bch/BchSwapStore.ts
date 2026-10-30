/** Atomic persistent store for Bitcoin Cash cross-chain swaps. */
import * as fs from 'fs';
import * as path from 'path';
import { type BchSwapRecord, type BchSwapStatus, BCH_SWAP_TERMINAL } from './types.js';

export class BchSwapStore {
    private swaps = new Map<string, BchSwapRecord>();
    private byDeposit = new Map<string, string>(); // depositAddress -> swapId
    private file: string;

    /** Called after every create (prev undefined) and update. */
    onChange?: (prev: BchSwapRecord | undefined, next: BchSwapRecord) => void;

    constructor(dataDir: string, fileName = 'bch-swaps.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        if (fs.existsSync(this.file)) {
            const raw = fs.readFileSync(this.file, 'utf8');
            if (raw.trim()) {
                const list = JSON.parse(raw) as BchSwapRecord[];
                for (const s of list) {
                    this.swaps.set(s.id, s);
                    if (s.depositAddress) {
                        this.byDeposit.set(s.depositAddress.toLowerCase(), s.id);
                    }
                }
            }
        }
    }

    private save() {
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...this.swaps.values()], null, 2));
        fs.renameSync(tmp, this.file);
    }

    get(id: string): BchSwapRecord | undefined {
        const s = this.swaps.get(id);
        return s ? { ...s } : undefined;
    }

    getByDepositAddress(addr: string): BchSwapRecord | undefined {
        const id = this.byDeposit.get(addr.toLowerCase());
        return id ? this.get(id) : undefined;
    }

    create(s: BchSwapRecord): BchSwapRecord {
        if (this.swaps.has(s.id)) {
            throw new Error(`duplicate bch swap id ${s.id}`);
        }
        this.swaps.set(s.id, { ...s });
        if (s.depositAddress) {
            this.byDeposit.set(s.depositAddress.toLowerCase(), s.id);
        }
        this.save();
        this.onChange?.(undefined, { ...s });
        return { ...s };
    }

    update(id: string, patch: Partial<BchSwapRecord>): BchSwapRecord {
        const cur = this.swaps.get(id);
        if (!cur) throw new Error(`unknown bch swap ${id}`);
        const next: BchSwapRecord = { ...cur, ...patch, updatedAt: Date.now() };
        this.swaps.set(id, next);
        if (next.depositAddress && next.depositAddress !== cur.depositAddress) {
            this.byDeposit.set(next.depositAddress.toLowerCase(), id);
        }
        this.save();
        this.onChange?.({ ...cur }, { ...next });
        return { ...next };
    }

    list(filter: { address?: string; status?: BchSwapStatus; limit?: number } = {}): BchSwapRecord[] {
        let out = [...this.swaps.values()];
        if (filter.status) {
            out = out.filter(s => s.status === filter.status);
        }
        if (filter.address) {
            const target = filter.address.toLowerCase();
            out = out.filter(s =>
                (s.sender && s.sender.toLowerCase() === target) ||
                (s.recipient && s.recipient.toLowerCase() === target) ||
                (s.refundTo && s.refundTo.toLowerCase() === target) ||
                (s.depositAddress && s.depositAddress.toLowerCase() === target)
            );
        }
        out.sort((a, b) => b.createdAt - a.createdAt);
        return out.slice(0, filter.limit ?? 100).map(s => ({ ...s }));
    }

    all(): BchSwapRecord[] {
        return [...this.swaps.values()].map(s => ({ ...s }));
    }

    getPendingSwaps(): BchSwapRecord[] {
        return [...this.swaps.values()].filter(s => !BCH_SWAP_TERMINAL.has(s.status));
    }

    countByStatus(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const s of this.swaps.values()) {
            out[s.status] = (out[s.status] ?? 0) + 1;
        }
        return out;
    }
}
