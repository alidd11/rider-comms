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

export const type = {
  title: { fontSize: 30, fontWeight: '800' as const, color: colors.textPrimary },
  heading: { fontSize: 20, fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 13, fontWeight: '500' as const, color: colors.textMuted },
  button: { fontSize: 17, fontWeight: '700' as const },
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
