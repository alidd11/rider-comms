import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const palette = require('../src/themePalette.json') as { light: Record<string, string>; dark: Record<string, string> };
const pluginSource = await readFile(new URL('../plugins/withAndroidThemeColors.js', import.meta.url), 'utf8');
const themeSource = await readFile(new URL('../src/theme.ts', import.meta.url), 'utf8');
const appJson = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8')) as { expo: { plugins: unknown[] } };

test('every theme colour has a light and a night Android resource', () => {
  assert.deepEqual(Object.keys(palette.light), Object.keys(palette.dark));
  for (const value of [...Object.values(palette.light), ...Object.values(palette.dark)]) assert.match(value, /^#[0-9A-F]{6}$/i);
  // The plugin and the theme build the same names (textPrimary -> rider_text_primary).
  const naming = '`rider_${token.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`';
  assert.ok(pluginSource.includes(naming));
  assert.ok(themeSource.includes(naming));
  assert.ok(pluginSource.includes('tools:keep="@color/rider_*"'));
  assert.ok(appJson.expo.plugins.includes('./plugins/withAndroidThemeColors'));
  // Framework text attributes resolve to colour state lists, which React
  // Native reads as a raw number: text came out invisible on Android.
  assert.doesNotMatch(themeSource, /PlatformColor\(['`"]\?/);
});
