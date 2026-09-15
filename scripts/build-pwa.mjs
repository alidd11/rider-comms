import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('docs');
const destination = resolve('dist/pwa');

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });

const required = ['index.html', 'app.css', 'app.js', 'config.js', 'manifest.json', 'sw.js'];
await Promise.all(required.map((file) => readFile(resolve(destination, file))));
const html = await readFile(resolve(destination, 'index.html'), 'utf8');
for (const asset of ['app.css', 'config.js', 'app.js', 'manifest.json']) {
  if (!html.includes(asset)) throw new Error(`PWA shell does not reference ${asset}`);
}

// These values control different pieces of real-device system chrome. A
// mismatch is visible around the status bar/home indicator even though a
// desktop browser screenshot cannot reproduce it.
const css = await readFile(resolve(destination, 'app.css'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(destination, 'manifest.json'), 'utf8'));
const darkChrome = '#080c10';
if (manifest.background_color !== darkChrome || manifest.theme_color !== darkChrome) {
  throw new Error('PWA manifest background_color and theme_color must remain #080c10');
}
if (!html.includes(`<meta name="theme-color" content="${darkChrome}"`)) {
  throw new Error('PWA HTML must include the #080c10 dark theme colour');
}
if (!css.includes(`--bg:${darkChrome}`) || !css.includes(`--system-chrome:${darkChrome}`)) {
  throw new Error('PWA CSS dark page and system-chrome colours must remain #080c10');
}
if (!html.includes('<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">') ||
    !css.includes('@media(prefers-color-scheme:light){:root{--system-chrome:#ffffff}}')) {
  throw new Error('PWA light theme colour and system-chrome surface must remain #ffffff');
}
console.log(`Built PWA at ${destination}`);
