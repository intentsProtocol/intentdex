/**
 * Cham, the wallet's chameleon.
 *
 * It does three things: its eye follows the pointer, its skin takes the colour of the chain in focus (a
 * chameleon for a wallet that lives on several chains), and it reacts to what the user is doing:
 *
 *   idle     looks around, blinks now and then
 *   shy      shuts its eye while a password or recovery phrase is on screen
 *   happy    flicks its tongue (unlocked, sent, confirmed)
 *   error    shakes its head (wrong password, failed transaction)
 *   busy     the tail spiral turns while something is in flight
 *
 * Pure SVG and CSS, no animation library. Honours prefers-reduced-motion through theme.css.
 */

import { useEffect, useRef, useState } from 'react';

export type ChamMood = 'idle' | 'shy' | 'happy' | 'error' | 'busy';

interface ChameleonProps {
  size?: number;
  /** Any CSS colour; usually a chain colour token. Defaults to the brand emerald. */
  tone?: string;
  mood?: ChamMood;
  /** Follow the pointer anywhere in the window (default) or stay still. */
  track?: boolean;
  label?: string;
}

const KEYFRAMES = `
@keyframes cham-breathe { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.5px) } }
@keyframes cham-tongue { 0% { transform: scaleX(0) } 35% { transform: scaleX(1) } 55% { transform: scaleX(1) } 100% { transform: scaleX(0) } }
@keyframes cham-blink { 0%,92%,100% { transform: scaleY(0) } 95%,97% { transform: scaleY(1) } }
@keyframes cham-tail { to { transform: rotate(360deg) } }
@keyframes cham-sway { 0%,100% { transform: rotate(-1.2deg) } 50% { transform: rotate(1.2deg) } }
`;

function useKeyframes() {
  useEffect(() => {
    if (document.getElementById('cham-kf')) return;
    const st = document.createElement('style');
    st.id = 'cham-kf';
    st.textContent = KEYFRAMES;
    document.head.appendChild(st);
  }, []);
}

export function Chameleon({ size = 120, tone = 'hsl(161, 100%, 41%)', mood = 'idle', track = true, label = 'Cham the chameleon' }: ChameleonProps) {
  useKeyframes();
  const svgRef = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!track || mood === 'shy') { setLook({ x: 0, y: 0 }); return; }
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const r = svg.getBoundingClientRect();
        // The eye sits at (138, 62) of the 200×160 drawing.
        const ex = r.left + (138 / 200) * r.width, ey = r.top + (62 / 160) * r.height;
        const dx = e.clientX - ex, dy = e.clientY - ey;
        const d = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, d / 140) * 5.5;
        setLook({ x: (dx / d) * reach, y: (dy / d) * reach });
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(frame); };
  }, [track, mood]);

  const shy = mood === 'shy';
  const skin = tone;
  const dark = `color-mix(in srgb, ${tone} 62%, #04120b)`;
  const light = `color-mix(in srgb, ${tone} 55%, #ffffff)`;
  const belly = `color-mix(in srgb, ${tone} 30%, #fffbe8)`;
  const fade = { transition: 'fill 700ms ease, stroke 700ms ease' };

  return (
    <svg
      ref={svgRef} role="img" aria-label={label}
      width={size} height={size * 0.8} viewBox="0 0 200 160"
      style={{ overflow: 'visible', animation: mood === 'error' ? 'mxshake 0.5s ease' : undefined, flexShrink: 0 }}
    >
      {/* branch */}
      <path d="M8 128 C 60 120, 140 124, 194 112" stroke="var(--mx-fg-faint)" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.55" />
      <path d="M150 118 C 160 106, 172 104, 180 96" stroke="var(--mx-fg-faint)" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.45" />
      <ellipse cx="183" cy="93" rx="9" ry="5" transform="rotate(-35 183 93)" fill={light} opacity="0.75" style={fade} />

      <g style={{ transformOrigin: '100px 120px', animation: 'cham-sway 6s ease-in-out infinite' }}>
        <g style={{ animation: 'cham-breathe 3.4s ease-in-out infinite' }}>
          {/* tail: a spiral that turns while busy */}
          <g style={{ transformOrigin: '38px 96px', animation: mood === 'busy' ? 'cham-tail 1.6s linear infinite' : undefined }}>
            <path
              d="M62 100 C 44 122, 14 110, 20 90 C 24 76, 46 76, 46 92 C 46 102, 34 104, 32 96"
              stroke={skin} strokeWidth="9" strokeLinecap="round" fill="none" style={fade}
            />
          </g>

          {/* body */}
          <path d="M56 104 C 52 70, 86 46, 122 54 C 140 58, 150 74, 146 92 C 142 110, 112 118, 84 116 C 70 115, 58 112, 56 104 Z" fill={skin} style={fade} />
          <path d="M66 106 C 80 114, 118 114, 140 98 C 132 112, 108 118, 84 116 C 74 115, 68 112, 66 106 Z" fill={belly} opacity="0.85" style={fade} />
          {/* back ridge */}
          <path d="M64 78 C 78 56, 104 50, 124 55" stroke={dark} strokeWidth="3" strokeLinecap="round" fill="none" strokeDasharray="1 7" style={fade} />
          {/* stripes */}
          <path d="M82 66 C 78 82, 80 98, 86 110 M100 60 C 96 78, 98 96, 104 112" stroke={dark} strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.4" style={fade} />

          {/* legs gripping the branch */}
          <path d="M82 112 C 80 120, 78 124, 74 127 M88 113 C 88 121, 90 125, 94 127" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" style={fade} />
          <path d="M122 110 C 122 117, 120 121, 116 124 M128 108 C 130 115, 133 119, 137 121" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" style={fade} />

          {/* head with crest */}
          <path d="M118 56 C 126 34, 150 30, 160 44 C 172 48, 180 60, 176 72 C 173 82, 160 88, 146 86 C 130 84, 118 74, 118 56 Z" fill={skin} style={fade} />
          <path d="M126 46 C 134 34, 150 32, 158 44" stroke={dark} strokeWidth="3" strokeLinecap="round" fill="none" style={fade} />

          {/* tongue */}
          <g style={{ transformOrigin: '174px 74px', transform: 'scaleX(0)', animation: mood === 'happy' ? 'cham-tongue 0.9s ease-in-out 1' : undefined }}>
            <path d="M174 74 C 184 72, 190 76, 198 70" stroke="#f472b6" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <circle cx="198" cy="70" r="3.5" fill="#f472b6" />
          </g>
          {/* mouth */}
          <path
            d={mood === 'happy' ? 'M152 78 C 160 84, 170 82, 175 74' : mood === 'error' ? 'M152 80 C 160 76, 170 76, 175 78' : 'M152 78 C 160 80, 170 79, 175 75'}
            stroke={dark} strokeWidth="2.5" strokeLinecap="round" fill="none" style={{ ...fade, transition: 'd 300ms ease, stroke 700ms ease' }}
          />

          {/* turret eye */}
          <circle cx="138" cy="62" r="15" fill={light} style={fade} />
          <circle cx="138" cy="62" r="15" fill="none" stroke={dark} strokeWidth="2" opacity="0.5" style={fade} />
          <circle cx="138" cy="62" r="9.5" fill="#fff" />
          <g style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: 'transform 90ms ease-out' }}>
            <circle cx="138" cy="62" r="5" fill="#0b1210" />
            <circle cx="139.8" cy="60.2" r="1.6" fill="#fff" />
          </g>
          {/* eyelid: shut when shy, blinks otherwise */}
          <ellipse
            cx="138" cy="62" rx="10.5" ry="10.5" fill={skin}
            style={{
              ...fade, transformOrigin: '138px 52px',
              transform: shy ? 'scaleY(1)' : 'scaleY(0)',
              transition: 'transform 180ms ease, fill 700ms ease',
              animation: shy ? undefined : 'cham-blink 5.5s ease-in-out infinite',
            }}
          />
          {shy && <path d="M129 63 C 134 67, 142 67, 147 63" stroke={dark} strokeWidth="2.2" strokeLinecap="round" fill="none" />}
        </g>
      </g>
    </svg>
  );
}
