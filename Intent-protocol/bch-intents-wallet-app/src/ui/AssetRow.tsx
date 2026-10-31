/** One asset in a list: its mark, name and network on the left, balance and value on the right. */
import React, { memo } from 'react';
import { Pressable, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { priceOf, valueOf, type Asset } from '@bch-intents/wallet-core/assets';
import { formatAmount, formatUsd } from '@bch-intents/wallet-core/format';
import type { PriceMap } from '@bch-intents/wallet-core/prices';
import { tap, Txt } from './primitives';
import { TokenIcon } from './TokenIcon';
import { space, useTheme } from './theme';

interface AssetRowProps {
  asset: Asset;
  prices: PriceMap;
  hidden?: boolean;
  onPress?: (asset: Asset) => void;
  /** Read out after the symbol for an unverified token. */
  unverifiedLabel: string;
  selected?: boolean;
}

export const AssetRow = memo(function AssetRow({ asset, prices, hidden, onPress, unverifiedLabel, selected }: AssetRowProps) {
  const { c } = useTheme();
  const value = valueOf(asset, prices);
  const price = priceOf(asset, prices);
  const amount = hidden ? '••••' : formatAmount(asset.balance, asset.decimals);
  return (
    <Pressable
      onPress={() => { if (onPress) { tap(); onPress(asset); } }} disabled={!onPress} testID={`asset-${asset.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${asset.symbol}, ${asset.network.name}${asset.verified ? '' : `, ${unverifiedLabel}`}, ${amount}`}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: 14,
        backgroundColor: selected ? c.primaryDim : pressed ? c.surface2 : 'transparent',
      })}
    >
      <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{asset.symbol}</Txt>
          {!asset.verified ? <AlertTriangle size={13} color={c.amber} /> : null}
        </View>
        <Txt variant="small" tone="mute" numberOfLines={1}>
          {asset.name && asset.name.toLowerCase() !== asset.symbol.toLowerCase() ? `${asset.name} · ` : ''}{asset.network.name}{price !== undefined ? ` · ${formatUsd(price)}` : ''}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
        <Txt variant="label" tabular numberOfLines={1}>{amount}</Txt>
        {value !== undefined ? <Txt variant="small" tone="mute" tabular>{hidden ? '••••' : formatUsd(value)}</Txt> : null}
      </View>
    </Pressable>
  );
});
