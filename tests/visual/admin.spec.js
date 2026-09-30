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

const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
const OVERVIEW = {
  generatedAt: Date.parse('2026-09-30T12:00:00Z'),
  riders: { total: 1284, verified: 1100, suspended: 3, admins: 2, newToday: 12, new7d: 85, new30d: 310 },
  activity: { active24h: 240, active7d: 610, active30d: 900, liveNearbyNow: 17, sharingLocation: 400, activeRides: 4, ridersInRides: 11 },
  social: { friendships: 2300, pendingFriendRequests: 40, messages24h: 530, messages7d: 3100, messages30d: 12000 },
  content: { activeHazards: 22, scenicRoutes: 64, hideouts: 18 },
  safety: { openReports: 2, reports7d: 5, moderationActions7d: 3 },
  zoneTiers: { free: 1284 },
  series: {
    days: DAYS,
    signups: DAYS.map((_, i) => 5 + (i % 7)),
    messages: DAYS.map((_, i) => 300 + i * 10),
    activeRiders: DAYS.map((_, i) => (i < 25 ? null : 200 + i)),
    ridesStarted: DAYS.map((_, i) => (i < 25 ? null : i % 3)),
  },
};
const RIDERS = [
  { riderId: 'rider_maya', username: 'maya', email: 'maya@example.com', emailVerified: true, createdAt: Date.parse('2026-09-01'), lastSeenAt: Date.now() - 5 * 60_000, isAdmin: false, suspended: false, displayName: 'Maya', handle: '@maya_moto', friends: 12, reportsAgainst: 0, reportsFiled: 1 },
  { riderId: 'rider_rex', username: 'rex', email: 'rex@example.com', emailVerified: false, createdAt: Date.parse('2026-09-10'), lastSeenAt: null, isAdmin: false, suspended: true, displayName: '<b>Rex</b>', handle: '@rex', friends: 0, reportsAgainst: 3, reportsFiled: 0 },
];

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
    riderQueries: [],
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
    if ((url.pathname.startsWith('/moderation') || url.pathname.startsWith('/admin')) && !admin) return json(403, { error: 'admin_required' });
    if (url.pathname === '/admin/overview') return json(200, OVERVIEW);
    if (url.pathname === '/admin/riders') {
      state.riderQueries.push(url.searchParams.get('q'));
      return json(200, { riders: url.searchParams.get('q') === 'nobody' ? [] : RIDERS });
    }
    if (url.pathname === '/health') return json(200, { ok: true });
    if (url.pathname === '/ready') return json(503, { ok: false });
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

test.describe('staff dashboard', () => {

  test('asks a signed-out visitor to sign in to the app first', async ({ page }) => {
    await mockModerationApi(page);
    await page.goto('/admin.html');
    await expect(page.locator('#modStatus')).toContainText('Sign in to the Rider Comms app');
    await expect(page.locator('#modTabs')).toBeHidden();
  });

  test('tells a non-staff account it has no access', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { admin: false });
    await page.goto('/admin.html');
    await expect(page.locator('#modStatus')).toContainText('not staff');
    await expect(page.locator('#modTabs')).toBeHidden();
  });

  test('shows the open queue safely and dismisses a report with a required note', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/moderation.html');
    await expect(page).toHaveURL(/admin\.html#moderation$/);

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
    await expect(page).toHaveURL(/admin\.html#moderation$/);
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

  test('overview shows headline numbers and 30-day charts with tooltips and tables', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html');

    const tile = (label) => page.locator('.dash-tile').filter({ has: page.locator('.dash-tile-label', { hasText: new RegExp(`^${label}$`) }) });
    await expect(tile('Total riders').locator('.dash-tile-value')).toHaveText('1,284');
    await expect(tile('Email verified').locator('.dash-tile-value')).toHaveText('86%');
    await expect(tile('Stickiness').locator('.dash-tile-value')).toHaveText('27%');
    await expect(tile('Live on Nearby').locator('.dash-tile-value')).toHaveText('17');
    await expect(tile('Messages today').locator('.dash-tile-value')).toHaveText('530');
    await expect(tile('Open reports').getByRole('link', { name: 'Review the queue' })).toHaveAttribute('href', '#moderation');

    const charts = page.locator('.dash-chart');
    await expect(charts).toHaveCount(4);
    const signups = charts.filter({ hasText: 'New signups per day' });
    await expect(signups.locator('.dash-chart-summary')).toHaveText(/in the last 30 days$/);
    await expect(signups.locator('path.bar')).toHaveCount(30);
    // Days before tracking started have no bar, and say so in the tooltip.
    const active = charts.filter({ hasText: 'Active riders per day' });
    await expect(active.locator('path.bar')).toHaveCount(5);
    await active.locator('rect.hit').first().hover();
    await expect(active.locator('.dash-tooltip')).toContainText('Not tracked yet');
    await active.locator('rect.hit').last().hover();
    await expect(active.locator('.dash-tooltip strong')).toHaveText('229');

    await signups.getByText('Show table').click();
    await expect(signups.locator('tbody tr')).toHaveCount(30);

    await tile('Open reports').getByRole('link', { name: 'Review the queue' }).click();
    await expect(page.getByRole('button', { name: 'Moderation' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mod-card[data-report-id="report-1"]')).toBeVisible();
  });

  test('rider lookup searches and shows account details as text', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    const rows = page.locator('.dash-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('<b>Rex</b>');
    await expect(rows.nth(1).locator('b')).toHaveCount(0);
    await expect(rows.nth(1)).toContainText('Suspended');
    await expect(rows.nth(1)).toContainText('Unverified');
    await expect(rows.nth(1)).toContainText('Not in the last 30 days');

    await page.getByRole('searchbox', { name: 'Search riders' }).fill('nobody');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.locator('.mod-empty')).toHaveText('No riders match that search.');
    expect(state.riderQueries).toEqual(['', 'nobody']);
  });

  test('system view reports API and database health', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#system');
    const rows = page.locator('.dash-health-row');
    await expect(rows.nth(0)).toContainText('✓ OK');
    await expect(rows.nth(1)).toContainText('✕ Down');
  });
});
