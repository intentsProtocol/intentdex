/**
 * A token's mark, with the network it lives on as a small badge.
 *
 * A logo is one of three things: a path the chain table names (drawn from the bundled SVGs), an https image a
 * token registry points at, or nothing, in which case the first letter of the symbol on the chain's colour.
 * A registry image that fails to load falls back to the letter, so a broken link is never an empty circle.
 */
import React, { memo, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { SvgCss } from 'react-native-svg/css';
import type { ChainKey } from '@bch-intents/wallet-core/chains';
import { LOGOS } from './logos';
import { useTheme } from './theme';

const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/', 'https://dweb.link/ipfs/'];

function normalizeLogoUri(uri?: string, gatewayIndex = 0): string | undefined {
  if (!uri) return undefined;
  const gw = IPFS_GATEWAYS[gatewayIndex] ?? IPFS_GATEWAYS[0];
  if (/^ipfs:\/\//i.test(uri)) return `${gw}${uri.replace(/^ipfs:\/\//i, '')}`;
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{56})/i.test(uri)) return `${gw}${uri}`;
  return uri;
}

function Mark({ logo, symbol, color, size }: { logo?: string; symbol: string; color: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const [gatewayIdx, setGatewayIdx] = useState(0);
  const { c } = useTheme();

  // Reset failed state whenever logo changes (crucial for FlatList recycling)
  useEffect(() => {
    setFailed(false);
    setGatewayIdx(0);
  }, [logo]);

  const bundled = logo ? LOGOS[logo] : undefined;
  if (bundled) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <SvgCss xml={bundled} width={size} height={size} />
      </View>
    );
  }

  const isIpfs = !!logo && (/^ipfs:\/\//i.test(logo) || /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{56})/i.test(logo));
  const resolvedUri = normalizeLogoUri(logo, gatewayIdx);

  const handleError = () => {
    if (isIpfs && gatewayIdx < IPFS_GATEWAYS.length - 1) {
      setGatewayIdx(i => i + 1);
    } else {
      setFailed(true);
    }
  };

  if (resolvedUri && /^https?:\/\//i.test(resolvedUri) && !failed) {
    return (
      <Image
        key={resolvedUri}
        source={{ uri: resolvedUri }}
        onError={handleError}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface2 }}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const letter = (symbol.replace(/^\$/, '')[0] ?? '?').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
      <Text style={{ color: '#ffffff', fontSize: size * 0.44, fontWeight: '800' }}>{letter}</Text>
    </View>
  );
}

interface TokenIconProps {
  symbol: string;
  logo?: string;
  /** Shown as a badge when it differs from the token's own logo. */
  networkLogo?: string;
  palette?: ChainKey;
  size?: number;
}

export const TokenIcon = memo(function TokenIcon({ symbol, logo, networkLogo, palette = 'bch', size = 40 }: TokenIconProps) {
  const { c } = useTheme();
  const badge = Math.round(size * 0.42);
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Mark logo={logo} symbol={symbol} color={c.chain[palette]} size={size} />
      {networkLogo && networkLogo !== logo ? (
        <View style={{ position: 'absolute', right: -3, bottom: -3, width: badge + 4, height: badge + 4, borderRadius: (badge + 4) / 2, backgroundColor: c.bg1, alignItems: 'center', justifyContent: 'center' }}>
          <Mark logo={networkLogo} symbol={symbol} color={c.chain[palette]} size={badge} />
        </View>
      ) : null}
    </View>
  );
});
