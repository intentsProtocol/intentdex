/**
 * The on-device agent's shapes: what the model sees, what the wallet saves, what the screen draws.
 *
 * Everything here is plain JSON (amounts are decimal strings of base units), so a snapshot, a chat and a draft
 * can be saved as they are and read back offline. The agent never holds a key: the snapshot carries balances
 * and addresses only, and a draft is a description of an action, not a transaction.
 */
import type { NetworkMode } from '../chains';

// ── What the model exchanges ────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** On an assistant message: the tools it asked for. */
  toolCalls?: ToolCall[];
  /** On a tool message: which call it answers. */
  toolCallId?: string;
  toolName?: string;
}

/** A JSON Schema object, kept small: small models choose tools better from short schemas. */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean'; description?: string; enum?: readonly string[] }>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolSchema;
}

export type ToolChoice = 'auto' | 'required' | 'none';

export type LlmEvent =
  | { type: 'text'; delta: string }
  | { type: 'toolCall'; call: ToolCall }
  | { type: 'toolError'; message: string }
  | { type: 'done'; stopReason?: string };

export interface ChatOptions {
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
  /** Upper bound on generated tokens. */
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** The model behind one door: QVAC in the app, QVAC's HTTP server in the extension, a script in tests. */
export interface LlmClient {
  chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<LlmEvent>;
}

// ── What the wallet saves for offline use ───────────────────────────────────

export interface SnapshotAsset {
  /** The Asset id: `${networkKey}:${ref}`. */
  id: string;
  network: string;
  family: 'bch' | 'evm' | 'solana' | 'btc';
  networkName: string;
  kind: 'native' | 'erc20' | 'spl' | 'cashtoken';
  ref: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Base units, decimal string. */
  balance: string;
  /** USD per whole token, when something priced it. Testnet funds have none. */
  usd?: number;
}

/** A CashToken with a pool price, from the relayer's list. */
export interface SnapshotToken {
  category: string;
  symbol: string;
  name: string;
  decimals: number;
  /** BCH satoshis per token base unit; 0 when the pool has no price. */
  priceSats: number;
}

export interface SnapshotPosition {
  id: string;
  category: string;
  name: string;
  tokenCat: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  shape: string;
  binStepBps: number;
  lowIndex: number;
  highIndex: number;
  binCount: number;
  /** Sats per token base unit at the lowest bid and the highest ask. */
  lowSatsPerUnit: number;
  highSatsPerUnit: number;
}

export interface SnapshotActivity {
  kind: string;
  status: string;
  at: number;
  network: string;
  sent?: string;
  received?: string;
}

export interface WalletSnapshot {
  version: 1;
  /** When the balances were read, ms since epoch. */
  at: number;
  mode: NetworkMode;
  accountIndex: number;
  assets: SnapshotAsset[];
  tokens: SnapshotToken[];
  positions: SnapshotPosition[];
  activity: SnapshotActivity[];
  /** USD prices by symbol (BCH, BTC, ETH, SOL, USDC), for planning on testnet too. */
  usd: Record<string, number>;
}

// ── What the screen draws ───────────────────────────────────────────────────

export interface AmountRef {
  /** Base units, decimal string. */
  value: string;
  decimals: number;
  symbol: string;
}

export interface TokenRef {
  symbol: string;
  network: string;
  networkName: string;
  /** Asset id when the wallet holds it. */
  assetId?: string;
  /** 'native', a contract, a mint or a CashToken category. */
  ref: string;
  decimals: number;
}

export type SwapProduct = 'cashtoken' | 'cctp' | 'jupiter';

export interface UnderfundedInfo {
  tokenSymbol: string;
  required: string;
  missing: string;
  available: string;
  decimals: number;
}

export interface SwapDraft {
  kind: 'swap';
  sell: TokenRef;
  buy: TokenRef;
  amount: AmountRef;
  product: SwapProduct;
  underfunded?: UnderfundedInfo;
  destinationGasWarning?: string;
}

export type StrategyStyle = 'accumulate' | 'take-profit' | 'range' | 'market-make' | 'peg' | 'limit';
export type Risk = 'low' | 'medium' | 'high';
export type MeshShape = 'spot' | 'curve' | 'bidask';

export interface MeshDraft {
  kind: 'mesh';
  style: StrategyStyle;
  risk: Risk;
  token: { category: string; symbol: string; decimals: number };
  shape: MeshShape;
  strength: 'gentle' | 'standard' | 'aggressive';
  binStepBps: number;
  lowIndex: number;
  highIndex: number;
  marketIndex: number;
  binCount: number;
  buyBins: number;
  sellBins: number;
  /** Sats per token base unit. */
  marketPrice: number;
  lowPrice: number;
  highPrice: number;
  depositSats: string;
  depositTokens: string;
  warnings: StrategyWarning[];
  underfunded?: UnderfundedInfo;
}

export type StrategyWarning = 'no-tokens-to-sell' | 'budget-split-thin' | 'wide-range' | 'testnet-price' | 'insufficient-balance';

export interface LoanPlan {
  kind: 'loan';
  collateral: AmountRef;
  btcUsd: number;
  ltv: number;
  maxLtv: number;
  liquidationLtv: number;
  borrowUsd: number;
  liquidationPriceUsd: number;
  /** Collateral value × liquidation threshold ÷ debt. Above 1 is safe; 1 is liquidation. */
  health: number;
  priceAt: number;
  /** Planned from testnet BTC: an illustration, since Liquidium is mainnet only. */
  testnet?: boolean;
  underfunded?: UnderfundedInfo;
}

export type Draft = SwapDraft | MeshDraft;

export type ExplainTopic =
  | 'intent' | 'dutch-auction' | 'mesh-position' | 'bins' | 'ltv' | 'liquidation' | 'cctp' | 'offline' | 'self-custody';

export interface PortfolioRow { symbol: string; networkName: string; amount: AmountRef; usd?: number }

export interface PositionHealthReport {
  id: string;
  name: string;
  tokenSymbol: string;
  shape: string;
  binCount: number;
  marketPriceSats: number;
  lowSats: number;
  highSats: number;
  status: 'in-range' | 'below-range' | 'above-range';
  percentInRange?: number;
  advice: string;
}

export interface HistorySummary {
  total: number;
  filter?: string;
  breakdownByStatus: Record<string, number>;
  breakdownByNetwork: Record<string, number>;
  items: SnapshotActivity[];
}

export interface SimulationResult {
  tokenSymbol: string;
  currentPriceSats: number;
  movePercent: number;
  simulatedPriceSats: number;
  binsCrossed: number;
  estimatedFeeSats: number;
  projectedApyPct: number;
  direction: 'up' | 'down';
  actionSummary: string;
}

export type Card =
  | { type: 'portfolio'; at: number; mode: NetworkMode; totalUsd?: number; rows: PortfolioRow[]; more: number }
  | { type: 'positions'; at: number; rows: SnapshotPosition[] }
  | { type: 'activity'; at: number; rows: SnapshotActivity[] }
  | { type: 'draft'; draftId: string; draft: Draft }
  | { type: 'loan'; plan: LoanPlan }
  | { type: 'explain'; topic: ExplainTopic }
  | { type: 'position_analysis'; at: number; positions: PositionHealthReport[] }
  | { type: 'history_analysis'; at: number; summary: HistorySummary }
  | { type: 'simulation'; at: number; result: SimulationResult }
  | { type: 'problem'; code: ProblemCode; vars?: Record<string, string> };

export type ProblemCode =
  | 'unknown-token' | 'no-balance' | 'bad-amount' | 'exceeds-balance' | 'same-token' | 'no-route'
  | 'no-price' | 'no-btc' | 'not-on-mainnet' | 'unsupported-style' | 'too-small';

/** What a tool hands back: the card for the screen, and a short fact sheet for the model. */
export interface ToolOutput {
  card: Card;
  /** Compact JSON-ish text the model may read to write its reply. */
  facts: string;
  /** True when a written reply adds something to the card (an explanation). Most cards speak for themselves. */
  narrate?: boolean;
  /** Set for cards that hold a draft, so the host can file it in the outbox. */
  draft?: Draft;
}

export interface ToolContext {
  snapshot: WalletSnapshot;
  now: number;
  newId: () => string;
}

export interface AgentTool {
  def: ToolDef;
  run(args: Record<string, unknown>, ctx: ToolContext): ToolOutput;
}
