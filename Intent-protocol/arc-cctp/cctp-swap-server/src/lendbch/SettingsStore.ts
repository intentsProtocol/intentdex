/**
 * lendbch settings — one JSON file (data/lendbch-settings.json), the same atomic save-on-change rule as the lend
 * module's store. Holds only the operator-tunable knobs the read layer needs today; P4 extends this. The protocol's
 * own 0.25% borrow fee is fixed in the contract and is not a setting.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LendBchSettings {
    paused: boolean;
    pauseReason: string;
    /** Our front-end fee on borrow, in basis points (D1: default 25 = 0.25%, admin range 0–100). */
    frontendFeeBps: number;
    /** Minimum collateral ratio we allow at opening, in percent (D2: default 150). */
    minOpenRatioPct: number;
    /** UI warns below this ratio, in percent (D2: default 200). */
    warnRatioPct: number;
}

export const DEFAULT_LENDBCH_SETTINGS: LendBchSettings = {
    paused: false,
    pauseReason: '',
    frontendFeeBps: 25,
    minOpenRatioPct: 150,
    warnRatioPct: 200,
};

function writeAtomic(file: string, value: unknown) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
}

export class LendBchSettingsStore {
    private state: LendBchSettings;
    private file: string;

    constructor(dataDir: string, fileName = 'lendbch-settings.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        if (fs.existsSync(this.file)) {
            const raw = fs.readFileSync(this.file, 'utf8');
            this.state = raw.trim() ? { ...DEFAULT_LENDBCH_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_LENDBCH_SETTINGS };
        } else {
            this.state = { ...DEFAULT_LENDBCH_SETTINGS };
        }
    }

    get(): LendBchSettings {
        return { ...this.state };
    }

    /** Apply and validate a partial update. Returns the names of the fields that changed; throws on a bad value. */
    patch(body: Record<string, unknown>): string[] {
        const next = { ...this.state };
        const changed: string[] = [];
        const setNum = (key: 'frontendFeeBps' | 'minOpenRatioPct' | 'warnRatioPct', min: number, max: number) => {
            if (!(key in body)) return;
            const v = Number(body[key]);
            if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${key} must be between ${min} and ${max}`);
            if (v !== next[key]) { next[key] = v; changed.push(key); }
        };
        if ('paused' in body) {
            const v = Boolean(body.paused);
            if (v !== next.paused) { next.paused = v; changed.push('paused'); }
        }
        if ('pauseReason' in body) {
            const v = String(body.pauseReason ?? '');
            if (v !== next.pauseReason) { next.pauseReason = v; changed.push('pauseReason'); }
        }
        setNum('frontendFeeBps', 0, 100);
        setNum('minOpenRatioPct', 110, 1000);
        setNum('warnRatioPct', 110, 2000);
        if (next.warnRatioPct < next.minOpenRatioPct) throw new Error('warnRatioPct must be at least minOpenRatioPct');
        if (changed.length) { this.state = next; writeAtomic(this.file, this.state); }
        return changed;
    }
}
