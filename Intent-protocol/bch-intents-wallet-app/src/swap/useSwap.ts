/**
 * The swap card's logic, without its looks: which tokens there are, which service swaps the chosen pair, what
 * it quotes, and the run that executes it step by step.
 *
 * A port of the browser extension's Swap screen (popup/screens/Swap.tsx), on the same shared routing, clients
 * and flows. The screen that uses this hook only draws what it returns.
 *
 *   cashtoken   BCH ↔ CashToken            cashtoken-relayer, a Dutch-auction order funded from the wallet
 *   cctp        USDC → USDC, other chain   cctp-swap-server, Circle CCTP
 *   jupiter     Solana tokens, mainnet     cctp-swap-server, Jupiter
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explorerTxUrl } from '@bch-intents/wallet-core/chains';
import { addActivity, updateActivity } from '@bch-intents/wallet-core/activity';
import { errorMessage, formatAmount, formatUnits, parseUnits } from '@bch-intents/wallet-core/format';
import { getTradeableTokens, type TradeableToken } from '@bch-intents/wallet-core/cashtokens';
import { cashtokenRelayerUrl } from '@bch-intents/wallet-core/platform';
import { describeError, swapServerApiFor, SwapServerError } from '@bch-intents/wallet-core/swap/api';
import { auctionFloor, createRelayerApi, startCashTokenSwap, TERMINAL_INTENT, type Intent } from '@bch-intents/wallet-core/swap/cashtoken';
import { BurnNotReported, FeeNotSent, startBridge, type BridgeProgress, type BridgeStep } from '@bch-intents/wallet-core/swap/flows';
import { runSolanaSwap } from '@bch-intents/wallet-core/swap/solana';
import {
  balanceOf, bchTokens, cctpTokens, counterpart, jupiterToken, jupiterTokens, resolveRoute, type Product, type Route, type SwapToken,
} from '@bch-intents/wallet-core/swap/tokens';
import type { CctpQuote, SolanaQuote, SolanaToken, SwapServerConfig, Transfer } from '@bch-intents/wallet-core/swap/types';
import { useT, type Key } from '@/i18n';
import { bchFunder } from '@/lib/send';
import { usePortfolio } from '@/state/portfolio';
import { useSettings } from '@/state/settings';
import { bridgeDeps, getSwapConfig, recoverUnreported, signSolana, TRANSFER_DONE } from './runtime';

export interface CardQuote {
  /** What arrives, in the buy token's decimals. */
  receive: bigint;
  /** The least that can arrive, when the product has such a figure. */
  minReceive?: bigint;
  lines: { label: Key; value: string; tone?: 'warn' }[];
  warnings: string[];
  cctp?: CctpQuote;
  jupiter?: SolanaQuote;
}

export type StepState = 'done' | 'active' | 'pending' | 'failed';
export interface RunStep { key: string; label: string; state: StepState; note?: string; link?: string }
export interface Run {
  product: Product;
  title: string;
  steps: RunStep[];
  status: 'running' | 'done' | 'failed';
  message?: string;
}

export function useSwap(initialAssetId?: string) {
  const t = useT();
  const settings = useSettings();
  const { mode, isMainnet, accountIndex, assets, addresses, refresh, nativeOf } = usePortfolio();
  const bchNet = isMainnet ? 'mainnet' : 'chipnet';

  const api = useMemo(() => swapServerApiFor(isMainnet), [isMainnet]);
  const relayerUrl = cashtokenRelayerUrl(isMainnet);
  const relayer = useMemo(() => (relayerUrl ? createRelayerApi(bchNet, relayerUrl) : undefined), [bchNet, relayerUrl]);
  /** The build was given no service at all for this mode: nothing can be swapped. */
  const notConfigured = !api && !relayer;

  const [config, setConfig] = useState<SwapServerConfig | undefined>();
  const [serverDown, setServerDown] = useState(false);
  const [tradeable, setTradeable] = useState<TradeableToken[]>([]);
  const [jupList, setJupList] = useState<SolanaToken[]>([]);
  const [extra, setExtra] = useState<SwapToken[]>([]);   // tokens found by search and then picked
  const [loadingLists, setLoadingLists] = useState(true);

  const [sellId, setSellId] = useState<string | undefined>();
  const [buyId, setBuyId] = useState<string | undefined>();
  const [amount, setAmount] = useState('');

  const [quote, setQuote] = useState<CardQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [run, setRun] = useState<Run | null>(null);

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  // ── lists ──
  useEffect(() => {
    let on = true;
    setLoadingLists(true);
    setConfig(undefined);
    setServerDown(false);
    setJupList([]);
    setExtra([]);
    setSellId(undefined);
    setBuyId(undefined);
    (async () => {
      const [cfg, cash] = await Promise.all([
        api ? getSwapConfig(api).catch(() => undefined) : Promise.resolve(undefined),
        relayer ? getTradeableTokens(bchNet) : Promise.resolve([] as TradeableToken[]),
      ]);
      if (!on) return;
      setConfig(cfg);
      setServerDown(!!api && !cfg);
      setTradeable(cash);
      if (cfg && isMainnet && cfg.solana.enabled && api) {
        const list = await api.getSolTokens({ sort: 'liquidity', limit: 60 }).catch(() => ({ tokens: [] as SolanaToken[] }));
        if (on) setJupList(list.tokens);
      }
      if (on) setLoadingLists(false);
    })();
    recoverUnreported(mode).catch(() => {});
    return () => { on = false; };
  }, [api, relayer, bchNet, isMainnet, mode]);

  const tokens = useMemo(() => {
    const base = [...(relayer ? bchTokens(mode, tradeable, assets) : []), ...cctpTokens(config, mode), ...jupiterTokens(config, mode, jupList)];
    const ids = new Set(base.map(x => x.id));
    return [...base, ...extra.filter(x => !ids.has(x.id))];
  }, [relayer, mode, tradeable, assets, config, jupList, extra]);

  const balances = useMemo(() => new Map(tokens.map(x => [x.id, balanceOf(x, assets)])), [tokens, assets]);
  const sell = tokens.find(x => x.id === sellId);
  const buy = tokens.find(x => x.id === buyId);
  const route: Route = useMemo(() => resolveRoute(sell, buy, config), [sell, buy, config]);

  // Default pair, once the lists are in: the asset the user came from, else the first token.
  useEffect(() => {
    if (loadingLists || sellId || !tokens.length) return;
    const from = initialAssetId
      ? tokens.find(x => x.id === initialAssetId) ?? tokens.find(x => initialAssetId.startsWith(`${x.net.key}:`) && x.kind === 'usdc')
      : undefined;
    const first = from ?? tokens[0];
    setSellId(first.id);
    setBuyId(counterpart(first, undefined, tokens, config)?.id);
  }, [loadingLists, tokens, sellId, initialAssetId, config]);

  const clearQuote = () => { setQuote(null); setQuoteError(''); };

  const pick = useCallback((side: 'sell' | 'buy', token: SwapToken) => {
    const known = tokens.some(x => x.id === token.id);
    if (!known) setExtra(e => [...e, token]);
    const all = known ? tokens : [...tokens, token];
    const other = side === 'sell' ? buy : sell;
    const nextOther = other?.id === token.id ? (side === 'sell' ? sell : buy) : counterpart(token, other, all, config);
    if (side === 'sell') { setSellId(token.id); setBuyId(nextOther?.id); } else { setBuyId(token.id); setSellId(nextOther?.id); }
    clearQuote();
  }, [tokens, sell, buy, config]);

  const flip = useCallback(() => { setSellId(buyId); setBuyId(sellId); setAmount(''); clearQuote(); }, [sellId, buyId]);

  const searchRemote = useCallback(async (q: string): Promise<SwapToken[]> => {
    if (!api || !isMainnet || !config?.solana.enabled) return [];
    const net = tokens.find(x => x.product === 'jupiter')?.net;
    if (!net) return [];
    const looksLikeMint = q.length >= 32 && !/\s/.test(q);
    const verified = looksLikeMint ? [] : (await api.getSolTokens({ q, sort: 'liquidity', limit: 20 }).catch(() => ({ tokens: [] as SolanaToken[] }))).tokens;
    const wide = verified.length >= 5 ? [] : (await api.searchSolTokens(q).catch(() => ({ tokens: [] as SolanaToken[] }))).tokens;
    const seen = new Set<string>();
    return [...verified, ...wide].filter(x => !x.isStock && !seen.has(x.mint) && seen.add(x.mint)).slice(0, 30).map(x => jupiterToken(x, net));
  }, [api, isMainnet, config, tokens]);

  // ── amount ──
  let units: bigint | null = null;
  let amountError = '';
  if (sell && amount.trim()) {
    try { units = parseUnits(amount, sell.decimals); if (units <= 0n) units = null; } catch (e) { amountError = errorMessage(e); }
  }
  const sellBalance = sell ? balances.get(sell.id) ?? 0n : 0n;
  const insufficient = units !== null && units > sellBalance;

  // ── quote ──
  const unitsKey = units?.toString() ?? '';
  useEffect(() => {
    clearQuote();
    if (!sell || !buy || units === null || route.kind === 'none') { setQuoting(false); return; }
    let on = true;
    const ctrl = new AbortController();
    setQuoting(true);
    const want = units;
    const ask = async () => {
      try {
        let next: CardQuote;
        if (route.kind === 'cashtoken') {
          const out = await relayer!.quote({ sellToken: route.sell, buyToken: route.buy, sellAmount: want.toString() });
          if (out <= 0n) throw new Error(t('swap.error.tooSmall'));
          const floor = auctionFloor(out);
          next = {
            receive: out, minReceive: floor, warnings: [],
            lines: [
              { label: 'swap.line.rate', value: `1 ${sell.symbol} ≈ ${formatAmount((out * 10n ** BigInt(sell.decimals)) / want, buy.decimals, 8)} ${buy.symbol}` },
              { label: 'swap.line.floor', value: `${formatAmount(floor, buy.decimals, 8)} ${buy.symbol}` },
              { label: 'swap.line.auction', value: t('swap.value.auction', { seconds: settings.defaultAuctionDuration }) },
              { label: 'swap.line.route', value: t('swap.value.solver') },
            ],
          };
        } else if (route.kind === 'cctp') {
          const q = await api!.getQuote({ src: route.src.key, dst: route.dst.key, amount: formatUnits(want, 6) }, { signal: ctrl.signal });
          const d = q.display;
          next = {
            receive: BigInt(q.expectedReceive), cctp: q, warnings: q.warnings ?? [],
            lines: [
              { label: 'swap.line.serviceFee', value: `${d?.protocolFee ?? formatUnits(BigInt(q.protocolFee), 6)} USDC` },
              { label: 'swap.line.networkFee', value: `${d?.expectedFee ?? formatUnits(BigInt(q.expectedFee), 6)} USDC` },
              { label: 'swap.line.eta', value: q.etaSec < 90 ? t('swap.value.seconds', { n: q.etaSec }) : t('swap.value.minutes', { n: Math.round(q.etaSec / 60) }) },
              { label: 'swap.line.route', value: `${route.src.name} → ${route.dst.name}` },
            ],
          };
        } else {
          const q = await api!.getSolQuote({
            inputMint: route.inputMint, outputMint: route.outputMint, amount: want.toString(),
            slippageBps: settings.defaultSlippageBps, taker: addresses.solana ?? undefined,
          }, { signal: ctrl.signal });
          const warnings = [...(q.warnings ?? [])];
          if (q.takerCheck && !q.takerCheck.ok && q.takerCheck.message) warnings.push(q.takerCheck.message);
          next = {
            receive: BigInt(q.outAmount), minReceive: BigInt(q.minOutAmount), jupiter: q, warnings,
            lines: [
              { label: 'swap.line.rate', value: `1 ${sell.symbol} ≈ ${formatAmount((BigInt(q.outAmount) * 10n ** BigInt(sell.decimals)) / want, buy.decimals, 6)} ${buy.symbol}` },
              { label: 'swap.line.minReceived', value: `${formatAmount(BigInt(q.minOutAmount), buy.decimals, 6)} ${buy.symbol}` },
              { label: 'swap.line.slippage', value: `${q.slippageBps / 100}%` },
              ...(q.priceImpactPct !== undefined ? [{ label: 'swap.line.priceImpact' as Key, value: `${q.priceImpactPct.toFixed(2)}%`, tone: (q.priceImpactPct < -1 ? 'warn' : undefined) as 'warn' | undefined }] : []),
              { label: 'swap.line.route', value: q.route?.map(r => r.label).join(' → ') || q.router || 'Jupiter' },
            ],
          };
        }
        if (on) { setQuote(next); setQuoteError(''); }
      } catch (e) {
        if (!on || ctrl.signal.aborted) return;
        setQuote(null);
        setQuoteError(e instanceof SwapServerError ? describeError(e) : errorMessage(e));
      } finally {
        if (on) setQuoting(false);
      }
    };
    const debounce = setTimeout(ask, 500);
    const refreshEvery = setInterval(() => { if (runRef.current?.status !== 'running') ask(); }, 20_000);
    return () => { on = false; ctrl.abort(); clearTimeout(debounce); clearInterval(refreshEvery); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sell?.id, buy?.id, unitsKey, route.kind, settings.defaultSlippageBps, settings.defaultAuctionDuration]);

  // ── what stops the button ──
  const gasProblem = useMemo((): string => {
    if (!sell || units === null) return '';
    if (route.kind === 'cashtoken') {
      const bch = nativeOf(sell.net)?.balance ?? 0n;
      const need = sell.kind === 'bch' ? units + 2000n : 3000n;
      return bch < need ? t('swap.error.bchFee') : '';
    }
    if (route.kind === 'cctp') {
      if (sell.net.nativeIsUsdc) return '';
      const gas = nativeOf(sell.net);
      return !gas || gas.balance === 0n ? t('swap.error.gas', { symbol: sell.net.native.symbol, network: sell.net.name }) : '';
    }
    if (route.kind === 'jupiter' && quote?.jupiter?.takerCheck && !quote.jupiter.takerCheck.ok) return quote.jupiter.takerCheck.message ?? t('swap.error.takerCheck');
    return '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sell, unitsKey, route.kind, nativeOf, quote, t]);

  const serviceProblem = route.kind === 'cctp' && config?.cctp.paused ? (config.cctp.pauseReason || t('swap.error.paused'))
    : route.kind === 'jupiter' && config?.solana.paused ? (config.solana.pauseReason || t('swap.error.paused')) : '';

  const running = run?.status === 'running';
  const buttonLabel =
    !sell || !buy ? t('swap.select')
    : route.kind === 'none' ? t(route.reason)
    : !amount.trim() ? t('swap.enterAmount')
    : amountError ? amountError
    : insufficient ? t('swap.error.insufficient', { symbol: sell.symbol })
    : serviceProblem ? serviceProblem
    : gasProblem ? gasProblem
    : quoting && !quote ? t('swap.quoting')
    : quoteError ? t('swap.noQuote')
    : route.kind === 'cctp' ? t('swap.cta.bridge')
    : t('swap.cta.swap');
  const canSubmit = !!sell && !!buy && route.kind !== 'none' && units !== null && !insufficient && !serviceProblem && !gasProblem && !!quote && !running;

  // ── execute ──
  const patchStep = (key: string, patch: Partial<RunStep>) => setRun(r => r && { ...r, steps: r.steps.map(s => (s.key === key ? { ...s, ...patch } : s)) });
  const activate = (key: string) => setRun(r => r && {
    ...r, steps: r.steps.map(s => (s.key === key ? { ...s, state: 'active' as StepState } : s.state === 'active' ? { ...s, state: 'done' as StepState } : s)),
  });
  const failRun = (message: string) => setRun(r => r && {
    ...r, status: 'failed', message, steps: r.steps.map(s => (s.state === 'active' ? { ...s, state: 'failed' as StepState, note: message } : s)),
  });
  const finishRun = (message: string) => setRun(r => r && { ...r, status: 'done', message, steps: r.steps.map(s => ({ ...s, state: (s.state === 'failed' ? 'failed' : 'done') as StepState })) });

  const submit = useCallback(async () => {
    if (!sell || !buy || units === null || !quote || route.kind === 'none') return;
    const sent = `${formatAmount(units, sell.decimals, 8)} ${sell.symbol}`;
    const expected = `${formatAmount(quote.receive, buy.decimals, 8)} ${buy.symbol}`;
    const account = addresses.evm ?? '';

    // ── BCH ↔ CashTokens ──
    if (route.kind === 'cashtoken') {
      setRun({
        product: 'cashtoken', title: `${sent} → ${buy.symbol}`, status: 'running',
        steps: [
          { key: 'create', label: t('swap.step.createOrder'), state: 'active' },
          { key: 'fund', label: t('swap.step.fund'), state: 'pending' },
          { key: 'filling', label: t('swap.step.filling'), state: 'pending' },
        ],
      });
      let activityId: string | undefined;
      try {
        const { intent, fundTxId } = await startCashTokenSwap({
          sellToken: route.sell, buyToken: route.buy, sellAmount: units, buyAmount: quote.receive,
          duration: settings.defaultAuctionDuration, makerAddress: addresses.bch!,
        }, { api: relayer!, fund: bchFunder(sell.net.key, accountIndex), onStage: stage => activate(stage) });
        patchStep('fund', { link: explorerTxUrl(sell.net, fundTxId) });
        activityId = (await addActivity({
          kind: 'swap', status: 'pending', network: sell.net.key, account, sent, received: expected, txid: fundTxId,
          ref: { product: 'cashtoken', id: intent.intentId },
        })).id;
        refresh().catch(() => {});

        // Follow the fill. The auction runs for its duration; after that the covenant refunds.
        const deadline = Date.now() + (settings.defaultAuctionDuration + 180) * 1000;
        let last: Intent | undefined;
        while (alive.current && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 4000));
          last = await relayer!.getIntent(intent.intentId).catch(() => last);
          if (last && TERMINAL_INTENT.includes(last.status)) break;
        }
        if (!alive.current) return;
        if (last?.status === 'filled') {
          const got = last.fillPrice ? `${formatAmount(BigInt(last.fillPrice), buy.decimals, 8)} ${buy.symbol}` : expected;
          await updateActivity(activityId, { status: 'confirmed', received: got });
          patchStep('filling', { link: last.fillExplorerUrl });
          finishRun(t('swap.done.received', { amount: got }));
        } else if (last && TERMINAL_INTENT.includes(last.status)) {
          await updateActivity(activityId, { status: last.status === 'refunded' ? 'refunded' : 'failed', note: last.failReason ?? last.lastSkipReason });
          failRun(last.status === 'refunded' ? t('swap.done.refunded') : (last.failReason ?? t('swap.done.notFilled')));
        } else {
          setRun(r => r && { ...r, message: t('swap.done.stillOpen') });
        }
        refresh().catch(() => {});
      } catch (e) {
        if (activityId) await updateActivity(activityId, { status: 'failed', note: errorMessage(e) });
        if (alive.current) failRun(errorMessage(e, t('swap.error.failed')));
      }
      return;
    }

    // ── USDC across chains ──
    if (route.kind === 'cctp') {
      const label = (s: BridgeStep) => (s === 'approve' ? t('swap.step.approve') : s === 'burn' ? t('swap.step.burn', { network: route.src.name }) : s === 'fee' ? t('swap.step.fee') : t('swap.step.prepare'));
      const tail = (): RunStep[] => [
        { key: 'confirm', label: t('swap.step.confirm', { network: route.src.name }), state: 'pending' },
        { key: 'attest', label: t('swap.step.attest'), state: 'pending' },
        { key: 'deliver', label: t('swap.step.deliver', { network: route.dst.name }), state: 'pending' },
      ];
      setRun({ product: 'cctp', title: `${sent} → ${route.dst.name}`, status: 'running', steps: [{ key: 'create', label: label('create'), state: 'active' }, ...tail()] });
      let activityId: string | undefined;

      const onProgress = (p: BridgeProgress) => {
        if (!alive.current) return;
        setRun(r => {
          if (!r) return r;
          const signing: RunStep[] = p.steps.map(s => {
            const prev = r.steps.find(x => x.key === s);
            const at = p.steps.indexOf(p.step), i = p.steps.indexOf(s);
            const state: StepState = i < at || (i === at && p.state === 'done') ? 'done' : i === at ? 'active' : 'pending';
            return { key: s, label: label(s), state, link: s === p.step && p.hash && s !== 'create' ? explorerTxUrl(sell.net, p.hash) : prev?.link };
          });
          return { ...r, steps: [...signing, ...r.steps.filter(x => ['confirm', 'attest', 'deliver'].includes(x.key))] };
        });
      };

      const follow = async (id: string) => {
        const order: Record<string, number> = { CREATED: 0, BURN_SUBMITTED: 1, BURN_CONFIRMED: 2, ATTESTED: 3, MINT_SUBMITTED: 4, COMPLETED: 5, COMPLETED_EXTERNAL: 5 };
        let tr: Transfer | undefined;
        const deadline = Date.now() + 30 * 60_000;
        while (alive.current && Date.now() < deadline) {
          tr = await api!.getTransfer(id).catch(() => tr);
          if (tr) {
            const at = order[tr.status] ?? 0;
            const held = tr.status === 'ATTESTED' && tr.feeStatus === 'awaiting';
            patchStep('confirm', { state: at >= 2 ? 'done' : at === 1 ? 'active' : 'pending', link: tr.links.burn });
            patchStep('attest', { state: at >= 3 ? 'done' : at === 2 ? 'active' : 'pending' });
            patchStep('deliver', { state: at === 5 ? 'done' : at >= 3 ? 'active' : 'pending', link: tr.links.mint, note: held ? t('swap.note.feeHeld') : undefined });
            if (TRANSFER_DONE.includes(tr.status)) break;
          }
          await new Promise(r => setTimeout(r, 3000));
        }
        return tr;
      };

      try {
        const deps = await bridgeDeps(mode, accountIndex, onProgress);
        const sender = route.src.kind === 'solana' ? addresses.solana! : addresses.evm!;
        const recipient = route.dst.kind === 'solana' ? addresses.solana! : addresses.evm!;
        let started: Transfer;
        try {
          started = (await startBridge({ src: route.src, dst: route.dst, amount: formatUnits(units, 6), sender, recipient }, deps)).transfer;
        } catch (e) {
          // The burn is out; only the report or the fee is missing. The record exists and Activity can finish it.
          if (!(e instanceof BurnNotReported) && !(e instanceof FeeNotSent)) throw e;
          await addActivity({
            kind: 'bridge', status: 'pending', network: route.src.key, toNetwork: route.dst.key, account, sent, received: expected,
            ref: { product: 'cctp', id: e.transferId }, note: e.message,
          });
          if (alive.current) setRun(r => r && { ...r, status: 'failed', message: e.message });
          return;
        }
        activityId = (await addActivity({
          kind: 'bridge', status: 'pending', network: route.src.key, toNetwork: route.dst.key, account, sent, received: expected,
          txid: started.burnTxHash, ref: { product: 'cctp', id: started.id },
        })).id;
        refresh().catch(() => {});
        const final = await follow(started.id);
        if (!alive.current) return;
        if (final?.status === 'COMPLETED' || final?.status === 'COMPLETED_EXTERNAL') {
          const got = `${final.display.received ?? final.display.expectedReceive} USDC`;
          await updateActivity(activityId, { status: 'confirmed', received: got });
          finishRun(t('swap.done.delivered', { amount: got, network: route.dst.name }));
        } else if (final?.status === 'FAILED' || final?.status === 'EXPIRED') {
          await updateActivity(activityId, { status: 'failed', note: final.failReason });
          failRun(final.failReason ?? t('swap.error.failed'));
        } else {
          setRun(r => r && { ...r, message: t('swap.done.stillOpen') });
        }
        refresh().catch(() => {});
      } catch (e) {
        if (activityId) await updateActivity(activityId, { status: 'failed', note: errorMessage(e) });
        if (alive.current) failRun(e instanceof SwapServerError ? describeError(e) : errorMessage(e, t('swap.error.failed')));
      }
      return;
    }

    // ── Solana, through Jupiter ──
    setRun({
      product: 'jupiter', title: `${sent} → ${buy.symbol}`, status: 'running',
      steps: [
        { key: 'create', label: t('swap.step.prepare'), state: 'active' },
        { key: 'sign', label: t('swap.step.sign'), state: 'pending' },
        { key: 'landing', label: t('swap.step.landing'), state: 'pending' },
      ],
    });
    let activityId: string | undefined;
    try {
      if (!addresses.solana) throw new Error(t('swap.error.noSolana'));
      const result = await runSolanaSwap(
        { inputMint: route.inputMint, outputMint: route.outputMint, amount: units.toString(), taker: addresses.solana, slippageBps: settings.defaultSlippageBps },
        {
          api: api!, sign: base64Tx => signSolana(mode, accountIndex, base64Tx),
          onStage: async (stage, swap) => {
            activate(stage);
            if (stage === 'sign' && swap && !activityId) {
              activityId = (await addActivity({ kind: 'swap', status: 'pending', network: sell.net.key, account, sent, received: expected, ref: { product: 'jupiter', id: swap.id } })).id;
            }
          },
        },
      );
      if (!alive.current) return;
      if (result.status === 'COMPLETED') {
        const got = `${result.display.outAmount ?? formatAmount(BigInt(result.outAmount ?? result.quotedOutAmount), buy.decimals, 6)} ${buy.symbol}`;
        if (activityId) await updateActivity(activityId, { status: 'confirmed', received: got, txid: result.signature });
        patchStep('landing', { link: result.links.tx });
        finishRun(t('swap.done.received', { amount: got }));
      } else if (result.terminal) {
        if (activityId) await updateActivity(activityId, { status: 'failed', note: result.failReason, txid: result.signature });
        failRun(result.failReason ?? t('swap.error.failed'));
      } else {
        if (activityId) await updateActivity(activityId, { txid: result.signature });
        setRun(r => r && { ...r, message: t('swap.done.stillOpen') });
      }
      refresh().catch(() => {});
    } catch (e) {
      if (activityId) await updateActivity(activityId, { status: 'failed', note: errorMessage(e) });
      if (alive.current) failRun(e instanceof SwapServerError ? describeError(e) : errorMessage(e, t('swap.error.failed')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sell, buy, unitsKey, quote, route, addresses, accountIndex, mode, settings.defaultAuctionDuration, settings.defaultSlippageBps, relayer, api, refresh, t]);

  const sellUsd = sell?.priceUsd !== undefined && units !== null ? Number(formatUnits(units, sell.decimals)) * sell.priceUsd
    : sell?.symbol === 'USDC' && units !== null && isMainnet ? Number(formatUnits(units, 6)) : undefined;
  const buyUsd = buy?.priceUsd !== undefined && quote ? Number(formatUnits(quote.receive, buy.decimals)) * buy.priceUsd
    : buy?.symbol === 'USDC' && quote && isMainnet ? Number(formatUnits(quote.receive, 6)) : undefined;

  return {
    notConfigured, serverDown, loadingLists, hasRelayer: !!relayer, noPools: !!relayer && !loadingLists && tradeable.length === 0,
    tokens, balances, sell, buy, route, product: route.kind !== 'none' ? route.kind : undefined,
    amount, setAmount: (v: string) => { if (/^\d*\.?\d*$/.test(v)) setAmount(v); },
    setMax: () => { if (sell) setAmount(formatUnits(sellBalance, sell.decimals)); },
    sellBalance, pick, flip, searchRemote,
    quote, quoting, quoteError, buttonLabel, canSubmit, submit,
    run, running, dismissRun: () => { if (!running) setRun(null); },
    sellUsd, buyUsd, config,
  };
}

export type SwapModel = ReturnType<typeof useSwap>;
