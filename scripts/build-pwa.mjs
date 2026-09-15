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
console.log(`Built PWA at ${destination}`);
