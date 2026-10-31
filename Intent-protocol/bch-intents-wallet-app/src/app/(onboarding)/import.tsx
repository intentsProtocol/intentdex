/** Import a wallet from a 12 or 24 word recovery phrase. The phrase is checked before anything else happens. */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { validateMnemonic } from '@tetherto/wdk-react-native-core';
import { useT } from '@/i18n';
import { useOnboarding } from '@/state/onboarding';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Field, Header, Pill, Screen, Txt } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { useSecureScreen } from '@/ui/useSecureScreen';

const normalizePhrase = (text: string) => text.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

export default function Import() {
  const t = useT();
  const router = useRouter();
  const begin = useOnboarding(s => s.begin);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useSecureScreen();

  const phrase = useMemo(() => normalizePhrase(text), [text]);
  const count = phrase ? phrase.split(' ').length : 0;
  const rightLength = count === 12 || count === 24;

  const next = () => {
    let valid = false;
    try { valid = validateMnemonic(phrase); } catch { valid = false; }
    if (!rightLength || !valid) { setError(t('onboarding.import.invalid')); return; }
    begin('import', phrase);
    router.push('/(onboarding)/pin');
  };

  const paste = async () => {
    const clip = await Clipboard.getStringAsync().catch(() => '');
    if (clip) { setText(clip); setError(''); }
  };

  return (
    <Screen
      scroll testID="import"
      footer={<Button label={t('common.continue')} onPress={next} disabled={!rightLength} testID="import-continue" />}
    >
      <Header onBack={() => router.back()} backLabel={t('common.back')} sub={t('onboarding.stepOf', { step: 1, of: 2 })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{t('onboarding.import.title')}</Txt>
          <Txt variant="body" tone="mute">{t('onboarding.import.sub')}</Txt>
        </View>
        <Chameleon size={84} mood={text ? 'shy' : 'idle'} />
      </View>
      <View style={{ gap: space.md, marginTop: space.lg }}>
        <Field
          value={text} onChangeText={v => { setText(v); setError(''); }} placeholder={t('onboarding.import.placeholder')}
          multiline numberOfLines={4} autoComplete="off" spellCheck={false} textAlignVertical="top" testID="import-phrase"
          style={{ minHeight: 110 }} error={error || undefined}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt variant="small" tone={rightLength ? 'primary' : 'mute'}>{t('onboarding.import.count', { count })}</Txt>
          <Pill label={t('common.paste')} onPress={paste} tone="primary" testID="import-paste" />
        </View>
        <Banner tone="info">{t('onboarding.import.note')}</Banner>
      </View>
    </Screen>
  );
}
