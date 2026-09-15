/**
 * Dark-first, high-contrast palette: this app is read at a glance in
 * direct sun or at night and operated with gloves, not typed into at a
 * desk. Every color pair here is chosen to stay legible outdoors, and
 * every tap target sized for a gloved thumb, not a mouse pointer.
 */
export const colors = {
  background: '#0B0D10',
  surface: '#161A20',
  surfaceRaised: '#1E232B',
  border: '#2A3038',
  textPrimary: '#F5F6F7',
  textSecondary: '#9AA3AE',
  textMuted: '#6B7280',
  accent: '#FF8A2B',
  accentPressed: '#E67515',
  accentText: '#1A0E00',
  success: '#3DD68C',
  danger: '#FF5A5F',
  dangerSurface: '#2B1416',
  warning: '#FFC15A',
  asphalt: '#12151A',
  laneLine: '#3A4048',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * One consistent type ramp instead of ad-hoc fontSize/letterSpacing per
 * screen — each step has its own line-height and tracking so nothing
 * feels cramped or loose next to another. Weights lean heavier than a
 * typical app's (500+ for body, not 400) because this is read at a glance,
 * often through a helmet visor, not settled into.
 */
export const type = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.6, lineHeight: 40, color: colors.textPrimary },
  title: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.4, lineHeight: 34, color: colors.textPrimary },
  heading: { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 27, color: colors.textPrimary },
  subheading: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.1, lineHeight: 22, color: colors.textPrimary },
  body: { fontSize: 16, fontWeight: '500' as const, lineHeight: 22, color: colors.textSecondary },
  caption: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.1, lineHeight: 17, color: colors.textMuted },
  label: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 1.1,
    lineHeight: 15,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
  },
  button: { fontSize: 16, fontWeight: '700' as const, letterSpacing: 0.2 },
} as const;

/** Minimum tap target height — comfortable with a gloved thumb at speed-zero. */
export const MIN_TOUCH_TARGET = 56;

/**
 * Depth hierarchy: everything was the same flat surface with no signal for
 * what matters. "raised" is for the thing the eye should land on first on a
 * screen (a live status, a primary card); "flat" is for a quiet grouping
 * (a settings section, a static row) that shouldn't compete with it.
 */
export const elevation = {
  flat: {
    shadowColor: '#000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;
