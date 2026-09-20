import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../docs/message-state.js', import.meta.url), 'utf8');
const parity = JSON.parse(fs.readFileSync(new URL('../client-parity.json', import.meta.url), 'utf8'));

for (const expected of [
  'id="chatScreen"',
  'role="log"',
  'id="chatComposer"',
  'maxlength="1000"',
  'message-state.js?v=1',
]) assert.ok(html.includes(expected), `PWA chat markup missing ${expected}`);

for (const expected of [
  "apiFetch('GET', `/messages?${query.toString()}`)",
  "apiFetch('POST', '/messages'",
  "apiFetch('POST', '/messages/read'",
  "apiFetch('GET', '/messages/unread-count')",
  "apiFetch('GET', '/social/events?limit=100&waitMs=0')",
  'loadAllConversationPages()',
  'chatPeerReadThroughMessageId',
  "window.RiderMovementSafety.isLockedForSafety(movementState)",
  "$$('[data-retry-message]', messages)",
  'openFriendSafetyActions(activeChat)',
]) assert.ok(app.includes(expected), `PWA chat implementation missing ${expected}`);
assert.equal(app.includes('MESSAGE_POLL_INTERVAL_MS'), false, 'PWA DMs must not fall back to fixed-interval message polling');
assert.equal(app.includes('syncChatPolling'), false, 'PWA DMs must use the durable social event feed');

const clearSessionStart = app.indexOf('function clearSession()');
const clearSessionEnd = app.indexOf('const state = loadState()', clearSessionStart);
assert.ok(clearSessionStart >= 0 && clearSessionEnd > clearSessionStart, 'Could not inspect PWA session cleanup');
const clearSession = app.slice(clearSessionStart, clearSessionEnd);
assert.ok(clearSession.includes('stopSocialEvents();'), 'PWA logout must invalidate the social realtime generation');
assert.ok(clearSession.includes('clearInterval(friendActivityTimer);'), 'PWA logout must stop friend activity polling');

const context = vm.createContext({ globalThis: {} });
vm.runInContext(helper, context);
const { acknowledge, dedupe, reconcile } = context.globalThis.RiderMessageState;
const fetched = [{ id: 'server-1', createdAt: 10 }, { id: 'server-2', createdAt: 20 }];
const current = [
  { id: 'server-1', createdAt: 10 },
  { id: 'local-pending', createdAt: 30, status: 'pending' },
  { id: 'local-failed', createdAt: 40, status: 'failed' },
  { id: 'stale-server', createdAt: 5 },
];
assert.deepEqual(
  Array.from(reconcile(current, fetched), (message) => message.id),
  ['server-1', 'server-2', 'local-pending', 'local-failed'],
  'refresh must retain only unsent local messages alongside server truth',
);
assert.deepEqual(
  Array.from(dedupe([{ id: '2', createdAt: 20 }, { id: '1', createdAt: 10 }, { id: '2', createdAt: 20 }]), (message) => message.id),
  ['1', '2'],
  'older-page merge must deduplicate and sort messages',
);
assert.deepEqual(
  Array.from(
    acknowledge(
      [
        { id: 'server-1', createdAt: 10 },
        { id: 'server-ack', createdAt: 30 },
        { id: 'local-pending', createdAt: 20, status: 'pending' },
      ],
      'local-pending',
      { id: 'server-ack', createdAt: 30 },
    ),
    (message) => message.id,
  ),
  ['server-1', 'server-ack'],
  'send acknowledgement must not duplicate a message already delivered by realtime',
);

const capability = parity.capabilities.find(({ id }) => id === 'direct-messages');
assert.deepEqual(capability, { id: 'direct-messages', pwa: true, native: true, status: 'parity' });

console.log('PWA direct-message parity checks passed.');
