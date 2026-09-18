import { DynamicColorIOS, Platform, PlatformColor, useColorScheme } from 'react-native';

/** One product identity translated between two lighting conditions. */
export const lightColors = {
  background: '#080C0F',
  surface: '#0E1418',
  surfaceRaised: '#151D22',
  border: '#253038',
  textPrimary: '#F1F5F6',
  textSecondary: '#A8B2B8',
  textMuted: '#6F7C84',
  accent: '#32B7D5',
  accentPressed: '#249BB8',
  accentSoft: '#0D2A32',
  accentText: '#031014',
  success: '#38C991',
  danger: '#E66A63',
  dangerSurface: '#2B1718',
  warning: '#D7A84B',
  asphalt: '#0A0F12',
  laneLine: '#26343C',
} as const;

export const darkColors = {
  background: '#080C0F',
  surface: '#0E1418',
  surfaceRaised: '#151D22',
  border: '#253038',
  textPrimary: '#F1F5F6',
  textSecondary: '#A8B2B8',
  textMuted: '#6F7C84',
  accent: '#32B7D5',
  accentPressed: '#249BB8',
  accentSoft: '#0D2A32',
  accentText: '#031014',
  success: '#38C991',
  danger: '#E66A63',
  dangerSurface: '#2B1718',
  warning: '#D7A84B',
  asphalt: '#0A0F12',
  laneLine: '#26343C',
} as const;

export type ThemeColors = { [K in keyof typeof lightColors]: string };
export type ConcreteThemeColors = typeof lightColors | typeof darkColors;

function adaptive(light: string, dark: string, androidAttribute?: string): string {
  // React Navigation still types colours as plain strings even though React
  // Native accepts semantic OpaqueColorValue objects in every colour prop.
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark }) as unknown as string;
  if (Platform.OS === 'android' && androidAttribute) return PlatformColor(androidAttribute) as unknown as string;
  return dark;
}

/**
 * Static styles and icon colours can consume these adaptive values directly.
 * iOS resolves DynamicColorIOS on every appearance change; Android resolves
 * framework theme attributes after userInterfaceStyle switches automatically.
 */
export const colors: ThemeColors = {
  background: adaptive(lightColors.background, darkColors.background, '?android:attr/colorBackground'),
  surface: adaptive(lightColors.surface, darkColors.surface, '?android:attr/colorBackgroundFloating'),
  surfaceRaised: adaptive(lightColors.surfaceRaised, darkColors.surfaceRaised, '?android:attr/colorBackgroundFloating'),
  border: adaptive(lightColors.border, darkColors.border, '?android:attr/colorControlNormal'),
  textPrimary: adaptive(lightColors.textPrimary, darkColors.textPrimary, '?android:attr/textColorPrimary'),
  textSecondary: adaptive(lightColors.textSecondary, darkColors.textSecondary, '?android:attr/textColorSecondary'),
  textMuted: adaptive(lightColors.textMuted, darkColors.textMuted, '?android:attr/textColorSecondary'),
  accent: adaptive(lightColors.accent, darkColors.accent),
  accentPressed: adaptive(lightColors.accentPressed, darkColors.accentPressed),
  accentSoft: adaptive(lightColors.accentSoft, darkColors.accentSoft),
  accentText: adaptive(lightColors.accentText, darkColors.accentText),
  success: adaptive(lightColors.success, darkColors.success),
  danger: adaptive(lightColors.danger, darkColors.danger),
  dangerSurface: adaptive(lightColors.dangerSurface, darkColors.dangerSurface),
  warning: adaptive(lightColors.warning, darkColors.warning),
  asphalt: adaptive(lightColors.asphalt, darkColors.asphalt),
  laneLine: adaptive(lightColors.laneLine, darkColors.laneLine),
};

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
  sm: 2,
  md: 4,
  lg: 6,
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
