/**
 * Translations. English is the source: its keys are the type every other catalogue must satisfy, so a missing
 * translation is a compile error and never a blank label.
 *
 * Placeholders are `{name}`.
 */

import { en } from './en';
import { zhCN } from './zh-CN';

export type Language = 'en' | 'zh-CN';
export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];

export type MessageKey = keyof typeof en;
export type MessageVars = Record<string, string | number>;
export type Catalogue = Record<MessageKey, string>;

const CATALOGUES: Record<Language, Catalogue> = { en, 'zh-CN': zhCN };

export function translate(language: Language, key: MessageKey, vars?: MessageVars): string {
  const template = CATALOGUES[language]?.[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** The language for a locale tag such as the browser's or the phone's, when it is one we ship. */
export function languageFor(locale: string | undefined): Language {
  return (locale ?? 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export { en, zhCN };
