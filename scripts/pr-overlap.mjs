// Tells open pull requests when they change the same files as another open
// pull request, or claim the same database migration number, so agents
// coordinate before a merge conflict instead of after. It also flags a PR
// that mixes native app changes with a lot of backend or web work, since
// every push to it then starts the 35-minute native build.
//
// Run by .github/workflows/pr-overlap.yml with GITHUB_TOKEN and
// GITHUB_REPOSITORY. Each PR gets one comment, edited in place; nothing is
// posted for a PR with nothing to report. `--self-test` checks the logic.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- pr-overlap-check -->';
const NATIVE = /^(mobile\/|shared\/|package-lock\.json$|\.github\/workflows\/native-builds\.yml$)/;
const NON_NATIVE = /^(backend\/|docs\/)/;
/** Files every PR touches by regenerating them; overlaps there say nothing. */
const IGNORED = new Set(['docs/app.js']);
export const BROAD_THRESHOLD = 10;

/** Migration names a PR adds, read from the added lines of its migrations.ts patch. */
export function addedMigrations(patch = '') {
  return [...patch.matchAll(/^\+\s*name:\s*'(\d{4})_([a-z0-9_]+)'/gm)].map(([, number, name]) => ({ number, name }));
}

/** What to tell each PR: shared files, clashing migration numbers, broad native PRs. */
export function buildReports(prs) {
  const reports = new Map();
  for (const pr of prs) {
    const overlaps = [];
    const clashes = [];
    for (const other of prs) {
      if (other.number === pr.number) continue;
      const shared = pr.files.filter((file) => !IGNORED.has(file) && other.files.includes(file));
      if (shared.length) overlaps.push({ number: other.number, title: other.title, files: shared });
      for (const mine of pr.migrations) {
        const theirs = other.migrations.find((migration) => migration.number === mine.number);
        if (theirs) clashes.push({ number: other.number, migration: mine.number, mine: mine.name, theirs: theirs.name });
      }
    }
    const native = pr.files.filter((file) => NATIVE.test(file)).length;
    const nonNative = pr.files.filter((file) => NON_NATIVE.test(file)).length;
    reports.set(pr.number, { overlaps, clashes, broad: native > 0 && nonNative >= BROAD_THRESHOLD ? { native, nonNative } : null });
  }
  return reports;
}

export function commentBody(report) {
  const { overlaps, clashes, broad } = report;
  if (!overlaps.length && !clashes.length && !broad) return null;
  const lines = [MARKER, '**Automatic check: other open PRs**', ''];
  if (clashes.length) {
    lines.push('**Migration number clash.** Two PRs add a migration with the same number; only one can keep it. Agree who renumbers before either merges:');
    for (const clash of clashes) lines.push(`- \`${clash.migration}\`: \`${clash.mine}\` here vs \`${clash.theirs}\` in #${clash.number}`);
    lines.push('');
  }
  if (overlaps.length) {
    lines.push('**Files also changed by another open PR.** Coordinate before editing these further; whichever merges second must merge `main` and resolve them:');
    for (const overlap of overlaps) {
      const shown = overlap.files.slice(0, 8).map((file) => `\`${file}\``).join(', ');
      lines.push(`- #${overlap.number} (${overlap.title}): ${shown}${overlap.files.length > 8 ? ` and ${overlap.files.length - 8} more` : ''}`);
    }
    lines.push('');
  }
  if (broad) {
    lines.push(`**Native and non-native work together.** This PR changes ${broad.native} native-app file(s) and ${broad.nonNative} backend/web file(s), so every push runs the 35-minute native build. Consider moving the native part into its own PR.`);
    lines.push('');
  }
  lines.push('_Updated on every push to an open PR. It clears itself when nothing is left to report._');
  return lines.join('\n');
}

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function all(path) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const open = (await all(`/repos/${repo}/pulls?state=open`)).filter((pr) => pr.head.repo?.full_name === repo);
  const prs = [];
  for (const pr of open) {
    const files = await all(`/repos/${repo}/pulls/${pr.number}/files`);
    const migrationsPatch = files.find((file) => file.filename === 'backend/src/migrations.ts')?.patch ?? '';
    prs.push({ number: pr.number, title: pr.title, files: files.map((file) => file.filename), migrations: addedMigrations(migrationsPatch) });
  }
  const reports = buildReports(prs);
  for (const pr of prs) {
    const body = commentBody(reports.get(pr.number));
    const comments = await all(`/repos/${repo}/issues/${pr.number}/comments`);
    const existing = comments.find((comment) => comment.body?.startsWith(MARKER));
    const next = body ?? (existing ? `${MARKER}\n**Automatic check: other open PRs**\n\nNothing to report now.` : null);
    if (!next || existing?.body === next) continue;
    if (existing) await github(`/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body: next }) });
    else await github(`/repos/${repo}/issues/${pr.number}/comments`, { method: 'POST', body: JSON.stringify({ body: next }) });
    console.log(`#${pr.number}: ${existing ? 'updated' : 'posted'}`);
  }
}

function selfTest() {
  const patch = "@@\n+  {\n+    name: '0070_staff_content_removal',\n-    name: '0001_old',\n";
  assert.deepEqual(addedMigrations(patch), [{ number: '0070', name: 'staff_content_removal' }]);
  const reports = buildReports([
    { number: 1, title: 'A', files: ['docs/app.js', 'mobile/src/a.tsx', ...Array.from({ length: 10 }, (_, i) => `backend/src/f${i}.ts`)], migrations: [{ number: '0071', name: 'x' }] },
    { number: 2, title: 'B', files: ['docs/app.js', 'backend/src/f1.ts'], migrations: [{ number: '0071', name: 'y' }] },
    { number: 3, title: 'C', files: ['docs/app.js', 'README.md'], migrations: [] },
  ]);
  assert.deepEqual(reports.get(1).overlaps, [{ number: 2, title: 'B', files: ['backend/src/f1.ts'] }]);
  assert.deepEqual(reports.get(1).clashes, [{ number: 2, migration: '0071', mine: 'x', theirs: 'y' }]);
  assert.deepEqual(reports.get(1).broad, { native: 1, nonNative: 11 });
  assert.equal(reports.get(2).broad, null);
  assert.equal(commentBody(reports.get(3)), null, 'a regenerated file alone is not an overlap');
  const body = commentBody(reports.get(1));
  assert.ok(body.startsWith(MARKER) && body.includes('#2 (B): `backend/src/f1.ts`') && body.includes('`0071`') && body.includes('35-minute'));
  console.log('PR overlap check logic valid');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--self-test')) selfTest();
  else await main();
}
