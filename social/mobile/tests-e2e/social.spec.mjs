/* global document, window, getComputedStyle, Event */
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

// This fixture is an entirely synthetic session, never a real Rider Comms credential.
// It prevents the screenshot suite from sending any account requests to production.
test.beforeEach(async ({ page }) => {
  await page.route('https://backend-production-7fa0.up.railway.app/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = pathname === '/auth/me'
      ? { riderId: 'rider-e2e-001', username: 'fixture-rider', emailVerified: true,
          termsAccepted: true, termsVersion: 'terms-fixture' }
      : pathname === '/riders/rider-e2e-001/friends' || pathname === '/conversations'
        ? pathname === '/conversations'
          ? { conversations: [], nextCursor: null }
          : { friends: [], nextCursor: null }
        : { error: 'not_found' };
    return route.fulfill({ status: pathname === '/auth/me' || pathname.includes('friends') ||
      pathname === '/conversations' ? 200 : 404,
      contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('rider_social_account_session_v1', 'synthetic-e2e-only');
    window.sessionStorage.setItem('rider_social_age_ack_v1', 'rider-e2e-001');
  });
});

test('feed switches, hides posts and explains recommendations', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Feed preferences' })).toBeVisible();
  await expect(page.getByText('Members-only event details')).toHaveCount(0);
  await expect(page.getByText('Sunday roads, no rush.')).toBeVisible();

  await page.getByRole('button', { name: 'Post options for Alex Morgan' }).click();
  await page.getByRole('button', { name: 'Why seeing post by Alex Morgan' }).click();
  await expect(page.getByText(/Sample recommendation/)).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notice' }).click();

  await page.getByRole('button', { name: 'Post options for Alex Morgan' }).click();
  await page.getByRole('button', { name: 'Not interested in post by Alex Morgan' }).click();
  await expect(page.getByText('Sunday roads, no rush.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Following' }).click();
  await expect(page.getByRole('button', { name: 'Newest' })).toBeVisible();
  await page.getByRole('button', { name: 'Newest' }).click();
  await expect(page.getByText('The early start was worth it.')).toBeVisible();

  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-feed.png' });
});

test('clubs, marketplace and profile have independent usable screens', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Clubs' }).click();
  await expect(page.getByText('Clubs & events')).toBeVisible();
  await page.getByRole('button', { name: 'Open South Coast Riders' }).click();
  await expect(page.getByText('Weekend rides, scenic routes and friendly meetups.')).toBeVisible();
  await page.getByRole('button', { name: 'Join demo club' }).click();
  await expect(page.getByRole('button', { name: 'Leave demo club' })).toBeVisible();

  await page.getByRole('tab', { name: 'Shop' }).click();
  await expect(page.getByText('Sample marketplace')).toBeVisible();
  await expect(page.getByText('Verified only')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search marketplace' }).fill('bicycle helmet');
  await expect(page.getByText('Road bicycle helmet')).toBeVisible();
  await expect(page.getByText('Touring gloves')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByTestId('social-profile-summary')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View friends' })).toBeVisible();
  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await expect(page.getByText('Personal garage')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-profile.png' });
});


test('Shop, comments, profile and garage text fields have no blue filled boxes', async ({ page }, testInfo) => {
  await page.goto('/');
  async function assertUnboxed(label) {
    const field = page.getByRole('textbox', { name: label });
    await expect(field).toBeVisible();
    const appearance = await field.evaluate(input => {
      const style = window.getComputedStyle(input);
      return { fill: style.backgroundColor, size: parseFloat(style.fontSize),
        outline: style.outlineStyle };
    });
    expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(appearance.fill);
    expect(appearance.size).toBeGreaterThanOrEqual(16);
  }
  await page.getByRole('tab', { name: 'Shop' }).click();
  await assertUnboxed('Search marketplace');

  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open comments' }).first().click();
  await assertUnboxed('Write a comment');
  await page.getByRole('button', { name: 'Close comments' }).click();

  await page.getByRole('button', { name: 'Open profile' }).click();
  await page.getByRole('button', { name: 'Edit social profile' }).click();
  await assertUnboxed('Social display name');
  await assertUnboxed('Social bio');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await page.getByRole('button', { name: 'Add vehicle to garage' }).click();
  await assertUnboxed('Vehicle make');
  await assertUnboxed('Vehicle model');
  await assertUnboxed('Vehicle year');
  await assertUnboxed('Vehicle notes');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-unboxed-fields.png' });
});

test('social profile and private garage edits survive reload without publishing', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Your posts will appear here')).toBeVisible();
  await page.getByRole('button', { name: 'Edit social profile' }).click();
  await page.getByRole('textbox', { name: 'Social display name' }).fill('Weekend Rider');
  await page.getByRole('textbox', { name: 'Social bio' }).fill('Cars, motorcycles and Sunday rides.');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Cars, motorcycles and Sunday rides.')).toBeVisible();

  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await expect(page.getByText('Your garage starts here')).toBeVisible();
  await page.getByRole('button', { name: 'Add vehicle to garage' }).click();
  await page.getByRole('textbox', { name: 'Vehicle make' }).fill('Honda');
  await page.getByRole('textbox', { name: 'Vehicle model' }).fill('PCX');
  await page.getByRole('textbox', { name: 'Vehicle year' }).fill('2024');
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByText('Honda PCX')).toBeVisible();
  await expect(page.getByText('PRIVATE', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByText('Cars, motorcycles and Sunday rides.')).toBeVisible();
  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await expect(page.getByText('Honda PCX')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle privacy for Honda PCX' }).click();
  await expect(page.getByText('PUBLIC', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Honda PCX' }).click();
  await page.getByRole('button', { name: 'Confirm remove' }).click();
  await expect(page.getByText('Your garage starts here')).toBeVisible();

  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-garage.png' });
});

test('event detail includes only demo interest, not real RSVP', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Clubs' }).click();
  await page.getByRole('button', { name: 'View event Coffee & Cars' }).click();
  await expect(page.getByText('Preview event · private details stay protected')).toBeVisible();
  await page.getByRole('button', { name: 'Mark interested in demo event' }).click();
  await expect(page.getByRole('button', { name: 'Remove demo RSVP interest' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to clubs and events' }).click();
  await expect(page.getByText('Upcoming events')).toBeVisible();
});


test('iPhone and desktop render true edge-to-edge background with safe content insets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Feed preferences' })).toBeVisible();
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    const status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') ?? '';
    const root = document.getElementById('root');
    const screen = document.getElementById('social-screen');
    const tabs = document.getElementById('social-bottom-tabs');
    const rootRect = root?.getBoundingClientRect();
    const screenRect = screen?.getBoundingClientRect();
    const tabsRect = tabs?.getBoundingClientRect();
    return {
      viewport, status,
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      screenBackground: screen ? getComputedStyle(screen).backgroundColor : '',
      tabsBackground: tabs ? getComputedStyle(tabs).backgroundColor : '',
      rootBottom: rootRect?.bottom ?? -1,
      screenBottom: screenRect?.bottom ?? -1,
      tabsBottom: tabsRect?.bottom ?? -1,
      viewportHeight: window.innerHeight,
      screenWidth: screenRect?.width ?? -1,
      viewportWidth: window.innerWidth,
      screenPaddingTop: screen ? getComputedStyle(screen).paddingTop : '',
      tabsPaddingBottom: tabs ? parseFloat(getComputedStyle(tabs).paddingBottom) : 0,
      hasSafeAreaCss: !!document.getElementById('social-edge-to-edge')?.textContent?.includes('env(safe-area-inset-bottom'),
    };
  });
  expect(geometry.viewport).toContain('viewport-fit=cover');
  expect(geometry.viewport).toContain('interactive-widget=resizes-content');
  expect(geometry.status).toBe('black-translucent');
  expect(geometry.htmlBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.bodyBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.screenBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.tabsBackground).toBe('rgb(8, 13, 19)');
  expect(geometry.hasSafeAreaCss).toBe(true);
  expect(geometry.rootBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.screenBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.tabsBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 2);
  expect(geometry.screenWidth).toBeGreaterThanOrEqual(geometry.viewportWidth - 2);
  expect(geometry.tabsPaddingBottom).toBeGreaterThanOrEqual(12);
});


test('media-first home removes intro and keeps content close to top', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('Your world, in motion.')).toHaveCount(0);
  await expect(page.getByText('Visual placeholder · media integration pending')).toHaveCount(0);
  const media = page.getByTestId('post-media-p1');
  await expect(media).toBeVisible();
  const rect = await media.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect?.y).toBeLessThan(460);
  await page.getByRole('button', { name: 'Feed preferences' }).click();
  await expect(page.getByText('Feed preferences')).toBeVisible();
  await page.getByRole('button', { name: 'Feed preferences' }).click();
  await expect(page.getByText('Feed preferences')).toHaveCount(0);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-feed-first.png' });
});

test('device media selection, review and text-only draft are usable without publishing', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByText('New post')).toBeVisible();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose from library' }).click()
  ]);
  await chooser.setFiles({
    name: 'my-bike.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/jVf8AAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.getByText('Edit post')).toBeVisible();
  await expect(page.getByLabel('Selected photo: my-bike.png')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-media-edit.png' });
  await page.getByRole('button', { name: 'Review post' }).click();
  await page.getByRole('textbox', { name: 'Create caption' }).fill('Saturday meet preview');
  await expect(page.getByText('Not published')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Post title' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Post title' }).fill('Sunday ride');
  await page.getByRole('button', { name: 'Add hashtag' }).click();
  await expect(page.getByRole('textbox', { name: 'Create caption' })).toHaveValue('Saturday meet preview #');
  await page.getByRole('button', { name: 'Preview post' }).click();
  await expect(page.getByTestId('post-preview')).toBeVisible();
  await expect(page.getByText('Sunday ride')).toBeVisible();
  await page.getByRole('button', { name: 'Close post preview' }).click();
  await expect(page.getByTestId('post-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Post unavailable' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-media-review.png' });
  await expect(page.getByRole('textbox', { name: 'Create caption' })).toHaveValue('Saturday meet preview #');
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save text draft' }).click();
  await expect(page.getByText(/Photos and videos are not saved/)).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByText('Text draft restored. Select media again.')).toBeVisible();
  await expect(page.getByText('New post')).toBeVisible();
});

test('fixed shell only scrolls the feed and content directories, never Reels or Messages', async ({ page }) => {
  await page.goto('/');
  const initial = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    pageScroll: document.getElementById('social-page-scroll')?.scrollHeight ?? 0,
    pageHeight: document.getElementById('social-page-scroll')?.clientHeight ?? 0,
    docOverflow: (document.scrollingElement?.scrollHeight ?? 0) - document.documentElement.clientHeight
  }));
  expect(initial.bodyOverflow).toBe('hidden');
  expect(initial.pageScroll).toBeGreaterThan(initial.pageHeight);
  expect(initial.docOverflow).toBeLessThanOrEqual(2);
  await page.getByRole('tab', { name: 'Reels' }).click();
  await expect(page.getByTestId('fixed-reels-screen')).toBeVisible();
  await expect(page.locator('#social-page-scroll')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Reels' })).toBeVisible();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open messages' }).click();
  await expect(page.getByTestId('fixed-messages-screen')).toBeVisible();
  await expect(page.locator('#social-page-scroll')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Clubs' }).click();
  await expect(page.locator('#social-page-scroll')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.locator('#social-page-scroll')).toHaveCount(0);
  await expect(page.getByTestId('create-studio')).toBeVisible();
  await expect(page.locator('#composer-scroll')).toHaveCount(0);
});


test('media editor has a dominant fixed canvas, real edit actions and a separate sharing screen', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'Story format' }).click();
  await expect(page.getByText('New story')).toBeVisible();
  await page.getByRole('button', { name: 'Post format' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose from library' }).click()
  ]);
  await chooser.setFiles({
    name: 'my-bike.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/jVf8AAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.getByTestId('media-edit-canvas')).toBeVisible();
  await expect(page.getByLabel('Selected photo: my-bike.png')).toBeVisible();
  const panel = await page.getByTestId('media-edit-canvas').boundingBox();
  expect(panel?.height ?? 0).toBeGreaterThan(140);
  await expect(page.getByRole('button', { name: '1:1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rotate' })).toBeVisible();
  await page.getByRole('button', { name: 'Review post' }).click();
  await expect(page.getByText('Not published')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Audience Only me' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Audience Everyone' })).toBeVisible();
  await page.getByRole('radio', { name: 'Audience Everyone' }).click();
  await expect(page.getByRole('radio', { name: 'Audience Everyone' })).toHaveAttribute('aria-checked', 'true');
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-composer-share.png' });
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
});


test('Reels fills the content viewport, pages vertically and opens the Reel creator', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Reels' }).click();
  await expect(page.getByTestId('fixed-reels-screen')).toBeVisible();
  await expect(page.getByTestId('reels-viewport')).toBeVisible();
  await expect(page.getByTestId('reels-swipe-feed')).toBeVisible();
  await expect(page.getByText('EARLY PREVIEW')).toHaveCount(0);
  const viewport = await page.getByTestId('reels-viewport').boundingBox();
  const first = await page.getByTestId('reel-slide-0').boundingBox();
  expect(viewport?.height ?? 0).toBeGreaterThan(140);
  expect(Math.abs((viewport?.height ?? 0) - (first?.height ?? 0))).toBeLessThan(3);
  await page.getByRole('button', { name: 'Next Reel' }).click();
  await expect.poll(async () => page.locator('#social-reels-feed').evaluate(el => {
    const panel = document.getElementById('social-reel-panel-r1');
    return Math.abs(el.scrollTop - (panel?.getBoundingClientRect().height ?? 0));
  })).toBeLessThan(3);
  await expect(page.getByRole('tab', { name: 'Reels' })).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-reels.png' });
  await page.getByRole('button', { name: 'Create Reel' }).click();
  await expect(page.getByText('New reel')).toBeVisible();
});


test('Reels media bleeds behind the status region while controls stay safe and captions have no band', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.addStyleTag({ content: [
    '#social-screen { padding-top: 59px !important; }',
    '#social-reels-top-controls { padding-top: 72px !important; }',
  ].join('\n') });
  await page.getByRole('tab', { name: 'Reels' }).click();
  await expect(page.getByTestId('reels-viewport')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Reel' })).toBeVisible();

  const layout = await page.evaluate(() => {
    const screen = document.getElementById('social-screen');
    const reel = document.querySelector('[data-testid="reel-slide-0"]');
    const controls = document.getElementById('social-reels-top-controls');
    const camera = document.querySelector('[aria-label="Create Reel"]');
    const caption = document.querySelector('[data-testid^="reel-caption-"]');
    const screenTop = screen?.getBoundingClientRect().top ?? -1;
    return {
      screenTop,
      screenPaddingTop: screen ? parseFloat(getComputedStyle(screen).paddingTop) : -1,
      mediaTop: reel?.getBoundingClientRect().top ?? -1,
      mediaHeight: reel?.getBoundingClientRect().height ?? -1,
      viewportHeight: document.getElementById('social-reels-viewport')?.getBoundingClientRect().height ?? -1,
      controlsPaddingTop: controls ? parseFloat(getComputedStyle(controls).paddingTop) : -1,
      cameraTop: camera?.getBoundingClientRect().top ?? -1,
      captionBackground: caption ? getComputedStyle(caption).backgroundColor : '',
      hasSolidScrim: !!document.querySelector('[data-testid="reel-bottom-scrim"]'),
    };
  });
  expect(layout.screenPaddingTop).toBe(0);
  expect(Math.abs(layout.mediaTop - layout.screenTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.mediaHeight - layout.viewportHeight)).toBeLessThanOrEqual(3);
  expect(layout.controlsPaddingTop).toBeGreaterThanOrEqual(72);
  expect(layout.cameraTop).toBeGreaterThanOrEqual(layout.screenTop + 59);
  expect(layout.captionBackground).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  expect(layout.hasSolidScrim).toBe(false);
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  // A short description does not need a visible "More" control.
  await expect(page.getByRole('button', { name: 'Expand Reel caption' })).toHaveCount(0);

  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-reels-edge-to-edge.png' });

  // The exception must not bring the normal Home header behind the island.
  await page.getByRole('tab', { name: 'Home' }).click();
  const home = await page.evaluate(() => ({
    inset: parseFloat(getComputedStyle(document.getElementById('social-screen')).paddingTop),
    headerTop: document.querySelector('[aria-label="Go to home"]')?.getBoundingClientRect().top ?? -1,
  }));
  expect(home.inset).toBe(59);
  expect(home.headerTop).toBeGreaterThanOrEqual(59);
});

test('Stories open in an immersive fixed viewport with previous/next and close controls', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'View story by Alex' }).click();
  await expect(page.getByTestId('story-viewport')).toBeVisible();
  await expect(page.getByText('Sample story · Motorcycles')).toBeVisible();
  await expect(page.getByText('EARLY PREVIEW')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next story' }).click();
  await expect(page.getByText('Sample story · Cars')).toBeVisible();
  await page.getByRole('button', { name: 'Previous story' }).click();
  await expect(page.getByText('Sample story · Motorcycles')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-stories.png' });
  await page.getByRole('button', { name: 'Close story' }).click();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
});


test('bottom navigation stays flush on every non-composer main screen', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const tab of ['Home','Reels','Clubs','Shop']) {
    await page.getByRole('tab', { name: tab }).click();
    const bounds = await page.evaluate(() => {
      const tabs = document.getElementById('social-bottom-tabs');
      const root = document.getElementById('root');
      const bar = tabs?.getBoundingClientRect();
      return {
        bottom: bar?.bottom ?? -1,
        viewport: window.innerHeight,
        rootDisplay: root ? getComputedStyle(root).display : '',
        bodyOverflow: getComputedStyle(document.body).overflow,
        labelGap: bar ? bar.bottom - Math.max(...Array.from(tabs.querySelectorAll('[role="tab"]'))
          .map(node => node.getBoundingClientRect().bottom)) : -1,
      };
    });
    expect(bounds.rootDisplay).toBe('flex');
    expect(bounds.bodyOverflow).toBe('hidden');
    expect(bounds.bottom).toBeGreaterThanOrEqual(bounds.viewport - 2);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport + 2);
    // The outer bar being flush is insufficient if icons sit far above it.
    expect(bounds.labelGap).toBeGreaterThanOrEqual(0);
    expect(bounds.labelGap).toBeLessThan(80);
  }
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-nav-flush.png' });
});


test('stale visualViewport dimensions cannot leave a large black strip below tabs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-vh', String(window.innerHeight - 135) + 'px');
    window.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-vh'))
  )).toBeGreaterThanOrEqual((page.viewportSize()?.height ?? 1) - 2);
  const navGap = await page.evaluate(() =>
    window.innerHeight - (document.getElementById('social-bottom-tabs')?.getBoundingClientRect().bottom ?? 0));
  expect(Math.abs(navGap)).toBeLessThanOrEqual(2);
});

test('Home photo carousel, double-tap like, and creator garage link work', async ({ page }, testInfo) => {
  await page.goto('/');
  const gallery = page.getByTestId('post-gallery-p1');
  await expect(gallery).toBeVisible();
  await gallery.evaluate(element => {
    element.scrollLeft = element.clientWidth;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByTestId('post-media-p1').getByText('2/2')).toBeVisible();
  await gallery.evaluate(element => {
    element.scrollLeft = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByTestId('post-media-p1').getByText('1/2')).toBeVisible();
  const dots = page.getByTestId('post-media-p1').locator('[data-testid="gallery-dots"]');
  await expect(dots).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) < 720) {
    await expect(page.getByRole('button', { name: 'Next photo in post p1' })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Like post' }).first()).toBeVisible();
  const imageButton = page.getByTestId('post-media-p1').getByRole('button', { name: 'Double tap to like photo 1 of 2' });
  await imageButton.dblclick();
  await expect(page.getByRole('button', { name: 'Unlike post' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'View garage for @alex' }).click();
  await expect(page.getByText('Public preview')).toBeVisible();
  const title = await page.getByText('Alex Morgan', { exact: true }).boundingBox();
  const header = await page.getByRole('button', { name: 'Go to home' }).boundingBox();
  expect(title?.y ?? -1).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0) - 2);
  await expect(page.getByRole('button', { name: 'Explore creator club' })).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-creator-garage.png' });
  await page.getByRole('button', { name: 'Explore creator club' }).click();
  await expect(page.getByText('South Coast Riders')).toBeVisible();
});

test('Comments open in a bottom sheet, accept preview text, and do not publish', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open comments' }).first().click();
  await expect(page.getByTestId('comments-overlay')).toBeVisible();
  await expect(page.getByText('Start the conversation')).toBeVisible();
  await page.getByRole('textbox', { name: 'Write a comment' }).fill('Great weekend route');
  await page.getByRole('button', { name: 'Post local comment' }).click();
  await expect(page.getByText('Great weekend route')).toBeVisible();
  await expect(page.getByText('You · Preview')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-comment-sheet.png' });
  await page.getByRole('button', { name: 'Close comments' }).click();
  await expect(page.getByTestId('comments-overlay')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Reels' }).click();
  await page.getByRole('button', { name: 'Comment on Reel r1' }).click();
  await expect(page.getByTestId('comments-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Close comments' }).click();
});


test('iPhone Dynamic Island inset keeps header below system controls', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Go to home' })).toBeVisible();
  const css = await page.locator('#social-edge-to-edge').textContent();
  expect(css).toContain('padding-top: env(safe-area-inset-top');
  expect(css).not.toContain('#social-screen { padding-top: 0 !important; }');
  await expect(page.locator('#social-viewport-sync')).toHaveCount(1);

  // A forced iOS-like inset checks the layout independently of Chromium's
  // inability to emulate the real Dynamic Island safe-area values.
  await page.addStyleTag({ content: '#social-screen { padding-top: 59px !important; }' });
  const first = await page.evaluate(() => {
    const screen = document.getElementById('social-screen');
    const header = document.querySelector('[aria-label="Go to home"]');
    return {
      inset: screen ? parseFloat(getComputedStyle(screen).paddingTop) : -1,
      top: screen?.getBoundingClientRect().top ?? -1,
      button: header?.getBoundingClientRect().top ?? -1,
    };
  });
  expect(first.inset).toBe(59);
  expect(first.button).toBeGreaterThanOrEqual(first.top + 59);
  await page.setViewportSize({ width: 390, height: 730 });
  await expect.poll(async () => page.evaluate(() => {
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-vh'));
    return Math.abs(h - Math.round(window.visualViewport?.height ?? window.innerHeight));
  })).toBeLessThan(2);
  const after = await page.getByRole('button', { name: 'Go to home' }).boundingBox();
  expect(after?.y ?? -1).toBeGreaterThanOrEqual(59);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-top-safe-inset.png' });
});

test('PWA viewport recalculates on rotation and resume without moving bottom tabs', async ({ page }) => {
  await page.goto('/');
  for (const size of [
    { width: 390, height: 680 },
    { width: 680, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect.poll(async () => page.evaluate(() => {
      const setHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-vh'));
      return Math.abs(setHeight - Math.round(window.visualViewport?.height ?? window.innerHeight));
    })).toBeLessThan(2);
    const geometry = await page.evaluate(() => ({
      bottom: document.getElementById('social-bottom-tabs')?.getBoundingClientRect().bottom ?? -1,
      height: window.visualViewport?.height ?? window.innerHeight,
    }));
    expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.height - 2);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 2);
  }
});


test('Create opens camera-first with a real permission path and gallery alternative', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByTestId('camera-first-studio')).toBeVisible();
  await expect(page.getByTestId('camera-preview-area')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose from library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post format' })).toBeVisible();
  // In a clean headless test browser, a permission prompt is needed. Don't
  // claim a blank surface is already a functioning camera.
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible();
  await page.getByRole('button', { name: 'Reel format' }).click();
  await expect(page.getByText('New reel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose from library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Reel video' })).toBeEnabled();
  await page.getByRole('button', { name: 'Post format' }).click();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-camera-first-create.png' });
});


test('Create is full-screen, has working mode controls and a real dismissal path', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.locator('#social-bottom-tabs')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close Create' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Story format' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reel format' })).toBeVisible();
  await page.getByRole('button', { name: 'Reel format' }).click();
  await expect(page.getByRole('button', { name: '15 seconds' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '60 seconds' }).click();
  await expect(page.getByRole('button', { name: '60 seconds' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close Create' }).click();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
  await expect(page.locator('#social-bottom-tabs')).toHaveCount(1);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-composer-closed.png' });
});

test('TikTok-style Shop discovery supports search, sample details, saved and basket', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Shop' }).click();
  await expect(page.getByTestId('shop-discovery')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search marketplace' })).toBeVisible();
  await expect(page.getByTestId('shop-card-l1')).toBeVisible();
  await expect(page.getByTestId('shop-card-l2')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-shop-discovery.png' });
  await page.getByRole('button', { name: 'View listing Touring gloves' }).click();
  await expect(page.getByTestId('shop-product-details')).toBeVisible();
  await expect(page.getByText('Illustrative listing only.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Add to preview basket Touring gloves' }).click();
  await expect(page.getByText(/Added to your preview basket/)).toBeVisible();
  await page.getByRole('button', { name: 'Save Touring gloves' }).click();
  await page.getByRole('button', { name: 'Back to Shop' }).click();
  await page.getByRole('button', { name: 'Shop section Basket' }).click();
  await expect(page.getByTestId('shop-card-l1')).toBeVisible();
  await expect(page.getByText(/Checkout is unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'Shop section Saved' }).click();
  await expect(page.getByTestId('shop-card-l1')).toBeVisible();
  await expect(page.getByText('Road bicycle helmet')).toHaveCount(0);
});


test('Shop saved and basket are not hidden by discovery filters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Shop' }).click();
  await page.getByRole('button', { name: 'View listing Touring gloves' }).click();
  await page.getByRole('button', { name: 'Save Touring gloves' }).click();
  await page.getByRole('button', { name: 'Add to preview basket Touring gloves' }).click();
  await page.getByRole('button', { name: 'Back to Shop' }).click();

  // Filtering discovery to a different product must not erase a saved item or basket line.
  await page.getByRole('textbox', { name: 'Search marketplace' }).fill('bicycle helmet');
  await expect(page.getByTestId('shop-card-l1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Shop category Vehicles' }).click();
  await page.getByRole('button', { name: 'Shop filters' }).click();
  await page.getByRole('button', { name: 'Shop interest Cycling' }).click();
  await page.getByRole('button', { name: 'Shop section Basket' }).click();
  await expect(page.getByTestId('shop-card-l1')).toBeVisible();
  await page.getByRole('button', { name: 'Shop section Saved' }).click();
  await expect(page.getByTestId('shop-card-l1')).toBeVisible();
  await page.getByRole('button', { name: 'Shop section Discover' }).click();
  await expect(page.getByTestId('shop-card-l1')).toHaveCount(0);
});

test('Social profile has tabs, follower/friend panels and separately managed demo follows', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('EARLY PREVIEW')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByTestId('social-profile-summary')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Posts profile tab' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reels profile tab' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Garage profile tab' })).toBeVisible();
  await expect(page.getByText('@fixture-rider', { exact: true })).toBeVisible();
  await expect(page.getByText('Your posts will appear here')).toBeVisible();
  await expect(page.getByText('Personal garage')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View followers' })).toHaveCount(0);
  await page.getByRole('button', { name: 'View friends' }).click();
  await expect(page.getByText('No friends found')).toBeVisible();
  await page.getByRole('button', { name: 'Close connections' }).click();
  await page.getByRole('button', { name: 'View following' }).click();
  await expect(page.getByText('Alex Morgan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unfollow @alex' })).toBeVisible();
  await page.getByRole('button', { name: 'Unfollow @alex' }).click();
  await expect(page.getByRole('button', { name: 'Unfollow @alex' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close connections' }).click();
  await page.getByRole('tab', { name: 'Reels profile tab' }).click();
  await expect(page.getByText('Your Reels will appear here')).toBeVisible();
  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await expect(page.getByText('Personal garage')).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/' + testInfo.project.name + '-social-profile-updated.png' });
});


test('Create and Shop use immersive dedicated headers without losing profile navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create' }).click();
  await expect(page.getByTestId('create-studio')).toBeVisible();
  await expect(page.getByText('EARLY PREVIEW')).toHaveCount(0);
  await expect(page.locator('#social-bottom-tabs')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Create' }).click();
  await expect(page.getByRole('tab', { name: 'Shop' })).toBeVisible();
  await page.getByRole('tab', { name: 'Shop' }).click();
  await expect(page.getByTestId('shop-discovery')).toBeVisible();
  await expect(page.getByText('EARLY PREVIEW')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByTestId('social-profile-summary')).toBeVisible();
  await page.getByRole('tab', { name: 'Garage profile tab' }).click();
  await expect(page.getByText('Personal garage')).toBeVisible();
});
