/**
 * Asks for the PIN again before something sensitive: showing the recovery phrase, changing the PIN, removing
 * the wallet. The wallet being unlocked is not enough for these; the person holding the phone has to be the
 * owner right now.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useT } from '@/i18n';
import { formatWait, pinWait, verifyPin } from '@/wdk/pin';
import { Chameleon } from './Chameleon';
import { PinPad } from './PinPad';
import { Txt } from './primitives';
import { space } from './theme';

export function PinGate({ prompt, onPass }: { prompt: string; onPass: (pin: string) => void }) {
  const t = useT();
  const [pin, setPin] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [message, setMessage] = useState('');
  const [waitMs, setWaitMs] = useState(0);

  useEffect(() => { pinWait().then(setWaitMs); }, []);
  useEffect(() => {
    if (waitMs <= 0) return;
    const id = setInterval(() => setWaitMs(ms => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(id);
  }, [waitMs > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onComplete = async (entered: string) => {
    const result = await verifyPin(entered);
    if (result.ok || result.reason === 'none') { onPass(entered); return; }
    setPin('');
    setErrorTick(n => n + 1);
    setWaitMs(result.waitMs);
    setMessage(result.reason === 'wrong' && !result.waitMs ? t('pin.wrong', { remaining: result.remaining }) : result.reason === 'wrong' ? t('pin.wrongWait') : '');
  };

  const locked = waitMs > 0;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }} testID="pin-gate">
      <Chameleon size={96} mood={errorTick && !locked ? 'error' : 'shy'} />
      <Txt variant="body" tone="mute" center style={{ maxWidth: 320 }}>{prompt}</Txt>
      <View style={{ minHeight: 22 }}>
        {locked ? <Txt variant="small" tone="amber" center accessibilityLiveRegion="polite">{t('pin.locked', { time: formatWait(waitMs) })}</Txt>
          : message ? <Txt variant="small" tone="red" center accessibilityLiveRegion="polite">{message}</Txt> : null}
      </View>
      <PinPad value={pin} onChange={setPin} onComplete={onComplete} errorTick={errorTick} disabled={locked} deleteLabel={t('pin.delete')} />
    </View>
  );
}
