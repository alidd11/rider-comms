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
  'index.html', 'app.css', 'app.js', 'avatar-system.js', 'navigation-road-events.js', 'navigation-guidance.js', 'navigation-camera.js', 'navigation-puck.js', 'voice-activity.js', 'position-interpolation.js', 'movement-safety.js', 'message-state.js', 'config.js',
  'routes.css', 'routes.js', 'manifest.json', 'sw.js',
  // Staff-only dashboard (noindex); moderation.html redirects to it. The
  // backend enforces admin access on every request.
  'admin.html', 'admin.css', 'admin.js', 'moderation.html',
  // Public legal and support pages, generated from legal/ (npm run build:legal).
  'privacy.html', 'terms.html', 'guidelines.html', 'support.html', 'legal.css',
];
await Promise.all(publicFiles.map((file) => cp(resolve(source, file), resolve(destination, file))));
await cp(resolve(source, 'icons'), resolve(destination, 'icons'), { recursive: true });
// Self-hosted Inter (SIL Open Font License) for the staff dashboard.
await cp(resolve(source, 'fonts'), resolve(destination, 'fonts'), { recursive: true });
await cp(
  resolve(source, 'assets', 'routes', 'cards'),
  resolve(destination, 'assets', 'routes', 'cards'),
  { recursive: true },
);
// Sign-in and ride hero photos, self-hosted so they work offline and no
// third-party image host sees riders' requests.
await cp(resolve(source, 'assets', 'hero'), resolve(destination, 'assets', 'hero'), { recursive: true });
// Publish only a trusted launcher. Do not publish an executable third-party
// map document as a top-level page on the authenticated Rider Comms origin.
await mkdir(resolve(destination, 'map-beta'), { recursive: true });
await cp(resolve(source, 'map-beta', 'index.html'), resolve(destination, 'map-beta', 'index.html'));

const required = ['index.html', 'app.css', 'app.js', 'avatar-system.js', 'navigation-road-events.js', 'navigation-guidance.js', 'navigation-camera.js', 'navigation-puck.js', 'voice-activity.js', 'position-interpolation.js', 'movement-safety.js', 'message-state.js', 'config.js', 'manifest.json', 'sw.js'];
await Promise.all(required.map((file) => readFile(resolve(destination, file))));

// Cache-busting the deployed app.css/app.js used to be a manually-bumped
// `?v=NN` number in both index.html and sw.js -- easy to forget, and
// forgetting it means a browser (or the service worker's own Cache
// Storage) can keep serving stale CSS/JS indefinitely after a deploy,
// since the request URL never changes. Deriving it from the actual file
// contents instead means every real content change gets a fresh version
// automatically; nothing to remember, nothing to get wrong.
const [rawCss, rawJs, rawAvatarSystem, rawNavigationRoadEvents, rawNavigationGuidance, rawNavigationCamera, rawNavigationPuck, rawVoiceActivity, rawPositionInterpolation, rawMovementSafety, rawMessageState, rawRoutesCss, rawRoutesJs] = await Promise.all([
  readFile(resolve(destination, 'app.css'), 'utf8'),
  readFile(resolve(destination, 'app.js'), 'utf8'),
  readFile(resolve(destination, 'avatar-system.js'), 'utf8'),
  readFile(resolve(destination, 'navigation-road-events.js'), 'utf8'),
  readFile(resolve(destination, 'navigation-guidance.js'), 'utf8'),
  readFile(resolve(destination, 'navigation-camera.js'), 'utf8'),
  readFile(resolve(destination, 'navigation-puck.js'), 'utf8'),
  readFile(resolve(destination, 'voice-activity.js'), 'utf8'),
  readFile(resolve(destination, 'position-interpolation.js'), 'utf8'),
  readFile(resolve(destination, 'movement-safety.js'), 'utf8'),
  readFile(resolve(destination, 'message-state.js'), 'utf8'),
  readFile(resolve(destination, 'routes.css'), 'utf8'),
  readFile(resolve(destination, 'routes.js'), 'utf8'),
]);
const version = createHash('sha256')
  .update(rawCss)
  .update(rawJs)
  .update(rawAvatarSystem)
  .update(rawNavigationRoadEvents)
  .update(rawNavigationGuidance)
  .update(rawNavigationCamera)
  .update(rawNavigationPuck)
  .update(rawVoiceActivity)
  .update(rawPositionInterpolation)
  .update(rawMovementSafety)
  .update(rawMessageState)
  .update(rawRoutesCss)
  .update(rawRoutesJs)
  .digest('hex')
  .slice(0, 10);

for (const file of ['index.html', 'sw.js']) {
  const path = resolve(destination, file);
  const original = await readFile(path, 'utf8');
  const rewritten = original
    .replace(/\?v=[\w-]+/g, `?v=${version}`)
    .replace(/rider-comms-pwa-v[\w-]+/g, `rider-comms-pwa-v${version}`);
  if (rewritten !== original) await writeFile(path, rewritten);
}

const html = await readFile(resolve(destination, 'index.html'), 'utf8');
for (const asset of ['app.css', 'config.js', 'avatar-system.js', 'navigation-road-events.js', 'navigation-guidance.js', 'navigation-camera.js', 'navigation-puck.js', 'voice-activity.js', 'position-interpolation.js', 'app.js', 'movement-safety.js', 'message-state.js', 'manifest.json', 'routes.css', 'routes.js']) {
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
// Minify last: the checks above match the readable source text. Riders load
// this over mobile data, and minifying roughly halves app.js. No target is
// set, so syntax is never lowered, and these are classic scripts sharing
// globals, so esbuild keeps their top-level names.
const { transform, build } = await import('esbuild');
const minified = [
  'app.js', 'avatar-system.js', 'navigation-road-events.js', 'navigation-guidance.js', 'navigation-camera.js', 'navigation-puck.js', 'voice-activity.js',
  'position-interpolation.js', 'movement-safety.js', 'message-state.js', 'routes.js', 'admin.js',
  'app.css', 'routes.css', 'admin.css', 'legal.css',
];
await Promise.all(minified.map(async (file) => {
  const path = resolve(destination, file);
  const { code } = await transform(await readFile(path, 'utf8'), {
    loader: file.endsWith('.css') ? 'css' : 'js',
    minify: true,
    legalComments: 'none',
  });
  await writeFile(path, code);
}));

// The standalone /map-beta/ document is a trusted, inert launcher. It does
// not load MapLibre or any third-party JS into its own top-level execution
// context. Instead, it renders a SECOND sandboxed iframe with an opaque
// origin. Both direct-browser (native) and PWA-embedded previews use it.
const { outputFiles } = await build({
  entryPoints: [resolve(source, 'map-beta', 'preview.mjs')],
  write: false, bundle: true, format: 'iife', platform: 'browser',
  target: 'es2022', minify: true, legalComments: 'none',
});
const previewScript = outputFiles?.[0]?.text;
if (!previewScript || previewScript.toLowerCase().includes('</script')) {
  throw new Error('Unsafe or empty map preview bundle');
}
const previewTemplate = await readFile(resolve('map-lab/index.html'), 'utf8');
const previewCss = await readFile(resolve('map-lab/preview.css'), 'utf8');
// Source map-lab stays developer-only. Strip its local CSP: the srcdoc inherits
// the verified launcher's CSP, including the exact inline-script SHA-256 hash.
const cspMeta = previewTemplate.split('\n').find((line) => line.includes('<meta http-equiv="Content-Security-Policy"'));
if (!cspMeta) throw new Error('Missing map-lab CSP marker');
let payload = previewTemplate
  .replace(cspMeta + '\n', '')
  .replace('<link rel="stylesheet" href="./preview.css">', `<style>${previewCss}</style>`)
  // Unlike a module, an inline classic script executes as soon as the
  // parser reaches it. Move it after the controls/status DOM so an aborted
  // MapLibre CDN request is handled rather than leaving infinite loading.
  .replace('<script type="module" src="./preview.mjs"></script>', '')
  .replace('</body>', `<script>${previewScript}</script>\n</body>`);
if (payload.includes('./preview.mjs') || payload.includes('http-equiv="Content-Security-Policy"')) {
  throw new Error('Unconverted map preview template');
}
const statusMarkup = payload.indexOf('<output id="status"');
const scriptMarkup = payload.lastIndexOf('<script>');
if (statusMarkup < 0 || scriptMarkup <= statusMarkup) {
  throw new Error('Map beta renderer must execute after the status DOM');
}
// HTML attribute encoding lets the nested srcdoc reconstruct the exact
// bytes; do not let third-party HTML or any user input enter this template.
const escapeAttr = (str) => str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const betaPath = resolve(destination, 'map-beta', 'index.html');
const betaTemplate = await readFile(betaPath, 'utf8');
const wrapperOpen = betaTemplate.indexOf('<script>');
const wrapperClose = betaTemplate.indexOf('</script>', wrapperOpen);
const wrapperScript = wrapperOpen !== -1 && wrapperClose > wrapperOpen
  ? betaTemplate.slice(wrapperOpen + '<script>'.length, wrapperClose) : '';
if (!wrapperScript || !betaTemplate.includes('__RIDER_MAPS_SRCDOC__')) {
  throw new Error('Map beta launcher is missing its controlled script or sandbox placeholder');
}
const hash = (value) => createHash('sha256').update(value).digest('base64');
const betaHtml = betaTemplate
  .replace('__RIDER_MAPS_LAUNCHER_HASH__', hash(wrapperScript))
  .replace('__RIDER_MAPS_PAYLOAD_HASH__', hash(previewScript))
  .replace('__RIDER_MAPS_SRCDOC__', escapeAttr(payload));
if (betaHtml.includes('__RIDER_MAPS_') || !betaHtml.includes('sandbox="allow-scripts"')) {
  throw new Error('Map beta launcher is incompletely isolated');
}
await writeFile(betaPath, betaHtml);
console.log(`Built PWA at ${destination}`);
