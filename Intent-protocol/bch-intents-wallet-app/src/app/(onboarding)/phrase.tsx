/** A new wallet's recovery phrase: shown once here, to be written down. Nothing is stored yet. */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useT } from '@/i18n';
import { useOnboarding } from '@/state/onboarding';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Header, Screen, Txt } from '@/ui/primitives';
import { SeedWords } from '@/ui/SeedWords';
import { space, useTheme } from '@/ui/theme';
import { useSecureScreen } from '@/ui/useSecureScreen';

export default function Phrase() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const phrase = useOnboarding(s => s.phrase);
  const words = useMemo(() => phrase.split(' ').filter(Boolean), [phrase]);
  const [revealed, setRevealed] = useState(false);
  useSecureScreen();

  if (!words.length) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <Screen
      scroll testID="phrase"
      footer={<Button label={t('onboarding.phrase.saved')} onPress={() => router.push('/(onboarding)/confirm')} disabled={!revealed} testID="phrase-saved" />}
    >
      <Header onBack={() => router.back()} backLabel={t('common.back')} sub={t('onboarding.stepOf', { step: 1, of: 3 })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{t('onboarding.phrase.title')}</Txt>
          <Txt variant="body" tone="mute">{t('onboarding.phrase.sub', { count: words.length })}</Txt>
        </View>
        <Chameleon size={84} mood={revealed ? 'shy' : 'idle'} />
      </View>

      <View style={{ marginTop: space.lg, gap: space.md }}>
        <Banner tone="warn">{t('onboarding.phrase.warning')}</Banner>
        <Card padding={space.md}>
          <SeedWords words={words} revealed={revealed} onReveal={() => setRevealed(true)} revealLabel={t('onboarding.phrase.reveal')} />
        </Card>
        <View style={{ gap: 6, paddingHorizontal: 4 }}>
          {(['onboarding.phrase.tip1', 'onboarding.phrase.tip2', 'onboarding.phrase.tip3'] as const).map(key => (
            <View key={key} style={{ flexDirection: 'row', gap: space.sm }}>
              <Txt variant="small" style={{ color: c.primary }}>•</Txt>
              <Txt variant="small" tone="mute" style={{ flex: 1 }}>{t(key)}</Txt>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}
