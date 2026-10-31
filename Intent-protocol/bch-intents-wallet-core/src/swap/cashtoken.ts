/**
 * BCH ↔ CashToken market swaps through the cashtoken relayer, without React.
 *
 * A market swap is a Dutch-auction intent:
 *   1. POST /router/quote          what the solver can pay for this amount right now
 *   2. POST /intent/create         the relayer compiles a covenant for the order and answers with its address
 *   3. the wallet funds the covenant (one ordinary transaction, signed here)
 *   4. a solver fills it; GET /intent/:id is polled until it is filled, refunded or expired
 *
 * The relayer never holds the maker's key and cannot take the funds: the covenant pays the maker the agreed
 * amount or returns the deposit after the auction ends. Amounts are integer base units (satoshis for BCH).
 *
 * The auction starts at the quoted amount and decays to half of it over its duration (the relayer's default),
 * so the quote is what to expect and half of it is the floor. The UI shows both.
 */

import { cashtokenRelayerUrl } from '../platform';
import type { BchNet } from '../cashtokens';

export const BCH_TOKEN_ID = 'BCH';

export type IntentStatus = 'pending' | 'active' | 'filled' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'abandoned';
export const TERMINAL_INTENT: IntentStatus[] = ['filled', 'failed', 'cancelled', 'expired', 'refunded', 'abandoned'];

export interface Intent {
  id: string;
  type: 'LIMIT_ORDER' | 'DUTCH_AUCTION';
  makerAddress: string;
  contractAddress: string;
  tokenAddress: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  status: IntentStatus;
  createdAt: number;
  updatedAt?: number;
  duration?: number;
  fillableUntil?: number;
  refundableFrom?: number;
  startBuyAmount?: string;
  endBuyAmount?: string;
  fillPrice?: string;
  fundingTxid?: string;
  fillTxid?: string;
  refundTxid?: string;
  failReason?: string;
  lastSkipReason?: string;
  explorerUrl?: string;
  fillExplorerUrl?: string;
}

export interface CreatedIntent { intentId: string; contractAddress: string; tokenAddress: string; explorerUrl?: string }

export class RelayerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RelayerError';
  }
}

export function createRelayerApi(net: BchNet, baseUrl: string = cashtokenRelayerUrl(net === 'mainnet'), fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function request<T>(path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      throw new RelayerError(0, 'The BCH swap service cannot be reached. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new RelayerError(res.status, json?.error ?? json?.message ?? `The BCH swap service answered ${res.status}`);
    return json as T;
  }

  return {
    baseUrl,
    network: net,
    health: () => request<{ status?: string }>('/health', undefined, 6000),
    /** The amount of `buyToken` a solver can deliver for `sellAmount` now. '0' means the order is too small to fill. */
    quote: (p: { sellToken: string; buyToken: string; sellAmount: string }) =>
      request<{ buyAmount: string }>('/router/quote', { ...p, network: net }).then(r => BigInt(r.buyAmount || '0')),
    createIntent: (p: { makerAddress: string; sellToken: string; buyToken: string; sellAmount: string; buyAmount: string; duration: number }) =>
      request<CreatedIntent & { success?: boolean }>('/intent/create', {
        ...p, orderType: 'dutch', network: net, expiryTime: Math.floor(Date.now() / 1000) + p.duration,
      }),
    getIntent: (id: string) => request<Intent>(`/intent/${id}`),
    listIntents: (maker: string, limit = 30) =>
      request<Intent[] | { intents?: Intent[] }>(`/intents?maker=${encodeURIComponent(maker)}&limit=${limit}`)
        .then(r => (Array.isArray(r) ? r : r.intents ?? [])),
  };
}

export type RelayerApi = ReturnType<typeof createRelayerApi>;

/** The worst the auction can pay: its floor. Mirrors the relayer's `endBuy = buyAmount / 2n`. */
export const auctionFloor = (quoted: bigint) => quoted / 2n;

/** Sats sent along with a token so the output is not dust. The covenant expects exactly this. */
export const TOKEN_DUST_SATS = 1000n;

/** The two payments a swap can need. Each resolves with the transaction id once the network accepted it. */
export interface BchFunder {
  sendBch(cashaddr: string, satoshis: bigint): Promise<string>;
  sendToken(cashaddr: string, category: string, amount: bigint, satoshis: bigint): Promise<string>;
}

export type CashSwapStage = 'create' | 'fund' | 'filling';

export interface CashSwapInput {
  sellToken: string;   // category, or 'BCH'
  buyToken: string;
  sellAmount: bigint;
  buyAmount: bigint;   // from quote()
  duration: number;
  makerAddress: string;
}

export interface CashSwapDeps {
  api: Pick<RelayerApi, 'createIntent'>;
  /** Pays the covenant from the active account. The host signs with whatever holds its keys. */
  fund: BchFunder;
  onStage?: (stage: CashSwapStage, intent?: CreatedIntent, fundTxId?: string) => void;
}

/**
 * Create the intent and fund its covenant. Resolves once the funding transaction is broadcast; the fill is
 * followed by polling the intent.
 *
 * If funding fails nothing has left the wallet: the intent stays unfunded and the relayer drops it.
 */
export async function startCashTokenSwap(input: CashSwapInput, deps: CashSwapDeps): Promise<{ intent: CreatedIntent; fundTxId: string }> {
  deps.onStage?.('create');
  const intent = await deps.api.createIntent({
    makerAddress: input.makerAddress,
    sellToken: input.sellToken, buyToken: input.buyToken,
    sellAmount: input.sellAmount.toString(), buyAmount: input.buyAmount.toString(),
    duration: input.duration,
  });
  if (!intent?.intentId || !intent.contractAddress) throw new RelayerError(502, 'The BCH swap service did not return an order to fund.');

  deps.onStage?.('fund', intent);
  const fundTxId = input.sellToken === BCH_TOKEN_ID
    ? await deps.fund.sendBch(intent.contractAddress, input.sellAmount)
    : await deps.fund.sendToken(intent.tokenAddress, input.sellToken, input.sellAmount, TOKEN_DUST_SATS);
  if (!fundTxId) throw new Error('The funding transaction was not accepted by the network.');
  deps.onStage?.('filling', intent, fundTxId);
  return { intent, fundTxId };
}
