/**
 * Running a chat turn on the phone: the user's message goes in, the reply streams out, cards appear as the
 * tools return them, and drafted actions are filed in the outbox. Everything is local; the model loads on
 * first use and stays loaded while the wallet is unlocked.
 */
import { useCallback, useRef, useState } from 'react';
import { buildSnapshot, runTurn, summarise, type Card, type StoredMessage, type WalletSnapshot } from '@bch-intents/wallet-core/agent';
import { usePortfolio } from '@/state/portfolio';
import { qvacLlm, useModel } from './qvac';
import { useAgentStore } from './store';

export type Phase = 'loading-model' | 'thinking' | 'working' | 'writing';

export interface Pending {
  phase: Phase;
  text: string;
  cards: Card[];
  startedAt: number;
}

/** Longest a single answer may take before it is stopped. */
const ANSWER_LIMIT_MS = 120_000;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function useAgent() {
  const portfolio = usePortfolio();
  const [pending, setPending] = useState<Pending | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);

  /** The saved snapshot, or one made now from what the wallet shows (first use, before any save). */
  const snapshotNow = useCallback((): WalletSnapshot => {
    const saved = useAgentStore.getState().snapshot;
    if (saved && saved.mode === portfolio.mode && saved.accountIndex === portfolio.accountIndex) return saved;
    return buildSnapshot({
      at: Date.now(), mode: portfolio.mode, accountIndex: portfolio.accountIndex, assets: portfolio.assets, prices: portfolio.prices,
      positions: portfolio.positions, activity: [], tradeable: [], previousTokens: saved?.mode === portfolio.mode ? saved.tokens : undefined,
    });
  }, [portfolio.mode, portfolio.accountIndex, portfolio.assets, portfolio.prices, portfolio.positions]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy.current) return;
    busy.current = true;
    const store = useAgentStore.getState();
    const current = store.threads.find(t => t.id === store.activeId && t.accountIndex === portfolio.accountIndex && t.mode === portfolio.mode);
    const threadId = current?.id ?? store.startThread(portfolio.accountIndex, portfolio.mode);
    const user: StoredMessage = { id: uid(), at: Date.now(), role: 'user', text };
    const thread = useAgentStore.getState().threads.find(t => t.id === threadId)!;
    store.addMessage(threadId, user);

    const controller = new AbortController();
    abort.current = controller;
    // A model on a slow backend can take minutes; stop and say what to change instead of spinning.
    let slow = false;
    const limit = setTimeout(() => { slow = true; controller.abort(); }, ANSWER_LIMIT_MS);
    const started = Date.now();
    const loaded = useModel.getState().load === 'ready';
    let state: Pending = { phase: loaded ? 'thinking' : 'loading-model', text: '', cards: [], startedAt: started };
    setPending(state);
    const update = (patch: Partial<Pending>) => { state = { ...state, ...patch }; setPending(state); };

    try {
      if (!loaded) { await useModel.getState().ensureLoaded(); update({ phase: 'thinking' }); }
      const snapshot = snapshotNow();
      for await (const ev of runTurn(thread, text, { llm: qvacLlm, snapshot, newId: uid, signal: controller.signal })) {
        if (ev.type === 'text') update({ phase: 'writing', text: state.text + ev.delta });
        else if (ev.type === 'tool') update({ phase: 'working' });
        else if (ev.type === 'card') {
          update({ cards: [...state.cards, ev.card] });
          if (ev.draft && ev.draftId) {
            useAgentStore.getState().fileDraft({ id: ev.draftId, threadId, accountIndex: portfolio.accountIndex, mode: portfolio.mode, draft: ev.draft });
          }
        } else if (ev.type === 'done') {
          useAgentStore.getState().addMessage(threadId, slow && ev.message.error === 'cancelled' ? { ...ev.message, error: 'slow' } : ev.message);
        }
      }
    } catch {
      useAgentStore.getState().addMessage(threadId, { id: uid(), at: Date.now(), role: 'assistant', text: '', error: slow ? 'slow' : controller.signal.aborted ? 'cancelled' : 'model' });
    } finally {
      clearTimeout(limit);
      abort.current = null;
      busy.current = false;
      setPending(null);
    }

    // Fold old turns into the summary while the model is idle; the next turn reads less.
    const after = useAgentStore.getState().threads.find(t => t.id === threadId);
    if (after) summarise(after, qvacLlm).then(next => { if (next !== after) useAgentStore.getState().replaceThread(next); }).catch(() => {});
  }, [portfolio.accountIndex, portfolio.mode, snapshotNow]);

  const stop = useCallback(() => { abort.current?.abort(); }, []);

  return { send, stop, pending, busy: pending !== null };
}
