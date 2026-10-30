import React from 'react'
import ReactDOM from 'react-dom/client'
// Polyfill Buffer for Privy/Aptos SDK
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

import App from './App.tsx'
import './index.css'
import { PrivyProvider } from '@privy-io/react-auth'
import { ThemeProvider } from './components/theme-provider.tsx'
import './lib/i18n'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || "cm5nt75jf02tlmw1hh80dzqmh"}
      config={{
        loginMethods: ['email', 'twitter', 'discord'],
        appearance: {
          theme: 'light',
          accentColor: '#8B5CF6',
        },
        supportedChains: [{
          id: 27, // Movement Testnet Chain ID (Aptos-based)
          name: 'Movement Testnet',
          network: 'movement-testnet',
          rpcUrls: {
            default: {
              http: ['https://testnet.movementnetwork.xyz/v1'],
            },
          },
          nativeCurrency: {
            name: 'Move',
            symbol: 'MOVE',
            decimals: 8,
          },
        }]
      }}
    >
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <App />
      </ThemeProvider>
    </PrivyProvider>
  </React.StrictMode>,
)
