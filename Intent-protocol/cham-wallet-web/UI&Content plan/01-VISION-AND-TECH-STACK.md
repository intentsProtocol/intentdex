# Tech Stack Decision & Core Architecture Blueprint
**Cham Wallet Web Landing Site (`wallet.<domain>`)**

---

## 1. Next.js vs. React + Vite: Comprehensive Analysis & Recommendation

### Recommendation: **Vite 7 + React 19 + TypeScript** (Recommended)

| Criteria | Vite 7 + React 19 + TypeScript | Next.js 15 (App Router) |
|---|---|---|
| **Scope Alignment** | **Perfect.** Pure marketing landing page (no dynamic server backend, no database, no session cookies). | Overkill. Brings Node runtime, server actions, complex routing layers not needed for a static landing page. |
| **Existing Codebase Parity** | **Identical.** `frontend/` runs Vite 7 + React 19 + Framer Motion 12 + Tailwind 3. All 10 existing wallet components can be copied without rewrite. | High friction. Next.js App Router requires `'use client'` on all interactive/animation components, causing SSR hydration mismatches with Framer Motion and `window` event listeners. |
| **Asset & Bundle Efficiency** | Sub-millisecond HMR, zero server bundle, lightweight static HTML/CSS/JS export on Vercel CDN edge. | Heavier runtime overhead, larger build artifact, slower local dev cycles on low-RAM machines. |
| **Machine Resource Impact** | Low memory footprint, near-instant rebuilds (essential for Antony's local machine). | High RAM usage, node worker spikes during compilation. |
| **SEO & Performance** | Can use `@vitejs/plugin-react` with pre-rendering or static HTML generation if needed. 100/100 Lighthouse on static edge CDN. | Great SSR out of the box, but identical edge caching can be achieved with static Vite builds. |

> **Conclusion**: Build with **Vite 7 + React 19 + TypeScript + Tailwind 3**. If SSR is strictly required in the future for deep dynamic blogs, Vite SSG or Next.js can be revisited, but for `wallet.<domain>`, Vite provides the highest velocity, zero friction when lifting components from `frontend/src/components/wallet/`, and zero hydration issues with Framer Motion.

---

## 2. Global Contexts & Architecture

The site requires three lightweight, high-performance context providers to power dynamic brand customization, theme changes, and internationalization:

```
App
├── LanguageProvider (i18n: en, es, zh, ja)
├── ChamThemeProvider (Cham skin tones, dark canvas, morphic glows)
└── DownloadModalProvider (Controls platform install dialogs)
    └── LandingShell
        ├── Header (Sticky morphic bar with tone switcher & language toggle)
        ├── MainContent (Hero, Bento, Chains Arc, Features, Security, FAQ, CTA)
        └── Footer
```

### A. Cham Theme & Dynamic Color Provider (`ChamThemeProvider`)
Cham Wallet's visual identity centers around Cham the Chameleon changing colors. The website features an interactive Cham color switcher that shifts the entire website's accent glows, mesh gradients, and liquid-glass specular tints in real-time.

**Supported 8 Cham Skin Tones:**
1. **Emerald** (`#10b981`) - The primary signature tone (Movement viridian / BCH green)
2. **Sky** (`#38bdf8`) - Electric Solana / Base cyan-blue
3. **Violet** (`#a78bfa`) - Deep EVM / Ethereum lilac
4. **Amber** (`#f59e0b`) - Gold Bitcoin Cash satoshi glow
5. **Rose** (`#fb7185`) - Coral neon
6. **Teal** (`#2dd4bf`) - Mint viridian
7. **Orange** (`#fb923c`) - High-energy citrus
8. **Fuchsia** (`#e879f9`) - Cyberpunk magenta

**CSS Variable Binding:**
When a tone is selected, the provider updates CSS custom properties on `:root`:
```css
:root {
  --cham-tone: #10b981;
  --cham-tone-rgb: 16, 185, 129;
  --lg-tint: var(--cham-tone);
}
```
All morphic mesh gradients (`mesh-gradient-primary`), liquid glass cards (`.lg-card`), phone rim glows, and the SVG Chameleon mascot (`<Chameleon tone={currentTone} />`) react instantly without component re-renders.

### B. Internationalization Provider (`LanguageProvider`)
Cham Wallet serves a global community across Bitcoin Cash, EVM, and Solana ecosystems.
- **Languages supported:**
  - `en` (English - default)
  - `es` (Spanish - critical for Latin American BCH communities)
  - `zh` (Chinese - Simplified)
  - `ja` (Japanese)
- **Architecture:** Zero-dependency lightweight React context with strongly-typed translation dictionaries (`src/i18n/locales/`).

### C. Download Modal Provider (`DownloadModalProvider`)
Controls the high-converting platform selection modal:
- **Web App**: Direct launch to the trading site (`https://<domain>/trade`)
- **Chrome Extension**: Direct Chrome Web Store link / developer alpha unpack download
- **Mobile (iOS/Android)**: "Coming Soon - In Active Development" roadmap signup

---

## 3. Directory & File Organization Blueprint

```
cham-wallet-web/
├── public/
│   ├── favicon.ico
│   ├── noise.svg
│   ├── logos/
│   │   ├── wallets/main.svg       # Cham square logo mark
│   │   ├── bitcoin-cash-bch-logo.svg
│   │   ├── ethereum-eth-logo.svg
│   │   ├── solana.svg
│   │   └── movement.svg
│   └── mockups/
│       ├── phone-frame.png
│       └── screens/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.tsx           # Cham branded navbar with tone selector
│   │   │   ├── Footer.tsx           # Minimal developer & community footer
│   │   │   └── ScrollProgress.tsx   # Top neon scroll progress bar
│   │   ├── mascot/
│   │   │   ├── Chameleon.tsx        # Eye-tracking dynamic SVG mascot
│   │   │   └── ChamColorPicker.tsx  # Interactive palette selector
│   │   ├── wallet-model/
│   │   │   ├── WalletPhoneModel.tsx # 3D tilt interactive phone container
│   │   │   └── WalletFlowScreens.tsx# Swap, Tokens, and Activity interactive viewports
│   │   └── sections/
│   │       ├── WalletHero.tsx
│   │       ├── WalletBentoOverview.tsx
│   │       ├── WalletChainsArc.tsx
│   │       ├── WalletFeaturesBento.tsx
│   │       ├── WalletSecuritySection.tsx
│   │       ├── WalletFAQ.tsx
│   │       ├── WalletDownloadBanner.tsx
│   │       └── WalletDownloadModal.tsx
│   ├── context/
│   │   ├── ChamThemeContext.tsx
│   │   ├── LanguageContext.tsx
│   │   └── DownloadModalContext.tsx
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── en.json
│   │       ├── es.json
│   │       ├── zh.json
│   │       └── ja.json
│   ├── lib/
│   │   ├── utils.ts                 # clsx + twMerge
│   │   └── constants.ts             # Chain metadata, links, release notes
│   ├── styles/
│   │   ├── globals.css              # Morphic utilities, liquid-glass, keyframes
│   │   └── fonts.css
│   ├── App.tsx
│   ├── main.tsx
│   └── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```
