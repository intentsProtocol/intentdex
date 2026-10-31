/**
 * Receive screen — one address per chain family, as text and as a QR code.
 * Ported from wallet-extension-bundle/morphic-wallet-main.jsx (MScreenReceive).
 */

import { useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useT } from '@/context/SettingsProvider';
import { MX, CHAIN, MPopup, MPrimary, MI, ChainGlyph, MQR, Banner, Segmented, useCopy } from '@/design-system/primitives';
import { PageHeader } from './shared';
import { FAMILIES, FAMILY_PALETTE, explorerAddressUrl, networksOf, type Family } from '@/lib/chains';

interface ReceiveScreenProps {
  onBack: () => void;
  /** Asset the user came from, to open on its chain. */
  assetId?: string;
}

export function ReceiveScreen({ onBack, assetId }: ReceiveScreenProps) {
  const wdk = useWDK();
  const t = useT();
  const { addresses, findAsset } = usePortfolio();
  const from = assetId ? findAsset(assetId) : undefined;
  const [family, setFamily] = useState<Family>(from?.network.family ?? 'bch');
  const [bchKind, setBchKind] = useState<'bch' | 'token'>(from?.kind === 'cashtoken' ? 'token' : 'bch');
  const [copied, copy] = useCopy(1600);

  const palette = FAMILY_PALETTE[family];
  const c = CHAIN[palette];
  const nets = networksOf(wdk.networkMode, family);
  const tokenAddr: string | null = wdk.bchWallet?.tokenaddr ?? null;

  const address =
    family === 'bch' ? (bchKind === 'token' ? tokenAddr ?? addresses.bch : addresses.bch)
    : family === 'evm' ? addresses.evm
    : family === 'solana' ? addresses.solana
    : addresses.btc;

  const note =
    family === 'bch' ? (bchKind === 'token' ? t('receive.note.token') : t('receive.note.bch'))
    : family === 'evm' ? t('receive.note.evm', { networks: nets.map(n => n.short).join(', ') })
    : family === 'solana' ? t('receive.note.solana')
    : t('receive.note.btc');

  return (
    <MPopup>
      <PageHeader title={t('receive.title')} sub={nets.length === 1 ? nets[0].name : t('receive.evmNetworks', { count: nets.length })} onBack={onBack} />

      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {/* chain tabs */}
        <div role="tablist" aria-label={t('receive.chain')} style={{ display: 'flex', gap: 6, width: '100%' }}>
          {FAMILIES.map(f => {
            const p = FAMILY_PALETTE[f];
            const on = f === family;
            return (
              <button
                key={f} type="button" role="tab" aria-selected={on} data-testid={`receive-${f}`}
                onClick={() => setFamily(f)}
                style={{
                  flex: 1, padding: '8px 2px', borderRadius: 12, cursor: 'pointer',
                  background: on ? CHAIN[p].bg : MX.surface, border: `1px solid ${on ? CHAIN[p].border : MX.border}`,
                  color: on ? CHAIN[p].color : MX.fgMute, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700,
                }}
              >
                <ChainGlyph chain={p} size={18} />
                {CHAIN[p].short}
              </button>
            );
          })}
        </div>

        {family === 'bch' && (
          <Segmented
            ariaLabel={t('receive.addressType')} value={bchKind} onChange={setBchKind}
            options={[{ value: 'bch', label: t('receive.bchAddress') }, { value: 'token', label: t('receive.tokenAddress') }]}
          />
        )}

        {address ? (
          <>
            <MQR value={address} size={176} borderColor={c.color} />
            <button
              type="button" onClick={() => copy(address)} data-testid="receive-address" className="mx-press"
              style={{
                width: '100%', padding: '11px 12px', background: MX.surface, border: `1px solid ${copied ? MX.primaryBorder : MX.border}`, borderRadius: 13,
                color: MX.fg, cursor: 'pointer', textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 700, color: c.color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
                {t('receive.yourAddress', { chain: c.name })}
              </div>
              <div style={{ fontFamily: MX.mono, fontSize: 11.5, lineHeight: 1.5, wordBreak: 'break-all' }}>{address}</div>
            </button>
          </>
        ) : (
          <Banner tone="error">{t('receive.unavailable', { chain: c.name })}</Banner>
        )}

        <Banner tone={wdk.networkMode === 'testnet' ? 'warn' : 'info'}>
          {wdk.networkMode === 'testnet' && <strong>{t('receive.testnetOnly')} </strong>}
          {note}
        </Banner>

        {address && (
          <a href={explorerAddressUrl(nets[0], address)} target="_blank" rel="noreferrer" style={{ color: MX.primary, fontSize: 11.5, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <MI.ext size={12} /> {t('home.viewOnExplorer')}
          </a>
        )}
      </div>

      <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${MX.border}` }}>
        <MPrimary disabled={!address} icon={copied ? <MI.check size={14} /> : <MI.copy size={14} />} onClick={() => address && copy(address)} testId="receive-copy">
          {copied ? t('common.copied') : t('receive.copy')}
        </MPrimary>
      </div>
    </MPopup>
  );
}
