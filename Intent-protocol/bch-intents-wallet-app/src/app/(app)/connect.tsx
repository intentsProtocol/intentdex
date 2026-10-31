/** Connected apps: connect a new one by scanning or pasting its WalletConnect code, and disconnect old ones. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ClipboardPaste, ScanLine } from 'lucide-react-native';
import { hostOf } from '@bch-intents/wallet-core/format';
import { useConnect } from '@/connect/ConnectProvider';
import { useT } from '@/i18n';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Empty, Field, Header, Pill, Row, Screen, Spinner, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';

export default function Connect() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const { configured, pairing, error, sessions, pair, disconnect, disconnectAll, status } = useConnect();
  const [uri, setUri] = useState('');

  const paste = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (text) { setUri(text); pair(text); }
  };

  return (
    <Screen
      scroll testID="connect"
      footer={configured ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button style={{ flex: 1 }} label={t('connect.scan')} icon={<ScanLine size={18} color={c.onPrimary} />} onPress={() => router.push('/(app)/scan')} disabled={pairing} testID="connect-scan" />
          <Button kind="secondary" label={t('common.paste')} icon={<ClipboardPaste size={18} color={c.fg} />} onPress={paste} disabled={pairing} testID="connect-paste" />
        </View>
      ) : undefined}
    >
      <Header title={t('connect.title')} onBack={() => router.back()} backLabel={t('common.back')} />
      <Txt variant="small" tone="mute" style={{ marginBottom: space.md }}>{t('connect.intro')}</Txt>

      {!configured ? (
        <View style={{ alignItems: 'center', gap: space.md, marginTop: space.lg }}>
          <Chameleon size={120} />
          <Banner tone="warn">{t('connect.notConfigured')}</Banner>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Field
            value={uri} onChangeText={setUri} placeholder={t('connect.pastePlaceholder')} mono testID="connect-uri"
            onSubmitEditing={() => pair(uri)} returnKeyType="go"
            right={pairing || status === 'starting' ? <Spinner /> : uri.trim() ? <Pill label={t('common.continue')} tone="primary" onPress={() => pair(uri)} testID="connect-go" /> : undefined}
          />
          {pairing ? <Txt variant="small" tone="mute" center accessibilityLiveRegion="polite">{t('connect.connecting')}</Txt> : null}
          {error ? <Banner tone="error">{error}</Banner> : null}

          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.md }}>
            <Txt variant="heading" accessibilityRole="header">{t('connect.sessions')}</Txt>
            {sessions.length > 1 ? <Pill label={t('settings.sites.disconnectAll')} tone="red" onPress={() => { disconnectAll(); }} testID="disconnect-all" /> : null}
          </View>
          {!sessions.length ? <Empty title={t('settings.sites.empty')} body={t('settings.sites.emptyBody')} /> : (
            <Card padding={space.md}>
              {sessions.map((s, i) => (
                <Row
                  key={s.topic} last={i === sessions.length - 1} title={s.name} sub={`${hostOf(s.url)}\n${t('connect.expires', { when: new Date(s.expiry).toLocaleDateString() })}`}
                  icon={<TokenIcon symbol={s.name} logo={s.icon} size={28} />}
                  right={<Pill label={t('settings.sites.disconnect')} tone="red" onPress={() => { disconnect(s.topic); }} testID={`disconnect-${i}`} />}
                />
              ))}
            </Card>
          )}
        </View>
      )}
    </Screen>
  );
}
