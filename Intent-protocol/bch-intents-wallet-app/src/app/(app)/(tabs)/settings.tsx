/** The Settings tab: every preference, each of which does something. Longer ones open their own screen. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import {
  BookOpen, EyeOff, Fingerprint, Globe, Info, KeyRound, Lock, MapPin, Plug, Server, ShieldCheck, SlidersHorizontal, Trash2, Users,
} from 'lucide-react-native';
import { LANGUAGES } from '@bch-intents/wallet-core/i18n';
import { useLanguage, useT } from '@/i18n';
import { useConnect } from '@/connect/ConnectProvider';
import { accountName, useAccounts } from '@/state/accounts';
import { AUTO_LOCK_MINUTES_OPTIONS, formatAuctionDuration, useSettings, useUpdateSettings, type ThemePref } from '@/state/settings';
import { Button, Card, Header, Row, Screen, SectionTitle, Segmented, Toggle, Txt } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';
import { askBiometric, BIOMETRIC_NAME, biometricSupport, type BiometricSupport } from '@/wdk/biometrics';
import { useWalletActions } from '@/wdk/session';

export default function SettingsTab() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const settings = useSettings();
  const update = useUpdateSettings();
  const language = useLanguage();
  const { lock } = useWalletActions();
  const { names, active, count } = useAccounts();
  const { sessions } = useConnect();
  const [support, setSupport] = useState<BiometricSupport>({ available: false, kind: 'none' });
  useEffect(() => { biometricSupport().then(setSupport); }, []);

  const open = (view: string) => router.push({ pathname: '/(app)/settings/[view]', params: { view } });
  const icon = (Icon: typeof Lock, color = c.fg) => <Icon size={17} color={color} />;
  const kind = support.kind !== 'none' ? t(BIOMETRIC_NAME[support.kind]) : '';

  const setBiometrics = async (on: boolean) => {
    if (!on) { update({ biometrics: false }); return; }
    if (await askBiometric(t('biometric.confirm'), t('common.cancel'))) update({ biometrics: true });
  };

  const lockLabel = (m: number) => (m === 0 ? t('settings.autoLock.immediately') : m >= 60 ? t('settings.hours', { n: m / 60 }) : t('settings.minutes', { n: m }));

  return (
    <Screen scroll tabs testID="settings-tab">
      <Header title={t('settings.title')} />

      <SectionTitle>{t('settings.preferences')}</SectionTitle>
      <Card padding={space.md}>
        <Txt variant="micro" tone="mute" style={{ marginBottom: 6 }}>{t('settings.theme')}</Txt>
        <Segmented<ThemePref>
          label={t('settings.theme')} value={settings.theme} onChange={theme => update({ theme })}
          options={[{ value: 'system', label: t('settings.theme.auto') }, { value: 'light', label: t('settings.theme.light') }, { value: 'dark', label: t('settings.theme.dark') }]}
        />
        <Txt variant="micro" tone="mute" style={{ marginTop: space.md, marginBottom: 6 }}>{t('settings.language')}</Txt>
        <Segmented label={t('settings.language')} value={language} onChange={value => update({ language: value })} options={LANGUAGES.map(l => ({ value: l.value, label: l.label }))} />
        <View style={{ height: space.sm }} />
        <Row
          icon={icon(SlidersHorizontal)} title={t('settings.trading')} last testID="open-trading"
          value={`${formatAuctionDuration(settings.defaultAuctionDuration)} · ${settings.defaultSlippageBps / 100}%`} onPress={() => open('trading')}
        />
      </Card>

      <SectionTitle>{t('settings.network')}</SectionTitle>
      <Card padding={space.md}>
        <Row icon={icon(Globe)} title={t('settings.networks')} value={t(settings.mode === 'mainnet' ? 'network.mainnet' : 'network.testnet')} onPress={() => open('networks')} testID="open-networks" />
        <Row icon={icon(Server)} title={t('settings.services')} onPress={() => open('services')} last testID="open-services" />
      </Card>

      <SectionTitle>{t('settings.wallet')}</SectionTitle>
      <Card padding={space.md}>
        <Row icon={icon(Users)} title={t('accounts.title')} value={count > 1 ? `${accountName(names, active)} · ${count}` : accountName(names, active)} onPress={() => router.push('/(app)/accounts')} testID="open-accounts" />
        <Row icon={icon(MapPin)} title={t('settings.addresses')} onPress={() => open('addresses')} testID="open-addresses" />
        <Row icon={icon(Plug)} title={t('settings.sites')} value={sessions.length ? String(sessions.length) : undefined} onPress={() => router.push('/(app)/connect')} testID="open-connect" />
        <Row icon={icon(EyeOff)} title={t('settings.hidden')} value={settings.hiddenTokens.length ? String(settings.hiddenTokens.length) : undefined} onPress={() => open('hidden')} last testID="open-hidden" />
      </Card>

      <SectionTitle>{t('settings.security')}</SectionTitle>
      <Card padding={space.md}>
        <Row
          icon={icon(Fingerprint)} title={t('biometric.setting')}
          sub={support.available ? t('biometric.settingHint', { kind }) : t('biometric.unavailable')}
          right={<Toggle value={settings.biometrics && support.available} onChange={setBiometrics} label={t('biometric.setting')} />}
        />
        <View style={{ paddingVertical: space.sm }}>
          <Txt variant="label">{t('settings.autoLock')}</Txt>
          <Txt variant="small" tone="mute" style={{ marginBottom: space.sm }}>{t('settings.autoLock.hint')}</Txt>
          <Segmented label={t('settings.autoLock')} value={settings.autoLockMinutes} onChange={autoLockMinutes => update({ autoLockMinutes })} options={AUTO_LOCK_MINUTES_OPTIONS.map(m => ({ value: m, label: lockLabel(m) }))} />
        </View>
        <Row icon={icon(ShieldCheck)} title={t('settings.recovery')} value={settings.backedUp ? undefined : t('settings.recovery.notBackedUp')} onPress={() => open('recovery')} testID="open-recovery" />
        <Row icon={icon(KeyRound)} title={t('settings.changePin')} onPress={() => open('pin')} last testID="open-pin" />
      </Card>

      <SectionTitle>{t('settings.support')}</SectionTitle>
      <Card padding={space.md}>
        <Row icon={icon(BookOpen)} title={t('settings.about')} value={t('settings.version', { version: Constants.expoConfig?.version ?? '0.1.0' })} onPress={() => open('about')} last testID="open-about" />
      </Card>

      <SectionTitle>{t('settings.danger')}</SectionTitle>
      <Card padding={space.md}>
        <Row icon={icon(Trash2, c.red)} title={t('settings.remove')} sub={t('settings.remove.hint')} danger onPress={() => open('remove')} last testID="open-remove" />
      </Card>

      <Button style={{ marginTop: space.xl }} kind="secondary" label={t('settings.lock')} icon={<Lock size={18} color={c.fg} />} onPress={() => { lock().catch(() => {}); }} testID="settings-lock" />
      <View style={{ alignItems: 'center', marginTop: space.lg, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <Info size={13} color={c.fgFaint} />
        <Txt variant="small" tone="faint">{t('app.name')}</Txt>
      </View>
    </Screen>
  );
}
