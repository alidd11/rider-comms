import { DynamicColorIOS, Platform, PlatformColor, useColorScheme } from 'react-native';
import palette from './themePalette.json';

/**
 * One product identity translated between two lighting conditions. The
 * values live in themePalette.json so the Android build can turn them into
 * colour resources too (plugins/withAndroidThemeColors.js).
 *
 * Notes on particular colours:
 * - accentInk: the accent for text and small marks; the brand accent is only
 *   2.6:1 on light surfaces, below WCAG AA.
 * - switchTrackOff: an off switch's track, visible against surfaces in both
 *   themes.
 */
export const lightColors = palette.light;
export const darkColors = palette.dark;

export type ThemeColors = { [K in keyof typeof lightColors]: string };
export type ConcreteThemeColors = typeof lightColors | typeof darkColors;

/** The Android colour resource for a token, e.g. textPrimary -> rider_text_primary. */
export function androidColorResource(token: string): string {
  return `rider_${token.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}

function adaptive(token: keyof typeof lightColors): string {
  // React Navigation still types colours as plain strings even though React
  // Native accepts semantic OpaqueColorValue objects in every colour prop.
  if (Platform.OS === 'ios') return DynamicColorIOS({ light: lightColors[token], dark: darkColors[token] }) as unknown as string;
  // Android: the app's own colour resources, with a values-night copy, so
  // they follow the system theme like DynamicColorIOS. Framework theme
  // attributes such as ?android:attr/textColorPrimary must not be used:
  // they point at colour state lists, which React Native reads as a raw
  // number, and the text came out invisible.
  if (Platform.OS === 'android') return PlatformColor(`@color/${androidColorResource(token)}`) as unknown as string;
  return darkColors[token];
}

/**
 * Static styles and icon colours can consume these adaptive values directly;
 * both platforms resolve them for the current appearance.
 */
export const colors = Object.fromEntries(
  (Object.keys(lightColors) as Array<keyof typeof lightColors>).map((token) => [token, adaptive(token)]),
) as ThemeColors;

export function useConcreteThemeColors(): ConcreteThemeColors {
  return useColorScheme() === 'light' ? lightColors : darkColors;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 3,
  md: 4,
  lg: 4,
  xl: 8,
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
export const MIN_TOUCH_TARGET = 48;

/** How every button looks while pressed, so feedback is the same app-wide. */
export const pressedFeedback = { opacity: 0.7 } as const;

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
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;
