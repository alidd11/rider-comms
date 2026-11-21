import { expect, test } from '@playwright/test';
import { AXE_PROJECTS, expectNoAxeViolations } from './axe.js';

const API = 'https://backend-production-7fa0.up.railway.app';
const ADMIN_ID = 'rider_admin01';

const OPEN_REPORT = {
  id: 'report-1',
  reporterId: 'rider_reporter',
  reportedRiderId: 'rider_badactor',
  reason: 'harassment',
  details: 'Reported from the ride roster. <img src=x onerror="window.__xss=1"> kept messaging me',
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
  safety: { openReports: 2, reports7d: 5, moderationActions7d: 3, filterRejections7d: 4 },
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
  funnel: {
    cohortStart: Date.parse('2026-08-31T12:00:00Z'),
    cohortEnd: Date.parse('2026-09-23T12:00:00Z'),
    signedUp: 200,
    verified: 160,
    firstRide: 90,
    returned: 45,
    rideTrackingSince: Date.parse('2026-09-20T09:00:00Z'),
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

const ROLE_PERMISSIONS = {
  admin: ['view_overview', 'view_system', 'view_riders', 'moderate', 'verify_email', 'account_help', 'view_audit', 'manage_staff'],
  moderator: ['view_overview', 'view_system', 'view_riders', 'moderate', 'view_audit'],
  support: ['view_overview', 'view_system', 'view_riders', 'verify_email', 'account_help', 'view_audit'],
  analyst: ['view_overview', 'view_system'],
};

/** Opens a dashboard section, through the side menu on phones. */
async function openSection(page, name) {
  const toggle = page.locator('#menuToggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('#nav').getByRole('button', { name }).click();
}
async function openMenuIfPhone(page) {
  const toggle = page.locator('#menuToggle');
  if (await toggle.isVisible()) await toggle.click();
}

/** Minimal in-memory moderation backend. */
async function mockModerationApi(page, { admin = true, suspended = false, role = 'admin', reauth = false } = {}) {
  const state = {
    reports: [{ ...OPEN_REPORT, reportedRiderSuspended: suspended }],
    actions: [],
    posts: [],
    riderQueries: [],
    reauthenticated: !reauth,
    // Each test gets its own riders, so verifying one doesn't leak into the next.
    riders: RIDERS.map((rider) => ({ ...rider })),
    staff: [
      { riderId: ADMIN_ID, role: 'admin', displayName: 'Ali', handle: '@ali', email: 'ali@example.com', grantedBy: null, grantedAt: null, lastSeenAt: Date.now() - 60_000 },
      { riderId: 'rider_maya', role: 'moderator', displayName: 'Maya', handle: '@maya_moto', email: 'maya@example.com', grantedBy: ADMIN_ID, grantedAt: Date.now() - 86_400_000, lastSeenAt: Date.now() - 3_600_000 },
    ],
    socialPosts: [{
      post: { id: '11111111-1111-4111-8111-111111111111', authorId: 'rider_badactor', kind: 'photo', caption: '<b>Selling</b> cheap parts', createdAt: Date.now() - 60_000, hidden: false,
        media: [{ id: 'm1', kind: 'image', width: 10, height: 10, durationMs: null, url: '/social/media/m1/file?v=admin&exp=1&sig=x', posterUrl: null }] },
      reports: 3, reasons: ['spam'],
    }],
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
    if (url.pathname === '/admin/me') return json(200, { riderId: ADMIN_ID, role, permissions: ROLE_PERMISSIONS[role] });
    if (url.pathname === '/auth/reauthenticate') {
      const { password } = request.postDataJSON();
      if (password !== 'right-password') return json(401, { error: 'invalid_credentials' });
      state.reauthenticated = true;
      return json(200, { reauthenticated: true, validForMs: 900000 });
    }
    // Like the backend: only staff changes need a recent password.
    if (request.method() === 'POST' && /^\/(moderation|admin\/staff)/.test(url.pathname) && !state.reauthenticated) return json(403, { error: 'reauth_required', windowMs: 900000 });
    if (url.pathname === '/admin/metrics') {
      const route = (name, count, errorRate, p50Ms, p95Ms) => ({ route: name, count, errorRate, clientErrorRate: 0, avgMs: p50Ms, p50Ms, p95Ms, p99Ms: p95Ms });
      return json(200, {
        windowMinutes: 60, replica: 'replica-a1', uptimeSeconds: 7_500,
        totals: route('all', 1_240, 0.004, 25, 250),
        routes: [route('GET /live/ride/:id', 820, 0, 10, 50), route('POST /rides', 40, 0.025, 100, 2_500)],
        slowest: [route('POST /rides', 40, 0.025, 100, 2_500)],
        perMinute: [{ minute: 0, count: 600, serverErrors: 2 }, { minute: 60_000, count: 640, serverErrors: 3 }],
        process: { rssMb: 180, heapUsedMb: 90, eventLoopDelayP99Ms: 12 },
        database: { total: 6, idle: 4, waiting: 0, max: 20 },
      });
    }
    if (url.pathname === '/admin/security-events') {
      return json(200, { events: [
        { id: 'e1', riderId: 'rider_maya', event: 'login_failed', sessionId: null, device: 'iPhone', createdAt: Date.now() - 60_000 },
        { id: 'e2', riderId: ADMIN_ID, event: 'login', sessionId: 's1', device: 'Mac', createdAt: Date.now() - 120_000 },
      ] });
    }
    if (url.pathname === '/admin/staff' && request.method() === 'GET') return json(200, { staff: state.staff });
    if (url.pathname === '/admin/staff' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.posts.push({ path: url.pathname, body });
      if (body.rider === 'nobody') return json(404, { error: 'not_found' });
      const existing = state.staff.find((member) => member.riderId === body.rider || member.handle === `@${body.rider.replace(/^@/, '')}`);
      if (existing) existing.role = body.role;
      else state.staff.push({ riderId: 'rider_new', role: body.role, displayName: 'Sam', handle: `@${body.rider.replace(/^@/, '')}`, email: null, grantedBy: ADMIN_ID, grantedAt: Date.now(), lastSeenAt: null });
      state.actions.unshift({ id: `a${state.actions.length}`, moderatorId: ADMIN_ID, targetRiderId: existing?.riderId ?? 'rider_new', reportId: null, action: 'staff_grant', note: `${body.role}: ${body.note}`, createdAt: Date.now() });
      return json(200, { ok: true });
    }
    const removeStaff = url.pathname.match(/^\/admin\/staff\/([^/]+)\/remove$/);
    if (removeStaff) {
      state.posts.push({ path: url.pathname, body: request.postDataJSON() });
      state.staff = state.staff.filter((member) => member.riderId !== decodeURIComponent(removeStaff[1]));
      return json(200, { ok: true });
    }
    if (url.pathname === '/admin/overview') return json(200, OVERVIEW);
    const riderDetail = url.pathname.match(/^\/admin\/riders\/(rider_[a-z0-9]+)$/);
    if (riderDetail && request.method() === 'GET') {
      const rider = state.riders.find((candidate) => candidate.riderId === riderDetail[1]);
      if (!rider) return json(404, { error: 'not_found' });
      const can = (permission) => ROLE_PERMISSIONS[role].includes(permission);
      return json(200, {
        rider,
        reportsAgainst: can('moderate') ? [{ ...OPEN_REPORT, status: 'open', resolvedAt: null, resolvedBy: null }] : null,
        reportsFiled: can('moderate') ? [] : null,
        actions: can('view_audit') ? state.actions.filter((action) => action.targetRiderId === rider.riderId) : null,
        devices: can('account_help') ? [{ id: 'd1', deviceName: 'iPhone', createdAt: new Date(Date.now() - 86_400_000).toISOString(), lastSeenAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }] : null,
        securityEvents: can('account_help') ? [{ id: 's1', riderId: rider.riderId, event: 'login_failed', sessionId: null, device: 'iPhone', createdAt: Date.now() - 120_000 }] : null,
      });
    }
    const riderAction = url.pathname.match(/^\/moderation\/riders\/([^/]+)\/(suspend|sign-out|password-reset)$/);
    if (riderAction) {
      const body = request.postDataJSON();
      state.posts.push({ path: url.pathname, body });
      const rider = state.riders.find((candidate) => candidate.riderId === riderAction[1]);
      if (riderAction[2] === 'suspend' && rider) rider.suspended = true;
      if (riderAction[2] === 'sign-out') return json(200, { ok: true, sessions: 2 });
      if (riderAction[2] === 'password-reset') return json(200, { ok: true, emailDelivery: { configured: true } });
      return json(200, { ok: true, resolvedReportIds: [] });
    }
    const claim = url.pathname.match(/^\/moderation\/reports\/([^/]+)\/claim$/);
    if (claim) {
      const body = request.postDataJSON();
      state.posts.push({ path: url.pathname, body });
      const report = state.reports.find((candidate) => candidate.id === decodeURIComponent(claim[1]));
      report.claimedBy = body.release ? null : ADMIN_ID;
      return json(200, { ok: true, claimedBy: report.claimedBy, claimedAt: Date.now() });
    }
    if (url.pathname === '/admin/riders') {
      state.riderQueries.push(url.searchParams.get('q'));
      return json(200, { riders: url.searchParams.get('q') === 'nobody' ? [] : state.riders });
    }
    if (url.pathname === '/admin/system') {
      return json(200, { socialMediaStorage: false, socialMediaScanning: true, socialPosting: true, contentCheck: { allowed: 7, rejected: 1, unavailable: 2 }, providers: { google_places: { lastOkAt: null, lastErrorAt: Date.now(), lastError: '403 · PERMISSION_DENIED' }, google_routes: { lastOkAt: Date.now(), lastErrorAt: null, lastError: null } }, email: { configured: true, lastSentAt: Date.now() - 60_000, lastRefusedAt: Date.now(), lastRefusal: 'validation_error: You can only send testing emails to your own email address ([email]). Please verify a domain.' } });
    }
    if (url.pathname === `/riders/${ADMIN_ID}/profile`) return json(200, { riderId: ADMIN_ID, displayName: 'Ali', handle: '@ali' });
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
    if (url.pathname === '/moderation/actions') {
      const riderId = url.searchParams.get('riderId');
      return json(200, { actions: riderId ? state.actions.filter((action) => action.targetRiderId === riderId) : state.actions });
    }
    if (url.pathname === '/moderation/social-posts' && request.method() === 'GET') return json(200, { posts: state.socialPosts });
    if (url.pathname.startsWith('/social/media/')) {
      // A 1×1 PNG for the post's photo.
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64') });
    }
    const body = request.postDataJSON();
    state.posts.push({ path: url.pathname, body });
    const decide = url.pathname.match(/^\/moderation\/social-posts\/([^/]+)\/(restore|remove)$/);
    if (decide) {
      state.socialPosts = state.socialPosts.filter((entry) => entry.post.id !== decide[1]);
      state.actions.unshift({ id: `a${state.actions.length}`, moderatorId: ADMIN_ID, targetRiderId: 'rider_badactor', reportId: null, action: `social_post_${decide[2]}`, note: `Rider Social post ${decide[1]}: ${body.note}`, createdAt: Date.now() });
      return json(200, { ok: true });
    }
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
    const exportMatch = url.pathname.match(/^\/admin\/riders\/([^/]+)\/export$/);
    if (exportMatch) {
      state.posts.push({ path: url.pathname, body: request.postDataJSON() });
      return json(200, { format: 'rider-comms-data-export', version: 1, account: { rider_id: decodeURIComponent(exportMatch[1]) } });
    }
    if (url.pathname.endsWith('/verify-email')) {
      const rider = state.riders.find((candidate) => url.pathname.includes(candidate.riderId));
      if (rider) rider.emailVerified = true;
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

/** Hold one response until a newer dashboard view has finished loading. */
async function holdApiResponse(page, matcher, status, body) {
  let requested;
  let release;
  const received = new Promise((resolve) => { requested = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(matcher, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    requested();
    await gate;
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return { received, release };
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

  test('reviews a hidden Rider Social post: its photo, a required note, and the audit log', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    await page.getByRole('button', { name: 'Social posts' }).click();
    // Five tabs are wider than a small phone: the tab row scrolls, the page doesn't.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const card = page.locator('article[data-post-id]');
    await expect(card).toContainText('3 reports');
    await expect(card).toContainText('@rex · rider_badactor');
    await expect(card.locator('.report-details')).toHaveText('<b>Selling</b> cheap parts');
    await expect(card.getByRole('img', { name: 'Photo 1 of 1' })).toBeVisible();
    await card.getByRole('button', { name: 'Remove post' }).click();
    await expect(card.locator('.error-text')).toContainText('Write a note first');
    await card.locator('textarea').fill('Scam listing.');
    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'Remove post' }).click();
    await expect(page.locator('.empty-title')).toHaveText('No hidden posts');
    expect(state.posts.at(-1)).toEqual({ path: '/moderation/social-posts/11111111-1111-4111-8111-111111111111/remove', body: { note: 'Scam listing.' } });
    await openSection(page, 'Audit log');
    await expect(page.locator('.list-row .person-name')).toHaveText('Removed a Social post: Rex');
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
    await expect(card.locator('.badge', { hasText: 'From the ride roster' })).toBeVisible();
    await expect(card.locator('.report-details')).toHaveText('<img src=x onerror="window.__xss=1"> kept messaging me');
    await expect(card.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(card.locator('.error-text')).toContainText('Write a note first');
    expect(state.posts).toHaveLength(0);

    await card.locator('textarea').fill('Checked the chat history; no harassment.');
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.empty-title')).toHaveText('No open reports');
    expect(state.posts).toEqual([{ path: '/moderation/reports/report-1/resolve', body: { resolution: 'dismiss', note: 'Checked the chat history; no harassment.' } }]);

    await openSection(page, 'Audit log');
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
    expect(state.posts[0]).toEqual({ path: '/moderation/reports/report-1/resolve', body: { resolution: 'suspend', note: 'Repeated threats in messages.', days: 7 } });

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
    await expect(page.locator('body')).toContainText('Blocked by the content filter this week');

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

  for (const [status, body] of [
    [200, OVERVIEW],
    [403, { error: 'permission_required', permission: 'view_overview' }],
  ]) {
    test(`a late overview ${status} response cannot replace the current riders page`, async ({ page }) => {
      await signIn(page);
      await mockModerationApi(page);
      const hold = await holdApiResponse(page, `${API}/admin/overview`, status, body);
      await page.goto('/admin.html');
      await hold.received;

      await openSection(page, 'Riders');
      await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
      const response = page.waitForResponse((item) => item.url() === `${API}/admin/overview`);
      hold.release();
      await response;
      // Give the browser an opportunity to process the earlier request's continuation.
      await page.waitForTimeout(100);
      await expect(page.locator('.page-title')).toHaveText('Riders');
      await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
      await expect(page.locator('#nav')).toBeVisible();
    });
  }

  test('a late moderation queue cannot overwrite the riders page', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    const hold = await holdApiResponse(
      page,
      (url) => url.pathname === '/moderation/reports' && url.searchParams.get('status') === 'open',
      200,
      { reports: [OPEN_REPORT] },
    );
    await page.goto('/admin.html#moderation');
    await hold.received;

    await openSection(page, 'Riders');
    await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
    const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/moderation/reports');
    hold.release();
    await response;
    await page.waitForTimeout(100);
    await expect(page.locator('.page-title')).toHaveText('Riders');
    await expect(page.locator('.report')).toHaveCount(0);
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

  test('staff verify an unverified rider\'s email with a note', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    const rex = page.locator('[data-rider-id="rider_rex"]:visible');
    await expect(rex.getByRole('button', { name: "Mark rex's email verified" })).toBeVisible();
    await expect(page.locator('[data-rider-id="rider_maya"]:visible').getByRole('button', { name: /email verified/ })).toHaveCount(0);

    page.once('dialog', (dialog) => dialog.accept('Known tester'));
    await rex.getByRole('button', { name: "Mark rex's email verified" }).click();
    await expect.poll(() => state.posts.find((post) => post.path === '/moderation/riders/rider_rex/verify-email')?.body).toEqual({ note: 'Known tester' });
    await expect(page.locator('[data-rider-id="rider_rex"]:visible').getByRole('button', { name: /email verified/ })).toHaveCount(0);
  });

  test('admins add, change and remove staff, each with a reason', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#staff');
    await expect(page.locator('.page-title')).toHaveText('Staff and roles');
    await expect(page.locator('.page-subtitle')).toHaveText('2 people have dashboard access · 1 admin, 1 moderator');
    const rows = page.locator('[data-rider-id]:visible');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Set on the backend');

    const form = page.locator('#addStaffForm');
    await form.getByRole('button', { name: 'Add to staff' }).click();
    await expect(form.locator('.error-text')).toHaveText('Enter their handle or rider ID and a reason.');
    await form.getByLabel('Handle or rider ID').fill('nobody');
    await form.getByLabel('Role').selectOption('support');
    await form.getByLabel('Reason for the audit log').fill('Help desk');
    await form.getByRole('button', { name: 'Add to staff' }).click();
    await expect(form.locator('.error-text')).toHaveText('No rider has that handle or rider ID.');
    await form.getByLabel('Handle or rider ID').fill('@sam_rides');
    await form.getByRole('button', { name: 'Add to staff' }).click();
    await expect(rows).toHaveCount(3);
    expect(state.posts.at(-1)).toEqual({ path: '/admin/staff', body: { rider: '@sam_rides', role: 'support', note: 'Help desk' } });

    const maya = page.locator('[data-rider-id="rider_maya"]:visible');
    page.once('dialog', (dialog) => dialog.accept('Covers reports now'));
    await maya.getByLabel('Role for Maya').selectOption('analyst');
    await expect.poll(() => state.posts.at(-1)).toEqual({ path: '/admin/staff', body: { rider: 'rider_maya', role: 'analyst', note: 'Covers reports now' } });
    page.once('dialog', (dialog) => dialog.accept('Left the team'));
    await page.locator('[data-rider-id="rider_maya"]:visible').getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-rider-id="rider_maya"]:visible')).toHaveCount(0);
    expect(state.posts.at(-1)).toEqual({ path: '/admin/staff/rider_maya/remove', body: { note: 'Left the team' } });

    await expect(page.locator('.matrix tbody tr')).toHaveCount(8);
    await expect(page.locator('.matrix td[aria-label="Analyst: no"]').first()).toBeVisible();
  });

  test('the audit log filters by kind and rider and exports a CSV', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.actions.push(
      { id: 'x1', moderatorId: ADMIN_ID, targetRiderId: 'rider_badactor', reportId: 'report-1', action: 'suspend', note: '=HYPERLINK("bad")', createdAt: Date.now() - 120_000 },
      { id: 'x2', moderatorId: ADMIN_ID, targetRiderId: 'rider_reporter', reportId: null, action: 'verify_email', note: 'Known tester', createdAt: Date.now() - 60_000 },
    );
    await page.goto('/admin.html#audit');
    await expect(page.locator('.list-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Accounts' }).click();
    await expect(page.locator('.list-row')).toHaveCount(1);
    await expect(page.locator('.list-row .person-name')).toHaveText('Verified email: Maya');
    await page.getByRole('button', { name: 'All actions' }).click();
    await page.getByLabel('Show actions for one rider').fill('rider_badactor');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.locator('.list-row')).toHaveCount(1);
    await expect(page.locator('.page-subtitle')).toContainText('for rider_badactor');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^rider-comms-audit-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    expect(text.split('\r\n')[0]).toBe('When (UTC),Action,Staff member,Staff rider ID,Rider,Rider ID,Report ID,Note');
    // A note that looks like a formula is exported as text.
    expect(text).toContain(`"'=HYPERLINK(""bad"")"`);
  });

  test('each role sees only its own pages', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'analyst' });
    await page.goto('/admin.html#moderation');
    await expect(page.locator('.page-title')).toHaveText('Overview');
    await openMenuIfPhone(page);
    const visibleNav = page.locator('#nav [data-view]:visible');
    await expect(visibleNav).toHaveText(['Overview', 'System']);
    await expect(page.locator('#sidebarFooter .badge')).toHaveText('Analyst');
    await page.evaluate(() => { location.hash = '#staff'; });
    await expect(page.locator('.page-title')).toHaveText('Overview');
  });

  test('support staff verify email but cannot moderate', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'support' });
    await page.goto('/admin.html#riders');
    await openMenuIfPhone(page);
    await expect(page.locator('#nav [data-view]:visible')).toHaveText(['Overview', 'Riders', 'Audit log', 'System']);
    await expect(page.locator('[data-rider-id="rider_rex"]:visible').getByRole('button', { name: /email verified/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export .* data/ })).toHaveCount(0);
  });

  test('a page the role lacks says so', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'analyst' });
    await page.route(`${API}/admin/overview`, (route) => route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ error: 'permission_required', permission: 'view_overview' }) }));
    await page.goto('/admin.html');
    await expect(page.locator('.empty-title')).toHaveText('Your role doesn’t include this page');
  });

  test('staff confirm their password before a change, then it goes through', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page, { reauth: true });
    await page.goto('/admin.html#moderation');
    const card = page.locator('.report[data-report-id="report-1"]');
    await card.locator('textarea').fill('Checked the chat history.');

    await card.getByRole('button', { name: 'Dismiss' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.locator('.error-text')).toHaveText('Not changed: your password is needed for staff changes.');
    expect(state.posts).toHaveLength(0);

    await card.getByRole('button', { name: 'Dismiss' }).click();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog.locator('.error-text')).toHaveText('Enter your password.');
    await dialog.getByLabel('Password').fill('wrong');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog.locator('.error-text')).toHaveText('That password isn’t right.');
    await dialog.getByLabel('Password').fill('right-password');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.empty-title')).toHaveText('No open reports');
    expect(state.posts).toEqual([{ path: '/moderation/reports/report-1/resolve', body: { resolution: 'dismiss', note: 'Checked the chat history.' } }]);
  });

  test('admins export a rider\'s data with a reason', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    const maya = page.locator('[data-rider-id="rider_maya"]:visible');
    page.once('dialog', (dialog) => dialog.accept('Access request, ticket 42'));
    const download = page.waitForEvent('download');
    await maya.getByRole('button', { name: "Export maya's data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^rider-comms-data-rider_maya-\d{4}-\d{2}-\d{2}\.json$/);
    expect(state.posts.at(-1)).toEqual({ path: '/admin/riders/rider_maya/export', body: { note: 'Access request, ticket 42' } });
  });

  test('a rider\'s page gathers their record, and a moderator suspends from it for a set time', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    await page.locator('[data-rider-id="rider_maya"]:visible a.person-link').click();
    await expect(page).toHaveURL(/#rider\/rider_maya$/);
    await expect(page.locator('.rider-header h1')).toHaveText('Maya');
    await expect(page.locator('.facts')).toContainText('maya@example.com');
    for (const title of ['Reports about them', 'Reports they filed', 'Staff history', 'Signed-in devices', 'Sign-in history']) {
      await expect(page.locator('.section-title', { hasText: title })).toBeVisible();
    }
    await expect(page.locator('#nav [data-view="riders"]')).toHaveAttribute('aria-current', 'page');

    await page.locator('.rider-actions').getByRole('button', { name: 'Suspend' }).click();
    const dialog = page.getByRole('dialog', { name: 'Suspend Maya?' });
    await dialog.getByRole('button', { name: 'Suspend' }).click();
    await expect(dialog.locator('.error-text')).toHaveText('Write a reason first. Every staff change is recorded with it.');
    await dialog.getByRole('button', { name: 'Spam or scam messages.' }).click();
    await dialog.getByLabel('How long').selectOption('30');
    await dialog.getByRole('button', { name: 'Suspend' }).click();
    await expect.poll(() => state.posts.at(-1)).toEqual({ path: '/moderation/riders/rider_maya/suspend', body: { note: 'Spam or scam messages.', days: 30 } });
    await expect(page.locator('.rider-actions').getByRole('button', { name: 'Unsuspend' })).toBeVisible();

    await page.locator('.back-link').click();
    await expect(page.locator('.page-title')).toHaveText('Riders');
  });

  test('support staff reset a password and sign a rider out everywhere from their page', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page, { role: 'support' });
    await page.goto('/admin.html#rider/rider_maya');
    const actions = page.locator('.rider-actions');
    await expect(actions.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
    await expect(page.locator('.section-title', { hasText: 'Reports about them' })).toHaveCount(0);
    await expect(page.locator('.section-title', { hasText: 'Sign-in history' })).toBeVisible();

    await actions.getByRole('button', { name: 'Send password reset' }).click();
    const reset = page.getByRole('dialog', { name: /password reset link/ });
    await reset.getByRole('button', { name: 'Forgot password; identity confirmed.' }).click();
    await reset.getByRole('button', { name: 'Send link' }).click();
    await expect(page.locator('.flash')).toHaveText('Password reset link sent.');
    expect(state.posts.at(-1)).toEqual({ path: '/moderation/riders/rider_maya/password-reset', body: { note: 'Forgot password; identity confirmed.' } });

    await actions.getByRole('button', { name: 'Sign out everywhere' }).click();
    const out = page.getByRole('dialog', { name: /every device/ });
    await out.getByRole('textbox').fill('Lost phone at the meet');
    await out.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.locator('.flash')).toHaveText('Signed out of 2 devices.');

    await actions.getByRole('button', { name: 'Send password reset' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('moderators take a report, see how long it waited, and suspend for the chosen length', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    const card = page.locator('.report[data-report-id="report-1"]');
    await expect(card.locator('.badge', { hasText: /^Waiting/ })).toBeVisible();
    await card.getByRole('button', { name: 'Take this report' }).click();
    await expect.poll(() => state.posts.at(-1)).toEqual({ path: '/moderation/reports/report-1/claim', body: {} });
    await expect(card.getByRole('button', { name: /You’re handling this/ })).toBeVisible();

    await card.getByRole('button', { name: 'Harassment of other riders.' }).click();
    await expect(card.locator('textarea')).toHaveValue('Harassment of other riders.');
    await card.getByLabel('Suspension length for report report-1').selectOption('');
    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: 'Suspend rider' }).click();
    await expect.poll(() => state.posts.at(-1)).toEqual({ path: '/moderation/reports/report-1/resolve', body: { resolution: 'suspend', note: 'Harassment of other riders.' } });
  });

  test('system view shows the last hour of traffic', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#system');
    await expect(page.locator('.section-title', { hasText: 'Traffic' })).toHaveText('Traffic · last 60 minutes');
    const tiles = page.locator('.traffic-kpis .kpi');
    await expect(tiles.nth(0)).toContainText('1,240');
    await expect(tiles.nth(1)).toContainText('0.4%');
    await expect(tiles.nth(2)).toContainText('250 ms');
    await expect(tiles.nth(3)).toContainText('2 / 20');
    await expect(page.locator('tr[data-route="POST /rides"]').first()).toContainText('2.5 s');
    await expect(page.locator('.page-subtitle', { hasText: 'replica-a1' })).toContainText('up 2h 5m');
  });

  test('the staff page lists recent staff sign-ins', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#staff');
    const rows = page.locator('[data-security-event]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Wrong password · iPhone');
    await expect(rows.nth(0).locator('.badge')).toHaveText('Failed');
    await expect(rows.nth(1)).toContainText('You');
  });

  test('on phones the sections open from a side menu', async ({ page }, testInfo) => {
    test.skip(!/phone/.test(testInfo.project.name), 'Phones only');
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html');
    const toggle = page.locator('#menuToggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav').getByRole('button', { name: 'Riders' })).toBeHidden();
    await expect(page.locator('#brandSection')).toHaveText('Overview');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#nav').getByRole('button', { name: 'Overview' })).toBeFocused();
    await expect(page.locator('#sidebarFooter')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    await toggle.click();
    await page.locator('#menuBackdrop').click({ position: { x: page.viewportSize().width - 8, y: Math.round(page.viewportSize().height / 2) } });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await openSection(page, 'Riders');
    await expect(page.locator('.page-title')).toHaveText('Riders');
    await expect(page.locator('#brandSection')).toHaveText('Riders');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('system view reports API and database health', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#system');
    const rows = page.locator('.status-row');
    await expect(rows.nth(0)).toContainText('API');
    await expect(rows.nth(0).locator('.badge')).toHaveText('Operational');
    await expect(rows.nth(0).locator('.badge')).toHaveAttribute('data-state', 'ok');
    await expect(rows.nth(1).locator('.badge')).toHaveText('Down');
    await expect(rows.nth(1).locator('.badge')).toHaveAttribute('data-state', 'down');
    await expect(rows.nth(2)).toContainText('Email delivery');
    await expect(rows.nth(2)).toContainText('Resend refused: You can only send testing emails');
    await expect(rows.nth(2).locator('.badge')).toHaveText('Restricted');
    await expect(rows.nth(2).locator('.badge')).toHaveAttribute('data-state', 'warn');
    await expect(rows.nth(3).locator('.badge')).toHaveText('Off');
    await expect(rows.nth(4)).toContainText('Social content check');
    await expect(rows.nth(4).locator('.badge')).toHaveText('On');
    await expect(rows.nth(5).locator('.badge')).toHaveText('On');
    await expect(rows.nth(4)).toContainText('7 allowed, 1 refused as unsafe, 2 not checked');
    // Outside services: refusing, working, and not called yet.
    await expect(rows.nth(6)).toContainText('Google place search');
    await expect(rows.nth(6).locator('.badge')).toHaveText('Refusing');
    await expect(rows.nth(6)).toContainText('403 · PERMISSION_DENIED');
    await expect(rows.nth(7).locator('.badge')).toHaveText('Working');
    await expect(rows.nth(8).locator('.badge')).toHaveText('Not used yet');
    await expect(page.locator('#sidebarFooter')).toContainText('Signed in as Ali · @ali');
    await expect(page.locator('#sidebarFooter .badge')).toHaveText('Admin');
  });
});

test('overview shows the activation funnel with step conversion and a tracking note', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page);
  await page.goto('/admin.html');
  const funnel = page.locator('.funnel');
  await expect(funnel.locator('.card-description')).toContainText('Riders who signed up');
  const steps = funnel.locator('.funnel-step');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText('200 · 100%');
  await expect(steps.nth(1)).toContainText('160 · 80%');
  await expect(steps.nth(2)).toContainText('90 · 45%');
  await expect(steps.nth(2)).toContainText('56% of the step before');
  await expect(steps.nth(3)).toContainText('45 · 23%');
  await expect(steps.nth(3)).toContainText('50% of the step before');
  await expect(funnel.locator('.funnel-note')).toContainText('First rides are counted from');
  const widths = await funnel.locator('.funnel-fill').evaluateAll((fills) => fills.map((fill) => fill.style.width));
  expect(widths).toEqual(['100%', '80%', '45%', '23%']);
});

test('staff dashboard views have no automatically detectable accessibility violations', async ({ page }, testInfo) => {
  test.skip(!AXE_PROJECTS.has(testInfo.project.name), 'Audited once per colour scheme');
  await signIn(page);
  await mockModerationApi(page);
  for (const view of ['overview', 'moderation', 'riders', 'audit', 'staff', 'system', 'rider/rider_maya']) {
    await page.goto(`/admin.html#${view}`);
    await expect(page.locator('main')).toBeVisible();
    await expectNoAxeViolations(page, view);
  }
});
