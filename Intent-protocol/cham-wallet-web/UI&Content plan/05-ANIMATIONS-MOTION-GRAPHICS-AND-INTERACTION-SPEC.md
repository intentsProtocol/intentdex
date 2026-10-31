# Animations, Motion Graphics & Interaction Specs
**High-Octane Visual & Micro-Interaction Engine**

---

## 1. Motion Design Principles

Cham Wallet's motion design follows three core pillars:
1. **Organic & Responsive**: Cham the Chameleon behaves like a living digital creature, breathing smoothly, blinking naturally, and tracking cursor movement.
2. **Tactile & Dimensional**: Bento cards and the 3D phone model have physical weight with subtle 3D tilt and specular lighting shifts.
3. **Frictionless & Snappy**: Spring physics (`type: "spring", stiffness: 300, damping: 25`) ensure interactions never feel sluggish or slow down navigation.

---

## 2. Framer Motion Springs & Transitions

Standard motion configuration presets:
```typescript
// Snappy Micro-interaction Spring (Buttons, tabs, toggles)
export const springSnappy = {
  type: "spring",
  stiffness: 400,
  damping: 30
};

// Gentle Fluid Spring (Modals, cards, phone tilt)
export const springFluid = {
  type: "spring",
  stiffness: 200,
  damping: 24,
  mass: 0.8
};

// Staggered Container Orchestration
export const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05
    }
  }
};

export const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: springFluid }
};
```

---

## 3. Interactive Cham Chameleon State Engine

### Mascot Animation Keyframes
```css
@keyframes cham-breathe {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@keyframes cham-blink {
  0%, 90%, 100% { transform: scaleY(0); }
  94%, 96% { transform: scaleY(1); }
}

@keyframes cham-tongue {
  0% { transform: scaleX(0); }
  35% { transform: scaleX(1); }
  55% { transform: scaleX(1); }
  100% { transform: scaleX(0); }
}

@keyframes cham-tail {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes cham-sway {
  0%, 100% { transform: rotate(-1.5deg); }
  50% { transform: rotate(1.5deg); }
}

@keyframes cham-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-5px); }
  40%, 80% { transform: translateX(5px); }
}
```

### Dynamic Eye Tracking Algorithm
The eye pupil vector is computed on each animation frame relative to the cursor position:
```typescript
const onMouseMove = (e: MouseEvent) => {
  const svg = svgRef.current;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  
  // Eye origin coordinates at (138, 62) in 200x160 viewBox
  const eyeX = rect.left + (138 / 200) * rect.width;
  const eyeY = rect.top + (62 / 160) * rect.height;
  
  const dx = e.clientX - eyeX;
  const dy = e.clientY - eyeY;
  const distance = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, distance / 160) * 5.5; // Max 5.5px pupil radius
  
  setPupilOffset({
    x: (dx / distance) * reach,
    y: (dy / distance) * reach
  });
};
```

### Contextual Mood Triggers
- **Hovering Download CTA**: Cham switches to `happy` (flicks tongue).
- **Hovering Security / Vault Cards**: Cham switches to `shy` (shuts eye, shielding secrets).
- **Selecting Cham Color Swatches**: Cham's skin smoothly color-mixes to the new tone over 700ms (`transition: fill 700ms ease, stroke 700ms ease`).

---

## 4. 3D Phone Tilt & Specular Shine

The interactive phone in `WalletPhoneModel.tsx` tracks mouse movement across the hero section:
```typescript
export function usePhone3DTilt() {
  const [rotate, setRotate] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - left) / width - 0.5;
    const y = (e.clientY - top) / height - 0.5;
    
    // Smooth 3D tilt constraint (-12deg to +12deg)
    setRotate({
      x: -y * 18,
      y: x * 18
    });
  };

  const handleMouseLeave = () => setRotate({ x: 0, y: 0 });

  return { rotate, handleMouseMove, handleMouseLeave };
}
```

**Phone CSS 3D Transform:**
```css
.phone-viewport {
  perspective: 1200px;
  transform-style: preserve-3d;
}

.phone-body {
  transform: rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 
    0 40px 100px -20px rgba(0, 0, 0, 0.9),
    0 0 50px -10px color-mix(in srgb, var(--cham-tone, #10b981) 25%, transparent);
}
```

---

## 5. Morphic Mesh Glow Shifts

Two ambient radial orbs float behind the Hero section, pulsing with an organic keyframe loop:
```css
@keyframes pulse-glow {
  0%, 100% {
    transform: scale(1) translate(0, 0);
    opacity: 0.15;
  }
  50% {
    transform: scale(1.15) translate(3%, -3%);
    opacity: 0.28;
  }
}

.animate-pulse-glow {
  animation: pulse-glow 8s ease-in-out infinite alternate;
}
```

When the user switches colors via the Cham theme picker, the primary radial glow transitions smoothly using CSS `transition: background 1s ease`.

---

## 6. Accessibility & Reduced Motion

In compliance with WCAG standards, all continuous rotations, eye tracking, and transform animations are gracefully disabled when the user specifies `prefers-reduced-motion: reduce`:
```css
@media (prefers-reduced-motion: reduce) {
  .cham,
  .cham *,
  .animate-pulse-glow,
  .bento-card-interactive,
  .phone-body {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
```
