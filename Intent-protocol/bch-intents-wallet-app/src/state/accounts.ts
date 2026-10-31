/**
 * The accounts of the wallet. Every account comes from the one recovery phrase: account N is address index N on
 * EVM chains, Bitcoin and Bitcoin Cash, and account N on Solana. What is stored is only how many there are, what
 * they are called and which is active; the keys are derived inside the worklet when needed.
 */
import { create } from 'zustand';
import { readJson, writeJson } from '@/lib/storage';

export const ACCOUNTS_KEY = 'wallet_accounts_v1';
export const MAX_ACCOUNTS = 20;

interface Stored { count: number; active: number; names: Record<number, string> }

interface AccountsState extends Stored {
  loaded: boolean;
  load: () => Promise<void>;
  setActive: (index: number) => void;
  add: () => number;
  rename: (index: number, name: string) => void;
  reset: () => void;
}

const EMPTY: Stored = { count: 1, active: 0, names: {} };

function normalize(raw: unknown): Stored {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Stored>;
  const count = Number.isInteger(p.count) && p.count! >= 1 && p.count! <= MAX_ACCOUNTS ? p.count! : 1;
  const active = Number.isInteger(p.active) && p.active! >= 0 && p.active! < count ? p.active! : 0;
  const names: Record<number, string> = {};
  for (const [k, v] of Object.entries(p.names ?? {})) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < count && typeof v === 'string' && v.trim()) names[i] = v.trim().slice(0, 24);
  }
  return { count, active, names };
}

const persist = (s: Stored) => { writeJson(ACCOUNTS_KEY, { count: s.count, active: s.active, names: s.names }).catch(() => {}); };

export const useAccounts = create<AccountsState>((set, get) => ({
  ...EMPTY,
  loaded: false,
  load: async () => set({ ...normalize(await readJson<unknown>(ACCOUNTS_KEY, null)), loaded: true }),
  setActive: index => {
    if (index < 0 || index >= get().count) return;
    set({ active: index });
    persist({ ...get(), active: index });
  },
  add: () => {
    const { count, names } = get();
    if (count >= MAX_ACCOUNTS) return get().active;
    const next = { count: count + 1, active: count, names };
    set(next);
    persist(next);
    return count;
  },
  rename: (index, name) => {
    const names = { ...get().names };
    const clean = name.trim().slice(0, 24);
    if (clean) names[index] = clean; else delete names[index];
    set({ names });
    persist({ ...get(), names });
  },
  reset: () => set({ ...EMPTY }),
}));

/** "Account 2", unless the user named it. */
export const accountName = (names: Record<number, string>, index: number) => names[index] ?? `Account ${index + 1}`;
