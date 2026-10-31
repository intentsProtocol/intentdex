/** The first thing a new user sees: what the wallet is, and the two ways in. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { FAMILIES, FAMILY_LABEL, FAMILY_PALETTE, networkOf, networksOf, type Family } from '@bch-intents/wallet-core/chains';
import { errorMessage } from '@bch-intents/wallet-core/format';
import { useT, type Key } from '@/i18n';
import { useOnboarding } from '@/state/onboarding';
import { Chameleon } from '@/ui/Chameleon';
import { Banner, Button, Card, Screen, Txt } from '@/ui/primitives';
import { TokenIcon } from '@/ui/TokenIcon';
import { space, useTheme } from '@/ui/theme';
import { useWalletActions } from '@/wdk/session';

const CHAIN_LINE: Record<Family, Key> = {
  bch: 'onboarding.chain.bch', evm: 'onboarding.chain.evm', solana: 'onboarding.chain.sol', btc: 'onboarding.chain.btc',
};

export default function Welcome() {
  const t = useT();
  const router = useRouter();
  const { c } = useTheme();
  const { generatePhrase } = useWalletActions();
  const begin = useOnboarding(s => s.begin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Cham shows off: its skin cycles through the four chains.
  const [tone, setTone] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTone(i => (i + 1) % FAMILIES.length), 2600);
    return () => clearInterval(id);
  }, []);

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      const phrase = await generatePhrase(12);
      if (!phrase || phrase.trim().split(/\s+/).length < 12) throw new Error(t('onboarding.error.generate'));
      begin('create', phrase.trim());
      router.push('/(onboarding)/phrase');
    } catch (e) {
      setError(errorMessage(e, t('onboarding.error.generate')));
    } finally {
      setBusy(false);
    }
  };

  const logoOf = (family: Family) => (family === 'evm' ? networksOf('mainnet', 'evm')[0] : networkOf('mainnet', family)).logo;

  return (
    <Screen
      scroll testID="welcome"
      footer={
        <View style={{ gap: space.sm }}>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Button label={t('onboarding.create')} onPress={create} loading={busy} testID="create-wallet" />
          <Button label={t('onboarding.import')} kind="secondary" onPress={() => router.push('/(onboarding)/import')} disabled={busy} testID="import-wallet" />
          <Txt variant="small" tone="faint" center style={{ marginTop: 4 }}>{t('onboarding.footnote')}</Txt>
        </View>
      }
    >
      <View style={{ alignItems: 'center', paddingTop: space.xxl, gap: space.sm }}>
        <Chameleon size={190} tone={c.chain[FAMILY_PALETTE[FAMILIES[tone]]]} mood={busy ? 'busy' : 'idle'} />
        <Txt variant="title" center>{t('app.name')}</Txt>
        <Txt variant="body" tone="mute" center style={{ maxWidth: 300 }}>{t('onboarding.tagline')}</Txt>
      </View>

      <Card style={{ marginTop: space.xl }} padding={space.md}>
        {FAMILIES.map((family, i) => (
          <View key={family} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
            <TokenIcon symbol={FAMILY_LABEL[family]} logo={logoOf(family)} palette={FAMILY_PALETTE[family]} size={34} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{FAMILY_LABEL[family]}</Txt>
              <Txt variant="small" tone="mute">{t(CHAIN_LINE[family])}</Txt>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
