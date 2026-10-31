# Morphic Design System & Cham Theme Specification

---

## 1. Visual Philosophy: The Morphic Obsidian & Liquid Glass Aesthetic

Cham Wallet combines two signature visual disciplines:
1. **The Morphic Foundation** (from the BCH Intents trading landing page):
   - Micro-grainy noise backgrounds
   - Radial ambient color bloom (`animate-pulse-glow`)
   - High-contrast typography with massive heading display scale
   - Bento grids with interactive glass hover states
2. **The Liquid Glass Layer** (from the Cham on-chain wallet UI):
   - High-refraction specular borders and corner sheen
   - Dynamic tinting driven by the user's active chameleon tone
   - Ultra-deep obsidian backdrop (`#050505`) with translucent card surfaces

---

## 2. Core Color Tokens & Dynamic Tone System

### Canvas & Base Grayscale
```css
--bg-canvas: #050505;          /* Obsidian void */
--bg-surface: #0a0a0c;         /* Card background base */
--bg-surface-elevated: #111116;/* Popover / modal base */
--text-primary: #ffffff;       /* Pure white */
--text-secondary: #a1a1aa;     /* Zinc 400 */
--text-muted: #71717a;         /* Zinc 500 */
--border-subtle: rgba(255, 255, 255, 0.08);
--border-highlight: rgba(255, 255, 255, 0.16);
```

### The 8 Cham Chameleon Tones
Each tone provides a brand personality for the chameleon mascot and cascades across the site's ambient lighting and interactive accents:

| Tone ID | Hex Value | RGB Channels | Theme Association |
|---|---|---|---|
| `emerald` (Default) | `#10b981` | `16, 185, 129` | BCH Green / Movement Viridian / High Prosperity |
| `sky` | `#38bdf8` | `56, 189, 248` | Solana Cyan / Electric Energy / Fast Execution |
| `violet` | `#a78bfa` | `167, 139, 250` | EVM / Ethereum Lilac / Smart Contracts |
| `amber` | `#f59e0b` | `245, 158, 11` | Bitcoin Satoshi Gold / Hard Money |
| `rose` | `#fb7185` | `251, 113, 133` | Neon Coral / Cyberpunk Edge |
| `teal` | `#2dd4bf` | `45, 212, 191` | Mint Viridian / Modern DeFi |
| `orange` | `#fb923c` | `251, 146, 60` | Kinetic Citrus / High Frequency |
| `fuchsia` | `#e879f9` | `232, 121, 249` | Synthwave Violet / Future Finance |

---

## 3. Essential CSS Utility Classes

### A. Morphic Grain & Noise Overlay
```css
.grainy {
  position: relative;
}

.grainy::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
  opacity: 0.05;
  pointer-events: none;
  mix-blend-mode: overlay;
  border-radius: inherit;
}
```

### B. Glass & Bento Cards
```css
/* Morphic Bento Base */
.bento-card {
  position: relative;
  overflow: hidden;
  border-radius: 1.5rem; /* 24px */
  padding: 1.5rem;
  background: rgba(16, 16, 20, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.bento-card:hover {
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
}

.bento-card-interactive {
  cursor: pointer;
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}

.bento-card-interactive:hover {
  transform: translateY(-4px) scale(1.015);
}
```

### C. Liquid Glass Surfaces (Wallet Signature Look)
```css
/* Liquid Glass Panel (Used in Dialogs, Navbars, Feature Hubs) */
.lg-panel {
  background: linear-gradient(180deg, hsla(240, 10%, 13%, 0.74) 0%, hsla(240, 10%, 6%, 0.88) 100%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid hsla(0, 0%, 100%, 0.09);
  box-shadow:
    inset 0 1px 0 hsla(0, 0%, 100%, 0.12),
    0 30px 80px -28px rgba(0, 0, 0, 0.85),
    0 8px 24px -12px rgba(0, 0, 0, 0.6);
}

/* Liquid Glass Card with Dynamic Cham Tone Tint */
.lg-card {
  position: relative;
  isolation: isolate;
  background:
    radial-gradient(130% 100% at 0% 0%, color-mix(in srgb, var(--cham-tone, #10b981) 18%, transparent) 0%, transparent 58%),
    radial-gradient(90% 80% at 100% 100%, color-mix(in srgb, var(--cham-tone, #10b981) 8%, transparent) 0%, transparent 60%),
    linear-gradient(180deg, hsla(0, 0%, 100%, 0.07), hsla(0, 0%, 100%, 0.025));
  border: 1px solid hsla(0, 0%, 100%, 0.1);
  box-shadow:
    inset 0 1px 0 hsla(0, 0%, 100%, 0.16),
    inset 0 -1px 0 hsla(0, 0%, 0%, 0.25),
    0 18px 40px -26px color-mix(in srgb, var(--cham-tone, #10b981) 60%, transparent);
}

/* Specular Light Sheen across top-left border */
.lg-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(115deg, hsla(0, 0%, 100%, 0.09) 0%, transparent 32%, transparent 70%, hsla(0, 0%, 100%, 0.03) 100%);
}

.lg-well {
  background: hsla(0, 0%, 100%, 0.035);
  border: 1px solid hsla(0, 0%, 100%, 0.06);
  box-shadow: inset 0 1px 0 hsla(0, 0%, 100%, 0.04);
}
```

---

## 4. Typography Scale & Fonts

- **Headings**: `Space Grotesk`, sans-serif (Geometric, high-tech, confident)
- **Body & Captions**: `Inter`, sans-serif (Crisp readability, elegant tracking)
- **Numerical & Crypto Data**: `JetBrains Mono`, monospace (Addresses, balances, transaction hashes)

```css
/* Typography Scale */
h1.hero-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(3rem, 8vw, 7.5rem);
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 0.9;
}

h2.section-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(2rem, 4vw, 3.75rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.font-mono-data {
  font-family: 'JetBrains Mono', monospace;
  font-feature-settings: 'zero' 1, 'tnum' 1;
}
```

---

## 5. Cham Mascot Visual Specification

Cham the chameleon is an interactive living SVG mascot featuring:
- **Tone-adaptive skin**: Uses SVG fill and CSS `color-mix()` based on the active tone.
- **Dynamic eye tracking**: Pupils follow the user's cursor across the viewport via requestAnimationFrame.
- **5 Behavioral moods**:
  - `idle`: Gentle breathing, periodic eye blink.
  - `shy`: Eyes shut (protecting secrets / seed phrases).
  - `happy`: Tongue flicks out with playful agility (successful transaction / unlocked).
  - `error`: Head shake animation.
  - `busy`: Tail spiral spins in rotational orbit.
- **Accessible motion**: Automatically halts animations when `prefers-reduced-motion` is active.
