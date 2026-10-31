# Cham Wallet UI & Content Planning Index
**Comprehensive Design System, Architecture & Production Blueprint for `wallet.<domain>`**

This directory contains the complete design and engineering specifications for the Cham Wallet web landing site. Everything has been tailored to bridge the **Morphic DeFi design language** from the BCH Intents trading landing page with the **Liquid-Glass Cham Chameleon theme** and the **Cham Core Cryptographic Engine**.

---

## Document Index

1. [01-VISION-AND-TECH-STACK.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/01-VISION-AND-TECH-STACK.md)
   - Detailed Next.js vs. React + Vite 7 trade-off analysis (Recommends Vite 7 + React 19).
   - Core Architecture & Component Hierarchy.
   - Global Context Providers: `ChamThemeContext` (8 dynamic skin tones), `LanguageContext` (i18n), `DownloadModalContext`.
   - Production repository folder structure.

2. [02-MORPHIC-DESIGN-SYSTEM-AND-CHAM-THEME.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/02-MORPHIC-DESIGN-SYSTEM-AND-CHAM-THEME.md)
   - Fusion of Morphic utilities (`.grainy`, `.bento-card`, `.mesh-gradient-primary`) with Liquid-Glass (`.lg-panel`, `.lg-card`, `.lg-well`).
   - The 8 Cham chameleon colors (`emerald`, `sky`, `violet`, `amber`, `rose`, `teal`, `orange`, `fuchsia`) and dynamic CSS variables (`--cham-tone`, `--lg-tint`).
   - Typography system: Space Grotesk, Inter, JetBrains Mono.

3. [03-CHAM-ENGINE-UNDER-THE-HOOD-POWERS.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/03-CHAM-ENGINE-UNDER-THE-HOOD-POWERS.md)
   - 8 Unique Architectural Superpowers of Cham Core Engine:
     - Pure JavaScript zero-WASM execution (`@noble` primitives).
     - Universal Bare worklet mobile runtime compatibility.
     - Dual BIP-44 account derivation (`coinType: 145` vs legacy `coinType: 0`).
     - Native CashTokens L1 management & P2SH 20/32 byte covenants.
     - Resilient Electrum Fulcrum WebSocket pool.
     - `SIGHASH_UTXOS` non-custodial intent signing.
   - Translation from technical features into high-converting Cham Wallet user benefits.

4. [04-PAGE-SECTIONS-AND-COMPONENT-BLUEPRINTS.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/04-PAGE-SECTIONS-AND-COMPONENT-BLUEPRINTS.md)
   - Section-by-section breakdown:
     - Sticky Liquid-Glass Header with tone picker and language toggle.
     - Hero Section with Cham mascot and 3D Interactive Phone Model.
     - Bento Grid Overview (Uniswap-tier morphic cards).
     - Multi-Chain Arc & Interactive Portfolio.
     - Features Matrix Bento.
     - Cryptographic Institutional-Grade Security.
     - Interactive Liquid-Glass FAQ Accordion.
     - Final Conversion Banner & Download Platform Modal.

5. [05-ANIMATIONS-MOTION-GRAPHICS-AND-INTERACTION-SPEC.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/05-ANIMATIONS-MOTION-GRAPHICS-AND-INTERACTION-SPEC.md)
   - Framer Motion spring physics presets.
   - Cham Chameleon SVG state engine: eye pupil tracking, breathing, tongue flick, tail spin, and mood switches (`idle`, `shy`, `happy`, `error`, `busy`).
   - 3D interactive phone tilt with gyroscope / mouse tracking and specular glare.
   - Ambient morphic mesh glowing orbs reacting to Cham color changes.
   - WCAG `prefers-reduced-motion` compliance.

6. [06-CONTENT-COPY-AND-CLAIMS-GUIDE.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/06-CONTENT-COPY-AND-CLAIMS-GUIDE.md)
   - Complete section-by-section copy deck.
   - Strict Claims Audit: truth-in-advertising rules (Chrome Extension Alpha, Web Wallet inside trading dApp, mobile app in development, avoiding false app store claims).
   - Multi-language localization roadmap (EN, ES, ZH, JA).

7. [07-CLAUDE-DESIGN-PROMPT-AND-RESOURCES-KIT.md](file:///c:/Users/Antony%20Dev/Desktop/Movement/movedapp/ubuntu/Intent-protocol/cham-wallet-web/UI&Content%20plan/07-CLAUDE-DESIGN-PROMPT-AND-RESOURCES-KIT.md)
   - The master copy-paste prompt for Claude Design / Figma / UI generators.
   - Complete inventory of assets, SVG code, logos, screenshots, and token variables.
   - Detailed screen blueprints for the 3D phone model (Swap Intent, CashTokens Portfolio, Security Vault).
