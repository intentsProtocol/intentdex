/**
 * The scanner: one camera for the two things a wallet reads from a QR code, an address to pay and a
 * WalletConnect code. Pasting from the clipboard does the same without a camera.
 *
 * Opened from Send (`returnTo=send`), an address goes back to the form that asked. Opened from anywhere else,
 * it opens Send with the address filled in.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClipboardPaste, Flashlight, X } from 'lucide-react-native';
import { FAMILY_LABEL, getNetwork, networksOf, type NetworkDef } from '@bch-intents/wallet-core/chains';
import { useConnect } from '@/connect/ConnectProvider';
import { useT } from '@/i18n';
import { parseScanned, type Scanned } from '@/lib/scan';
import { usePortfolio } from '@/state/portfolio';
import { useScanResult } from '@/state/scan';
import { Banner, Button, buzz, IconButton, Row, Screen, Sheet, thud, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { radius, space, useTheme } from '@/ui/theme';

type ScannedAddress = Extract<Scanned, { kind: 'address' }>;

export default function Scan() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { mode } = usePortfolio();
  const { pair } = useConnect();
  const setScanResult = useScanResult(s => s.set);
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [message, setMessage] = useState('');
  const [evmChoice, setEvmChoice] = useState<ScannedAddress | null>(null);
  // A code stays in view for many frames; act on it once.
  const handled = useRef(false);

  const toSend = useCallback((result: ScannedAddress, net?: NetworkDef) => {
    // A screen that asked for a scan (Send, NFT send) reads the result from the store on its way back.
    if (params.returnTo === 'send' || params.returnTo === 'nft-send') {
      setScanResult(result);
      router.back();
      return;
    }
    router.replace({ pathname: '/(app)/send', params: { to: result.address, family: result.family, ...(result.amount ? { amount: result.amount } : {}), ...(net ? { network: net.key } : {}) } });
  }, [params.returnTo, router, setScanResult]);

  const onCode = useCallback((raw: string) => {
    if (handled.current) return;
    const result = parseScanned(raw);
    if (result.kind === 'unknown') { setMessage(t('scan.unknown')); return; }
    handled.current = true;
    thud();

    if (result.kind === 'walletconnect') {
      pair(result.uri);
      router.replace('/(app)/connect');
      return;
    }
    if (result.mode && result.mode !== mode) {
      buzz();
      setMessage(t('scan.wrongMode', { found: `${FAMILY_LABEL[result.family]} ${t(result.mode === 'mainnet' ? 'network.mainnet' : 'network.testnet')}`, mode: t(mode === 'mainnet' ? 'network.mainnet' : 'network.testnet') }));
      setTimeout(() => { handled.current = false; }, 2500);
      return;
    }
    if (result.family === 'evm' && params.returnTo !== 'send') {
      // A payment link can name its chain; a bare address works on all of them, so the user says which.
      const named = result.chainId ? networksOf(mode, 'evm').find(n => n.chainId === result.chainId) : undefined;
      if (named) toSend(result, named); else setEvmChoice(result);
      return;
    }
    toSend(result);
  }, [mode, pair, router, t, toSend, params.returnTo]);

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text.trim()) return;
    handled.current = false;
    onCode(text);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/wallet'));

  if (!permission?.granted) {
    const blocked = permission && !permission.canAskAgain;
    return (
      <Screen
        testID="scan-permission"
        footer={
          <View style={{ gap: space.sm }}>
            {blocked
              ? <Button label={t('scan.permission.settings')} onPress={() => { Linking.openSettings().catch(() => {}); }} />
              : <Button label={t('scan.permission.allow')} onPress={() => { requestPermission(); }} testID="scan-allow" />}
            <Button kind="secondary" label={t('scan.paste')} onPress={paste} icon={<ClipboardPaste size={18} color={c.fg} />} testID="scan-paste" />
          </View>
        }
      >
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', minHeight: 52, alignItems: 'center' }}>
          <IconButton label={t('common.close')} onPress={close}><X size={20} color={c.fg} /></IconButton>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: space.md }}>
          <Txt variant="title" center>{t('scan.permission.title')}</Txt>
          <Txt variant="body" tone="mute" center>{t(blocked ? 'scan.permission.denied' : 'scan.permission.body')}</Txt>
          {message ? <Banner tone="warn">{message}</Banner> : null}
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }} testID="scan">
      <CameraView
        style={StyleSheet.absoluteFill} facing="back" enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={evmChoice ? undefined : ({ data }) => onCode(data)}
      />
      {/* The frame is a guide for the eye; the camera reads a code anywhere in view. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 250, height: 250, borderRadius: radius.xl, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
      </View>

      <View style={{ position: 'absolute', top: insets.top + 8, left: space.lg, right: space.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton label={t('common.close')} onPress={close} testID="scan-close"><X size={20} color={c.fg} /></IconButton>
        <IconButton label={t('scan.torch')} onPress={() => setTorch(v => !v)} active={torch}><Flashlight size={19} color={torch ? c.primary : c.fg} /></IconButton>
      </View>

      <View style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + space.lg, gap: space.sm }}>
        {message
          ? <View style={{ backgroundColor: c.bg1, borderRadius: radius.md }}><Banner tone="warn">{message}</Banner></View>
          : <Txt variant="small" center style={{ color: '#ffffff' }}>{t('scan.hint')}</Txt>}
        <Button kind="secondary" label={t('scan.paste')} onPress={paste} icon={<ClipboardPaste size={18} color={c.fg} />} style={{ backgroundColor: c.bg1 }} testID="scan-paste" />
      </View>

      <Sheet visible={!!evmChoice} onClose={() => { setEvmChoice(null); handled.current = false; }} title={t('scan.pickNetwork')} closeLabel={t('common.close')}>
        <View style={{ paddingHorizontal: space.lg }}>
          <Txt variant="small" tone="mute" style={{ marginBottom: space.sm }}>{t('scan.pickNetworkBody')}</Txt>
          {networksOf(mode, 'evm').map((net, i, all) => (
            <Row
              key={net.key} title={net.name} last={i === all.length - 1} testID={`scan-net-${net.key}`}
              icon={<TokenIcon symbol={net.short} logo={net.logo} palette={net.palette} size={26} />}
              onPress={() => { const picked = evmChoice!; setEvmChoice(null); toSend(picked, getNetwork(net.key)); }}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}
