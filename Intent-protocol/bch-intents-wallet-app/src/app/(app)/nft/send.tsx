/**
 * Send an NFT: the whole coin moves, so there is no amount — only a recipient. The recipient must be a
 * token-aware BCH address; the worklet refuses anything else. A position's value and warning are repeated on
 * the review step, because sending it hands over the funds it controls.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ClipboardPaste, ExternalLink, ScanLine } from 'lucide-react-native';
import { explorerTxUrl } from '@bch-intents/wallet-core/chains';
import { addActivity } from '@bch-intents/wallet-core/activity';
import { priceRange } from '@bch-intents/wallet-core/mesh/v4';
import { errorMessage, formatAmount, shortAddr } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { quoteNftTransfer, sendNft } from '@/lib/send';
import { usePortfolio } from '@/state/portfolio';
import { useScanResult } from '@/state/scan';
import { Banner, Button, buzz, Card, Empty, Field, Header, Line, Pill, Screen, tap, thud, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';

type Stage = 'form' | 'review' | 'sending' | 'sent';

export default function NftSend() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nftById, accountIndex, addresses, refresh } = usePortfolio();
  const nft = nftById(id);

  const [to, setTo] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [fee, setFee] = useState<bigint | null>(null);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState('');

  const scanned = useScanResult(s => s.result);
  const takeScan = useScanResult(s => s.take);
  useEffect(() => {
    if (!scanned) return;
    const result = takeScan();
    if (result) setTo(result.address);
  }, [scanned, takeScan]);

  // Quote the fee once a recipient is entered; its error (e.g. non-token-aware) is surfaced on review.
  const quoteFor = useRef('');
  useEffect(() => {
    if (!nft || !to.trim()) { setFee(null); return; }
    const key = to.trim();
    quoteFor.current = key;
    const timer = setTimeout(() => {
      quoteNftTransfer(nft, accountIndex, key)
        .then(f => { if (quoteFor.current === key) { setFee(f); setError(''); } })
        .catch(e => { if (quoteFor.current === key) { setFee(null); setError(errorMessage(e)); } });
    }, 350);
    return () => clearTimeout(timer);
  }, [nft, to, accountIndex]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/wallet'));

  if (!nft) {
    return (
      <Screen testID="nft-send">
        <Header title={t('nft.sendTitle')} onBack={close} backLabel={t('common.back')} />
        <Empty title={t('home.emptyTitle')} />
      </Screen>
    );
  }

  const position = nft.position;
  const feeText = fee !== null ? `${formatAmount(fee, nft.network.native.decimals, 8)} ${nft.network.native.symbol}` : t('send.feeUnknown');
  const valueText = position?.view ? `${formatAmount(BigInt(position.view.totals.valueAtBidSats), 8, 6)} BCH` : null;

  const confirm = async () => {
    setStage('sending');
    setError('');
    try {
      const hash = await sendNft(nft, accountIndex, to.trim());
      setTxid(hash);
      await addActivity({ kind: 'send', status: 'pending', network: nft.network.key, account: addresses.evm ?? '', sent: nft.name, counterparty: to.trim(), txid: hash });
      thud();
      setStage('sent');
      refresh().catch(() => {});
    } catch (e) {
      buzz();
      setError(errorMessage(e, t('send.error.failed')));
      setStage('review');
    }
  };

  if (stage === 'sent') {
    return (
      <Screen testID="nft-send-sent" footer={<Button label={t('send.done')} onPress={close} testID="nft-send-done" />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
          <TokenIcon symbol={nft.name} logo={nft.logo} networkLogo={nft.network.logo} palette={nft.network.palette} size={64} />
          <Txt variant="title" center>{t('nft.sentTitle')}</Txt>
          <Txt variant="body" tone="mute" center style={{ maxWidth: 320 }}>{t('nft.sentBody', { name: nft.name })} · {shortAddr(to.trim(), 8, 6)}</Txt>
          <Pill label={t('send.viewTx')} tone="primary" icon={<ExternalLink size={13} color={c.primary} />} onPress={() => { Linking.openURL(explorerTxUrl(nft.network, txid)).catch(() => {}); }} testID="nft-send-view-tx" />
        </View>
      </Screen>
    );
  }

  if (stage === 'review' || stage === 'sending') {
    return (
      <Screen
        scroll testID="nft-send-review"
        footer={<Button label={stage === 'sending' ? t('send.sending') : t('send.confirm')} onPress={confirm} loading={stage === 'sending'} disabled={fee === null} testID="nft-send-confirm" />}
      >
        <Header title={t('send.review.title')} onBack={stage === 'sending' ? undefined : () => { setError(''); setStage('form'); }} backLabel={t('common.back')} />
        <View style={{ alignItems: 'center', gap: 6, marginVertical: space.lg }}>
          <TokenIcon symbol={nft.name} logo={nft.logo} networkLogo={nft.network.logo} palette={nft.network.palette} size={56} />
          <Txt variant="title" center>{nft.name}</Txt>
          {valueText ? <Txt variant="small" tone="mute">{valueText}</Txt> : null}
        </View>
        <Card padding={space.md}>
          <Line label={t('send.to')} value={to.trim()} mono />
          <Line label={t('common.network')} value={nft.network.name} />
          <Line label={t('send.networkFee')} value={feeText} />
          {position ? <Line label={t('nft.range')} value={`${priceRange(position.commitment).lowSatsPerUnit.toPrecision(4)}–${priceRange(position.commitment).highSatsPerUnit.toPrecision(4)} sats/unit`} /> : null}
        </Card>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Banner tone="warn" title={position ? t('nft.positionWarningTitle') : undefined}>{position ? t('nft.positionWarning') : t('nft.collectibleWarning')}</Banner>
          {error ? <Banner tone="error">{error}</Banner> : null}
        </View>
      </Screen>
    );
  }

  const ready = !!to.trim() && fee !== null;
  return (
    <Screen scroll testID="nft-send" footer={<Button label={t('send.review')} onPress={() => { setStage('review'); }} disabled={!ready} testID="nft-send-review-button" />}>
      <Header title={t('nft.sendTitle')} sub={nft.name} onBack={close} backLabel={t('common.back')} />
      <View style={{ alignItems: 'center', gap: 6, marginVertical: space.md }}>
        <TokenIcon symbol={nft.name} logo={nft.logo} networkLogo={nft.network.logo} palette={nft.network.palette} size={56} />
        <Txt variant="label" center>{nft.name}</Txt>
      </View>
      <Field
        label={t('nft.recipient')} value={to} onChangeText={setTo} placeholder={t('nft.recipientPlaceholder')} mono multiline testID="nft-send-to"
        error={to.trim() && error ? error : undefined}
        right={
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable onPress={async () => { tap(); const text = (await Clipboard.getStringAsync().catch(() => '')).trim(); if (text) setTo(text); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.paste')} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="nft-send-paste">
              <ClipboardPaste size={19} color={c.primary} />
            </Pressable>
            <Pressable onPress={() => { tap(); router.push({ pathname: '/(app)/scan', params: { returnTo: 'nft-send' } }); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('send.scan')} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="nft-send-scan">
              <ScanLine size={19} color={c.primary} />
            </Pressable>
          </View>
        }
      />
      <View style={{ marginTop: space.md }}>
        <Banner tone="warn" title={position ? t('nft.positionWarningTitle') : undefined}>{position ? t('nft.positionWarning') : t('nft.collectibleWarning')}</Banner>
      </View>
    </Screen>
  );
}
