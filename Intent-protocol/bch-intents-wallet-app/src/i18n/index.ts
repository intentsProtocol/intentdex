/**
 * Translation for the app: the shared catalogue, with the app's own strings in front of it.
 *
 * The language is the user's choice from Settings, or the phone's until they make one.
 */
import { useCallback } from 'react';
import { getLocales } from 'expo-localization';
import { languageFor, translate, type Language, type MessageKey, type MessageVars } from '@bch-intents/wallet-core/i18n';
import { useSettingsStore } from '@/state/settings';
import { appEn } from './en';
import { appZhCN } from './zh-CN';

export type AppKey = keyof typeof appEn;
export type Key = AppKey | MessageKey;
export type T = (key: Key, vars?: MessageVars) => string;

const APP: Record<Language, Record<AppKey, string>> = { en: appEn, 'zh-CN': appZhCN };

export function deviceLanguage(): Language {
  try { return languageFor(getLocales()[0]?.languageTag); } catch { return 'en'; }
}

export function tr(language: Language, key: Key, vars?: MessageVars): string {
  const own = APP[language]?.[key as AppKey] ?? appEn[key as AppKey];
  if (own === undefined) return translate(language, key as MessageKey, vars);
  if (!vars) return own;
  return own.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function useLanguage(): Language {
  const chosen = useSettingsStore(s => s.settings.language);
  return chosen ?? deviceLanguage();
}

export function useT(): T {
  const language = useLanguage();
  return useCallback<T>((key, vars) => tr(language, key, vars), [language]);
}
