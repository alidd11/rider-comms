/* global window */
import { test, expect } from '@playwright/test';
import { URL } from 'node:url';

const ownId = 'rider_abcd1234';
const aliceId = 'rider_alice001';
const bobId = 'rider_bob00001';
const backend = 'https://backend-production-7fa0.up.railway.app';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
const alice = { riderId: aliceId, displayName: 'Alice Rider', handle: 'alice-rider' };
const bob = { riderId: bobId, displayName: 'Bob Rider', handle: 'bob-rider' };
function directMessage(id, fromRiderId, toRiderId, text) {
  return { id, fromRiderId, toRiderId, text, createdAt: 1731000000 };
}
const aliceMessage = directMessage('alice-1', aliceId, ownId, 'Alice private message');
const bobMessage = directMessage('bob-1', bobId, ownId, 'Bob private message');
const sentMessage = directMessage('outbound-1', ownId, aliceId, 'Message sent while navigating');

function defer() {
  let resolve = () => {};
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function installFixture(page, { onRequest = async () => {} } = {}) {
  await page.route(backend + '/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    let body;
    let status = 200;
    if (path === '/auth/me') {
      body = { riderId: ownId, username: 'message-test', emailVerified: true,
        termsAccepted: true, termsVersion: 'terms-test' };
    } else if (path === '/riders/' + ownId + '/friends') {
      body = { friends: [alice, bob], nextCursor: null };
    } else if (path === '/conversations') {
      body = { conversations: [
        { friend: alice, lastMessage: aliceMessage, unreadCount: 0 },
        { friend: bob, lastMessage: bobMessage, unreadCount: 0 },
      ], nextCursor: null };
    } else if (path === '/profiles/batch') {
      body = { profiles: {} };
    } else if (path === '/messages' && method === 'GET') {
      const peer = url.searchParams.get('withRiderId');
      await onRequest({ path, method, peer });
      body = { messages: peer === aliceId ? [aliceMessage] : [bobMessage], nextCursor: null };
    } else if (path === '/messages' && method === 'POST') {
      await onRequest({ path, method });
      body = sentMessage;
    } else {
      status = 404;
      body = { error: 'not_found' };
    }
    await route.fulfill({ status, contentType: 'application/json',
      headers: cors, body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('rider_social_account_session_v1', 'synthetic-messages-only');
    window.sessionStorage.setItem('rider_social_age_ack_v1', 'rider_abcd1234');
  });
}

test('slow message loads never reveal the previous rider beneath another rider name', async ({ page }) => {
  const pendingAlice = defer();
  const aliceStarted = defer();
  const uncaught = [];
  page.on('pageerror', e => uncaught.push(e.message));
  await installFixture(page, { onRequest: async req => {
    if (req.method === 'GET' && req.peer === aliceId) {
      aliceStarted.resolve();
      await pendingAlice.promise;
    }
  } });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open messages' }).click();
    await page.getByRole('button', { name: 'Open conversation with Alice Rider' }).click();
    await aliceStarted.promise;
    await expect(page.getByTestId('shared-message-thread')).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await page.getByRole('button', { name: 'Open conversation with Bob Rider' }).click();
    await expect(page.getByText('Bob private message')).toBeVisible();
    pendingAlice.resolve();
    await expect(page.getByTestId('shared-message-bubbles')).not.toContainText('Alice private message');
    await expect(page.getByText('Bob Rider', { exact: true })).toBeVisible();
    expect(uncaught).toEqual([]);
  } finally {
    pendingAlice.resolve();
  }
});

test('slow outgoing response cannot append a private message to a different conversation', async ({ page }) => {
  const pendingSend = defer();
  const sendStarted = defer();
  const uncaught = [];
  page.on('pageerror', e => uncaught.push(e.message));
  await installFixture(page, { onRequest: async req => {
    if (req.method === 'POST' && req.path === '/messages') {
      sendStarted.resolve();
      await pendingSend.promise;
    }
  } });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open messages' }).click();
    await page.getByRole('button', { name: 'Open conversation with Alice Rider' }).click();
    await expect(page.getByText('Alice private message')).toBeVisible();
    await page.getByRole('textbox', { name: 'Write a message' })
      .fill('Message sent while navigating');
    await page.getByRole('button', { name: 'Send message' }).click();
    await sendStarted.promise;
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await page.getByRole('button', { name: 'Open conversation with Bob Rider' }).click();
    await expect(page.getByText('Bob private message')).toBeVisible();

    const sendResponse = page.waitForResponse(response =>
      response.url().includes('/messages') && response.request().method() === 'POST');
    pendingSend.resolve();
    await sendResponse;
    await page.waitForTimeout(100);
    await expect(page.getByTestId('shared-message-bubbles'))
      .not.toContainText('Message sent while navigating');
    await expect(page.getByText('Bob private message')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveValue('');
    expect(uncaught).toEqual([]);
  } finally {
    pendingSend.resolve();
  }
});


test('a failed inbox refresh clears stale private previews until a new successful fetch', async ({ page }) => {
  await installFixture(page);
  let refreshes = 0;
  // Override the fixture for this endpoint only.
  await page.route(backend + '/conversations?*', async route => {
    refreshes += 1;
    if (refreshes > 1) {
      await route.abort('failed');
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: cors, body: JSON.stringify({ conversations: [
          { friend: alice, lastMessage: aliceMessage, unreadCount: 0 },
          { friend: bob, lastMessage: bobMessage, unreadCount: 0 },
        ], nextCursor: null }) });
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open messages' }).click();
  await expect(page.getByText('Alice private message')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh shared messages' }).click();
  await expect(page.getByText('Can’t load your Rider Comms conversations. Try again.')).toBeVisible();
  await expect(page.getByText('Alice private message')).toHaveCount(0);
  await expect(page.getByText('Bob private message')).toHaveCount(0);
  await expect(page.getByTestId('social-app-recovery')).toHaveCount(0);
  expect(refreshes).toBe(2);
});

test('server-revoked friendship closes the former private conversation after refresh', async ({ page }) => {
  await installFixture(page);
  let refreshes = 0;
  let revoked = false;
  const initial = [
    { friend: alice, lastMessage: aliceMessage, unreadCount: 0 },
  ];
  // Revoke between the send response and the following graph refresh.
  // Do not rely on nondeterministic ordering of concurrent HTTP requests.
  await page.route(backend + '/messages', async route => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    revoked = true;
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: cors, body: JSON.stringify(sentMessage) });
  });
  await page.route(backend + '/conversations?*', async route => {
    refreshes += 1;
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ conversations: revoked ? [] : initial, nextCursor: null }) });
  });
  await page.route(backend + '/riders/' + ownId + '/friends?*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ friends: revoked ? [] : [alice], nextCursor: null }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open messages' }).click();
  await page.getByRole('button', { name: 'Open conversation with Alice Rider' }).click();
  await expect(page.getByText('Alice private message')).toBeVisible();
  await page.getByRole('textbox', { name: 'Write a message' }).fill('Checking friendship refresh');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => refreshes).toBe(2);
  await expect(page.getByTestId('shared-message-inbox')).toBeVisible();
  await expect(page.getByText('Alice private message')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveCount(0);
  await expect(page.getByTestId('social-app-recovery')).toHaveCount(0);
});
