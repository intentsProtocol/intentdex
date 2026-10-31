/**
 * Settings — preferences, network, wallet, security and support, with a second-level view for anything that
 * needs more than one row.
 *
 * The extension counterpart of frontend/src/components/wallet/settings/WalletSettingsTab.tsx: the same sections
 * and rows, plus what only an extension has (where the icon opens the wallet, connected sites, the services
 * this build talks to).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useWDK } from '@/context/WDKProvider';
import { usePortfolio } from '@/context/PortfolioProvider';
import { useSettings } from '@/context/SettingsProvider';
import {
  MX, MPopup, MI, MPrimary, MSecondary, MInput, Banner, Segmented, Switch, ChainGlyph, CHAIN, Spinner, TokenIcon, useCopy,
} from '@/design-system/primitives';
import { Chameleon } from '@/design-system/Chameleon';
import { MBottomNav, PageHeader, EmptyState, type Screen } from './shared';
import { PasswordFields } from './Onboarding';
import {
  AUCTION_DURATION, AUCTION_DURATION_PRESETS, AUTO_LOCK_MINUTES_OPTIONS, LANGUAGES, SLIPPAGE_BPS_PRESETS, formatAuctionDuration, isBackedUp,
  type Language, type Surface, type ThemePref,
} from '@/lib/settings';
import { FAMILIES, FAMILY_PALETTE, networksFor, networksOf } from '@/lib/chains';
import { APP_VERSION, CASHTOKEN_RELAYER_MAINNET_URL, CASHTOKEN_RELAYER_URL, CCTP_SWAP_SERVER_MAINNET_URL, CCTP_SWAP_SERVER_URL, DOCS_URL } from '@/lib/config';
import { disconnectAllSites, disconnectSite, readSites } from '@/lib/dapp';
import { clearActivity } from '@/lib/activity';
import { errorMessage, hostOf, shortAddr, timeAgo } from '@/lib/format';
import { SITES_KEY, type ConnectedSite } from '@/shared/messages';
import type { MessageKey } from '@/lib/i18n';

export type SettingsView = 'root' | 'trading' | 'networks' | 'addresses' | 'sites' | 'hidden' | 'recovery' | 'password' | 'services' | 'about' | 'remove';

interface Props {
  onNavigate: (s: Screen) => void;
  initialView?: SettingsView;
}

const VIEW_TITLE: Record<Exclude<SettingsView, 'root'>, MessageKey> = {
  trading: 'settings.trading', networks: 'settings.networks', addresses: 'settings.addresses', sites: 'settings.sites', hidden: 'settings.hidden',
  recovery: 'settings.recovery', password: 'settings.changePassword', services: 'settings.services', about: 'settings.about', remove: 'settings.remove',
};

// ─── primitives (ported from frontend settings/primitives.tsx) ────────────────
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ fontSize: 9.5, fontWeight: 700, color: MX.fgFaint, padding: '0 12px 6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</h2>
      <div style={{ background: MX.bg1, border: `1px solid ${MX.border}`, borderRadius: 15, overflow: 'hidden' }}>{children}</div>
    </section>
  );
}

function SettingsRow({ icon, label, description, value, valueTone, control, onClick, href, danger, testId }: {
  icon: ReactNode; label: string; description?: string; value?: string; valueTone?: 'warning'; control?: ReactNode;
  onClick?: () => void; href?: string; danger?: boolean; testId?: string;
}) {
  const body = (
    <>
      <span style={{ color: danger ? MX.red : MX.fgMute, display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: danger ? MX.red : MX.fg }}>{label}</span>
        {description && <span style={{ display: 'block', fontSize: 10.5, color: MX.fgFaint, marginTop: 1, lineHeight: 1.4 }}>{description}</span>}
      </span>
      {value && <span style={{ fontSize: 11, fontWeight: 600, color: valueTone === 'warning' ? MX.amber : MX.fgMute, whiteSpace: 'nowrap' }}>{value}</span>}
      {control}
      {(onClick || href) && !control && <span style={{ color: MX.fgFaint, display: 'flex' }}>{href ? <MI.ext size={12} /> : <MI.chevR size={13} />}</span>}
    </>
  );
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none',
    borderTop: `1px solid ${MX.border}`, marginTop: -1, color: MX.fg, textAlign: 'left', textDecoration: 'none', boxSizing: 'border-box',
  };
  if (href) return <a href={href} target="_blank" rel="noreferrer" data-testid={testId} className="mx-press" style={{ ...style, cursor: 'pointer' }}>{body}</a>;
  if (onClick) return <button type="button" onClick={onClick} data-testid={testId} className="mx-press" style={{ ...style, cursor: 'pointer' }}>{body}</button>;
  return <div data-testid={testId} style={style}>{body}</div>;
}

function SettingsSelect<T extends string | number>({ value, onChange, options, ariaLabel, testId }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string; testId?: string;
}) {
  return (
    <select
      aria-label={ariaLabel} data-testid={testId} value={String(value)}
      onChange={e => onChange(options.find(o => String(o.value) === e.target.value)!.value)}
      style={{ background: MX.bg2, color: MX.fg, border: `1px solid ${MX.border}`, borderRadius: 8, padding: '5px 8px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
    >
      {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

// ─── views ────────────────────────────────────────────────────────────────────
function TradingView() {
  const { settings, update, t } = useSettings();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SettingsSection title={t('settings.trading.slippage')}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Segmented ariaLabel={t('settings.trading.slippage')} value={settings.defaultSlippageBps} onChange={v => update({ defaultSlippageBps: v })} options={SLIPPAGE_BPS_PRESETS.map(b => ({ value: b, label: `${b / 100}%` }))} />
          <div style={{ fontSize: 10.5, color: MX.fgFaint, lineHeight: 1.45 }}>{t('settings.trading.slippageHint')}</div>
        </div>
      </SettingsSection>
      <SettingsSection title={t('settings.trading.auction')}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }} data-testid="auction-value">{formatAuctionDuration(settings.defaultAuctionDuration)}</span>
            <span style={{ fontSize: 10.5, color: MX.fgFaint }}>{formatAuctionDuration(AUCTION_DURATION.min)} – {formatAuctionDuration(AUCTION_DURATION.max)}</span>
          </div>
          <input
            type="range" aria-label={t('settings.trading.auction')} min={AUCTION_DURATION.min} max={AUCTION_DURATION.max} step={AUCTION_DURATION.step}
            value={settings.defaultAuctionDuration} onChange={e => update({ defaultAuctionDuration: Number(e.target.value) })}
            style={{ width: '100%', accentColor: 'hsl(161,100%,38%)' }}
          />
          <Segmented compact ariaLabel={t('settings.trading.auction')} value={settings.defaultAuctionDuration} onChange={v => update({ defaultAuctionDuration: v })} options={AUCTION_DURATION_PRESETS.map(s => ({ value: s, label: formatAuctionDuration(s) }))} />
          <div style={{ fontSize: 10.5, color: MX.fgFaint, lineHeight: 1.45 }}>{t('settings.trading.auctionHint')}</div>
        </div>
      </SettingsSection>
    </div>
  );
}

function NetworksView() {
  const wdk = useWDK();
  const { t } = useSettings();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Banner tone="info">{t('settings.networks.hint')}</Banner>
      {FAMILIES.map(f => (
        <SettingsSection key={f} title={CHAIN[FAMILY_PALETTE[f]].name}>
          {networksOf(wdk.networkMode, f).map(n => (
            <div key={n.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: `1px solid ${MX.border}`, marginTop: -1 }}>
              <TokenIcon symbol={n.short} logo={n.logo} palette={n.palette} size={24} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{n.name}</div>
                <div style={{ fontSize: 10, color: MX.fgFaint, fontFamily: MX.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.chainId ? `chain ${n.chainId} · ` : ''}{n.rpc ? hostOf(n.rpc).split('/')[0] : 'Electrum (mainnet-js)'}
                </div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: MX.fgMute }}>{n.native.symbol}</span>
            </div>
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}

function AddressesView() {
  const wdk = useWDK();
  const { t } = useSettings();
  const { addresses } = usePortfolio();
  const [copied, copy] = useCopy();
  const idx = wdk.accountStore.active;
  const rows: { chain: 'bch' | 'eth' | 'sol' | 'btc'; label: string; address: string | null; path: string }[] = [
    { chain: 'bch', label: t('receive.bchAddress'), address: addresses.bch, path: `m/44'/0'/0'/0/${idx}` },
    { chain: 'bch', label: t('receive.tokenAddress'), address: wdk.bchWallet?.tokenaddr ?? null, path: `m/44'/0'/0'/0/${idx}` },
    { chain: 'eth', label: t('settings.addresses.evm'), address: addresses.evm, path: `m/44'/60'/0'/0/${idx}` },
    { chain: 'sol', label: 'Solana', address: addresses.solana, path: `m/44'/501'/${idx}'/0'` },
    { chain: 'btc', label: 'Bitcoin (SegWit)', address: addresses.btc, path: `m/84'/${wdk.isMainnet ? 0 : 1}'/0'/0/${idx}` },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: MX.fgMute, lineHeight: 1.5, padding: '0 2px' }}>{t('settings.addresses.hint')}</div>
      {rows.filter(r => r.address).map(r => (
        <button key={r.label} type="button" onClick={() => copy(r.address!, r.label)} className="mx-press" data-testid={`address-${r.chain}`}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: MX.bg1, border: `1px solid ${copied === r.label ? MX.primaryBorder : MX.border}`, borderRadius: 13, color: MX.fg, cursor: 'pointer', textAlign: 'left' }}>
          <ChainGlyph chain={r.chain} size={24} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: CHAIN[r.chain].color }}>{r.label}</span>
            <span style={{ display: 'block', fontFamily: MX.mono, fontSize: 10.5, color: MX.fgMute, wordBreak: 'break-all', marginTop: 2 }}>{r.address}</span>
            <span style={{ display: 'block', fontFamily: MX.mono, fontSize: 9.5, color: MX.fgFaint, marginTop: 2 }}>{r.path}</span>
          </span>
          <span style={{ color: copied === r.label ? MX.primary : MX.fgFaint, display: 'flex' }}>{copied === r.label ? <MI.check size={13} /> : <MI.copy size={13} />}</span>
        </button>
      ))}
    </div>
  );
}

function SitesView() {
  const { t } = useSettings();
  const [sites, setSites] = useState<ConnectedSite[] | null>(null);
  useEffect(() => {
    const load = () => readSites().then(s => setSites(Object.values(s).sort((a, b) => b.lastUsedAt - a.lastUsedAt)));
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && changes[SITES_KEY]) load(); };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  if (!sites) return <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner size={20} color={MX.primary} /></div>;
  if (!sites.length) return <EmptyState icon={<MI.plug size={28} />} title={t('settings.sites.empty')} body={t('settings.sites.emptyBody')} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: MX.fgMute, lineHeight: 1.5, padding: '0 2px' }}>{t('settings.sites.hint')}</div>
      {sites.map(s => (
        <div key={s.origin} data-testid="site-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: MX.bg1, border: `1px solid ${MX.border}`, borderRadius: 13 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: MX.bg2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: MX.fgMute, overflow: 'hidden', flexShrink: 0 }}>
            {s.icon ? <img src={s.icon} alt="" style={{ width: 18, height: 18 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : hostOf(s.origin).charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostOf(s.origin)}</div>
            <div style={{ fontSize: 10, color: MX.fgFaint }}>{t('settings.sites.lastUsed', { when: timeAgo(s.lastUsedAt) })}</div>
          </div>
          <button type="button" onClick={() => disconnectSite(s.origin)} data-testid="site-disconnect" style={{ padding: '5px 10px', background: MX.redDim, border: `1px solid ${MX.redBorder}`, borderRadius: 8, color: MX.red, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
            {t('settings.sites.disconnect')}
          </button>
        </div>
      ))}
      {sites.length > 1 && <MSecondary h={38} danger onClick={() => disconnectAllSites()}>{t('settings.sites.disconnectAll')}</MSecondary>}
    </div>
  );
}

function HiddenView() {
  const { settings, update, t } = useSettings();
  const { assets } = usePortfolio();
  if (!settings.hiddenTokens.length) return <EmptyState icon={<MI.eyeOff size={28} />} title={t('settings.hidden.empty')} body={t('settings.hidden.emptyBody')} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {settings.hiddenTokens.map(id => {
        const a = assets.find(x => x.id === id);
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: MX.bg1, border: `1px solid ${MX.border}`, borderRadius: 13 }}>
            {a && <TokenIcon symbol={a.symbol} logo={a.logo} networkLogo={a.network.logo} palette={a.network.palette} size={26} />}
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a ? `${a.symbol} · ${a.network.name}` : shortAddr(id.split(':')[1] ?? id, 8, 6)}
            </div>
            <button type="button" onClick={() => update({ hiddenTokens: settings.hiddenTokens.filter(x => x !== id) })} style={{ padding: '5px 10px', background: MX.primaryDim, border: `1px solid ${MX.primaryBorder}`, borderRadius: 8, color: MX.primary, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
              {t('settings.hidden.show')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** A password gate: the children render only after the wallet password was entered again. */
function PasswordGate({ children, prompt }: { children: ReactNode; prompt: string }) {
  const wdk = useWDK();
  const { t } = useSettings();
  const [password, setPassword] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (open) return <>{children}</>;
  const submit = async () => {
    if (!password) return;
    setBusy(true);
    const ok = await wdk.verifyPassword(password);
    setBusy(false);
    if (ok) setOpen(true); else setError(t('unlock.wrong'));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <Chameleon size={110} mood={error ? 'error' : 'shy'} />
      <div style={{ fontSize: 12, color: MX.fgMute, textAlign: 'center', lineHeight: 1.5 }}>{prompt}</div>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MInput type="password" placeholder={t('unlock.password')} value={password} onChange={v => { setPassword(v); setError(''); }} onEnter={submit} invalid={!!error} autoFocus testId="gate-password" />
        {error && <div role="alert" style={{ fontSize: 11.5, color: MX.red }}>{error}</div>}
        <MPrimary onClick={submit} disabled={!password} loading={busy} testId="gate-submit">{t('common.continue')}</MPrimary>
      </div>
    </div>
  );
}

function RecoveryView() {
  const wdk = useWDK();
  const { settings, update, t } = useSettings();
  const [copied, copy] = useCopy(2000);
  const [shown, setShown] = useState(false);
  const words = wdk.seedPhrase?.split(' ') ?? [];
  const id = wdk.evmAddress?.toLowerCase() ?? '';
  const backedUp = isBackedUp(settings, id);
  return (
    <PasswordGate prompt={t('settings.recovery.gate')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Banner tone="warn">{t('onboarding.phrase.warning')}</Banner>
        <div style={{ position: 'relative', padding: 12, background: MX.bg1, border: `1px solid ${MX.border}`, borderRadius: 15 }}>
          {!shown && (
            <button type="button" onClick={() => setShown(true)} data-testid="recovery-reveal" style={{ position: 'absolute', inset: 0, zIndex: 2, borderRadius: 15, border: 'none', background: MX.glassStrong, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', color: MX.fgMute, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
              <MI.eye size={20} /> {t('onboarding.phrase.reveal')}
            </button>
          )}
          <div data-testid="recovery-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, filter: shown ? 'none' : 'blur(6px)' }}>
            {words.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 8, background: MX.bg2, border: `1px solid ${MX.border}`, borderRadius: 9, fontFamily: MX.mono, fontSize: 11.5 }}>
                <span style={{ color: MX.fgFaint, fontSize: 9, minWidth: 12 }}>{i + 1}</span>
                <span>{shown ? w : '•••••'}</span>
              </div>
            ))}
          </div>
        </div>
        <MSecondary h={40} disabled={!shown} icon={copied ? <MI.check size={14} /> : <MI.copy size={14} />} onClick={() => wdk.seedPhrase && copy(wdk.seedPhrase)}>
          {copied ? t('common.copied') : t('onboarding.phrase.copy')}
        </MSecondary>
        {backedUp
          ? <Banner tone="success">{t('settings.recovery.backedUp')}</Banner>
          : <MPrimary disabled={!shown} onClick={() => update({ backedUpWallets: [...settings.backedUpWallets, id] })} testId="recovery-confirm">{t('settings.recovery.confirm')}</MPrimary>}
      </div>
    </PasswordGate>
  );
}

function ChangePasswordView({ onDone }: { onDone: () => void }) {
  const wdk = useWDK();
  const { t } = useSettings();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const valid = !!current && next.length >= 8 && next === confirm && next !== current;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (await wdk.changePassword(current, next)) setDone(true);
      else setError(t('settings.password.wrongCurrent'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <Chameleon size={120} mood="happy" />
        <Banner tone="success" testId="password-changed">{t('settings.password.changed')}</Banner>
        <MPrimary onClick={onDone}>{t('common.done')}</MPrimary>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <MInput type="password" placeholder={t('settings.password.current')} value={current} onChange={v => { setCurrent(v); setError(''); }} autoFocus testId="current-password" />
      <PasswordFields password={next} confirm={confirm} onPassword={setNext} onConfirm={setConfirm} onSubmit={() => valid && submit()} autoFocus={false} />
      {next && next === current && <div style={{ fontSize: 11.5, color: MX.amber }}>{t('settings.password.same')}</div>}
      {error && <Banner tone="error">{error}</Banner>}
      <Banner tone="info">{t('settings.password.note')}</Banner>
      <MPrimary onClick={submit} disabled={!valid} loading={busy} testId="change-password-submit">{t('settings.changePassword')}</MPrimary>
    </div>
  );
}

type Health = 'checking' | 'up' | 'down';
function ServicesView() {
  const wdk = useWDK();
  const { t } = useSettings();
  const services = [
    { name: t('settings.services.swap'), url: wdk.isMainnet ? CCTP_SWAP_SERVER_MAINNET_URL : CCTP_SWAP_SERVER_URL, probe: '/config', what: t('settings.services.swapWhat') },
    { name: t('settings.services.relayer'), url: wdk.isMainnet ? CASHTOKEN_RELAYER_MAINNET_URL : CASHTOKEN_RELAYER_URL, probe: '/health', what: t('settings.services.relayerWhat') },
  ];
  const [health, setHealth] = useState<Record<string, Health>>({});
  const check = () => {
    for (const s of services) {
      if (!s.url) continue;
      setHealth(h => ({ ...h, [s.url]: 'checking' }));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      fetch(`${s.url}${s.probe}`, { signal: ctrl.signal })
        .then(r => setHealth(h => ({ ...h, [s.url]: r.ok ? 'up' : 'down' })))
        .catch(() => setHealth(h => ({ ...h, [s.url]: 'down' })))
        .finally(() => clearTimeout(timer));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(check, [wdk.isMainnet]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: MX.fgMute, lineHeight: 1.5, padding: '0 2px' }}>{t('settings.services.hint')}</div>
      {services.map(s => {
        const st = s.url ? health[s.url] ?? 'checking' : 'down';
        return (
          <div key={s.name} data-testid="service-row" data-state={st} style={{ padding: '10px 12px', background: MX.bg1, border: `1px solid ${MX.border}`, borderRadius: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{s.name}</span>
              {st === 'checking' ? <Spinner size={11} /> : (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: st === 'up' ? MX.primary : MX.red, background: st === 'up' ? MX.primaryDim : MX.redDim }}>
                  {st === 'up' ? t('settings.services.up') : t('settings.services.down')}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10.5, color: MX.fgFaint, marginTop: 2 }}>{s.what}</div>
            <div style={{ fontFamily: MX.mono, fontSize: 10, color: MX.fgMute, marginTop: 4, wordBreak: 'break-all' }}>{s.url || t('settings.services.notConfigured')}</div>
          </div>
        );
      })}
      <MSecondary h={38} icon={<MI.refresh size={13} />} onClick={check}>{t('settings.services.recheck')}</MSecondary>
    </div>
  );
}

function AboutView() {
  const { t } = useSettings();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
      <Chameleon size={130} />
      <div>
        <div style={{ fontSize: 17, fontWeight: 900 }}>{t('app.name')}</div>
        <div style={{ fontSize: 11.5, color: MX.fgMute, fontFamily: MX.mono, marginTop: 2 }} data-testid="about-version">v{APP_VERSION} · alpha</div>
      </div>
      <div style={{ fontSize: 12, color: MX.fgMute, lineHeight: 1.55 }}>{t('settings.about.body')}</div>
      <Banner tone="warn">{t('settings.about.alpha')}</Banner>
      <div style={{ width: '100%' }}>
        <SettingsSection title={t('settings.support')}>
          <SettingsRow icon={<MI.book size={15} />} label={t('settings.docs')} href={DOCS_URL} />
          <SettingsRow icon={<MI.shield size={15} />} label={t('settings.about.wdk')} href="https://docs.wdk.tether.io" />
        </SettingsSection>
      </div>
    </div>
  );
}

function RemoveView() {
  const wdk = useWDK();
  const { settings, t } = useSettings();
  const [text, setText] = useState('');
  const backedUp = isBackedUp(settings, wdk.evmAddress);
  return (
    <PasswordGate prompt={t('settings.remove.gate')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Banner tone="error">{t('settings.remove.warning')}</Banner>
        {!backedUp && <Banner tone="warn">{t('settings.remove.notBackedUp')}</Banner>}
        <MInput placeholder={t('settings.remove.placeholder')} value={text} onChange={setText} testId="remove-confirm" />
        <MPrimary danger disabled={text.trim().toUpperCase() !== 'REMOVE'} onClick={async () => { await clearActivity(); await disconnectAllSites(); await wdk.resetWallet(); }} testId="remove-wallet">
          {t('settings.remove')}
        </MPrimary>
      </div>
    </PasswordGate>
  );
}

// ─── SettingsScreen ───────────────────────────────────────────────────────────
export function SettingsScreen({ onNavigate, initialView = 'root' }: Props) {
  const wdk = useWDK();
  const { settings, update, t } = useSettings();
  const [view, setView] = useState<SettingsView>(initialView);
  const [siteCount, setSiteCount] = useState(0);
  const hasPanel = typeof chrome !== 'undefined' && !!chrome.sidePanel;

  useEffect(() => { readSites().then(s => setSiteCount(Object.keys(s).length)); }, [view]);

  if (view !== 'root') {
    return (
      <MPopup>
        <PageHeader title={t(VIEW_TITLE[view])} onBack={() => setView('root')} />
        <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column' }} data-testid={`settings-${view}`}>
          {view === 'trading' && <TradingView />}
          {view === 'networks' && <NetworksView />}
          {view === 'addresses' && <AddressesView />}
          {view === 'sites' && <SitesView />}
          {view === 'hidden' && <HiddenView />}
          {view === 'recovery' && <RecoveryView />}
          {view === 'password' && <ChangePasswordView onDone={() => setView('root')} />}
          {view === 'services' && <ServicesView />}
          {view === 'about' && <AboutView />}
          {view === 'remove' && <RemoveView />}
        </div>
      </MPopup>
    );
  }

  const backedUp = isBackedUp(settings, wdk.evmAddress);
  const autoLockLabel = (m: number) => (m < 60 ? t('settings.minutes', { n: m }) : t('settings.hours', { n: m / 60 }));

  return (
    <MPopup>
      <PageHeader title={t('settings.title')} />

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 6px', display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="settings-root">
        <SettingsSection title={t('settings.preferences')}>
          <SettingsRow icon={<MI.contrast size={15} />} label={t('settings.theme')} control={
            <Segmented<ThemePref> compact ariaLabel={t('settings.theme')} value={settings.theme} onChange={v => update({ theme: v })} options={[
              { value: 'system', label: t('settings.theme.auto') },
              { value: 'light', label: t('settings.theme.light'), icon: <MI.sun size={10} /> },
              { value: 'dark', label: t('settings.theme.dark'), icon: <MI.moon size={10} /> },
            ]} />
          } />
          <SettingsRow icon={<MI.languages size={15} />} label={t('settings.language')} control={
            <SettingsSelect<Language> ariaLabel={t('settings.language')} testId="language-select" value={settings.language} onChange={v => update({ language: v })} options={LANGUAGES} />
          } />
          {hasPanel && (
            <SettingsRow icon={<MI.panel size={15} />} label={t('settings.surface')} description={t('settings.surface.hint')} control={
              <Segmented<Surface> compact ariaLabel={t('settings.surface')} value={settings.surface} onChange={v => update({ surface: v })} options={[
                { value: 'panel', label: t('settings.surface.panel') }, { value: 'popup', label: t('settings.surface.popup') },
              ]} />
            } />
          )}
          <SettingsRow icon={<MI.eyeOff size={15} />} label={t('home.hideBalances')} control={
            <Switch ariaLabel={t('home.hideBalances')} checked={settings.hideBalances} onChange={v => update({ hideBalances: v })} testId="hide-balances" />
          } />
          <SettingsRow icon={<MI.sliders size={15} />} label={t('settings.trading')} value={`${formatAuctionDuration(settings.defaultAuctionDuration)} · ${settings.defaultSlippageBps / 100}%`} onClick={() => setView('trading')} testId="open-trading" />
        </SettingsSection>

        <SettingsSection title={t('settings.network')}>
          <SettingsRow icon={<MI.globe size={15} />} label={t('settings.mode')} description={wdk.isMainnet ? t('network.mainnetSub') : t('network.testnetSub')} control={
            <Segmented compact ariaLabel={t('settings.mode')} value={wdk.networkMode} accent={wdk.isMainnet ? MX.primary : MX.amber}
              onChange={m => wdk.setNetworkMode(m)} options={[{ value: 'testnet' as const, label: t('network.testnet') }, { value: 'mainnet' as const, label: t('network.mainnet') }]} />
          } />
          <SettingsRow icon={<MI.sliders size={15} />} label={t('settings.networks')} value={String(networksFor(wdk.networkMode).length)} onClick={() => setView('networks')} testId="open-networks" />
          <SettingsRow icon={<MI.activity size={15} />} label={t('settings.services')} onClick={() => setView('services')} testId="open-services" />
        </SettingsSection>

        <SettingsSection title={t('settings.wallet')}>
          <SettingsRow icon={<MI.wallet size={15} />} label={t('settings.addresses')} onClick={() => setView('addresses')} testId="open-addresses" />
          <SettingsRow icon={<MI.plug size={15} />} label={t('settings.sites')} value={siteCount ? String(siteCount) : undefined} onClick={() => setView('sites')} testId="open-sites" />
          <SettingsRow icon={<MI.eyeOff size={15} />} label={t('settings.hidden')} value={settings.hiddenTokens.length ? String(settings.hiddenTokens.length) : undefined} onClick={() => setView('hidden')} />
        </SettingsSection>

        <SettingsSection title={t('settings.security')}>
          <SettingsRow icon={<MI.timer size={15} />} label={t('settings.autoLock')} description={t('settings.autoLock.hint')} control={
            <SettingsSelect ariaLabel={t('settings.autoLock')} testId="autolock-select" value={settings.autoLockMinutes} onChange={v => update({ autoLockMinutes: v })} options={AUTO_LOCK_MINUTES_OPTIONS.map(m => ({ value: m, label: autoLockLabel(m) }))} />
          } />
          <SettingsRow icon={<MI.scroll size={15} />} label={t('settings.recovery')} value={backedUp ? undefined : t('settings.recovery.notBackedUp')} valueTone="warning" onClick={() => setView('recovery')} testId="open-recovery" />
          <SettingsRow icon={<MI.key size={15} />} label={t('settings.changePassword')} onClick={() => setView('password')} testId="open-password" />
        </SettingsSection>

        <SettingsSection title={t('settings.support')}>
          <SettingsRow icon={<MI.book size={15} />} label={t('settings.docs')} href={DOCS_URL} />
          <SettingsRow icon={<MI.info size={15} />} label={t('settings.about')} value={`v${APP_VERSION}`} onClick={() => setView('about')} testId="open-about" />
        </SettingsSection>

        <SettingsSection title={t('settings.danger')}>
          <SettingsRow danger icon={<MI.trash size={15} />} label={t('settings.remove')} description={t('settings.remove.hint')} onClick={() => setView('remove')} testId="open-remove" />
        </SettingsSection>

        <MSecondary icon={<MI.lock size={13} />} onClick={() => wdk.lock()} testId="settings-lock">{t('settings.lock')}</MSecondary>
        <div style={{ height: 4 }} />
      </div>

      <MBottomNav active="settings" onNavigate={onNavigate} />
    </MPopup>
  );
}
