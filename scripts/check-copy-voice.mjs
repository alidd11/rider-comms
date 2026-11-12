// House style for words people read in either app (docs/app, docs/index.html
// and mobile/src). Copy should read as written by one person who rides:
// plain, short, contractions, no filler. See COPY.md.
//
// Checked in every UI string literal and piece of JSX text (comments and
// code are left alone; the editorial route catalogue and legal pages keep
// their own style):
// - no spaced em dash used as a separator ("Muted — tap to unmute"): use a
//   full stop ("Muted. Tap to unmute.")
// - contractions with a curly apostrophe: "Couldn’t", "don’t", "isn’t", never
//   "Could not" or "don't"
// - no "Please", no "proximity voice" (the feature is Nearby Voice), and the
//   app doesn't talk about itself in the third person ("Rider Comms couldn’t…")
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('..', import.meta.url).pathname;
const RULES = [
  [/\S — \S/, 'spaced em dash as a separator: use a full stop'],
  [/\b(Could not|could not|[Cc]annot|[Dd]o not|[Dd]oes not|is not|are not|will not|was not|has not|have not|did not)\b/, 'write the contraction (Couldn’t, can’t, don’t…)'],
  [/[A-Za-z]'(s|t|re|ll|ve|d|m)\b/, 'use a curly apostrophe (’)'],
  [/\bPlease\b|\bplease\b/, 'drop “please”: say what to do'],
  [/proximity voice/i, 'the feature is called Nearby Voice'],
  [/Rider Comms (couldn’t|can’t|could not|cannot)/, 'say what happened (“Couldn’t…”), not “Rider Comms couldn’t…”'],
  [/^AI$/, 'placeholder text'],
];
const looksLikeCopy = (text) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) || /^AI$/.test(text.trim());

async function files(dir, keep) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const failures = [];
function check(file, line, text) {
  if (!looksLikeCopy(text)) return;
  for (const [pattern, why] of RULES) {
    if (pattern.test(text)) failures.push(`${path.relative(root, file)}:${line}: ${why}\n    ${text.trim().replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

const sources = [
  ...await files(path.join(root, 'docs/app'), (file) => file.endsWith('.js')),
  ...await files(path.join(root, 'mobile/src'), (file) => /\.tsx?$/.test(file) && !file.endsWith('curatedRoutes.ts')),
];
for (const file of sources) {
  const source = await readFile(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node) => {
    // Developer-facing text: thrown errors and console output.
    if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText())) return;
    if (ts.isCallExpression(node) && /^console\./.test(node.expression.getText())) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(file, lineOf(node), node.text);
    else if (ts.isTemplateExpression(node)) check(file, lineOf(node), [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' … '));
    else if (ts.isJsxText(node)) check(file, lineOf(node), node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Static text and labels in the web app's page.
const index = (await readFile(path.join(root, 'docs/index.html'), 'utf8')).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
for (const match of index.matchAll(/>([^<>]+)<|(?:aria-label|placeholder|title|alt)="([^"]+)"/g)) {
  const text = match[1] ?? match[2];
  check(path.join(root, 'docs/index.html'), index.slice(0, match.index).split('\n').length, text);
}

if (failures.length) {
  console.error(`Copy doesn’t follow the house style (COPY.md):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Copy voice valid: ${sources.length + 1} files`);
