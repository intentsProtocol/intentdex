/** A sheet that lists assets to choose one from, with a search box. Used by Send. */
import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Search } from 'lucide-react-native';
import type { Asset } from '@bch-intents/wallet-core/assets';
import type { PriceMap } from '@bch-intents/wallet-core/prices';
import { useT } from '@/i18n';
import { AssetRow } from './AssetRow';
import { Field, Sheet, Txt } from './primitives';
import { space, useTheme } from './theme';

export function AssetPicker({ visible, onClose, assets, prices, selectedId, onPick }: {
  visible: boolean; onClose: () => void; assets: Asset[]; prices: PriceMap; selectedId?: string; onPick: (a: Asset) => void;
}) {
  const t = useT();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? assets.filter(a => `${a.symbol} ${a.name} ${a.network.name}`.toLowerCase().includes(needle)) : assets;
  }, [assets, q]);

  return (
    <Sheet visible={visible} onClose={onClose} title={t('send.pickAsset')} tall closeLabel={t('common.close')} testID="asset-picker">
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Field value={q} onChangeText={setQ} placeholder={t('common.search')} right={<Search size={17} color={c.fgFaint} />} testID="asset-search" />
      </View>
      <FlatList
        data={shown} keyExtractor={a => a.id} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: space.xl }}
        renderItem={({ item }) => <AssetRow asset={item} prices={prices} onPress={onPick} unverifiedLabel={t('home.unverified')} selected={item.id === selectedId} />}
        ListEmptyComponent={<Txt variant="small" tone="mute" center style={{ padding: space.xl }}>{t('send.noAssets')}</Txt>}
        initialNumToRender={12} windowSize={7}
      />
    </Sheet>
  );
}
