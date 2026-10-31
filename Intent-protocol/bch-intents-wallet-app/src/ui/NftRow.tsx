/** Rows for the Wallet tab: a collectible group (one category, N items) and a Mesh V4 position card. */
import React, { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Gem } from 'lucide-react-native';
import { priceRange } from '@bch-intents/wallet-core/mesh/v4';
import type { NftGroup, NftHolding } from '@bch-intents/wallet-core/nfts';
import { formatAmount } from '@bch-intents/wallet-core/format';
import { tap, Card, Txt } from './primitives';
import { TokenIcon } from './TokenIcon';
import { radius, space, useTheme } from './theme';

/** One category of collectibles. Tapping a single-item group opens the NFT; a multi-item group opens the group. */
export const CollectibleRow = memo(function CollectibleRow({ group, countLabel, onPress }: { group: NftGroup; countLabel: string; onPress: (group: NftGroup) => void }) {
  const { c } = useTheme();
  const first = group.items[0];
  return (
    <Pressable
      onPress={() => { tap(); onPress(group); }} accessibilityRole="button" accessibilityLabel={`${group.name}, ${countLabel}`} testID={`nft-group-${group.category}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: 14, backgroundColor: pressed ? c.surface2 : 'transparent' })}
    >
      <TokenIcon symbol={group.name} logo={group.logo ?? first?.logo} networkLogo={group.network.logo} palette={group.network.palette} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="label" numberOfLines={1}>{group.name}</Txt>
        <Txt variant="small" tone="mute" numberOfLines={1}>{group.network.name}</Txt>
      </View>
      <Txt variant="label" tabular>{countLabel}</Txt>
    </Pressable>
  );
});

/** A Mesh V4 liquidity position: value (sats→BCH), funded bins and step; value shown only when the server priced it. */
export const PositionRow = memo(function PositionRow({ holding, labels, onPress }: {
  holding: NftHolding;
  labels: { value: string; bins: string; step: string; symbol: string };
  onPress: (h: NftHolding) => void;
}) {
  const { c } = useTheme();
  const commitment = holding.position!.commitment;
  const view = holding.position!.view;
  const range = priceRange(commitment);
  const funded = view ? view.bins.filter(b => b.utxos.length > 0).length : undefined;
  const valueBch = view ? formatAmount(BigInt(view.totals.valueAtBidSats), 8, 6) : null;
  return (
    <Pressable
      onPress={() => { tap(); onPress(holding); }} accessibilityRole="button" accessibilityLabel={`${holding.name} ${holding.category.slice(0, 8)}`} testID={`nft-position-${holding.id}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      <Card padding={space.md} style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.primaryDim, alignItems: 'center', justifyContent: 'center' }}>
            <Gem size={16} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="label" numberOfLines={1}>{holding.name}</Txt>
            <Txt variant="small" tone="mute" numberOfLines={1}>{`${commitment.shape} · ${(commitment.binStepBps / 100).toFixed(2)}% ${labels.step}`}</Txt>
          </View>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.primaryDim }}>
            <Txt variant="small" tone="primary" weight="600">V4</Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="small" tone="faint">{labels.value}</Txt>
            <Txt variant="label" tabular>{valueBch ? `${valueBch} ${labels.symbol}` : '—'}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="small" tone="faint">{labels.bins}</Txt>
            <Txt variant="label" tabular>{funded !== undefined ? `${funded}/${commitment.binCount}` : commitment.binCount}</Txt>
          </View>
        </View>
        <Txt variant="small" tone="faint" numberOfLines={1}>{`${range.lowSatsPerUnit.toPrecision(4)}–${range.highSatsPerUnit.toPrecision(4)} sats/unit`}</Txt>
      </Card>
    </Pressable>
  );
});
