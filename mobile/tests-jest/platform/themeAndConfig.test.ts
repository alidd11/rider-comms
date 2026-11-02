/* eslint-disable @typescript-eslint/no-require-imports -- isolateModules re-requires modules per platform */
import { renderHook } from '@testing-library/react-native';

function withPlatform<T>(os: string, load: () => T): T {
  let result!: T;
  jest.isolateModules(() => {
    const { Platform } = require('react-native');
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
    result = load();
  });
  return result;
}

describe('theme colours', () => {
  it('use dynamic colours on iOS and platform attributes on Android', () => {
    const ios = withPlatform('ios', () => {
      const rn = require('react-native');
      const dynamic = jest.spyOn(rn, 'DynamicColorIOS').mockImplementation((value: unknown) => ({ dynamic: value }));
      const { colors } = require('../../src/theme');
      return { colors, dynamic };
    });
    expect(ios.dynamic).toHaveBeenCalled();
    expect(ios.colors.accent).toEqual({ dynamic: expect.objectContaining({ light: expect.any(String), dark: expect.any(String) }) });

    const android = withPlatform('android', () => {
      const rn = require('react-native');
      const platformColor = jest.spyOn(rn, 'PlatformColor').mockImplementation((name: unknown) => ({ attr: name }));
      const { colors } = require('../../src/theme');
      return { colors, platformColor };
    });
    expect(android.colors.background).toEqual({ attr: '?android:attr/colorBackground' });
    // Colours without an Android attribute use the dark value.
    expect(typeof android.colors.accent).toBe('string');
  });

  it('gives concrete colours for the current scheme', async () => {
    const rn = require('react-native');
    const { useConcreteThemeColors } = require('../../src/theme');
    const scheme = jest.spyOn(rn, 'useColorScheme');
    scheme.mockReturnValue('light');
    const light = (await renderHook(() => useConcreteThemeColors())).result.current;
    scheme.mockReturnValue('dark');
    const dark = (await renderHook(() => useConcreteThemeColors())).result.current;
    expect(light.background).not.toBe(dark.background);
    scheme.mockRestore();
  });
});

describe('API configuration', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;
  const originalDev = (global as { __DEV__?: boolean }).__DEV__;
  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = original;
    (global as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('refuses to start a release build without an API URL', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    (global as { __DEV__?: boolean }).__DEV__ = false;
    expect(() => jest.isolateModules(() => require('../../src/config'))).toThrow('EXPO_PUBLIC_API_URL must be set for release builds');
  });
});
