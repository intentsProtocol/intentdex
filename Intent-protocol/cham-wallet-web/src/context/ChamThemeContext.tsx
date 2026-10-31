import React, { createContext, useContext, useEffect, useState } from 'react';

export interface ChamColor {
  id: string;
  name: string;
  hex: string;
  rgb: string;
  glow: string;
}

export const CHAM_COLORS: ChamColor[] = [
  { id: 'bitcoin', name: 'Bitcoin Gold', hex: '#f7931a', rgb: '247, 147, 26', glow: 'rgba(247, 147, 26, 0.45)' },
  { id: 'emerald', name: 'Emerald', hex: '#10b981', rgb: '16, 185, 129', glow: 'rgba(16, 185, 129, 0.4)' },
  { id: 'sky', name: 'Sky', hex: '#38bdf8', rgb: '56, 189, 248', glow: 'rgba(56, 189, 248, 0.4)' },
  { id: 'violet', name: 'Violet', hex: '#a78bfa', rgb: '167, 139, 250', glow: 'rgba(167, 139, 250, 0.4)' },
  { id: 'amber', name: 'Amber', hex: '#f59e0b', rgb: '245, 158, 11', glow: 'rgba(245, 158, 11, 0.4)' },
  { id: 'rose', name: 'Rose', hex: '#fb7185', rgb: '251, 113, 133', glow: 'rgba(251, 113, 133, 0.4)' },
  { id: 'teal', name: 'Teal', hex: '#2dd4bf', rgb: '45, 212, 191', glow: 'rgba(45, 212, 191, 0.4)' },
  { id: 'orange', name: 'Orange', hex: '#fb923c', rgb: '251, 146, 60', glow: 'rgba(251, 146, 60, 0.4)' },
  { id: 'fuchsia', name: 'Fuchsia', hex: '#e879f9', rgb: '232, 121, 249', glow: 'rgba(232, 121, 249, 0.4)' },
];

interface ChamThemeContextType {
  activeColor: ChamColor;
  setColor: (color: ChamColor) => void;
  colors: ChamColor[];
}

const ChamThemeContext = createContext<ChamThemeContextType>({
  activeColor: CHAM_COLORS[0],
  setColor: () => {},
  colors: CHAM_COLORS,
});

export function ChamThemeProvider({ children }: { children: React.ReactNode }) {
  const [activeColor, setActiveColor] = useState<ChamColor>(() => {
    try {
      const saved = localStorage.getItem('cham_selected_tone');
      if (saved) {
        const found = CHAM_COLORS.find((c) => c.id === saved || c.hex === saved);
        if (found) return found;
      }
    } catch {}
    return CHAM_COLORS[0];
  });

  useEffect(() => {
    try {
      localStorage.setItem('cham_selected_tone', activeColor.id);
    } catch {}

    const root = document.documentElement;
    root.style.setProperty('--cham-tone', activeColor.hex);
    root.style.setProperty('--cham-tone-rgb', activeColor.rgb);
    root.style.setProperty('--lg-tint', activeColor.hex);
  }, [activeColor]);

  return (
    <ChamThemeContext.Provider value={{ activeColor, setColor: setActiveColor, colors: CHAM_COLORS }}>
      {children}
    </ChamThemeContext.Provider>
  );
}

export function useChamTheme() {
  return useContext(ChamThemeContext);
}
