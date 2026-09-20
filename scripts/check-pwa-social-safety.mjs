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
  'id="removeFriendBtn"',
  '/friends/${encodeURIComponent(friend.riderId)}',
  "request_exists: 'A friend request is already pending between you.'",
  "rate_limited: 'Too many requests. Wait a moment and try again.'",
  '!state.friends.some((friend) => friend.riderId === result.friend.riderId)',
]) {
  assert.ok(app.includes(required), `PWA social safety contract missing: ${required}`);
}

assert.ok(app.includes('window.confirm(`Block ${friend.displayName}?'), 'PWA block flow must require confirmation');
assert.ok(app.includes('window.confirm(`Remove ${friend.displayName} from your friends list?`)'), 'PWA remove-friend flow must require confirmation');
assert.equal(app.includes('already_requested:'), false, 'PWA friend request errors must use backend request_exists code');

for (const required of [
  'async function refreshFriendNetwork()',
  'async function refreshProfileAuthoritative()',
  'await Promise.all([\n            refreshFriendNetwork(),\n            refreshMessageSummaries(),\n            refreshProfileAuthoritative(),\n          ])',
  'if (activeChat) await loadChatMessages({ throwOnError: true });',
  'if (chatDirty && activeChat) await loadChatMessages({ throwOnError: true });',
]) {
  assert.ok(app.includes(required), `PWA social realtime recovery contract missing: ${required}`);
}

const realtimeLoop = section('async function runSocialEventLoop(generation)', 'function startSocialEvents()');
assert.equal(
  realtimeLoop.includes('await loadFriendsData();'),
  false,
  'Realtime cursor recovery must not call the UI wrapper that swallows refresh failures',
);


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
