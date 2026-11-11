// Regenerates docs/navigation-puck.js from shared/src/navigationPuck.ts by
// stripping the TypeScript types. Run after editing the shared module;
// scripts/check-navigation-puck.mjs fails if the two drift apart.
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../shared/src/navigationPuck.ts', import.meta.url), 'utf8');
let js = stripTypeScriptTypes(source);
const names = [...js.matchAll(/export (?:function|const) (\w+)/g)].map((match) => match[1]);
js = js.replace(/export (function|const) /g, '$1 ').replace(/\/\*\*\n \* Where to draw[\s\S]*?\*\/\n/, '');
const body = js.split('\n').map((line) => {
  const [, indent, rest] = line.match(/^(\s*)(.*?)\s*$/);
  const tidy = rest.replace(/(\S) {2,}/g, '$1 ').replace(/ +([,)\];])/g, '$1').replace(/\( +/g, '(');
  return tidy ? `  ${indent}${tidy}` : '';
}).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '\n').trimEnd();

writeFileSync(new URL('../docs/navigation-puck.js', import.meta.url), `(function (root) {
  'use strict';

  // Generated from shared/src/navigationPuck.ts by
  // scripts/build-navigation-puck.mjs; edit the shared module, not this file.
  // scripts/check-navigation-puck.mjs runs shared fixtures against both.
${body}

  root.RiderNavigationPuck = Object.freeze({
${names.map((name) => `    ${name},`).join('\n')}
  });
})(typeof window !== 'undefined' ? window : globalThis);
`);
