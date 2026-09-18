import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [html, css, appJs] = await Promise.all([
  readFile(resolve('docs/index.html'), 'utf8'),
  readFile(resolve('docs/app.css'), 'utf8'),
  readFile(resolve('docs/app.js'), 'utf8'),
]);

const viewportTags = html.match(/<meta\b[^>]*\bname=(["'])viewport\1[^>]*>/gi) ?? [];
if (viewportTags.length !== 1) {
  throw new Error(`Expected exactly one viewport meta tag, found ${viewportTags.length}`);
}

for (const token of ['width=device-width', 'viewport-fit=cover']) {
  if (!viewportTags[0].includes(token)) {
    throw new Error(`Viewport meta tag must include ${token}`);
  }
}

if (/\binset-bottom\s*:/.test(css)) {
  throw new Error('Invalid CSS property "inset-bottom" found; use bottom or the inset shorthand');
}

const requiredCssMarkers = [
  '--app-vh:100dvh',
  '--visual-vh:100dvh',
  '--bottom-control-inset:0px',
  '--navigation-control-inset:0px',
  '--bottom-nav-height:calc(var(--nav-height) + var(--bottom-control-inset) + 1px)',
  'html.pwa-standalone{--nav-safe-bottom:var(--bottom-safe-area);--bottom-control-inset:0px;--navigation-control-inset:min(18px,var(--bottom-safe-area))}',
];

for (const marker of requiredCssMarkers) {
  if (!css.includes(marker)) {
    throw new Error(`Required viewport CSS marker is missing: ${marker}`);
  }
}

const requiredJsMarkers = [
  "root.style.setProperty('--app-vh'",
  "root.style.setProperty('--visual-vh'",
  "root.style.setProperty('--visual-viewport-top'",
  "root.style.setProperty('--bottom-safe-area'",
  "const appHeight = isStandalone ? '100vh'",
  "viewport-fit=auto",
];

for (const marker of requiredJsMarkers) {
  if (!appJs.includes(marker)) {
    throw new Error(`Required viewport synchronisation is missing: ${marker}`);
  }
}

function findExactDuplicateRules(source) {
  const stack = [];
  const seen = new Map();
  const duplicates = [];
  let boundary = 0;
  let line = 1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '{') {
      const header = source.slice(boundary, index).trim();
      stack.push({ header, open: index, line });
      boundary = index + 1;
      continue;
    }

    if (character === '}') {
      const node = stack.pop();
      if (node && !node.header.trim().startsWith('@')) {
        const selector = node.header
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .trim()
          .replace(/\s+/g, ' ');
        const body = source
          .slice(node.open + 1, index)
          .trim()
          .replace(/\s+/g, ' ');
        const scope = stack
          .map((entry) => entry.header
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim()
            .replace(/\s+/g, ' '))
          .filter((header) => header.startsWith('@'))
          .join(' > ');

        if (selector && body) {
          const key = `${scope}||${selector}||${body}`;
          const firstLine = seen.get(key);
          if (firstLine) {
            duplicates.push({ selector, scope, firstLine, duplicateLine: node.line });
          } else {
            seen.set(key, node.line);
          }
        }
      }
      boundary = index + 1;
      continue;
    }

    if (character === '\n') line += 1;
  }

  return duplicates;
}

const duplicates = findExactDuplicateRules(css);
if (duplicates.length) {
  const details = duplicates
    .map(({ selector, scope, firstLine, duplicateLine }) =>
      `${selector} (${scope || 'global'}): lines ${firstLine} and ${duplicateLine}`)
    .join('\n');
  throw new Error(`Exact duplicate CSS rules found:\n${details}`);
}

console.log('PWA viewport integrity check passed');
