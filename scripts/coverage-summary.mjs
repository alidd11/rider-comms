// Summarises the lcov files written by `npm run test:coverage` into a
// per-package line/function coverage table, and fails if any package's line
// coverage drops below its floor.
import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

// [name, lcov path, minimum line coverage %]. Floors sit ~2 points under the
// coverage measured when they were set (2026-09-29: 97.6 / 90.2 / 90.2;
// mobile Jest raised on 2026-09-30 at 86.5; on 2026-10-03 shared code and the
// API client stopped being double-counted in the mobile reports, which then
// read 98.5 / 91.6, and backend likewise stopped counting shared code at 95.1), so normal churn passes but a
// real regression fails CI. Raise them as
// coverage improves; never lower one to get a change through.
const reports = [
  ['shared', 'coverage/shared.lcov', 95],
  ['backend', 'coverage/backend.lcov', 93],
  ['mobile (node:test)', 'coverage/mobile-client.lcov', 96],
  ['mobile (Jest)', 'coverage/jest/lcov.info', 89],
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
const rows = ['| Package | Files | Lines | Floor | Functions |', '| --- | --- | --- | --- | --- |'];
const failures = [];
for (const [name, path, floor] of reports) {
  let lcov;
  try {
    lcov = await readFile(path, 'utf8');
  } catch {
    rows.push(`| ${name} | not run | | ${floor}% | |`);
    failures.push(`${name}: no coverage report at ${path}`);
    continue;
  }
  const t = totals(lcov);
  const linePct = t.lf === 0 ? 0 : (t.lh / t.lf) * 100;
  if (linePct < floor) failures.push(`${name}: line coverage ${linePct.toFixed(1)}% is below the ${floor}% floor`);
  rows.push(`| ${name} | ${t.files} | ${pct(t.lh, t.lf)} (${t.lh}/${t.lf}) | ${floor}% | ${pct(t.fnh, t.fnf)} |`);
}

const markdown = `## Test coverage\n\n${rows.join('\n')}\n`;
console.log(markdown);
await writeFile(join('coverage', 'summary.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
// Keep the directory listing in the log so a missing report is obvious.
console.log((await readdir('coverage')).join(' '));

if (failures.length > 0) {
  console.error(`Coverage check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
