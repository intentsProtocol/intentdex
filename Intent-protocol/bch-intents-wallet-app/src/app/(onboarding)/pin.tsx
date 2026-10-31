/**
 * Choose the PIN, enter it twice, and the wallet is made: the phrase goes into WDK's keychain storage and the
 * PIN record into the secure store. Until this screen finishes, nothing has been stored.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { errorMessage } from '@bch-intents/wallet-core/format';
import { useT } from '@/i18n';
import { useAccounts } from '@/state/accounts';
import { useOnboarding } from '@/state/onboarding';
import { useUpdateSettings } from '@/state/settings';
import { Chameleon } from '@/ui/Chameleon';
import { PinPad } from '@/ui/PinPad';
import { Banner, Header, Screen, Spinner, Txt } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { isWeakPin, setPin } from '@/wdk/pin';
import { useWalletActions } from '@/wdk/session';

export default function ChoosePin() {
  const t = useT();
  const router = useRouter();
  const { phrase, kind, backedUp } = useOnboarding();
  const { createFromPhrase } = useWalletActions();
  const update = useUpdateSettings();
  const resetAccounts = useAccounts(s => s.reset);

  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!phrase && !done) return <Redirect href="/(onboarding)/welcome" />;

  const fail = (text: string) => { setMessage(text); setValue(''); setErrorTick(n => n + 1); };

  const onComplete = async (pin: string) => {
    if (!first) {
      if (isWeakPin(pin)) { fail(t('pin.weak')); return; }
      setMessage('');
      setFirst(pin);
      setValue('');
      return;
    }
    if (pin !== first) { setFirst(''); fail(t('pin.mismatch')); return; }

    setBusy(true);
    setMessage('');
    try {
      await createFromPhrase(phrase);
      await setPin(pin);
      resetAccounts();
      update({ backedUp, mode: 'testnet' });
      setDone(true);
      router.replace('/(onboarding)/done');
    } catch (e) {
      setFirst('');
      fail(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const steps = kind === 'create' ? { step: 3, of: 3 } : { step: 2, of: 2 };

  return (
    <Screen testID="choose-pin">
      <Header onBack={busy ? undefined : () => (first ? (setFirst(''), setValue('')) : router.back())} backLabel={t('common.back')} sub={t('onboarding.stepOf', steps)} />
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Chameleon size={96} mood={busy ? 'busy' : errorTick && message ? 'error' : 'shy'} />
        <Txt variant="title" center>{t(first ? 'pin.repeat.title' : 'pin.create.title')}</Txt>
        <Txt variant="body" tone="mute" center>{t(first ? 'pin.repeat.sub' : 'pin.create.sub')}</Txt>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
        <View style={{ minHeight: 24, alignItems: 'center' }}>
          {busy ? <Spinner /> : message ? <Txt variant="small" tone="red" center accessibilityLiveRegion="polite">{message}</Txt> : null}
        </View>
        <PinPad value={value} onChange={setValue} onComplete={onComplete} errorTick={errorTick} disabled={busy} deleteLabel={t('pin.delete')} />
      </View>
      <Banner tone="info">{t('pin.note')}</Banner>
    </Screen>
  );
}
