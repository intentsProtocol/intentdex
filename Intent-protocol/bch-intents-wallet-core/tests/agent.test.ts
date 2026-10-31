import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOLS, contextFor, extractInlineCalls, levelOf, MIN_BID_BIN_SATS, planLoan, planStrategy, resolveAmount, runTurn,
  summarise, ThinkFilter, toolByName, unsummarised, type ChatMessage, type LlmClient, type LlmEvent, type Thread,
  type ToolContext, type TurnEvent, type WalletSnapshot,
} from '../src/agent';
import { gridPriceNum } from '../src/mesh/v4';
import { quickIntent, stripToolCallText } from '../src/agent/quick';

const MESH = 'aa'.repeat(32);

const snapshot: WalletSnapshot = {
  version: 1, at: 1_700_000_000_000, mode: 'testnet', accountIndex: 0,
  assets: [
    { id: 'bch-chipnet:native', network: 'bch-chipnet', family: 'bch', networkName: 'Bitcoin Cash Chipnet', kind: 'native', ref: 'native', symbol: 'BCH', name: 'Bitcoin Cash', decimals: 8, balance: '100000000' },
    { id: `bch-chipnet:${MESH}`, network: 'bch-chipnet', family: 'bch', networkName: 'Bitcoin Cash Chipnet', kind: 'cashtoken', ref: MESH, symbol: 'MESH', name: 'Mesh', decimals: 2, balance: '50000' },
    { id: 'base-sepolia:0xusdc', network: 'base-sepolia', family: 'evm', networkName: 'Base Sepolia', kind: 'erc20', ref: '0xusdc', symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: '25000000' },
    { id: 'eth-sepolia:0xusdc2', network: 'eth-sepolia', family: 'evm', networkName: 'Sepolia', kind: 'erc20', ref: '0xusdc2', symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: '0' },
    { id: 'btc-testnet:native', network: 'btc-testnet', family: 'btc', networkName: 'Bitcoin Testnet', kind: 'native', ref: 'native', symbol: 'BTC', name: 'Bitcoin', decimals: 8, balance: '2000000' },
  ],
  tokens: [{ category: MESH, symbol: 'MESH', name: 'Mesh', decimals: 2, priceSats: 1000 }],
  positions: [],
  activity: [{ kind: 'swap', status: 'confirmed', at: 1_699_999_000_000, network: 'bch-chipnet', sent: '0.1 BCH', received: '90 MESH' }],
  usd: { BTC: 100_000, BCH: 400 },
};

let n = 0;
const ctx = (): ToolContext => ({ snapshot, now: snapshot.at + 60_000, newId: () => `id${++n}` });
const run = (name: string, args: Record<string, unknown>) => toolByName(name)!.run(args, ctx());

describe('resolveAmount', () => {
  const bal = 100_000_000n;
  it('reads words, fractions and percentages', () => {
    expect(resolveAmount('half', bal, 8)).toEqual({ ok: true, value: 50_000_000n });
    expect(resolveAmount('a quarter of my BCH', bal, 8)).toEqual({ ok: true, value: 25_000_000n });
    expect(resolveAmount('25%', bal, 8)).toEqual({ ok: true, value: 25_000_000n });
    expect(resolveAmount('all', bal, 8)).toEqual({ ok: true, value: bal });
    expect(resolveAmount('nusu', bal, 8)).toEqual({ ok: true, value: 50_000_000n });
  });
  it('reads numbers with a unit, a decimal comma and thousands', () => {
    expect(resolveAmount('0.1 BCH', bal, 8)).toEqual({ ok: true, value: 10_000_000n });
    expect(resolveAmount('0,5', bal, 8)).toEqual({ ok: true, value: 50_000_000n });
    expect(resolveAmount('1,000', 10n ** 12n, 6)).toEqual({ ok: true, value: 1_000_000_000n });
  });
  it('refuses nonsense, zero and more than the balance', () => {
    expect(resolveAmount('lots', bal, 8)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveAmount('0', bal, 8)).toEqual({ ok: false, reason: 'zero' });
    expect(resolveAmount('2', bal, 8)).toEqual({ ok: false, reason: 'exceeds' });
    expect(resolveAmount('150%', bal, 8)).toEqual({ ok: false, reason: 'exceeds' });
  });
});

describe('planStrategy', () => {
  const token = { category: MESH, symbol: 'MESH', decimals: 2 };
  it('accumulate: only buying bins, from below the market up to it', () => {
    const r = planStrategy({ style: 'accumulate', risk: 'medium', token, marketPrice: 1000, bchBudget: 25_000_000n, tokenBudget: 0n });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.draft;
    expect(d.sellBins).toBe(0);
    expect(d.highIndex).toBe(d.marketIndex);
    expect(d.marketIndex).toBe(levelOf(1000, d.binStepBps));
    expect(d.lowPrice).toBeLessThan(1000 * 0.8);
    expect(d.binCount).toBeLessThanOrEqual(10);
    expect(d.depositTokens).toBe('0');
    expect(BigInt(d.depositSats)).toBe(25_000_000n);
  });
  it('take-profit: only selling bins above the market, and needs tokens', () => {
    const r = planStrategy({ style: 'take-profit', risk: 'low', token, marketPrice: 1000, bchBudget: 0n, tokenBudget: 10_000n });
    expect(r.ok && r.draft.buyBins === 0 && r.draft.lowIndex === r.draft.marketIndex + 1).toBe(true);
    expect(planStrategy({ style: 'take-profit', risk: 'low', token, marketPrice: 1000, bchBudget: 0n, tokenBudget: 0n })).toEqual({ ok: false, code: 'no-balance' });
  });
  it('range without tokens falls back to the buying half and says so', () => {
    const r = planStrategy({ style: 'range', risk: 'medium', token, marketPrice: 1000, bchBudget: 10_000_000n, tokenBudget: 0n });
    expect(r.ok && r.draft.sellBins === 0 && r.draft.warnings.includes('no-tokens-to-sell')).toBe(true);
  });
  it('range with both sides straddles the market', () => {
    const r = planStrategy({ style: 'range', risk: 'medium', token, marketPrice: 1000, bchBudget: 10_000_000n, tokenBudget: 10_000n });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.buyBins).toBeGreaterThan(0);
    expect(r.draft.sellBins).toBeGreaterThan(0);
    expect(r.draft.lowPrice).toBeLessThan(1000);
    expect(r.draft.highPrice).toBeGreaterThan(1000);
    expect(r.draft.lowPrice).toBeCloseTo(gridPriceNum(r.draft.binStepBps, r.draft.lowIndex));
  });
  it('a budget too small for the buying bins is refused with the minimum', () => {
    const r = planStrategy({ style: 'accumulate', risk: 'high', token, marketPrice: 1000, bchBudget: 3000n, tokenBudget: 0n });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-small');
    expect(r.minSats! >= MIN_BID_BIN_SATS).toBe(true);
  });
  it('limit: one bin at the target, buying below the market, selling above', () => {
    const below = planStrategy({ style: 'limit', risk: 'low', token, marketPrice: 1000, bchBudget: 10_000n, tokenBudget: 0n, targetPrice: 800 });
    expect(below.ok && below.draft.binCount === 1 && below.draft.buyBins === 1).toBe(true);
    const above = planStrategy({ style: 'limit', risk: 'low', token, marketPrice: 1000, bchBudget: 0n, tokenBudget: 100n, targetPrice: 1300 });
    expect(above.ok && above.draft.sellBins === 1).toBe(true);
  });
});

describe('planLoan', () => {
  it('borrows at 40% by default and caps under the Simple Loan limit', () => {
    const p = planLoan(1_000_000n, 100_000, 0); // 0.01 BTC = 1,000 USD
    expect(p.borrowUsd).toBe(400);
    expect(p.health).toBeCloseTo(0.74 / 0.4);
    expect(p.liquidationPriceUsd).toBeCloseTo(400 / (0.01 * 0.74));
    expect(planLoan(1_000_000n, 100_000, 0, 0.9).ltv).toBeCloseTo(0.63);
  });
});

describe('tools', () => {
  it('wallet_balance lists held assets only', () => {
    const out = run('wallet_balance', {});
    expect(out.card.type).toBe('portfolio');
    if (out.card.type !== 'portfolio') return;
    expect(out.card.rows.map(r => r.symbol)).toEqual(expect.arrayContaining(['BCH', 'MESH', 'USDC', 'BTC']));
    expect(out.card.rows).toHaveLength(4);
  });
  it('plan_swap drafts BCH → MESH as a CashToken intent', () => {
    const out = run('plan_swap', { sell: 'bitcoin cash', buy: 'mesh', amount: '0.1' });
    expect(out.card.type).toBe('draft');
    expect(out.draft).toMatchObject({ kind: 'swap', product: 'cashtoken', amount: { value: '10000000', symbol: 'BCH' }, buy: { symbol: 'MESH' } });
  });
  it('plan_swap drafts USDC across chains as CCTP', () => {
    const out = run('plan_swap', { sell: 'USDC', buy: 'usdc on ethereum', amount: 'all' });
    expect(out.draft).toMatchObject({ product: 'cctp', sell: { network: 'base-sepolia' }, buy: { network: 'eth-sepolia' } });
  });
  it('plan_swap explains what is wrong instead of guessing', () => {
    expect(run('plan_swap', { sell: 'DOGE', buy: 'BCH', amount: '1' }).card).toMatchObject({ type: 'problem', code: 'unknown-token' });
    // The reply names tokens that do exist, held ones first, never the unknown one.
    const known = (run('plan_swap', { sell: 'BCH', buy: 'DOGE', amount: '0.01' }).card as { vars?: Record<string, string> }).vars?.known ?? '';
    expect(known.split(', ')[0]).toBe('BCH');
    expect(known).not.toMatch(/DOGE/);
    const underfunded = run('plan_swap', { sell: 'BCH', buy: 'MESH', amount: '5' });
    expect(underfunded.draft?.underfunded).toMatchObject({ tokenSymbol: 'BCH' });
    expect(run('plan_swap', { sell: 'BCH', buy: 'BCH', amount: '0.1' }).card).toMatchObject({ type: 'problem', code: 'same-token' });
    expect(run('plan_swap', { sell: 'BTC', buy: 'MESH', amount: '0.01' }).card).toMatchObject({ type: 'problem', code: 'no-route' });
  });
  it('plan_strategy drafts a Mesh position from words', () => {
    const out = run('plan_strategy', { style: 'accumulate', token: 'MESH', budget: 'a quarter', risk: 'low' });
    expect(out.draft).toMatchObject({ kind: 'mesh', style: 'accumulate', risk: 'low', depositSats: '25000000' });
    expect(run('plan_strategy', { style: 'Market make', token: 'MESH', budget: '0.1', token_budget: 'half' }).draft).toMatchObject({ style: 'market-make', depositTokens: '25000' });
  });
  it('plan_loan works from the saved BTC price and marks testnet plans', () => {
    const out = run('plan_loan', { collateral: 'half', ltv: 40 });
    expect(out.card).toMatchObject({ type: 'loan', plan: { borrowUsd: 400, testnet: true } });
  });
  it('analyze_history summarizes transactions and statuses', () => {
    const out = run('analyze_history', { filter: 'swaps' });
    expect(out.card).toMatchObject({ type: 'history_analysis', summary: { total: 1 } });
  });
  it('analyze_positions reports health of Mesh positions', () => {
    const out = run('analyze_positions', {});
    expect(out.card).toMatchObject({ type: 'position_analysis', positions: [] });
  });
  it('simulate_strategy simulates price change effect and bin fills', () => {
    const out = run('simulate_strategy', { token: 'MESH', move_percent: 15 });
    expect(out.card).toMatchObject({ type: 'simulation', result: { tokenSymbol: 'MESH', direction: 'up', binsCrossed: 30 } });
  });
  it('explain falls back to a known topic', () => {
    expect(run('explain', { topic: 'dutch auction' }).card).toEqual({ type: 'explain', topic: 'dutch-auction' });
    expect(run('explain', { topic: 'nonsense' }).card).toEqual({ type: 'explain', topic: 'self-custody' });
  });
  it('every tool schema is small', () => {
    for (const t of AGENT_TOOLS) expect(JSON.stringify(t.def).length).toBeLessThan(900);
  });
});

describe('ThinkFilter', () => {
  it('drops think blocks split across chunks', () => {
    const f = new ThinkFilter();
    const out = ['Hi <thi', 'nk>secret', ' stuff</th', 'ink> there'].map(c => f.push(c)).join('') + f.flush();
    expect(out).toBe('Hi  there');
  });
});

describe('extractInlineCalls', () => {
  it('takes Qwen tool-call blocks out of plain text', () => {
    const r = extractInlineCalls('ok <tool_call>{"name":"wallet_balance","arguments":{}}</tool_call>', () => 'x');
    expect(r.calls).toEqual([{ id: 'x', name: 'wallet_balance', arguments: {} }]);
    expect(r.rest).toBe('ok');
  });
});

// ── the loop, with a scripted model ─────────────────────────────────────────

function scripted(turns: LlmEvent[][]): LlmClient & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    async *chat(messages) {
      seen.push(messages);
      for (const ev of turns.shift() ?? []) yield ev;
    },
  };
}

const thread = (): Thread => ({ id: 't', title: '', createdAt: 0, updatedAt: 0, accountIndex: 0, mode: 'testnet', messages: [] });

async function collect(gen: AsyncGenerator<TurnEvent>) {
  const events: TurnEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('runTurn', () => {
  it('runs the tool the model picks and returns its card without a second pass', async () => {
    const llm = scripted([[{ type: 'toolCall', call: { id: 'c1', name: 'plan_swap', arguments: { sell: 'BCH', buy: 'MESH', amount: 'half' } } }, { type: 'done' }]]);
    const events = await collect(runTurn(thread(), 'could you swap half my bch for mesh please', { llm, snapshot, newId: () => `m${++n}` }));
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.message.cards?.[0]).toMatchObject({ type: 'draft', draft: { kind: 'swap', amount: { value: '50000000' } } });
    expect(llm.seen).toHaveLength(1);
    expect(llm.seen[0]![0]!.content).toContain('/no_think');
  });
  it('streams a plain reply when no tool is needed, without think tags', async () => {
    const llm = scripted([[{ type: 'text', delta: '<think></think>Hello' }, { type: 'text', delta: '!' }, { type: 'done' }]]);
    const events = await collect(runTurn(thread(), 'hi', { llm, snapshot, newId: () => `m${++n}` }));
    const done = events.at(-1);
    expect(done?.type === 'done' && done.message.text).toBe('Hello!');
  });
  it('marks a failed model as an error and keeps going', async () => {
    const llm: LlmClient = { async *chat() { throw new Error('boom'); } };
    const events = await collect(runTurn(thread(), 'hi', { llm, snapshot, newId: () => 'e' }));
    const done = events.at(-1);
    expect(done?.type === 'done' && done.message.error).toBe('model');
  });
  it('ignores tools the model invents', async () => {
    const llm = scripted([[{ type: 'toolCall', call: { id: 'c', name: 'send_all_funds', arguments: { to: 'x' } } }, { type: 'done' }]]);
    const events = await collect(runTurn(thread(), 'send everything', { llm, snapshot, newId: () => 'z' }));
    const done = events.at(-1);
    expect(done?.type === 'done' && done.message.cards).toBeUndefined();
    expect(done?.type === 'done' && done.message.error).toBe('empty');
  });
});

describe('chat context', () => {
  const long = (): Thread => {
    const t = thread();
    for (let i = 0; i < 40; i++) {
      t.messages.push({ id: `u${i}`, at: i, role: 'user', text: `question ${i} ${'x'.repeat(200)}` });
      t.messages.push({ id: `a${i}`, at: i, role: 'assistant', text: `answer ${i}`, facts: [`fact ${i}`] });
    }
    return t;
  };
  it('keeps the latest messages within the budget, starting with the user', () => {
    const ctxMsgs = contextFor(long());
    expect(ctxMsgs[0]!.role).toBe('user');
    expect(ctxMsgs.at(-1)!.content).toContain('fact 39');
    expect(ctxMsgs.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(5200);
  });
  it('summarises what fell out of the window, then leaves it out', async () => {
    const t = long();
    const older = unsummarised(t);
    expect(older.length).toBeGreaterThan(4);
    const llm = scripted([[{ type: 'text', delta: 'User asked many questions.' }, { type: 'done' }]]);
    const next = await summarise(t, llm);
    expect(next.summary).toBe('User asked many questions.');
    expect(next.summarisedThrough).toBe(older.length);
    expect(contextFor(next)[0]).toEqual({ role: 'system', content: 'Earlier in this chat: User asked many questions.' });
  });
});

describe('quickIntent', () => {
  const q = (t: string) => quickIntent(t, () => 'q');
  it('reads swaps the right way round', () => {
    expect(q('Swap 0.01 BCH for PUSDTEST')).toEqual({ id: 'q', name: 'plan_swap', arguments: { amount: '0.01', sell: 'BCH', buy: 'PUSDTEST' } });
    expect(q('sell half my MESH for BCH')?.arguments).toEqual({ amount: 'half', sell: 'MESH', buy: 'BCH' });
    expect(q('trade 25% of my usdc on base to usdc on ethereum')?.arguments).toEqual({ amount: '25%', sell: 'usdc on base', buy: 'usdc on ethereum' });
    expect(q('buy MESH with 0.1 BCH')?.arguments).toEqual({ buy: 'MESH', amount: '0.1', sell: 'BCH' });
  });
  it('reads bridges only to known chains', () => {
    expect(q('bridge all my USDC to base')?.arguments).toEqual({ amount: 'all', sell: 'USDC', buy: 'usdc on base' });
    expect(q('send 5 USDC to 0xabc')).toBeNull();
  });
  it('reads balance, positions and activity questions', () => {
    expect(q('What do I hold?')?.name).toBe('wallet_balance');
    expect(q('show my positions')?.name).toBe('my_positions');
    expect(q('recent activity')?.name).toBe('recent_activity');
    expect(q('analyze history')?.name).toBe('analyze_history');
    expect(q('analyze positions')?.name).toBe('analyze_positions');
    expect(q('simulate strategy on MESH with 15%')?.name).toBe('simulate_strategy');
  });
  it('leaves anything less clear to the model', () => {
    expect(q('swap it for something cheaper')).toBeNull();
    expect(q('tell me a story about a frog')).toBeNull();
  });
});

describe('call JSON in replies', () => {
  it('is never shown, tagged or bare', () => {
    expect(stripToolCallText('{"name": "plan_swap", "arguments": {"amount": "0.01", "buy": "BCH", "sell": "PUSD"}}')).toBe('');
    expect(stripToolCallText('Done. <tool_call>{"name":"x","arguments":{}}</tool_call>')).toBe('Done.');
  });
  it('a bare call printed as text still runs', () => {
    const r = extractInlineCalls('{"name": "wallet_balance", "arguments": {}}', () => 'b');
    expect(r.calls).toEqual([{ id: 'b', name: 'wallet_balance', arguments: {} }]);
    expect(r.rest).toBe('');
  });
  it('the loop skips the model for a clear request and hides printed JSON otherwise', async () => {
    const never: LlmClient = { async *chat() { throw new Error('the model should not be asked'); } };
    const events = await collect(runTurn(thread(), 'swap 0.01 BCH for MESH', { llm: never, snapshot, newId: () => `k${++n}` }));
    const done = events.at(-1);
    expect(done?.type === 'done' && done.message.cards?.[0]).toMatchObject({ type: 'draft', draft: { sell: { symbol: 'BCH' }, buy: { symbol: 'MESH' } } });
    const llm = scripted([[{ type: 'text', delta: '{"name": "wallet_balance", "arguments": {}}' }, { type: 'toolCall', call: { id: 'c', name: 'wallet_balance', arguments: {} } }, { type: 'done' }]]);
    const ev2 = await collect(runTurn(thread(), 'how am I doing', { llm, snapshot, newId: () => `k${++n}` }));
    const d2 = ev2.at(-1);
    expect(d2?.type === 'done' && d2.message.text).toBe('');
    expect(d2?.type === 'done' && d2.message.cards?.[0]?.type).toBe('portfolio');
  });
});
