/** One NFT: a collectible, or a Mesh V4 liquidity position shown as what it controls. */
import React from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, EyeOff, Gem } from 'lucide-react-native';
import { explorerAddressUrl } from '@bch-intents/wallet-core/chains';
import { priceRange } from '@bch-intents/wallet-core/mesh/v4';
import { formatAmount } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { addressFor, usePortfolio } from '@/state/portfolio';
import { useSettings, useUpdateSettings } from '@/state/settings';
import { Banner, Button, Card, Empty, Header, Line, Pill, Row, Screen, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';

const short = (hex: string) => (hex.length > 40 ? `${hex.slice(0, 20)}…${hex.slice(-16)}` : hex);

export default function Nft() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nftById, addresses } = usePortfolio();
  const settings = useSettings();
  const update = useUpdateSettings();
  const nft = nftById(id);

  if (!nft) {
    return (
      <Screen testID="nft">
        <Header onBack={() => router.back()} backLabel={t('common.back')} />
        <Empty title={t('home.emptyTitle')} />
      </Screen>
    );
  }

  const net = nft.network;
  const position = nft.position;
  const view = position?.view;
  const hidden = settings.hiddenTokens.includes(nft.id);
  const address = addressFor(addresses, net);

  const toggleHidden = () => {
    update({ hiddenTokens: hidden ? settings.hiddenTokens.filter(x => x !== nft.id) : [...settings.hiddenTokens, nft.id] });
    if (!hidden) router.back();
  };

  return (
    <Screen scroll testID="nft">
      <Header title={nft.name} sub={net.name} onBack={() => router.back()} backLabel={t('common.back')} />

      <Card padding={space.xl}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          {position ? (
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.primaryDim, alignItems: 'center', justifyContent: 'center' }}>
              <Gem size={30} color={c.primary} />
            </View>
          ) : (
            <TokenIcon symbol={nft.name} logo={nft.logo} networkLogo={net.logo} palette={net.palette} size={64} />
          )}
          <Txt variant="title" center style={{ marginTop: 6 }}>{nft.name}</Txt>
          {nft.description ? <Txt variant="small" tone="mute" center>{nft.description}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
            {position ? <Pill label="Mesh V4" tone="primary" /> : null}
            <Pill label={t(`nft.capability.${nft.capability}` as const)} tone={nft.capability === 'minting' ? 'amber' : 'mute'} />
            {net.mode === 'testnet' ? <Pill label={t('home.testFunds')} tone="amber" /> : null}
            {!nft.verified && !position ? <Pill label={t('home.unverified')} tone="amber" /> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
          <Button style={{ flex: 1 }} small label={t('action.send')} icon={<ArrowUpRight size={17} color={c.onPrimary} />} onPress={() => router.push({ pathname: '/(app)/nft/send', params: { id: nft.id } })} testID="nft-send" />
          <Button style={{ flex: 1 }} small kind="secondary" label={t('action.receive')} icon={<ArrowDownLeft size={17} color={c.fg} />} onPress={() => router.push({ pathname: '/(app)/receive', params: { family: net.family } })} testID="nft-receive" />
        </View>
      </Card>

      {position ? (
        <>
          <View style={{ marginTop: space.md }}>
            <Banner tone="warn" title={t('nft.positionWarningTitle')}>{t('nft.positionWarning')}</Banner>
          </View>
          <Card style={{ marginTop: space.md }} padding={space.md}>
            <Line label={t('nft.shape')} value={position.commitment.shape} />
            <Line label={t('nft.step')} value={`${(position.commitment.binStepBps / 100).toFixed(2)}%`} />
            <Line label={t('nft.range')} value={`${priceRange(position.commitment).lowSatsPerUnit.toPrecision(4)}–${priceRange(position.commitment).highSatsPerUnit.toPrecision(4)} sats/unit`} />
            {view ? <Line label={t('nft.value')} value={`${formatAmount(BigInt(view.totals.valueAtBidSats), 8, 6)} BCH`} /> : null}
            <Line label={t('nft.bins')} value={view ? `${view.bins.filter(b => b.utxos.length > 0).length}/${position.commitment.binCount}` : String(position.commitment.binCount)} />
            <Line label={t('nft.created')} value={String(position.commitment.createdHeight)} />
          </Card>
        </>
      ) : null}

      <Card style={{ marginTop: space.md }} padding={space.md}>
        <Line label={t('common.network')} value={net.name} />
        <Line label={t('token.category')} value={short(nft.category)} mono />
        <Line label={t('nft.commitment')} value={nft.commitment ? short(nft.commitment) : t('nft.noCommitment')} mono />
        {nft.amount > 0n ? <Line label={t('nft.fungibleAmount')} value={formatAmount(nft.amount, 0)} /> : null}
      </Card>

      <Card style={{ marginTop: space.md }} padding={space.md}>
        {address ? (
          <Row
            title={t('home.viewOnExplorer')} icon={<ExternalLink size={17} color={c.fg} />} testID="nft-explorer"
            onPress={() => { Linking.openURL(explorerAddressUrl(net, address)).catch(() => {}); }}
          />
        ) : null}
        <Row title={t(hidden ? 'token.unhide' : 'home.hideToken')} icon={<EyeOff size={17} color={c.fg} />} onPress={toggleHidden} last testID="nft-hide" />
      </Card>
    </Screen>
  );
}
