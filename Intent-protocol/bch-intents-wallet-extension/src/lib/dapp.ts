/**
 * The dapp-connection state shared by the background worker and the wallet UI: which sites are connected, and
 * which requests wait for the user.
 *
 * Plain chrome.storage calls and nothing else, so the service worker can import it (no React, no WASM).
 */

import {
  QUEUE_KEY, SITES_KEY, REQUEST_TTL_MS, type ConnectedSite, type PendingRequest,
} from '@/shared/messages';

// ── connected sites (chrome.storage.local) ──

export async function readSites(): Promise<Record<string, ConnectedSite>> {
  const res = await chrome.storage.local.get(SITES_KEY);
  const sites = res[SITES_KEY];
  return sites && typeof sites === 'object' && !Array.isArray(sites) ? (sites as Record<string, ConnectedSite>) : {};
}

export async function isConnected(origin: string): Promise<boolean> {
  return origin in (await readSites());
}

export async function connectSite(site: Pick<ConnectedSite, 'origin' | 'title' | 'icon'>): Promise<void> {
  const sites = await readSites();
  const now = Date.now();
  sites[site.origin] = { ...site, connectedAt: sites[site.origin]?.connectedAt ?? now, lastUsedAt: now };
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

export async function touchSite(origin: string): Promise<void> {
  const sites = await readSites();
  if (!sites[origin]) return;
  sites[origin].lastUsedAt = Date.now();
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

export async function disconnectSite(origin: string): Promise<void> {
  const sites = await readSites();
  if (!(origin in sites)) return;
  delete sites[origin];
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

export async function disconnectAllSites(): Promise<void> {
  await chrome.storage.local.set({ [SITES_KEY]: {} });
}

// ── pending requests (chrome.storage.session: gone when the browser closes) ──

export async function readQueue(): Promise<PendingRequest[]> {
  const res = await chrome.storage.session.get(QUEUE_KEY);
  const queue = Array.isArray(res[QUEUE_KEY]) ? (res[QUEUE_KEY] as PendingRequest[]) : [];
  const now = Date.now();
  return queue.filter(r => now - r.createdAt < REQUEST_TTL_MS);
}

export async function writeQueue(queue: PendingRequest[]): Promise<void> {
  await chrome.storage.session.set({ [QUEUE_KEY]: queue });
}

/** Subscribe to the queue. Returns the unsubscribe function. */
export function watchQueue(onChange: (queue: PendingRequest[]) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'session' || !changes[QUEUE_KEY]) return;
    const next = changes[QUEUE_KEY].newValue;
    onChange(Array.isArray(next) ? (next as PendingRequest[]) : []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
