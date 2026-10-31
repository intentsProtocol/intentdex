/**
 * Swap screen — one card, three products, chosen by the pair (see swap/tokens.ts):
 *
 *   BCH ↔ CashTokens          cashtoken-relayer, a Dutch-auction intent funded from this wallet
 *   USDC across chains        cctp-swap-server, Circle CCTP
 *   Solana tokens (mainnet)   cctp-swap-server, Jupiter
 *
 * The card only ever signs what a quote described, and every signature is followed in the progress sheet until
 * the service reports a final state. Closing the sheet stops nothing; Activity shows the same record.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useSettings } from '@/context/SettingsProvider';
import {
  MX, MPopup, Bento, MPrimary, MInput, MI, TokenIcon, Sheet, Banner, Spinner, IconBtn, Segmented,
} from '@/design-system/primitives';
import { MBottomNav, PageHeader, DetailCard, DetailRow, type Screen } from './shared';
import { getTradeableTokens, type TradeableToken } from '@/lib/cashtokens';
import { explorerTxUrl } from '@/lib/chains';
import { errorMessage, formatAmount, formatUnits, formatUsd, parseUnits } from '@/lib/format';
import { addActivity, updateActivity } from '@/lib/activity';
import { keypairFrom } from '@/lib/solana';
import { bchFunder } from '@/lib/send';
import type { MessageKey } from '@/lib/i18n';
import { swapServerApiFor, describeError, SwapServerError } from '@/swap/api';
import { startBridge, BurnNotReported, FeeNotSent, type BridgeProgress, type BridgeStep } from '@/swap/flows';
import { runSolanaSwap } from '@/swap/solana';
import { signSolanaTx } from '@/swap/signers';
import { auctionFloor, createRelayerApi, startCashTokenSwap, TERMINAL_INTENT, type Intent } from '@/swap/cashtoken';
import { bridgeDeps, getSwapConfig, recoverUnreported, TRANSFER_DONE } from '@/swap/runtime';
import {
  balanceOf, bchTokens, cctpTokens, counterpart, jupiterToken, jupiterTokens, resolveRoute, PRODUCT_LABEL, type Product, type Route, type SwapToken,
} from '@/swap/tokens';
import type { CctpQuote, SolanaQuote, SolanaToken, SwapServerConfig, Transfer } from '@/swap/types';

interface SwapScreenProps {
  onNavigate: (s: Screen) => void;
  assetId?: string;
}

// ─── quote, normalised across the three products ──────────────────────────────
interface CardQuote {
  /** What arrives, in the buy token's decimals. */
  receive: bigint;
  /** The least that can arrive, when the product has such a figure. */
  minReceive?: bigint;
  lines: { label: MessageKey; value: string; tone?: 'warn' }[];
  warnings: string[];
  cctp?: CctpQuote;
  jupiter?: SolanaQuote;
}

// ─── progress sheet model ─────────────────────────────────────────────────────
type StepState = 'done' | 'active' | 'pending' | 'failed';
interface RunStep { key: string; label: string; state: StepState; note?: string; link?: string }
interface Run {
  product: Product;
  title: string;
  steps: RunStep[];
  status: 'running' | 'done' | 'failed';
  message?: string;
}

function StepList({ steps }: { steps: RunStep[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {steps.map((s, i) => (
        <li key={s.key} data-step={s.key} data-state={s.state} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: 22, height: 22, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: s.state === 'done' ? MX.primaryDim : s.state === 'failed' ? MX.redDim : MX.surface2,
              color: s.state === 'done' ? MX.primary : s.state === 'failed' ? MX.red : MX.fgFaint,
              border: `1px solid ${s.state === 'active' ? MX.primaryBorder : 'transparent'}`,
            }}>
              {s.state === 'done' ? <MI.check size={12} /> : s.state === 'failed' ? <MI.cross size={12} /> : s.state === 'active' ? <Spinner size={11} color={MX.primary} /> : <span style={{ fontSize: 10, fontWeight: 700 }}>{i + 1}</span>}
            </div>
            {i < steps.length - 1 && <div style={{ width: 1, height: 14, background: MX.border, margin: '2px 0' }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ fontSize: 12.5, fontWeight: s.state === 'pending' ? 500 : 700, color: s.state === 'pending' ? MX.fgMute : MX.fg }}>
              {s.label}
              {s.link && <a href={s.link} target="_blank" rel="noreferrer" aria-label="Explorer" style={{ color: MX.primary, marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}><MI.ext size={11} /></a>}
            </div>
            {s.note && <div style={{ fontSize: 11, color: s.state === 'failed' ? MX.red : MX.fgMute, marginTop: 1, overflowWrap: 'anywhere' }}>{s.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── token selector ───────────────────────────────────────────────────────────
function TokenSelector({ tokens, balances, selectedId, title, onPick, onClose, searchRemote }: {
  tokens: SwapToken[]; balances: Map<string, bigint>; selectedId?: string; title: string;
  onPick: (t: SwapToken) => void; onClose: () => void; searchRemote?: (q: string) => Promise<SwapToken[]>;
}) {
  const { t } = useSettings();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Product | 'all'>('all');
  const [remote, setRemote] = useState<SwapToken[]>([]);
  const [searching, setSearching] = useState(false);
  const products = useMemo(() => [...new Set(tokens.map(x => x.product))], [tokens]);

  useEffect(() => {
    const needle = q.trim();
    if (!searchRemote || needle.length < 2 || (group !== 'all' && group !== 'jupiter')) { setRemote([]); return; }
    let alive = true;
    setSearching(true);
    const id = setTimeout(async () => {
      const found = await searchRemote(needle).catch(() => []);
      if (alive) { setRemote(found); setSearching(false); }
    }, 350);
    return () => { alive = false; clearTimeout(id); };
  }, [q, group, searchRemote]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const local = tokens.filter(x => (group === 'all' || x.product === group)
      && (!needle || `${x.symbol} ${x.name} ${x.net.name} ${x.ref}`.toLowerCase().includes(needle)));
    const ids = new Set(local.map(x => x.id));
    const all = [...local, ...remote.filter(x => !ids.has(x.id))];
    // Held tokens first, then the list's own order (liquidity for Jupiter, volume for Cauldron).
    return all.sort((a, b) => Number((balances.get(b.id) ?? 0n) > 0n) - Number((balances.get(a.id) ?? 0n) > 0n));
  }, [tokens, remote, q, group, balances]);

  return (
    <Sheet title={title} onClose={onClose} testId="token-selector">
      <div style={{ padding: '10px 12px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MInput placeholder={t('swap.searchTokens')} value={q} onChange={setQ} prefix={<MI.search size={14} />} autoFocus testId="token-search" suffix={searching ? <Spinner size={12} /> : undefined} />
        {products.length > 1 && (
          <div style={{ overflowX: 'auto' }}>
            <Segmented
              compact ariaLabel={t('swap.filter')} value={group} onChange={setGroup}
              options={[{ value: 'all' as const, label: t('common.all') }, ...products.map(p => ({ value: p, label: t(PRODUCT_LABEL[p]) }))]}
            />
          </div>
        )}
      </div>
      <div style={{ padding: '2px 12px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: MX.fgMute }}>{t('swap.noTokens')}</div>}
        {shown.map(x => {
          const bal = balances.get(x.id) ?? 0n;
          return (
            <button
              key={x.id} type="button" onClick={() => onPick(x)} data-testid={`token-${x.id}`} className="mx-press"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', cursor: 'pointer',
                background: x.id === selectedId ? MX.primaryDim : 'transparent', border: `1px solid ${x.id === selectedId ? MX.primaryBorder : 'transparent'}`,
                borderRadius: 12, color: MX.fg,
              }}
            >
              <TokenIcon symbol={x.symbol} logo={x.logo} networkLogo={x.net.logo} palette={x.net.palette} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {x.symbol}
                  {x.suspicious && <span title={t('swap.suspicious')} style={{ color: MX.red, display: 'flex' }}><MI.warn size={11} /></span>}
                  {!x.verified && !x.suspicious && <span title={t('home.unverified')} style={{ color: MX.amber, display: 'flex' }}><MI.warn size={11} /></span>}
                </div>
                <div style={{ fontSize: 10.5, color: MX.fgMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.net.name}{x.kind === 'cashtoken' || x.kind === 'spl' ? ` · ${x.name}` : ''}</div>
              </div>
              {bal > 0n && <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(bal, x.decimals)}</div>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ─── one side of the card ─────────────────────────────────────────────────────
function Side({ label, token, amount, onAmount, onPick, balance, usd, readOnly, loading, onMax, testId }: {
  label: string; token?: SwapToken; amount: string; onAmount?: (v: string) => void; onPick: () => void;
  balance?: bigint; usd?: number; readOnly?: boolean; loading?: boolean; onMax?: () => void; testId: string;
}) {
  const { t } = useSettings();
  return (
    <div style={{ padding: 13, background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: MX.fgMute }}>{label}</span>
        {token && balance !== undefined && (
          <button type="button" onClick={onMax} disabled={!onMax} data-testid={`${testId}-balance`} style={{ background: 'none', border: 'none', padding: 0, color: MX.fgMute, fontSize: 10.5, fontWeight: 600, cursor: onMax ? 'pointer' : 'default', fontVariantNumeric: 'tabular-nums' }}>
            {t('swap.balance', { amount: formatAmount(balance, token.decimals) })}{onMax && <span style={{ color: MX.primary, fontWeight: 800 }}> · {t('send.max')}</span>}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {loading
          ? <div style={{ flex: 1, height: 32, display: 'flex', alignItems: 'center' }}><Spinner size={15} color={MX.fgMute} /></div>
          : <input
              value={amount} readOnly={readOnly} data-testid={`${testId}-amount`} aria-label={label}
              onChange={e => { if (/^\d*\.?\d*$/.test(e.target.value)) onAmount?.(e.target.value); }}
              placeholder="0" inputMode="decimal" autoComplete="off"
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: amount ? MX.fg : MX.fgFaint, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', fontFamily: 'inherit' }}
            />}
        <button
          type="button" onClick={onPick} data-testid={`${testId}-token`} className="mx-press"
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px 5px 5px', background: MX.bg1, border: `1px solid ${MX.borderStrong}`, borderRadius: 99, color: MX.fg, cursor: 'pointer', flexShrink: 0, maxWidth: 170 }}
        >
          {token ? (
            <>
              <TokenIcon symbol={token.symbol} logo={token.logo} networkLogo={token.net.logo} palette={token.net.palette} size={24} />
              <span style={{ textAlign: 'left', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, lineHeight: 1.1 }}>{token.symbol}</span>
                <span style={{ display: 'block', fontSize: 9, color: MX.fgMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.net.short}</span>
              </span>
            </>
          ) : <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 4px 4px 8px' }}>{t('swap.select')}</span>}
          <MI.chevD size={12} stroke={MX.fgMute} />
        </button>
      </div>
      <div style={{ minHeight: 14, marginTop: 4, fontSize: 10.5, color: MX.fgFaint, fontVariantNumeric: 'tabular-nums' }}>{usd !== undefined ? formatUsd(usd) : ''}</div>
    </div>
  );
}

// ─── SwapScreen ───────────────────────────────────────────────────────────────
export function SwapScreen({ onNavigate, assetId }: SwapScreenProps) {
  const wdk = useWDK();
  const { t, settings } = useSettings();
  const { assets, signers, addresses, refresh, nativeOf } = usePortfolio();
  const mode = wdk.networkMode;
  const isMainnet = wdk.isMainnet;
  const bchNet = isMainnet ? 'mainnet' : 'chipnet';

  const api = useMemo(() => swapServerApiFor(isMainnet), [isMainnet]);
  const relayer = useMemo(() => createRelayerApi(bchNet), [bchNet]);

  const [config, setConfig] = useState<SwapServerConfig | undefined>();
  const [serverDown, setServerDown] = useState(false);
  const [tradeable, setTradeable] = useState<TradeableToken[]>([]);
  const [jupList, setJupList] = useState<SolanaToken[]>([]);
  const [extra, setExtra] = useState<SwapToken[]>([]);   // tokens found by search and then picked
  const [loadingLists, setLoadingLists] = useState(true);

  const [sellId, setSellId] = useState<string | undefined>();
  const [buyId, setBuyId] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const [picker, setPicker] = useState<'sell' | 'buy' | null>(null);
  const [quote, setQuote] = useState<CardQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // ── lists ──
  useEffect(() => {
    let on = true;
    setLoadingLists(true);
    setConfig(undefined);
    setServerDown(false);
    setJupList([]);
    setExtra([]);
    (async () => {
      const [cfg, cash] = await Promise.all([
        api ? getSwapConfig(api).catch(() => undefined) : Promise.resolve(undefined),
        getTradeableTokens(bchNet),
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
    recoverUnreported(isMainnet).catch(() => {});
    return () => { on = false; };
  }, [api, bchNet, isMainnet]);

  const tokens = useMemo(() => {
    const base = [...bchTokens(mode, tradeable, assets), ...cctpTokens(config, mode), ...jupiterTokens(config, mode, jupList)];
    const ids = new Set(base.map(x => x.id));
    return [...base, ...extra.filter(x => !ids.has(x.id))];
  }, [mode, tradeable, assets, config, jupList, extra]);

  const balances = useMemo(() => new Map(tokens.map(x => [x.id, balanceOf(x, assets)])), [tokens, assets]);
  const sell = tokens.find(x => x.id === sellId);
  const buy = tokens.find(x => x.id === buyId);
  const route: Route = useMemo(() => resolveRoute(sell, buy, config), [sell, buy, config]);

  // Default pair, once the lists are in: the asset the user came from, else BCH.
  useEffect(() => {
    if (loadingLists || sellId || !tokens.length) return;
    const from = assetId ? tokens.find(x => x.id === assetId) ?? tokens.find(x => assetId.startsWith(`${x.net.key}:`) && x.kind === 'usdc') : undefined;
    const first = from ?? tokens[0];
    setSellId(first.id);
    setBuyId(counterpart(first, undefined, tokens, config)?.id);
  }, [loadingLists, tokens, sellId, assetId, config]);

  const pick = (side: 'sell' | 'buy', token: SwapToken) => {
    if (!tokens.some(x => x.id === token.id)) setExtra(e => [...e, token]);
    const all = tokens.some(x => x.id === token.id) ? tokens : [...tokens, token];
    const other = side === 'sell' ? buy : sell;
    const nextOther = other?.id === token.id ? (side === 'sell' ? sell : buy) : counterpart(token, other, all, config);
    if (side === 'sell') { setSellId(token.id); setBuyId(nextOther?.id); } else { setBuyId(token.id); setSellId(nextOther?.id); }
    setPicker(null);
    setQuote(null);
    setQuoteError('');
  };

  const flip = () => { setSellId(buyId); setBuyId(sellId); setAmount(''); setQuote(null); setQuoteError(''); };

  const searchRemote = useCallback(async (q: string): Promise<SwapToken[]> => {
    if (!api || !isMainnet || !config?.solana.enabled) return [];
    const net = tokens.find(x => x.product === 'jupiter')?.net;
    if (!net) return [];
    const looksLikeMint = q.length >= 32 && !/\s/.test(q);
    const verified = looksLikeMint ? [] : (await api.getSolTokens({ q, sort: 'liquidity', limit: 20 }).catch(() => ({ tokens: [] }))).tokens;
    const wide = verified.length >= 5 ? [] : (await api.searchSolTokens(q).catch(() => ({ tokens: [] }))).tokens;
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
  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!sell || !buy || units === null || route.kind === 'none') { setQuoting(false); return; }
    let on = true;
    const ctrl = new AbortController();
    setQuoting(true);
    const ask = async () => {
      try {
        let next: CardQuote;
        if (route.kind === 'cashtoken') {
          const out = await relayer.quote({ sellToken: route.sell, buyToken: route.buy, sellAmount: units!.toString() });
          if (out <= 0n) throw new Error(t('swap.error.tooSmall'));
          const floor = auctionFloor(out);
          next = {
            receive: out, minReceive: floor, warnings: [],
            lines: [
              { label: 'swap.line.rate', value: `1 ${sell.symbol} ≈ ${formatAmount((out * 10n ** BigInt(sell.decimals)) / units!, buy.decimals, 8)} ${buy.symbol}` },
              { label: 'swap.line.floor', value: `${formatAmount(floor, buy.decimals, 8)} ${buy.symbol}` },
              { label: 'swap.line.auction', value: t('swap.value.auction', { seconds: settings.defaultAuctionDuration }) },
              { label: 'swap.line.route', value: t('swap.value.solver') },
            ],
          };
        } else if (route.kind === 'cctp') {
          const q = await api!.getQuote({ src: route.src.key, dst: route.dst.key, amount: formatUnits(units!, 6) }, { signal: ctrl.signal });
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
            inputMint: route.inputMint, outputMint: route.outputMint, amount: units!.toString(),
            slippageBps: settings.defaultSlippageBps, taker: addresses.solana ?? undefined,
          }, { signal: ctrl.signal });
          const warnings = [...(q.warnings ?? [])];
          if (q.takerCheck && !q.takerCheck.ok && q.takerCheck.message) warnings.push(q.takerCheck.message);
          next = {
            receive: BigInt(q.outAmount), minReceive: BigInt(q.minOutAmount), jupiter: q, warnings,
            lines: [
              { label: 'swap.line.rate', value: `1 ${sell.symbol} ≈ ${formatAmount((BigInt(q.outAmount) * 10n ** BigInt(sell.decimals)) / units!, buy.decimals, 6)} ${buy.symbol}` },
              { label: 'swap.line.minReceived', value: `${formatAmount(BigInt(q.minOutAmount), buy.decimals, 6)} ${buy.symbol}` },
              { label: 'swap.line.slippage', value: `${q.slippageBps / 100}%` },
              ...(q.priceImpactPct !== undefined ? [{ label: 'swap.line.priceImpact' as MessageKey, value: `${q.priceImpactPct.toFixed(2)}%`, tone: (q.priceImpactPct < -1 ? 'warn' : undefined) as 'warn' | undefined }] : []),
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
    const refreshEvery = setInterval(() => { if (!run || run.status !== 'running') ask(); }, 20_000);
    return () => { on = false; ctrl.abort(); clearTimeout(debounce); clearInterval(refreshEvery); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sell?.id, buy?.id, amount, route.kind, settings.defaultSlippageBps, settings.defaultAuctionDuration]);

  // ── what stops the button ──
  const gasProblem = useMemo((): string => {
    if (!sell || units === null) return '';
    if (route.kind === 'cashtoken') {
      const bch = nativeOf(sell.net)?.balance ?? 0n;
      const need = sell.kind === 'bch' ? units + 2000n : 3000n;
      return bch < need ? t('swap.error.bchFee') : '';
    }
    if (route.kind === 'cctp') {
      const gas = nativeOf(sell.net);
      if (sell.net.nativeIsUsdc) return '';
      return !gas || gas.balance === 0n ? t('swap.error.gas', { symbol: sell.net.native.symbol, network: sell.net.name }) : '';
    }
    if (route.kind === 'jupiter' && quote?.jupiter?.takerCheck && !quote.jupiter.takerCheck.ok) return quote.jupiter.takerCheck.message ?? t('swap.error.takerCheck');
    return '';
  }, [sell, units, route.kind, nativeOf, quote, t]);

  const serviceProblem = route.kind === 'cctp' && config?.cctp.paused ? (config.cctp.pauseReason || t('swap.error.paused'))
    : route.kind === 'jupiter' && config?.solana.paused ? (config.solana.pauseReason || t('swap.error.paused')) : '';

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
  const canSubmit = !!sell && !!buy && route.kind !== 'none' && units !== null && !insufficient && !serviceProblem && !gasProblem && !!quote && !(run && run.status === 'running');

  // ── execute ──
  const patchStep = (key: string, patch: Partial<RunStep>) => setRun(r => r && { ...r, steps: r.steps.map(s => (s.key === key ? { ...s, ...patch } : s)) });
  const activate = (key: string) => setRun(r => r && {
    ...r, steps: r.steps.map(s => (s.key === key ? { ...s, state: 'active' } : s.state === 'active' ? { ...s, state: 'done' } : s)),
  });
  const failRun = (message: string) => setRun(r => r && {
    ...r, status: 'failed', message, steps: r.steps.map(s => (s.state === 'active' ? { ...s, state: 'failed', note: message } : s)),
  });
  const finishRun = (message: string) => setRun(r => r && { ...r, status: 'done', message, steps: r.steps.map(s => ({ ...s, state: s.state === 'failed' ? 'failed' : 'done' })) });

  const submit = async () => {
    if (!sell || !buy || units === null || !quote || route.kind === 'none') return;
    const sent = `${formatAmount(units, sell.decimals, 8)} ${sell.symbol}`;
    const expected = `${formatAmount(quote.receive, buy.decimals, 8)} ${buy.symbol}`;
    const account = wdk.evmAddress ?? '';
    setSheetOpen(true);

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
        }, { api: relayer, fund: bchFunder(signers.bchWallet), onStage: stage => activate(stage) });
        patchStep('fund', { link: explorerTxUrl(sell.net, fundTxId) });
        activityId = (await addActivity({
          kind: 'swap', status: 'pending', network: sell.net.key, account, sent, received: expected, txid: fundTxId,
          ref: { product: 'cashtoken', id: intent.intentId },
        })).id;
        refresh();
        // Follow the fill. The auction runs for its duration; after that the covenant refunds.
        const deadline = Date.now() + (settings.defaultAuctionDuration + 180) * 1000;
        let last: Intent | undefined;
        while (alive.current && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 4000));
          last = await relayer.getIntent(intent.intentId).catch(() => last);
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
        refresh();
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
        const deps = await bridgeDeps(isMainnet, signers, onProgress);
        const sender = route.src.kind === 'solana' ? addresses.solana! : addresses.evm!;
        const recipient = route.dst.kind === 'solana' ? addresses.solana! : addresses.evm!;
        let started: Transfer;
        try {
          started = (await startBridge({ src: route.src, dst: route.dst, amount: formatUnits(units, 6), sender, recipient }, deps)).transfer;
        } catch (e) {
          // The burn is out; only the report or the fee is missing. The record exists and Activity can finish it.
          if (!(e instanceof BurnNotReported) && !(e instanceof FeeNotSent)) throw e;
          activityId = (await addActivity({
            kind: 'bridge', status: 'pending', network: route.src.key, toNetwork: route.dst.key, account, sent, received: expected,
            ref: { product: 'cctp', id: e.transferId }, note: e.message,
          })).id;
          if (alive.current) setRun(r => r && { ...r, status: 'failed', message: e.message });
          return;
        }
        activityId = (await addActivity({
          kind: 'bridge', status: 'pending', network: route.src.key, toNetwork: route.dst.key, account, sent, received: expected,
          txid: started.burnTxHash, ref: { product: 'cctp', id: started.id },
        })).id;
        refresh();
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
        refresh();
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
      if (!signers.solanaSecretKey || !addresses.solana) throw new Error(t('swap.error.noSolana'));
      const result = await runSolanaSwap(
        { inputMint: route.inputMint, outputMint: route.outputMint, amount: units.toString(), taker: addresses.solana, slippageBps: settings.defaultSlippageBps },
        {
          api: api!, sign: base64Tx => signSolanaTx(base64Tx, keypairFrom(signers.solanaSecretKey!)),
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
      refresh();
    } catch (e) {
      if (activityId) await updateActivity(activityId, { status: 'failed', note: errorMessage(e) });
      if (alive.current) failRun(e instanceof SwapServerError ? describeError(e) : errorMessage(e, t('swap.error.failed')));
    }
  };

  const sellUsd = sell?.priceUsd !== undefined && units !== null ? Number(formatUnits(units, sell.decimals)) * sell.priceUsd
    : sell?.symbol === 'USDC' && units !== null && isMainnet ? Number(formatUnits(units, 6)) : undefined;
  const buyUsd = buy?.priceUsd !== undefined && quote ? Number(formatUnits(quote.receive, buy.decimals)) * buy.priceUsd
    : buy?.symbol === 'USDC' && quote && isMainnet ? Number(formatUnits(quote.receive, 6)) : undefined;
  const product = route.kind !== 'none' ? route.kind : undefined;

  return (
    <MPopup>
      <PageHeader
        title={t('swap.title')}
        sub={product ? t(PRODUCT_LABEL[product]) : undefined}
        right={run ? <IconBtn label={t('swap.progress')} onClick={() => setSheetOpen(true)} active={run.status === 'running'} testId="swap-progress"><MI.activity size={14} /></IconBtn> : undefined}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {serverDown && <Banner tone="warn" testId="swap-server-down">{t('swap.serverDown')}</Banner>}
        {!loadingLists && tradeable.length === 0 && <Banner tone="info">{t('swap.noPools')}</Banner>}

        <Bento glassy style={{ padding: 8, borderRadius: 22 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
            <Side
              label={t('swap.youPay')} token={sell} amount={amount} testId="sell"
              onAmount={v => { setAmount(v); }} onPick={() => setPicker('sell')} balance={sell ? sellBalance : undefined} usd={sellUsd}
              onMax={sell && sellBalance > 0n ? () => {
                // Leave room for the fee when the fee is paid in the token being sold.
                const reserve = sell.kind === 'bch' ? 3000n : sell.kind === 'sol' ? 5_000_000n : 0n;
                setAmount(formatUnits(sellBalance > reserve ? sellBalance - reserve : 0n, sell.decimals));
              } : undefined}
            />
            <div style={{ display: 'flex', justifyContent: 'center', height: 0, position: 'relative', zIndex: 2 }}>
              <button type="button" onClick={flip} aria-label={t('swap.flip')} data-testid="swap-flip" className="mx-press" style={{ position: 'absolute', top: -17, width: 34, height: 34, borderRadius: 12, background: MX.bg1, border: `1px solid ${MX.borderStrong}`, color: MX.fg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MI.swap size={14} />
              </button>
            </div>
            <Side
              label={t('swap.youReceive')} token={buy} readOnly testId="buy" loading={quoting && !quote && units !== null && route.kind !== 'none'}
              amount={quote && buy ? formatAmount(quote.receive, buy.decimals, 8).replace(/,/g, '') : ''}
              onPick={() => setPicker('buy')} balance={buy ? balances.get(buy.id) ?? 0n : undefined} usd={buyUsd}
            />
          </div>
        </Bento>

        {loadingLists && <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}><Spinner size={16} color={MX.fgMute} /></div>}

        {quote && (
          <DetailCard>
            {quote.lines.map(l => <DetailRow key={l.label} label={t(l.label)} value={l.value} tone={l.tone} />)}
          </DetailCard>
        )}
        {route.kind === 'cashtoken' && quote && <Banner tone="info">{t('swap.note.auction')}</Banner>}
        {quote?.warnings.map((w, i) => <Banner key={i} tone="warn">{w}</Banner>)}
        {quoteError && units !== null && <Banner tone="error" testId="swap-quote-error">{quoteError}</Banner>}
        {(sell?.suspicious || buy?.suspicious) && <Banner tone="error">{t('swap.suspiciousLong')}</Banner>}
        {((sell && !sell.verified) || (buy && !buy.verified)) && !(sell?.suspicious || buy?.suspicious) && <Banner tone="warn">{t('home.unverifiedLong')}</Banner>}
        {route.kind === 'cctp' && config && (
          <div style={{ fontSize: 10.5, color: MX.fgFaint, textAlign: 'center' }}>{t('swap.limits', { min: config.cctp.minTransferUsdc, max: config.cctp.maxTransferUsdc })}</div>
        )}
      </div>

      <div style={{ padding: '10px 12px 12px', borderTop: `1px solid ${MX.border}` }}>
        <MPrimary onClick={submit} disabled={!canSubmit} testId="swap-submit">{buttonLabel}</MPrimary>
      </div>
      <MBottomNav active="swap" onNavigate={onNavigate} />

      {picker && (
        <TokenSelector
          title={picker === 'sell' ? t('swap.youPay') : t('swap.youReceive')}
          tokens={tokens} balances={balances} selectedId={picker === 'sell' ? sellId : buyId}
          onPick={x => pick(picker, x)} onClose={() => setPicker(null)} searchRemote={searchRemote}
        />
      )}

      {run && sheetOpen && (
        <Sheet title={run.title} onClose={() => setSheetOpen(false)} testId="swap-run">
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <StepList steps={run.steps} />
            {run.message && <Banner tone={run.status === 'failed' ? 'error' : run.status === 'done' ? 'success' : 'info'} testId="swap-run-message">{run.message}</Banner>}
            {run.status === 'running' && <div style={{ fontSize: 10.5, color: MX.fgFaint, textAlign: 'center' }}>{t('swap.keepOpenHint')}</div>}
            {run.status !== 'running' && (
              <MPrimary h={40} onClick={() => { setSheetOpen(false); if (run.status === 'done') { setRun(null); setAmount(''); } }} testId="swap-run-close">{t('common.done')}</MPrimary>
            )}
          </div>
        </Sheet>
      )}
    </MPopup>
  );
}
