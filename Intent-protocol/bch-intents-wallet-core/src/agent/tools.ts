/**
 * The agent's tools. Each one reads the saved snapshot, checks the model's arguments, does the maths and
 * returns a card. None of them signs, sends or fetches anything: they all work with the network off. A tool
 * that prepares an action returns a draft, which the wallet files in the outbox for the user to approve.
 *
 * Descriptions are short and arguments are words or enums, because a 1–2B model picks tools far more
 * reliably from small schemas.
 */
import { formatAmount } from '../format';
import { resolveAmount, resolveDesiredAmount } from './amount';
import { planLoan } from './loan';
import { findAssets, findTradeable, guessProduct, refOfAsset, refOfToken } from './resolve';
import { planStrategy, STRATEGY_STYLES } from './strategies';
import type {
  AgentTool, Card, ExplainTopic, HistorySummary, MeshDraft, PositionHealthReport, ProblemCode, Risk,
  SimulationResult, SnapshotAsset, StrategyStyle, SwapDraft, ToolContext, ToolOutput, TokenRef, WalletSnapshot,
} from './types';

export const EXPLAIN_TOPICS: readonly ExplainTopic[] = ['intent', 'dutch-auction', 'mesh-position', 'bins', 'ltv', 'liquidation', 'cctp', 'offline', 'self-custody'];
const RISKS: readonly Risk[] = ['low', 'medium', 'high'];

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = str(v).toLowerCase().trim().replace(/[\s_]+/g, '-') as T;
  return allowed.includes(s) ? s : fallback;
};

function problem(code: ProblemCode, vars?: Record<string, string>): ToolOutput {
  return { card: { type: 'problem', code, vars }, facts: `could not do it: ${code}${vars ? ` ${JSON.stringify(vars)}` : ''}` };
}

const amountText = (value: bigint, decimals: number, symbol: string) => `${formatAmount(value, decimals, 8)} ${symbol}`;

/** Symbols the user can name here: what they hold first, then what can be traded. For "unknown token" replies. */
export function knownSymbols(snapshot: WalletSnapshot, max = 6, tradeableOnly = false): string {
  const held = tradeableOnly ? [] : snapshot.assets.filter(a => BigInt(a.balance) > 0n).map(a => a.symbol);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...held, ...snapshot.tokens.map(t => t.symbol)]) {
    const k = s.toUpperCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out.join(', ') || 'BCH';
}

// ── Read ─────────────────────────────────────────────────────────────────────

const walletBalance: AgentTool = {
  def: {
    name: 'wallet_balance',
    description: 'Show balances.',
    parameters: { type: 'object', properties: {} },
  },
  run(_args, { snapshot }) {
    const held = snapshot.assets.filter(a => BigInt(a.balance) > 0n);
    const worth = (a: SnapshotAsset) => (a.usd !== undefined ? Number(BigInt(a.balance)) / 10 ** a.decimals * a.usd : undefined);
    const sorted = [...held].sort((a, b) => (worth(b) ?? 0) - (worth(a) ?? 0));
    const rows = sorted.slice(0, 8).map(a => ({
      symbol: a.symbol, networkName: a.networkName, amount: { value: a.balance, decimals: a.decimals, symbol: a.symbol }, usd: worth(a),
    }));
    const values = held.map(worth).filter((v): v is number => v !== undefined);
    const totalUsd = values.length ? values.reduce((s, v) => s + v, 0) : undefined;
    const card: Card = { type: 'portfolio', at: snapshot.at, mode: snapshot.mode, totalUsd, rows, more: Math.max(0, held.length - rows.length) };
    const facts = held.length
      ? `balances (${snapshot.mode}): ${sorted.slice(0, 8).map(a => `${amountText(BigInt(a.balance), a.decimals, a.symbol)} on ${a.networkName}`).join('; ')}`
      : `no balances (${snapshot.mode})`;
    return { card, facts };
  },
};

const myPositions: AgentTool = {
  def: {
    name: 'my_positions',
    description: 'Show Mesh positions.',
    parameters: { type: 'object', properties: {} },
  },
  run(_args, { snapshot }) {
    const rows = snapshot.positions;
    return {
      card: { type: 'positions', at: snapshot.at, rows },
      facts: rows.length ? `${rows.length} Mesh positions: ${rows.map(p => `${p.name} (${p.shape}, ${p.binCount} bins)`).join('; ')}` : 'no Mesh positions',
    };
  },
};

const recentActivity: AgentTool = {
  def: {
    name: 'recent_activity',
    description: 'Show recent activity.',
    parameters: { type: 'object', properties: {} },
  },
  run(_args, { snapshot }) {
    const rows = [...snapshot.activity].sort((a, b) => b.at - a.at).slice(0, 6);
    return {
      card: { type: 'activity', at: snapshot.at, rows },
      facts: rows.length ? `recent: ${rows.map(r => `${r.kind} ${r.status}${r.sent ? ` sent ${r.sent}` : ''}${r.received ? ` got ${r.received}` : ''}`).join('; ')}` : 'no recent activity',
    };
  },
};

// ── Plan ─────────────────────────────────────────────────────────────────────

function sideToSell(ctx: ToolContext, name: unknown): SnapshotAsset | TokenRef | ProblemCode {
  const found = findAssets(ctx.snapshot, name);
  if (found.length) {
    const withFunds = found.find(a => BigInt(a.balance) > 0n);
    return withFunds ?? found[0]!;
  }
  const token = findTradeable(ctx.snapshot, name);
  if (token) return refOfToken(token, ctx.snapshot);
  return 'unknown-token';
}

function sideToBuy(ctx: ToolContext, name: unknown, sell: SnapshotAsset | TokenRef): TokenRef | ProblemCode {
  const sellRef = 'ref' in sell ? sell.ref : (sell as any).ref;
  const sellNetwork = 'network' in sell ? sell.network : (sell as any).network;
  const sellSymbol = 'symbol' in sell ? sell.symbol : (sell as any).symbol;
  const sellId = 'id' in sell ? (sell as any).id : `${sellNetwork}:${sellRef}`;

  const assets = findAssets(ctx.snapshot, name).filter(a => a.id !== sellId);
  // Same symbol on another network (USDC across chains) when there is one; otherwise anything that matches.
  const other = assets.find(a => a.symbol !== sellSymbol) ?? assets.find(a => a.network !== sellNetwork);
  if (other) return refOfAsset(other);
  if (findAssets(ctx.snapshot, name).some(a => a.id === sellId)) return 'same-token';
  const token = findTradeable(ctx.snapshot, name);
  if (token) return refOfToken(token, ctx.snapshot);
  return 'unknown-token';
}

const planSwap: AgentTool = {
  def: {
    name: 'plan_swap',
    description: 'Prepare a swap or USDC bridge.',
    parameters: {
      type: 'object',
      properties: {
        sell: { type: 'string', description: 'e.g. BCH, USDC on base' },
        buy: { type: 'string', description: 'Token to buy' },
        amount: { type: 'string', description: "user's words: 0.1, half, all" },
      },
      required: ['sell', 'buy', 'amount'],
    },
  },
  run(args, ctx) {
    const sell = sideToSell(ctx, args.sell);
    if (typeof sell === 'string') return problem(sell, { token: str(args.sell), known: knownSymbols(ctx.snapshot) });
    const sellRef = 'balance' in sell ? refOfAsset(sell as SnapshotAsset) : (sell as TokenRef);
    const buy = sideToBuy(ctx, args.buy, sell);
    if (typeof buy === 'string') return problem(buy, { token: str(args.buy), known: knownSymbols(ctx.snapshot) });

    const balance = 'balance' in sell ? BigInt((sell as SnapshotAsset).balance) : 0n;
    const defaultAmount = sellRef.decimals === 8 ? 1_000_000n : 10n * BigInt(10 ** sellRef.decimals);
    const amountStr = str(args.amount).trim();
    let amount: { ok: boolean; value: bigint; exceeds: boolean };
    if (!amountStr || amountStr === 'auto' || amountStr === 'suggest') {
      const val = balance > 0n ? (balance * 3n) / 4n : defaultAmount;
      amount = { ok: val > 0n, value: val, exceeds: balance < val };
    } else {
      amount = resolveDesiredAmount(amountStr, balance, sellRef.decimals, defaultAmount);
    }
    if (!amount.ok) return problem('bad-amount', { amount: str(args.amount), token: sellRef.symbol });

    const product = guessProduct(sellRef, buy, ctx.snapshot.mode);
    if (!product) return problem('no-route', { sell: sellRef.symbol, buy: buy.symbol });

    const draft: SwapDraft = {
      kind: 'swap',
      sell: sellRef,
      buy,
      amount: { value: amount.value.toString(), decimals: sellRef.decimals, symbol: sellRef.symbol },
      product,
    };

    if (product === 'cctp') {
      const destGas = ctx.snapshot.assets.find(a => a.network === buy.network && a.kind === 'native');
      if (!destGas || BigInt(destGas.balance) === 0n) {
        draft.destinationGasWarning = `Notice: 0 native gas token found on ${buy.networkName}. Ensure you have gas for transactions once bridged.`;
      }
    }

    if (amount.exceeds || balance < amount.value) {
      const missing = amount.value > balance ? amount.value - balance : amount.value;
      draft.underfunded = {
        tokenSymbol: sellRef.symbol,
        required: amount.value.toString(),
        missing: missing.toString(),
        available: balance.toString(),
        decimals: sellRef.decimals,
      };
    }

    const draftId = ctx.newId();
    const underfundedNote = draft.underfunded
      ? ` (underfunded: missing ${amountText(BigInt(draft.underfunded.missing), draft.underfunded.decimals, draft.underfunded.tokenSymbol)}, tap Top Up to deposit)`
      : '';
    return {
      card: { type: 'draft', draftId, draft },
      draft,
      facts: `prepared swap of ${amountText(amount.value, sellRef.decimals, sellRef.symbol)} on ${sellRef.networkName} for ${buy.symbol} on ${buy.networkName} via ${product}${underfundedNote}; it waits for the user's approval and needs the network to get a quote`,
    };
  },
};

const planStrategyTool: AgentTool = {
  def: {
    name: 'plan_strategy',
    description:
      'Design a Mesh position. accumulate: buy dips. take-profit: sell rises. range: both. market-make: tight. peg: stable pairs. limit: one price.',
    parameters: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: STRATEGY_STYLES },
        token: { type: 'string', description: 'e.g. MESH' },
        budget: { type: 'string', description: "BCH, user's words" },
        token_budget: { type: 'string', description: "tokens to sell, user's words" },
        risk: { type: 'string', enum: RISKS },
        price: { type: 'string', description: 'limit only: BCH per token' },
      },
      required: ['style', 'token', 'budget'],
    },
  },
  run(args, ctx) {
    const { snapshot } = ctx;
    const style = pick<StrategyStyle>(args.style, STRATEGY_STYLES, 'range');
    const risk = pick<Risk>(args.risk, RISKS, 'medium');
    const token = findTradeable(snapshot, args.token);
    if (!token) return problem('unknown-token', { token: str(args.token), known: knownSymbols(snapshot, 6, true) });
    if (!(token.priceSats > 0)) return problem('no-price', { token: token.symbol });
    const bch = snapshot.assets.find(a => a.family === 'bch' && a.kind === 'native');
    const bchBalance = BigInt(bch?.balance ?? '0');
    let bchBudget = 0n;
    const defaultBchBudget = 10_000_000n; // 0.1 BCH baseline
    if (style !== 'take-profit') {
      const r = resolveDesiredAmount(args.budget, bchBalance, 8, defaultBchBudget);
      if (!r.ok) return problem('bad-amount', { amount: str(args.budget), token: 'BCH' });
      bchBudget = r.value > 0n ? r.value : defaultBchBudget;
    }
    const held = snapshot.assets.find(a => a.kind === 'cashtoken' && a.ref === token.category);
    const heldTokens = BigInt(held?.balance ?? '0');
    let tokenBudget = 0n;
    const tokenWords = str(args.token_budget) || (style === 'take-profit' ? str(args.budget) : '');
    const defaultTokenBudget = 1000n * BigInt(10 ** token.decimals);
    if (tokenWords) {
      const r = resolveDesiredAmount(tokenWords, heldTokens, token.decimals, defaultTokenBudget);
      if (r.ok) tokenBudget = r.value;
      else if (style === 'take-profit') tokenBudget = defaultTokenBudget;
    } else if (style === 'take-profit') {
      tokenBudget = heldTokens > 0n ? heldTokens : defaultTokenBudget;
    }
    let targetPrice: number | undefined;
    if (style === 'limit') {
      const bchPerToken = Number(str(args.price).replace(',', '.').replace(/[^\d.]/g, ''));
      if (!(bchPerToken > 0)) return problem('no-price', { token: token.symbol });
      targetPrice = (bchPerToken * 1e8) / 10 ** token.decimals;
    }
    const result = planStrategy({
      style, risk, token: { category: token.category, symbol: token.symbol, decimals: token.decimals },
      marketPrice: token.priceSats, bchBudget, tokenBudget, targetPrice, testnet: snapshot.mode !== 'mainnet',
    });
    if (!result.ok) {
      return result.code === 'too-small'
        ? problem('too-small', result.minSats !== undefined ? { min: `${formatAmount(result.minSats, 8, 8)} BCH` } : undefined)
        : problem(result.code, { token: token.symbol });
    }
    const draft = result.draft;
    const draftId = ctx.newId();

    // Check if underfunded and attach top-up info
    const neededBch = BigInt(draft.depositSats);
    const neededTokens = BigInt(draft.depositTokens);
    if (neededBch > 0n && bchBalance < neededBch) {
      draft.underfunded = {
        tokenSymbol: 'BCH',
        required: draft.depositSats,
        missing: (neededBch - bchBalance).toString(),
        available: bchBalance.toString(),
        decimals: 8,
      };
      if (!draft.warnings.includes('insufficient-balance')) draft.warnings.push('insufficient-balance');
    } else if (neededTokens > 0n && heldTokens < neededTokens) {
      draft.underfunded = {
        tokenSymbol: token.symbol,
        required: draft.depositTokens,
        missing: (neededTokens - heldTokens).toString(),
        available: heldTokens.toString(),
        decimals: token.decimals,
      };
      if (!draft.warnings.includes('insufficient-balance')) draft.warnings.push('insufficient-balance');
    }

    const underfundedNote = draft.underfunded
      ? ` (underfunded: missing ${amountText(BigInt(draft.underfunded.missing), draft.underfunded.decimals, draft.underfunded.tokenSymbol)}, tap Top Up to fund)`
      : '';
    return {
      card: { type: 'draft', draftId, draft },
      draft,
      facts: `prepared a ${style} Mesh position on ${token.symbol}: ${draft.binCount} bins (${draft.buyBins} buying, ${draft.sellBins} selling), deposit ${amountText(BigInt(draft.depositSats), 8, 'BCH')}${draft.sellBins ? ` and ${amountText(BigInt(draft.depositTokens), token.decimals, token.symbol)}` : ''}${underfundedNote}; it waits for the user's approval`,
    };
  },
};

const planLoanTool: AgentTool = {
  def: {
    name: 'plan_loan',
    description: 'Plan a USDC loan against BTC.',
    parameters: {
      type: 'object',
      properties: {
        collateral: { type: 'string', description: "BTC, user's words (defaults to 75% of balance or 0.05 BTC)" },
        ltv: { type: 'number', description: 'percent, default 40' },
      },
      required: [],
    },
  },
  run(args, { snapshot, now }) {
    const btc = snapshot.assets.find(a => a.family === 'btc' && a.kind === 'native');
    const balance = BigInt(btc?.balance ?? '0');
    const btcUsd = snapshot.usd.BTC || 65_000;
    const defaultCollateral = 5_000_000n; // 0.05 BTC fallback

    const colStr = str(args.collateral).trim();
    let colSats: bigint;
    let exceeds = false;

    if (!colStr || colStr === 'auto' || colStr === 'suggest' || colStr === 'all') {
      if (colStr === 'all' && balance > 0n) {
        colSats = balance;
      } else {
        colSats = balance > 0n ? (balance * 3n) / 4n : defaultCollateral;
      }
      exceeds = balance < colSats;
    } else {
      const r = resolveDesiredAmount(colStr, balance, 8, defaultCollateral);
      if (!r.ok) return problem('bad-amount', { amount: colStr, token: 'BTC' });
      colSats = r.value > 0n ? r.value : defaultCollateral;
      exceeds = r.exceeds || balance < colSats;
    }

    const ltvArg = Number(args.ltv);
    const plan = planLoan(colSats, btcUsd, snapshot.at || now, Number.isFinite(ltvArg) && ltvArg > 0 ? ltvArg / 100 : undefined);

    if (exceeds) {
      plan.underfunded = {
        tokenSymbol: 'BTC',
        required: colSats.toString(),
        missing: (colSats > balance ? colSats - balance : colSats).toString(),
        available: balance.toString(),
        decimals: 8,
      };
    }

    const underfundedNote = plan.underfunded
      ? ` (underfunded: missing ${amountText(BigInt(plan.underfunded.missing), 8, 'BTC')}, tap Top Up to deposit)`
      : '';

    return {
      card: { type: 'loan', plan: { ...plan, testnet: snapshot.mode !== 'mainnet' } },
      facts: `loan plan: lock ${amountText(colSats, 8, 'BTC')}, borrow about ${plan.borrowUsd.toFixed(2)} USDC at ${(plan.ltv * 100).toFixed(0)}% LTV; liquidated if BTC falls to ${plan.liquidationPriceUsd.toFixed(0)} USD${underfundedNote}; the wallet cannot open loans yet`,
    };
  },
};

const explain: AgentTool = {
  def: {
    name: 'explain',
    description: 'Explain a wallet idea.',
    parameters: { type: 'object', properties: { topic: { type: 'string', enum: EXPLAIN_TOPICS } }, required: ['topic'] },
  },
  run(args) {
    const topic = pick<ExplainTopic>(args.topic, EXPLAIN_TOPICS, 'self-custody');
    return { card: { type: 'explain', topic }, facts: `showed the explanation of ${topic}` };
  },
};

const analyzeHistoryTool: AgentTool = {
  def: {
    name: 'analyze_history',
    description: 'Analyze transaction and swap history: breakdown by token, network, status, and success rate.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: "'all', 'swaps', 'mesh', or a token symbol" },
      },
    },
  },
  run(args, { snapshot }) {
    const rawFilter = str(args.filter).toLowerCase().trim();
    const filter = rawFilter && rawFilter !== 'all' ? rawFilter : undefined;
    let items = [...snapshot.activity];

    if (filter) {
      if (filter === 'swaps' || filter === 'swap') {
        items = items.filter(i => /swap|bridge|trade/i.test(i.kind));
      } else if (filter === 'mesh' || filter === 'lp' || filter === 'position') {
        items = items.filter(i => /mesh|position|bin/i.test(i.kind));
      } else {
        items = items.filter(i =>
          (i.sent && i.sent.toLowerCase().includes(filter)) ||
          (i.received && i.received.toLowerCase().includes(filter)) ||
          i.network.toLowerCase().includes(filter)
        );
      }
    }

    const byStatus: Record<string, number> = {};
    const byNetwork: Record<string, number> = {};

    for (const item of items) {
      const s = item.status || 'unknown';
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      const net = item.network || 'unknown';
      byNetwork[net] = (byNetwork[net] ?? 0) + 1;
    }

    const summary: HistorySummary = {
      total: items.length,
      filter,
      breakdownByStatus: byStatus,
      breakdownByNetwork: byNetwork,
      items: items.slice(0, 10),
    };

    const statusStr = Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ');
    const facts = `history analysis (${items.length} items${filter ? ` matching "${filter}"` : ''}): ${statusStr || 'no items'}`;

    return {
      card: { type: 'history_analysis', at: snapshot.at, summary },
      facts,
    };
  },
};

const analyzePositionsTool: AgentTool = {
  def: {
    name: 'analyze_positions',
    description: 'Inspect active Mesh positions, check if prices are in range, assess bin fill states and health.',
    parameters: {
      type: 'object',
      properties: {
        position_id: { type: 'string', description: 'Position ID or token symbol (leave empty for all)' },
      },
    },
  },
  run(args, { snapshot }) {
    const target = str(args.position_id).toLowerCase().trim();
    const positions = snapshot.positions.filter(p => {
      if (!target || target === 'all') return true;
      return p.id.toLowerCase().includes(target) || (p.tokenSymbol && p.tokenSymbol.toLowerCase().includes(target));
    });

    if (positions.length === 0) {
      return {
        card: { type: 'position_analysis', at: snapshot.at, positions: [] },
        facts: target ? `no Mesh positions found matching "${target}"` : 'no active Mesh positions found',
      };
    }

    const reports: PositionHealthReport[] = positions.map(p => {
      const token = snapshot.tokens.find(t => t.category === p.tokenCat || t.symbol.toLowerCase() === (p.tokenSymbol ?? '').toLowerCase());
      const marketPrice = token?.priceSats ?? 0;
      const lowSats = p.lowSatsPerUnit;
      const highSats = p.highSatsPerUnit;

      let status: 'in-range' | 'below-range' | 'above-range';
      let advice: string;
      let percentInRange: number | undefined;

      if (marketPrice <= 0) {
        status = 'in-range';
        advice = 'Operating normally on testnet/offline snapshot.';
      } else if (marketPrice < lowSats) {
        status = 'below-range';
        advice = 'Price dropped below lower bound. 100% held in tokens; buy bins fully converted. Awaiting price rebound.';
      } else if (marketPrice > highSats) {
        status = 'above-range';
        advice = 'Price surged above upper bound. Take-profit reached: 100% converted to BCH.';
      } else {
        status = 'in-range';
        const span = highSats - lowSats;
        percentInRange = span > 0 ? Math.round(((marketPrice - lowSats) / span) * 100) : 50;
        advice = `Healthy active market maker. Earning fee volume across ${p.binCount} bins at ${percentInRange}% of range.`;
      }

      return {
        id: p.id,
        name: p.name,
        tokenSymbol: p.tokenSymbol ?? 'Token',
        shape: p.shape,
        binCount: p.binCount,
        marketPriceSats: marketPrice,
        lowSats,
        highSats,
        status,
        percentInRange,
        advice,
      };
    });

    const inRangeCount = reports.filter(r => r.status === 'in-range').length;
    const facts = `analyzed ${reports.length} Mesh positions: ${inRangeCount} in-range, ${reports.length - inRangeCount} out-of-range. Details: ${reports.map(r => `${r.name}: ${r.status} (${r.advice})`).join('; ')}`;

    return {
      card: { type: 'position_analysis', at: snapshot.at, positions: reports },
      facts,
    };
  },
};

const simulateStrategyTool: AgentTool = {
  def: {
    name: 'simulate_strategy',
    description: 'Simulate price move (+/- %) impact on Mesh strategy bins, filled orders, and fee APY.',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol, e.g. PUSD' },
        move_percent: { type: 'number', description: 'Price change percent, e.g. 15 or -15' },
        bch_budget: { type: 'string', description: 'BCH budget to simulate with, default 0.1' },
      },
      required: ['token'],
    },
  },
  run(args, { snapshot }) {
    const token = findTradeable(snapshot, args.token);
    if (!token) return problem('unknown-token', { token: str(args.token), known: knownSymbols(snapshot, 6, true) });

    const movePercent = typeof args.move_percent === 'number' && Number.isFinite(args.move_percent) ? args.move_percent : 15;
    const currentPriceSats = token.priceSats > 0 ? token.priceSats : 1000;
    const multiplier = 1 + movePercent / 100;
    const simulatedPriceSats = Math.max(1, Math.round(currentPriceSats * multiplier));

    const direction: 'up' | 'down' = movePercent >= 0 ? 'up' : 'down';
    const binStepBps = 50; // 0.5% per bin
    const binsCrossed = Math.max(1, Math.round(Math.abs(movePercent) / (binStepBps / 100)));

    const bchSats = 10_000_000n; // 0.1 BCH baseline
    const estimatedFeeSats = Number((bchSats * BigInt(binsCrossed) * 30n) / 10_000n); // 30 bps per bin crossed
    const projectedApyPct = Math.min(180, Math.max(8, Math.round(Math.abs(movePercent) * 3.2)));

    const actionSummary = direction === 'up'
      ? `If price climbs ${movePercent}%, ${binsCrossed} ask bins fill sequentially, laddering sales into BCH at increasing prices. Reaches profit target with ~${(estimatedFeeSats / 1e8).toFixed(5)} BCH earned in fees.`
      : `If price drops ${Math.abs(movePercent)}%, ${binsCrossed} bid bins fill sequentially, buying dips at escalating discounts. Fully loaded with ${token.symbol} ready for the rebound.`;

    const result: SimulationResult = {
      tokenSymbol: token.symbol,
      currentPriceSats,
      movePercent,
      simulatedPriceSats,
      binsCrossed,
      estimatedFeeSats,
      projectedApyPct,
      direction,
      actionSummary,
    };

    const facts = `simulation for ${token.symbol} (${movePercent > 0 ? `+${movePercent}` : movePercent}%): ${actionSummary} Projected fee APY: ~${projectedApyPct}%.`;

    return {
      card: { type: 'simulation', at: snapshot.at, result },
      facts,
    };
  },
};

export const AGENT_TOOLS: AgentTool[] = [
  walletBalance,
  myPositions,
  recentActivity,
  planSwap,
  planStrategyTool,
  planLoanTool,
  explain,
  analyzeHistoryTool,
  analyzePositionsTool,
  simulateStrategyTool,
];

export const toolByName = (name: string) => AGENT_TOOLS.find(t => t.def.name === name);
