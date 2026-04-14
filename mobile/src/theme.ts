/**
 * R14 Design System — "The Kinetic Architect"
 * Deep indigos + vibrant emeralds, tonal layering, no-line rule.
 * Fonts: Manrope (headlines) + Inter (body) — System fallback on native.
 */

export const colors = {
  // Primary brand — deep indigo
  primary: '#451ebb',
  primaryContainer: '#5d3fd3',
  primaryLight: '#ede9fe',
  primaryGlow: 'rgba(69,30,187,0.12)',
  onPrimary: '#ffffff',

  // Secondary — vibrant emerald
  secondary: '#006d43',
  secondaryContainer: '#34d399',
  secondaryLight: '#ecfdf5',
  onSecondary: '#ffffff',

  // Surface hierarchy (tonal layering)
  bg: '#f8f9fc',                          // Level 0 — base
  surface: '#f8f9fc',                     // Level 0
  surfaceContainerLow: '#f2f3f6',         // Level 1 — sections
  surfaceContainer: '#e8eaed',            // Level 1.5
  surfaceContainerHigh: '#dfe1e4',        // Level 2
  surfaceContainerHighest: '#d5d7da',     // Level 3
  surfaceContainerLowest: '#ffffff',      // Level 2 — active cards (lift)
  card: '#ffffff',

  // Text — no pure black
  textPrimary: '#191c1e',                 // on-surface
  textSecondary: '#44474a',               // on-surface-variant
  textMuted: '#74777b',                   // outline
  textInverse: '#ffffff',

  // Hero/Header — deep indigo gradient
  heroBg: '#1a0a3e',
  heroText: '#ffffff',
  heroSub: '#b8a5e0',
  heroTag: '#8b7aac',

  // Status
  success: '#006d43',
  successBg: '#ecfdf5',
  successBorder: '#a7f3d0',

  warning: '#b45309',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',

  error: '#dc2626',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',

  info: '#451ebb',
  infoBg: '#ede9fe',

  // Timeline
  timelineLine: '#e8eaed',
  timelineDotActive: '#451ebb',
  timelineDotDone: '#006d43',
  timelineDotPending: '#dfe1e4',

  // Misc
  overlay: 'rgba(26,10,62,0.6)',
  shadow: 'rgba(25,28,30,0.06)',
  border: 'transparent',
  borderLight: 'transparent',
  borderFocus: 'rgba(69,30,187,0.2)',

  // Accent (for highlights)
  accent: '#5d3fd3',
  accentHover: '#451ebb',
  accentLight: '#ede9fe',
  accentGlow: 'rgba(93,63,211,0.15)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

export const radius = {
  sm: 12,       // min 1rem feel
  md: 16,       // 1.5rem for internal elements
  lg: 20,       // outer containers
  xl: 24,       // 2rem for outer containers
  '2xl': 32,    // large containers
  full: 9999,   // pills
} as const;

export const font = {
  xs: 10,
  sm: 11,
  base: 13,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
  '4xl': 36,
  hero: 42,

  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  black: '900' as const,
} as const;

// Whisper shadows — ambient glow, not statements
export const shadow = {
  sm: {
    shadowColor: '#191c1e',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#191c1e',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#191c1e',
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;
