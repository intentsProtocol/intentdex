/** One asset: its balance and value, what can be done with it, and where it lives. */
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Copy, ExternalLink, EyeOff } from 'lucide-react-native';
import { explorerAddressUrl } from '@bch-intents/wallet-core/chains';
import { change24hOf, priceOf, valueOf } from '@bch-intents/wallet-core/assets';
import { formatAmount, formatPct, formatUsd } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { addressFor, usePortfolio } from '@/state/portfolio';
import { useSettings, useUpdateSettings } from '@/state/settings';
import { Banner, Button, Card, Empty, Header, Line, Pill, Row, Screen, thud, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';

export default function Token() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { assetById, prices, addresses } = usePortfolio();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [copied, setCopied] = useState(false);
  const asset = assetById(id);

  if (!asset) {
    return (
      <Screen testID="token">
        <Header onBack={() => router.back()} backLabel={t('common.back')} />
        <Empty title={t('home.emptyTitle')} />
      </Screen>
    );
  }

  const net = asset.network;
  const price = priceOf(asset, prices);
  const value = valueOf(asset, prices);
  const change = change24hOf(asset, prices);
  const hiddenToken = settings.hiddenTokens.includes(asset.id);
  const address = addressFor(addresses, net);
  const amount = settings.hideBalances ? '••••' : formatAmount(asset.balance, asset.decimals, 8);
  const refLabel = asset.kind === 'erc20' ? t('token.contract') : asset.kind === 'spl' ? t('token.mint') : asset.kind === 'cashtoken' ? t('token.category') : '';

  const toggleHidden = () => {
    update({ hiddenTokens: hiddenToken ? settings.hiddenTokens.filter(x => x !== asset.id) : [...settings.hiddenTokens, asset.id] });
    if (!hiddenToken) router.back();
  };

  return (
    <Screen scroll testID="token">
      <Header title={asset.name} sub={net.name} onBack={() => router.back()} backLabel={t('common.back')} />

      <Card padding={space.xl}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={net.logo} palette={net.palette} size={64} />
          <Txt variant="title" tabular center style={{ marginTop: 6 }} testID="token-balance">{amount} {asset.symbol}</Txt>
          {value !== undefined ? <Txt variant="body" tone="mute" tabular>{settings.hideBalances ? '••••' : formatUsd(value)}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 4 }}>
            {net.mode === 'testnet' ? <Pill label={t('home.testFunds')} tone="amber" /> : null}
            {!asset.verified ? <Pill label={t('home.unverified')} tone="amber" /> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
          <Button style={{ flex: 1 }} small label={t('action.send')} icon={<ArrowUpRight size={17} color={c.onPrimary} />} disabled={asset.balance === 0n} onPress={() => router.push({ pathname: '/(app)/send', params: { assetId: asset.id } })} testID="token-send" />
          <Button style={{ flex: 1 }} small kind="secondary" label={t('action.receive')} icon={<ArrowDownLeft size={17} color={c.fg} />} onPress={() => router.push({ pathname: '/(app)/receive', params: { family: net.family } })} testID="token-receive" />
          <Button style={{ flex: 1 }} small kind="secondary" label={t('action.swap')} icon={<ArrowLeftRight size={17} color={c.fg} />} onPress={() => router.push({ pathname: '/(app)/(tabs)/swap', params: { assetId: asset.id } })} testID="token-swap" />
        </View>
      </Card>

      {!asset.verified ? <View style={{ marginTop: space.md }}><Banner tone="warn" title={t('home.unverified')}>{t('home.unverifiedLong')}</Banner></View> : null}

      <Card style={{ marginTop: space.md }} padding={space.md}>
        <Line label={t('common.network')} value={net.name} />
        {price !== undefined ? <Line label={t('token.price')} value={`${formatUsd(price)}${change !== undefined ? `  ${formatPct(change)}` : ''}`} /> : null}
        {refLabel ? <Line label={refLabel} value={asset.ref} mono /> : null}
      </Card>

      <Card style={{ marginTop: space.md }} padding={space.md}>
        {refLabel ? (
          <Row
            title={copied ? t('common.copied') : `${t('common.copy')} ${refLabel}`}
            sub={asset.ref}
            icon={copied ? <Check size={17} color={c.primary} /> : <Copy size={17} color={c.fg} />}
            onPress={async () => {
              await Clipboard.setStringAsync(asset.ref);
              thud();
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          />
        ) : null}
        {address ? (
          <Row
            title={t('home.viewOnExplorer')} icon={<ExternalLink size={17} color={c.fg} />} testID="token-explorer"
            onPress={() => { Linking.openURL(explorerAddressUrl(net, address)).catch(() => {}); }}
          />
        ) : null}
        <Row title={t(hiddenToken ? 'token.unhide' : 'home.hideToken')} icon={<EyeOff size={17} color={c.fg} />} onPress={toggleHidden} last testID="token-hide" />
      </Card>
    </Screen>
  );
}
