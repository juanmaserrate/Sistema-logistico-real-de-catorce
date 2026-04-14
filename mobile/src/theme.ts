/**
 * R14 Design System — Estilo TruckGO
 * Azul vibrante como primario, naranja como acento, cards limpias con timeline.
 */

export const colors = {
  // Primary brand — azul vibrante (TruckGO style)
  primary: '#2563eb',        // Blue 600
  primaryHover: '#1d4ed8',   // Blue 700
  primaryLight: '#eff6ff',   // Blue 50
  primaryGlow: 'rgba(37,99,235,0.12)',

  // Accent — naranja/amber para CTAs secundarios y highlights
  accent: '#f59e0b',         // Amber 500
  accentHover: '#d97706',    // Amber 600
  accentLight: '#fffbeb',    // Amber 50
  accentGlow: 'rgba(245,158,11,0.15)',

  // Neutrals
  bg: '#f8fafc',
  card: '#ffffff',
  surface: '#f1f5f9',
  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  // Text
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',

  // Hero/Header
  heroBg: '#0f172a',
  heroText: '#ffffff',
  heroSub: '#94a3b8',
  heroTag: '#64748b',

  // Status
  success: '#16a34a',
  successBg: '#f0fdf4',
  successBorder: '#bbf7d0',

  warning: '#f59e0b',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',

  error: '#ef4444',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',

  info: '#2563eb',
  infoBg: '#eff6ff',

  // Timeline
  timelineLine: '#e2e8f0',
  timelineDotActive: '#2563eb',
  timelineDotDone: '#16a34a',
  timelineDotPending: '#cbd5e1',

  // Misc
  overlay: 'rgba(15,23,42,0.55)',
  shadow: '#000',
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 9999,
} as const;

export const font = {
  xs: 10,
  sm: 11,
  base: 13,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 24,
  '4xl': 32,
  hero: 42,

  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  black: '900' as const,
} as const;

export const shadow = {
  sm: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  lg: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;
