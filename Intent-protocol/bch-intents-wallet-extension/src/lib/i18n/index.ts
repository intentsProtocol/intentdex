/**
 * Translations live in the shared package: one set of catalogues for the extension and the mobile app.
 * Use through `useT()` from SettingsProvider. Placeholders are `{name}`.
 */
import { languageFor, type Language } from '@bch-intents/wallet-core/i18n';

export * from '@bch-intents/wallet-core/i18n';

/** The browser's language when it is one we ship, for the first run. */
export function detectLanguage(): Language {
  return languageFor(typeof navigator !== 'undefined' ? navigator.language : 'en');
}
