/* global window */
import { test, expect } from '@playwright/test';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { mkdir } from 'node:fs/promises';

/**
 * Rider Social with posting switched on, in the production build: a real
 * feed from the (mocked) API, reporting someone's post, sharing a photo and
 * deleting your own post. No fixtures; the API is mocked, never called.
 */
const backend = 'https://backend-production-7fa0.up.railway.app';
const me = 'rider_abcd1234';
const other = 'rider_other5678';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
};
// A 1×1 PNG, served for every signed media link.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

function post(id, authorId, caption, extra = {}) {
  return {
    id, authorId, kind: 'photo', caption, createdAt: Date.now() - 5 * 60_000, hidden: false,
    media: [{ id: id + '-m', kind: 'image', width: 1600, height: 1200, durationMs: null,
      url: `/social/media/${id}-m/file?v=${me}&exp=1&sig=x`, posterUrl: null }],
    ...extra,
  };
}

async function mockApi(page, state) {
  await page.route(backend + '/**', async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const method = request.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    state.calls.push(method + ' ' + pathname + (searchParams.toString() ? '?' + searchParams : ''));
    if (pathname.startsWith('/social/media/') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: PIXEL });
    }
    if (pathname === '/auth/me') return json(200, { riderId: me, username: 'live-smoke', emailVerified: true, termsAccepted: true, termsVersion: 't' });
    if (pathname === '/social/bootstrap') return json(200, { entitlement: 'beta', policyVersion: 'social-open-beta-v1', capabilities: {
      mediaUpload: true, privatePosting: false, publicPosting: true, liveStreaming: false, marketplaceCheckout: false, creatorPayouts: false } });
    if (pathname === `/riders/${me}/friends`) return json(200, { friends: [], nextCursor: null });
    if (pathname === '/conversations') return json(200, { conversations: [], nextCursor: null });
    if (pathname === `/riders/${me}/profile`) return json(200, { riderId: me, displayName: 'Live Smoke', handle: 'live_smoke' });
    if (pathname === '/profiles/batch') return json(200, { profiles: {
      [me]: { riderId: me, displayName: 'Live Smoke', handle: 'live_smoke' },
      [other]: { riderId: other, displayName: 'Sam Rider', handle: 'sam_rides' },
    } });
    if (pathname === '/social/feed') {
      const scope = searchParams.get('scope');
      const posts = state.posts.filter(item => scope === 'reels' ? item.kind === 'reel' :
        scope !== 'following' || item.authorId === me);
      return json(200, { posts, nextCursor: null });
    }
    if (pathname === `/social/riders/${me}/posts`) return json(200, { posts: state.posts.filter((item) => item.authorId === me), nextCursor: null });
    if (pathname === '/social/media' && method === 'POST') {
      state.uploads.push(request.headers()['content-type']);
      return json(201, { media: { id: 'up-1', kind: 'image', width: 800, height: 600, durationMs: null } });
    }
    if (pathname === '/social/posts' && method === 'POST') {
      const body = request.postDataJSON();
      state.created.push(body);
      const created = post('mine-1', me, body.caption);
      state.posts.unshift(created);
      return json(201, { post: created });
    }
    const report = /^\/social\/posts\/([^/]+)\/report$/.exec(pathname);
    if (report && method === 'POST') {
      state.reports.push({ id: report[1], ...request.postDataJSON() });
      state.posts = state.posts.filter((item) => item.id !== report[1]);
      return json(202, { reported: true });
    }
    const remove = /^\/social\/posts\/([^/]+)$/.exec(pathname);
    if (remove && method === 'DELETE') {
      state.posts = state.posts.filter((item) => item.id !== remove[1]);
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(404, { error: 'not_found' });
  });
  await page.addInitScript((riderId) => {
    window.sessionStorage.setItem('rider_social_account_session_v1', 'synthetic-live-smoke');
    window.sessionStorage.setItem('rider_social_age_ack_v1', riderId);
  }, me);
}

test('shows the real feed, reports a post, shares a photo and deletes it', async ({ page }, testInfo) => {
  const state = { posts: [post('theirs-1', other, 'Sunday run to the coast')], calls: [], uploads: [], created: [], reports: [] };
  await mockApi(page, state);
  await page.goto('/');

  const card = page.getByTestId('live-post-theirs-1');
  await expect(card).toBeVisible();
  await expect(card.getByText('Sam Rider')).toBeVisible();
  await expect(page.getByTestId('home-starter-feed')).toHaveCount(0);
  await expect(card.getByText(/@sam_rides · 5 min/)).toBeVisible();
  await expect(card.getByText('Sunday run to the coast')).toBeVisible();
  await expect(card.getByRole('img').first()).toBeVisible();
  // For you and Following switch at the top of Home.
  await expect(page.getByRole('tab', { name: 'For you feed' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Following feed' }).click();
  await expect(page.getByRole('tab', { name: 'Following feed' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Posts from your Rider Comms friends will show here.')).toBeVisible();
  await page.getByRole('tab', { name: 'For you feed' }).click();
  await expect(card).toBeVisible();
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: `test-results/screenshots/${testInfo.project.name}-live-feed.png` });

  // Report: the reasons, then it's gone from this rider's feed.
  await card.getByRole('button', { name: 'Post options for @sam_rides' }).click();
  await expect(card.getByRole('button', { name: 'Delete post' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Report post' }).click();
  await card.getByRole('button', { name: 'Spam or scam' }).click();
  await expect(card).toHaveCount(0);
  expect(state.reports).toEqual([{ id: 'theirs-1', reason: 'spam', details: '' }]);
  await expect(page.getByText('Nobody in the Social test has posted yet.', { exact: false })).toBeVisible();

  // Share a photo: gallery, review, Share.
  await page.getByRole('tab', { name: 'Create' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Open Gallery').click();
  await (await chooser).setFiles({ name: 'ride.png', mimeType: 'image/png', buffer: PIXEL });
  await page.getByRole('button', { name: 'Review post' }).click();
  await expect(page.getByText('Everyone in the Rider Social test')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Audience/ })).toHaveCount(0);
  await page.getByLabel('Create caption').fill('First photo from the test');
  await page.getByRole('button', { name: 'Share post' }).click();
  await expect(page.getByText('Your post is live.')).toBeVisible();
  expect(state.uploads).toEqual(['image/jpeg']);
  expect(state.created).toEqual([{ kind: 'photo', caption: 'First photo from the test', mediaIds: ['up-1'] }]);
  const mine = page.getByTestId('live-post-mine-1');
  await expect(mine).toBeVisible();

  // Delete your own post: options offer Delete, not Report.
  await mine.getByRole('button', { name: 'Post options for @live_smoke' }).click();
  await expect(mine.getByRole('button', { name: 'Report post' })).toHaveCount(0);
  await mine.getByRole('button', { name: 'Delete post' }).click();
  await mine.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(mine).toHaveCount(0);
  await expect(page.getByText('Post deleted.')).toBeVisible();
});

test('says so when the feed can’t load, and retries', async ({ page }) => {
  const state = { posts: [], calls: [], uploads: [], created: [], reports: [] };
  let fail = true;
  await mockApi(page, state);
  // Registered last, so it runs first.
  await page.route(backend + '/social/feed**', async (route) => {
    if (fail && route.request().method() === 'GET') return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'social_media_not_configured' }) });
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByText('Posting isn’t switched on yet.')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try loading posts again' }).click();
  await expect(page.getByText('Nobody in the Social test has posted yet.', { exact: false })).toBeVisible();
});

test('does not keep refreshing signed links for an unavailable photo', async ({ page }) => {
  const initial = post('unavailable', other, 'A photo that cannot load');
  const state = { posts: [initial], calls: [], uploads: [], created: [], reports: [] };
  let refreshes = 0;
  await mockApi(page, state);
  await page.route(backend + '/social/posts/unavailable', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    refreshes += 1;
    const media = initial.media.map(item => ({ ...item, url: item.url + '&revision=' + refreshes }));
    return route.fulfill({ status: 200, headers: cors, json: { post: { ...initial, media } } });
  });
  await page.route(backend + '/social/media/unavailable-m/file**', async (route) => {
    return route.fulfill({ status: 503, headers: cors });
  });

  const refreshedImage = page.waitForResponse(response => response.url().includes('/unavailable-m/file') &&
    new URL(response.url()).searchParams.get('revision') === '1');
  await page.goto('/');
  expect((await refreshedImage).status()).toBe(503);
  await expect(page.getByTestId('live-post-unavailable')).toBeVisible();
  await expect(page.waitForRequest(request => request.url() === backend + '/social/posts/unavailable' &&
    request.method() === 'GET', { timeout: 750 })).rejects.toThrow(/Timeout/);
  expect(refreshes).toBe(1);
});

test('shows published Reels while uploading is disabled', async ({ page }) => {
  const published = post('published-reel', other, 'A published ride', { kind: 'reel' });
  published.media[0].kind = 'video';
  const state = { posts: [published], calls: [], uploads: [], created: [], reports: [] };
  await mockApi(page, state);
  await page.route(backend + '/social/bootstrap', route => route.fulfill({
    status: 200, headers: cors, json: {
      entitlement: 'beta', policyVersion: 'social-open-beta-v1', capabilities: {
        mediaUpload: false, privatePosting: false, publicPosting: false,
        liveStreaming: false, marketplaceCheckout: false, creatorPayouts: false,
      },
    },
  }));
  await page.goto('/');
  await expect(page.getByTestId('live-post-published-reel')).toBeVisible();
  await page.getByRole('tab', { name: 'Reels' }).click();
  await expect(page.getByTestId('reel-caption-published-reel')).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('src', /\/social\/media\/published-reel-m\/file/);
  expect(state.uploads).toEqual([]);
});


test('a saved rider Reel appears in the profile and opens the right video', async ({ page }) => {
  const published = post('saved-rider-reel', other, 'A rider Reel to keep', { kind: 'reel' });
  published.media[0].kind = 'video';
  const state = { posts: [published], calls: [], uploads: [], created: [], reports: [] };
  await mockApi(page, state);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Reels' }).click();
  await page.getByRole('button', { name: 'Save Reel saved-rider-reel' }).click();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Open profile' }).click();
  await page.getByRole('tab', { name: 'Saved profile tab' }).click();
  await page.getByRole('button', { name: 'Watch saved Reel saved-rider-reel' }).click();
  await expect(page.getByTestId('reel-caption-saved-rider-reel')).toBeVisible();
  await expect(page.locator('video')).toHaveAttribute('src', /saved-rider-reel-m/);
});
