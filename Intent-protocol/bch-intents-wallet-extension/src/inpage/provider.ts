/**
 * Inpage provider — runs in the main world of every page and sets window.bchIntents.
 *
 * A Phantom-style, EIP-1193-shaped API: one `request({ method, params })`, plus events.
 * Communication: postMessage ↔ content script ↔ chrome.runtime ↔ background worker.
 *
 * Self-contained on purpose (no imports that produce code): it is loaded as a classic script.
 * Developer reference: docs/developers/provider-api.md
 */

import type { DappRequest, DappResponse } from '../shared/messages';

type EventName = 'accountsChanged' | 'networkChanged' | 'connect' | 'disconnect';
type Handler = (...args: unknown[]) => void;
type Network = 'chipnet' | 'mainnet';

interface ProviderRpcError extends Error { code: number }

(() => {
  const w = window as unknown as { bchIntents?: unknown };
  if (w.bchIntents) return;   // a second injection (an iframe reload, another copy of the extension) keeps the first

  const FROM_PAGE = 'bch-intents-inpage';
  const FROM_WALLET = 'bch-intents-content';
  const REQUEST_TIMEOUT_MS = 10 * 60_000;

  const listeners = new Map<EventName, Set<Handler>>();
  const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let accounts: string[] = [];
  let network: Network | null = null;

  const rpcError = (code: number, message: string): ProviderRpcError => Object.assign(new Error(message), { code });

  function emit(event: EventName, ...args: unknown[]) {
    for (const handler of [...(listeners.get(event) ?? [])]) {
      try { handler(...args); } catch (e) { console.error('[bchIntents] listener threw', e); }
    }
  }

  function setAccounts(next: string[]) {
    const was = accounts;
    accounts = next;
    if (was.length === next.length && was.every((a, i) => a === next[i])) return;
    emit('accountsChanged', [...next]);
    if (!was.length && next.length) emit('connect', { network });
    if (was.length && !next.length) emit('disconnect', rpcError(4900, 'The wallet disconnected from this site'));
  }

  function send(method: string, params?: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = `bchi_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        reject(rpcError(4001, 'The request was not answered in time'));
      }, REQUEST_TIMEOUT_MS);
      waiting.set(requestId, { resolve, reject, timer });
      const payload: DappRequest = { requestId, origin: window.location.origin, method, params };
      window.postMessage({ from: FROM_PAGE, type: 'DAPP_REQUEST', payload }, window.location.origin);
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.from !== FROM_WALLET) return;

    if (data.type === 'DAPP_RESPONSE') {
      const res = data.payload as DappResponse | undefined;
      const pending = res && waiting.get(res.requestId);
      if (!res || !pending) return;
      waiting.delete(res.requestId);
      clearTimeout(pending.timer);
      if (res.approved) pending.resolve(res.result);
      else pending.reject(rpcError(res.code ?? 4001, res.error ?? 'User rejected the request'));
      return;
    }
    if (data.type === 'ACCOUNTS_CHANGED') {
      setAccounts(Array.isArray(data.addresses) ? data.addresses : []);
      return;
    }
    if (data.type === 'NETWORK_CHANGED') {
      network = data.network === 'mainnet' ? 'mainnet' : 'chipnet';
      emit('networkChanged', network);
    }
  });

  const provider = {
    isBCHIntents: true as const,

    isConnected(): boolean {
      return accounts.length > 0;
    },

    /** The connected address, or null. Updated by bch_requestAccounts, bch_accounts and accountsChanged. */
    get selectedAddress(): string | null {
      return accounts[0] ?? null;
    },

    async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      if (!args || typeof args.method !== 'string') throw rpcError(-32602, 'request() takes { method, params? }');
      if (args.params !== undefined && !Array.isArray(args.params)) throw rpcError(-32602, 'params must be an array');
      const result = await send(args.method, args.params);

      if (args.method === 'bch_requestAccounts' || args.method === 'bch_accounts') setAccounts(Array.isArray(result) ? (result as string[]) : []);
      if (args.method === 'bch_getNetwork') network = result === 'mainnet' ? 'mainnet' : 'chipnet';
      if (args.method === 'wallet_disconnect' || args.method === 'bch_disconnect') setAccounts([]);
      return result;
    },

    /** Shorthand for request({ method: 'bch_requestAccounts' }). */
    connect(): Promise<string[]> {
      return provider.request({ method: 'bch_requestAccounts' }) as Promise<string[]>;
    },

    disconnect(): Promise<boolean> {
      return provider.request({ method: 'wallet_disconnect' }) as Promise<boolean>;
    },

    on(event: EventName, handler: Handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return provider;
    },

    removeListener(event: EventName, handler: Handler) {
      listeners.get(event)?.delete(handler);
      return provider;
    },

    off(event: EventName, handler: Handler) {
      return provider.removeListener(event, handler);
    },
  };

  Object.defineProperty(window, 'bchIntents', { value: Object.freeze(provider), writable: false, configurable: false });
  window.dispatchEvent(new Event('bchIntents#initialized'));

  // A site the user connected earlier gets its account back without a prompt.
  provider.request({ method: 'bch_accounts' }).catch(() => { /* no wallet answer yet: stay disconnected */ });
})();
