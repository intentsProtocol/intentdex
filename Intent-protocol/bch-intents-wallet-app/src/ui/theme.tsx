/**
 * Colours, type and spacing. The palettes are the browser extension's (design-system/theme.css), so the two
 * wallets look like one product. Screens take colours from `useTheme()` and never write one out.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { ChainKey } from '@bch-intents/wallet-core/chains';
import { useSettingsStore } from '@/state/settings';

export interface Palette {
  primary: string; primaryStrong: string; onPrimary: string; primaryDim: string; primaryBorder: string; primarySoft: string;
  bg0: string; bg1: string; bg2: string; bg3: string;
  fg: string; fgMute: string; fgFaint: string;
  border: string; borderStrong: string;
  surface: string; surface2: string;
  glass: string; glassStrong: string; glassBorder: string; glassHi: string;
  shadow: string; scrim: string;
  amber: string; amberDim: string; amberBorder: string;
  red: string; redDim: string; redBorder: string;
  chain: Record<ChainKey | 'usdc', string>;
  meshA: string; meshB: string;
}

const dark: Palette = {
  primary: 'hsl(161, 100%, 41%)', primaryStrong: 'hsl(161, 100%, 35%)', onPrimary: '#03130a',
  primaryDim: 'hsla(161, 100%, 41%, 0.12)', primaryBorder: 'hsla(161, 100%, 41%, 0.3)', primarySoft: 'hsla(161, 100%, 41%, 0.06)',
  bg0: 'hsl(240, 10%, 3.9%)', bg1: 'hsl(240, 6%, 9%)', bg2: 'hsl(240, 5%, 14%)', bg3: 'hsl(240, 5%, 18%)',
  fg: 'hsl(0, 0%, 98%)', fgMute: 'hsl(240, 5%, 64.9%)', fgFaint: 'hsl(240, 5%, 46%)',
  border: 'hsla(0, 0%, 100%, 0.07)', borderStrong: 'hsla(0, 0%, 100%, 0.12)',
  surface: 'hsla(0, 0%, 100%, 0.04)', surface2: 'hsla(0, 0%, 100%, 0.07)',
  glass: 'hsla(240, 8%, 13%, 0.6)', glassStrong: 'hsla(240, 8%, 9%, 0.92)', glassBorder: 'hsla(0, 0%, 100%, 0.1)', glassHi: 'hsla(0, 0%, 100%, 0.12)',
  shadow: 'rgba(0, 0, 0, 0.6)', scrim: 'rgba(0, 0, 0, 0.6)',
  amber: '#fbbf24', amberDim: 'hsla(43, 96%, 56%, 0.12)', amberBorder: 'hsla(43, 96%, 56%, 0.25)',
  red: '#f87171', redDim: 'hsla(0, 84%, 60%, 0.12)', redBorder: 'hsla(0, 84%, 60%, 0.25)',
  chain: { bch: 'hsl(161, 100%, 41%)', eth: '#60a5fa', sol: '#a78bfa', btc: '#fb923c', bnb: '#facc15', usdc: '#4f9cf9' },
  meshA: 'hsla(161, 100%, 41%, 0.16)', meshB: 'hsla(258, 90%, 66%, 0.1)',
};

const light: Palette = {
  primary: 'hsl(161, 100%, 27%)', primaryStrong: 'hsl(161, 100%, 24%)', onPrimary: '#ffffff',
  primaryDim: 'hsla(161, 100%, 30%, 0.1)', primaryBorder: 'hsla(161, 100%, 30%, 0.32)', primarySoft: 'hsla(161, 100%, 30%, 0.05)',
  bg0: 'hsl(150, 14%, 96%)', bg1: 'hsl(0, 0%, 100%)', bg2: 'hsl(150, 8%, 93%)', bg3: 'hsl(150, 8%, 88%)',
  fg: 'hsl(240, 12%, 9%)', fgMute: 'hsl(240, 5%, 36%)', fgFaint: 'hsl(240, 4%, 50%)',
  border: 'hsla(240, 12%, 10%, 0.09)', borderStrong: 'hsla(240, 12%, 10%, 0.16)',
  surface: 'hsla(240, 12%, 10%, 0.03)', surface2: 'hsla(240, 12%, 10%, 0.06)',
  glass: 'hsla(0, 0%, 100%, 0.7)', glassStrong: 'hsla(0, 0%, 100%, 0.95)', glassBorder: 'hsla(240, 12%, 10%, 0.08)', glassHi: 'hsla(0, 0%, 100%, 0.95)',
  shadow: 'rgba(20, 40, 30, 0.18)', scrim: 'rgba(15, 25, 20, 0.4)',
  amber: '#b45309', amberDim: 'hsla(35, 92%, 45%, 0.1)', amberBorder: 'hsla(35, 92%, 40%, 0.3)',
  red: '#dc2626', redDim: 'hsla(0, 72%, 51%, 0.08)', redBorder: 'hsla(0, 72%, 51%, 0.28)',
  chain: { bch: 'hsl(161, 100%, 27%)', eth: '#2563eb', sol: '#7c3aed', btc: '#ea580c', bnb: '#a16207', usdc: '#2563eb' },
  meshA: 'hsla(161, 100%, 41%, 0.2)', meshB: 'hsla(258, 90%, 66%, 0.12)',
};

export interface Theme { dark: boolean; c: Palette }

/** 4-point spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
/** The smallest thing a finger can reliably hit. */
export const TOUCH = 44;

const ThemeContext = createContext<Theme>({ dark: true, c: dark });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const pref = useSettingsStore(s => s.settings.theme);
  const isDark = pref === 'system' ? system !== 'light' : pref === 'dark';
  const theme = useMemo<Theme>(() => ({ dark: isDark, c: isDark ? dark : light }), [isDark]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Mix two `#rrggbb` or `hsl()` colours; `t` is the share of `b`. Used for Cham's skin tones. */
export function mix(a: string, b: string, t: number): string {
  const A = toRgb(a), B = toRgb(b);
  const ch = (i: 0 | 1 | 2) => Math.round(A[i] + (B[i] - A[i]) * t);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

function toRgb(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hsl = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(color);
  if (hsl) {
    const h = Number(hsl[1]) / 360, s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
  }
  return [128, 128, 128];
}
