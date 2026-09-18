import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPaths = ['.github/workflows/ci.yml', '.github/workflows/pages.yml'];
const workflows = await Promise.all(workflowPaths.map(async (path) => ({
  path,
  source: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
})));

for (const { path, source } of workflows) {
  const uses = [...source.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/g)];
  assert.ok(uses.length > 0, `${path} must declare its external actions`);
  for (const [, action, ref] of uses) {
    assert.match(ref, /^[a-f0-9]{40}$/, `${path}: ${action} must be pinned to an immutable commit SHA`);
  }
}

const pages = workflows.find(({ path }) => path.endsWith('pages.yml'))?.source ?? '';
assert.match(pages, /- run: npm ci(?:\n|$)/, 'Pages deployment must install the exact lockfile with npm ci');
assert.doesNotMatch(pages, /- run: npm install(?:\n|$)/, 'Pages deployment must not mutate dependency resolution');

console.log('Workflow action pins and deterministic installs valid');
