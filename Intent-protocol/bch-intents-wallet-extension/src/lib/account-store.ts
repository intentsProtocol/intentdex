import { extLocal } from '@/lib/ext-storage';

export const GRAD_PALETTE: [string, string][] = [
  ['#00d26a', '#0891b2'],
  ['#a78bfa', '#ec4899'],
  ['#f59e0b', '#dc2626'],
  ['#60a5fa', '#7c3aed'],
  ['#34d399', '#059669'],
  ['#fb923c', '#ef4444'],
];

export interface AccountAddresses {
  eth?: string;
  bch?: string;
  sol?: string;
  btc?: string;
}

export interface AccountStore {
  indices: number[];
  active: number;
  labels: Record<string, string>;
  grads: Record<string, [string, string]>;
  addressCache: Record<string, AccountAddresses>;
}

export const DEFAULT_STORE: AccountStore = {
  indices: [0],
  active: 0,
  labels: { '0': 'Main' },
  grads: { '0': GRAD_PALETTE[0] },
  addressCache: {},
};

const STORE_KEY = 'bch_accounts';

export async function readAccountStore(): Promise<AccountStore> {
  const raw = await extLocal.getItem(STORE_KEY);
  if (!raw) return { ...DEFAULT_STORE, labels: { '0': 'Main' }, grads: { '0': GRAD_PALETTE[0] }, addressCache: {} };
  try {
    return JSON.parse(raw) as AccountStore;
  } catch {
    return { ...DEFAULT_STORE };
  }
}

export async function writeAccountStore(store: AccountStore): Promise<void> {
  await extLocal.setItem(STORE_KEY, JSON.stringify(store));
}

export function getLabel(store: AccountStore, index: number): string {
  return store.labels[String(index)] ?? `Account ${index + 1}`;
}

export function getGrad(store: AccountStore, index: number): [string, string] {
  return store.grads[String(index)] ?? GRAD_PALETTE[index % GRAD_PALETTE.length];
}

export async function clearAccountStore(): Promise<void> {
  await extLocal.removeItem(STORE_KEY);
}
