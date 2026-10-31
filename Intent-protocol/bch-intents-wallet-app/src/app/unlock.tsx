/**
 * The locked wallet: PIN, or fingerprint or face when that is turned on.
 *
 * Either one only decides that the person may come in. What actually opens the wallet is WDK loading the seed
 * from the phone's keychain into the worklet, and the phone may ask for its own confirmation at that point.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { errorMessage } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { Chameleon, type ChamMood } from '@/ui/Chameleon';
import { PinPad } from '@/ui/PinPad';
import { Banner, Button, Field, Screen, Sheet, Spinner, thud, Txt } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { askBiometric, BIOMETRIC_NAME, biometricSupport, type BiometricSupport } from '@/wdk/biometrics';
import { formatWait, pinWait, verifyPin } from '@/wdk/pin';
import { useRemoveWallet } from '@/wdk/removeWallet';
import { useSession, useWalletActions } from '@/wdk/session';

export default function Unlock() {
  const t = useT();
  const router = useRouter();
  const settings = useSettings();
  const { status } = useSession();
  const { unlock } = useWalletActions();
  const removeWallet = useRemoveWallet();

  const [pin, setPin] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<ChamMood>('shy');
  const [waitMs, setWaitMs] = useState(0);
  const [support, setSupport] = useState<BiometricSupport>({ available: false, kind: 'none' });
  const [forgot, setForgot] = useState(false);
  const [resetText, setResetText] = useState('');
  const [removing, setRemoving] = useState(false);

  // The countdown while attempts are held back.
  useEffect(() => { pinWait().then(setWaitMs); }, []);
  useEffect(() => {
    if (waitMs <= 0) return;
    const id = setInterval(() => setWaitMs(ms => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(id);
  }, [waitMs > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(async () => {
    setBusy(true);
    setMood('busy');
    try {
      await unlock();
      thud();
      router.replace('/(app)/(tabs)/wallet');
    } catch (e) {
      setMood('error');
      setMessage(errorMessage(e, t('unlock.failed')));
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [unlock, router, t]);

  const onComplete = async (entered: string) => {
    const result = await verifyPin(entered);
    if (result.ok) { setMessage(''); await open(); return; }
    setPin('');
    setMood('error');
    setErrorTick(n => n + 1);
    if (result.reason === 'locked') { setWaitMs(result.waitMs); setMessage(''); return; }
    if (result.reason === 'wrong') {
      setWaitMs(result.waitMs);
      setMessage(result.waitMs ? t('pin.wrongWait') : t('pin.wrong', { remaining: result.remaining }));
      return;
    }
    // No PIN record: the wallet was set up without one finishing. The keychain's own check still guards the seed.
    await open();
  };

  const withBiometric = useCallback(async () => {
    if (busy) return;
    if (await askBiometric(t('unlock.biometricPrompt'), t('common.cancel'))) await open();
  }, [busy, open, t]);

  // Offer the biometric straight away, once, when the screen opens.
  const offered = useRef(false);
  useEffect(() => {
    biometricSupport().then(s => {
      setSupport(s);
      if (s.available && settings.biometrics && !offered.current && status === 'locked') { offered.current = true; withBiometric(); }
    });
  }, [settings.biometrics, status]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Already unlocked (the gate sent us here by mistake, or another path unlocked): go in.
  useEffect(() => { if (status === 'unlocked' && !busy) router.replace('/(app)/(tabs)/wallet'); }, [status, busy, router]);

  const bio = support.available && settings.biometrics && support.kind !== 'none'
    ? { kind: support.kind, label: t('unlock.biometric', { kind: t(BIOMETRIC_NAME[support.kind]) }), onPress: withBiometric }
    : undefined;

  const remove = async () => {
    setRemoving(true);
    try {
      await removeWallet();
      setForgot(false);
      router.replace('/(onboarding)/welcome');
    } catch (e) {
      setMessage(errorMessage(e));
      setForgot(false);
    } finally {
      setRemoving(false);
    }
  };

  const locked = waitMs > 0;

  return (
    <Screen testID="unlock">
      <View style={{ alignItems: 'center', paddingTop: space.xxl, gap: space.xs }}>
        <Chameleon size={130} mood={mood} />
        <Txt variant="title" center>{t('unlock.title')}</Txt>
        <Txt variant="body" tone="mute" center>{t('unlock.sub')}</Txt>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ minHeight: 24, alignItems: 'center' }}>
          {busy ? <Spinner />
            : locked ? <Txt variant="small" tone="amber" center accessibilityLiveRegion="polite">{t('pin.locked', { time: formatWait(waitMs) })}</Txt>
            : message ? <Txt variant="small" tone="red" center accessibilityLiveRegion="polite">{message}</Txt> : null}
        </View>
        <PinPad
          value={pin} onChange={v => { setPin(v); if (mood !== 'shy') setMood('shy'); }} onComplete={onComplete}
          errorTick={errorTick} disabled={busy || locked} biometric={bio} deleteLabel={t('pin.delete')}
        />
      </View>
      <Button label={t('unlock.forgot')} kind="ghost" small onPress={() => { setResetText(''); setForgot(true); }} testID="forgot-pin" />

      <Sheet visible={forgot} onClose={() => setForgot(false)} title={t('unlock.forgot')} closeLabel={t('common.close')}>
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          <Txt variant="body" tone="mute">{t('unlock.forgotBody')}</Txt>
          <Banner tone="error">{t('unlock.resetWarning')}</Banner>
          <Field value={resetText} onChangeText={setResetText} placeholder={t('unlock.resetPlaceholder')} autoCapitalize="characters" testID="reset-text" />
          <Button label={t('unlock.reset')} kind="danger" onPress={remove} disabled={resetText.trim().toUpperCase() !== 'RESET'} loading={removing} testID="reset-confirm" />
        </View>
      </Sheet>
    </Screen>
  );
}
