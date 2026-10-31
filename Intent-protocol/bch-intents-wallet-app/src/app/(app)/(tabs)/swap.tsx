/**
 * The Swap tab: one card for three kinds of swap. The pair the user picks decides which service runs it, and a
 * pair nothing can execute disables the button and says why. The logic is in swap/useSwap.ts; this file draws.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowDownUp, Check, ChevronDown, ExternalLink, History, Search, X } from 'lucide-react-native';
import { formatAmount, formatUsd } from '@bch-intents/wallet-core/format';
import { PRODUCT_LABEL, type Product, type SwapToken } from '@bch-intents/wallet-core/swap/tokens';
import { useT } from '@/i18n';
import { useSwap, type RunStep, type SwapModel } from '@/swap/useSwap';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Field, Header, IconButton, Line, Screen, Segmented, Sheet, Skeleton, Spinner, tap, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { radius, space, useTheme } from '@/ui/theme';

// ── one side of the card ──

function Side({ label, token, amount, onAmount, onPick, balance, usd, loading, onMax, testID }: {
  label: string; token?: SwapToken; amount: string; onAmount?: (v: string) => void; onPick: () => void;
  balance?: bigint; usd?: number; loading?: boolean; onMax?: () => void; testID: string;
}) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Card padding={space.lg}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 }}>
        <Txt variant="micro" tone="mute">{label}</Txt>
        {token && balance !== undefined ? (
          <Pressable onPress={onMax ? () => { tap(); onMax(); } : undefined} disabled={!onMax} hitSlop={12} accessibilityRole={onMax ? 'button' : undefined} accessibilityLabel={onMax ? t('send.max') : undefined} testID={`${testID}-balance`}>
            <Txt variant="micro" tone="mute" tabular>
              {t('swap.balance', { amount: formatAmount(balance, token.decimals) })}
              {onMax ? <Txt variant="micro" tone="primary"> · {t('send.max')}</Txt> : null}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 4 }}>
        {loading ? (
          <View style={{ flex: 1, height: 44, justifyContent: 'center', alignItems: 'flex-start' }}><Spinner /></View>
        ) : (
          <TextInput
            value={amount} editable={!!onAmount} onChangeText={v => onAmount?.(v.replace(',', '.'))}
            placeholder="0" placeholderTextColor={c.fgFaint} keyboardType="decimal-pad" selectionColor={c.primary}
            accessibilityLabel={label} testID={`${testID}-amount`}
            style={{ flex: 1, minWidth: 0, height: 44, padding: 0, color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}
          />
        )}
        <Pressable
          onPress={() => { tap(); onPick(); }} accessibilityRole="button" accessibilityLabel={token ? `${token.symbol}, ${token.net.name}` : t('swap.select')} testID={`${testID}-token`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 10, borderRadius: radius.pill, backgroundColor: pressed ? c.surface2 : c.bg1, borderWidth: 1, borderColor: c.borderStrong, maxWidth: 170 })}
        >
          {token ? (
            <>
              <TokenIcon symbol={token.symbol} logo={token.logo} networkLogo={token.net.logo} palette={token.net.palette} size={28} />
              <View style={{ flexShrink: 1 }}>
                <Txt variant="label" numberOfLines={1}>{token.symbol}</Txt>
                <Txt variant="micro" tone="mute" numberOfLines={1}>{token.net.short}</Txt>
              </View>
            </>
          ) : <Txt variant="label" style={{ paddingLeft: 8 }}>{t('swap.select')}</Txt>}
          <ChevronDown size={15} color={c.fgMute} />
        </Pressable>
      </View>
      <Txt variant="small" tone="faint" tabular style={{ minHeight: 18, marginTop: 2 }}>{usd !== undefined ? formatUsd(usd) : ''}</Txt>
    </Card>
  );
}

// ── token selector ──

function TokenSelector({ model, side, onClose }: { model: SwapModel; side: 'sell' | 'buy' | null; onClose: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Product | 'all'>('all');
  const [remote, setRemote] = useState<SwapToken[]>([]);
  const [searching, setSearching] = useState(false);
  const { tokens, balances, searchRemote } = model;
  const selectedId = side === 'sell' ? model.sell?.id : model.buy?.id;
  const products = useMemo(() => [...new Set(tokens.map(x => x.product))], [tokens]);

  useEffect(() => { if (!side) { setQ(''); setRemote([]); } }, [side]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2 || (group !== 'all' && group !== 'jupiter')) { setRemote([]); setSearching(false); return; }
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
    const local = tokens.filter(x => (group === 'all' || x.product === group) && (!needle || `${x.symbol} ${x.name} ${x.net.name} ${x.ref}`.toLowerCase().includes(needle)));
    const ids = new Set(local.map(x => x.id));
    const all = [...local, ...remote.filter(x => !ids.has(x.id))];
    // Held tokens first, then the list's own order (liquidity for Jupiter, volume for Cauldron).
    return all.sort((a, b) => Number((balances.get(b.id) ?? 0n) > 0n) - Number((balances.get(a.id) ?? 0n) > 0n));
  }, [tokens, remote, q, group, balances]);

  return (
    <Sheet visible={!!side} onClose={onClose} title={t(side === 'buy' ? 'swap.youReceive' : 'swap.youPay')} tall closeLabel={t('common.close')} testID="token-selector">
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
        <Field value={q} onChangeText={setQ} placeholder={t('swap.searchTokens')} right={searching ? <Spinner /> : <Search size={17} color={c.fgFaint} />} testID="token-search" />
        {products.length > 1 ? (
          <Segmented label={t('swap.filter')} value={group} onChange={setGroup} options={[{ value: 'all' as const, label: t('common.all') }, ...products.map(p => ({ value: p, label: t(PRODUCT_LABEL[p]) }))]} />
        ) : null}
      </View>
      <FlatList
        data={shown} keyExtractor={x => x.id} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.xl }} initialNumToRender={12} windowSize={7}
        ListEmptyComponent={<Txt variant="small" tone="mute" center style={{ padding: space.xl }}>{t('swap.noTokens')}</Txt>}
        renderItem={({ item: x }) => {
          const bal = balances.get(x.id) ?? 0n;
          const on = x.id === selectedId;
          return (
            <Pressable
              onPress={() => { tap(); if (side) model.pick(side, x); onClose(); }} testID={`token-${x.id}`}
              accessibilityRole="button" accessibilityLabel={`${x.symbol}, ${x.net.name}${x.suspicious ? `, ${t('swap.suspicious')}` : !x.verified ? `, ${t('home.unverified')}` : ''}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: on ? c.primaryDim : pressed ? c.surface2 : 'transparent' })}
            >
              <TokenIcon symbol={x.symbol} logo={x.logo} networkLogo={x.net.logo} palette={x.net.palette} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{x.symbol}</Txt>
                  {x.suspicious ? <AlertTriangle size={13} color={c.red} /> : !x.verified ? <AlertTriangle size={13} color={c.amber} /> : null}
                </View>
                <Txt variant="small" tone="mute" numberOfLines={1}>{x.net.name}{x.kind === 'cashtoken' || x.kind === 'spl' ? ` · ${x.name}` : ''}</Txt>
              </View>
              {bal > 0n ? <Txt variant="label" tabular>{formatAmount(bal, x.decimals)}</Txt> : null}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

// ── progress ──

function StepList({ steps }: { steps: RunStep[] }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="list">
      {steps.map((s, i) => (
        <View key={s.key} style={{ flexDirection: 'row', gap: space.md }} testID={`step-${s.key}`} accessibilityLabel={`${i + 1}. ${s.label}: ${s.state}`}>
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: s.state === 'done' ? c.primaryDim : s.state === 'failed' ? c.redDim : c.surface2, borderWidth: 1, borderColor: s.state === 'active' ? c.primaryBorder : 'transparent' }}>
              {s.state === 'done' ? <Check size={15} color={c.primary} /> : s.state === 'failed' ? <X size={15} color={c.red} /> : s.state === 'active' ? <Spinner /> : <Txt variant="micro" tone="faint">{i + 1}</Txt>}
            </View>
            {i < steps.length - 1 ? <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: c.border, marginVertical: 3 }} /> : null}
          </View>
          <View style={{ flex: 1, paddingTop: 3, paddingBottom: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt variant="label" tone={s.state === 'pending' ? 'mute' : 'fg'} style={{ flexShrink: 1 }}>{s.label}</Txt>
              {s.link ? (
                <Pressable onPress={() => { Linking.openURL(s.link!).catch(() => {}); }} hitSlop={14} accessibilityRole="link" accessibilityLabel="Explorer">
                  <ExternalLink size={15} color={c.primary} />
                </Pressable>
              ) : null}
            </View>
            {s.note ? <Txt variant="small" tone={s.state === 'failed' ? 'red' : 'mute'}>{s.note}</Txt> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── the tab ──

export default function SwapTab() {
  const t = useT();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ assetId?: string }>();
  const model = useSwap(params.assetId);
  const [picker, setPicker] = useState<'sell' | 'buy' | null>(null);
  const [sheet, setSheet] = useState(false);
  const { sell, buy, quote, run } = model;

  const start = () => { setSheet(true); model.submit(); };
  const receiveText = quote && buy ? formatAmount(quote.receive, buy.decimals, 8) : '';

  return (
    <Screen scroll tabs testID="swap-tab">
      <Header
        title={t('swap.title')} sub={model.product ? t(PRODUCT_LABEL[model.product]) : undefined}
        right={run ? <IconButton label={t('swap.progress')} onPress={() => setSheet(true)} active={model.running} testID="swap-progress"><History size={19} color={model.running ? c.primary : c.fg} /></IconButton> : undefined}
      />

      {model.notConfigured ? (
        <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xxl }}>
          <Chameleon size={130} />
          <Banner tone="warn">{t('swap.notConfigured')}</Banner>
        </View>
      ) : (
        <>
          {model.serverDown ? <View style={{ marginBottom: space.md }}><Banner tone="warn">{t('swap.serverDown')}</Banner></View> : null}
          {model.noPools ? <View style={{ marginBottom: space.md }}><Banner tone="info">{t('swap.noPools')}</Banner></View> : null}

          {model.loadingLists && !model.tokens.length ? (
            <View style={{ gap: space.md }}><Skeleton width="100%" height={118} style={{ borderRadius: radius.lg }} /><Skeleton width="100%" height={118} style={{ borderRadius: radius.lg }} /></View>
          ) : (
            <View>
              <Side
                label={t('swap.youPay')} token={sell} amount={model.amount} onAmount={model.setAmount} onPick={() => setPicker('sell')}
                balance={sell ? model.sellBalance : undefined} usd={model.sellUsd} onMax={sell && model.sellBalance > 0n ? model.setMax : undefined} testID="sell"
              />
              <View style={{ alignItems: 'center', height: 14, zIndex: 2 }}>
                <Pressable
                  onPress={() => { tap(); model.flip(); }} accessibilityRole="button" accessibilityLabel={t('swap.flip')} testID="swap-flip" hitSlop={8}
                  style={({ pressed }) => ({ position: 'absolute', top: -15, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.bg3 : c.bg2, borderWidth: 1, borderColor: c.borderStrong })}
                >
                  <ArrowDownUp size={18} color={c.primary} />
                </Pressable>
              </View>
              <Side
                label={t('swap.youReceive')} token={buy} amount={receiveText} onPick={() => setPicker('buy')}
                balance={buy ? model.balances.get(buy.id) ?? 0n : undefined} usd={model.buyUsd} loading={model.quoting && !quote} testID="buy"
              />
            </View>
          )}

          {quote ? (
            <Card style={{ marginTop: space.md }} padding={space.md}>
              {quote.lines.map(line => <Line key={line.label} label={t(line.label)} value={line.value} tone={line.tone} />)}
            </Card>
          ) : null}

          <View style={{ gap: space.sm, marginTop: space.md }}>
            {quote?.warnings.map(w => <Banner key={w} tone="warn">{w}</Banner>)}
            {model.quoteError ? <Banner tone="error">{model.quoteError}</Banner> : null}
            {(sell?.suspicious || buy?.suspicious) ? <Banner tone="error" title={t('swap.suspicious')}>{t('swap.suspiciousLong')}</Banner> : null}
            {model.route.kind === 'cashtoken' && quote ? <Txt variant="small" tone="faint">{t('swap.note.auction')}</Txt> : null}
            {model.route.kind === 'cctp' && model.config ? <Txt variant="small" tone="faint">{t('swap.limits', { min: model.config.cctp.minTransferUsdc, max: model.config.cctp.maxTransferUsdc })}</Txt> : null}
          </View>

          <Button style={{ marginTop: space.lg }} label={model.buttonLabel} onPress={start} disabled={!model.canSubmit} testID="swap-submit" />
        </>
      )}

      <TokenSelector model={model} side={picker} onClose={() => setPicker(null)} />

      <Sheet visible={sheet && !!run} onClose={() => { setSheet(false); model.dismissRun(); }} title={run?.title} closeLabel={t('swap.close')} testID="swap-run">
        {run ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <StepList steps={run.steps} />
            {run.message ? <Banner tone={run.status === 'failed' ? 'error' : run.status === 'done' ? 'ok' : 'info'}>{run.message}</Banner> : null}
            {run.status === 'running' ? <Txt variant="small" tone="faint" center>{t('swap.keepOpenHint')}</Txt> : null}
            {run.status !== 'running' ? <Button label={t('common.done')} onPress={() => { setSheet(false); model.dismissRun(); }} testID="swap-run-done" /> : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
