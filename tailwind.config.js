/** @type {import('tailwindcss').Config} */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'Inter var',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: [
          'Inter',
          'Inter var',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      colors: {
        // Dawer brand green. 500 is the canonical primary, 600 its hover,
        // 400 the bright accent used in dark mode and on dark surfaces.
        brand: {
          50: '#F1F6E9',
          100: '#EAF2DD',
          200: '#D8E8BE',
          300: '#BFD797',
          400: '#A5CF68',
          500: '#7DAB4B',
          600: '#6E993F',
          700: '#5B7F33',
          800: '#486529',
          900: '#3A5023',
          950: '#1F2C12',
        },

        // Semantic surfaces. Every value resolves through a CSS variable so a
        // single `.dark` class on <html> re-themes the entire product.
        surface: withOpacity('--surface'),
        'surface-2': withOpacity('--surface-2'),
        'surface-3': withOpacity('--surface-3'),
        card: withOpacity('--card'),
        elevated: withOpacity('--elevated'),
        line: withOpacity('--line'),
        'line-strong': withOpacity('--line-strong'),

        ink: withOpacity('--ink'),
        'ink-muted': withOpacity('--ink-muted'),
        'ink-subtle': withOpacity('--ink-subtle'),
        'ink-inverse': withOpacity('--ink-inverse'),

        accent: withOpacity('--accent'),
        'accent-hover': withOpacity('--accent-hover'),
        'accent-bright': withOpacity('--accent-bright'),
        'accent-soft': withOpacity('--accent-soft'),
        'accent-ink': withOpacity('--accent-ink'),

        // Status hues. Deliberately desaturated so they read as professional
        // data signals next to the brand green rather than as playful colours.
        success: {
          50: '#ECF7EF',
          100: '#D6EDDD',
          200: '#AEDCC0',
          300: '#7CC49A',
          400: '#4FA873',
          500: '#358A57',
          600: '#276E44',
          700: '#1F5736',
          800: '#17452B',
          900: '#123721',
        },
        danger: {
          50: '#FDF1F0',
          100: '#FADFDC',
          200: '#F4BDB7',
          300: '#EC9287',
          400: '#E26A5C',
          500: '#C9483A',
          600: '#A6362B',
          700: '#862D24',
          800: '#6B2620',
          900: '#57211C',
        },
        warning: {
          50: '#FDF6E9',
          100: '#F9E9C6',
          200: '#F2D18A',
          300: '#E9B54E',
          400: '#DE9B22',
          500: '#B87B12',
          600: '#955F10',
          700: '#774A11',
          800: '#603B12',
          900: '#503213',
        },
        info: {
          50: '#EDF4FA',
          100: '#D6E6F4',
          200: '#AFCEE8',
          300: '#7FACE0',
          400: '#4A8BCC',
          500: '#2F6FAC',
          600: '#26588B',
          700: '#20466F',
          800: '#1C3A5B',
          900: '#18314C',
        },
      },

      borderRadius: {
        xs: '0.375rem',
        sm: '0.5rem',
        DEFAULT: '0.625rem',
        md: '0.75rem',
        lg: '0.875rem',
        xl: '1.125rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },

      boxShadow: {
        xs: '0 1px 2px rgb(var(--shadow-color) / 0.06)',
        soft: '0 1px 2px rgb(var(--shadow-color) / 0.04), 0 8px 24px -14px rgb(var(--shadow-color) / 0.16)',
        card: '0 1px 3px rgb(var(--shadow-color) / 0.05), 0 12px 32px -18px rgb(var(--shadow-color) / 0.20)',
        lift: '0 2px 6px rgb(var(--shadow-color) / 0.07), 0 24px 48px -22px rgb(var(--shadow-color) / 0.28)',
        pop: '0 12px 24px -8px rgb(var(--shadow-color) / 0.16), 0 32px 64px -24px rgb(var(--shadow-color) / 0.30)',
        glow: '0 0 0 1px rgb(125 171 75 / 0.28), 0 12px 32px -14px rgb(125 171 75 / 0.40)',
        'glow-sm': '0 0 0 1px rgb(125 171 75 / 0.24), 0 6px 18px -8px rgb(125 171 75 / 0.32)',
        'inner-line': 'inset 0 1px 0 0 rgb(255 255 255 / 0.05)',
      },

      transitionTimingFunction: {
        swift: 'cubic-bezier(0.22, 1, 0.36, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-soft': 'cubic-bezier(0.65, 0, 0.35, 1)',
      },

      transitionDuration: {
        120: '120ms',
        180: '180ms',
        240: '240ms',
        320: '320ms',
        480: '480ms',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '60%': { opacity: '1', transform: 'scale(1.015)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'chart-draw': {
          from: { opacity: '0', transform: 'translateY(8px) scaleY(0.86)' },
          to: { opacity: '1', transform: 'translateY(0) scaleY(1)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(125 171 75 / 0.45)' },
          '70%': { boxShadow: '0 0 0 12px rgb(125 171 75 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(125 171 75 / 0)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'bar-grow': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        // The track holds two identical copies of the logo list, so shifting
        // by exactly half lands on the seam and the loop never shows a gap.
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },

      animation: {
        'fade-in': 'fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-out': 'fade-out 180ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-up': 'slide-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down': 'slide-down 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slide-in-right 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-left': 'slide-in-left 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'chart-draw': 'chart-draw 520ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'spin-slow': 'spin-slow 1.6s linear infinite',
        'bar-grow': 'bar-grow 620ms cubic-bezier(0.22, 1, 0.36, 1) both',
        marquee: 'marquee 40s linear infinite',
        'marquee-slow': 'marquee 60s linear infinite',
      },
    },
  },
  plugins: [],
};