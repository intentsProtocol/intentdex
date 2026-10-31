# Claude Design Master Guide & Resources Kit
**The Definitive Prompt & Asset Reference for Designing Cham Wallet Web**

---

## 1. How to Use This Kit with Claude Design / Figma / UI AI

When prompting Claude Design or any AI interface generator to create mocks, layouts, or code for Cham Wallet, paste the Master Prompt below. It provides the exact design system constraints, morphic layers, Cham color palette, and asset links.

---

## 2. The Master Design Prompt (Copy & Paste Ready)

```text
You are an elite DeFi / Web3 Product Designer specializing in ultra-premium dark-mode web experiences (comparable to Uniswap, Linear, Raydium, and Stripe).

TASK:
Design the high-converting marketing landing page for "Cham Wallet" (wallet.<domain>), the multi-chain self-custody wallet for Bitcoin Cash (BCH), EVM, and Solana powered by CashTokens covenants and client-side cryptography.

AESTHETIC & THEME:
- Base Canvas: Pure deep obsidian (#050505) with dark surface panels (#0a0a0c, #111116).
- Primary Tone: Emerald (#10b981) with a dynamic palette of 8 Cham chameleon colors (Sky #38bdf8, Violet #a78bfa, Amber #f59e0b, Rose #fb7185, Teal #2dd4bf, Orange #fb923c, Fuchsia #e879f9).
- Visual Layers:
  1. Subtle noise texture (.grainy with SVG fractalNoise filter at 5% opacity).
  2. Ambient floating radial mesh gradients (animate-pulse-glow) that reflect the active Cham tone.
  3. Liquid-Glass (.lg-panel, .lg-card) with specular sheen reflections along top borders (linear-gradient at 115deg) and deep backdrop blur (blur(28px)).
  4. Bento Grid cards with rounded-3xl (24px) corners, micro-borders (rgba(255,255,255,0.08)), and interactive hover lifts.
- Typography:
  - Display & Headings: Space Grotesk (bold, tight tracking -0.04em).
  - Body: Inter.
  - Numbers & Crypto data: JetBrains Mono.

KEY SECTIONS REQUIRED:
1. Header: Sticky liquid-glass bar with Cham mascot icon, brand name, "ALPHA" pill, Cham tone color-switcher dots, language picker (EN/ES/ZH/JA), and "Launch App" CTA.
2. Hero Section:
   - Giant typography: "ONE WALLET. EVERY INTENT. ZERO BRIDGES."
   - Animated SVG mascot "Cham the Chameleon" whose eye tracks the pointer and can change color.
   - Interactive 3D tilted phone mockup featuring titanium edges and live screen switching between:
     a) Swap Intent (BCH -> SOL/USDC with solver auction progress)
     b) CashTokens Portfolio (Native BCH + CashTokens balances)
     c) Cryptographic Security (Non-custodial key confirmation)
   - Dual CTAs: "Install Chrome Alpha" (glow button) and "Launch Web Wallet" (outline).
3. Bento Grid Overview: 4 high-contrast cards highlighting Bridge-less Intents, Native CashTokens, Cham Pure-JS speed, and Unified Multi-Chain seed derivation.
4. Multi-Chain Arc: Visual orbital ring connecting Bitcoin Cash, Solana, Ethereum, Movement, and Base.
5. Features Matrix: Electrum Fulcrum WebSocket mesh, SIGHASH_UTXOS covenant signing, customizable wallet colors.
6. Institutional-Grade Security: Transparent client-side PBKDF2/AES keystore explanation and open-source transparency.
7. Liquid-Glass FAQ: Smooth accordion for self-custody, intent mechanics, and supported platforms.
8. Closing CTA Banner: High-impact gradient card with Cham celebrating.

STRICT DESIGN RULES:
- Never mention internal libraries or "WDK". The product and brand is 100% "Cham Wallet" (powered by Cham Core Engine).
- Never use generic flat colors. Always use curated HSL/hex gradients with subtle inner glows.
- No false claims: Mobile is "In Active Development / Waitlist", Chrome extension is "Alpha".
- Never use generic flat colors. Always use curated HSL/hex gradients with subtle inner glows.
- No false claims: Mobile is "In Active Development / Waitlist", Chrome extension is "Alpha".
- Create immersive micro-interactions and tactile visual feedback on all interactive elements.
```

---

## 3. Asset & Resource Inventory

### A. Cham Chameleon Mascot SVG Reference
Cham is a pure SVG drawing with reactive states and eye tracking.
- **Source File**: `frontend/src/components/wallet/Chameleon.tsx`
- **ViewBox**: `0 0 200 160`
- **Eye Pupil Center**: `(138, 62)`
- **Key Visual Elements**: Branch path with bark texture, dynamic iris/pupil, curlable tail spiral, throat sac for breathing animation.

### B. Logo Marks & Network Assets
All network and wallet logos are accessible in `frontend/public/`:
- **Cham Square Logo Mark**: `public/logos/wallets/main.svg`
- **Bitcoin Cash (BCH)**: `public/logos/bitcoin-cash-bch-logo.svg`
- **Ethereum (ETH)**: `public/logos/ethereum-eth-logo.svg`
- **Solana (SOL)**: `public/logos/solana.svg`
- **Movement Network**: `public/logos/movement.svg`
- **USDC**: `public/logos/usd-coin-usdc-logo.svg`
- **Noise Texture**: `public/noise.svg`

### C. Feature & Mockup Imagery
- `public/featuresimages/walletcrosschain.png` (Multi-chain intent overview)
- `public/featuresimages/limitordercashtokens.png` (CashTokens limit orders)
- `public/featuresimages/chainsonintents.png` (Supported networks infographic)
- `public/featuresimages/crosschainswap.png` (Dutch Auction solver execution)

---

## 4. Screen Mockup Blueprints for the 3D Phone Model

When rendering the phone container (`WalletPhoneModel.tsx`), draw one of three screens:

### Screen 1: Swap Intent Screen
- Header: "Swap Intents" + Cham mini-avatar
- Input Box: `12.5 BCH` ($5,420.00)
- Arrow Down Divider with animated Dutch Auction timer pill: `Solver matching in 00:03s`
- Output Box: `27.42 SOL` ($5,418.50)
- Rate Display: `1 BCH = 2.1936 SOL (Best Execution)`
- Primary Action: Glowing Emerald Button `Sign Intent`

### Screen 2: CashTokens & Multi-Chain Portfolio
- Total Balance: `$14,892.40 USD` (+4.2% 24h)
- Segmented Assets:
  - **Bitcoin Cash**: `18.42 BCH` ($7,980.00)
  - **CashTokens (Fungible)**: `1,000,000 FURRY` (Verified CashToken)
  - **Solana**: `35.2 SOL` ($5,120.00)
  - **USDC**: `$1,792.40`
- Quick Action Buttons: `[Send] [Receive] [Swap] [History]`

### Screen 3: Non-Custodial Vault & Security
- Vault Status: `Encrypted Client-Side` (Green Shield Icon)
- Derivation Branch: `m/44'/145'/0'/0/0` (BIP-44 Standard)
- Network Connection: `Fulcrum Electrum WebSocket (Connected - 18ms)`
- Biometrics / Password Protection Toggle: `Active`
