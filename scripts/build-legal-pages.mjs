// Builds the public legal and support pages (docs/privacy.html, terms.html,
// guidelines.html, support.html) from the Markdown sources in legal/.
// Bracketed placeholders are filled from legal/site-details.json: a string
// replaces one (an empty string removes it), and null or a missing entry
// renders a visible "to be confirmed" marker so an unfinished field can't be
// missed, without raw [brackets] on a public page.
//
//   npm run build:legal          regenerate the pages
//   node scripts/build-legal-pages.mjs --check   fail if they're out of date (lint)
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PAGES = [
  { source: 'PRIVACY_POLICY_DRAFT.md', output: 'privacy.html', title: 'Privacy Policy', nav: 'Privacy', summary: 'What we collect, why, who we share it with, how long we keep it, and your choices.' },
  { source: 'TERMS_DRAFT.md', output: 'terms.html', title: 'Terms of Service', nav: 'Terms', summary: 'The agreement between you and Rider Comms when you use the app and web app.' },
  { source: 'COMMUNITY_GUIDELINES.md', output: 'guidelines.html', title: 'Community Guidelines', nav: 'Guidelines', summary: 'How we expect riders to treat each other, and what happens when someone doesn’t.' },
  { source: 'SUPPORT.md', output: 'support.html', title: 'Support', nav: 'Support', summary: 'Help with your account, voice, location and your data.' },
];
// Placeholders without a value survive escaping as this sentinel, then
// render as a neat marker.
const PENDING = '\uE000PENDING:';
const LINK_TARGETS = Object.fromEntries(PAGES.map((page) => [page.source, page.output]));

const slug = (text) => text.replace(/<[^>]+>/g, '').toLowerCase().replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(text) {
  return escapeHtml(text)
    .replace(/\uE000PENDING:([^\uE000]+)\uE000/g, (_, label) => `<span class="pending" title="Not filled in yet">${label} to be confirmed</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const target = LINK_TARGETS[href] ?? href;
      const external = /^https?:/.test(target);
      return `<a href="${target}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
    });
}

/** Just enough Markdown for these documents: headings, paragraphs, lists, tables. */
export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const html = inline(heading[2]);
      // Section headings get anchors so the contents list can link to them.
      out.push(level === 2 ? `<h2 id="${slug(html)}">${html}</h2>` : `<h${level}>${html}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i += 1; }
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
      const [head, , ...body] = rows;
      // Wide tables scroll sideways on phones, so the wrapper must be keyboard
      // focusable and named for screen readers (axe: scrollable-region-focusable).
      const tableLabel = cells(head).map((c) => c.replace(/<[^>]+>/g, '')).join(', ');
      // On phones each row stacks as a card; data-label carries the column
      // name into each cell for that layout.
      const headings = cells(head).map((c) => c.replace(/<[^>]+>/g, ''));
      out.push(`<div class="table" role="region" tabindex="0" aria-label="Table: ${tableLabel}"><table><thead><tr>${cells(head).map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${cells(row).map((c, index) => `<td data-label="${escapeHtml(headings[index] ?? '')}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
        if (/^- /.test(lines[i])) items.push(lines[i].slice(2));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) { paragraph.push(lines[i].trim()); i += 1; }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

function prepare(markdown, details) {
  let text = markdown
    .replace(/^# (.*?): DRAFT$/m, '# $1')
    // The engineering/legal-review note at the top is for this repo, not readers.
    .replace(/^> .*(\n> .*)*\n?/m, '');
  // Placeholders can wrap across lines in the source; match on collapsed whitespace.
  text = text.replace(/\[[^\]\n]*(?:\n[^\]\n]*)*\](?!\()/g, (match) => {
    const key = match.replace(/\s+/g, ' ');
    const value = details[key];
    if (typeof value === 'string') return value;
    unfilled.add(key);
    return `${PENDING}${key.slice(1, -1)}\uE000`;
  });
  // A removed field can leave "A ·  · B" or a trailing separator behind.
  return text
    .replace(/[ \t]*·[ \t]*(?:·[ \t]*)+/g, ' · ')
    .replace(/[ \t]*·[ \t]*$/gm, '')
    .replace(/^([^\n]*:)[ \t]*·[ \t]*/gm, '$1 ');
}

/** Pulls the title and "Last updated" line out of the body for the page header. */
function splitHeader(markdown) {
  let updated = '';
  const body = markdown
    .replace(/^# .*\n?/m, '')
    .replace(/^\*\*Last updated:\*\*\s*(.+)\n?/m, (_, date) => { updated = date.trim(); return ''; });
  return { body, updated };
}

function contents(bodyHtml) {
  const sections = [...bodyHtml.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
  if (sections.length < 3) return '';
  return `<nav class="toc" aria-label="On this page"><h2 class="toc-title">On this page</h2><ol>${sections.map(([, id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ol></nav>`;
}

function page({ title, output, summary }, bodyHtml, updated) {
  const navLinks = PAGES.map((entry) => `<a href="${entry.output}"${entry.output === output ? ' aria-current="page"' : ''}>${entry.nav}</a>`).join('');
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#080d10" media="(prefers-color-scheme: dark)">
  <meta name="description" content="${escapeHtml(summary)}">
  <title>${escapeHtml(title)} · Rider Comms</title>
  <link rel="stylesheet" href="legal.css">
  <link rel="icon" href="icons/icon-192.png">
</head>
<body>
  <!-- Generated by scripts/build-legal-pages.mjs from legal/. Edit those files, then run npm run build:legal. -->
  <a class="skip" href="#content">Skip to content</a>
  <header class="site">
    <div class="site-inner">
      <a class="brand" href="./"><img src="icons/icon-192.png" alt="" width="28" height="28"><span>Rider Comms</span></a>
      <nav aria-label="Legal and support">${navLinks}</nav>
    </div>
  </header>
  <main id="content">
    <header class="doc-head">
      <p class="eyebrow">Rider Comms</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="summary">${escapeHtml(summary)}</p>
      ${updated ? `<p class="updated">Last updated <time>${escapeHtml(updated)}</time></p>` : ''}
    </header>
    ${contents(bodyHtml)}
    <article class="doc">
${bodyHtml}
    </article>
  </main>
  <footer class="site-foot">
    <div class="site-inner">
      <nav aria-label="Footer">${PAGES.map((entry) => `<a href="${entry.output}">${entry.title}</a>`).join('')}</nav>
      <p>© ${new Date(updatedYear(updated)).getFullYear()} Rider Comms · <a href="./">Open the web app</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

// The footer year follows the documents' date, not the build clock, so the
// --check build stays reproducible.
function updatedYear(updated) {
  const year = updated.match(/\b(20\d\d)\b/)?.[1];
  return year ? `${year}-06-01` : '2026-06-01';
}

const unfilled = new Set();
const details = JSON.parse(await readFile(resolve('legal/site-details.json'), 'utf8'));
const check = process.argv.includes('--check');
const stale = [];
for (const entry of PAGES) {
  const markdown = await readFile(resolve('legal', entry.source), 'utf8');
  const { body, updated } = splitHeader(prepare(markdown, details));
  const html = page(entry, markdownToHtml(body), updated);
  const target = resolve('docs', entry.output);
  if (check) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== html) stale.push(entry.output);
  } else {
    await writeFile(target, html);
  }
}
if (!check && unfilled.size) {
  console.warn(`Still to fill in legal/site-details.json: ${[...unfilled].join(', ')}`);
}
if (stale.length) {
  console.error(`Legal pages are out of date (${stale.join(', ')}). Run npm run build:legal.`);
  process.exit(1);
}
console.log(check ? 'Legal pages up to date' : `Wrote ${PAGES.map((p) => p.output).join(', ')}`);
