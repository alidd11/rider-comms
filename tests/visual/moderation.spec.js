import { expect, test } from '@playwright/test';

const API = 'https://backend-production-7fa0.up.railway.app';
const ADMIN_ID = 'rider_admin01';

const OPEN_REPORT = {
  id: 'report-1',
  reporterId: 'rider_reporter',
  reportedRiderId: 'rider_badactor',
  reason: 'harassment',
  details: '<img src=x onerror="window.__xss=1"> kept messaging me',
  createdAt: Date.parse('2026-09-29T10:00:00Z'),
  status: 'open',
  resolvedAt: null,
  resolvedBy: null,
  reportsAgainstRider: 3,
  reportedRiderSuspended: false,
};

async function signIn(page) {
  await page.addInitScript((riderId) => {
    localStorage.setItem('rider-comms-session-v1', JSON.stringify({ riderId, token: 'admin-token', emailVerified: true }));
  }, ADMIN_ID);
}

/** Minimal in-memory moderation backend. */
async function mockModerationApi(page, { admin = true, suspended = false } = {}) {
  const state = {
    reports: [{ ...OPEN_REPORT, reportedRiderSuspended: suspended }],
    actions: [],
    posts: [],
  };
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    };
    const json = (status, body) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (url.pathname.startsWith('/moderation') && !admin) return json(403, { error: 'admin_required' });
    if (url.pathname === '/profiles/batch') {
      return json(200, { profiles: {
        rider_reporter: { displayName: 'Maya', handle: '@maya_moto' },
        rider_badactor: { displayName: 'Rex', handle: '@rex' },
      } });
    }
    if (url.pathname === '/moderation/reports') {
      const status = url.searchParams.get('status');
      return json(200, { reports: state.reports.filter((report) => report.status === status) });
    }
    if (url.pathname === '/moderation/actions') return json(200, { actions: state.actions });
    const body = request.postDataJSON();
    state.posts.push({ path: url.pathname, body });
    const resolve = url.pathname.match(/^\/moderation\/reports\/([^/]+)\/resolve$/);
    if (resolve) {
      const report = state.reports.find((candidate) => candidate.id === decodeURIComponent(resolve[1]));
      report.status = body.resolution === 'suspend' ? 'actioned' : 'dismissed';
      report.resolvedAt = Date.now();
      report.resolvedBy = ADMIN_ID;
      if (body.resolution === 'suspend') report.reportedRiderSuspended = true;
      state.actions.unshift({ id: `a${state.actions.length}`, moderatorId: ADMIN_ID, targetRiderId: report.reportedRiderId, reportId: report.id, action: body.resolution, note: body.note, createdAt: Date.now() });
      return json(200, { ok: true });
    }
    if (url.pathname.endsWith('/unsuspend')) {
      for (const report of state.reports) report.reportedRiderSuspended = false;
      return json(200, { ok: true });
    }
    return json(404, { error: 'not_found' });
  });
  return state;
}

test.describe('staff moderation page', () => {

  test('asks a signed-out visitor to sign in to the app first', async ({ page }) => {
    await mockModerationApi(page);
    await page.goto('/moderation.html');
    await expect(page.locator('#modStatus')).toContainText('Sign in to the Rider Comms app');
    await expect(page.locator('#modTabs')).toBeHidden();
  });

  test('tells a non-moderator account it has no access', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { admin: false });
    await page.goto('/moderation.html');
    await expect(page.locator('#modStatus')).toContainText('not a moderator');
    await expect(page.locator('#modTabs')).toBeHidden();
  });

  test('shows the open queue safely and dismisses a report with a required note', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/moderation.html');

    const card = page.locator('.mod-card[data-report-id="report-1"]');
    await expect(card.locator('h2')).toContainText('Harassment');
    await expect(card).toContainText('Rex @rex (rider_badactor)');
    await expect(card).toContainText('Maya @maya_moto (rider_reporter)');
    await expect(card).toContainText('3 reports against this rider');
    // Rider-written details are shown as text, never run as HTML.
    await expect(card.locator('.mod-details')).toHaveText(OPEN_REPORT.details);
    await expect(card.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(card.locator('.mod-error')).toContainText('Write a note first');
    expect(state.posts).toHaveLength(0);

    await card.locator('textarea').fill('Checked the chat history; no harassment.');
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.mod-empty')).toHaveText('No open reports.');
    expect(state.posts).toEqual([{ path: '/moderation/reports/report-1/resolve', body: { resolution: 'dismiss', note: 'Checked the chat history; no harassment.' } }]);

    await page.getByRole('button', { name: 'Audit log' }).click();
    await expect(page.locator('.mod-card h2')).toHaveText('Dismissed report');
    await expect(page.locator('.mod-card')).toContainText('Checked the chat history; no harassment.');
  });

  test('suspends only after confirmation, then allows unsuspending', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/moderation.html');
    const card = page.locator('.mod-card[data-report-id="report-1"]');
    await card.locator('textarea').fill('Repeated threats in messages.');

    page.once('dialog', (dialog) => dialog.dismiss());
    await card.getByRole('button', { name: 'Suspend rider' }).click();
    expect(state.posts).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'Suspend rider' }).click();
    await expect(page.locator('.mod-empty')).toHaveText('No open reports.');
    expect(state.posts[0]).toEqual({ path: '/moderation/reports/report-1/resolve', body: { resolution: 'suspend', note: 'Repeated threats in messages.' } });

    await page.getByRole('button', { name: 'Actioned' }).click();
    const actioned = page.locator('.mod-card[data-report-id="report-1"]');
    await expect(actioned.locator('.mod-badge[data-kind="suspended"]')).toBeVisible();
    await actioned.locator('textarea').fill('Appeal accepted.');
    await actioned.getByRole('button', { name: 'Unsuspend rider' }).click();
    await expect(page.locator('.mod-card[data-report-id="report-1"] .mod-badge[data-kind="suspended"]')).toHaveCount(0);
    expect(state.posts[1]).toEqual({ path: '/moderation/riders/rider_badactor/unsuspend', body: { note: 'Appeal accepted.' } });
  });
});
