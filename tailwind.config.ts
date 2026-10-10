import type {Config} from 'tailwindcss';

/**
 * The palette and depth tokens are the phone app's own (src/theme/vega.ts and the
 * support chat's violet/cyan), so the console and the app read as one product.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: '#07070D',
          deep: '#0B0B12',
        },
        surface: {
          DEFAULT: 'rgba(255,255,255,0.05)',
          soft: 'rgba(255,255,255,0.08)',
          line: 'rgba(255,255,255,0.10)',
        },
        violet: {
          DEFAULT: '#7C4DFF',
          bright: '#A78BFA',
          deep: '#8B5CF6',
        },
        cyan: {DEFAULT: '#00C6FF', soft: '#22D3EE'},
        mint: '#22D3A6',
        danger: '#FF6B6B',
        pink: '#F472B6',
        ink: {
          DEFAULT: '#F2F2F7',
          muted: '#8E8E93',
          subtle: '#6E6E86',
        },
      },
      borderRadius: {
        xl2: '18px',
        xl3: '22px',
      },
      boxShadow: {
        glass: '0 18px 50px rgba(0,0,0,0.45)',
        glow: '0 0 0 1px rgba(167,139,250,0.35), 0 18px 60px rgba(124,77,255,0.28)',
        rim: 'inset 0 1px 0 rgba(255,255,255,0.10)',
      },
      keyframes: {
        drift: {
          '0%,100%': {transform: 'translate3d(0,0,0) scale(1)'},
          '50%': {transform: 'translate3d(2%, -3%, 0) scale(1.06)'},
        },
        rise: {
          from: {opacity: '0', transform: 'translateY(10px)'},
          to: {opacity: '1', transform: 'translateY(0)'},
        },
        shimmer: {
          '100%': {transform: 'translateX(100%)'},
        },
        pulseRing: {
          '0%': {opacity: '0.55', transform: 'scale(0.85)'},
          '70%': {opacity: '0', transform: 'scale(1.5)'},
          '100%': {opacity: '0', transform: 'scale(1.5)'},
        },
      },
      animation: {
        drift: 'drift 26s ease-in-out infinite',
        driftSlow: 'drift 40s ease-in-out infinite',
        rise: 'rise 260ms cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        pulseRing: 'pulseRing 2.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
