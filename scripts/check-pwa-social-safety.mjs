import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const app = await readFile(new URL('../docs/app.js', import.meta.url), 'utf8');

for (const required of [
  "apiFetch('POST', '/reports'",
  "apiFetch('POST', '/blocks'",
  "$$('[data-report-rider]', $('#sheetBody'))",
  'state.friends = state.friends.filter',
  'nearbyRiders = nearbyRiders.filter',
]) {
  assert.ok(app.includes(required), `PWA social safety contract missing: ${required}`);
}

assert.ok(app.includes('window.confirm(`Block ${friend.displayName}?'), 'PWA block flow must require confirmation');
console.log('PWA report/block safety flow valid');
