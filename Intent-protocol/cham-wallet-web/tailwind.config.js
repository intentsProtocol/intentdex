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
      borderRadius: {
        lg: 'var(--radius, 0.5rem)',
        md: 'calc(var(--radius, 0.5rem) - 2px)',
        sm: 'calc(var(--radius, 0.5rem) - 4px)',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      colors: {
        background: 'hsl(var(--background, 240 10% 3.9%))',
        foreground: 'hsl(var(--foreground, 0 0% 98%))',
        card: {
          DEFAULT: 'hsl(var(--card, 240 10% 3.9%))',
          foreground: 'hsl(var(--card-foreground, 0 0% 98%))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover, 240 10% 3.9%))',
          foreground: 'hsl(var(--popover-foreground, 0 0% 98%))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary, 161 100% 41%))',
          foreground: 'hsl(var(--primary-foreground, 0 0% 98%))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary, 161 100% 41%))',
          foreground: 'hsl(var(--secondary-foreground, 210 40% 98%))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted, 240 3.7% 15.9%))',
          foreground: 'hsl(var(--muted-foreground, 240 5% 64.9%))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent, 240 3.7% 15.9%))',
          foreground: 'hsl(var(--accent-foreground, 0 0% 98%))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive, 0 62.8% 30.6%))',
          foreground: 'hsl(var(--destructive-foreground, 0 0% 98%))',
        },
        border: 'hsl(var(--border, 240 3.7% 15.9%))',
        input: 'hsl(var(--input, 240 3.7% 15.9%))',
        ring: 'hsl(var(--ring, 240 4.9% 83.9%))',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-glow': {
          '0%, 100%': { transform: 'scale(1) translate(0, 0)', opacity: '0.15' },
          '50%': { transform: 'scale(1.15) translate(3%, -3%)', opacity: '0.28' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-glow': 'pulse-glow 8s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
