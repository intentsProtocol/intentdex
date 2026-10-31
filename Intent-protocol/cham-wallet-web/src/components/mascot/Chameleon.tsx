/**
 * Cham, the wallet's chameleon: exact vector match to the official wallet app.
 *
 * Its skin takes the colour of the active theme / chain, and it reacts to what the user does:
 *   idle     breathes, looks around, blinks now and then, follows pointer
 *   shy      shuts its eye with a curved sleepy lid
 *   happy    flicks its pink tongue (unlocked, confirmed, hover)
 *   error    shakes its head (wrong input, error)
 *   busy     the tail spiral turns 360° continuously while something is in flight
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ChamMood = 'idle' | 'shy' | 'happy' | 'error' | 'busy';

interface ChameleonProps {
  size?: number;
  /** Any CSS colour. Defaults to brand emerald #00D18F. */
  tone?: string;
  mood?: ChamMood;
  /** Follow the pointer anywhere in the window (default true). */
  track?: boolean;
  label?: string;
  className?: string;
  onClick?: () => void;
}

const W = 200;
const H = 160;

export function Chameleon({
  size = 160,
  tone = '#00D18F',
  mood = 'idle',
  track = true,
  label = 'Cham the chameleon',
  className,
  onClick,
}: ChameleonProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);

  // Eye tracking: center of turret eye is at (138, 62)
  useEffect(() => {
    if (!track || mood === 'shy') {
      setLook({ x: 0, y: 0 });
      return;
    }

    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const r = svg.getBoundingClientRect();
        const ex = r.left + (138 / W) * r.width;
        const ey = r.top + (62 / H) * r.height;
        const dx = e.clientX - ex;
        const dy = e.clientY - ey;
        const d = Math.hypot(dx, dy) || 1;
        // Reach scaled to look natural
        const reach = Math.min(1, d / 150) * 4.2;
        setLook({ x: (dx / d) * reach, y: (dy / d) * reach });
      });
    };

    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [track, mood]);

  // Periodic natural blinking
  useEffect(() => {
    if (mood === 'shy') return;

    let timer: NodeJS.Timeout;
    const scheduleBlink = () => {
      const delay = 3000 + Math.random() * 4000;
      timer = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 180);
      }, delay);
    };

    scheduleBlink();
    return () => clearTimeout(timer);
  }, [mood]);

  const skin = tone;
  const dark = `color-mix(in srgb, ${tone} 62%, #04120b)`;
  const lightTone = `color-mix(in srgb, ${tone} 55%, #ffffff)`;
  const belly = `color-mix(in srgb, ${tone} 30%, #fffbe8)`;
  const fade = { transition: 'fill 600ms ease, stroke 600ms ease' };

  const mouthPath =
    mood === 'happy'
      ? 'M152 78 C 160 84, 170 82, 175 74'
      : mood === 'error'
      ? 'M152 80 C 160 76, 170 76, 175 78'
      : 'M152 78 C 160 80, 170 79, 175 75';

  const height = size * (H / W);

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={label}
      width={size}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      onClick={onClick}
      className={cn(
        'cham select-none inline-block overflow-visible',
        onClick && 'cursor-pointer',
        className
      )}
      style={{
        animation: mood === 'error' ? 'cham-shake 0.5s ease-in-out' : undefined,
      }}
    >
      {/* 1. Branch layer */}
      <g opacity={0.65}>
        <path
          d="M8 128 C 60 120, 140 124, 194 112"
          stroke="#71717a"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M150 118 C 160 106, 172 104, 180 96"
          stroke="#71717a"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
          opacity={0.7}
        />
        <ellipse
          cx="183"
          cy="93"
          rx="9"
          ry="5"
          transform="rotate(-35 183 93)"
          fill={lightTone}
          opacity={0.8}
          style={fade}
        />
      </g>

      {/* 2. Chameleon animated body group (breathing) */}
      <g style={{ animation: 'cham-breathe 3.4s ease-in-out infinite', transformOrigin: '100px 115px' }}>
        {/* Tail spiral - centered around (38, 96) */}
        <g
          style={{
            transformOrigin: '38px 96px',
            animation: mood === 'busy' ? 'cham-tail 1.4s linear infinite' : undefined,
          }}
        >
          <path
            d="M62 100 C 44 122, 14 110, 20 90 C 24 76, 46 76, 46 92 C 46 102, 34 104, 32 96"
            stroke={skin}
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
            style={fade}
          />
        </g>

        {/* Tongue flick behind head (active on happy mood or hover) */}
        <g
          style={{
            transformOrigin: '174px 74px',
            transform: mood === 'happy' ? 'scale(1)' : 'scaleX(0)',
            opacity: mood === 'happy' ? 1 : 0,
            transition: 'transform 260ms ease, opacity 260ms ease',
          }}
        >
          <path
            d="M174 74 C 184 72, 190 76, 198 70"
            stroke="#f472b6"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="198" cy="70" r="3.5" fill="#f472b6" />
        </g>

        {/* Body main silhouette */}
        <path
          d="M56 104 C 52 70, 86 46, 122 54 C 140 58, 150 74, 146 92 C 142 110, 112 118, 84 116 C 70 115, 58 112, 56 104 Z"
          fill={skin}
          style={fade}
        />

        {/* Belly patch */}
        <path
          d="M66 106 C 80 114, 118 114, 140 98 C 132 112, 108 118, 84 116 C 74 115, 68 112, 66 106 Z"
          fill={belly}
          opacity={0.85}
          style={fade}
        />

        {/* Dorsal crest dashed line */}
        <path
          d="M64 78 C 78 56, 104 50, 124 55"
          stroke={dark}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          strokeDasharray="1 7"
          style={fade}
        />

        {/* Rib markings */}
        <path
          d="M82 66 C 78 82, 80 98, 86 110 M100 60 C 96 78, 98 96, 104 112"
          stroke={dark}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
          opacity={0.4}
          style={fade}
        />

        {/* Back legs gripping branch */}
        <path
          d="M82 112 C 80 120, 78 124, 74 127 M88 113 C 88 121, 90 125, 94 127"
          stroke={dark}
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          style={fade}
        />

        {/* Front legs gripping branch */}
        <path
          d="M122 110 C 122 117, 120 121, 116 124 M128 108 C 130 115, 133 119, 137 121"
          stroke={dark}
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          style={fade}
        />

        {/* Head with crest */}
        <path
          d="M118 56 C 126 34, 150 30, 160 44 C 172 48, 180 60, 176 72 C 173 82, 160 88, 146 86 C 130 84, 118 74, 118 56 Z"
          fill={skin}
          style={fade}
        />

        {/* Brow casque curve */}
        <path
          d="M126 46 C 134 34, 150 32, 158 44"
          stroke={dark}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          style={fade}
        />

        {/* Mouth */}
        <path
          d={mouthPath}
          stroke={dark}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          style={fade}
        />

        {/* Turret eye base (138, 62) */}
        <circle cx="138" cy="62" r="15" fill={lightTone} style={fade} />
        <circle cx="138" cy="62" r="15" fill="none" stroke={dark} strokeWidth="2" opacity={0.5} style={fade} />
        <circle cx="138" cy="62" r="9.5" fill="#ffffff" />

        {/* Pupil - tracks mouse or glances */}
        <g
          style={{
            transform: `translate(${look.x}px, ${look.y}px)`,
            transition: 'transform 80ms ease-out',
          }}
        >
          <circle cx="138" cy="62" r="5" fill="#0b1210" />
          <circle cx="139.8" cy="60.2" r="1.6" fill="#ffffff" />
        </g>

        {/* Eyelid: covers when shy or blinking */}
        {(mood === 'shy' || isBlinking) && (
          <g>
            <ellipse cx="138" cy="62" rx="10.5" ry="10.5" fill={skin} style={fade} />
            <path
              d="M129 63 C 134 67, 142 67, 147 63"
              stroke={dark}
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
              style={fade}
            />
          </g>
        )}
      </g>
    </svg>
  );
}
