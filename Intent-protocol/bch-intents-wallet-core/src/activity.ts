/**
 * What the wallet did: sends, swaps and bridges started here, kept in the host's store.
 *
 * This is the wallet's own record, written at the moment something is signed, so an entry exists even if the
 * popup closes a second later. Chain history (incoming payments, and anything done with the same seed
 * elsewhere) is read from the chains and merged in by the Activity screen.
 */

import { storage } from './platform';

export const ACTIVITY_KEY = 'wallet_activity_v1';
const MAX_ENTRIES = 200;

export type ActivityKind = 'send' | 'receive' | 'swap' | 'bridge' | 'sign' | 'connect';
export type ActivityStatus = 'pending' | 'confirmed' | 'failed' | 'refunded';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  /** Network key from lib/chains.ts. For a bridge, the source. */
  network: string;
  /** Account (EVM address, lower-case) that did it: the activity list is per account. */
  account: string;
  at: number;
  /** "0.5 BCH" — what left the wallet. */
  sent?: string;
  /** "12 USDC" — what arrived or is expected. */
  received?: string;
  counterparty?: string;
  /** Destination network key, for a bridge. */
  toNetwork?: string;
  txid?: string;
  /** The dapp that asked, when one did. */
  origin?: string;
  /** Server record this entry follows: a swap-server transfer or swap id, or a relayer intent id. */
  ref?: { product: 'cctp' | 'jupiter' | 'cashtoken'; id: string };
  note?: string;
}

export async function readActivity(): Promise<ActivityEntry[]> {
  try {
    const all = JSON.parse((await storage().getItem(ACTIVITY_KEY)) ?? '[]');
    return Array.isArray(all) ? (all as ActivityEntry[]) : [];
  } catch {
    return [];
  }
}

async function write(entries: ActivityEntry[]): Promise<void> {
  await storage().setItem(ACTIVITY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export const newActivityId = () => `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export async function addActivity(entry: Omit<ActivityEntry, 'id' | 'at'> & { id?: string; at?: number }): Promise<ActivityEntry> {
  const full: ActivityEntry = { ...entry, id: entry.id ?? newActivityId(), at: entry.at ?? Date.now(), account: entry.account.toLowerCase() };
  await write([full, ...(await readActivity()).filter(e => e.id !== full.id)]);
  return full;
}

export async function updateActivity(id: string, patch: Partial<ActivityEntry>): Promise<void> {
  const all = await readActivity();
  const i = all.findIndex(e => e.id === id);
  if (i < 0) return;
  all[i] = { ...all[i], ...patch };
  await write(all);
}

export async function clearActivity(): Promise<void> {
  await storage().removeItem(ACTIVITY_KEY);
}

export const activityFor = (entries: ActivityEntry[], account: string | null, networks: string[]) =>
  entries.filter(e => (!account || e.account === account.toLowerCase()) && networks.includes(e.network));
