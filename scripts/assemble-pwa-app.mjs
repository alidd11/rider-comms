// docs/app.js is generated: its source lives in docs/app/*.js, one file per
// feature area, concatenated in filename order. The parts are slices of a
// single IIFE, so they are not valid scripts on their own; lint, the
// invariant scripts, the build and the tests all read the assembled file.
//
//   node scripts/assemble-pwa-app.mjs          rewrite docs/app.js
//   node scripts/assemble-pwa-app.mjs --check  fail if docs/app.js is stale
//
// It also writes the brand colours at the top of docs/app.css from
// shared/src/brandPalette.json, the palette the native app and Rider Social
// use, and checks the web sign-in wording against shared/src/brand.ts.
import { readdir, readFile, writeFile } from 'node:fs/promises';

const partsDir = new URL('../docs/app/', import.meta.url);
const target = new URL('../docs/app.js', import.meta.url);
const PART_HEADER = '// Part of docs/app.js.';
const BANNER = '// GENERATED FILE: do not edit. Edit docs/app/*.js, then run `npm run build:pwa-app`.\n';

const names = (await readdir(partsDir)).filter((name) => /^\d{2}-[a-z0-9-]+\.js$/.test(name)).sort();
if (names.length === 0) throw new Error('docs/app/ has no parts');

let assembled = BANNER;
for (const name of names) {
  const source = await readFile(new URL(name, partsDir), 'utf8');
  // Each part starts with a one-line header naming it; it is not part of the
  // assembled output.
  if (!source.startsWith(PART_HEADER)) throw new Error(`docs/app/${name} must start with "${PART_HEADER}"`);
  assembled += source.slice(source.indexOf('\n') + 1);
}

// Each palette token becomes a CSS variable; the web's names predate the
// shared palette, so they're mapped here.
const CSS_VARS = {
  background: '--bg', backgroundElevated: '--bg-elevated', surface: '--surface', surfaceRaised: '--surface-raised',
  surfaceHover: '--surface-hover', border: '--border', borderSoft: '--border-soft', textPrimary: '--text',
  textSecondary: '--text-secondary', textMuted: '--text-muted', accent: '--accent', accentInk: '--accent-ink',
  accentPressed: '--accent-pressed', accentSoft: '--accent-soft', accentText: '--accent-text', focus: '--focus',
  bubbleMine: '--bubble-mine', success: '--success', danger: '--danger', dangerSurface: '--danger-surface',
  warning: '--warning', asphalt: '--asphalt', laneLine: '--lane-line', switchTrackOff: '--switch-off',
  guidance: '--guidance', guidanceStrip: '--guidance-strip',
};
const BRAND_START = '/* BRAND COLOURS: generated from shared/src/brandPalette.json by `npm run build:pwa-app`. Do not edit here. */';
const BRAND_END = '/* END BRAND COLOURS */';
const palette = JSON.parse(await readFile(new URL('../shared/src/brandPalette.json', import.meta.url), 'utf8'));
const declarations = (scheme) => {
  const tokens = palette[scheme];
  const missing = Object.keys(tokens).filter((token) => !CSS_VARS[token]);
  if (missing.length) throw new Error(`No CSS variable for brand colour ${missing.join(', ')}`);
  return Object.entries(tokens).map(([token, value]) => `${CSS_VARS[token]}:${value.toLowerCase()}`).join(';');
};
// Map-day banners are light in either appearance, so they need the light ink.
const brandBlock = `${BRAND_START}\n:root{${declarations('dark')};--accent-ink-on-light:${palette.light.accentInk.toLowerCase()}}\n` +
  `@media(prefers-color-scheme:light){:root{${declarations('light')}}}\n${BRAND_END}`;
const cssTarget = new URL('../docs/app.css', import.meta.url);
const css = await readFile(cssTarget, 'utf8');
const startAt = css.indexOf(BRAND_START);
const endAt = css.indexOf(BRAND_END);
if (startAt < 0 || endAt < startAt) throw new Error('docs/app.css is missing its brand colour block');
const brandedCss = css.slice(0, startAt) + brandBlock + css.slice(endAt + BRAND_END.length);

// The staff dashboard (docs/admin.css) uses the same palette under its own
// variable names; status tints like --danger-soft stay in admin.css.
const ADMIN_VARS = {
  '--bg': 'background', '--surface': 'surface', '--surface-2': 'surfaceRaised', '--border': 'border',
  '--border-strong': 'border', '--fg': 'textPrimary', '--fg-2': 'textSecondary', '--muted-fg': 'textMuted',
  '--accent': 'accentInk', '--accent-soft': 'accentSoft', '--chart-1': 'accent', '--success': 'success',
  '--danger': 'danger', '--warning': 'warning',
};
const adminDeclarations = (scheme) => Object.entries(ADMIN_VARS)
  .map(([name, token]) => `${name}:${palette[scheme][token].toLowerCase()}`).join(';');
const adminBrandBlock = `${BRAND_START}\n:root{${adminDeclarations('light')}}\n` +
  `@media(prefers-color-scheme:dark){:root{${adminDeclarations('dark')}}}\n${BRAND_END}`;
const adminTarget = new URL('../docs/admin.css', import.meta.url);
const adminCss = await readFile(adminTarget, 'utf8');
const adminStart = adminCss.indexOf(BRAND_START);
const adminEnd = adminCss.indexOf(BRAND_END);
if (adminStart < 0 || adminEnd < adminStart) throw new Error('docs/admin.css is missing its brand colour block');
const brandedAdminCss = adminCss.slice(0, adminStart) + adminBrandBlock + adminCss.slice(adminEnd + BRAND_END.length);

// The sign-in words every app shows (shared/src/brand.ts) must be the web's too.
const brandSource = await readFile(new URL('../shared/src/brand.ts', import.meta.url), 'utf8');
const copyBlock = /export const BRAND_COPY = \{([\s\S]*?)\} as const;/.exec(brandSource)?.[1] ?? '';
const brandWords = [...copyBlock.matchAll(/:\s*'([^']+)'/g)].map((match) => match[1]);
const indexHtml = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
const unusedWords = brandWords.filter((word) => !indexHtml.includes(word.replace(/'/g, '&#39;')) && !indexHtml.includes(word));
if (brandWords.length === 0) throw new Error('shared/src/brand.ts has no BRAND_COPY wording');
if (unusedWords.length) {
  console.error(`docs/index.html doesn't use the shared sign-in wording: ${unusedWords.join(' | ')}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8');
  if (current !== assembled) {
    console.error('docs/app.js is out of date with docs/app/*.js. Run `npm run build:pwa-app` and commit the result.');
    process.exit(1);
  }
  if (adminCss !== brandedAdminCss) {
    console.error('docs/admin.css brand colours are out of date with shared/src/brandPalette.json. Run `npm run build:pwa-app` and commit the result.');
    process.exit(1);
  }
  if (css !== brandedCss) {
    console.error('docs/app.css brand colours are out of date with shared/src/brandPalette.json. Run `npm run build:pwa-app` and commit the result.');
    process.exit(1);
  }
  console.log(`docs/app.js matches its ${names.length} parts; docs/app.css and docs/admin.css have the shared brand colours`);
} else {
  await writeFile(target, assembled);
  await writeFile(cssTarget, brandedCss);
  await writeFile(adminTarget, brandedAdminCss);
  console.log(`Wrote docs/app.js from ${names.length} parts and the brand colours in docs/app.css and docs/admin.css`);
}
