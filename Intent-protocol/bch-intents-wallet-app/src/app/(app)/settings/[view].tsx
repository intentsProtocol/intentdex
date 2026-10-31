/**
 * The screens behind a Settings row: trading defaults, networks, services, addresses, hidden tokens, recovery
 * phrase, PIN, about, remove wallet. One route, chosen by its `view` parameter, so each stays a short function.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { Check, Copy, ExternalLink } from 'lucide-react-native';
import { FAMILIES, FAMILY_LABEL, FAMILY_PALETTE, networkOf, networksFor, networksOf, type Family, type NetworkMode } from '@bch-intents/wallet-core/chains';
import { errorMessage, shortAddr } from '@bch-intents/wallet-core/format';
import { cashtokenRelayerUrl, swapServerUrl } from '@bch-intents/wallet-core/platform';
import { swapServerApiFor } from '@bch-intents/wallet-core/swap/api';
import { createRelayerApi } from '@bch-intents/wallet-core/swap/cashtoken';
import { useT } from '@/i18n';
import { DOCS_URL } from '@/lib/config';
import { usePortfolio } from '@/state/portfolio';
import {
  AUCTION_DURATION_PRESETS, formatAuctionDuration, SLIPPAGE_BPS_PRESETS, useSettings, useUpdateSettings,
} from '@/state/settings';
import { Chameleon } from '@/ui/Chameleon';
import { PinGate } from '@/ui/PinGate';
import { PinPad } from '@/ui/PinPad';
import { Banner, Button, Card, Empty, Field, Header, Pill, Row, Screen, Segmented, Spinner, tap, thud, Txt } from '@/ui/primitives';
import { SeedWords } from '@/ui/SeedWords';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';
import { useSecureScreen } from '@/ui/useSecureScreen';
import { derivationPath } from '@/wdk/config';
import { isWeakPin, setPin } from '@/wdk/pin';
import { useRemoveWallet } from '@/wdk/removeWallet';
import { useWalletActions } from '@/wdk/session';

type ViewProps = { back: () => void };

// ── trading defaults ──

function Trading({ back }: ViewProps) {
  const t = useT();
  const settings = useSettings();
  const update = useUpdateSettings();
  return (
    <Screen scroll testID="settings-trading">
      <Header title={t('settings.trading')} onBack={back} backLabel={t('common.back')} />
      <Card padding={space.lg}>
        <Txt variant="label">{t('settings.trading.slippage')}</Txt>
        <Txt variant="small" tone="mute" style={{ marginBottom: space.md }}>{t('settings.trading.slippageHint')}</Txt>
        <Segmented label={t('settings.trading.slippage')} value={settings.defaultSlippageBps} onChange={defaultSlippageBps => update({ defaultSlippageBps })} options={SLIPPAGE_BPS_PRESETS.map(b => ({ value: b, label: `${b / 100}%` }))} />
      </Card>
      <Card padding={space.lg} style={{ marginTop: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Txt variant="label">{t('settings.trading.auction')}</Txt>
          <Txt variant="heading" tabular testID="auction-value">{formatAuctionDuration(settings.defaultAuctionDuration)}</Txt>
        </View>
        <Txt variant="small" tone="mute" style={{ marginBottom: space.md }}>{t('settings.trading.auctionHint')}</Txt>
        <Segmented label={t('settings.trading.auction')} value={settings.defaultAuctionDuration} onChange={defaultAuctionDuration => update({ defaultAuctionDuration })} options={AUCTION_DURATION_PRESETS.map(s => ({ value: s, label: formatAuctionDuration(s) }))} />
      </Card>
    </Screen>
  );
}

// ── networks ──

function Networks({ back }: ViewProps) {
  const t = useT();
  const { c } = useTheme();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [confirm, setConfirm] = useState(false);
  const choose = (mode: NetworkMode) => {
    if (mode === settings.mode) return;
    if (mode === 'mainnet' && !confirm) { setConfirm(true); return; }
    update({ mode });
    setConfirm(false);
  };
  return (
    <Screen scroll testID="settings-networks">
      <Header title={t('settings.networks')} onBack={back} backLabel={t('common.back')} />
      <Txt variant="micro" tone="mute" style={{ marginBottom: 6 }}>{t('settings.mode')}</Txt>
      <Segmented<NetworkMode> label={t('settings.mode')} value={settings.mode} onChange={choose} options={[{ value: 'testnet', label: t('network.testnet') }, { value: 'mainnet', label: t('network.mainnet') }]} />
      {confirm ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Banner tone="warn">{t('network.mainnetWarning')}</Banner>
          <Button label={t('network.useMainnet')} onPress={() => choose('mainnet')} testID="confirm-mainnet" />
        </View>
      ) : <Txt variant="small" tone="faint" style={{ marginTop: space.sm }}>{t('network.hint')}</Txt>}
      <Txt variant="small" tone="mute" style={{ marginTop: space.xl, marginBottom: space.sm }}>{t('settings.networks.hint')}</Txt>
      <Card padding={space.md}>
        {networksFor(settings.mode).map((net, i, all) => (
          <View key={net.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, borderBottomWidth: i === all.length - 1 ? 0 : 1, borderBottomColor: c.border }}>
            <TokenIcon symbol={net.short} logo={net.logo} palette={net.palette} size={30} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{net.name}</Txt>
              <Txt variant="small" tone="mute">{net.native.symbol}{net.chainId ? ` · ${net.chainId}` : ''}</Txt>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

// ── services ──

type Health = 'checking' | 'up' | 'down' | 'none';

function Services({ back }: ViewProps) {
  const t = useT();
  const { isMainnet } = usePortfolio();
  const [swap, setSwap] = useState<Health>('checking');
  const [relayer, setRelayer] = useState<Health>('checking');
  const swapUrl = swapServerUrl(isMainnet);
  const relayerUrl = cashtokenRelayerUrl(isMainnet);

  const check = useCallback(() => {
    const api = swapServerApiFor(isMainnet);
    if (!api) setSwap('none');
    else { setSwap('checking'); api.getConfig({ timeoutMs: 8000 }).then(() => setSwap('up'), () => setSwap('down')); }
    if (!relayerUrl) setRelayer('none');
    else { setRelayer('checking'); createRelayerApi(isMainnet ? 'mainnet' : 'chipnet', relayerUrl).health().then(() => setRelayer('up'), () => setRelayer('down')); }
  }, [isMainnet, relayerUrl]);
  useEffect(check, [check]);

  const status = (h: Health) => (h === 'checking' ? <Spinner /> : <Pill label={t(h === 'up' ? 'settings.services.up' : h === 'down' ? 'settings.services.down' : 'settings.services.notConfigured')} tone={h === 'up' ? 'primary' : h === 'down' ? 'red' : 'mute'} />);
  const host = (url: string) => url.replace(/^https?:\/\//, '');

  return (
    <Screen scroll testID="settings-services" footer={<Button kind="secondary" label={t('settings.services.recheck')} onPress={check} testID="services-recheck" />}>
      <Header title={t('settings.services')} onBack={back} backLabel={t('common.back')} />
      <Txt variant="small" tone="mute" style={{ marginBottom: space.md }}>{t('settings.services.hint')}</Txt>
      <Card padding={space.md}>
        <Row title={t('settings.services.swap')} sub={`${t('settings.services.swapWhat')}${swapUrl ? `\n${host(swapUrl)}` : ''}`} right={status(swap)} />
        <Row title={t('settings.services.relayer')} sub={`${t('settings.services.relayerWhat')}${relayerUrl ? `\n${host(relayerUrl)}` : ''}`} right={status(relayer)} last />
      </Card>
    </Screen>
  );
}

// ── addresses ──

function Addresses({ back }: ViewProps) {
  const t = useT();
  const { c } = useTheme();
  const { addresses, mode, accountIndex } = usePortfolio();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, value: string) => {
    await Clipboard.setStringAsync(value);
    thud();
    setCopied(key);
    setTimeout(() => setCopied(k => (k === key ? null : k)), 1500);
  };
  const netOf = (family: Family) => (family === 'evm' ? networksOf(mode, 'evm')[0] : networkOf(mode, family));
  return (
    <Screen scroll testID="settings-addresses">
      <Header title={t('settings.addresses')} onBack={back} backLabel={t('common.back')} />
      <Txt variant="small" tone="mute" style={{ marginBottom: space.md }}>{t('settings.addresses.hint')}</Txt>
      <View style={{ gap: space.md }}>
        {FAMILIES.map(family => {
          const address = addresses[family];
          const net = netOf(family);
          return (
            <Card key={family} padding={space.md}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <TokenIcon symbol={FAMILY_LABEL[family]} logo={net.logo} palette={FAMILY_PALETTE[family]} size={32} />
                <View style={{ flex: 1 }}>
                  <Txt variant="label">{family === 'evm' ? t('settings.addresses.evm') : FAMILY_LABEL[family]}</Txt>
                  <Txt variant="small" tone="faint">{t('settings.addresses.path')} {derivationPath(net, accountIndex)}</Txt>
                </View>
                {address ? (
                  <Pressable onPress={() => { tap(); copy(family, address); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t('common.copy')}: ${FAMILY_LABEL[family]}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID={`copy-${family}`}>
                    {copied === family ? <Check size={18} color={c.primary} /> : <Copy size={18} color={c.fgMute} />}
                  </Pressable>
                ) : null}
              </View>
              <Txt variant="small" selectable tabular style={{ marginTop: 6, color: c.chain[FAMILY_PALETTE[family]] }} testID={`address-${family}`}>{address ?? '—'}</Txt>
              {family === 'bch' && addresses.bchToken ? <Txt variant="small" tone="mute" selectable style={{ marginTop: 4 }}>{t('receive.tokenAddress')}: {shortAddr(addresses.bchToken, 10, 8)}</Txt> : null}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

// ── hidden tokens ──

function Hidden({ back }: ViewProps) {
  const t = useT();
  const settings = useSettings();
  const update = useUpdateSettings();
  const { assets } = usePortfolio();
  const show = (id: string) => update({ hiddenTokens: settings.hiddenTokens.filter(x => x !== id) });
  return (
    <Screen scroll testID="settings-hidden">
      <Header title={t('settings.hidden')} onBack={back} backLabel={t('common.back')} />
      {!settings.hiddenTokens.length ? <Empty title={t('settings.hidden.empty')} body={t('settings.hidden.emptyBody')} /> : (
        <Card padding={space.md}>
          {settings.hiddenTokens.map((id, i, all) => {
            const asset = assets.find(a => a.id === id);
            return (
              <Row
                key={id} last={i === all.length - 1} title={asset?.symbol ?? shortAddr(id.split(':')[1] ?? id)} sub={asset?.network.name ?? id.split(':')[0]}
                icon={asset ? <TokenIcon symbol={asset.symbol} logo={asset.logo} palette={asset.network.palette} size={26} /> : undefined}
                right={<Pill label={t('settings.hidden.show')} tone="primary" onPress={() => show(id)} testID={`show-${id}`} />}
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

// ── recovery phrase ──

function Recovery({ back }: ViewProps) {
  const t = useT();
  const settings = useSettings();
  const update = useUpdateSettings();
  const { getPhrase } = useWalletActions();
  const [words, setWords] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');
  useSecureScreen();

  const load = async () => {
    try {
      const phrase = await getPhrase();
      if (!phrase) throw new Error(t('approval.error.noAddress'));
      setWords(phrase.trim().split(/\s+/));
    } catch (e) {
      setError(errorMessage(e));
      setWords([]);
    }
  };

  if (!words) {
    return (
      <Screen testID="settings-recovery">
        <Header title={t('settings.recovery')} onBack={back} backLabel={t('common.back')} />
        <PinGate prompt={t('settings.recovery.gate')} onPass={load} />
      </Screen>
    );
  }
  return (
    <Screen
      scroll testID="settings-recovery"
      footer={settings.backedUp ? undefined : <Button label={t('settings.recovery.confirm')} disabled={!revealed} onPress={() => { update({ backedUp: true }); thud(); }} testID="recovery-confirm" />}
    >
      <Header title={t('settings.recovery')} onBack={back} backLabel={t('common.back')} />
      <View style={{ gap: space.md }}>
        {error ? <Banner tone="error">{error}</Banner> : (
          <>
            <Banner tone="warn">{t('onboarding.phrase.warning')}</Banner>
            <Card padding={space.md}><SeedWords words={words} revealed={revealed} onReveal={() => setRevealed(true)} revealLabel={t('onboarding.phrase.reveal')} /></Card>
            {settings.backedUp ? <Banner tone="ok">{t('settings.recovery.backedUp')}</Banner> : null}
          </>
        )}
      </View>
    </Screen>
  );
}

// ── change PIN ──

function ChangePin({ back }: ViewProps) {
  const t = useT();
  const [stage, setStage] = useState<'current' | 'new' | 'repeat' | 'done'>('current');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [message, setMessage] = useState('');

  const fail = (text: string) => { setMessage(text); setValue(''); setErrorTick(n => n + 1); };
  const onComplete = async (pin: string) => {
    if (stage === 'new') {
      if (isWeakPin(pin)) { fail(t('pin.weak')); return; }
      setMessage(''); setFirst(pin); setValue(''); setStage('repeat');
      return;
    }
    if (pin !== first) { setFirst(''); setStage('new'); fail(t('pin.mismatch')); return; }
    try {
      await setPin(pin);
      thud();
      setStage('done');
    } catch (e) {
      fail(errorMessage(e));
    }
  };

  return (
    <Screen testID="settings-pin" footer={stage === 'done' ? <Button label={t('common.done')} onPress={back} testID="pin-done" /> : undefined}>
      <Header title={t('settings.changePin')} onBack={back} backLabel={t('common.back')} />
      {stage === 'current' ? <PinGate prompt={t('pin.current')} onPass={() => setStage('new')} /> : stage === 'done' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
          <Chameleon size={150} mood="happy" />
          <Txt variant="title" center>{t('pin.changed')}</Txt>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Txt variant="title" center>{t(stage === 'new' ? 'pin.create.title' : 'pin.repeat.title')}</Txt>
            <Txt variant="body" tone="mute" center>{t(stage === 'new' ? 'pin.create.sub' : 'pin.repeat.sub')}</Txt>
          </View>
          <View style={{ minHeight: 22 }}>{message ? <Txt variant="small" tone="red" center accessibilityLiveRegion="polite">{message}</Txt> : null}</View>
          <PinPad value={value} onChange={setValue} onComplete={onComplete} errorTick={errorTick} deleteLabel={t('pin.delete')} />
        </View>
      )}
    </Screen>
  );
}

// ── about ──

function About({ back }: ViewProps) {
  const t = useT();
  const { c } = useTheme();
  return (
    <Screen scroll testID="settings-about">
      <Header title={t('settings.about')} onBack={back} backLabel={t('common.back')} />
      <View style={{ alignItems: 'center', gap: space.sm, marginVertical: space.lg }}>
        <Chameleon size={140} />
        <Txt variant="title" center>{t('app.name')}</Txt>
        <Txt variant="small" tone="mute">{t('settings.version', { version: Constants.expoConfig?.version ?? '0.1.0' })}</Txt>
      </View>
      <View style={{ gap: space.md }}>
        <Txt variant="body" tone="mute">{t('settings.about.body')}</Txt>
        <Banner tone="warn">{t('settings.about.alpha')}</Banner>
        <Card padding={space.md}>
          <Row title={t('settings.docs')} icon={<ExternalLink size={17} color={c.fg} />} onPress={() => { Linking.openURL(DOCS_URL).catch(() => {}); }} />
          <Row title={t('settings.about.wdk')} icon={<ExternalLink size={17} color={c.fg} />} onPress={() => { Linking.openURL('https://docs.wallet.tether.io').catch(() => {}); }} last />
        </Card>
      </View>
    </Screen>
  );
}

// ── remove wallet ──

function Remove({ back }: ViewProps) {
  const t = useT();
  const router = useRouter();
  const settings = useSettings();
  const removeWallet = useRemoveWallet();
  const [passed, setPassed] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setBusy(true);
    try {
      await removeWallet();
      router.replace('/(onboarding)/welcome');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (!passed) {
    return (
      <Screen testID="settings-remove">
        <Header title={t('settings.remove')} onBack={back} backLabel={t('common.back')} />
        <PinGate prompt={t('settings.remove.gate')} onPass={() => setPassed(true)} />
      </Screen>
    );
  }
  return (
    <Screen scroll testID="settings-remove" footer={<Button kind="danger" label={t('settings.remove')} onPress={remove} loading={busy} disabled={text.trim().toUpperCase() !== 'REMOVE'} testID="remove-confirm" />}>
      <Header title={t('settings.remove')} onBack={busy ? undefined : back} backLabel={t('common.back')} />
      <View style={{ gap: space.md }}>
        <Banner tone="error">{t('settings.remove.warning')}</Banner>
        {!settings.backedUp ? <Banner tone="warn">{t('settings.remove.notBackedUp')}</Banner> : null}
        <Field value={text} onChangeText={setText} placeholder={t('settings.remove.placeholder')} autoCapitalize="characters" testID="remove-text" />
        {error ? <Banner tone="error">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const VIEWS: Record<string, (props: ViewProps) => React.JSX.Element> = {
  trading: Trading, networks: Networks, services: Services, addresses: Addresses, hidden: Hidden,
  recovery: Recovery, pin: ChangePin, about: About, remove: Remove,
};

export default function SettingsView() {
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view: string }>();
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/settings')), [router]);
  const View_ = useMemo(() => VIEWS[view] ?? About, [view]);
  return <View_ back={back} />;
}
