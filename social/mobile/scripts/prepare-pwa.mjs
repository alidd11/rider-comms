/* global URL */
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../dist/index.html', import.meta.url);
let html = await readFile(path, 'utf8');
if (!html.includes('<link rel="manifest"')) {
  html = html.replace('</head>', [
    '<meta name="theme-color" content="#080D13" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="icon" href="/social-icon.svg" type="image/svg+xml" />',
    '</head>'
  ].join('\n'));
}
await writeFile(path, html);
