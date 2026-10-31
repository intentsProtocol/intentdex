import '@/lib/core-setup';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsProvider } from '@/context/SettingsProvider';
import { WDKProvider } from '@/context/WDKProvider';
import { PortfolioProvider } from '@/context/PortfolioProvider';
import { DEFAULT_SETTINGS, normalizeSettings } from '@/lib/settings';
import { detectLanguage } from '@/lib/i18n';
import App from './App';

export default function init(storedSettings?: unknown) {
  // First run: start in the browser's language when we ship it.
  const initial = storedSettings ? normalizeSettings(storedSettings) : { ...DEFAULT_SETTINGS, language: detectLanguage() };
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SettingsProvider initial={initial}>
        <WDKProvider>
          <PortfolioProvider>
            <App />
          </PortfolioProvider>
        </WDKProvider>
      </SettingsProvider>
    </React.StrictMode>,
  );
}
