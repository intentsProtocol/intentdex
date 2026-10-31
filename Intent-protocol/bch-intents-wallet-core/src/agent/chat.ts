/**
 * Chats as saved data: threads, their messages, and the outbox of drafted actions.
 *
 * An action the agent prepares is a draft in the outbox. The user's choice decides what happens next:
 *   draft ─Approve, online──▶ review with a fresh quote ─PIN──▶ running ─▶ done | failed
 *   draft ─Approve, offline─▶ queued ─back online, notified──▶ review ─PIN──▶ …
 *   draft | queued ─Dismiss──▶ dismissed
 * Nothing is signed before the review, and the review always needs a network and the PIN.
 */
import type { Card, ChatMessage, Draft } from './types';

export interface StoredMessage {
  id: string;
  at: number;
  role: 'user' | 'assistant';
  text: string;
  cards?: Card[];
  /** What the tools reported, kept so later turns know what was shown. */
  facts?: string[];
  /** The model failed or was stopped before it answered. */
  error?: 'model' | 'cancelled' | 'empty' | 'slow';
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  accountIndex: number;
  mode: 'testnet' | 'mainnet';
  /** Older turns folded into a few lines, written by the model on the phone. */
  summary?: string;
  /** Messages before this index are covered by `summary`. */
  summarisedThrough?: number;
  messages: StoredMessage[];
}

export type OutboxStatus = 'draft' | 'queued' | 'running' | 'done' | 'failed' | 'dismissed';

export interface OutboxItem {
  /** The draft's id, also on its card. */
  id: string;
  threadId: string;
  accountIndex: number;
  mode: 'testnet' | 'mainnet';
  draft: Draft;
  status: OutboxStatus;
  createdAt: number;
  updatedAt: number;
  /** Set when it ran: a transaction or position id, a link, or why it failed. */
  result?: { ref?: string; link?: string; note?: string };
}

export const OPEN_STATUSES: OutboxStatus[] = ['draft', 'queued'];

/** Items waiting for the network: the ones a "back online" notification is about. */
export const queuedItems = (items: OutboxItem[]) => items.filter(i => i.status === 'queued');

export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 42 ? `${one.slice(0, 40).trimEnd()}…` : one || '…';
}

export function newThread(id: string, now: number, accountIndex: number, mode: Thread['mode']): Thread {
  return { id, title: '', createdAt: now, updatedAt: now, accountIndex, mode, messages: [] };
}

/** About 4 characters per token; the window leaves room for the system prompt, the tools and the reply. */
export const CONTEXT_CHARS = 5200;

function asModelMessage(m: StoredMessage): ChatMessage {
  if (m.role === 'user') return { role: 'user', content: m.text };
  const shown = m.facts?.length ? `[shown to the user: ${m.facts.join(' | ')}]` : '';
  return { role: 'assistant', content: [m.text, shown].filter(Boolean).join('\n') || '[no reply]' };
}

/**
 * What the model reads from a thread: the summary of older turns, then as many recent messages as fit.
 * The screen still shows every message.
 */
export function contextFor(thread: Thread, budget = CONTEXT_CHARS): ChatMessage[] {
  const out: ChatMessage[] = [];
  let used = 0;
  const from = thread.summarisedThrough ?? 0;
  for (let i = thread.messages.length - 1; i >= from; i--) {
    const msg = asModelMessage(thread.messages[i]!);
    if (used + msg.content.length > budget && out.length > 0) break;
    used += msg.content.length;
    out.unshift(msg);
  }
  // A window must not start with the model's half of an exchange.
  while (out.length && out[0]!.role === 'assistant') out.shift();
  if (thread.summary) out.unshift({ role: 'system', content: `Earlier in this chat: ${thread.summary}` });
  return out;
}

/** Messages that no longer fit the window and are not yet in the summary; worth summarising once there are a few. */
export function unsummarised(thread: Thread, budget = CONTEXT_CHARS): StoredMessage[] {
  const from = thread.summarisedThrough ?? 0;
  let used = 0;
  let firstInWindow = thread.messages.length;
  for (let i = thread.messages.length - 1; i >= from; i--) {
    used += asModelMessage(thread.messages[i]!).content.length;
    if (used > budget) break;
    firstInWindow = i;
  }
  return thread.messages.slice(from, firstInWindow);
}

export function transcript(messages: StoredMessage[]): string {
  return messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${asModelMessage(m).content}`).join('\n');
}
