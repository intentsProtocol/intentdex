/**
 * Morphic Design System — primitives & tokens
 * Ported from wallet-extension-bundle/morphic-wallet-prims.jsx
 *
 * MX values are CSS variables defined in theme.css, so the same inline style works in light and dark.
 * Never write a literal colour in a screen: add a token here and a value for each theme there.
 */

import React, { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

// ─── design tokens ────────────────────────────────────────────────────────────
export const MX = {
  primary:       'var(--mx-primary)',
  primaryStrong: 'var(--mx-primary-strong)',
  onPrimary:     'var(--mx-on-primary)',
  primaryDim:    'var(--mx-primary-dim)',
  primaryBorder: 'var(--mx-primary-border)',
  primarySoft:   'var(--mx-primary-soft)',
  primaryGlow:   'var(--mx-primary-glow)',
  bg0: 'var(--mx-bg0)',
  bg1: 'var(--mx-bg1)',
  bg2: 'var(--mx-bg2)',
  bg3: 'var(--mx-bg3)',
  fg:      'var(--mx-fg)',
  fgMute:  'var(--mx-fg-mute)',
  fgFaint: 'var(--mx-fg-faint)',
  border:       'var(--mx-border)',
  borderStrong: 'var(--mx-border-strong)',
  surface:  'var(--mx-surface)',
  surface2: 'var(--mx-surface-2)',
  glass:       'var(--mx-glass)',
  glassStrong: 'var(--mx-glass-strong)',
  glassBorder: 'var(--mx-glass-border)',
  glassHi:     'var(--mx-glass-hi)',
  shadow: 'var(--mx-shadow)',
  scrim:  'var(--mx-scrim)',
  amber:       'var(--mx-amber)',
  amberDim:    'var(--mx-amber-dim)',
  amberBorder: 'var(--mx-amber-border)',
  red:       'var(--mx-red)',
  redDim:    'var(--mx-red-dim)',
  redBorder: 'var(--mx-red-border)',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/** Liquid glass: a translucent, blurred surface with a lit top edge. For bars, sheets and hero cards. */
export function glass(strong = false): React.CSSProperties {
  return {
    background: strong ? MX.glassStrong : MX.glass,
    backdropFilter: 'blur(22px) saturate(180%)',
    WebkitBackdropFilter: 'blur(22px) saturate(180%)',
    border: `1px solid ${MX.glassBorder}`,
    boxShadow: `inset 0 1px 0 ${MX.glassHi}, 0 10px 36px -18px ${MX.shadow}`,
  };
}

// ─── chain palette ────────────────────────────────────────────────────────────
export type ChainKey = 'bch' | 'eth' | 'bnb' | 'sol' | 'btc';

const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;
const chain = (v: string, name: string, short: string) => ({ color: v, bg: tint(v, 11), border: tint(v, 28), name, short });

export const CHAIN: Record<ChainKey, { color: string; bg: string; border: string; name: string; short: string }> = {
  bch: chain('var(--mx-c-bch)', 'Bitcoin Cash', 'BCH'),
  eth: chain('var(--mx-c-eth)', 'Ethereum', 'ETH'),
  bnb: chain('var(--mx-c-bnb)', 'BNB Chain', 'BNB'),
  sol: chain('var(--mx-c-sol)', 'Solana', 'SOL'),
  btc: chain('var(--mx-c-btc)', 'Bitcoin', 'BTC'),
};

// ─── screen shell ─────────────────────────────────────────────────────────────
/** Fills whatever surface it is in: the docked panel, the 360×600 popup or the onboarding card. */
export function MPopup({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: MX.bg0, color: MX.fg,
      fontSize: 14, lineHeight: 1.4,
      overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...style,
    }}>
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 320px 200px at 20% 0%, var(--mx-mesh-a), transparent 60%),
          radial-gradient(ellipse 400px 240px at 100% 100%, var(--mx-mesh-b), transparent 60%)
        `,
      }} />
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: 'var(--mx-noise-opacity)' as unknown as number, mixBlendMode: 'overlay',
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

// ─── buttons ──────────────────────────────────────────────────────────────────
interface BtnProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
  h?: number;
  onClick?: () => void;
  type?: 'button' | 'submit';
  testId?: string;
}

export function Spinner({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <span role="status" aria-label="Loading" style={{
      width: size, height: size, borderRadius: 99, flexShrink: 0, display: 'inline-block',
      border: `2px solid ${color}`, borderTopColor: 'transparent',
      animation: 'mxspin 0.7s linear infinite',
    }} />
  );
}

export function MPrimary({ children, icon, danger, disabled, loading, style, h = 44, onClick, type = 'button', testId }: BtnProps) {
  const off = disabled || loading;
  return (
    <button type={type} disabled={off} onClick={onClick} data-testid={testId} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      width: '100%', height: h, borderRadius: 14, border: 'none',
      cursor: off ? 'not-allowed' : 'pointer',
      opacity: off ? 0.45 : 1,
      background: danger
        ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
        : `linear-gradient(135deg, hsl(161,100%,41%) 0%, hsl(161,100%,35%) 100%)`,
      color: danger ? '#fff' : '#03130a',
      fontWeight: 700, fontSize: 13.5, letterSpacing: '-0.01em',
      boxShadow: danger
        ? '0 0 0 1px rgba(239,68,68,0.4), 0 8px 24px -8px rgba(239,68,68,0.6)'
        : '0 0 0 1px hsla(161,100%,41%,0.4), 0 8px 24px -8px hsla(161,100%,41%,0.6)',
      transition: 'opacity 0.15s, transform 0.1s',
      ...style,
    }}>
      {loading ? <Spinner size={15} /> : icon}{children}
    </button>
  );
}

export function MSecondary({ children, icon, danger, disabled, loading, style, h = 44, onClick, type = 'button', testId }: BtnProps) {
  const off = disabled || loading;
  return (
    <button type={type} disabled={off} onClick={onClick} data-testid={testId} className="mx-press" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      width: '100%', height: h, borderRadius: 14,
      background: MX.surface, border: `1px solid ${danger ? MX.redBorder : MX.borderStrong}`,
      color: danger ? MX.red : MX.fg,
      fontWeight: 600, fontSize: 13, cursor: off ? 'not-allowed' : 'pointer',
      opacity: off ? 0.5 : 1,
      ...style,
    }}>
      {loading ? <Spinner size={14} /> : icon}{children}
    </button>
  );
}

/** A small square icon button, used in bars and rows. */
export function IconBtn({ children, onClick, label, active, size = 30, testId }: {
  children: React.ReactNode; onClick?: () => void; label: string; active?: boolean; size?: number; testId?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} data-testid={testId} className="mx-press" style={{
      width: size, height: size, borderRadius: 9, flexShrink: 0,
      border: `1px solid ${active ? MX.primaryBorder : MX.border}`,
      background: active ? MX.primaryDim : MX.surface,
      color: active ? MX.primary : MX.fgMute, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </button>
  );
}

// ─── bento card ───────────────────────────────────────────────────────────────
interface BentoProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  mesh?: string;
  glow?: boolean;
  glassy?: boolean;
}
export function Bento({ children, style, mesh, glow, glassy }: BentoProps) {
  return (
    <div style={{
      position: 'relative',
      ...(glassy ? glass() : { background: MX.bg1, border: `1px solid ${MX.border}` }),
      borderRadius: 20, padding: 16, overflow: 'hidden',
      ...(glow ? { boxShadow: `inset 0 1px 0 ${MX.glassHi}, ${MX.primaryGlow}` } : {}),
      ...style,
    }}>
      {mesh && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: mesh }} />}
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

// ─── input ────────────────────────────────────────────────────────────────────
interface MInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
  onEnter?: () => void;
  suffix?: React.ReactNode;
  prefix?: React.ReactNode;
  mono?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  type?: 'text' | 'password' | 'number';
  inputMode?: 'text' | 'decimal' | 'numeric';
  ariaLabel?: string;
  testId?: string;
  style?: React.CSSProperties;
}
export function MInput({ placeholder, value, onChange, onEnter, suffix, prefix, mono, invalid, autoFocus, type = 'text', inputMode, ariaLabel, testId, style }: MInputProps) {
  const [focused, setFocused] = useState(false);
  const ring = invalid ? MX.redBorder : focused ? MX.primaryBorder : MX.border;
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', gap: 8,
      height: 44, background: MX.surface,
      border: `1px solid ${ring}`,
      borderRadius: 12, padding: '0 14px',
      boxShadow: focused ? `0 0 0 3px ${invalid ? MX.redDim : MX.primaryDim}` : 'none',
      transition: 'border-color 0.15s, box-shadow 0.15s',
      ...style,
    }}>
      {prefix && <div style={{ flexShrink: 0, color: MX.fgFaint, display: 'flex' }}>{prefix}</div>}
      <input
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        data-testid={testId}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
          color: MX.fg, fontSize: 13.5,
          fontFamily: mono ? MX.mono : 'inherit',
          fontWeight: 500,
        }}
      />
      {suffix && <div style={{ flexShrink: 0, display: 'flex' }}>{suffix}</div>}
    </div>
  );
}

// ─── segmented control & switch ───────────────────────────────────────────────
export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel, accent = MX.primary, compact }: {
  value: T; onChange: (v: T) => void; ariaLabel: string; accent?: string; compact?: boolean;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'flex', background: MX.bg2, borderRadius: 9, padding: 2, gap: 1 }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)} type="button" role="radio" aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center',
              padding: compact ? '4px 8px' : '5px 10px', borderRadius: 7, border: 'none',
              background: on ? accent : 'transparent',
              color: on ? MX.onPrimary : MX.fgMute,
              fontSize: 10.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.15s, color 0.15s',
            }}
          >{o.icon}{o.label}</button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, ariaLabel, testId }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string; testId?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} data-testid={testId}
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 21, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0,
        background: checked ? 'hsl(161,100%,38%)' : MX.bg3,
        transition: 'background 0.18s',
      }}
    >
      <span style={{
        display: 'block', width: 17, height: 17, borderRadius: 99, background: '#fff',
        transform: `translateX(${checked ? 15 : 0}px)`, transition: 'transform 0.18s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      }} />
    </button>
  );
}

// ─── banner ───────────────────────────────────────────────────────────────────
export function Banner({ tone = 'info', children, icon, action, testId }: {
  tone?: 'info' | 'warn' | 'error' | 'success'; children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; testId?: string;
}) {
  const c = tone === 'warn' ? { fg: MX.amber, bg: MX.amberDim, bd: MX.amberBorder }
    : tone === 'error' ? { fg: MX.red, bg: MX.redDim, bd: MX.redBorder }
    : tone === 'success' ? { fg: MX.primary, bg: MX.primaryDim, bd: MX.primaryBorder }
    : { fg: MX.fgMute, bg: MX.surface, bd: MX.border };
  const DefaultIcon = tone === 'success' ? MI.check : tone === 'info' ? MI.info : MI.warn;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} data-testid={testId} style={{
      display: 'flex', gap: 9, padding: '9px 11px', alignItems: 'flex-start',
      background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 12,
      color: c.fg, fontSize: 11.5, fontWeight: 500, lineHeight: 1.45,
    }}>
      <span style={{ marginTop: 1, display: 'flex' }}>{icon ?? <DefaultIcon size={14} />}</span>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
      {action}
    </div>
  );
}

// ─── bottom sheet ─────────────────────────────────────────────────────────────
export function Sheet({ title, onClose, children, footer, from = 'bottom', testId }: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; from?: 'bottom' | 'top'; testId?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const top = from === 'top';
  return (
    <>
      <div onClick={onClose} aria-hidden style={{ position: 'absolute', inset: 0, background: MX.scrim, backdropFilter: 'blur(2px)', zIndex: 30, animation: 'mxfade 180ms ease-out' }} />
      <div role="dialog" aria-modal="true" data-testid={testId} style={{
        position: 'absolute', left: 0, right: 0, ...(top ? { top: 0 } : { bottom: 0 }), maxHeight: '92%',
        ...glass(true),
        ...(top
          ? { borderBottomLeftRadius: 22, borderBottomRightRadius: 22, borderTop: 'none' }
          : { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottom: 'none' }),
        zIndex: 31, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: `${top ? 'mxslideDown' : 'mxslideUp'} 220ms cubic-bezier(.2,.7,.2,1)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px', borderBottom: `1px solid ${MX.border}` }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</div>
          <IconBtn label="Close" onClick={onClose} size={26}><MI.cross size={12} /></IconBtn>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>{children}</div>
        {footer && <div style={{ padding: 12, borderTop: `1px solid ${MX.border}` }}>{footer}</div>}
      </div>
    </>
  );
}

// ─── skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ w = '100%', h = 12, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return (
    <span aria-hidden style={{
      display: 'inline-block', width: w, height: h, borderRadius: r,
      backgroundColor: MX.surface2,
      backgroundImage: `linear-gradient(90deg, transparent, ${MX.surface2}, transparent)`,
      backgroundSize: '200px 100%', backgroundRepeat: 'no-repeat',
      animation: 'mxshimmer 1.3s ease-in-out infinite',
      ...style,
    }} />
  );
}

// ─── chain glyph ──────────────────────────────────────────────────────────────
export function ChainGlyph({ chain, size = 20 }: { chain: ChainKey; size?: number }) {
  const s = size;
  if (chain === 'bch') return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="hsl(161,100%,41%)" />
      <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="900" fill="#03130a" fontFamily="ui-monospace,monospace">฿</text>
    </svg>
  );
  if (chain === 'eth') return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1e293b" />
      <path d="M12 4 L12 10.2 L17 12.4 Z" fill="#a5b4fc" />
      <path d="M12 4 L7 12.4 L12 10.2 Z" fill="#dbeafe" />
      <path d="M12 14.4 L7 13 L12 20 Z" fill="#a5b4fc" />
      <path d="M12 20 L17 13 L12 14.4 Z" fill="#dbeafe" />
    </svg>
  );
  if (chain === 'bnb') return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#fbbf24" />
      <path d="M12 5 L9 8 L12 11 L15 8 Z M5 12 L8 9 L11 12 L8 15 Z M19 12 L16 9 L13 12 L16 15 Z M12 13 L9 16 L12 19 L15 16 Z" fill="#1f2937" />
    </svg>
  );
  if (chain === 'sol') return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#0f0f17" />
      <defs>
        <linearGradient id="solg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9945ff" />
          <stop offset="100%" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <path d="M7 9 L17 9 L15 11 L5 11 Z" fill="url(#solg)" />
      <path d="M5 13 L15 13 L17 15 L7 15 Z" fill="url(#solg)" />
    </svg>
  );
  if (chain === 'btc') return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#fb923c" />
      <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff" fontFamily="ui-monospace,monospace">₿</text>
    </svg>
  );
  return null;
}

// ─── chain stack ──────────────────────────────────────────────────────────────
export function ChainStack({ chains = ['eth','bch','sol','btc'] as ChainKey[], size = 18, overlap = 6 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {chains.map((c, i) => (
        <div key={c} style={{
          marginLeft: i === 0 ? 0 : -overlap,
          width: size + 2, height: size + 2, borderRadius: 99,
          background: MX.bg0, border: `1.5px solid ${MX.bg0}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: chains.length - i, position: 'relative',
        }}>
          <ChainGlyph chain={c} size={size} />
        </div>
      ))}
    </div>
  );
}

// ─── chain badge ──────────────────────────────────────────────────────────────
export function ChainBadge({ chain, label, network }: { chain: ChainKey; label?: string; network?: string }) {
  const c = CHAIN[chain];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 7px', background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 6, color: c.color, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label ?? c.short}{network && <span style={{ opacity: 0.7 }}>· {network}</span>}
    </span>
  );
}

// ─── token icon ───────────────────────────────────────────────────────────────
/** A token's logo with the logo of the network it lives on in the corner. Falls back to initials. */
export function TokenIcon({ symbol, logo, networkLogo, palette = 'bch', size = 34 }: {
  symbol: string; logo?: string; networkLogo?: string; palette?: ChainKey; size?: number;
}) {
  const [bad, setBad] = useState(false);
  const [badNet, setBadNet] = useState(false);
  useEffect(() => { setBad(false); }, [logo]);
  const c = CHAIN[palette];
  const badge = Math.round(size * 0.44);
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <div style={{
        width: size, height: size, borderRadius: 99,
        background: c.bg, border: `1px solid ${c.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {logo && !bad
          ? <img src={logo} alt="" onError={() => setBad(true)} style={{ width: size * 0.66, height: size * 0.66, objectFit: 'contain' }} />
          : <span style={{ color: c.color, fontWeight: 800, fontSize: size * 0.3 }}>{symbol.slice(0, 3).toUpperCase()}</span>}
      </div>
      {networkLogo && (
        <div style={{
          position: 'absolute', bottom: -2, right: -3, width: badge, height: badge, borderRadius: 99,
          background: MX.bg1, border: `1.5px solid ${MX.bg0}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {badNet
            ? <ChainGlyph chain={palette} size={badge - 3} />
            : <img src={networkLogo} alt="" onError={() => setBadNet(true)} style={{ width: badge - 4, height: badge - 4, objectFit: 'contain' }} />}
        </div>
      )}
    </div>
  );
}

// ─── live dot ─────────────────────────────────────────────────────────────────
export function LiveDot({ size = 8, color = MX.primary }: { size?: number; color?: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 99,
        background: color, opacity: 0.55,
        animation: 'mxping 1.6s cubic-bezier(0,0,.2,1) infinite',
      }} />
      <span style={{ position: 'relative', width: size, height: size, borderRadius: 99, background: color }} />
    </span>
  );
}

// ─── icons ────────────────────────────────────────────────────────────────────
interface IconProps { size?: number; stroke?: string; }
const I = ({ children, size = 16, stroke = 'currentColor' }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} aria-hidden
       strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
);

export const MI = {
  back:     (p: IconProps) => <I {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></I>,
  next:     (p: IconProps) => <I {...p}><path d="M5 12h14M12 5l7 7-7 7" /></I>,
  plus:     (p: IconProps) => <I {...p}><path d="M12 5v14M5 12h14" /></I>,
  copy:     (p: IconProps) => <I {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></I>,
  check:    (p: IconProps) => <I {...p}><path d="M20 6L9 17l-5-5" /></I>,
  cross:    (p: IconProps) => <I {...p}><path d="M18 6L6 18M6 6l12 12" /></I>,
  lock:     (p: IconProps) => <I {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></I>,
  eye:      (p: IconProps) => <I {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></I>,
  eyeOff:   (p: IconProps) => <I {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></I>,
  settings: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></I>,
  home:     (p: IconProps) => <I {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></I>,
  send:     (p: IconProps) => <I {...p}><path d="M7 17L17 7M8 7h9v9" /></I>,
  receive:  (p: IconProps) => <I {...p}><path d="M17 7L7 17M16 17H7V8" /></I>,
  swap:     (p: IconProps) => <I {...p}><path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4" /></I>,
  warn:     (p: IconProps) => <I {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></I>,
  info:     (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></I>,
  chevR:    (p: IconProps) => <I {...p}><path d="M9 18l6-6-6-6" /></I>,
  chevD:    (p: IconProps) => <I {...p}><path d="M6 9l6 6 6-6" /></I>,
  paste:    (p: IconProps) => <I {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></I>,
  shield:   (p: IconProps) => <I {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></I>,
  download: (p: IconProps) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></I>,
  logout:   (p: IconProps) => <I {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></I>,
  key:      (p: IconProps) => <I {...p}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></I>,
  refresh:  (p: IconProps) => <I {...p}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></I>,
  down:     (p: IconProps) => <I {...p}><path d="M12 4v16M5 13l7 7 7-7" /></I>,
  up:       (p: IconProps) => <I {...p}><path d="M12 20V4M5 11l7-7 7 7" /></I>,
  ext:      (p: IconProps) => <I {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></I>,
  activity: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></I>,
  search:   (p: IconProps) => <I {...p}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></I>,
  globe:    (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></I>,
  sun:      (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></I>,
  moon:     (p: IconProps) => <I {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></I>,
  contrast: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 2v20" /><path d="M12 6a6 6 0 0 1 0 12z" fill="currentColor" /></I>,
  bell:     (p: IconProps) => <I {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" /></I>,
  sliders:  (p: IconProps) => <I {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></I>,
  timer:    (p: IconProps) => <I {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></I>,
  wallet:   (p: IconProps) => <I {...p}><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></I>,
  plug:     (p: IconProps) => <I {...p}><path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" /></I>,
  book:     (p: IconProps) => <I {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></I>,
  scroll:   (p: IconProps) => <I {...p}><path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4" /><path d="M19 17V5a2 2 0 0 0-2-2H4M15 8h-5M15 12h-5" /></I>,
  panel:    (p: IconProps) => <I {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></I>,
  window:   (p: IconProps) => <I {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M5 8h14" /></I>,
  trash:    (p: IconProps) => <I {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></I>,
  pencil:   (p: IconProps) => <I {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></I>,
  faucet:   (p: IconProps) => <I {...p}><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></I>,
  languages:(p: IconProps) => <I {...p}><path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" /></I>,
  qr:       (p: IconProps) => <I {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M14 21v-1M17 21h4v-4" /></I>,
};

// ─── QR code ──────────────────────────────────────────────────────────────────
/** A real, scannable QR code of `value`. Always dark-on-white: scanners need the contrast in both themes. */
export function MQR({ value, size = 168, borderColor }: { value: string; size?: number; borderColor?: string }) {
  const modules = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }, [value]);

  const n = modules.length;
  return (
    <div data-testid="qr" style={{
      width: size + 20, height: size + 20,
      background: '#fff', borderRadius: 16, padding: 10,
      border: borderColor ? `2px solid ${borderColor}` : `1px solid ${MX.border}`,
      boxSizing: 'border-box',
    }}>
      <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
        {modules.map((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#0b0b0b" /> : null)))}
      </svg>
    </div>
  );
}

// ─── copy hook ────────────────────────────────────────────────────────────────
/** `copied` is the key last copied, for a second or so. */
export function useCopy(resetMs = 1400): [string | null, (text: string, key?: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key = text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), resetMs);
    }).catch(() => { /* clipboard blocked: nothing to show */ });
  };
  return [copied, copy];
}
