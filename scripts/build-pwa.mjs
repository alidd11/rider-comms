import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('docs');
const destination = resolve('dist/pwa');

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

// Deploy only the public application shell. Copying the entire docs folder
// previously published internal product specifications alongside the PWA.
const publicFiles = [
  'index.html', 'app.css', 'app.js', 'avatar-system.js', 'navigation-road-events.js', 'movement-safety.js', 'message-state.js', 'config.js',
  'routes.css', 'routes.js', 'manifest.json', 'sw.js',
];
await Promise.all(publicFiles.map((file) => cp(resolve(source, file), resolve(destination, file))));
await cp(resolve(source, 'icons'), resolve(destination, 'icons'), { recursive: true });
await cp(
  resolve(source, 'assets', 'routes', 'cards'),
  resolve(destination, 'assets', 'routes', 'cards'),
  { recursive: true },
);

const required = ['index.html', 'app.css', 'app.js', 'avatar-system.js', 'navigation-road-events.js', 'movement-safety.js', 'message-state.js', 'config.js', 'manifest.json', 'sw.js'];
await Promise.all(required.map((file) => readFile(resolve(destination, file))));

// Cache-busting the deployed app.css/app.js used to be a manually-bumped
// `?v=NN` number in both index.html and sw.js -- easy to forget, and
// forgetting it means a browser (or the service worker's own Cache
// Storage) can keep serving stale CSS/JS indefinitely after a deploy,
// since the request URL never changes. Deriving it from the actual file
// contents instead means every real content change gets a fresh version
// automatically; nothing to remember, nothing to get wrong.
const [rawCss, rawJs, rawAvatarSystem, rawNavigationRoadEvents, rawMovementSafety, rawMessageState] = await Promise.all([
  readFile(resolve(destination, 'app.css'), 'utf8'),
  readFile(resolve(destination, 'app.js'), 'utf8'),
  readFile(resolve(destination, 'avatar-system.js'), 'utf8'),
  readFile(resolve(destination, 'navigation-road-events.js'), 'utf8'),
  readFile(resolve(destination, 'movement-safety.js'), 'utf8'),
  readFile(resolve(destination, 'message-state.js'), 'utf8'),
]);
const version = createHash('sha256').update(rawCss).update(rawJs).update(rawAvatarSystem).update(rawNavigationRoadEvents).update(rawMovementSafety).update(rawMessageState).digest('hex').slice(0, 10);

for (const file of ['index.html', 'sw.js']) {
  const path = resolve(destination, file);
  const original = await readFile(path, 'utf8');
  const rewritten = original
    .replace(/\?v=[\w-]+/g, `?v=${version}`)
    .replace(/rider-comms-pwa-v[\w-]+/g, `rider-comms-pwa-v${version}`);
  if (rewritten !== original) await writeFile(path, rewritten);
}

const html = await readFile(resolve(destination, 'index.html'), 'utf8');
for (const asset of ['app.css', 'config.js', 'avatar-system.js', 'navigation-road-events.js', 'app.js', 'movement-safety.js', 'message-state.js', 'manifest.json', 'routes.css', 'routes.js']) {
  if (!html.includes(asset)) throw new Error(`PWA shell does not reference ${asset}`);
}

// These values control different pieces of real-device system chrome. A
// mismatch is visible around the status bar/home indicator even though a
// desktop browser screenshot cannot reproduce it.
const css = await readFile(resolve(destination, 'app.css'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(destination, 'manifest.json'), 'utf8'));
const darkChrome = '#080d10';
if (manifest.background_color !== darkChrome || manifest.theme_color !== darkChrome) {
  throw new Error(`PWA manifest background_color and theme_color must remain ${darkChrome}`);
}
if (!html.includes(`<meta name="theme-color" content="${darkChrome}"`)) {
  throw new Error(`PWA HTML must include the ${darkChrome} dark theme colour`);
}
if (!css.includes(`--bg:${darkChrome}`) || !css.includes(`--system-chrome:${darkChrome}`)) {
  throw new Error(`PWA CSS dark page and system-chrome colours must remain ${darkChrome}`);
}
// Must match --bg's own light-theme value, not an independent "light
// mode is white" assumption — that mismatch (chrome white, page content
// cream) is exactly what left a visible seam in any native browser-chrome
// gap around the page (status bar, the strip below the safe area) in
// light mode, on every screen, not just the ones that happened to expose
// it. See the same reasoning for darkChrome above.
const lightChrome = '#e9eef0';
if (!html.includes(`<meta name="theme-color" content="${lightChrome}" media="(prefers-color-scheme: light)">`) ||
    !css.includes(`@media(prefers-color-scheme:light){:root{--system-chrome:${lightChrome}}}`)) {
  throw new Error(`PWA light theme colour and system-chrome surface must remain ${lightChrome}`);
}
console.log(`Built PWA at ${destination}`);
