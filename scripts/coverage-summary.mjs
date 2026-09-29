// Summarises the lcov files written by `npm run test:coverage` into a
// per-package line/function coverage table. Report-only: no thresholds yet,
// so coverage can be watched over time before any gate is set.
import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const reports = [
  ['shared', 'coverage/shared.lcov'],
  ['backend', 'coverage/backend.lcov'],
  ['mobile (node:test)', 'coverage/mobile-client.lcov'],
  ['mobile (Jest)', 'coverage/jest/lcov.info'],
];

function totals(lcov) {
  const sum = { lf: 0, lh: 0, fnf: 0, fnh: 0, files: 0 };
  for (const line of lcov.split('\n')) {
    const [key, value] = line.split(':');
    if (key === 'SF') sum.files += 1;
    else if (key === 'LF') sum.lf += Number(value);
    else if (key === 'LH') sum.lh += Number(value);
    else if (key === 'FNF') sum.fnf += Number(value);
    else if (key === 'FNH') sum.fnh += Number(value);
  }
  return sum;
}

const pct = (hit, found) => (found === 0 ? 'n/a' : `${((hit / found) * 100).toFixed(1)}%`);
const rows = ['| Package | Files | Lines | Functions |', '| --- | --- | --- | --- |'];
for (const [name, path] of reports) {
  let lcov;
  try {
    lcov = await readFile(path, 'utf8');
  } catch {
    rows.push(`| ${name} | not run | | |`);
    continue;
  }
  const t = totals(lcov);
  rows.push(`| ${name} | ${t.files} | ${pct(t.lh, t.lf)} (${t.lh}/${t.lf}) | ${pct(t.fnh, t.fnf)} |`);
}

const markdown = `## Test coverage\n\n${rows.join('\n')}\n`;
console.log(markdown);
await writeFile(join('coverage', 'summary.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
// Keep the directory listing in the log so a missing report is obvious.
console.log((await readdir('coverage')).join(' '));
