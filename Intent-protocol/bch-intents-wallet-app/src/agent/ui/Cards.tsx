/**
 * The cards the agent answers with. Every number on them comes from the wallet's code, not from the model,
 * and every action card shows where it stands in the outbox: drafted, waiting for the network, running, done.
 */
import React, { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowRight, BookOpen, Check, CircleAlert, Clock, Layers, Landmark, Repeat, Sparkles,
  TrendingUp, WifiOff, X, ArrowUpRight, AlertTriangle
} from 'lucide-react-native';
import { formatAmount, formatSig, formatUsd, parseUnits, timeAgo } from '@bch-intents/wallet-core/format';
import type {
  Card, HistorySummary, LoanPlan, MeshDraft, OutboxItem, PositionHealthReport,
  ProblemCode, SimulationResult, SnapshotPosition, SwapDraft,
} from '@bch-intents/wallet-core/agent';
import { useT, type Key } from '@/i18n';
import { Button, Line, Pill, Txt, tap } from '@/ui/primitives';
import { radius, space, useTheme } from '@/ui/theme';
import { Glass } from '@/ui/Glass';
import { askForNotifications } from '../notify';
import { useOnline } from '../network';
import { useAgentStore } from '../store';
import { BinStrip } from './BinStrip';

const amountOf = (a: { value: string; decimals: number; symbol: string }) => `${formatAmount(BigInt(a.value), a.decimals, 6)} ${a.symbol}`;
/** Sats per token base unit → BCH per whole token. */
export const bchPerToken = (satsPerUnit: number, decimals: number) => (satsPerUnit * 10 ** decimals) / 1e8;

function Shell({ icon, title, sub, children, tone }: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode; tone?: 'warn' }) {
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: tone === 'warn' ? c.amberBorder : c.glassBorder, backgroundColor: tone === 'warn' ? c.amberDim : c.glass, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'warn' ? c.amberDim : c.primaryDim }}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Txt variant="label" numberOfLines={1}>{title}</Txt>
          {sub ? <Txt variant="micro" tone="mute" numberOfLines={1}>{sub}</Txt> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

// ── Interactive Liquid Glass Amount Editor ──────────────────────────────────

function AmountEditor({
  label,
  value,
  symbol,
  decimals,
  balance,
  onChange,
}: {
  label: string;
  value: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  onChange: (val: string, baseUnits: bigint) => void;
}) {
  const { c } = useTheme();
  const [text, setText] = useState(value);

  const applyPercent = (pct: number) => {
    tap();
    let units: bigint;
    if (balance > 0n) {
      units = (balance * BigInt(pct)) / 100n;
    } else {
      const base = decimals === 8 ? 10_000_000n : 50n * BigInt(10 ** decimals);
      units = (base * BigInt(pct)) / 100n;
    }
    const formatted = formatAmount(units, decimals, 6);
    setText(formatted);
    onChange(formatted, units);
  };

  const handleTextChange = (str: string) => {
    setText(str);
    try {
      const units = parseUnits(str || '0', decimals);
      onChange(str, units);
    } catch {
      // User is typing a decimal separator
    }
  };

  return (
    <Glass style={{ padding: space.sm, borderRadius: radius.md, gap: 6 }} strong>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="micro" tone="mute">{label}</Txt>
        {balance > 0n ? (
          <Txt variant="micro" tone="faint">Bal: {formatAmount(balance, decimals, 4)} {symbol}</Txt>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <TextInput
          value={text}
          onChangeText={handleTextChange}
          keyboardType="decimal-pad"
          selectTextOnFocus
          style={{
            flex: 1,
            color: c.fg,
            fontSize: 18,
            fontWeight: '700',
            paddingVertical: 4,
            paddingHorizontal: 8,
            backgroundColor: c.surface2,
            borderRadius: radius.sm,
          }}
        />
        <Txt variant="label" weight="700">{symbol}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
        {[25, 50, 75, 100].map(pct => (
          <Pressable
            key={pct}
            onPress={() => applyPercent(pct)}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: 4,
              borderRadius: radius.pill,
              backgroundColor: pressed ? c.primaryDim : c.surface2,
              borderWidth: 1,
              borderColor: c.border,
            })}
          >
            <Txt variant="micro" weight="600" tone={pct === 100 ? 'primary' : 'mute'}>
              {pct === 100 ? 'MAX' : `${pct}%`}
            </Txt>
          </Pressable>
        ))}
      </View>
    </Glass>
  );
}

// ── Read cards ──────────────────────────────────────────────────────────────

function PortfolioView({ card }: { card: Extract<Card, { type: 'portfolio' }> }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Shell icon={<Sparkles size={16} color={c.primary} />} title={t('agent.card.portfolio')} sub={t('agent.card.savedAgo', { time: timeAgo(card.at) })}>
      {card.totalUsd !== undefined
        ? <Txt variant="title" tabular>{formatUsd(card.totalUsd)}</Txt>
        : card.mode !== 'mainnet' ? <Txt variant="small" tone="mute">{t('agent.card.testnetNoUsd')}</Txt> : null}
      {card.rows.length === 0 ? <Txt variant="small" tone="mute">{t('agent.card.noFunds')}</Txt> : (
        <View>
          {card.rows.map((r, i) => (
            <View key={`${r.symbol}-${r.networkName}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Txt variant="label" numberOfLines={1}>{r.symbol}</Txt>
                <Txt variant="micro" tone="mute" numberOfLines={1}>{r.networkName}</Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt variant="label" tabular numberOfLines={1}>{formatAmount(BigInt(r.amount.value), r.amount.decimals, 6)}</Txt>
                {r.usd !== undefined ? <Txt variant="micro" tone="mute" tabular>{formatUsd(r.usd)}</Txt> : null}
              </View>
            </View>
          ))}
          {card.more > 0 ? <Txt variant="micro" tone="faint">{t('agent.card.more', { count: card.more })}</Txt> : null}
        </View>
      )}
    </Shell>
  );
}

function PositionsView({ rows, at }: { rows: SnapshotPosition[]; at: number }) {
  const t = useT();
  const { c } = useTheme();
  const router = useRouter();
  return (
    <Shell icon={<Layers size={16} color={c.primary} />} title={t('agent.card.positions')} sub={t('agent.card.savedAgo', { time: timeAgo(at) })}>
      {rows.length === 0 ? <Txt variant="small" tone="mute">{t('agent.card.noPositions')}</Txt> : rows.map(p => (
        <View key={p.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>{p.name}</Txt>
            <Pill label={t('agent.card.bins', { count: p.binCount })} />
          </View>
          {p.tokenDecimals !== undefined ? (
            <Txt variant="small" tone="mute" tabular>
              {t('agent.card.range', {
                low: formatSig(bchPerToken(p.lowSatsPerUnit, p.tokenDecimals)), high: formatSig(bchPerToken(p.highSatsPerUnit, p.tokenDecimals)), token: p.tokenSymbol ?? '',
              })}
            </Txt>
          ) : null}
          <Button small kind="secondary" label={t('agent.card.openPosition')} onPress={() => router.push({ pathname: '/(app)/nft/[id]', params: { id: p.id } })} />
        </View>
      ))}
    </Shell>
  );
}

function ActivityView({ card }: { card: Extract<Card, { type: 'activity' }> }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Shell icon={<Clock size={16} color={c.primary} />} title={t('agent.card.activity')}>
      {card.rows.length === 0 ? <Txt variant="small" tone="mute">{t('agent.card.noActivity')}</Txt> : card.rows.map((r, i) => (
        <View key={`${r.at}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Txt variant="label" numberOfLines={1}>{r.sent && r.received ? `${r.sent} → ${r.received}` : r.sent ?? r.received ?? r.kind}</Txt>
            <Txt variant="micro" tone="mute">{timeAgo(r.at)}</Txt>
          </View>
          <Pill label={r.status} tone={r.status === 'confirmed' ? 'primary' : r.status === 'failed' ? 'red' : 'mute'} />
        </View>
      ))}
    </Shell>
  );
}

// ── Action cards ────────────────────────────────────────────────────────────

const PRODUCT: Record<SwapDraft['product'], Key> = { cashtoken: 'agent.product.cashtoken', cctp: 'agent.product.cctp', jupiter: 'agent.product.jupiter' };
const STYLE: Record<MeshDraft['style'], Key> = {
  accumulate: 'agent.style.accumulate', 'take-profit': 'agent.style.take-profit', range: 'agent.style.range',
  'market-make': 'agent.style.market-make', peg: 'agent.style.peg', limit: 'agent.style.limit',
};
const RISK: Record<MeshDraft['risk'], Key> = { low: 'agent.risk.low', medium: 'agent.risk.medium', high: 'agent.risk.high' };
const WARNING: Record<MeshDraft['warnings'][number], Key> = {
  'no-tokens-to-sell': 'agent.warn.noTokens', 'budget-split-thin': 'agent.warn.thin', 'wide-range': 'agent.warn.wide', 'testnet-price': 'agent.warn.testnet',
  'insufficient-balance': 'agent.warn.insufficientBalance',
};

function StatusRow({ item }: { item: OutboxItem | undefined }) {
  const t = useT();
  const { c } = useTheme();
  if (!item) return null;
  switch (item.status) {
    case 'queued': return <Pill tone="amber" icon={<WifiOff size={12} color={c.amber} />} label={t('agent.status.queued')} />;
    case 'running': return <Pill tone="primary" label={t('agent.status.running')} />;
    case 'done': return <Pill tone="primary" icon={<Check size={12} color={c.primary} />} label={t('agent.status.done')} />;
    case 'failed': return <Pill tone="red" icon={<CircleAlert size={12} color={c.red} />} label={t('agent.status.failed')} />;
    case 'dismissed': return <Pill label={t('agent.status.dismissed')} icon={<X size={12} color={c.fgMute} />} />;
    default: return <Pill label={t('agent.status.draft')} />;
  }
}

function DraftActions({ item, draftId, draft }: { item: OutboxItem | undefined; draftId: string; draft?: SwapDraft | MeshDraft }) {
  const t = useT();
  const router = useRouter();
  const online = useOnline();
  const setStatus = useAgentStore(s => s.setStatus);
  const status = item?.status ?? 'draft';
  const review = () => router.push({ pathname: '/(app)/agent/[id]', params: { id: draftId } });
  const topUp = () => router.push('/(app)/receive');

  if (status === 'done') {
    return item?.result?.link
      ? <Button small kind="secondary" label={t('agent.action.viewTx')} onPress={() => Linking.openURL(item.result!.link!).catch(() => { })} />
      : null;
  }
  if (status === 'dismissed') return null;
  if (status === 'running') return <Button small kind="secondary" label={t('agent.action.open')} onPress={review} />;

  const queue = async () => {
    setStatus(draftId, 'queued');
    tap();
    await askForNotifications();
  };
  const isUnderfunded = !!draft?.underfunded;

  return (
    <View style={{ gap: space.sm }}>
      {status === 'failed' && item?.result?.note ? <Txt variant="small" tone="red">{item.result.note === 'interrupted' ? t('agent.status.interrupted') : item.result.note}</Txt> : null}
      {status === 'queued' && !online ? <Txt variant="small" tone="mute">{t('agent.queued.hint')}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {isUnderfunded ? (
          <Button small kind="secondary" label={t('agent.action.topUp')} onPress={topUp} testID={`draft-topup-${draftId}`} />
        ) : null}
        {online
          ? <Button small style={{ flex: 1 }} label={t(status === 'failed' ? 'agent.action.retry' : 'agent.action.review')} onPress={review} testID={`draft-review-${draftId}`} />
          : status === 'queued'
            ? null
            : <Button small style={{ flex: 1 }} label={t('agent.action.queue')} onPress={queue} testID={`draft-queue-${draftId}`} />}
        <Button small kind="ghost" label={t(status === 'queued' ? 'agent.action.unqueue' : 'agent.action.dismiss')}
          onPress={() => setStatus(draftId, status === 'queued' ? 'draft' : 'dismissed')} />
      </View>
    </View>
  );
}

function SwapView({ draft, draftId, bare }: { draft: SwapDraft; draftId: string; bare?: boolean }) {
  const t = useT();
  const { c } = useTheme();
  const item = useAgentStore(s => s.outbox.find(i => i.id === draftId));
  const snapshot = useAgentStore(s => s.snapshot);
  const held = snapshot?.assets.find(a => a.network === draft.sell.network && a.ref === draft.sell.ref);
  const balance = BigInt(held?.balance ?? '0');

  const handleAmountChange = (_val: string, newUnits: bigint) => {
    draft.amount.value = newUnits.toString();
    if (newUnits > balance) {
      draft.underfunded = {
        tokenSymbol: draft.sell.symbol,
        required: newUnits.toString(),
        missing: (newUnits - balance).toString(),
        available: balance.toString(),
        decimals: draft.sell.decimals,
      };
    } else {
      delete draft.underfunded;
    }
    useAgentStore.getState().updateDraft(draftId, { ...draft });
  };

  return (
    <Shell icon={<Repeat size={16} color={c.primary} />} title={t('agent.card.swap')} sub={t(PRODUCT[draft.product])}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Txt variant="heading" tabular>{amountOf(draft.amount)}</Txt>
        <ArrowRight size={18} color={c.fgMute} />
        <Txt variant="heading">{draft.buy.symbol}</Txt>
      </View>

      {/* Editable liquid glass amount pill */}
      {!bare ? (
        <AmountEditor
          label={`Sell Amount (${draft.sell.symbol})`}
          value={formatAmount(BigInt(draft.amount.value), draft.amount.decimals, 6)}
          symbol={draft.sell.symbol}
          decimals={draft.sell.decimals}
          balance={balance}
          onChange={handleAmountChange}
        />
      ) : null}

      <View>
        <Line label={t('agent.card.from')} value={draft.sell.networkName} />
        <Line label={t('agent.card.to')} value={draft.buy.networkName} />
        <Line label={t('agent.card.quote')} value={t('agent.card.quoteLater')} />
      </View>

      {draft.destinationGasWarning ? (
        <View style={{ padding: space.sm, borderRadius: radius.md, backgroundColor: c.amberDim, borderWidth: 1, borderColor: c.amberBorder, flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <AlertTriangle size={15} color={c.amber} />
          <Txt variant="micro" tone="amber" style={{ flex: 1 }}>{draft.destinationGasWarning}</Txt>
        </View>
      ) : null}

      {draft.underfunded ? (
        <View style={{ padding: space.sm, borderRadius: radius.md, backgroundColor: c.amberDim, borderWidth: 1, borderColor: c.amberBorder }}>
          <Txt variant="small" tone="amber">
            {t('agent.warn.underfundedMissing', {
              missing: formatAmount(BigInt(draft.underfunded.missing), draft.underfunded.decimals, 6),
              symbol: draft.underfunded.tokenSymbol,
            })}
          </Txt>
        </View>
      ) : null}

      {bare ? null : <StatusRow item={item} />}
      {bare ? null : <DraftActions item={item} draftId={draftId} draft={draft} />}
    </Shell>
  );
}

function MeshView({ draft, draftId, bare }: { draft: MeshDraft; draftId: string; bare?: boolean }) {
  const t = useT();
  const { c } = useTheme();
  const item = useAgentStore(s => s.outbox.find(i => i.id === draftId));
  const snapshot = useAgentStore(s => s.snapshot);
  const bchAsset = snapshot?.assets.find(a => a.family === 'bch' && a.kind === 'native');
  const bchBalance = BigInt(bchAsset?.balance ?? '0');
  const d = draft.token.decimals;

  const handleBchChange = (_val: string, newUnits: bigint) => {
    draft.depositSats = newUnits.toString();
    if (newUnits > bchBalance) {
      draft.underfunded = {
        tokenSymbol: 'BCH',
        required: newUnits.toString(),
        missing: (newUnits - bchBalance).toString(),
        available: bchBalance.toString(),
        decimals: 8,
      };
      if (!draft.warnings.includes('insufficient-balance')) draft.warnings.push('insufficient-balance');
    } else {
      delete draft.underfunded;
      draft.warnings = draft.warnings.filter(w => w !== 'insufficient-balance');
    }
    useAgentStore.getState().updateDraft(draftId, { ...draft });
  };

  return (
    <Shell icon={<Layers size={16} color={c.primary} />} title={t(STYLE[draft.style])} sub={t('agent.card.meshOn', { token: draft.token.symbol })}>
      <BinStrip draft={draft} />

      {!bare && draft.buyBins > 0 ? (
        <AmountEditor
          label="Deposit BCH"
          value={formatAmount(BigInt(draft.depositSats), 8, 8)}
          symbol="BCH"
          decimals={8}
          balance={bchBalance}
          onChange={handleBchChange}
        />
      ) : null}

      <View>
        <Line label={t('agent.card.priceNow')} value={t('agent.card.perToken', { price: formatSig(bchPerToken(draft.marketPrice, d)), token: draft.token.symbol })} />
        <Line label={t('agent.card.priceRange')} value={`${formatSig(bchPerToken(draft.lowPrice, d))} – ${formatSig(bchPerToken(draft.highPrice, d))} BCH`} />
        <Line label={t('agent.card.binsLine')} value={t('agent.card.binsSplit', { buy: draft.buyBins, sell: draft.sellBins })} />
        {draft.buyBins > 0 ? <Line label={t('agent.card.depositBch')} value={`${formatAmount(BigInt(draft.depositSats), 8, 8)} BCH`} /> : null}
        {draft.sellBins > 0 ? <Line label={t('agent.card.depositTokens')} value={`${formatAmount(BigInt(draft.depositTokens), d, 6)} ${draft.token.symbol}`} /> : null}
        <Line label={t('agent.card.risk')} value={t(RISK[draft.risk])} />
      </View>

      {draft.underfunded ? (
        <View style={{ padding: space.sm, borderRadius: radius.md, backgroundColor: c.amberDim, borderWidth: 1, borderColor: c.amberBorder }}>
          <Txt variant="small" tone="amber">
            {t('agent.warn.underfundedMissing', {
              missing: formatAmount(BigInt(draft.underfunded.missing), draft.underfunded.decimals, 6),
              symbol: draft.underfunded.tokenSymbol,
            })}
          </Txt>
        </View>
      ) : null}

      {draft.warnings.length ? (
        <View style={{ gap: 4 }}>
          {draft.warnings.map(w => <Txt key={w} variant="small" tone="amber">{t(WARNING[w])}</Txt>)}
        </View>
      ) : null}

      {bare ? null : <StatusRow item={item} />}
      {bare ? null : <DraftActions item={item} draftId={draftId} draft={draft} />}
    </Shell>
  );
}

function LoanView({ plan }: { plan: LoanPlan }) {
  const t = useT();
  const { c } = useTheme();
  const router = useRouter();
  const snapshot = useAgentStore(s => s.snapshot);
  const btcAsset = snapshot?.assets.find(a => a.family === 'btc' && a.kind === 'native');
  const btcBalance = BigInt(btcAsset?.balance ?? '0');

  const [collateralSats, setCollateralSats] = useState<bigint>(BigInt(plan.collateral.value));

  const collateralUsd = (Number(collateralSats) / 1e8) * plan.btcUsd;
  const liveBorrowUsd = collateralUsd * plan.ltv;
  const liveLiqPrice = collateralSats > 0n ? (liveBorrowUsd / plan.liquidationLtv) / (Number(collateralSats) / 1e8) : 0;
  const isUnderfunded = collateralSats > btcBalance;
  const missingSats = isUnderfunded ? collateralSats - btcBalance : 0n;

  const health = plan.health === Infinity ? '∞' : formatSig(plan.health, 3);
  const danger = plan.ltv / plan.liquidationLtv;

  return (
    <Shell icon={<Landmark size={16} color={c.primary} />} title={t('agent.card.loan')} sub={t('agent.card.loanVia')}>
      <View>
        <Txt variant="micro" tone="mute">{t('agent.card.couldBorrow')}</Txt>
        <Txt variant="title" tabular>{t('agent.card.usdc', { amount: formatSig(liveBorrowUsd, 6) })}</Txt>
      </View>

      {/* Editable collateral with liquid glass */}
      <AmountEditor
        label="BTC Collateral"
        value={formatAmount(collateralSats, 8, 8)}
        symbol="BTC"
        decimals={8}
        balance={btcBalance}
        onChange={(_val, units) => setCollateralSats(units)}
      />

      {/* LTV gauge */}
      <View accessibilityLabel={t('agent.card.ltvGauge', { ltv: Math.round(plan.ltv * 100), liq: Math.round(plan.liquidationLtv * 100) })}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(100, (plan.ltv / plan.liquidationLtv) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: danger > 0.8 ? c.red : danger > 0.6 ? c.amber : c.primary }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Txt variant="micro" tone="mute">{t('agent.card.ltvNow', { ltv: Math.round(plan.ltv * 100) })}</Txt>
          <Txt variant="micro" tone="mute">{t('agent.card.ltvLiq', { liq: Math.round(plan.liquidationLtv * 100) })}</Txt>
        </View>
      </View>

      <View>
        <Line label={t('agent.card.collateral')} value={`${formatAmount(collateralSats, 8, 8)} BTC`} />
        <Line label={t('agent.card.btcPrice')} value={formatUsd(plan.btcUsd)} />
        <Line label={t('agent.card.liqPrice')} value={formatUsd(liveLiqPrice)} tone="warn" />
        <Line label={t('agent.card.health')} value={health} />
      </View>

      {isUnderfunded ? (
        <View style={{ gap: space.xs, padding: space.sm, borderRadius: radius.md, backgroundColor: c.amberDim, borderWidth: 1, borderColor: c.amberBorder }}>
          <Txt variant="small" tone="amber">
            {t('agent.warn.underfundedMissing', {
              missing: formatAmount(missingSats, 8, 8),
              symbol: 'BTC',
            })}
          </Txt>
          <Button small kind="secondary" label={t('agent.action.topUp')} onPress={() => router.push('/(app)/receive')} />
        </View>
      ) : null}

      <Txt variant="small" tone="mute">{t(plan.testnet ? 'agent.card.loanTestnet' : 'agent.card.loanPlanOnly')}</Txt>
    </Shell>
  );
}

function HistoryAnalysisView({ summary }: { summary: HistorySummary }) {
  const { c } = useTheme();
  return (
    <Shell icon={<Clock size={16} color={c.primary} />} title="History & Activity Audit" sub={`${summary.total} total transactions logged`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(summary.breakdownByStatus).map(([status, count]) => (
          <Pill
            key={status}
            label={`${count} ${status}`}
            tone={status === 'confirmed' ? 'primary' : status === 'failed' ? 'red' : 'amber'}
          />
        ))}
      </View>
      {Object.keys(summary.breakdownByNetwork).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Txt variant="micro" tone="mute">Network Breakdown:</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(summary.breakdownByNetwork).map(([net, count]) => (
              <Pill key={net} label={`${net}: ${count}`} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ gap: 6, marginTop: 4 }}>
        {summary.items.map((item, idx) => (
          <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <Txt variant="small" weight="600">{item.sent && item.received ? `${item.sent} → ${item.received}` : item.sent ?? item.received ?? item.kind}</Txt>
              <Txt variant="micro" tone="mute">{timeAgo(item.at)} · {item.network}</Txt>
            </View>
            <Pill label={item.status} tone={item.status === 'confirmed' ? 'primary' : item.status === 'failed' ? 'red' : 'mute'} />
          </View>
        ))}
      </View>
    </Shell>
  );
}

function PositionAnalysisView({ positions }: { positions: PositionHealthReport[] }) {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <Shell icon={<Layers size={16} color={c.primary} />} title="Mesh Position Health" sub={`${positions.length} active LP positions audited`}>
      {positions.length === 0 ? (
        <Txt variant="small" tone="mute">No active Mesh positions found to analyze.</Txt>
      ) : positions.map(p => (
        <View key={p.id} style={{ gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt variant="label" weight="700">{p.name}</Txt>
            <Pill
              label={p.status === 'in-range' ? '● In Range' : p.status === 'below-range' ? '▼ Below Range' : '▲ Above Range'}
              tone={p.status === 'in-range' ? 'primary' : 'amber'}
            />
          </View>

          {p.percentInRange !== undefined ? (
            <View style={{ gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(5, Math.min(95, p.percentInRange))}%`, height: 6, backgroundColor: c.primary, borderRadius: 3 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="micro" tone="mute">{formatSig(bchPerToken(p.lowSats, 2))} BCH</Txt>
                <Txt variant="micro" tone="primary" weight="600">{p.percentInRange}%</Txt>
                <Txt variant="micro" tone="mute">{formatSig(bchPerToken(p.highSats, 2))} BCH</Txt>
              </View>
            </View>
          ) : null}

          <View style={{ padding: space.sm, borderRadius: radius.sm, backgroundColor: c.surface2 }}>
            <Txt variant="micro" tone="mute">{p.advice}</Txt>
          </View>

          <Button small kind="secondary" label="Open Position Details" onPress={() => router.push({ pathname: '/(app)/nft/[id]', params: { id: p.id } })} />
        </View>
      ))}
    </Shell>
  );
}

function SimulationView({ result }: { result: SimulationResult }) {
  const { c } = useTheme();
  return (
    <Shell
      icon={<TrendingUp size={16} color={c.primary} />}
      title="Strategy Simulation"
      sub={`${result.tokenSymbol} · ${result.movePercent >= 0 ? '+' : ''}${result.movePercent}% scenario`}
    >
      <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Txt variant="micro" tone="mute">Simulated Price</Txt>
          <Txt variant="label" weight="700" tabular>{(result.simulatedPriceSats / 1e8).toFixed(6)} BCH</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Txt variant="micro" tone="mute">Bins Crossed</Txt>
          <Txt variant="label" weight="700" tabular>{result.binsCrossed} bins</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Txt variant="micro" tone="mute">Projected Fee APY</Txt>
          <Txt variant="label" weight="700" tone="primary" tabular>~{result.projectedApyPct}%</Txt>
        </View>
      </View>

      <View style={{ padding: space.sm, borderRadius: radius.md, backgroundColor: c.surface2, gap: 4 }}>
        <Txt variant="micro" weight="700" tone="primary">Order Book Execution:</Txt>
        <Txt variant="small">{result.actionSummary}</Txt>
      </View>
    </Shell>
  );
}

function ExplainView({ topic }: { topic: Extract<Card, { type: 'explain' }>['topic'] }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Shell icon={<BookOpen size={16} color={c.primary} />} title={t(`agent.explain.${topic}.title` as Key)}>
      <Txt variant="body">{t(`agent.explain.${topic}.body` as Key)}</Txt>
    </Shell>
  );
}

function ProblemView({ code, vars }: { code: ProblemCode; vars?: Record<string, string> }) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Shell tone="warn" icon={<CircleAlert size={16} color={c.amber} />} title={t('agent.problem.title')}>
      <Txt variant="small">{t(`agent.problem.${code}` as Key, vars)}</Txt>
    </Shell>
  );
}

/** `bare` drops the status and the buttons: for the review screen, which has its own. */
export function AgentCard({ card, bare }: { card: Card; bare?: boolean }) {
  switch (card.type) {
    case 'portfolio': return <PortfolioView card={card} />;
    case 'positions': return <PositionsView rows={card.rows} at={card.at} />;
    case 'activity': return <ActivityView card={card} />;
    case 'draft': return card.draft.kind === 'swap' ? <SwapView draft={card.draft} draftId={card.draftId} bare={bare} /> : <MeshView draft={card.draft} draftId={card.draftId} bare={bare} />;
    case 'loan': return <LoanView plan={card.plan} />;
    case 'explain': return <ExplainView topic={card.topic} />;
    case 'history_analysis': return <HistoryAnalysisView summary={card.summary} />;
    case 'position_analysis': return <PositionAnalysisView positions={card.positions} />;
    case 'simulation': return <SimulationView result={card.result} />;
    case 'problem': return <ProblemView code={card.code} vars={card.vars} />;
    default: return null;
  }
}
