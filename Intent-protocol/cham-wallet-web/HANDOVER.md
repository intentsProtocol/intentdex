# Cham Wallet landing site — plan and handover

Written 2026-10-11 for whoever starts this repository, with no memory of the conversation that led here.
Everything under "Decided" was chosen by Antony. Everything under "Open" still needs his answer; ask before building on a guess.

## What this is

A small static website for **Cham Wallet**, to be published at `wallet.<our domain>`.
It is the marketing page for the wallet: what it is, which chains, security, FAQ, and where to get it.

It is **not** a wallet. No keys, no seed phrase, no wallet connection, no chain calls. Nothing on this site should ever ask for a recovery phrase.

## Background in one minute

- The product family lives under `C:\Users\Antony Dev\Desktop\Movement\movedapp\ubuntu\Intent-protocol\`.
- The wallet was called "BCH Intents Wallet" / "Intent Wallet". It is now **Cham Wallet**, named after Cham, the chameleon mascot.
- The wallet exists in three forms:

  | Form | Folder | Renamed to Cham Wallet? |
  |---|---|---|
  | Built into the trading site | `frontend/` | Yes, done (commit `506db6e`, branch `alpha`) |
  | Chrome extension | `bch-intents-wallet-extension/` | **Not yet. Decided, still to do** |
  | Mobile app (Expo) | `bch-intents-wallet-app/` | No. Stays "BCH Intents Wallet" until its next release |

- The landing page currently lives inside the trading site at `/wallet` (`frontend/src/pages/WalletPage.tsx`). This repository takes it over.

## Decided

1. `wallet.<domain>` hosts the **landing page only**. The wallet itself stays inside the trading site and the extension.
2. The landing page gets **its own repository** (this folder), deployed separately from the trading site.
3. The rebrand covers the **web wallet and the extension**. The mobile app is renamed later.
4. **Identifiers do not change.** Storage keys (`bch-intents-encrypted-wallet` and the rest), the extension's identity and `window.bchIntents` keep their names, so no user loses a wallet and no dapp breaks. Only what people read changes.

## Open — ask Antony

- The real domain, and whether the subdomain is exactly `wallet.`.
- Where "Open wallet" should link (the trading site's URL; `/trade` is the swap page).
- Store links for the extension and the mobile app, or confirmation that the download buttons say "coming soon". The current modal is `WalletDownloadModal.tsx`; read what it promises before copying it.
- Whether he has a Cham logo file. If not, use the SVG mark described below.
- The mobile app is not renamed yet, but the page talks about a mobile app. Decide how the page names it until then.
- Hosting: the trading site is on Vercel (`frontend/vercel.json`). Assumed here too; confirm.

## What to move

All in `frontend/src/components/wallet/`. Every one of them already says "Cham Wallet".

| File | Lines | What it is |
|---|---|---|
| `WalletHero.tsx` | 178 | Top section; uses the phone model and the download modal |
| `WalletBentoOverview.tsx` | 255 | Overview grid |
| `WalletChainsArc.tsx` | 291 | Supported chains; uses the phone model |
| `WalletFeaturesBento.tsx` | 195 | Features grid |
| `WalletSecuritySection.tsx` | 158 | Security |
| `WalletFAQ.tsx` | 134 | FAQ |
| `WalletDownloadBanner.tsx` | 104 | Closing call to action |
| `WalletDownloadModal.tsx` | 179 | Download dialog |
| `WalletFlowScreens.tsx` | 419 | The screens drawn inside the phone |
| `WalletPhoneModel.tsx` | 113 | The phone frame |

Plus the page shell, `frontend/src/pages/WalletPage.tsx` (81 lines): scroll progress bar, `<title>` and meta description, and the section order.

**Their only imports** are `react`, `framer-motion`, `lucide-react` and `cn` from `@/lib/utils` (`clsx` + `tailwind-merge`). They do not use the wallet providers, the router or any app state, so they lift out cleanly.

**The page shell does** import the trading site's `Header` and `Footer`. Do not copy those: they carry the whole app's navigation and wallet button. Write a small header (Cham mark, name, "Open wallet") and footer for this site.

**Assets they reference**, to copy from `frontend/public/`:
`/assets/solanaLogo.png`, `/logos/bitcoin-cash-bch-logo.svg`, `/logos/ethereum-eth-logo.svg`, `/logos/usd-coin-usdc-logo.svg`.
Grep the moved files again for `/assets/` and `/logos/` once they are in; this list came from a quick search.

**Styling to carry over** from `frontend/`:
- Tailwind 3 with `tailwindcss-animate`; theme tokens at the top of `src/index.css`; `tailwind.config.js` (fonts: Space Grotesk for headings, JetBrains Mono for numbers, loaded from Google Fonts in `index.html`).
- The page is dark: background `#050505`, emerald accent `hsl(161 100% 41%)`.
- The wallet's liquid-glass classes (`.lg-panel`, `.lg-card`, `.lg-well`, `.lg-scroll`) are at the end of `frontend/src/index.css`. Bring them if the page should match the wallet's look.

## Cham

- The animated mascot: `frontend/src/components/wallet/Chameleon.tsx` (pure SVG and CSS, no dependencies beyond `cn`). The same drawing is in the extension (`src/design-system/Chameleon.tsx`) and the mobile app (`src/ui/Chameleon.tsx`). It takes a colour (`tone`) and a mood (`idle`, `shy`, `happy`, `error`, `busy`), and its eye follows the pointer.
- The static mark, as a square icon: `frontend/public/logos/wallets/main.svg`. Use it for the favicon and social image until there is a real logo.
- Cham belongs in the hero. It is the brand; the page has no mascot on it today.

## Plan

1. **Scaffold.** Vite + React + TypeScript + Tailwind 3, matching the frontend's versions (`react` 19, `vite` 7, `framer-motion` 12, `lucide-react`). `git init` here; this folder sits inside a larger repository (`intents-private`), the same way the extension and the mobile app do, so it needs its own `.git`. Never `git add -A` in the parent.
2. **Move the sections** and `Chameleon.tsx`, with the assets and styles above. Keep the frontend's `@/` alias so imports need no edits.
3. **Write the shell**: own header and footer, `<title>` and meta from `WalletPage.tsx`, favicon from the Cham mark, Open Graph tags for the subdomain.
4. **Read the copy.** It was written for "Intent Wallet" and makes claims (app stores, TestFlight, Firefox, "thousands of users", Movement support). Check each against what actually ships before publishing; the extension is Chrome-only and in alpha (`bch-intents-wallet-extension/docs/internal/known-limitations.md`).
5. **Check it**: phone and desktop widths, reduced motion, no console errors, `npm run build`.
6. **Deploy**: a new Vercel project from this repository, then add `wallet.<domain>` to it. Vercel shows the CNAME record to create at the DNS provider. Antony has to run `vercel login` himself.
7. **Redirect** in the trading site: replace the `/wallet` route in `frontend/src/App.tsx` with a redirect to the subdomain, and point the three menu links at it (`Footer.tsx`, `LogoMenuDropdown.tsx`, `MobileNavMenu.tsx`). Then delete the moved files from the frontend. Do this last, once the subdomain is live.

## The other half: renaming the extension

Not part of this repository, but decided at the same time and not done.

In `bch-intents-wallet-extension/` (read its `CLAUDE.md` first):
- `manifest.json` name, short name and toolbar title; `_locales`; every catalogue in the shared i18n package (`../bch-intents-wallet-core`), since every visible string is a key there.
- Icons, onboarding and settings text, `docs/`.
- Keep `window.bchIntents`, message names and storage keys. An `isCham` flag on the provider is fine; a rename is not.
- The trading site already lists it as "Cham Wallet Extension" and shows a connected one as "Cham Extension" (`frontend/src/context/ExternalBCHWalletProvider.tsx`, `EXTENSION_WALLET_LABEL`).

## Working with Antony

- He wants questions asked in one batch at the start, each with a recommended option, then the work carried to the end with small commits.
- His machine is slow and low on memory: run one heavy job at a time (a type check of the frontend takes several minutes).
- He usually has the frontend's dev server running on port 5173. Do not start a second one or stop his.
- The frontend repository carries his own uncommitted work. Commit only your changes there, file by file.
- To look at a page in a real browser, a Node script can load Playwright from the extension repository (`createRequire('<...>/bch-intents-wallet-extension/')`, then `require('@playwright/test')`); Chromium is already installed there.
