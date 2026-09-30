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

const DAYS = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 7, 2 + i)).toISOString().slice(0, 10));
const OVERVIEW = {
  generatedAt: Date.parse('2026-09-30T12:00:00Z'),
  riders: { total: 1284, verified: 1100, suspended: 3, admins: 2, newToday: 12, new7d: 85, new30d: 310 },
  activity: { active24h: 240, active7d: 610, active30d: 900, liveNearbyNow: 17, sharingLocation: 400, activeRides: 4, ridersInRides: 11 },
  social: { friendships: 2300, pendingFriendRequests: 40, messages24h: 530, messages7d: 3100, messages30d: 12000 },
  content: { activeHazards: 22, scenicRoutes: 64, hideouts: 18 },
  safety: { openReports: 2, reports7d: 5, moderationActions7d: 3 },
  previous: { new7d: 68, new30d: 310, messages7d: 3400, messages30d: 12000, reports7d: 10 },
  zoneTiers: { free: 1284 },
  series: {
    days: DAYS,
    signups: DAYS.map((_, i) => 5 + (i % 7)),
    messages: DAYS.map((_, i) => 300 + i * 10),
    // Tracking started 5 days ago.
    activeRiders: DAYS.map((_, i) => (i < 55 ? null : 200 + i)),
    ridesStarted: DAYS.map((_, i) => (i < 55 ? null : i % 3)),
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
    await expect(page.locator('.empty-title')).toHaveText('Sign in to continue');
    await expect(page.locator('#nav')).toBeHidden();
  });

  test('tells a non-staff account it has no access', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { admin: false });
    await page.goto('/admin.html');
    await expect(page.locator('.empty-title')).toHaveText('This account is not staff');
    await expect(page.locator('#nav')).toBeHidden();
  });

  test('shows the open queue safely and dismisses a report with a required note', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/moderation.html');
    await expect(page).toHaveURL(/admin\.html#moderation$/);
    await expect(page.locator('#navReportCount')).toHaveText('1');

    const card = page.locator('.report[data-report-id="report-1"]');
    await expect(card.locator('.badge').first()).toHaveText('Harassment');
    await expect(card).toContainText('Rex');
    await expect(card).toContainText('@rex · rider_badactor');
    await expect(card).toContainText('@maya_moto · rider_reporter');
    await expect(card).toContainText('3 reports against this rider');
    // Rider-written details are shown as text, never run as HTML.
    await expect(card.locator('.report-details')).toHaveText(OPEN_REPORT.details);
    await expect(card.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(card.locator('.error-text')).toContainText('Write a note first');
    expect(state.posts).toHaveLength(0);

    await card.locator('textarea').fill('Checked the chat history; no harassment.');
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.empty-title')).toHaveText('No open reports');
    expect(state.posts).toEqual([{ path: '/moderation/reports/report-1/resolve', body: { resolution: 'dismiss', note: 'Checked the chat history; no harassment.' } }]);

    await page.getByRole('button', { name: 'Audit log' }).click();
    await expect(page.locator('.list-row .person-name')).toHaveText('Dismissed a report: Rex');
    await expect(page.locator('.list-row')).toContainText('Checked the chat history; no harassment.');
  });

  test('suspends only after confirmation, then allows unsuspending', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    const card = page.locator('.report[data-report-id="report-1"]');
    await card.locator('textarea').fill('Repeated threats in messages.');

    page.once('dialog', (dialog) => dialog.dismiss());
    await card.getByRole('button', { name: 'Suspend rider' }).click();
    expect(state.posts).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'Suspend rider' }).click();
    await expect(page.locator('.empty-title')).toHaveText('No open reports');
    expect(state.posts[0]).toEqual({ path: '/moderation/reports/report-1/resolve', body: { resolution: 'suspend', note: 'Repeated threats in messages.' } });

    await page.getByRole('button', { name: 'Actioned' }).click();
    const actioned = page.locator('.report[data-report-id="report-1"]');
    await expect(actioned.locator('.badge[data-tone="danger"]')).toHaveText('Suspended');
    await actioned.locator('textarea').fill('Appeal accepted.');
    await actioned.getByRole('button', { name: 'Unsuspend rider' }).click();
    await expect(page.locator('.report[data-report-id="report-1"] .badge[data-tone="danger"]')).toHaveCount(0);
    expect(state.posts[1]).toEqual({ path: '/moderation/riders/rider_badactor/unsuspend', body: { note: 'Appeal accepted.' } });
  });

  test('overview shows KPIs with period comparisons and switches between 7 and 30 days', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html');

    const kpi = (label) => page.locator('.kpi').filter({ has: page.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) });
    await expect(kpi('New riders').locator('.kpi-value')).toHaveText('85');
    await expect(kpi('New riders').locator('.delta')).toHaveText('+25%');
    await expect(kpi('New riders').locator('.delta')).toHaveAttribute('data-tone', 'good');
    await expect(kpi('Messages sent').locator('.delta')).toHaveText('-8.8%');
    await expect(kpi('Messages sent').locator('.delta')).toHaveAttribute('data-tone', 'bad');
    // Fewer reports is good news.
    await expect(kpi('Open reports').locator('.delta')).toHaveText('-50%');
    await expect(kpi('Open reports').locator('.delta')).toHaveAttribute('data-tone', 'good');
    await expect(kpi('Total riders').locator('.kpi-value')).toHaveText('1,284');
    await expect(kpi('Total riders').locator('.kpi-foot')).toHaveText('86% verified · 3 suspended');
    await expect(kpi('Stickiness').locator('.kpi-value')).toHaveText('27%');
    await expect(kpi('Live now').locator('.kpi-value')).toHaveText('17');
    await expect(kpi('Open reports').getByRole('link', { name: 'Review queue' })).toHaveAttribute('href', '#moderation');

    await page.getByRole('button', { name: '30 days' }).click();
    await expect(kpi('New riders').locator('.kpi-value')).toHaveText('310');
    await expect(kpi('New riders').locator('.delta')).toHaveText('0%');
    await expect(page.locator('.chart-card').first().locator('.card-description')).toHaveText('Sign-ups in the last 30 days');
    // The choice is remembered for next time.
    await page.reload();
    await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('area charts compare periods, average distinct-rider counts and read out values', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html');
    const charts = page.locator('.chart-card');
    await expect(charts).toHaveCount(4);

    const signups = charts.filter({ hasText: 'New riders' }).first();
    // Last 7 days of 5 + (i % 7) sum to 56; the previous 7 also sum to 56.
    await expect(signups.locator('.chart-total')).toHaveText('56');
    await expect(signups.locator('.chart-line')).not.toHaveCount(0);
    await expect(signups.locator('.chart-line.partial')).toHaveCount(1);
    await expect(signups.locator('.chart-compare')).toHaveCount(1);

    const active = charts.filter({ hasText: 'Active riders' }).first();
    // Distinct riders per day are averaged, not summed: 255..259 average 257.
    await expect(active.locator('.chart-total')).toHaveText('257');
    await expect(active.locator('.card-description')).toHaveText('Riders active, daily average over the last 7 days');
    await expect(active.locator('.chart-untracked')).toHaveCount(1);

    await signups.locator('svg.chart-svg').scrollIntoViewIfNeeded();
    const svgBox = await signups.locator('svg.chart-svg').boundingBox();
    await page.mouse.move(svgBox.x + 6, svgBox.y + svgBox.height / 2);
    await expect(signups.locator('.tooltip')).toBeVisible();
    await expect(signups.locator('.tooltip-date')).toHaveText(/^September 24$/);
    await signups.locator('svg.chart-svg').focus();
    await page.keyboard.press('ArrowRight');
    await expect(signups.locator('.tooltip-date')).toHaveText('September 30 · so far');

    await signups.getByRole('button', { name: 'View as table' }).click();
    await expect(signups.locator('tbody tr')).toHaveCount(7);
    await expect(signups.locator('thead')).toContainText('Previous period');
  });

  test('rider lookup searches and shows account details as text', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    const rows = page.locator('[data-rider-id]:visible');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('<b>Rex</b>');
    await expect(rows.nth(1).locator('b')).toHaveCount(0);
    await expect(rows.nth(1)).toContainText('Suspended');

    await page.getByRole('searchbox', { name: 'Search riders' }).fill('nobody');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.empty-title')).toHaveText('No riders found');
    expect(state.riderQueries).toEqual(['', 'nobody']);
  });

  test('system view reports API and database health', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#system');
    const rows = page.locator('.status-row');
    await expect(rows.nth(0)).toContainText('API · Operational');
    await expect(rows.nth(0).locator('.status-dot')).toHaveAttribute('data-state', 'ok');
    await expect(rows.nth(1)).toContainText('Database · Down');
    await expect(rows.nth(1).locator('.status-dot')).toHaveAttribute('data-state', 'down');
  });
});
