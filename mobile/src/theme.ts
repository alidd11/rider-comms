import { DynamicColorIOS, Platform, PlatformColor, useColorScheme } from 'react-native';

/** One product identity translated between two lighting conditions. */
export const lightColors = {
  background: '#E9EEF0',
  surface: '#F7F9FA',
  surfaceRaised: '#DFE7EA',
  border: '#BCC8CE',
  textPrimary: '#0B1216',
  textSecondary: '#46545C',
  textMuted: '#6A7981',
  accent: '#279FC8',
  accentPressed: '#1F86AA',
  accentSoft: '#D5EBF2',
  accentText: '#031217',
  success: '#268B64',
  danger: '#BE4A53',
  dangerSurface: '#F2DDDF',
  warning: '#97620F',
  asphalt: '#DDE5E8',
  laneLine: '#BBC7CD',
} as const;

export const darkColors = {
  background: '#080D10',
  surface: '#11171B',
  surfaceRaised: '#182127',
  border: '#202A30',
  textPrimary: '#F3F6F7',
  textSecondary: '#AAB5BA',
  textMuted: '#748188',
  accent: '#2FA8D3',
  accentPressed: '#278DB1',
  accentSoft: '#102D38',
  accentText: '#041318',
  success: '#42C58A',
  danger: '#F0646B',
  dangerSurface: '#2A171A',
  warning: '#D39A42',
  asphalt: '#0D1317',
  laneLine: '#253139',
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
