/** ProfileStore — persists known user profiles, linked wallets, and accounts for lending/borrowing. */
import * as fs from 'fs';
import * as path from 'path';

export interface UserProfileWallet {
    address: string;
    chain: string; // 'BTC' | 'ETH'
    addedAt: number;
}

export interface UserProfileRecord {
    profileId: string;
    primaryAddress: string;
    wallets: UserProfileWallet[];
    createdAt: number;
    lastSeenAt: number;
    notes?: string;
}

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

export class ProfileStore {
    private profiles = new Map<string, UserProfileRecord>();
    private file: string;
    onChange?: (prev: UserProfileRecord | undefined, next: UserProfileRecord) => void;

    constructor(dataDir: string, fileName = 'lend-profiles.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        for (const p of readJson<UserProfileRecord[]>(this.file, [])) {
            this.profiles.set(p.profileId, p);
        }
    }

    get(profileId: string): UserProfileRecord | undefined {
        const p = this.profiles.get(profileId);
        return p ? structuredClone(p) : undefined;
    }

    byAddress(address: string): UserProfileRecord | undefined {
        const clean = (address ?? '').trim().toLowerCase();
        if (!clean) return undefined;
        for (const p of this.profiles.values()) {
            if (p.primaryAddress.toLowerCase() === clean) return structuredClone(p);
            if (p.wallets.some(w => w.address.toLowerCase() === clean)) return structuredClone(p);
        }
        return undefined;
    }

    upsert(profileId: string, address: string, chain = 'ETH'): UserProfileRecord {
        const now = Date.now();
        const pid = profileId.trim();
        const addr = (address ?? '').trim();
        const ch = (chain ?? 'ETH').toUpperCase();
        const prev = this.profiles.get(pid);

        if (prev) {
            prev.lastSeenAt = now;
            if (addr) {
                const existingWallet = prev.wallets.find(w => w.address.toLowerCase() === addr.toLowerCase());
                if (!existingWallet) {
                    prev.wallets.push({ address: addr, chain: ch, addedAt: now });
                } else if (!existingWallet.chain && ch) {
                    existingWallet.chain = ch;
                }
            }
            writeAtomic(this.file, [...this.profiles.values()]);
            this.onChange?.(structuredClone(prev), structuredClone(prev));
            return structuredClone(prev);
        }

        const newRecord: UserProfileRecord = {
            profileId: pid,
            primaryAddress: addr || pid,
            wallets: addr ? [{ address: addr, chain: ch, addedAt: now }] : [],
            createdAt: now,
            lastSeenAt: now,
        };
        this.profiles.set(pid, newRecord);
        writeAtomic(this.file, [...this.profiles.values()]);
        this.onChange?.(undefined, structuredClone(newRecord));
        return structuredClone(newRecord);
    }

    updateNotes(profileId: string, notes: string): UserProfileRecord | undefined {
        const p = this.profiles.get(profileId);
        if (!p) return undefined;
        const prev = structuredClone(p);
        p.notes = (notes ?? '').slice(0, 500);
        writeAtomic(this.file, [...this.profiles.values()]);
        this.onChange?.(prev, structuredClone(p));
        return structuredClone(p);
    }

    all(): UserProfileRecord[] {
        return [...this.profiles.values()].map(p => structuredClone(p)).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    }

    count(): number {
        return this.profiles.size;
    }
}
