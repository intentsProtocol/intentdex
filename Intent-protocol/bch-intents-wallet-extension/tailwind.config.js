/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/popup/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Morphic design tokens — matches frontend index.css
        'mx-primary':   'hsl(161, 100%, 41%)',
        'mx-bg0':       'hsl(240, 10%, 3.9%)',
        'mx-bg1':       'hsl(240, 6%, 9%)',
        'mx-bg2':       'hsl(240, 5%, 14%)',
        'mx-bg3':       'hsl(240, 5%, 18%)',
        'mx-fg':        'hsl(0, 0%, 98%)',
        'mx-fgmute':    'hsl(240, 5%, 64.9%)',
        'mx-fgfaint':   'hsl(240, 5%, 40%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        'card': '20px',
        'btn':  '14px',
        'input':'12px',
      },
    },
  },
  plugins: [],
};
