/**
 * One turn of the agent: the user's message → the model → at most two tool calls → cards → (sometimes) a short
 * written reply. Everything runs on the device; nothing here touches the network or a key.
 *
 * Most cards speak for themselves, so the model writes a reply after a tool only when the tool asks for one.
 * That saves a second pass through the model, which on a phone is the slow part.
 */
import { contextFor, transcript, unsummarised, type StoredMessage, type Thread } from './chat';
import { SUMMARY_PROMPT, systemPrompt } from './prompts';
import { quickIntent, stripToolCallText } from './quick';
import { AGENT_TOOLS } from './tools';
import type { AgentTool, Card, ChatMessage, Draft, LlmClient, ToolCall, WalletSnapshot } from './types';

export interface TurnDeps {
  llm: LlmClient;
  snapshot: WalletSnapshot;
  newId: () => string;
  now?: () => number;
  signal?: AbortSignal;
  tools?: AgentTool[];
}

export type TurnEvent =
  | { type: 'thinking' }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'card'; card: Card; draft?: Draft; draftId?: string }
  | { type: 'done'; message: StoredMessage };

const MAX_CALLS = 2;

export async function* runTurn(thread: Thread, userText: string, deps: TurnDeps): AsyncGenerator<TurnEvent> {
  const now = deps.now ?? Date.now;
  const tools = deps.tools ?? AGENT_TOOLS;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(deps.snapshot, now()) },
    ...contextFor(thread),
    { role: 'user', content: userText },
  ];
  const reply: StoredMessage = { id: deps.newId(), at: now(), role: 'assistant', text: '' };
  const cards: Card[] = [];
  const facts: string[] = [];

  yield { type: 'thinking' };
  const think = new ThinkFilter();
  const calls: ToolCall[] = [];
  // A clearly phrased request needs no model: faster, and the sides of a swap cannot be swapped.
  const quick = quickIntent(userText, deps.newId);
  if (quick) calls.push(quick);
  try {
    if (!quick) for await (const ev of deps.llm.chat(messages, { tools: tools.map(t => t.def), toolChoice: 'auto', maxTokens: 320, temperature: 0.2, signal: deps.signal })) {
      if (ev.type === 'text') {
        const out = think.push(ev.delta);
        if (out) { reply.text += out; yield { type: 'text', delta: out }; }
      } else if (ev.type === 'toolCall') {
        calls.push(ev.call);
      }
    }
    const tail = think.flush();
    if (tail) { reply.text += tail; yield { type: 'text', delta: tail }; }

    // Some builds print the call as text instead of reporting it. Take it from the text then.
    if (!calls.length) {
      const inline = extractInlineCalls(reply.text, deps.newId);
      if (inline.calls.length) { calls.push(...inline.calls); reply.text = inline.rest; }
    }
    // Whatever was reported, call JSON is never shown as an answer.
    if (calls.length) reply.text = stripToolCallText(reply.text);

    const results: ChatMessage[] = [];
    let narrate = false;
    for (const call of calls.slice(0, MAX_CALLS)) {
      const tool = tools.find(t => t.def.name === call.name);
      if (!tool) continue;
      yield { type: 'tool', name: call.name };
      const out = tool.run(call.arguments ?? {}, { snapshot: deps.snapshot, now: now(), newId: deps.newId });
      cards.push(out.card);
      facts.push(out.facts);
      narrate ||= !!out.narrate;
      yield { type: 'card', card: out.card, draft: out.draft, draftId: out.card.type === 'draft' ? out.card.draftId : undefined };
      results.push({ role: 'tool', content: out.facts, toolCallId: call.id, toolName: call.name });
    }

    if (narrate && results.length) {
      reply.text = '';
      const second: ChatMessage[] = [...messages, { role: 'assistant', content: '', toolCalls: calls.slice(0, MAX_CALLS) }, ...results];
      const think2 = new ThinkFilter();
      for await (const ev of deps.llm.chat(second, { toolChoice: 'none', maxTokens: 160, temperature: 0.3, signal: deps.signal })) {
        if (ev.type !== 'text') continue;
        const out = think2.push(ev.delta);
        if (out) { reply.text += out; yield { type: 'text', delta: out }; }
      }
      reply.text += think2.flush();
    }
  } catch (e) {
    reply.error = deps.signal?.aborted ? 'cancelled' : 'model';
  }

  reply.text = reply.text.trim();
  if (cards.length) reply.cards = cards;
  if (facts.length) reply.facts = facts;
  if (!reply.error && !reply.text && !cards.length) reply.error = 'empty';
  yield { type: 'done', message: reply };
}

/** Folds the turns that fell out of the window into the thread's summary. Returns the thread unchanged when there is nothing to fold. */
export async function summarise(thread: Thread, llm: LlmClient, signal?: AbortSignal): Promise<Thread> {
  const older = unsummarised(thread);
  if (older.length < 4) return thread;
  const prior = thread.summary ? `Summary so far: ${thread.summary}\n` : '';
  let text = '';
  const think = new ThinkFilter();
  for await (const ev of llm.chat(
    [{ role: 'system', content: SUMMARY_PROMPT },{ role: 'user', content: `${prior}${transcript(older)}` }],
    { toolChoice: 'none', maxTokens: 160, temperature: 0.2, signal },
  )) {
    if (ev.type === 'text') text += think.push(ev.delta);
  }
  text = (text + think.flush()).trim();
  if (!text) return thread;
  return { ...thread, summary: text, summarisedThrough: (thread.summarisedThrough ?? 0) + older.length };
}

/** Drops `<think>…</think>` from a stream, even when the tags arrive split across chunks. */
export class ThinkFilter {
  private buf = '';
  private inside = false;

  push(chunk: string): string {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf('</think>');
        if (end < 0) { this.buf = this.buf.slice(-7); return out; }
        this.buf = this.buf.slice(end + 8);
        this.inside = false;
      } else {
        const start = this.buf.indexOf('<think>');
        if (start < 0) {
          // Keep a possible partial "<think" at the end for the next chunk.
          const keep = partialTagAt(this.buf, '<think>');
          out += this.buf.slice(0, this.buf.length - keep);
          this.buf = this.buf.slice(this.buf.length - keep);
          return out;
        }
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + 7);
        this.inside = true;
      }
    }
  }

  flush(): string {
    const rest = this.inside ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

function partialTagAt(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n;
  return 0;
}

/** `<tool_call>{"name":…,"arguments":{…}}</tool_call>` blocks (Qwen's format) in plain text. */
export function extractInlineCalls(text: string, newId: () => string): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = [];
  const take = (_m: string, body: string) => {
    try {
      const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name === 'string') {
        const args = typeof parsed.arguments === 'string' ? JSON.parse(parsed.arguments) : parsed.arguments;
        calls.push({ id: newId(), name: parsed.name, arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> });
      }
    } catch { /* not a call: leave nothing */ }
    return '';
  };
  const rest = text
    .replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, take)
    // Bare `{"name": …, "arguments": {…}}`, as a 0.6B model printed it on the phone.
    .replace(/(\{\s*"name"\s*:\s*"[\w-]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\})/g, take);
  return { calls, rest: rest.trim() };
}
