/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        heading: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        mesh: {
          emerald: '#00F298',
          cyan: '#00D8F6',
          violet: '#8B5CF6',
          amber: '#F59E0B',
          obsidian: '#040508',
          card: '#0a0d14',
          border: 'rgba(255, 255, 255, 0.08)',
        },
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { transform: 'scale(1) translate(0, 0)', opacity: '0.18' },
          '50%': { transform: 'scale(1.15) translate(3%, -3%)', opacity: '0.35' },
        },
        'beam-flow': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 7s ease-in-out infinite alternate',
        'beam-flow': 'beam-flow 3s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
