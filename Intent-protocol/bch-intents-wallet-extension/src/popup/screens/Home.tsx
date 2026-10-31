/**
 * Home screen — multichain portfolio view.
 * Ported from wallet-extension-bundle/morphic-wallet-main.jsx (MScreenHome); the token list is now every
 * asset on every network of the active mode, read through PortfolioProvider.
 */

import { useMemo, useState } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useSettings } from '@/context/SettingsProvider';
import {
  MX, CHAIN, MPopup, Bento, MI, ChainGlyph, TokenIcon, Skeleton, Banner, IconBtn, Sheet, MSecondary, type ChainKey,
} from '@/design-system/primitives';
import { MTopBar, MBottomNav, QA, EmptyState, type Screen } from './shared';
import { change24hOf, priceOf, valueOf, type Asset, type NftGroup, type NftHolding } from '@/lib/assets';
import { priceRange } from '@bch-intents/wallet-core/mesh/v4';
import { FAMILIES, FAMILY_PALETTE, explorerAddressUrl, networksFor, type Family } from '@/lib/chains';
import { formatAmount, formatPct, formatUsd } from '@/lib/format';
import { isBackedUp } from '@/lib/settings';

interface HomeScreenProps {
  onNavigate: (s: Screen, assetId?: string) => void;
}

const MASK = '••••';

// ─── token row ────────────────────────────────────────────────────────────────
function TokenRow({ asset, hide, onClick }: { asset: Asset; hide: boolean; onClick: () => void }) {
  const { prices } = usePortfolio();
  const { t } = useSettings();
  const value = valueOf(asset, prices);
  const change = change24hOf(asset, prices);
  const price = priceOf(asset, prices);
  const testnet = asset.network.mode === 'testnet';
  return (
    <button
      type="button" onClick={onClick} data-testid={`asset-${asset.id}`} className="mx-press"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '9px 10px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13, color: MX.fg, cursor: 'pointer',
      }}
    >
      <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>{asset.symbol}</span>
          {!asset.verified && <span title={t('home.unverified')} style={{ color: MX.amber, display: 'flex' }}><MI.warn size={11} /></span>}
        </div>
        <div style={{ fontSize: 11, color: MX.fgMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.network.name}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {hide ? MASK : testnet ? formatAmount(asset.balance, asset.decimals) : formatUsd(value)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', fontSize: 10.5, color: MX.fgMute, fontVariantNumeric: 'tabular-nums' }}>
          {testnet
            ? <span>{t('home.testFunds')}</span>
            : <span>{hide ? MASK : `${formatAmount(asset.balance, asset.decimals)} ${asset.symbol}`}</span>}
          {!testnet && change !== undefined && price !== undefined && (
            <span style={{ fontWeight: 700, color: change >= 0 ? MX.primary : MX.red }}>{formatPct(change)}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── asset detail sheet ───────────────────────────────────────────────────────
function AssetSheet({ asset, hide, onClose, onNavigate }: { asset: Asset; hide: boolean; onClose: () => void; onNavigate: HomeScreenProps['onNavigate'] }) {
  const { prices, addresses } = usePortfolio();
  const { t, settings, update } = useSettings();
  const value = valueOf(asset, prices);
  const price = priceOf(asset, prices);
  const family = asset.network.family;
  const address = family === 'evm' ? addresses.evm : family === 'bch' ? addresses.bch : family === 'solana' ? addresses.solana : addresses.btc;
  const canHide = asset.kind !== 'native';
  return (
    <Sheet title={`${asset.symbol} · ${asset.network.name}`} onClose={onClose} testId="asset-sheet">
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TokenIcon symbol={asset.symbol} logo={asset.logo} networkLogo={asset.network.logo} palette={asset.network.palette} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              {hide ? MASK : formatAmount(asset.balance, asset.decimals, 8)} <span style={{ fontSize: 13, color: MX.fgMute, fontWeight: 700 }}>{asset.symbol}</span>
            </div>
            <div style={{ fontSize: 11.5, color: MX.fgMute }}>
              {asset.network.mode === 'testnet' ? t('home.testFundsLong') : hide ? MASK : `${formatUsd(value)}${price !== undefined ? ` · ${formatUsd(price)} / ${asset.symbol}` : ''}`}
            </div>
          </div>
        </div>
        {!asset.verified && <Banner tone="warn">{t('home.unverifiedLong')}</Banner>}
        <div style={{ display: 'flex', gap: 8 }}>
          <MSecondary h={40} icon={<MI.send size={14} />} disabled={asset.balance === 0n} onClick={() => onNavigate('send', asset.id)} testId="asset-send">{t('action.send')}</MSecondary>
          <MSecondary h={40} icon={<MI.receive size={14} />} onClick={() => onNavigate('receive', asset.id)} testId="asset-receive">{t('action.receive')}</MSecondary>
          <MSecondary h={40} icon={<MI.swap size={14} />} onClick={() => onNavigate('swap', asset.id)} testId="asset-swap">{t('action.swap')}</MSecondary>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 600 }}>
          {address && (
            <a href={explorerAddressUrl(asset.network, address)} target="_blank" rel="noreferrer" style={{ color: MX.primary, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <MI.ext size={12} /> {t('home.viewOnExplorer')}
            </a>
          )}
          {asset.network.faucet && (
            <a href={asset.network.faucet} target="_blank" rel="noreferrer" style={{ color: MX.primary, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <MI.faucet size={12} /> {t('home.faucet')}
            </a>
          )}
          {canHide && (
            <button type="button" onClick={() => { update({ hiddenTokens: [...settings.hiddenTokens, asset.id] }); onClose(); }} style={{ background: 'none', border: 'none', color: MX.fgMute, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <MI.eyeOff size={12} /> {t('home.hideToken')}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ─── NFT rows and sheet ─────────────────────────────────────────────────────────
function CollectibleRow({ group, onClick }: { group: NftGroup; onClick: () => void }) {
  const first = group.items[0];
  return (
    <button
      type="button" onClick={onClick} data-testid={`nft-group-${group.category}`} className="mx-press"
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13, color: MX.fg, cursor: 'pointer' }}
    >
      <TokenIcon symbol={group.name} logo={group.logo ?? first?.logo} networkLogo={group.network.logo} palette={group.network.palette} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{group.name}</div>
        <div style={{ fontSize: 11, color: MX.fgMute }}>{group.network.name}</div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: MX.fgMute }}>×{group.items.length}</div>
    </button>
  );
}

function PositionRow({ holding, onClick }: { holding: NftHolding; onClick: () => void }) {
  const { t } = useSettings();
  const c = holding.position!.commitment;
  const view = holding.position!.view;
  const funded = view ? view.bins.filter(b => b.utxos.length > 0).length : undefined;
  return (
    <button
      type="button" onClick={onClick} data-testid={`nft-position-${holding.id}`} className="mx-press"
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13, color: MX.fg, cursor: 'pointer' }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 99, background: MX.primaryDim, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MX.primary }}><MI.swap size={16} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{holding.name}</div>
        <div style={{ fontSize: 11, color: MX.fgMute }}>{`${c.shape} · ${(c.binStepBps / 100).toFixed(2)}% ${t('nft.step')}`}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{view ? `${formatAmount(BigInt(view.totals.valueAtBidSats), 8, 6)} BCH` : '—'}</div>
        <div style={{ fontSize: 10.5, color: MX.fgMute }}>{funded !== undefined ? `${funded}/${c.binCount} ${t('nft.bins')}` : `${c.binCount} ${t('nft.bins')}`}</div>
      </div>
    </button>
  );
}

const shortHex = (h: string) => (h.length > 24 ? `${h.slice(0, 12)}…${h.slice(-8)}` : h);

function NftSheet({ holding, onClose }: { holding: NftHolding; onClose: () => void }) {
  const { t, settings, update } = useSettings();
  const { addresses } = usePortfolio();
  const position = holding.position;
  const view = position?.view;
  return (
    <Sheet title={holding.name} onClose={onClose} testId="nft-sheet">
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {holding.description && <div style={{ fontSize: 12, color: MX.fgMute }}>{holding.description}</div>}
        {position && <Banner tone="warn">{t('nft.positionWarning')}</Banner>}
        {position && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <Row label={t('nft.shape')} value={position.commitment.shape} />
            <Row label={t('nft.step')} value={`${(position.commitment.binStepBps / 100).toFixed(2)}%`} />
            <Row label={t('nft.range')} value={`${priceRange(position.commitment).lowSatsPerUnit.toPrecision(4)}–${priceRange(position.commitment).highSatsPerUnit.toPrecision(4)} sats/unit`} />
            {view && <Row label={t('nft.value')} value={`${formatAmount(BigInt(view.totals.valueAtBidSats), 8, 6)} BCH`} />}
            <Row label={t('nft.bins')} value={view ? `${view.bins.filter(b => b.utxos.length > 0).length}/${position.commitment.binCount}` : String(position.commitment.binCount)} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          <Row label={t('nft.capability.' + holding.capability as never)} value="" />
          <Row label={t('token.category')} value={shortHex(holding.category)} mono />
          <Row label={t('nft.commitment')} value={holding.commitment ? shortHex(holding.commitment) : t('nft.noCommitment')} mono />
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 600 }}>
          {addresses.bch && (
            <a href={explorerAddressUrl(holding.network, addresses.bch)} target="_blank" rel="noreferrer" style={{ color: MX.primary, textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <MI.ext size={12} /> {t('home.viewOnExplorer')}
            </a>
          )}
          <button type="button" onClick={() => { update({ hiddenTokens: [...settings.hiddenTokens, holding.id] }); onClose(); }} style={{ background: 'none', border: 'none', color: MX.fgMute, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <MI.eyeOff size={12} /> {t('home.hideToken')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: MX.fgMute }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: mono ? 'monospace' : undefined, overflowWrap: 'anywhere', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ─── HomeScreen ────────────────────────────────────────────────────────────────
export function HomeScreen({ onNavigate }: HomeScreenProps) {
  const wdk = useWDK();
  const { assets, nftGroups, positions, loading, refreshing, refresh, stale, totalUsd, prices } = usePortfolio();
  const { settings, update, t } = useSettings();
  const [filter, setFilter] = useState<Family | 'all'>('all');
  const [showEmpty, setShowEmpty] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);
  const [openNft, setOpenNft] = useState<NftHolding | null>(null);

  const visiblePositions = useMemo(() => positions.filter(p => !settings.hiddenTokens.includes(p.id)), [positions, settings.hiddenTokens]);
  const visibleGroups = useMemo(
    () => nftGroups.map(g => ({ ...g, items: g.items.filter(n => !settings.hiddenTokens.includes(n.id)) })).filter(g => g.items.length),
    [nftGroups, settings.hiddenTokens],
  );

  const hide = settings.hideBalances;
  const testnet = wdk.networkMode === 'testnet';
  const backedUp = isBackedUp(settings, wdk.evmAddress);

  const visible = useMemo(() => assets.filter(a =>
    !settings.hiddenTokens.includes(a.id) && (filter === 'all' || a.network.family === filter),
  ), [assets, settings.hiddenTokens, filter]);
  const held = visible.filter(a => a.balance > 0n);
  const empty = visible.filter(a => a.balance === 0n);
  const anyFunds = assets.some(a => a.balance > 0n);

  // Testnet has no fiat total, so the headline is the BCH balance, the wallet's home chain.
  const bch = assets.find(a => a.network.family === 'bch' && a.kind === 'native');
  const perFamily = (f: Family) => {
    const rows = assets.filter(a => a.network.family === f);
    if (!rows.length) return undefined;
    if (!testnet) return formatUsd(rows.reduce((s, a) => s + (valueOf(a, prices) ?? 0), 0));
    const main = rows.find(a => a.kind === 'native');
    return main ? formatAmount(main.balance, main.decimals, 4) : undefined;
  };

  return (
    <MPopup>
      <MTopBar />

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '12px 12px 6px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', zIndex: 1 }}>
          {!backedUp && (
            <Banner tone="warn" testId="backup-banner" action={
              <button type="button" onClick={() => onNavigate('settings', 'recovery')} style={{ background: 'none', border: 'none', color: MX.amber, fontWeight: 800, fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0 }}>
                {t('home.backupNow')}
              </button>
            }>{t('home.backupWarning')}</Banner>
          )}

          {/* Portfolio card */}
          <Bento
            glow glassy
            mesh="radial-gradient(ellipse 280px 160px at 20% 20%, var(--mx-mesh-a), transparent 60%), radial-gradient(ellipse 220px 140px at 100% 100%, var(--mx-mesh-b), transparent 60%)"
            style={{ padding: 16, borderRadius: 22 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MX.fgMute, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {testnet ? t('home.testnetBalance') : t('home.portfolio')}
              </div>
              <div style={{ flex: 1 }} />
              <IconBtn label={hide ? t('home.showBalances') : t('home.hideBalances')} size={24} onClick={() => update({ hideBalances: !hide })} testId="toggle-hide">
                {hide ? <MI.eyeOff size={12} /> : <MI.eye size={12} />}
              </IconBtn>
              <IconBtn label={t('common.refresh')} size={24} onClick={() => refresh()} testId="refresh">
                <span style={{ display: 'flex', animation: refreshing ? 'mxspin 0.8s linear infinite' : undefined }}><MI.refresh size={12} /></span>
              </IconBtn>
            </div>

            <div data-testid="portfolio-total" style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 40 }}>
              {loading ? <Skeleton w={150} h={30} r={8} /> : hide ? (
                <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em', color: MX.fgFaint }}>••••••</span>
              ) : testnet ? (
                <>
                  <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                    {bch ? formatAmount(bch.balance, bch.decimals, 6) : '0'}
                  </span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: MX.fgMute }}>tBCH</span>
                </>
              ) : (
                <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{formatUsd(totalUsd ?? 0)}</span>
              )}
            </div>

            {/* per-chain breakdown */}
            <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
              {FAMILIES.map(f => {
                const palette: ChainKey = FAMILY_PALETTE[f];
                const on = filter === f;
                return (
                  <button
                    key={f} type="button" aria-pressed={on} data-testid={`family-${f}`}
                    onClick={() => setFilter(on ? 'all' : f)}
                    style={{
                      flex: 1, padding: '6px 2px', minWidth: 0, cursor: 'pointer',
                      background: on ? CHAIN[palette].bg : MX.surface,
                      border: `1px solid ${on ? CHAIN[palette].border : MX.border}`,
                      borderRadius: 10, textAlign: 'center', color: CHAIN[palette].color,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center' }}><ChainGlyph chain={palette} size={14} /></div>
                    <div style={{ marginTop: 3, fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hide ? MASK : perFamily(f) ?? '—'}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* quick actions */}
            <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
              <QA icon={<MI.send size={14} />} label={t('action.send')} onClick={() => onNavigate('send')} testId="qa-send" />
              <QA icon={<MI.receive size={14} />} label={t('action.receive')} onClick={() => onNavigate('receive')} testId="qa-receive" />
              <QA icon={<MI.swap size={14} />} label={t('action.swap')} onClick={() => onNavigate('swap')} testId="qa-swap" />
            </div>
          </Bento>

          {testnet && !anyFunds && !loading && (
            <Banner tone="info" icon={<MI.faucet size={14} />} testId="faucet-banner">
              {t('home.faucetHint')}{' '}
              {networksFor('testnet').filter(n => n.faucet).filter((n, i, all) => all.findIndex(x => x.faucet === n.faucet) === i).map(n => (
                <a key={n.key} href={n.faucet} target="_blank" rel="noreferrer" style={{ color: MX.primary, fontWeight: 700, textDecoration: 'none', marginRight: 8, whiteSpace: 'nowrap' }}>
                  {n.family === 'evm' ? 'USDC' : n.native.symbol} ↗
                </a>
              ))}
            </Banner>
          )}
          {stale.length > 0 && <Banner tone="warn" testId="stale-banner">{t('home.stale', { chains: stale.map(f => CHAIN[FAMILY_PALETTE[f]].name).join(', ') })}</Banner>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 0' }}>
            <h2 style={{ fontSize: 12.5, fontWeight: 800 }}>{t('home.tokens')}</h2>
            {filter !== 'all' && (
              <button type="button" onClick={() => setFilter('all')} style={{ background: MX.surface2, border: 'none', borderRadius: 99, padding: '2px 8px', color: MX.fgMute, fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                {CHAIN[FAMILY_PALETTE[filter]].name} <MI.cross size={9} />
              </button>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: MX.fgFaint, fontWeight: 600 }}>{t('home.assetCount', { count: held.length })}</span>
          </div>
        </div>

        {/* token list */}
        <div data-testid="token-list" style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
          {loading && [0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: `1px solid ${MX.border}`, borderRadius: 13 }}>
              <Skeleton w={34} h={34} r={99} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton w={70} /><Skeleton w={110} h={9} /></div>
              <Skeleton w={54} />
            </div>
          ))}

          {!loading && held.map(a => <TokenRow key={a.id} asset={a} hide={hide} onClick={() => setOpen(a)} />)}

          {!loading && held.length === 0 && (
            <EmptyState
              icon={<MI.wallet size={28} />}
              title={t('home.emptyTitle')}
              body={testnet ? t('home.emptyTestnet') : t('home.emptyMainnet')}
              action={<MSecondary h={38} style={{ width: 'auto', padding: '0 16px', marginTop: 4 }} icon={<MI.receive size={13} />} onClick={() => onNavigate('receive')}>{t('action.receive')}</MSecondary>}
            />
          )}

          {!loading && empty.length > 0 && (
            <>
              <button type="button" onClick={() => setShowEmpty(v => !v)} data-testid="toggle-empty" style={{ background: 'none', border: 'none', color: MX.fgMute, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '8px 2px 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-flex', transition: 'transform 0.2s', transform: showEmpty ? 'rotate(180deg)' : 'none' }}><MI.chevD size={11} /></span>
                {showEmpty ? t('home.hideEmpty') : t('home.showEmpty', { count: empty.length })}
              </button>
              {showEmpty && empty.map(a => <TokenRow key={a.id} asset={a} hide={hide} onClick={() => setOpen(a)} />)}
            </>
          )}

          {!loading && visiblePositions.length > 0 && (
            <>
              <h2 style={{ fontSize: 12.5, fontWeight: 800, margin: '12px 2px 2px' }}>{t('nft.positions')}</h2>
              {visiblePositions.map(p => <PositionRow key={p.id} holding={p} onClick={() => setOpenNft(p)} />)}
            </>
          )}

          {!loading && visibleGroups.length > 0 && (
            <>
              <h2 style={{ fontSize: 12.5, fontWeight: 800, margin: '12px 2px 2px' }}>{t('nft.collectibles')}</h2>
              {visibleGroups.map(g => (
                <CollectibleRow key={g.category} group={g} onClick={() => setOpenNft(g.items.length === 1 ? g.items[0] : g.items[0])} />
              ))}
            </>
          )}
        </div>
      </div>

      <MBottomNav active="home" onNavigate={onNavigate} />
      {open && <AssetSheet asset={open} hide={hide} onClose={() => setOpen(null)} onNavigate={(s, id) => { setOpen(null); onNavigate(s, id); }} />}
      {openNft && <NftSheet holding={openNft} onClose={() => setOpenNft(null)} />}
    </MPopup>
  );
}

