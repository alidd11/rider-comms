// docs/app.js is generated: its source lives in docs/app/*.js, one file per
// feature area, concatenated in filename order. The parts are slices of a
// single IIFE, so they are not valid scripts on their own; lint, the
// invariant scripts, the build and the tests all read the assembled file.
//
//   node scripts/assemble-pwa-app.mjs          rewrite docs/app.js
//   node scripts/assemble-pwa-app.mjs --check  fail if docs/app.js is stale
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

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8');
  if (current !== assembled) {
    console.error('docs/app.js is out of date with docs/app/*.js. Run `npm run build:pwa-app` and commit the result.');
    process.exit(1);
  }
  console.log(`docs/app.js matches its ${names.length} parts`);
} else {
  await writeFile(target, assembled);
  console.log(`Wrote docs/app.js from ${names.length} parts`);
}
