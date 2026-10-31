/** The first screen: waits for the worklet and the stored settings, then sends the user where the session is. */
import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useT } from '@/i18n';
import { useAccounts } from '@/state/accounts';
import { useSettingsStore } from '@/state/settings';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Screen, Txt } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { useSession } from '@/wdk/session';

export default function Index() {
  const t = useT();
  const { status } = useSession();
  const settingsLoaded = useSettingsStore(s => s.loaded);
  const accountsLoaded = useAccounts(s => s.loaded);
  const ready = settingsLoaded && accountsLoaded;

  if (status === 'error') {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
          <View style={{ alignItems: 'center' }}><Chameleon mood="error" /></View>
          <Banner tone="error">{t('boot.failed')}</Banner>
        </View>
      </Screen>
    );
  }
  if (status === 'loading' || !ready) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
          <Chameleon mood="busy" />
          <Txt variant="small" tone="mute">{t('boot.starting')}</Txt>
        </View>
      </Screen>
    );
  }
  if (status === 'noWallet') return <Redirect href="/(onboarding)/welcome" />;
  if (status === 'locked') return <Redirect href="/unlock" />;
  return <Redirect href="/(app)/(tabs)/wallet" />;
}
