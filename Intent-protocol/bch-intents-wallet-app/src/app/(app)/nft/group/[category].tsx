/** Every NFT of one category the account holds. */
import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useT } from '@/i18n';
import { usePortfolio } from '@/state/portfolio';
import { Card, Empty, Header, Pill, Row, Screen } from '@/ui/primitives';
import { space } from '@/ui/theme';

const short = (hex: string) => (hex.length > 24 ? `${hex.slice(0, 12)}…${hex.slice(-8)}` : hex);

export default function NftGroup() {
  const t = useT();
  const router = useRouter();
  const { category } = useLocalSearchParams<{ category: string }>();
  const { nfts } = usePortfolio();
  const items = nfts.filter(n => n.category === category);
  const name = items[0]?.name ?? t('nft.collectibles');

  return (
    <Screen scroll testID="nft-group">
      <Header title={name} sub={t('nft.count', { count: items.length })} onBack={() => router.back()} backLabel={t('common.back')} />
      {items.length ? (
        <Card padding={space.xs}>
          {items.map((n, i) => (
            <Row
              key={n.id}
              title={n.commitment ? `#${short(n.commitment)}` : t('nft.noCommitment')}
              right={<Pill label={t(`nft.capability.${n.capability}` as const)} tone={n.capability === 'minting' ? 'amber' : 'mute'} />}
              onPress={() => router.push({ pathname: '/(app)/nft/[id]', params: { id: n.id } })}
              last={i === items.length - 1}
              testID={`nft-item-${n.id}`}
            />
          ))}
        </Card>
      ) : (
        <Empty title={t('home.emptyTitle')} />
      )}
    </Screen>
  );
}
