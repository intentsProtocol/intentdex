/**
 * Shared navigation components used across wallet screens.
 * Ported from wallet-extension-bundle/morphic-wallet-main.jsx + prototype-account-switcher.jsx
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MX, glass, type ChainKey, MI, ChainStack, ChainGlyph, CHAIN, LiveDot, Sheet, IconBtn, MPrimary, MSecondary, Banner, useCopy,
} from '@/design-system/primitives';
import { useWDK } from '@/context/WDKProvider';
import { useT } from '@/context/SettingsProvider';
import { getLabel, getGrad, type AccountStore } from '@/lib/account-store';
import { shortAddr } from '@/lib/format';
import type { NetworkMode } from '@/lib/chains';

export type Screen = 'home' | 'send' | 'receive' | 'swap' | 'activity' | 'settings';
export type NavTab = 'home' | 'swap' | 'activity' | 'settings';

// ─── Avatar ───────────────────────────────────────────────────────────────────
interface AvatarProps { name: string; grad: [string, string]; size?: number; }
export function Avatar({ name, grad, size = 28 }: AvatarProps) {
  const initial = (name || '?').slice(0, 1).toUpperCase();
  return (
    <div aria-hidden style={{
      width: size, height: size, borderRadius: 99,
      background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * 0.42,
      textShadow: '0 1px 2px rgba(0,0,0,0.3)',
      boxShadow: `0 0 0 1px ${MX.bg0}, 0 4px 12px -4px ${grad[0]}66`,
      flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}

// ─── AccountTrigger ───────────────────────────────────────────────────────────
interface AccountTriggerProps {
  name: string;
  grad: [string, string];
  evmAddress?: string | null;
  open: boolean;
  onClick: () => void;
}
function AccountTrigger({ name, grad, evmAddress, open, onClick }: AccountTriggerProps) {
  return (
    <button
      type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={open} data-testid="account-trigger"
      style={{
        display: 'flex', alignItems: 'center', gap: 7, minWidth: 0,
        padding: '4px 9px 4px 4px',
        background: open ? MX.primaryDim : MX.surface,
        border: `1px solid ${open ? MX.primaryBorder : MX.borderStrong}`,
        borderRadius: 99, cursor: 'pointer',
        transition: 'all 0.18s ease',
        boxShadow: open ? `0 0 0 3px ${MX.primaryDim}` : 'none',
      }}
    >
      <Avatar name={name} grad={grad} size={24} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: MX.fg, lineHeight: 1.1, letterSpacing: '-0.01em', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 9.5, color: MX.fgMute, fontFamily: MX.mono, marginTop: 2, lineHeight: 1 }}>
          {shortAddr(evmAddress ?? undefined)}
        </span>
      </div>
      <div style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: open ? MX.primary : MX.fgMute, display: 'flex' }}>
        <MI.chevD size={12} />
      </div>
    </button>
  );
}

// ─── AccountRow ───────────────────────────────────────────────────────────────
interface AccountRowProps {
  id: number;
  name: string;
  grad: [string, string];
  derivation: string;
  addresses: { eth?: string; bch?: string; sol?: string; btc?: string };
  active: boolean;
  expanded: boolean;
  copiedKey: string | null;
  onSelect: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onToggleExpand: (id: number) => void;
  onCopy: (addr: string, key: string) => void;
}
function AccountRow({ id, name, grad, derivation, addresses, active, expanded, copiedKey, onSelect, onRename, onToggleExpand, onCopy }: AccountRowProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = useCallback(() => {
    const next = draft.trim().slice(0, 24) || name;
    onRename(id, next);
    setDraft(next);
    setEditing(false);
  }, [draft, id, name, onRename]);

  const chains: { key: ChainKey; addr?: string }[] = [
    { key: 'bch', addr: addresses.bch },
    { key: 'eth', addr: addresses.eth },
    { key: 'sol', addr: addresses.sol },
    { key: 'btc', addr: addresses.btc },
  ];

  return (
    <div data-testid={`account-row-${id}`} style={{
      background: active ? MX.primaryDim : MX.surface,
      border: `1px solid ${active ? MX.primaryBorder : MX.border}`,
      borderRadius: 14, overflow: 'hidden', transition: 'all 0.18s ease',
    }}>
      <div
        role="button" tabIndex={0}
        onClick={() => !editing && onSelect(id)}
        onKeyDown={e => { if (!editing && (e.key === 'Enter' || e.key === ' ')) onSelect(id); }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px', cursor: editing ? 'default' : 'pointer' }}
      >
        <Avatar name={name} grad={grad} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                maxLength={24}
                aria-label={t('accounts.rename')}
                onClick={e => e.stopPropagation()}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') { setDraft(name); setEditing(false); }
                }}
                style={{
                  background: MX.bg2, border: `1px solid ${MX.primaryBorder}`,
                  borderRadius: 6, color: MX.fg, fontSize: 12.5, fontWeight: 700,
                  padding: '2px 6px', outline: 'none', maxWidth: 140, fontFamily: 'inherit',
                }}
              />
            ) : (
              <>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: active ? MX.primary : MX.fg, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </span>
                <button
                  type="button" aria-label={t('accounts.rename')} title={t('accounts.rename')}
                  onClick={e => { e.stopPropagation(); setEditing(true); }}
                  style={{ width: 20, height: 20, borderRadius: 5, border: 'none', background: 'transparent', color: MX.fgFaint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <MI.pencil size={11} />
                </button>
              </>
            )}
          </div>
          <div style={{ marginTop: 3, fontSize: 10, color: MX.fgFaint, fontFamily: MX.mono }}>
            {derivation}
          </div>
        </div>
        <button
          type="button" aria-expanded={expanded}
          onClick={e => { e.stopPropagation(); onToggleExpand(id); }}
          style={{ padding: '4px 2px', background: 'transparent', border: 'none', cursor: 'pointer', color: MX.fgMute, fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          {expanded ? t('accounts.hide') : t('accounts.addresses')}
          <span style={{ display: 'inline-flex', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
            <MI.chevD size={10} />
          </span>
        </button>
        {active && (
          <div aria-label={t('accounts.active')} style={{ width: 18, height: 18, borderRadius: 99, background: 'hsl(161,100%,41%)', color: '#03130a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <MI.check size={11} />
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '0 11px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {chains.map(({ key, addr }) => {
            const c = CHAIN[key];
            const ck = `${id}-${key}`;
            const copied = copiedKey === ck;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 8 }}>
                <ChainGlyph chain={key} size={15} />
                <span style={{ fontSize: 9.5, fontWeight: 700, color: c.color, letterSpacing: '0.04em', width: 26 }}>{c.short}</span>
                <span style={{ flex: 1, fontFamily: MX.mono, fontSize: 10, color: MX.fgMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {addr ? shortAddr(addr, 8, 6) : t('accounts.switchToSee')}
                </span>
                {addr && (
                  <button
                    type="button" aria-label={t('common.copy')}
                    onClick={e => { e.stopPropagation(); onCopy(addr, ck); }}
                    style={{ width: 22, height: 22, borderRadius: 5, padding: 0, background: copied ? MX.primaryDim : 'transparent', border: 'none', color: copied ? MX.primary : MX.fgFaint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copied ? <MI.check size={11} /> : <MI.copy size={11} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── AccountSheet ─────────────────────────────────────────────────────────────
interface AccountSheetProps {
  accountStore: AccountStore;
  activeIndex: number;
  busy: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  onRename: (index: number, label: string) => void;
  onAdd: () => void;
}
function AccountSheet({ accountStore, activeIndex, busy, onSelect, onClose, onRename, onAdd }: AccountSheetProps) {
  const t = useT();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedKey, copy] = useCopy(1200);

  const accounts = accountStore.indices.map(idx => ({
    id: idx,
    name: getLabel(accountStore, idx),
    grad: getGrad(accountStore, idx),
    derivation: `m/44'/…/0/${idx}`,
    addresses: accountStore.addressCache?.[String(idx)] ?? {},
  }));

  return (
    <Sheet
      from="top" onClose={onClose} testId="account-sheet"
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('accounts.title')}
          <span style={{ fontSize: 9, padding: '2px 6px', background: MX.primaryDim, color: MX.primary, border: `1px solid ${MX.primaryBorder}`, borderRadius: 5, fontWeight: 700 }}>
            {accounts.length}
          </span>
        </span>
      }
      footer={
        <MSecondary h={40} loading={busy} icon={<MI.plus size={13} />} onClick={onAdd} testId="add-account"
          style={{ background: MX.primaryDim, color: MX.primary, borderColor: MX.primaryBorder }}>
          {t('accounts.create')}
        </MSecondary>
      }
    >
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 10.5, color: MX.fgFaint, lineHeight: 1.45, padding: '0 2px 2px' }}>{t('accounts.hint')}</div>
        {accounts.map(acc => (
          <AccountRow
            key={acc.id}
            {...acc}
            active={acc.id === activeIndex}
            expanded={expandedId === acc.id}
            copiedKey={copiedKey}
            onSelect={onSelect}
            onRename={onRename}
            onToggleExpand={id => setExpandedId(prev => (prev === id ? null : id))}
            onCopy={copy}
          />
        ))}
      </div>
    </Sheet>
  );
}

// ─── Network pill + switch sheet ──────────────────────────────────────────────
export function NetworkPill({ mode, onClick }: { mode: NetworkMode; onClick?: () => void }) {
  const t = useT();
  const main = mode === 'mainnet';
  const color = main ? MX.primary : MX.amber;
  return (
    <button
      type="button" onClick={onClick} data-testid="network-pill" aria-label={t('network.switch')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px',
        background: main ? MX.primaryDim : MX.amberDim, border: `1px solid ${main ? MX.primaryBorder : MX.amberBorder}`,
        borderRadius: 99, color, fontSize: 10.5, fontWeight: 700, cursor: onClick ? 'pointer' : 'default', flexShrink: 0,
      }}
    >
      <LiveDot size={6} color={color} />
      {main ? t('network.mainnet') : t('network.testnet')}
    </button>
  );
}

function NetworkSheet({ mode, onPick, onClose }: { mode: NetworkMode; onPick: (m: NetworkMode) => void; onClose: () => void }) {
  const t = useT();
  const [confirmMain, setConfirmMain] = useState(false);
  const option = (m: NetworkMode, title: string, sub: string) => {
    const on = m === mode;
    return (
      <button
        type="button" data-testid={`network-${m}`}
        onClick={() => { if (on) return onClose(); if (m === 'mainnet') return setConfirmMain(true); onPick(m); }}
        className="mx-press"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', textAlign: 'left', cursor: 'pointer',
          background: on ? MX.primaryDim : MX.surface, border: `1px solid ${on ? MX.primaryBorder : MX.border}`, borderRadius: 13, color: MX.fg,
        }}
      >
        <ChainStack chains={['bch', 'eth', 'sol', 'btc']} size={14} overlap={5} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 10.5, color: MX.fgMute, marginTop: 1 }}>{sub}</div>
        </div>
        {on && <MI.check size={14} stroke={MX.primary} />}
      </button>
    );
  };
  return (
    <Sheet title={t('network.title')} onClose={onClose} testId="network-sheet">
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {confirmMain ? (
          <>
            <Banner tone="warn">{t('network.mainnetWarning')}</Banner>
            <div style={{ display: 'flex', gap: 8 }}>
              <MSecondary h={40} onClick={() => setConfirmMain(false)}>{t('common.cancel')}</MSecondary>
              <MPrimary h={40} onClick={() => onPick('mainnet')} testId="confirm-mainnet">{t('network.useMainnet')}</MPrimary>
            </div>
          </>
        ) : (
          <>
            {option('testnet', t('network.testnet'), t('network.testnetSub'))}
            {option('mainnet', t('network.mainnet'), t('network.mainnetSub'))}
            <div style={{ fontSize: 10.5, color: MX.fgFaint, lineHeight: 1.45, padding: '2px 2px 0' }}>{t('network.hint')}</div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Top bar (home) ───────────────────────────────────────────────────────────
export function MTopBar() {
  const t = useT();
  const wdk = useWDK();
  const [sheet, setSheet] = useState<'accounts' | 'network' | null>(null);

  const activeIndex = wdk.accountStore.active;
  const activeName = getLabel(wdk.accountStore, activeIndex);
  const activeGrad = getGrad(wdk.accountStore, activeIndex);

  return (
    <>
      <div style={{
        position: 'relative', zIndex: 2,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
        ...glass(),
        borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderRadius: 0,
      }}>
        <AccountTrigger
          name={activeName}
          grad={activeGrad}
          evmAddress={wdk.evmAddress}
          open={sheet === 'accounts'}
          onClick={() => setSheet(s => (s === 'accounts' ? null : 'accounts'))}
        />
        <div style={{ flex: 1 }} />
        <NetworkPill mode={wdk.networkMode} onClick={() => setSheet('network')} />
        <IconBtn label={t('common.lock')} onClick={() => wdk.lock()} testId="lock-button"><MI.lock size={13} /></IconBtn>
      </div>

      {sheet === 'accounts' && (
        <AccountSheet
          accountStore={wdk.accountStore}
          activeIndex={activeIndex}
          busy={wdk.isLoading}
          onSelect={async idx => { if (idx !== activeIndex) await wdk.switchAccount(idx); setSheet(null); }}
          onClose={() => setSheet(null)}
          onRename={(idx, label) => wdk.renameAccount(idx, label)}
          onAdd={async () => { await wdk.addAccount(); setSheet(null); }}
        />
      )}
      {sheet === 'network' && (
        <NetworkSheet mode={wdk.networkMode} onClose={() => setSheet(null)} onPick={m => { wdk.setNetworkMode(m); setSheet(null); }} />
      )}
    </>
  );
}

// ─── Page header (sub-screens) ────────────────────────────────────────────────
export function PageHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  const t = useT();
  return (
    <div style={{
      position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      ...glass(), borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderRadius: 0,
    }}>
      {onBack && <IconBtn label={t('common.back')} onClick={onBack} testId="back"><MI.back size={14} /></IconBtn>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
        {sub && <div style={{ fontSize: 10.5, color: MX.fgMute, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ─── Bottom nav ───────────────────────────────────────────────────────────────
interface MBottomNavProps {
  active: NavTab;
  onNavigate: (s: NavTab) => void;
}

export function MBottomNav({ active, onNavigate }: MBottomNavProps) {
  const t = useT();
  const items: { id: NavTab; label: string; I: (p: { size?: number }) => React.ReactElement | null }[] = [
    { id: 'home',     label: t('nav.wallet'),   I: MI.wallet },
    { id: 'swap',     label: t('nav.swap'),     I: MI.swap },
    { id: 'activity', label: t('nav.activity'), I: MI.activity },
    { id: 'settings', label: t('nav.settings'), I: MI.settings },
  ];
  return (
    <nav aria-label="Main" style={{
      position: 'relative', zIndex: 2,
      display: 'flex',
      padding: '6px 8px 8px',
      gap: 2,
      ...glass(),
      borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0,
    }}>
      {items.map(({ id, label, I }) => {
        const on = id === active;
        return (
          <button
            key={id} type="button" data-testid={`nav-${id}`} aria-current={on ? 'page' : undefined}
            onClick={() => onNavigate(id)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 11,
              background: on ? MX.primaryDim : 'transparent',
              border: 'none', color: on ? MX.primary : MX.fgMute,
              cursor: 'pointer', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <I size={17} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ─── Quick action chip ────────────────────────────────────────────────────────
interface QAProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  testId?: string;
}

export function QA({ icon, label, onClick, testId }: QAProps) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} className="mx-press"
      style={{
        flex: 1, padding: '10px 0', minWidth: 0,
        borderRadius: 13,
        background: MX.surface,
        border: `1px solid ${MX.border}`,
        color: MX.fg, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        fontSize: 10.5, fontWeight: 600,
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 9,
        background: MX.primaryDim, color: MX.primary,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      {label}
    </button>
  );
}

// ─── small pieces reused by several screens ───────────────────────────────────
export function Label({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: MX.fgMute, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{children}</span>
      {right}
    </div>
  );
}

/** A "label ........ value" line for fee and detail blocks. */
export function DetailRow({ label, value, strong, tone }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: 'warn' | 'primary' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontSize: strong ? 12.5 : 11.5 }}>
      <span style={{ color: MX.fgMute, fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontWeight: strong ? 800 : 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere',
        color: tone === 'warn' ? MX.amber : tone === 'primary' ? MX.primary : MX.fg,
      }}>{value}</span>
    </div>
  );
}

export function DetailCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', background: MX.surface, border: `1px solid ${MX.border}`, borderRadius: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '36px 24px', textAlign: 'center' }}>
      <div style={{ color: MX.fgFaint, display: 'flex' }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      {body && <div style={{ fontSize: 11.5, color: MX.fgMute, lineHeight: 1.5, maxWidth: 260 }}>{body}</div>}
      {action}
    </div>
  );
}
