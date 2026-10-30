import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, type Language } from '@/locales/translations';

type Theme = 'dark' | 'light';
export type Tab = 'landing' | 'docs' | 'app';

interface MeshContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  language: Language;
  setLanguage: (l: Language) => void;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  t: typeof translations['en'];
}

const MeshContext = createContext<MeshContextType | undefined>(undefined);

export function MeshProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mesh_theme') as Theme;
      if (saved) return saved;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return 'dark';
  });

  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mesh_lang') as Language;
      if (saved) return saved;
      const navLang = navigator.language.toLowerCase();
      if (navLang.includes('zh') || navLang.includes('cn')) return 'zh';
    }
    return 'en';
  });

  const [activeTab, setActiveTab] = useState<Tab>('landing');

  // Apply dark mode class to html element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('mesh_theme', theme);
  }, [theme]);

  // Persist language
  useEffect(() => {
    localStorage.setItem('mesh_lang', language);
  }, [language]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const currentTranslations = translations[language] || translations.en;

  return (
    <MeshContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        language,
        setLanguage,
        activeTab,
        setActiveTab,
        t: currentTranslations,
      }}
    >
      {children}
    </MeshContext.Provider>
  );
}

export function useMesh() {
  const context = useContext(MeshContext);
  if (!context) {
    throw new Error('useMesh must be used within a MeshProvider');
  }
  return context;
}
