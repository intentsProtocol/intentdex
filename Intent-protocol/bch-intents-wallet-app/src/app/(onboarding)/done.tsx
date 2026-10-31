/** The wallet exists. Offer biometric unlock if the phone has it, say what to expect, and open the wallet. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useT } from '@/i18n';
import { useOnboarding } from '@/state/onboarding';
import { useSettings, useUpdateSettings } from '@/state/settings';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Screen, thud, Toggle, Txt } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { askBiometric, BIOMETRIC_NAME, biometricSupport, type BiometricSupport } from '@/wdk/biometrics';

export default function Done() {
  const t = useT();
  const router = useRouter();
  const settings = useSettings();
  const update = useUpdateSettings();
  const clear = useOnboarding(s => s.clear);
  const [support, setSupport] = useState<BiometricSupport>({ available: false, kind: 'none' });

  // The phrase has done its work: drop it from memory.
  useEffect(() => { clear(); thud(); }, [clear]);
  useEffect(() => { biometricSupport().then(setSupport); }, []);

  const kind = support.kind !== 'none' ? t(BIOMETRIC_NAME[support.kind]) : '';
  const toggle = async (on: boolean) => {
    if (!on) { update({ biometrics: false }); return; }
    // Turning it on asks for the biometric once, so a phone whose sensor fails never ends up relying on it.
    if (await askBiometric(t('biometric.confirm'), t('common.cancel'))) update({ biometrics: true });
  };

  return (
    <Screen
      scroll testID="done"
      footer={<Button label={t('onboarding.done.open')} onPress={() => router.replace('/(app)/(tabs)/wallet')} testID="open-wallet" />}
    >
      <View style={{ alignItems: 'center', paddingTop: space.xxl * 1.5, gap: space.sm }}>
        <Chameleon size={170} mood="happy" />
        <Txt variant="title" center>{t('onboarding.done.title')}</Txt>
        <Txt variant="body" tone="mute" center style={{ maxWidth: 320 }}>{t('onboarding.done.body')}</Txt>
      </View>
      <View style={{ gap: space.md, marginTop: space.xl }}>
        {support.available ? (
          <Card padding={space.md}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Txt variant="label">{t('biometric.offer.title')}</Txt>
                <Txt variant="small" tone="mute">{t('biometric.offer.body', { kind })}</Txt>
              </View>
              <Toggle value={settings.biometrics} onChange={toggle} label={t('biometric.offer.enable', { kind })} />
            </View>
          </Card>
        ) : null}
        {!settings.backedUp ? <Banner tone="warn">{t('onboarding.done.notBackedUp')}</Banner> : null}
        <Banner tone="info">{t('onboarding.done.testnet')}</Banner>
      </View>
    </Screen>
  );
}
