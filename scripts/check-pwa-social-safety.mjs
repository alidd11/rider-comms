import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const app = await readFile(new URL('../docs/app.js', import.meta.url), 'utf8');

for (const required of [
  "apiFetch('POST', '/reports'",
  "apiFetch('POST', '/blocks'",
  "$$('[data-report-rider]', $('#sheetBody'))",
  'state.friends = state.friends.filter',
  'nearbyRiders = nearbyRiders.filter',
  "apiFetch('DELETE', `/friends/requests/${encodeURIComponent(requestId)}`)",
  "id=\"sheetInstagramVisibility\"",
  "id=\"sheetTiktokVisibility\"",
]) {
  assert.ok(app.includes(required), `PWA social safety contract missing: ${required}`);
}

assert.ok(app.includes('window.confirm(`Block ${friend.displayName}?'), 'PWA block flow must require confirmation');

function section(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not inspect PWA section: ${startMarker}`);
  return app.slice(start, end);
}

const hazardFlow = section('async function createHazard', 'function visibleMapRiders');
assert.equal(
  hazardFlow.includes('preflightMicrophoneAccess'),
  false,
  'Hazard reporting must never depend on microphone permission',
);

const nearbyFlow = section('async function toggleNearby', 'function currentPosition');
assert.ok(
  nearbyFlow.includes('if (!(await preflightMicrophoneAccess())) return;'),
  'Nearby Voice must preflight microphone access from the deliberate Go Live action',
);
console.log('PWA report/block safety flow valid');
