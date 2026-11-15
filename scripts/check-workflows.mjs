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

// Keep the Railway cron workspace independent between invocations. A fixed
// directory caused real production backup failures on alternating days.
const cron = await readFile(new URL('../ops/backup/run.sh', import.meta.url), 'utf8');
assert.ok(cron.includes('scratch="$(mktemp -d'), 'backup cron needs a unique scratch cluster');
assert.ok(cron.includes('workdir="$(mktemp -d'), 'backup cron needs a unique private staging directory');
assert.ok(cron.includes('trap cleanup EXIT'), 'backup cron must clean up after failure and success');
assert.ok(cron.includes('rm -rf -- "$scratch"'), 'backup cron must remove the restored database');
assert.ok(cron.includes('rm -rf -- "$workdir"'), 'backup cron must remove temporary dump artifacts');
assert.ok(!cron.includes('scratch=/tmp/verify-pg'), 'backup cron must never reuse fixed scratch cluster');
