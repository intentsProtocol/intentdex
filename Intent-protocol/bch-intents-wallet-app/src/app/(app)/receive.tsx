/** Receive: the active account's address on a chain, as a QR code and as text to copy or share. */
import React, { useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Check, Copy, Share2 } from 'lucide-react-native';
import { FAMILIES, FAMILY_LABEL, FAMILY_PALETTE, networksOf, type Family } from '@bch-intents/wallet-core/chains';
import { useT, type Key } from '@/i18n';
import { usePortfolio } from '@/state/portfolio';
import { Banner, Button, Card, Header, Screen, Segmented, thud, Txt } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

const FAMILY_TAB: Record<Family, string> = { bch: 'BCH', evm: 'EVM', solana: 'Solana', btc: 'BTC' };
const NOTE: Record<Family, Key> = { bch: 'receive.note.bch', evm: 'receive.note.evm', solana: 'receive.note.solana', btc: 'receive.note.btc' };

export default function Receive() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ family?: Family }>();
  const { addresses, mode, isMainnet } = usePortfolio();
  const [family, setFamily] = useState<Family>(params.family && FAMILIES.includes(params.family) ? params.family : 'bch');
  const [tokenAddress, setTokenAddress] = useState(false);
  const [copied, setCopied] = useState(false);

  const address = family === 'bch' && tokenAddress ? addresses.bchToken : addresses[family];
  const chain = FAMILY_LABEL[family];
  const evmNetworks = networksOf(mode, 'evm');
  const note = family === 'bch' && tokenAddress ? t('receive.note.token')
    : family === 'evm' ? t('receive.note.evm', { networks: evmNetworks.map(n => n.short).join(', ') })
    : t(NOTE[family]);

  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    thud();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const share = () => { if (address) Share.share({ message: t('receive.shareMessage', { chain, address }) }).catch(() => {}); };

  return (
    <Screen
      scroll testID="receive"
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button style={{ flex: 1 }} label={copied ? t('common.copied') : t('receive.copy')} onPress={copy} disabled={!address} icon={copied ? <Check size={18} color={c.onPrimary} /> : <Copy size={18} color={c.onPrimary} />} testID="receive-copy" />
          <Button kind="secondary" label={t('common.share')} onPress={share} disabled={!address} icon={<Share2 size={18} color={c.fg} />} testID="receive-share" />
        </View>
      }
    >
      <Header title={t('receive.title')} onBack={() => router.back()} backLabel={t('common.back')} />
      <Segmented label={t('receive.chain')} value={family} onChange={f => { setFamily(f); setCopied(false); }} options={FAMILIES.map(f => ({ value: f, label: FAMILY_TAB[f] }))} />
      {family === 'bch' ? (
        <View style={{ marginTop: space.sm }}>
          <Segmented
            label={t('receive.addressType')} value={tokenAddress ? 'token' : 'bch'} onChange={v => { setTokenAddress(v === 'token'); setCopied(false); }}
            options={[{ value: 'bch', label: t('receive.bchAddress') }, { value: 'token', label: t('receive.tokenAddress') }]}
          />
        </View>
      ) : null}

      <Card style={{ marginTop: space.lg }} padding={space.xl}>
        {address ? (
          <View style={{ alignItems: 'center', gap: space.lg }}>
            <Txt variant="small" tone="mute">{t('receive.yourAddress', { chain })}</Txt>
            {/* A QR code is read by cameras, which want dark on light whatever the theme. */}
            <View style={{ padding: 14, borderRadius: 18, backgroundColor: '#ffffff' }} accessible accessibilityRole="image" accessibilityLabel={`QR: ${address}`} testID="receive-qr">
              <QRCode value={address} size={210} color="#0b1210" backgroundColor="#ffffff" ecl="M" />
            </View>
            <Txt variant="label" center selectable tabular style={{ color: c.chain[FAMILY_PALETTE[family]] }} testID="receive-address">{address}</Txt>
          </View>
        ) : <Banner tone="error">{t('receive.unavailable', { chain })}</Banner>}
      </Card>

      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Banner tone="info">{note}</Banner>
        {family === 'evm' ? <Txt variant="small" tone="faint" center>{t('receive.evmNetworks', { count: evmNetworks.length })}</Txt> : null}
        {!isMainnet ? <Txt variant="small" tone="amber" center>{t('receive.testnetOnly')}</Txt> : null}
      </View>
    </Screen>
  );
}
