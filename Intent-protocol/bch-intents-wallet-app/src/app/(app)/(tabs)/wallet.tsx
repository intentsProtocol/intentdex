/** The Wallet tab: who and where (account, network), what it is worth, and what the account holds. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, Eye, EyeOff, Lock, ScanLine, Wallet as WalletIcon } from 'lucide-react-native';
import { FAMILY_LABEL, networksFor, type NetworkMode } from '@bch-intents/wallet-core/chains';
import { valueOf, type Asset } from '@bch-intents/wallet-core/assets';
import { formatUsd, timeAgo } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { accountName, useAccounts } from '@/state/accounts';
import { usePortfolio } from '@/state/portfolio';
import { useSettings, useUpdateSettings } from '@/state/settings';
import { AssetRow } from '@/ui/AssetRow';
import { CollectibleRow, PositionRow } from '@/ui/NftRow';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Empty, IconButton, Pill, Screen, Sheet, Skeleton, tap, Txt } from '@/ui/primitives';
import { radius, space, useTheme } from '@/ui/theme';
import { useWalletActions } from '@/wdk/session';

function Action({ label, onPress, children, testID }: { label: string; onPress: () => void; children: React.ReactNode; testID: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={label} testID={testID}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary }}>{children}</View>
      <Txt variant="small" weight="600">{label}</Txt>
    </Pressable>
  );
}

/** Token rows drawn at a time; more on request. */
const PAGE = 30;

export default function WalletTab() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const settings = useSettings();
  const update = useUpdateSettings();
  const { lock } = useWalletActions();
  const { names, active } = useAccounts();
  const { mode, isMainnet, assets, nftGroups, positions, positionValueSats, prices, loading, refreshing, refresh, stale, addressError, spamDropped, isOfflineSnapshot, snapshotAt } = usePortfolio();
  const [networkSheet, setNetworkSheet] = useState(false);
  const [confirmMainnet, setConfirmMainnet] = useState(false);

  const visible = useMemo(() => assets.filter(a => !settings.hiddenTokens.includes(a.id)), [assets, settings.hiddenTokens]);
  const held = useMemo(() => visible.filter(a => a.balance > 0n), [visible]);
  const empty = useMemo(() => visible.filter(a => a.balance === 0n), [visible]);
  const shown = settings.showEmptyTokens ? visible : held;
  // Spam: an address on a busy chain collects hundreds of unverified airdrops. They are hidden unless the user
  // asks, and the list draws a page at a time, so a spammed wallet opens as fast as a clean one.
  const [showUnverified, setShowUnverified] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const trusted = useMemo(() => shown.filter(a => a.verified || a.kind === 'native' || (valueOf(a, prices) ?? 0) >= 1), [shown, prices]);
  const unverifiedLoaded = shown.length - trusted.length;
  const unverified = unverifiedLoaded + spamDropped;
  const listed = showUnverified ? shown : trusted;
  const rows = listed.slice(0, limit);
  useEffect(() => { if (assets.length) console.log('[wallet] assets', assets.length, 'shown', shown.length, 'unverified hidden', unverified, 'not loaded', spamDropped); }, [assets.length, shown.length, unverified, spamDropped]);
  // On mainnet, liquidity-position value (held in covenants, not in the account's UTXOs) joins the headline
  // total. It is priced by the Mesh server in sats, converted here with the BCH price. Testnet has no total.
  const positionsUsd = useMemo(() => {
    if (!isMainnet || positionValueSats === 0n) return 0;
    const bchUsd = prices.BCH?.usd ?? 0;
    return (Number(positionValueSats) / 1e8) * bchUsd;
  }, [isMainnet, positionValueSats, prices]);
  const total = useMemo(() => held.reduce((sum, a) => sum + (valueOf(a, prices) ?? 0), 0) + positionsUsd, [held, prices, positionsUsd]);
  const faucets = useMemo(() => (isMainnet ? [] : networksFor(mode).filter(n => n.faucet).filter((n, i, all) => all.findIndex(x => x.faucet === n.faucet) === i)), [isMainnet, mode]);

  const openAsset = useCallback((asset: Asset) => router.push({ pathname: '/(app)/token/[id]', params: { id: asset.id } }), [router]);
  const openNft = useCallback((id: string) => router.push({ pathname: '/(app)/nft/[id]', params: { id } }), [router]);
  const visibleGroups = useMemo(() => nftGroups.filter(g => g.items.some(n => !settings.hiddenTokens.includes(n.id))), [nftGroups, settings.hiddenTokens]);
  const visiblePositions = useMemo(() => positions.filter(p => !settings.hiddenTokens.includes(p.id)), [positions, settings.hiddenTokens]);

  const setMode = (next: NetworkMode) => {
    if (next === mode) { setNetworkSheet(false); return; }
    if (next === 'mainnet' && !confirmMainnet) { setConfirmMainnet(true); return; }
    update({ mode: next });
    setConfirmMainnet(false);
    setNetworkSheet(false);
  };

  const hidden = settings.hideBalances;

  return (
    <Screen
      scroll tabs testID="wallet-tab"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { refresh().catch(() => {}); }} tintColor={c.primary} colors={[c.primary]} />}
    >
      {/* who and where */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52 }}>
        <Pressable
          onPress={() => { tap(); router.push('/(app)/accounts'); }} accessibilityRole="button" accessibilityLabel={`${t('home.account')}: ${accountName(names, active)}`} testID="account-trigger"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 12, minHeight: 44, borderRadius: radius.pill, backgroundColor: pressed ? c.surface2 : c.surface, borderWidth: 1, borderColor: c.border, flexShrink: 1 })}
        >
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.primaryDim, alignItems: 'center', justifyContent: 'center' }}>
            <WalletIcon size={15} color={c.primary} />
          </View>
          <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{accountName(names, active)}</Txt>
          <ChevronDown size={15} color={c.fgMute} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pill
          label={t(isMainnet ? 'network.mainnet' : 'network.testnet')} tone={isMainnet ? 'primary' : 'amber'} testID="network-pill"
          onPress={() => { setConfirmMainnet(false); setNetworkSheet(true); }}
        />
        <IconButton label={t('home.scan')} onPress={() => router.push('/(app)/scan')} testID="open-scan"><ScanLine size={19} color={c.fg} /></IconButton>
        <IconButton label={t('common.lock')} onPress={() => { lock().catch(() => {}); }} testID="lock"><Lock size={18} color={c.fg} /></IconButton>
      </View>

      {/* what it is worth */}
      <Card style={{ marginTop: space.md }} padding={space.xl}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt variant="small" tone="mute">{t(isMainnet ? 'home.portfolio' : 'home.testnetBalance')}</Txt>
              <Pressable
                onPress={() => { tap(); update({ hideBalances: !hidden }); }} hitSlop={14} testID="toggle-balances"
                accessibilityRole="button" accessibilityLabel={t(hidden ? 'home.showBalances' : 'home.hideBalances')}
              >
                {hidden ? <EyeOff size={16} color={c.fgMute} /> : <Eye size={16} color={c.fgMute} />}
              </Pressable>
            </View>
            {loading && !assets.length
              ? <Skeleton width={170} height={38} style={{ marginTop: 8 }} />
              : isMainnet
                ? <Txt variant="display" tabular numberOfLines={1} adjustsFontSizeToFit testID="total">{hidden ? '••••••' : formatUsd(total)}</Txt>
                : <Txt variant="display" numberOfLines={1} testID="total">{t('home.assetCount', { count: held.length })}</Txt>}
            {!isMainnet ? <Txt variant="small" tone="faint">{t('home.testFundsLong')}</Txt> : null}
          </View>
          <Chameleon size={92} mood={refreshing || loading ? 'busy' : 'idle'} />
        </View>
        <View style={{ flexDirection: 'row', marginTop: space.xl }}>
          <Action label={t('action.send')} onPress={() => router.push('/(app)/send')} testID="action-send"><ArrowUpRight size={22} color={c.onPrimary} /></Action>
          <Action label={t('action.receive')} onPress={() => router.push('/(app)/receive')} testID="action-receive"><ArrowDownLeft size={22} color={c.onPrimary} /></Action>
          <Action label={t('action.swap')} onPress={() => router.push('/(app)/(tabs)/swap')} testID="action-swap"><ArrowLeftRight size={22} color={c.onPrimary} /></Action>
        </View>
      </Card>

      <View style={{ gap: space.sm, marginTop: space.md }}>
        {addressError ? <Banner tone="error">{t('error.worklet')}</Banner> : null}
        {isOfflineSnapshot ? (
          <Banner tone="info" action={<Button small kind="secondary" label={t('common.retry')} onPress={() => { refresh().catch(() => {}); }} />}>
            {snapshotAt ? `${t('agent.chip.offline')} · ${t('agent.card.savedAgo', { time: timeAgo(snapshotAt) })}` : t('agent.chip.offline')}
          </Banner>
        ) : null}
        {!settings.backedUp ? (
          <Banner tone="warn" action={<Button small kind="secondary" label={t('home.backupNow')} onPress={() => router.push({ pathname: '/(app)/settings/[view]', params: { view: 'recovery' } })} testID="backup-now" />}>
            {t('home.backupWarning')}
          </Banner>
        ) : null}
        {stale.length ? <Banner tone="warn">{t('home.stale', { chains: stale.map(f => FAMILY_LABEL[f]).join(', ') })}</Banner> : null}
      </View>

      {/* liquidity positions (NFTs) */}
      {visiblePositions.length ? (
        <View style={{ marginTop: space.xl, gap: space.sm }}>
          <View style={{ paddingHorizontal: 4 }}>
            <Txt variant="heading" accessibilityRole="header">{t('nft.positions')}</Txt>
            <Txt variant="small" tone="faint">{t('nft.positionsSub')}</Txt>
          </View>
          {visiblePositions.map(p => (
            <PositionRow key={p.id} holding={p} labels={{ value: t('nft.value'), bins: t('nft.bins'), step: t('nft.step'), symbol: 'BCH' }} onPress={h => openNft(h.id)} />
          ))}
        </View>
      ) : null}

      {/* what the account holds */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.xs, paddingHorizontal: 4 }}>
        <Txt variant="heading" accessibilityRole="header">{t('home.tokens')}</Txt>
        {held.length ? <Txt variant="small" tone="mute">{t('home.assetCount', { count: held.length })}</Txt> : null}
      </View>

      {loading && !assets.length ? (
        <View style={{ gap: space.lg, padding: space.sm }}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Skeleton width={40} height={40} />
              <View style={{ flex: 1, gap: 6 }}><Skeleton width="40%" /><Skeleton width="60%" height={12} /></View>
            </View>
          ))}
        </View>
      ) : (
        <>
          {rows.map(asset => <AssetRow key={asset.id} asset={asset} prices={prices} hidden={hidden} onPress={openAsset} unverifiedLabel={t('home.unverified')} />)}
          {listed.length > rows.length ? (
            <Button kind="ghost" small style={{ marginTop: space.sm }} testID="show-more-tokens"
              label={t('home.showMore', { count: Math.min(PAGE, listed.length - rows.length) })} onPress={() => setLimit(n => n + PAGE)} />
          ) : null}
          {unverified > 0 ? (
            <Button kind="ghost" small style={{ marginTop: space.xs }} testID="toggle-unverified"
              label={showUnverified ? t('home.hideUnverified') : t('home.showUnverified', { count: unverified })}
              onPress={() => { setShowUnverified(v => !v); setLimit(PAGE); }} />
          ) : null}
          {!held.length ? (
            <Empty title={t('home.emptyTitle')} body={t(isMainnet ? 'home.emptyMainnet' : 'home.emptyTestnet')} action={<Button small label={t('action.receive')} onPress={() => router.push('/(app)/receive')} />} />
          ) : null}
          {!held.length && faucets.length ? (
            <Card padding={space.md}>
              <Txt variant="small" tone="mute" style={{ marginBottom: space.sm }}>{t('home.faucetHint')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {faucets.map(n => <Pill key={n.key} label={n.nativeIsUsdc || n.family === 'evm' ? 'USDC' : n.native.symbol} tone="primary" onPress={() => { Linking.openURL(n.faucet!).catch(() => {}); }} />)}
              </View>
            </Card>
          ) : null}
          {empty.length ? (
            <Button
              kind="ghost" small style={{ marginTop: space.sm }} testID="toggle-empty"
              label={settings.showEmptyTokens ? t('home.hideEmpty') : t('home.showEmpty', { count: empty.length })}
              onPress={() => update({ showEmptyTokens: !settings.showEmptyTokens })}
            />
          ) : null}
        </>
      )}

      {/* collectibles (NFTs) */}
      {visibleGroups.length ? (
        <View style={{ marginTop: space.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.xs, paddingHorizontal: 4 }}>
            <Txt variant="heading" accessibilityRole="header">{t('nft.collectibles')}</Txt>
            <Txt variant="small" tone="mute">{t('nft.count', { count: visibleGroups.reduce((n, g) => n + g.items.filter(i => !settings.hiddenTokens.includes(i.id)).length, 0) })}</Txt>
          </View>
          {visibleGroups.map(g => {
            const items = g.items.filter(n => !settings.hiddenTokens.includes(n.id));
            return (
              <CollectibleRow
                key={g.category} group={{ ...g, items }} countLabel={t('nft.count', { count: items.length })}
                onPress={() => (items.length === 1 ? openNft(items[0].id) : router.push({ pathname: '/(app)/nft/group/[category]', params: { category: g.category } }))}
              />
            );
          })}
        </View>
      ) : null}

      {/* network */}
      <Sheet visible={networkSheet} onClose={() => setNetworkSheet(false)} title={t('network.switch')} closeLabel={t('common.close')} testID="network-sheet">
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {(['testnet', 'mainnet'] as const).map(m => {
            const on = mode === m;
            return (
              <Pressable
                key={m} onPress={() => { tap(); setMode(m); }} accessibilityRole="radio" accessibilityState={{ selected: on }} testID={`mode-${m}`}
                style={{ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.primaryBorder : c.border, backgroundColor: on ? c.primaryDim : c.surface }}
              >
                <Txt variant="label" tone={on ? 'primary' : 'fg'}>{t(m === 'mainnet' ? 'network.mainnet' : 'network.testnet')}</Txt>
                <Txt variant="small" tone="mute">{t(m === 'mainnet' ? 'network.mainnetSub' : 'network.testnetSub')}</Txt>
              </Pressable>
            );
          })}
          {confirmMainnet ? (
            <>
              <Banner tone="warn">{t('network.mainnetWarning')}</Banner>
              <Button label={t('network.useMainnet')} onPress={() => setMode('mainnet')} testID="confirm-mainnet" />
            </>
          ) : <Txt variant="small" tone="faint">{t('network.hint')}</Txt>}
        </View>
      </Sheet>
    </Screen>
  );
}
