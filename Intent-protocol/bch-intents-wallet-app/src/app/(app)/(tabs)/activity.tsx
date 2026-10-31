/**
 * The Activity tab: what this account did and received on the current network mode. Rows come from the
 * wallet's own record and from chain history; a pending row is followed until it settles, and a bridge that
 * stopped halfway offers the step that finishes it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ExternalLink, Globe, PenLine, Plug } from 'lucide-react-native';
import { explorerTxUrl, getNetwork, networksFor } from '@bch-intents/wallet-core/chains';
import { readActivity, type ActivityEntry, type ActivityStatus } from '@bch-intents/wallet-core/activity';
import { errorMessage, shortAddr, timeAgo } from '@bch-intents/wallet-core/format';
import { swapServerApiFor } from '@bch-intents/wallet-core/swap/api';
import { payFee, resumeBridge } from '@bch-intents/wallet-core/swap/flows';
import { useT, type Key } from '@/i18n';
import { loadChainHistory, mergeActivity, reconcileActivity, type BridgeAction } from '@/lib/activity';
import { usePortfolio } from '@/state/portfolio';
import { bridgeDeps, getSwapConfig } from '@/swap/runtime';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Empty, Header, Line, Pill, Screen, Sheet, Skeleton, Spinner, tap, Txt } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

const KIND_ICON = { send: ArrowUpRight, receive: ArrowDownLeft, swap: ArrowLeftRight, bridge: Globe, sign: PenLine, connect: Plug };
const KIND_LABEL: Record<ActivityEntry['kind'], Key> = {
  send: 'activity.kind.send', receive: 'activity.kind.receive', swap: 'activity.kind.swap', bridge: 'activity.kind.bridge', sign: 'activity.kind.sign', connect: 'activity.kind.connect',
};
const STATUS_LABEL: Record<ActivityStatus, Key> = {
  pending: 'activity.status.pending', confirmed: 'activity.status.confirmed', failed: 'activity.status.failed', refunded: 'activity.status.refunded',
};
const STATUS_TONE: Record<ActivityStatus, 'primary' | 'amber' | 'red' | 'mute'> = { confirmed: 'primary', pending: 'amber', failed: 'red', refunded: 'mute' };

export default function ActivityTab() {
  const t = useT();
  const { c } = useTheme();
  const { mode, accountIndex, addresses, refresh: refreshPortfolio } = usePortfolio();
  const account = addresses.evm?.toLowerCase() ?? '';
  const [local, setLocal] = useState<ActivityEntry[]>([]);
  const [chain, setChain] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ActivityEntry | null>(null);
  const [actions, setActions] = useState<Record<string, BridgeAction>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const modeKeys = useMemo(() => networksFor(mode).map(n => n.key), [mode]);

  const loadLocal = useCallback(async () => {
    const all = await readActivity();
    setLocal(all.filter(e => e.account === account && modeKeys.includes(e.network)));
  }, [account, modeKeys]);

  const settle = useCallback(async () => {
    if (!account) return;
    setActions(await reconcileActivity(mode, account, t));
    await loadLocal();
  }, [mode, account, t, loadLocal]);

  const reload = useCallback(async () => {
    if (!account) return;
    await Promise.all([
      loadChainHistory(mode, accountIndex, account, t).then(setChain).catch(() => {}),
      settle(),
    ]);
    setLoading(false);
  }, [mode, accountIndex, account, t, settle]);

  // A new account or mode starts from an empty list.
  useEffect(() => { setLocal([]); setChain([]); setLoading(true); }, [mode, accountIndex]);

  // Reload whenever the tab comes into view, and follow pending rows while it stays there.
  useFocusEffect(useCallback(() => {
    reload();
    const id = setInterval(() => { settle().catch(() => {}); }, 12_000);
    return () => clearInterval(id);
  }, [reload, settle]));

  const entries = useMemo(() => mergeActivity(local, chain), [local, chain]);

  const runAction = async (entry: ActivityEntry, action: BridgeAction) => {
    setBusy(entry.id);
    setActionError('');
    try {
      const api = swapServerApiFor(mode === 'mainnet');
      const config = api ? await getSwapConfig(api) : undefined;
      const src = config?.cctp.chains.find(x => x.key === action.srcKey);
      if (!src) throw new Error(t('activity.bridgeUnavailable'));
      const deps = await bridgeDeps(mode, accountIndex);
      if (action.kind === 'payFee') await payFee(action.transferId, src, deps);
      else await resumeBridge(action.transferId, src, deps);
      await settle();
      refreshPortfolio().catch(() => {});
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const title = (e: ActivityEntry) => {
    const kind = t(KIND_LABEL[e.kind]);
    if (e.kind === 'send' && e.counterparty) return `${kind} · ${shortAddr(e.counterparty)}`;
    if (e.kind === 'bridge' && e.toNetwork) return `${kind} → ${getNetwork(e.toNetwork)?.short ?? e.toNetwork}`;
    return kind;
  };

  const openNet = open ? getNetwork(open.network) : undefined;
  const openAction = open ? actions[open.id] : undefined;

  return (
    <Screen
      scroll tabs testID="activity-tab"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.primary} colors={[c.primary]} onRefresh={() => { setRefreshing(true); reload().finally(() => setRefreshing(false)); }} />}
    >
      <Header title={t('activity.title')} />

      {loading && !entries.length ? (
        <View style={{ gap: space.lg, padding: space.sm }}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Skeleton width={40} height={40} />
              <View style={{ flex: 1, gap: 6 }}><Skeleton width="45%" /><Skeleton width="30%" height={12} /></View>
            </View>
          ))}
        </View>
      ) : !entries.length ? (
        <Empty icon={<Chameleon size={120} />} title={t('activity.empty.title')} body={t('activity.empty.body')} />
      ) : (
        <Card padding={space.sm}>
          {entries.map((e, i) => {
            const Icon = KIND_ICON[e.kind];
            const net = getNetwork(e.network);
            const amount = e.kind === 'receive' ? e.received : e.sent;
            return (
              <Pressable
                key={e.id} onPress={() => { tap(); setActionError(''); setOpen(e); }} testID={`activity-${e.id}`}
                accessibilityRole="button" accessibilityLabel={`${title(e)}, ${amount ?? ''}, ${t(STATUS_LABEL[e.status])}, ${timeAgo(e.at)}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.sm, borderRadius: 14, backgroundColor: pressed ? c.surface2 : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: c.border })}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: e.kind === 'receive' ? c.primaryDim : c.surface2 }}>
                  <Icon size={18} color={e.kind === 'receive' ? c.primary : c.fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="label" numberOfLines={1}>{title(e)}</Txt>
                  <Txt variant="small" tone="mute" numberOfLines={1}>{net?.short ?? e.network} · {timeAgo(e.at)}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3, maxWidth: '44%' }}>
                  {amount ? <Txt variant="label" tabular numberOfLines={1} tone={e.kind === 'receive' ? 'primary' : 'fg'}>{e.kind === 'receive' ? '+' : e.kind === 'send' ? '−' : ''}{amount}</Txt> : null}
                  {e.status !== 'confirmed' || actions[e.id]
                    ? <Pill label={t(STATUS_LABEL[e.status])} tone={STATUS_TONE[e.status]} icon={e.status === 'pending' ? <Spinner color={c.amber} /> : undefined} />
                    : null}
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? title(open) : ''} closeLabel={t('common.close')} testID="activity-detail">
        {open ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <Card padding={space.md}>
              <Line label={t('activity.status')} value={t(STATUS_LABEL[open.status])} tone={open.status === 'pending' ? 'warn' : undefined} />
              {open.sent ? <Line label={t('activity.sent')} value={open.sent} /> : null}
              {open.received ? <Line label={t(open.status === 'pending' && open.kind !== 'receive' ? 'activity.expected' : 'activity.received')} value={open.received} /> : null}
              <Line label={t('common.network')} value={openNet?.name ?? open.network} />
              {open.toNetwork ? <Line label={t('activity.toNetwork')} value={getNetwork(open.toNetwork)?.name ?? open.toNetwork} /> : null}
              {open.counterparty ? <Line label={t('send.to')} value={open.counterparty} mono /> : null}
              {open.origin ? <Line label={t('activity.site')} value={open.origin} /> : null}
              <Line label={t('activity.time')} value={new Date(open.at).toLocaleString()} />
              {open.txid ? <Line label={t('send.txid')} value={shortAddr(open.txid, 10, 8)} mono /> : null}
            </Card>
            {open.note ? <Banner tone={open.status === 'failed' ? 'error' : 'info'}>{open.note}</Banner> : null}
            {actionError ? <Banner tone="error">{actionError}</Banner> : null}
            {openAction ? (
              <Button
                label={t(openAction.kind === 'payFee' ? 'activity.payFee' : 'activity.resume')} loading={busy === open.id} testID="activity-action"
                onPress={() => runAction(open, openAction)}
              />
            ) : null}
            {open.txid && openNet ? (
              <Button kind="secondary" label={t('activity.viewTx')} icon={<ExternalLink size={17} color={c.fg} />} onPress={() => { Linking.openURL(explorerTxUrl(openNet, open.txid!)).catch(() => {}); }} testID="activity-explorer" />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
