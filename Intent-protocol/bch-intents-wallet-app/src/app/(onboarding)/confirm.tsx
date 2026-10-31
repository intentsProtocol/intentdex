/** Checks the backup: three words of the phrase, asked by position. Can be skipped, with a reminder later. */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useT } from '@/i18n';
import { useOnboarding } from '@/state/onboarding';
import { Banner, Button, Field, Header, Screen, Txt } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Three different positions, in order. Chosen once per visit. */
function pickPositions(count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, 3).sort((a, b) => a - b);
}

export default function Confirm() {
  const t = useT();
  const router = useRouter();
  const phrase = useOnboarding(s => s.phrase);
  const setBackedUp = useOnboarding(s => s.setBackedUp);
  const words = useMemo(() => phrase.split(' ').filter(Boolean), [phrase]);
  const positions = useMemo(() => pickPositions(words.length), [words.length]);
  const [typed, setTyped] = useState<string[]>(['', '', '']);
  const [wrong, setWrong] = useState(false);

  if (!words.length) return <Redirect href="/(onboarding)/welcome" />;

  const filled = typed.every(w => w.trim());
  const check = () => {
    const ok = positions.every((p, i) => typed[i].trim().toLowerCase() === words[p]);
    if (!ok) { setWrong(true); return; }
    setBackedUp(true);
    router.push('/(onboarding)/pin');
  };
  const skip = () => { setBackedUp(false); router.push('/(onboarding)/pin'); };

  return (
    <Screen
      scroll testID="confirm"
      footer={
        <View style={{ gap: space.sm }}>
          <Button label={t('common.continue')} onPress={check} disabled={!filled} testID="confirm-check" />
          <Button label={t('onboarding.confirm.skip')} kind="ghost" onPress={skip} testID="confirm-skip" />
        </View>
      }
    >
      <Header onBack={() => router.back()} backLabel={t('common.back')} sub={t('onboarding.stepOf', { step: 2, of: 3 })} />
      <Txt variant="title">{t('onboarding.confirm.title')}</Txt>
      <Txt variant="body" tone="mute">{t('onboarding.confirm.sub')}</Txt>
      <View style={{ gap: space.md, marginTop: space.xl }}>
        {positions.map((p, i) => (
          <Field
            key={p} label={t('onboarding.confirm.word', { n: p + 1 })} value={typed[i]} testID={`confirm-word-${i}`}
            onChangeText={v => { setWrong(false); setTyped(prev => prev.map((w, k) => (k === i ? v : w))); }}
            autoComplete="off" spellCheck={false} returnKeyType={i === 2 ? 'done' : 'next'}
          />
        ))}
        {wrong ? <Banner tone="error">{t('onboarding.confirm.wrong')}</Banner> : null}
      </View>
    </Screen>
  );
}
