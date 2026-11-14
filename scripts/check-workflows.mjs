import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPaths = ['.github/workflows/ci.yml', '.github/workflows/pages.yml', '.github/workflows/backup.yml', '.github/workflows/uptime.yml', '.github/workflows/native-builds.yml'];
// The uptime check only runs curl and gh, so it uses no external actions.
const actionFreeWorkflows = new Set(['.github/workflows/uptime.yml']);
const workflows = await Promise.all(workflowPaths.map(async (path) => ({
  path,
  source: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
})));

for (const { path, source } of workflows) {
  const uses = [...source.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/g)];
  assert.ok(uses.length > 0 || actionFreeWorkflows.has(path), `${path} must declare its external actions`);
  for (const [, action, ref] of uses) {
    assert.match(ref, /^[a-f0-9]{40}$/, `${path}: ${action} must be pinned to an immutable commit SHA`);
  }
}

const pages = workflows.find(({ path }) => path.endsWith('pages.yml'))?.source ?? '';
assert.match(pages, /- run: npm ci(?:\n|$)/, 'Pages deployment must install the exact lockfile with npm ci');
assert.doesNotMatch(pages, /- run: npm install(?:\n|$)/, 'Pages deployment must not mutate dependency resolution');

console.log('Workflow action pins and deterministic installs valid');

// Cron workspace reuse must never make a valid next-day backup fail.
// The backup container can be reused between invocations: scratch and stage
// paths must be unique, cleaned on error, and not fixed under /tmp.
const cron = await readFile('ops/backup/run.sh', 'utf8');
assert.match(cron, /scratch="\\$\\(mktemp -d/, 'backup cron must generate a unique scratch cluster');
assert.match(cron, /workdir="\\$\\(mktemp -d/, 'backup cron must use a unique private staging directory');
assert.match(cron, /trap cleanup EXIT/, 'backup cron must clean files after success and failure');
assert.match(cron, /rm -rf -- "\\$scratch"/, 'backup cron must destroy restored data after each run');
assert.match(cron, /rm -rf -- "\\$workdir"/, 'backup cron must destroy the encrypted staging workspace');
assert.doesNotMatch(cron, /scratch=\\/?tmp\\/verify-pg(?:\\s|$)/m, 'fixed scratch directory caused intermittent real backup failures');
