/**
 * Requests clear enough to need no model: "swap 0.01 BCH for MESH", "sell half my MESH for BCH",
 * "buy MESH with 0.1 BCH", "bridge 5 USDC to base", "what do I hold". They map straight to a tool call,
 * which is instant and cannot get the sides of a swap the wrong way round (a 0.6B model did, on the phone).
 * Anything else goes to the model.
 */
import type { ToolCall } from './types';

const AMOUNT = String.raw`(all|max|everything|half|a\s+half|a\s+quarter|quarter|a\s+third|third|\d+(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?|[.,]\d+)`;
const TOKEN = String.raw`([a-z][\w.-]{0,15}(?:\s+on\s+[a-z][\w-]*)?)`;
const MY = String.raw`(?:of\s+)?(?:my\s+)?`;

const PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => ToolCall['arguments'] & { tool: string } }[] = [
  // swap 0.01 BCH for MESH · trade half my BCH to MESH · sell 10 MESH for BCH · convert 25% of my USDC into SOL
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:swap|trade|sell|convert|exchange)\s+${AMOUNT}\s+${MY}${TOKEN}\s+(?:for|to|into)\s+${TOKEN}[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_swap', amount: m[1]!, sell: m[2]!, buy: m[3]! }),
  },
  // buy MESH with 0.1 BCH · buy MESH using half my BCH
  {
    re: new RegExp(String.raw`^(?:please\s+)?buy\s+${TOKEN}\s+(?:with|using|for)\s+${AMOUNT}\s+${MY}${TOKEN}[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_swap', buy: m[1]!, amount: m[2]!, sell: m[3]! }),
  },
  // bridge 5 USDC to base · move all my USDC on base to ethereum
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:bridge|move|send)\s+${AMOUNT}\s+${MY}(usdc(?:\s+on\s+[a-z][\w-]*)?)\s+to\s+(base|arbitrum|arb|optimism|op|ethereum|eth|sepolia|solana|arc)[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_swap', amount: m[1]!, sell: m[2]!, buy: `usdc on ${m[3]!}` }),
  },
  { re: /^(?:what\s+do\s+i\s+(?:hold|have|own)|(?:show\s+)?(?:my\s+)?(?:balances?|portfolio|holdings|funds))\s*[.?!]*$/i, build: () => ({ tool: 'wallet_balance' }) },
  { re: /^(?:show\s+)?(?:my\s+)?(?:mesh\s+)?positions\s*[.?!]*$/i, build: () => ({ tool: 'my_positions' }) },
  { re: /^(?:show\s+)?(?:my\s+)?(?:recent\s+)?(?:activity|history|transactions)\s*[.?!]*$/i, build: () => ({ tool: 'recent_activity' }) },
  // Mesh strategies: accumulate ladder, take-profit, range, limit
  // e.g. "accumulate MESH with 0.1 BCH", "keep accumulating MESH cheaply with a quarter of my BCH", "ladder MESH with half my BCH"
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:keep\s+)?(?:accumulate|accumulating|ladder|create\s+(?:an?\s+)?accumulate\s+ladder\s+(?:for|on)|buy\s+dips\s+on)\s+${TOKEN}(?:\s+cheaply)?(?:\s+(?:with|using|for)\s+${AMOUNT}\s+${MY}(?:bch)?)?[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_strategy', style: 'accumulate', token: m[1]!, budget: m[2] || '0.1', risk: 'medium' }),
  },
  // e.g. "take profit on MESH with half my tokens", "take profit on MESH with 500 MESH"
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:take\s+profit|sell\s+high)\s+(?:on|for)\s+${TOKEN}(?:\s+(?:with|using)\s+${AMOUNT}(?:\s+${MY}${TOKEN})?)?[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_strategy', style: 'take-profit', token: m[1]!, budget: m[2] || 'half', token_budget: m[2] || 'half', risk: 'medium' }),
  },
  // e.g. "range strategy on MESH with 0.2 BCH", "market make MESH with 1 BCH", "provide liquidity for MESH with 0.5 BCH"
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:create\s+(?:a\s+)?)?(?:range\s+strategy|range|market\s+make|provide\s+liquidity)\s+(?:on|for)\s+${TOKEN}(?:\s+(?:with|using)\s+${AMOUNT}\s+${MY}(?:bch)?)?[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_strategy', style: 'range', token: m[1]!, budget: m[2] || '0.1', risk: 'medium' }),
  },
  // e.g. "limit buy MESH at 0.0001 BCH with 0.5 BCH", "limit order buy MESH at 0.0002 with 0.1 BCH"
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:limit\s+(?:order\s+)?buy|buy\s+limit)\s+${TOKEN}\s+(?:at|@)\s+([0-9.,]+)(?:\s*(?:bch|sats)?)?(?:\s+(?:with|using)\s+${AMOUNT}\s+${MY}(?:bch)?)?[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_strategy', style: 'limit', token: m[1]!, price: m[2]!, budget: m[3] || '0.1', risk: 'low' }),
  },
  // Loans: e.g. "how much USDC could I borrow on my BTC safely", "borrow USDC against 0.1 BTC"
  {
    re: new RegExp(String.raw`^(?:please\s+)?(?:how\s+much\s+(?:usdc\s+)?(?:could|can)\s+i\s+borrow\s+(?:on|against)\s+(?:${AMOUNT}\s+)?${MY}(?:btc|bitcoin)?(?:\s+safely)?|borrow\s+(?:usdc\s+)?(?:on|against)\s+${AMOUNT}\s+${MY}(?:btc|bitcoin)?(?:\s+safely)?)[.!?]*$`, 'i'),
    build: m => ({ tool: 'plan_loan', collateral: m[1] || 'all', ltv: 40 }),
  },
  // Explanations: e.g. "explain dutch auction", "explain mesh positions", "explain intents", "explain self-custody"
  {
    re: /^(?:please\s+)?(?:explain|what\s+is|what\s+are)\s+(?:a\s+|an\s+|the\s+)?(intent|intents|dutch[\s_-]auction|mesh[\s_-]position|mesh[\s_-]positions|bins?|ltv|liquidation|cctp|offline|self[\s_-]custody)[.!?]*$/i,
    build: m => {
      let t = m[1]!.toLowerCase().replace(/[\s_]+/g, '-');
      if (t === 'intents') t = 'intent';
      if (t === 'mesh-positions' || t === 'mesh') t = 'mesh-position';
      if (t === 'bin') t = 'bins';
      return { tool: 'explain', topic: t };
    },
  },
  // History analysis: e.g. "analyze history", "analyze previous swaps", "swap statistics", "analyze my trades"
  {
    re: /^(?:please\s+)?(?:analyze|breakdown|audit|stats\s+for|statistics\s+for)\s+(?:my\s+)?(?:previous\s+)?(history|swaps?|trades?|transactions?|activity|mesh)[.!?]*$/i,
    build: m => ({ tool: 'analyze_history', filter: m[1]!.toLowerCase() }),
  },
  // Position health & analysis: e.g. "analyze positions", "check position health", "are my positions in range", "position health"
  {
    re: /^(?:please\s+)?(?:analyze|check\s+(?:the\s+)?health\s+of|audit|are\s+my)\s+(?:positions?\s*(?:in\s+range)?|mesh\s+positions?|position\s+health)[.!?]*$/i,
    build: () => ({ tool: 'analyze_positions' }),
  },
  // Strategy simulation: e.g. "simulate strategy on PUSD with 15%", "simulate +15% on PUSD", "simulate -10% on PUSD"
  {
    re: new RegExp(String.raw`^(?:please\s+)?simulate\s+(?:strategy\s+)?(?:on\s+)?${TOKEN}(?:\s+(?:with|at)\s+([+-]?\d+(?:\.\d+)?)\s*%)?[.!?]*$`, 'i'),
    build: m => ({ tool: 'simulate_strategy', token: m[1]!, move_percent: m[2] ? parseFloat(m[2]) : 15 }),
  },
];

const strip = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/^(?:hey|hi|ok|okay)[,!]?\s+/i, '');

/** The tool call a clearly phrased request maps to, or null to let the model decide. */
export function quickIntent(text: string, newId: () => string): ToolCall | null {
  const t = strip(text);
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (!m) continue;
    const { tool, ...args } = p.build(m);
    // A "token" that is really a filler word means the sentence was not as simple as it looked.
    if (Object.values(args).some(v => /^(it|them|some|my|the|a)$/i.test(String(v)))) return null;
    return { id: newId(), name: tool, arguments: args };
  }
  return null;
}

/** Tool-call JSON a model printed as text, in Qwen's tags or bare: removed from what the user reads. */
export function stripToolCallText(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .replace(/\{\s*"name"\s*:\s*"[\w-]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '')
    .trim();
}
