// Friends, friend requests, direct messages and hideouts.
import { expect, test } from '@playwright/test';
import { RIDER_ID, mockAuthenticatedApi, assertNoViewportOverflow, installStandaloneFixture } from './helpers.js';

test('PWA Friends remains usable when realtime transport is temporarily unavailable', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname === '/social/events') return { status: 503, body: { error: 'temporarily_unavailable' } };
    return null;
  });
  await page.goto('/#friends');
  await expect(page.locator('#friendList [data-friend]')).toHaveCount(2);
  await expect(page.locator('#friendList')).toContainText('Maya');
  await expect(page.locator('#friendList')).toContainText('Jay');
});

test('PWA Friends shows a load failure on the page and Retry recovers', async ({ page }) => {
  let failFriends = true;
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (failFriends && url.pathname === `/riders/${RIDER_ID}/friends`) return { status: 503, body: { error: 'temporarily_unavailable' } };
    return null;
  });
  await page.goto('/#friends');
  await expect(page.locator('#friendsError')).toBeVisible();
  await expect(page.locator('#friendsError')).toContainText('Could not load friends');
  // No "build your circle" prompt while the list is unknown.
  await expect(page.locator('#friendEmpty')).toBeHidden();
  failFriends = false;
  await page.getByRole('button', { name: 'Retry loading friends' }).click();
  await expect(page.locator('#friendsError')).toBeHidden();
  await expect(page.locator('#friendsLoading')).toBeHidden();
  await expect(page.locator('#friendList [data-friend]')).toHaveCount(2);
});

test('PWA preserves backend avatar presets on friend surfaces', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#friends');

  const avatars = page.locator('#friendList .avatar');
  await expect(avatars).toHaveCount(2);
  await expect(avatars.nth(0)).toHaveCSS('--avatar', '#4C8BF5');
  await expect(avatars.nth(1)).toHaveCSS('--avatar', '#3DD68C');
});

test('PWA direct messages load, mark read and send within a friend-only thread', async ({ page }) => {
  const sent = [];
  const readMarks = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      expect(url.searchParams.get('withRiderId')).toBe('rider_friend01');
      return { body: { messages: [{ id: 'message-1', fromRiderId: 'rider_friend01', toRiderId: RIDER_ID, text: 'Meet at the petrol station?', createdAt: 1_700_000_000_000 }], nextCursor: null, peerReadThroughMessageId: null } };
    }
    if (url.pathname === '/messages/read' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      readMarks.push(body);
      return { body: { readThroughSeq: 1 } };
    }
    if (url.pathname === '/messages' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      sent.push(body);
      return { status: 201, body: { id: 'message-2', fromRiderId: RIDER_ID, toRiderId: body.toRiderId, text: body.text, createdAt: 1_700_000_001_000 } };
    }
    if (url.pathname === '/profiles/rider_friend01') return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    return null;
  });

  await page.goto('/#friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('#chatMessages')).toContainText('Meet at the petrol station?');
  await expect.poll(() => readMarks).toContainEqual({ withRiderId: 'rider_friend01' });
  await page.locator('#chatInput').fill('On my way');
  await page.locator('#chatSend').click();
  await expect.poll(() => sent).toEqual([{ toRiderId: 'rider_friend01', text: 'On my way' }]);
  await expect(page.locator('#chatMessages')).toContainText('On my way');
  await expect(page.locator('#chatSafety')).toHaveAccessibleName('Report or block rider');
  await assertNoViewportOverflow(page);
});

test('PWA Hideouts can be loaded, created and deleted from a friend chat', async ({ page }) => {
  let hideouts = [
    {
      id: 'hideout-1',
      name: 'Petrol stop',
      lat: 51.5074,
      lon: -0.1278,
      createdBy: RIDER_ID,
      participantIds: ['rider_friend01'],
      createdAt: 1_700_000_000_000,
    },
    {
      id: 'hideout-unrelated',
      name: 'Other rider meeting point',
      lat: 51.52,
      lon: -0.11,
      createdBy: RIDER_ID,
      participantIds: ['rider_friend02'],
      createdAt: 1_700_000_000_500,
    },
  ];
  const created = [];

  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      return { body: { messages: [], nextCursor: null } };
    }
    if (url.pathname === `/riders/${RIDER_ID}/hideouts` && request.method() === 'GET') {
      return { body: { hideouts } };
    }
    if (url.pathname === '/hideouts' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      created.push(body);
      const saved = {
        id: 'hideout-new',
        name: body.name,
        lat: body.lat,
        lon: body.lon,
        createdBy: RIDER_ID,
        participantIds: body.participantIds,
        createdAt: 1_700_000_001_000,
      };
      hideouts = [...hideouts, saved];
      return { status: 201, body: saved };
    }
    if (url.pathname === '/hideouts/hideout-1' && request.method() === 'DELETE') {
      hideouts = hideouts.filter((hideout) => hideout.id !== 'hideout-1');
      return { body: {} };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    }
    return null;
  });

  await page.goto('/#friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();

  await expect(page.locator('#chatHideouts')).toBeVisible();
  await expect(page.locator('#chatHideoutList')).toContainText('Petrol stop');
  await expect(page.locator('#chatHideoutList')).not.toContainText('Other rider meeting point');
  await expect(page.locator('[data-open-hideout="hideout-1"]')).toHaveText('Google Maps');

  await page.locator('#chatHideoutPlan').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Plan a hideout');
  await page.locator('#hideoutName').fill('Cafe meetup');
  await page.locator('#hideoutLat').fill('51.515');
  await page.locator('#hideoutLon').fill('-0.101');
  await page.locator('#saveHideoutBtn').click();

  await expect.poll(() => created).toEqual([{
    name: 'Cafe meetup',
    lat: 51.515,
    lon: -0.101,
    participantIds: ['rider_friend01'],
  }]);
  await expect(page.locator('#chatHideoutList')).toContainText('Cafe meetup');

  await page.locator('[data-delete-hideout="hideout-1"]').click();
  await expect(page.locator('#chatHideoutList')).not.toContainText('Petrol stop');
  await assertNoViewportOverflow(page);
});

test('@viewport PWA chat stays pinned to the visible viewport when the keyboard changes geometry', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const listeners = { resize: new Set(), scroll: new Set() };
    const viewport = {
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener(type, listener) { listeners[type]?.add(listener); },
      removeEventListener(type, listener) { listeners[type]?.delete(listener); },
    };
    let rootScrollY = 0;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => rootScrollY });
    window.__setRiderTestRootScrollY = (value) => {
      rootScrollY = value;
      window.dispatchEvent(new Event('scroll'));
    };
    window.__setRiderTestVisualViewport = (height, offsetTop = 0) => {
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      listeners.resize.forEach((listener) => listener(new Event('resize')));
      listeners.scroll.forEach((listener) => listener(new Event('scroll')));
    };
  });

  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      return { body: { messages: [], nextCursor: null } };
    }
    if (url.pathname === `/riders/${RIDER_ID}/hideouts` && request.method() === 'GET') {
      return { body: { hideouts: [] } };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    }
    return null;
  });

  await page.goto('/#friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('#chatInput')).not.toBeFocused();
  await expect(page.locator('body')).toHaveCSS('position', 'relative');

  await page.evaluate(() => document.documentElement.style.setProperty('--bottom-safe-area', '34px'));
  const closedComposerPaddingBottom = await page.locator('#chatComposer').evaluate((element) => getComputedStyle(element).paddingBottom);
  expect(parseFloat(closedComposerPaddingBottom)).toBe(44);

  const initialViewportHeight = await page.evaluate(() => window.innerHeight);
  const keyboardViewportHeight = Math.max(220, Math.round(initialViewportHeight * 0.58));
  const keyboardOffsetTop = Math.min(64, Math.round(initialViewportHeight * 0.08));
  await page.evaluate(({ height, offsetTop }) => {
    window.__setRiderTestVisualViewport(height, offsetTop);
  }, { height: keyboardViewportHeight, offsetTop: keyboardOffsetTop });

  await expect(page.locator('html')).toHaveClass(/keyboard-open/);
  await expect(page.locator('#chatHideouts')).toBeHidden();

  // Model the installed-iOS failure seen on-device: WebKit pans the document
  // itself while leaving visualViewport.offsetTop at zero. The app must
  // detect that root pan and compensate the chat surface instead of letting
  // the header disappear above the status bar and leaving a gap by keyboard.
  await page.evaluate(() => window.__setRiderTestRootScrollY(84));
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--chat-root-pan')
  )).toBe('84px');
  await page.evaluate(() => window.__setRiderTestRootScrollY(0));
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--chat-root-pan')
  )).toBe('0px');

  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y) : -1;
  }).toBe(keyboardOffsetTop);

  const [chatBox, headerBox, composerBox] = await Promise.all([
    page.locator('#chatScreen').boundingBox(),
    page.locator('.chat-header').boundingBox(),
    page.locator('#chatComposer').boundingBox(),
  ]);
  expect(chatBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(Math.abs(chatBox.height - keyboardViewportHeight)).toBeLessThanOrEqual(1);
  expect(headerBox.y).toBeGreaterThanOrEqual(chatBox.y - 1);
  const composerBottomGap = (chatBox.y + chatBox.height) - (composerBox.y + composerBox.height);
  // A keyboard-open WebKit viewport may let the composer extend into the
  // system-owned home-indicator remainder. It must never leave a positive
  // blank band, and any overlap must stay within the modelled 34px safe area.
  expect(composerBottomGap).toBeLessThanOrEqual(1);
  expect(composerBottomGap).toBeGreaterThanOrEqual(-34);
  const openComposerPaddingBottom = await page.locator('#chatComposer').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
  expect(openComposerPaddingBottom).toBe(10);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-chat-keyboard-viewport.png`),
    clip: {
      x: Math.max(0, chatBox.x),
      y: Math.max(0, chatBox.y),
      width: chatBox.width,
      height: chatBox.height,
    },
  });

  await page.evaluate(({ height }) => {
    window.__setRiderTestVisualViewport(height, 0);
  }, { height: initialViewportHeight });

  await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
  await expect(page.locator('body')).toHaveCSS('position', 'relative');
  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y + box.height) : -1;
  }).toBe(initialViewportHeight);

  // Repeat the same open/dismiss transition in one page session. WebKit has
  // historically retained a shrunken viewport after the first keyboard, so a
  // single cycle is not a sufficient regression check.
  await page.evaluate(({ height, offsetTop }) => {
    window.__setRiderTestVisualViewport(height, offsetTop);
  }, { height: keyboardViewportHeight, offsetTop: keyboardOffsetTop });
  await expect(page.locator('html')).toHaveClass(/keyboard-open/);
  await page.evaluate(({ height }) => {
    window.__setRiderTestVisualViewport(height, 0);
  }, { height: initialViewportHeight });
  await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y + box.height) : -1;
  }).toBe(initialViewportHeight);

  await page.locator('#chatBack').click();
  await expect(page.locator('#chatScreen')).toBeHidden();
  await expect(page.locator('[data-screen="friends"]')).toBeVisible();
});

test('PWA incoming friend requests offer report and block', async ({ page }) => {
  const blocks = [];
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === `/riders/${RIDER_ID}/friend-requests`) return { body: {
      incoming: [{ id: 'request-1', fromRiderId: 'rider_stranger', toRiderId: RIDER_ID, status: 'pending', createdAt: Date.now() }],
      outgoing: [],
      profiles: { rider_stranger: { riderId: 'rider_stranger', displayName: 'Stranger', handle: '@stranger', avatarId: 'ember' } },
      nextCursor: null,
    } };
    if (url.pathname === '/blocks' && request.method() === 'POST') { blocks.push(request.postDataJSON()); return { status: 201, body: { ok: true } }; }
    return null;
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/#friends');
  const safety = page.locator('[data-request-safety="request-1"]');
  await expect(safety).toHaveAttribute('aria-label', 'Report or block Stranger');
  await safety.evaluate((button) => button.click());
  await expect(page.locator('#sheetTitle')).toHaveText('Stranger');
  await page.locator('#riderBlockBtn').click();
  await expect.poll(() => blocks).toEqual([{ riderId: 'rider_stranger' }]);
  await expect(page.locator('[data-request-safety="request-1"]')).toHaveCount(0);
});

test('PWA chat labels each day and keeps the composer on screen', async ({ page }) => {
  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;
  await installStandaloneFixture(page);
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') return { body: { messages: [
      { id: 'm1', fromRiderId: RIDER_ID, toRiderId: 'rider_friend01', text: 'Yoo', createdAt: yesterday },
      { id: 'm2', fromRiderId: RIDER_ID, toRiderId: 'rider_friend01', text: 'Still on for Sunday?', createdAt: now - 60_000 },
    ], nextCursor: null, peerReadThroughMessageId: null } };
    if (url.pathname === '/profiles/rider_friend01') return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    return null;
  });
  await page.goto('/#friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatMessages .chat-day')).toHaveText(['Yesterday', 'Today']);
  // Installed: the chat shares the app shell's full-canvas height, so the
  // composer sits on the home-indicator safe area like the tab bar does.
  const [chatHeight, shellHeight] = await page.evaluate(() => [
    document.querySelector('#chatScreen').getBoundingClientRect().height,
    document.querySelector('.app-shell')?.getBoundingClientRect().height ?? window.innerHeight,
  ]);
  expect(Math.abs(chatHeight - shellHeight)).toBeLessThanOrEqual(1);
  const composer = await page.locator('#chatComposer').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(composer.y + composer.height).toBeLessThanOrEqual(viewportHeight + 0.5);
  await expect(page.locator('#chatInput')).toBeInViewport({ ratio: 1 });
});

test('PWA chat uses the body canvas and keeps its controls above the safe area', async ({ page }) => {
  await installStandaloneFixture(page);
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') return { body: { messages: [], nextCursor: null, peerReadThroughMessageId: null } };
    if (url.pathname === '/profiles/rider_friend01') return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    return null;
  });
  await page.goto('/#friends');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/pwa-standalone/);
  // Closed chat uses the full-height body as its containing block.
  const lock = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return { position: b.position, overflow: b.overflow, bodyHeight: document.body.getBoundingClientRect().height, chatHeight: document.querySelector('#chatScreen').getBoundingClientRect().height };
  });
  expect(lock).toMatchObject({ position: 'relative', overflow: 'hidden' });
  await expect(page.locator('#chatScreen')).toHaveCSS('position', 'absolute');
  expect(await page.locator('#chatScreen').evaluate(el => el.offsetParent === document.body)).toBe(true);
  await page.evaluate(() => document.documentElement.style.setProperty('--bottom-safe-area', '34px'));
  const chat = await page.locator('#chatScreen').boundingBox();
  for (const selector of ['#chatInput', '#chatSend']) {
    const control = await page.locator(selector).boundingBox();
    expect(control.y + control.height).toBeLessThanOrEqual(chat.y + chat.height - 34);
    const hit = await page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.bottom - 2));
    });
    expect(hit).toBe(true);
  }
  expect(Math.abs(lock.bodyHeight - lock.chatHeight)).toBeLessThanOrEqual(1);
  // The title sits clear of the band iOS 26 blurs under the status bar.
  const title = await page.locator('#chatTitle').boundingBox();
  expect(title.y).toBeGreaterThanOrEqual(59 + 14);
  // No solid bar over the status bar on the map or chat.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#chatScreen'), '::before').content)).toBe('none');
});
