import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const workflowPaths = ['.github/workflows/ci.yml', '.github/workflows/pages.yml', '.github/workflows/backup.yml', '.github/workflows/uptime.yml', '.github/workflows/native-builds.yml', '.github/workflows/security-isolated.yml'];
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

const native = workflows.find(({ path }) => path.endsWith('native-builds.yml'))?.source ?? '';
assert.ok(native.includes("scripts/maestro_transport.py"), 'iOS recovery must require the transport-only classifier');
assert.ok(native.includes('for attempt in 1 2; do'), 'iOS recovery must allow only two total attempts');
assert.ok(native.includes('maestro-ios-attempt-${attempt}.xml'), 'iOS recovery must retain numbered JUnit evidence');
assert.ok(native.includes('maestro-ios-attempt-${attempt}.log'), 'iOS recovery must retain numbered, redacted console evidence');
assert.ok(native.includes('redact_test_password'), 'iOS recovery must redact credentials before logging/uploading');
assert.ok(native.includes('xcrun simctl bootstatus'), 'XCTest recovery must reboot the simulator');
assert.ok(native.includes('exit "$test_status"'), 'a real UI assertion must remain fatal');
assert.ok(!native.includes('maestro-ios-first-attempt.xml'), 'Maps must not retain the duplicate pre-579 JUnit path');

const classifierTests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_maestro_transport.py'], { encoding: 'utf8' });
assert.equal(classifierTests.status, 0, `iOS Maestro transport classifier must pass synthetic tests: ${classifierTests.stderr || classifierTests.error || ''}`);

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
