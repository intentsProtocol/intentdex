/**
 * The agent's saved state: chats, the outbox of drafted actions, and the last wallet snapshot. All of it is
 * encrypted on the phone (see vault.ts) and readable only while the wallet is unlocked.
 *
 * One plain number is kept outside the vault: how many actions wait for the network. The background check
 * that sends the "back online" notification reads only that, so it never needs the vault key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  isSnapshot, newThread, titleFrom, type Draft, type OutboxItem, type OutboxStatus, type StoredMessage, type Thread, type WalletSnapshot,
} from '@bch-intents/wallet-core/agent';
import { forgetVault, vaultRead, vaultWrite } from './vault';

export const QUEUED_COUNT_KEY = 'agent_queued_count_v1';
const MAX_THREADS = 60;

interface Saved { threads: Thread[]; outbox: OutboxItem[] }

interface AgentState {
  loaded: boolean;
  threads: Thread[];
  outbox: OutboxItem[];
  snapshot: WalletSnapshot | null;
  activeId: string | null;
  load(): Promise<void>;
  /** Opens a fresh chat for this account and network and returns its id. */
  startThread(accountIndex: number, mode: Thread['mode']): string;
  select(id: string | null): void;
  removeThread(id: string): void;
  addMessage(threadId: string, message: StoredMessage): void;
  replaceThread(thread: Thread): void;
  fileDraft(item: Omit<OutboxItem, 'createdAt' | 'updatedAt' | 'status'> & { status?: OutboxStatus }): void;
  setStatus(id: string, status: OutboxStatus, result?: OutboxItem['result']): void;
  /** Replaces a draft's content (a plan moved to today's price before it is reviewed). */
  updateDraft(id: string, draft: Draft): void;
  saveSnapshot(snapshot: WalletSnapshot): void;
  /** On lock: drop the decrypted copy from memory (the vault keeps it). */
  forget(): void;
  wipe(): Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const useAgentStore = create<AgentState>((set, get) => {
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const { threads, outbox } = get();
      vaultWrite('chats', { threads: threads.slice(0, MAX_THREADS), outbox } satisfies Saved).catch(() => {});
      AsyncStorage.setItem(QUEUED_COUNT_KEY, String(outbox.filter(i => i.status === 'queued').length)).catch(() => {});
    }, 400);
  };

  return {
    loaded: false,
    threads: [],
    outbox: [],
    snapshot: null,
    activeId: null,

    async load() {
      if (get().loaded) return;
      const [saved, snapshot] = await Promise.all([
        vaultRead<Saved>('chats', { threads: [], outbox: [] }),
        vaultRead<unknown>('snapshot', null),
      ]);
      // An item that was running when the app closed did not finish here; show it as failed, not stuck.
      const outbox = (saved.outbox ?? []).map(i => (i.status === 'running' ? { ...i, status: 'failed' as const, result: { ...i.result, note: 'interrupted' } } : i));
      set({ loaded: true, threads: saved.threads ?? [], outbox, snapshot: isSnapshot(snapshot) ? snapshot : null });
    },

    startThread(accountIndex, mode) {
      const thread = newThread(uid(), Date.now(), accountIndex, mode);
      set(s => ({ threads: [thread, ...s.threads], activeId: thread.id }));
      persist();
      return thread.id;
    },

    select(id) { set({ activeId: id }); },

    removeThread(id) {
      set(s => ({
        threads: s.threads.filter(t => t.id !== id),
        outbox: s.outbox.filter(i => i.threadId !== id || i.status === 'running'),
        activeId: s.activeId === id ? null : s.activeId,
      }));
      persist();
    },

    addMessage(threadId, message) {
      set(s => ({
        threads: s.threads.map(t => t.id !== threadId ? t : {
          ...t,
          title: t.title || (message.role === 'user' ? titleFrom(message.text) : t.title),
          updatedAt: message.at,
          messages: [...t.messages, message],
        }).sort((a, b) => b.updatedAt - a.updatedAt),
      }));
      persist();
    },

    replaceThread(thread) {
      set(s => ({ threads: s.threads.map(t => (t.id === thread.id ? thread : t)) }));
      persist();
    },

    fileDraft(item) {
      const now = Date.now();
      set(s => ({ outbox: [{ ...item, status: item.status ?? 'draft', createdAt: now, updatedAt: now }, ...s.outbox.filter(i => i.id !== item.id)] }));
      persist();
    },

    setStatus(id, status, result) {
      set(s => ({ outbox: s.outbox.map(i => (i.id === id ? { ...i, status, updatedAt: Date.now(), ...(result ? { result } : null) } : i)) }));
      persist();
    },

    updateDraft(id, draft) {
      set(s => ({ outbox: s.outbox.map(i => (i.id === id ? { ...i, draft, updatedAt: Date.now() } : i)) }));
      persist();
    },

    saveSnapshot(snapshot) {
      set({ snapshot });
      vaultWrite('snapshot', snapshot).catch(() => {});
    },

    forget() {
      if (timer) {
        // Write what is pending before letting go of it.
        clearTimeout(timer);
        timer = null;
        const { threads, outbox } = get();
        vaultWrite('chats', { threads: threads.slice(0, MAX_THREADS), outbox } satisfies Saved).catch(() => {});
      }
      set({ threads: [], outbox: [], snapshot: null, activeId: null, loaded: false });
    },

    async wipe() {
      if (timer) { clearTimeout(timer); timer = null; }
      set({ threads: [], outbox: [], snapshot: null, activeId: null, loaded: false });
      await forgetVault();
      await AsyncStorage.removeItem(QUEUED_COUNT_KEY).catch(() => {});
    },
  };
});

export const draftOf = (id: string) => useAgentStore.getState().outbox.find(i => i.id === id);
export type { Draft };
