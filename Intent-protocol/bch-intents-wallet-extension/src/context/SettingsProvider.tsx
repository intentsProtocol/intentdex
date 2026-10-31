/**
 * Settings, theme and language for every wallet view.
 *
 * One provider because the three change together: the settings record holds the theme and language preference,
 * and a change made in one open view (say the side panel) must reach another (an approval window) at once.
 * That sync is chrome.storage.onChanged, not React state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_SETTINGS, SETTINGS_KEY, normalizeSettings, readSettings, writeSettings, type WalletSettings,
} from '@/lib/settings';
import { translate, type MessageKey, type MessageVars } from '@/lib/i18n';

export type ResolvedTheme = 'light' | 'dark';

interface SettingsContextType {
  settings: WalletSettings;
  /** False until the stored record has been read; the UI renders with defaults before that. */
  ready: boolean;
  update: (patch: Partial<WalletSettings>) => Promise<void>;
  resolvedTheme: ResolvedTheme;
  t: (key: MessageKey, vars?: MessageVars) => string;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const systemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

/** Resolve the preference and put it on <html>, where theme.css reads it. */
export function applyTheme(pref: WalletSettings['theme']): ResolvedTheme {
  const resolved = pref === 'system' ? systemTheme() : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: WalletSettings }) {
  const [settings, setSettings] = useState<WalletSettings>(initial ?? DEFAULT_SETTINGS);
  const [ready, setReady] = useState(!!initial);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyTheme((initial ?? DEFAULT_SETTINGS).theme));

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(SETTINGS_KEY).then(async stored => {
      // First run: keep what the caller chose (the detected language) and make it the stored record.
      const s = stored[SETTINGS_KEY] ? await readSettings() : await writeSettings(initial ?? DEFAULT_SETTINGS);
      if (alive) { setSettings(s); setReady(true); }
    });

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      try { setSettings(normalizeSettings(JSON.parse(changes[SETTINGS_KEY].newValue ?? '{}'))); } catch { /* keep current */ }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  // Follow the OS while the preference is 'system'.
  useEffect(() => {
    setResolvedTheme(applyTheme(settings.theme));
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setResolvedTheme(applyTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.theme]);

  useEffect(() => { document.documentElement.lang = settings.language; }, [settings.language]);

  const update = useCallback(async (patch: Partial<WalletSettings>) => {
    setSettings(s => normalizeSettings({ ...s, ...patch }));   // optimistic: a toggle must not lag behind storage
    setSettings(await writeSettings(patch));
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: MessageVars) => translate(settings.language, key, vars),
    [settings.language],
  );

  const value = useMemo(() => ({ settings, ready, update, resolvedTheme, t }), [settings, ready, update, resolvedTheme, t]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

/** The translate function alone, for components that need nothing else. */
export function useT() {
  return useSettings().t;
}
