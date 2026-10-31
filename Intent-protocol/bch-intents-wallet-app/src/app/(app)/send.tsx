/**
 * Send: choose an asset, a recipient and an amount; review; confirm. One screen in three stages, so "back"
 * from the review keeps what was typed.
 *
 * Opened with `assetId` from a token's screen, or with `to` (and maybe `amount`) from the scanner.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ChevronDown, ClipboardPaste, ExternalLink, ScanLine } from 'lucide-react-native';
import { explorerTxUrl, type Family } from '@bch-intents/wallet-core/chains';
import { addActivity } from '@bch-intents/wallet-core/activity';
import { valueOf } from '@bch-intents/wallet-core/assets';
import { errorMessage, formatAmount, formatUnits, formatUsd, parseUnits, shortAddr } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { normalizeRecipient, quoteSend, sendAsset, SendError, validateAddress, type SendQuote } from '@/lib/send';
import { addressFor, usePortfolio } from '@/state/portfolio';
import { useScanResult } from '@/state/scan';
import { useSettings } from '@/state/settings';
import { AssetPicker } from '@/ui/AssetPicker';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, buzz, Card, Empty, Field, Header, Line, Pill, Screen, tap, thud, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { radius, space, useTheme } from '@/ui/theme';

type Stage = 'form' | 'review' | 'sending' | 'sent';

export default function Send() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ assetId?: string; to?: string; amount?: string; family?: Family; network?: string }>();
  const settings = useSettings();
  const { assets, prices, addresses, accountIndex, nativeOf, refresh } = usePortfolio();

  const sendable = useMemo(() => assets.filter(a => a.balance > 0n && !settings.hiddenTokens.includes(a.id)), [assets, settings.hiddenTokens]);
  const [assetId, setAssetId] = useState<string | undefined>(params.assetId);
  const [to, setTo] = useState(params.to ?? '');
  const [amount, setAmount] = useState(params.amount ?? '');
  const [stage, setStage] = useState<Stage>('form');
  const [picker, setPicker] = useState(false);
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState('');

  // A scanned address chose the family; pick the asset to pay it with once balances are known.
  useEffect(() => {
    if (assetId || !sendable.length) return;
    const forNetwork = params.network ? sendable.find(a => a.network.key === params.network && a.kind === 'native') : undefined;
    const forFamily = params.family ? sendable.find(a => a.network.family === params.family && a.kind === 'native') ?? sendable.find(a => a.network.family === params.family) : undefined;
    setAssetId((forNetwork ?? forFamily ?? (params.family ? undefined : sendable[0]))?.id);
  }, [assetId, sendable, params.family, params.network]);

  // An address scanned from here comes back through the scan store.
  const scanned = useScanResult(s => s.result);
  const takeScan = useScanResult(s => s.take);
  useEffect(() => {
    if (!scanned) return;
    const result = takeScan();
    if (!result) return;
    setTo(result.address);
    if (result.amount) setAmount(result.amount);
  }, [scanned, takeScan]);

  const asset = assets.find(a => a.id === assetId);
  const native = asset ? nativeOf(asset.network) : undefined;

  const recipient = asset ? normalizeRecipient(asset, to) : to.trim();
  const addressProblem = asset && to.trim() ? validateAddress(asset, recipient) : null;
  const own = !!asset && !!recipient && [addressFor(addresses, asset.network), addresses.bchToken].some(a => a && a.toLowerCase() === recipient.toLowerCase());

  let units: bigint | null = null;
  let amountError = '';
  if (asset && amount.trim()) {
    try { units = parseUnits(amount, asset.decimals); } catch (e) { amountError = errorMessage(e); }
  }

  // The fee, and with it the most that can be sent. Asked again when the asset, recipient or amount settles.
  const unitsKey = units?.toString() ?? '';
  const quoteFor = useRef('');
  useEffect(() => {
    if (!asset) { setQuote(null); return; }
    const key = `${asset.id}|${addressProblem ? '' : recipient}|${unitsKey}`;
    quoteFor.current = key;
    const id = setTimeout(() => {
      quoteSend(asset, accountIndex, addressProblem ? '' : recipient, units ?? 0n, native?.balance ?? 0n)
        .then(q => { if (quoteFor.current === key) setQuote(q); })
        .catch(() => { if (quoteFor.current === key) setQuote(null); });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.balance, recipient, unitsKey, accountIndex, !!addressProblem]);

  const max = quote?.max ?? asset?.balance ?? 0n;
  const problem =
    !asset ? ''
    : amountError ? amountError
    : units !== null && units <= 0n ? t('send.error.zero')
    : units !== null && units > asset.balance ? t('send.error.balance', { symbol: asset.symbol })
    : units !== null && quote && asset.kind === 'native' && units > max ? t('send.error.fee', { symbol: asset.symbol })
    : quote && !quote.canPayFee && asset.kind !== 'native' ? t('send.error.gas', { symbol: asset.network.native.symbol, network: asset.network.name })
    : '';
  const ready = !!asset && !!to.trim() && !addressProblem && units !== null && units > 0n && !problem;

  const paste = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (text) setTo(text.replace(/^(ethereum|solana|bitcoin):/i, '').split('?')[0]);
  };

  const feeText = asset && quote
    ? `${formatAmount(quote.fee, asset.network.native.decimals, 8)} ${asset.network.native.symbol}`
    : t('send.feeUnknown');
  const usd = asset && units !== null ? valueOf({ ...asset, balance: units }, prices) : undefined;
  const amountText = asset && units !== null ? `${formatAmount(units, asset.decimals, 8)} ${asset.symbol}` : '';

  const confirm = async () => {
    if (!asset || units === null) return;
    setStage('sending');
    setError('');
    try {
      const hash = await sendAsset(asset, accountIndex, recipient, units);
      setTxid(hash);
      await addActivity({ kind: 'send', status: 'pending', network: asset.network.key, account: addresses.evm ?? '', sent: amountText, counterparty: recipient, txid: hash });
      thud();
      setStage('sent');
      refresh().catch(() => {});
    } catch (e) {
      buzz();
      const known = e instanceof SendError && e.problem ? t(e.problem.key, e.problem.vars) : '';
      setError(known || errorMessage(e, t('send.error.failed')));
      setStage('review');
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/wallet'));

  if (!sendable.length && stage === 'form') {
    return (
      <Screen testID="send">
        <Header title={t('send.title')} onBack={close} backLabel={t('common.back')} />
        <Empty icon={<Chameleon size={120} />} title={t('send.empty.title')} body={t('send.empty.body')} action={<Button small label={t('action.receive')} onPress={() => router.replace('/(app)/receive')} />} />
      </Screen>
    );
  }

  if (stage === 'sent' && asset) {
    return (
      <Screen testID="send-sent" footer={<Button label={t('send.done')} onPress={close} testID="send-done" />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
          <Chameleon size={170} mood="happy" tone={c.chain[asset.network.palette]} />
          <Txt variant="title" center>{t('send.sent.title')}</Txt>
          <Txt variant="body" tone="mute" center style={{ maxWidth: 320 }}>{t('send.sent.body', { amount: amountText, to: shortAddr(recipient, 8, 6) })}</Txt>
          <Pill label={t('send.viewTx')} tone="primary" icon={<ExternalLink size={13} color={c.primary} />} onPress={() => { Linking.openURL(explorerTxUrl(asset.network, txid)).catch(() => {}); }} testID="send-view-tx" />
        </View>
      </Screen>
    );
  }

  if ((stage === 'review' || stage === 'sending') && asset) {
    return (
      <Screen
        scroll testID="send-review"
        footer={<Button label={stage === 'sending' ? t('send.sending') : t('send.confirm')} onPress={confirm} loading={stage === 'sending'} testID="send-confirm" />}
      >
        <Header title={t('send.review.title')} onBack={stage === 'sending' ? undefined : () => { setError(''); setStage('form'); }} backLabel={t('common.back')} />
        <View style={{ alignItems: 'center', gap: 6, marginVertical: space.lg }}>
          <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} size={56} />
          <Txt variant="title" tabular center testID="review-amount">{amountText}</Txt>
          {usd !== undefined ? <Txt variant="small" tone="mute">{t('send.usd', { value: formatUsd(usd) })}</Txt> : null}
        </View>
        <Card padding={space.md}>
          <Line label={t('send.to')} value={recipient} mono />
          <Line label={t('common.network')} value={asset.network.name} />
          <Line label={t('send.networkFee')} value={feeText} />
        </Card>
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {own ? <Banner tone="info">{t('send.ownAddress')}</Banner> : null}
          <Banner tone="warn">{t('send.irreversible')}</Banner>
          {error ? <Banner tone="error">{error}</Banner> : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll testID="send" footer={<Button label={t('send.review')} onPress={() => { setError(''); setStage('review'); }} disabled={!ready} testID="send-review-button" />}>
      <Header title={t('send.title')} onBack={close} backLabel={t('common.back')} />

      <Txt variant="micro" tone="mute" style={{ marginBottom: 6 }}>{t('send.asset')}</Txt>
      <Pressable
        onPress={() => { tap(); setPicker(true); }} accessibilityRole="button" accessibilityLabel={asset ? `${t('send.asset')}: ${asset.symbol}, ${asset.network.name}` : t('send.pickAsset')} testID="send-asset"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, padding: space.md, borderRadius: radius.md, backgroundColor: pressed ? c.surface2 : c.surface, borderWidth: 1, borderColor: c.borderStrong })}
      >
        {asset ? (
          <>
            <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} size={38} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{asset.symbol}</Txt>
              <Txt variant="small" tone="mute" tabular>{t('send.balance', { amount: formatAmount(asset.balance, asset.decimals), symbol: asset.network.name })}</Txt>
            </View>
          </>
        ) : <Txt variant="label" tone="mute" style={{ flex: 1 }}>{t('send.pickAsset')}</Txt>}
        <ChevronDown size={18} color={c.fgMute} />
      </Pressable>

      <View style={{ gap: space.lg, marginTop: space.lg }}>
        <Field
          label={t('send.to')} value={to} onChangeText={setTo} placeholder={t('send.addressPlaceholder')} mono multiline testID="send-to"
          error={addressProblem ? t(addressProblem.key, addressProblem.vars) : undefined}
          right={
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <Pressable onPress={() => { tap(); paste(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.paste')} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="send-paste">
                <ClipboardPaste size={19} color={c.primary} />
              </Pressable>
              <Pressable onPress={() => { tap(); router.push({ pathname: '/(app)/scan', params: { returnTo: 'send' } }); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('send.scan')} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="send-scan">
                <ScanLine size={19} color={c.primary} />
              </Pressable>
            </View>
          }
        />
        <Field
          label={t('send.amount')} value={amount} placeholder="0" keyboardType="decimal-pad" testID="send-amount"
          onChangeText={v => { const clean = v.replace(',', '.'); if (/^\d*\.?\d*$/.test(clean)) setAmount(clean); }}
          error={problem || undefined}
          hint={usd !== undefined ? t('send.usd', { value: formatUsd(usd) }) : undefined}
          right={asset ? <Pill label={t('send.max')} tone="primary" onPress={() => setAmount(formatUnits(max, asset.decimals))} testID="send-max" /> : undefined}
        />
        {asset ? (
          <Card padding={space.md}>
            <Line label={t('common.network')} value={asset.network.name} />
            <Line label={t('send.networkFee')} value={feeText} />
          </Card>
        ) : null}
        {own ? <Banner tone="info">{t('send.ownAddress')}</Banner> : null}
      </View>

      <AssetPicker visible={picker} onClose={() => setPicker(false)} assets={sendable} prices={prices} selectedId={assetId} onPick={a => { setAssetId(a.id); setPicker(false); setAmount(''); }} />
    </Screen>
  );
}
