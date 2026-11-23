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
  admin: ['view_overview', 'view_system', 'view_riders', 'view_cases', 'moderate', 'verify_email', 'account_help', 'view_audit', 'manage_staff', 'review_partners'],
  moderator: ['view_overview', 'view_system', 'view_riders', 'view_cases', 'moderate', 'view_audit'],
  support: ['view_overview', 'view_system', 'view_riders', 'view_cases', 'verify_email', 'account_help', 'view_audit'],
  analyst: ['view_overview', 'view_system'],
  partnerships: ['view_overview', 'view_system', 'review_partners'],
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
async function mockModerationApi(page, { admin = true, suspended = false, role = 'admin', reauth = false, mfa = false } = {}) {
  const state = {
    reports: [{ ...OPEN_REPORT, reportedRiderSuspended: suspended, assignedTo: null, assignedAt: null }],
    assignmentEvents: [],
    staffLogins: [],
    staffLogouts: 0,
    actions: [],
    companyCaseEvents: [],
    companyCases: [
      { id: '11111111-1111-4111-8111-111111111111', kind: 'support', title: 'Account sign-in assistance', description: 'Staff-only support investigation', status: 'open', priority: 'normal', subjectRiderId: 'rider_maya', createdBy: ADMIN_ID, assignedTo: null, version: 1, createdAt: Date.now() - 100_000, updatedAt: Date.now() - 100_000, dueAt: null },
      { id: '22222222-2222-4222-8222-222222222222', kind: 'appeal', title: 'Moderation decision review', description: 'Internal review of a rider appeal', status: 'waiting', priority: 'high', subjectRiderId: 'rider_rex', createdBy: ADMIN_ID, assignedTo: null, version: 1, createdAt: Date.now() - 90_000, updatedAt: Date.now() - 90_000, dueAt: null },
      { id: '33333333-3333-4333-8333-333333333333', kind: 'privacy', title: 'Data access verification', description: 'Identity verification needed before responding', status: 'in_progress', priority: 'normal', subjectRiderId: null, createdBy: ADMIN_ID, assignedTo: null, version: 1, createdAt: Date.now() - 80_000, updatedAt: Date.now() - 80_000, dueAt: null },
      { id: '44444444-4444-4444-8444-444444444444', kind: 'incident', title: 'Route service degradation', description: 'Manual incident triage', status: 'open', priority: 'urgent', subjectRiderId: null, createdBy: ADMIN_ID, assignedTo: null, version: 1, createdAt: Date.now() - 70_000, updatedAt: Date.now() - 70_000, dueAt: null },
    ],
    posts: [],
    partnerCalls: [],
    partners: [
      { id: '55555555-5555-4555-8555-555555555555', reference: 'RC-7K3QX9', kind: 'seller', businessName: 'Twisties Moto Gear',
        contactName: 'Sam Rider', contactEmail: 'sam@example.com', website: 'https://twisties.example/', country: 'GB',
        category: 'Riding gear', description: 'Independent shop selling helmets, gloves and jackets.', status: 'in_review',
        checklist: { identity: true, business: true, website: true, policies: false }, assignedTo: null,
        createdAt: Date.now() - 3_600_000, updatedAt: Date.now() - 60_000, version: 3 },
      { id: '66666666-6666-4666-8666-666666666666', reference: 'RC-9PLM2T', kind: 'advertiser', businessName: 'Coastline Café',
        contactName: 'Ava Stone', contactEmail: 'ava@example.com', website: null, country: 'GB',
        category: 'Biker café', description: 'Café on a popular coastal route that wants to reach weekend riders.', status: 'submitted',
        checklist: { identity: false, business: false, website: false, policies: false }, assignedTo: null,
        createdAt: Date.now() - 7_200_000, updatedAt: Date.now() - 7_200_000, version: 1 },
    ],
    riderQueries: [],
    riderFilters: [],
    alertPrefs: { dailyDigest: false, urgentAlerts: false },
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
    if (url.pathname === '/auth/staff-login') {
      const body = request.postDataJSON();
      state.staffLogins.push(body);
      if (body.password !== 'right-password') return json(401, { error: 'invalid_credentials' });
      if (!admin) return json(403, { error: 'staff_only' });
      if (mfa && !body.code) return json(401, { error: 'mfa_required' });
      if (mfa && body.code !== '123456') return json(401, { error: 'invalid_code' });
      if (mfa) state.mfaPassed = true;
      return json(200, { riderId: ADMIN_ID, token: 'staff-token', emailVerified: true });
    }
    if (url.pathname === '/auth/logout' && request.method() === 'POST') {
      state.staffLogouts += 1;
      return route.fulfill({ status: 204, headers, body: '' });
    }
    if (url.pathname === '/admin/mfa/verify') {
      if (request.postDataJSON().code !== '123456') return json(401, { error: 'invalid_code' });
      state.mfaPassed = true;
      return json(200, { verified: true });
    }
    if (url.pathname === '/admin/mfa') return json(200, { enabled: mfa, recoveryCodesLeft: mfa ? 10 : 0 });
    if (url.pathname === '/admin/alerts') {
      if (request.method() === 'POST') {
        state.alertPrefs = request.postDataJSON();
        state.posts.push({ path: url.pathname, body: state.alertPrefs });
      }
      return json(200, state.alertPrefs);
    }
    if (url.pathname === '/admin/mfa/setup') return json(200, { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Rider%20Comms%20Staff%3Arider_admin01?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' });
    if (url.pathname === '/admin/mfa/confirm') {
      if (request.postDataJSON().code !== '123456') return json(401, { error: 'invalid_code' });
      return json(200, { recoveryCodes: Array.from({ length: 10 }, (_, i) => `abcde-${10000 + i}`) });
    }
    if (mfa && !state.mfaPassed && (url.pathname.startsWith('/admin') || url.pathname.startsWith('/moderation'))) {
      return json(403, { error: 'mfa_required' });
    }
    if (url.pathname === '/admin/me') return json(200, { riderId: ADMIN_ID, role, permissions: ROLE_PERMISSIONS[role] });
    if (url.pathname === '/auth/reauthenticate') {
      const { password } = request.postDataJSON();
      if (password !== 'right-password') return json(401, { error: 'invalid_credentials' });
      state.reauthenticated = true;
      return json(200, { reauthenticated: true, validForMs: 900000 });
    }
    // Like the backend: only staff changes need a recent password.
    if (request.method() === 'POST' && /^\/(moderation|admin\/(staff|cases))/.test(url.pathname) && !state.reauthenticated) return json(403, { error: 'reauth_required', windowMs: 900000 });
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
    if (url.pathname === '/admin/cases/activity') {
      if (!ROLE_PERMISSIONS[role].includes('view_cases')) return json(403, { error: 'permission_required' });
      const days = Number(url.searchParams.get('days') ?? 7);
      if (![7, 30].includes(days)) return json(400, { error: 'invalid_report_window' });
      const kinds = role === 'admin' ? ['support', 'appeal', 'privacy', 'incident']
        : role === 'support' ? ['support'] : ['appeal'];
      const items = state.companyCases.filter((item) => kinds.includes(item.kind));
      const start = Date.now() - days * 86_400_000;
      return json(200, { days, scope: 'permitted_internal_cases', completeForRetainedData: true,
        totals: {
          created: items.filter((item) => item.createdAt >= start).length,
          active: items.filter((item) => !['resolved', 'closed'].includes(item.status)).length,
          resolvedTransitions: state.companyCaseEvents.filter((event) => event.event === 'status'
            && ['resolved', 'closed'].includes(event.toValue) && event.createdAt >= start
            && items.some((item) => item.id === event.caseId)).length,
          internalNotes: state.companyCaseEvents.filter((event) => event.event === 'note' && event.createdAt >= start
            && items.some((item) => item.id === event.caseId)).length,
          assignmentChanges: state.companyCaseEvents.filter((event) => ['assigned', 'released', 'assign'].includes(event.event)
            && event.createdAt >= start && items.some((item) => item.id === event.caseId)).length,
          configuredTargets: 0, overdueTargets: 0, dueSoonTargets: 0,
        },
      });
    }
    if (url.pathname === '/admin/social/activity') {
      if (!ROLE_PERMISSIONS[role].includes('moderate')) return json(403, { error: 'permission_required' });
      const days = Number(url.searchParams.get('days') ?? 7);
      if (![7, 30].includes(days)) return json(400, { error: 'invalid_report_window' });
      return json(200, { days, scope: 'social_content_safety', completeForRetainedData: true,
        metrics: { posts: 12, photos: 9, reels: 3, reports: 4, reportedPosts: 2,
          hiddenNow: state.socialPosts.length, moderationDecisions: 1 },
        unavailable: ['social_audience_retention', 'customer_reply_sla', 'financial_reconciliation'],
      });
    }
    if (url.pathname.startsWith('/admin/partners')) {
      if (!ROLE_PERMISSIONS[role].includes('review_partners')) return json(403, { error: 'permission_required', permission: 'review_partners' });
      const open = (item) => ['submitted', 'in_review', 'info_requested'].includes(item.status);
      if (url.pathname === '/admin/partners/summary') {
        return json(200, {
          awaitingReview: state.partners.filter((item) => ['submitted', 'in_review'].includes(item.status)).length,
          infoRequested: state.partners.filter((item) => item.status === 'info_requested').length,
          approvedSellers: state.partners.filter((item) => item.status === 'approved' && item.kind === 'seller').length,
          approvedAdvertisers: state.partners.filter((item) => item.status === 'approved' && item.kind === 'advertiser').length,
        });
      }
      if (url.pathname === '/admin/partners') {
        const status = url.searchParams.get('status') ?? 'all';
        const kind = url.searchParams.get('kind') ?? 'all';
        return json(200, { items: state.partners.filter((item) => (status === 'all' || (status === 'open' ? open(item) : item.status === status))
          && (kind === 'all' || item.kind === kind)) });
      }
      const match = /^\/admin\/partners\/([0-9a-f-]{36})(?:\/(status|checklist|notes|assign))?$/.exec(url.pathname);
      const item = match && state.partners.find((value) => value.id === match[1]);
      if (!item) return json(404, { error: 'not_found' });
      if (!match[2]) return json(200, { item, events: [{ id: 'e1', actorId: null, event: 'submitted', note: 'Application submitted through the public form', fromValue: null, toValue: 'submitted', createdAt: item.createdAt }] });
      if (!state.reauthenticated) return json(403, { error: 'reauth_required' });
      const body = request.postDataJSON();
      state.partnerCalls.push({ path: url.pathname, body });
      if (body.expectedVersion !== item.version) return json(409, { error: 'stale_application' });
      if (match[2] === 'status') {
        if (body.status === 'approved' && !Object.values(item.checklist).every(Boolean)) return json(409, { error: 'checklist_incomplete' });
        item.status = body.status;
      }
      if (match[2] === 'checklist') item.checklist[body.check] = body.done;
      if (match[2] === 'assign') item.assignedTo = body.assigneeId === undefined ? ADMIN_ID : body.assigneeId;
      item.version += 1;
      item.updatedAt = Date.now();
      return json(200, { ok: true, item });
    }
    if (url.pathname === '/admin/cases/summary') {
      if (!ROLE_PERMISSIONS[role].includes('view_cases')) return json(403, { error: 'permission_required', permission: 'view_cases' });
      const kinds = role === 'admin' ? ['support', 'appeal', 'privacy', 'incident'] : role === 'support' ? ['support'] : ['appeal'];
      const byKind = kinds.map((kind) => {
        const all = state.companyCases.filter((item) => item.kind === kind);
        const active = all.filter((item) => !['resolved', 'closed'].includes(item.status));
        return { kind, total: all.length, active: active.length,
          unassigned: active.filter((item) => item.assignedTo === null).length,
          mine: active.filter((item) => item.assignedTo === ADMIN_ID).length,
          urgent: active.filter((item) => item.priority === 'urgent').length };
      });
      const totals = byKind.reduce((summary, item) => {
        for (const name of ['total', 'active', 'unassigned', 'mine', 'urgent']) summary[name] += item[name];
        return summary;
      }, { total: 0, active: 0, unassigned: 0, mine: 0, urgent: 0 });
      return json(200, { byKind, totals, generatedAt: Date.now() });
    }
    if (url.pathname === '/admin/cases' || /^\/admin\/cases\/[0-9a-f-]{36}(?:\/(?:notes|status|priority|assign))?$/.test(url.pathname)) {
      if (!ROLE_PERMISSIONS[role].includes('view_cases')) return json(403, { error: 'permission_required', permission: 'view_cases' });
      const allowedKinds = role === 'admin' ? ['support', 'appeal', 'privacy', 'incident'] : role === 'support' ? ['support'] : ['appeal'];
      if (url.pathname === '/admin/cases' && request.method() === 'GET') {
        const kind = url.searchParams.get('kind');
        if (kind && kind !== 'all' && !allowedKinds.includes(kind)) return json(403, { error: 'permission_required' });
        const status = url.searchParams.get('status');
        const owner = url.searchParams.get('owner') ?? 'all';
        const items = state.companyCases.filter((item) => allowedKinds.includes(item.kind)
          && (!kind || kind === 'all' || item.kind === kind)
          && (!status || status === 'all' || item.status === status)
          && (owner === 'all' || owner === 'mine' && item.assignedTo === ADMIN_ID || owner === 'unassigned' && item.assignedTo === null))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        return json(200, { items, hasMore: false, nextCursor: null, generatedAt: Date.now() });
      }
      if (url.pathname === '/admin/cases' && request.method() === 'POST') {
        const body = request.postDataJSON();
        if (!allowedKinds.includes(body.kind)) return json(403, { error: 'permission_required' });
        const item = { id: '55555555-5555-4555-8555-555555555555', kind: body.kind,
          title: body.title, description: body.description, priority: body.priority || 'normal',
          subjectRiderId: body.subjectRiderId || null, status: 'open', createdBy: ADMIN_ID,
          assignedTo: null, createdAt: Date.now(), updatedAt: Date.now(), version: 1, dueAt: null };
        state.companyCases.unshift(item);
        state.companyCaseEvents.push({ id: 'ce-created', caseId: item.id, actorId: ADMIN_ID,
          event: 'created', note: 'Internal case created', createdAt: item.createdAt, fromValue: null, toValue: 'open' });
        return json(201, { item });
      }
      const bits = url.pathname.split('/');
      const id = bits[3];
      const item = state.companyCases.find((entry) => entry.id === id);
      if (!item || !allowedKinds.includes(item.kind)) return json(404, { error: 'not_found' });
      if (request.method() === 'GET') return json(200, { item,
        events: state.companyCaseEvents.filter((event) => event.caseId === id) });
      const body = request.postDataJSON();
      if (item.version !== body.expectedVersion) return json(409, { error: 'stale_case' });
      if (!body.note?.trim()) return json(400, { error: 'note_required' });
      const action = bits[4];
      let before = null, after = null;
      if (action === 'status') { before = item.status; after = body.status; item.status = body.status; }
      if (action === 'priority') { before = item.priority; after = body.priority; item.priority = body.priority; }
      if (action === 'assign') { before = item.assignedTo; after = body.assigneeId || null; item.assignedTo = after; }
      item.version += 1;
      item.updatedAt = Date.now();
      state.companyCaseEvents.push({ id: 'ce-' + item.version, caseId: item.id, actorId: ADMIN_ID,
        event: action === 'notes' ? 'note' : action, note: body.note, fromValue: before,
        toValue: after, createdAt: item.updatedAt });
      return json(200, { ok: true, item });
    }
    if (url.pathname === '/admin/action-inbox') {
      if (!ROLE_PERMISSIONS[role].includes('moderate')) return json(403, { error: 'permission_required', permission: 'moderate' });
      const type = url.searchParams.get('type') ?? 'all';
      const hiddenIds = new Set(state.socialPosts.map((entry) => entry.post.id));
      const riderReports = state.reports.filter((report) =>
        report.status === 'open' && !hiddenIds.has(report.sourcePostId)).slice(0, 100)
        .map((report) => ({
          type: 'rider_report', id: `rider_report:${report.id}`,
          reportId: report.id, riderId: report.reportedRiderId, eventAt: report.createdAt,
          reason: report.reason, claimedBy: report.claimedBy ?? null, assignedTo: report.assignedTo ?? null,
          reportsAgainstRider: report.reportsAgainstRider,
        }));
      const posts = state.socialPosts.slice(0, 100).map((entry) => ({
        type: 'social_post', id: `social_post:${entry.post.id}`,
        postId: entry.post.id, riderId: entry.post.authorId,
        eventAt: entry.hiddenAt ?? entry.post.createdAt,
        kind: entry.post.kind, reportCount: entry.reports, reasons: entry.reasons,
      }));
      const items = [
        ...(type === 'social_post' ? [] : riderReports),
        ...(type === 'rider_report' ? [] : posts),
      ].sort((a, b) => a.eventAt - b.eventAt);
      return json(200, { generatedAt: Date.now(), items: items.slice(0, 50), filter: type, limit: 50,
        mayHaveMore: items.length > 50, sourceSampleLimit: 100 });
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
    const assign = url.pathname.match(/^\/moderation\/reports\/([^/]+)\/assign$/);
    if (assign && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.posts.push({ path: url.pathname, body });
      if (!ROLE_PERMISSIONS[role].includes('moderate')) return json(403, { error: 'permission_required' });
      if (!body.note) return json(400, { error: 'note_required' });
      const report = state.reports.find((item) => item.id === decodeURIComponent(assign[1]));
      if (!report) return json(404, { error: 'not_found' });
      if (report.status !== 'open') return json(409, { error: 'already_resolved' });
      const target = Object.hasOwn(body, 'assigneeId') ? body.assigneeId : ADMIN_ID;
      if (report.assignedTo === target) return json(409, { error: 'unchanged' });
      if (role !== 'admin' && ((report.assignedTo && report.assignedTo !== ADMIN_ID) ||
        (target && target !== ADMIN_ID))) return json(409, { error: 'assigned_to_other' });
      const event = { id: `own-${state.assignmentEvents.length + 1}`, reportId: report.id, actorId: ADMIN_ID,
        previousAssignee: report.assignedTo ?? null, assigneeId: target, event: target === null ? 'released'
          : report.assignedTo ? 'transferred' : 'assigned', note: body.note, createdAt: Date.now() };
      report.assignedTo = target;
      report.assignedAt = target === null ? null : event.createdAt;
      state.assignmentEvents.unshift(event);
      return json(200, { ok: true, assignedTo: target, assignedAt: report.assignedAt, event });
    }
    const assignmentHistory = url.pathname.match(/^\/moderation\/reports\/([^/]+)\/assignment-history$/);
    if (assignmentHistory && request.method() === 'GET') {
      if (!ROLE_PERMISSIONS[role].includes('moderate')) return json(403, { error: 'permission_required' });
      return json(200, { events: state.assignmentEvents.filter((e) =>
        e.reportId === decodeURIComponent(assignmentHistory[1])) });
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
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const matches = state.riders.filter((rider) => [
        rider.displayName, rider.username, rider.handle, rider.email, rider.riderId,
      ].some((value) => String(value ?? '').toLowerCase().includes(query)));
      const filter = url.searchParams.get('filter') || 'all';
      state.riderFilters.push(filter);
      const filtered = matches.filter((rider) => filter === 'all' || (filter === 'suspended' && rider.suspended)
        || (filter === 'unverified' && !rider.emailVerified) || (filter === 'reported' && rider.reportsAgainst > 0));
      const limit = Number(url.searchParams.get('limit') || 50);
      const offset = Number(url.searchParams.get('offset') || 0);
      const riders = filtered.slice(offset, offset + limit);
      return json(200, { riders, nextOffset: riders.length === limit ? offset + limit : null });
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
    const reportId = url.pathname.match(/^\/moderation\/reports\/([^/]+)$/);
    if (request.method() === 'GET' && reportId) {
      if (!ROLE_PERMISSIONS[role].includes('moderate')) return json(403, { error: 'permission_required', permission: 'moderate' });
      const report = state.reports.find((row) => row.id === decodeURIComponent(reportId[1]));
      return report ? json(200, { report }) : json(404, { error: 'not_found' });
    }
    const hiddenPostId = url.pathname.match(/^\/moderation\/social-posts\/([^/]+)$/);
    if (request.method() === 'GET' && hiddenPostId) {
      if (!ROLE_PERMISSIONS[role].includes('moderate')) return json(403, { error: 'permission_required', permission: 'moderate' });
      const entry = state.socialPosts.find((row) => row.post.id === decodeURIComponent(hiddenPostId[1]));
      return entry ? json(200, { entry }) : json(404, { error: 'not_found' });
    }
    if (url.pathname === '/moderation/reports') {
      const status = url.searchParams.get('status');
      return json(200, { reports: state.reports.filter((report) => report.status === status).slice(0, 100) });
    }
    if (url.pathname === '/moderation/actions') {
      const riderId = url.searchParams.get('riderId');
      return json(200, { actions: riderId ? state.actions.filter((action) => action.targetRiderId === riderId) : state.actions });
    }
    if (url.pathname === '/moderation/social-posts' && request.method() === 'GET') return json(200, { posts: state.socialPosts.slice(0, 100) });
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
    if (url.pathname === '/moderation/reports/dismiss-many') {
      const body = request.postDataJSON();
      state.posts.push({ path: url.pathname, body });
      const dismissed = [];
      const skipped = [];
      for (const reportId of body.reportIds) {
        const report = state.reports.find((candidate) => candidate.id === reportId && candidate.status === 'open');
        if (!report) { skipped.push({ reportId, error: 'already_resolved' }); continue; }
        Object.assign(report, { status: 'dismissed', resolvedAt: Date.now(), resolvedBy: ADMIN_ID });
        dismissed.push(reportId);
      }
      return json(200, { dismissed, skipped });
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


/** Simulate the Service Worker lifecycle deterministically. We do not replace
 * the production worker, and the test never needs real network deployment. */
async function mockStaffPwaUpdateLifecycle(page) {
  await page.addInitScript(() => {
    const containerListeners = new Map();
    const registrationListeners = new Map();
    const workerListeners = new Map();
    const state = { messages: [], updateCalls: 0, registrationArgs: null };
    const sw = {
      controller: {},
      register: async (url, options) => {
        state.registrationArgs = { url, options };
        return registration;
      },
      addEventListener: (name, cb) => containerListeners.set(name, cb),
    };
    const candidate = {
      state: 'installing',
      addEventListener: (name, cb) => workerListeners.set(name, cb),
      postMessage: (message) => {
        state.messages.push(message);
        if (message.type === 'SKIP_WAITING') {
          sessionStorage.setItem('__staff_update_applied', 'yes');
          sw.controller = {};
          containerListeners.get('controllerchange')?.();
        }
      },
    };
    const registration = {
      waiting: null,
      installing: null,
      addEventListener: (name, cb) => registrationListeners.set(name, cb),
      update: async () => { state.updateCalls += 1; },
    };
    state.announce = () => {
      registration.installing = candidate;
      registrationListeners.get('updatefound')?.();
      registration.waiting = candidate;
      candidate.state = 'installed';
      workerListeners.get('statechange')?.();
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
    window.__staffTestUpdate = state;
  });
}

test.describe('staff dashboard', () => {

  test('Staff PWA checks updates and activates an idle version on the next safe refresh', async ({ page }) => {
    await mockStaffPwaUpdateLifecycle(page);
    await mockModerationApi(page);
    await page.goto('/staff/');
    await expect.poll(() => page.evaluate(() =>
      window.__staffTestUpdate?.registrationArgs?.options?.updateViaCache)).toBe('none');
    await expect.poll(() => page.evaluate(() => window.__staffTestUpdate?.updateCalls)).toBeGreaterThan(0);
    // Initial sign-in focus alone is not an unsaved edit; no reload should
    // happen on first registration until a *different* worker is installed.
    expect(await page.evaluate(() => sessionStorage.getItem('__staff_update_applied'))).toBeNull();
    const reloaded = page.waitForEvent('load');
    // Defer until after the evaluation context returns: activation reloads.
    await page.evaluate(() => { setTimeout(() => window.__staffTestUpdate.announce(), 0); });
    await reloaded;
    expect(await page.evaluate(() => sessionStorage.getItem('__staff_update_applied'))).toBe('yes');
    await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();
  });

  test('Staff PWA defers updates during edits, respects Later, and confirms forced reload', async ({ page }) => {
    await mockStaffPwaUpdateLifecycle(page);
    await mockModerationApi(page);
    await page.goto('/staff/');
    await expect.poll(() => page.evaluate(() =>
      window.__staffTestUpdate?.registrationArgs?.options?.updateViaCache)).toBe('none');
    await page.getByRole('textbox', { name: 'Rider Comms username' }).fill('ali');
    await page.getByLabel('Password', { exact: true }).fill('in-progress-secret');
    await page.evaluate(() => window.__staffTestUpdate.announce());
    const notice = page.locator('.staff-update-banner');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Finish or save your edits');
    expect(await page.evaluate(() => window.__staffTestUpdate.messages)).toEqual([]);
    await notice.getByRole('button', { name: 'Later' }).click();
    await expect(notice).toBeHidden();
    // Simulate reopening a suspended iOS Home Screen app.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(notice).toBeVisible();
    expect(await page.evaluate(() => window.__staffTestUpdate.messages)).toEqual([]);
    page.on('dialog', (dialog) => dialog.accept());
    const reloaded = page.waitForEvent('load');
    await notice.getByRole('button', { name: 'Update now' }).click();
    await reloaded;
    expect(await page.evaluate(() => sessionStorage.getItem('__staff_update_applied'))).toBe('yes');
    expect(await page.evaluate(() => window.__staffTestUpdate?.registrationArgs?.options?.scope)).toBe('./');
    await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();
  });

  test('installed staff entry has independent sign-in, install metadata and a revocable session', async ({ page }) => {
    // The main Rider Comms login must not automatically grant the isolated app a session.
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/staff/');
    const heading = page.getByRole('heading', { name: 'Staff sign in' });
    await expect(heading).toBeVisible();
    await expect(page.getByText('Your operations workspace.')).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.json');
    const manifest = await page.request.get('/staff/manifest.json');
    expect(manifest.status()).toBe(200);
    expect(await manifest.json()).toMatchObject({
      name: 'Rider Comms Staff', id: './', start_url: './', scope: './', display: 'standalone',
    });
    await page.getByRole('textbox', { name: 'Rider Comms username' }).fill('ali');
    await page.getByLabel('Password', { exact: true }).fill('right-password');
    await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
    await expect(page.locator('#nav')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('.page-title')).toHaveText('Overview');
    await expect.poll(() => state.staffLogins.length).toBe(1);
    expect(state.staffLogins[0].deviceName).toBe('Rider Comms Staff PWA');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rider-comms-staff-session-v1')));
    expect(stored.riderId).toBe(ADMIN_ID);
    await openMenuIfPhone(page);
    const signout = page.getByRole('button', { name: 'Sign out of Staff' });
    await signout.click();
    await expect(heading).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('rider-comms-staff-session-v1'))).toBeNull();
    await expect.poll(() => state.staffLogouts).toBe(1);
  });

  test('staff PWA denies riders without staff access and never retains their token', async ({ page }) => {
    await mockModerationApi(page, { admin: false });
    await page.goto('/staff/');
    await page.getByRole('textbox', { name: 'Rider Comms username' }).fill('rider');
    await page.getByLabel('Password', { exact: true }).fill('right-password');
    await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
    await expect(page.getByRole('alert')).toHaveText('This account does not have staff access.');
    await expect(page.locator('#nav')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('rider-comms-staff-session-v1'))).toBeNull();
  });

  test('staff PWA handles incorrect credentials without retaining passwords', async ({ page }) => {
    await mockModerationApi(page);
    await page.goto('/staff/');
    await page.getByRole('textbox', { name: 'Rider Comms username' }).fill('ali');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
    await expect(page.getByRole('alert')).toHaveText('The username or password is incorrect.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });



  test('case owner survives refresh and history remains separate from the quick claim', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    const report = page.locator('[data-report-id="report-1"]');
    await expect(report).toContainText('No permanent owner');
    await report.locator('textarea').fill('Taking long-term responsibility');
    await report.getByRole('button', { name: 'Assign permanently to me' }).click();
    await expect(report).toContainText('Case owner:');
    await expect(report).toContainText('Take this report');
    await expect.poll(() => state.posts.at(-1)).toEqual({
      path: '/moderation/reports/report-1/assign',
      body: { assigneeId: ADMIN_ID, note: 'Taking long-term responsibility' },
    });
    await report.getByRole('button', { name: 'View ownership history' }).click();
    const history = report.getByRole('region', { name: 'Ownership history for report report-1' });
    await expect(history).toContainText('Taking long-term responsibility');
    await expect(history).toContainText('assigned');
    await report.getByRole('button', { name: 'Hide ownership history' }).click();
    await expect(history).toHaveCount(0);
    await report.locator('textarea').fill('Handing over permanently');
    await report.getByRole('button', { name: 'Release permanent ownership' }).click();
    await expect(report).toContainText('No permanent owner');
    await report.getByRole('button', { name: 'View ownership history' }).click();
    await expect(report.getByRole('region', { name: 'Ownership history for report report-1' })).toContainText('Handing over permanently');
    await openSection(page, 'Action inbox');
    await expect(page.locator('.inbox-item').first()).toContainText('No permanent owner');
  });

  test('an administrator can hand over a report to a moderator with an audited reason', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    const report = page.locator('[data-report-id="report-1"]');
    await report.getByRole('button', { name: 'Assign to team member' }).click();
    const handover = report.getByRole('group', { name: 'Staff handover for report report-1' });
    const member = handover.getByRole('combobox', { name: 'Team member for report report-1' });
    await expect(member).toBeFocused();
    await expect(handover).not.toContainText('maya@example.com');
    await expect(handover.getByRole('button', { name: 'Assign selected member' })).toBeDisabled();
    await member.selectOption('rider_maya');
    await report.locator('textarea').fill('Handed over for a second reviewer');
    await handover.getByRole('button', { name: 'Assign selected member' }).click();
    await expect(report).toContainText('Case owner:');
    await expect.poll(() => state.reports[0].assignedTo).toBe('rider_maya');
    await expect.poll(() => state.posts.at(-1)).toEqual({
      path: '/moderation/reports/report-1/assign',
      body: { assigneeId: 'rider_maya', note: 'Handed over for a second reviewer' },
    });
    await report.getByRole('button', { name: 'View ownership history' }).click();
    await expect(report.getByRole('region', { name: 'Ownership history for report report-1' })).toContainText('Handed over for a second reviewer');
  });

  test('moderators cannot open admin-only team handover controls', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'moderator' });
    await page.goto('/admin.html#moderation');
    const report = page.locator('[data-report-id="report-1"]');
    await expect(report.getByRole('button', { name: 'Assign to team member' })).toHaveCount(0);
    await expect(report.getByRole('button', { name: 'Assign permanently to me' })).toBeVisible();
  });

  test('team handover can be cancelled without assigning a rider', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    const report = page.locator('[data-report-id="report-1"]');
    const trigger = report.getByRole('button', { name: 'Assign to team member' });
    await trigger.click();
    const panel = report.getByRole('group', { name: 'Staff handover for report report-1' });
    await panel.getByRole('button', { name: 'Cancel handover' }).click();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveCount(0);
    expect(state.reports[0].assignedTo).toBeNull();
  });

  test('assigned cases are shown in the inbox without leaking underlying notes', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.reports[0].assignedTo = ADMIN_ID;
    state.reports[0].assignedAt = Date.now() - 10_000;
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.inbox-item').first()).toContainText('Case owner: you');
    await expect(page.locator('.inbox-item').first().locator('.inbox-item-meta .badge')).toHaveAttribute('data-tone', 'accent');
    await expect(page.locator('.inbox-item').first()).not.toContainText('Private report details');
    await page.getByRole('button', { name: 'Review rider report' }).click();
    await expect(page.locator('[data-report-id="report-1"]')).toContainText('Case owner:');
  });

  test('quick claim does not imply permanent case ownership or urgency', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.reports[0].claimedBy = ADMIN_ID;
    await page.goto('/admin.html#inbox');
    const report = page.locator('.inbox-item').filter({ hasText: 'Rider report' });
    await expect(report.locator('.inbox-item-meta .badge')).toHaveText('No permanent owner');
    await expect(report.locator('.inbox-item-meta .badge')).not.toHaveAttribute('data-tone', 'accent');
    await expect(report.locator('.inbox-item-meta .badge')).not.toHaveAttribute('data-tone', 'warning');
    await expect(report.locator('.inbox-quick-claim')).toContainText('Quick claim:');
  });

  test('action inbox owner filters show only matching returned reports', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.reports[0].assignedTo = ADMIN_ID;
    state.reports[0].assignedAt = Date.now();
    await page.goto('/admin.html#inbox');

    const ownership = page.getByRole('group', { name: 'Action inbox ownership' });
    await expect(page.locator('.inbox-item')).toHaveCount(2);
    await expect(page.locator('.inbox-sample-count')).toHaveText('Showing 2 of 2 returned items');

    await ownership.getByRole('button', { name: 'Assigned to me' }).click();
    await expect(ownership.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true');
    await expect(ownership.getByRole('button', { name: 'Assigned to me' })).toBeFocused();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    await expect(page.locator('.inbox-item').first()).toContainText('Case owner: you');
    await expect(page.locator('.inbox-sample-count')).toHaveText('Showing 1 of 2 returned items');

    await ownership.getByRole('button', { name: 'Unassigned' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(0);
    await expect(page.getByText('No matching work in this sample')).toBeVisible();
    await expect(page.locator('.inbox-sample-count')).toHaveText('Showing 0 of 2 returned items');
    await ownership.getByRole('button', { name: 'All owners' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(2);
  });

  test('Social posts source clears owner filter because Social ownership is unavailable', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.reports[0].assignedTo = ADMIN_ID;
    await page.goto('/admin.html#inbox');

    await page.getByRole('group', { name: 'Action inbox ownership' })
      .getByRole('button', { name: 'Assigned to me' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    const sources = page.getByRole('group', { name: 'Action inbox sources' });
    await sources.getByRole('button', { name: 'Social posts' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    await expect(page.locator('.inbox-item').first()).toContainText('Rider Social');
    await expect(page.getByRole('group', { name: 'Action inbox ownership' })).toHaveCount(0);
    await sources.getByRole('button', { name: 'All work' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(2);
    await expect(page.getByRole('group', { name: 'Action inbox ownership' })
      .getByRole('button', { name: 'All owners' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('action inbox shows true moderation sources and opens the selected rider report', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.page-title')).toHaveText('Action inbox');
    const list = page.locator('.inbox-item');
    await expect(list).toHaveCount(2);
    await expect(list.first()).toContainText('Rider report');
    await expect(list.last()).toContainText('Rider Social');
    await list.first().getByRole('button', { name: 'Review rider report' }).click();
    await expect(page).toHaveURL(/#moderation$/);
    await expect(page.locator('.page-title')).toHaveText('Moderation');
    await expect(page.locator('[data-report-id="report-1"]')).toBeFocused();
  });

  test('action inbox filters sources and opens the selected Social post', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#inbox');
    const sources = page.getByRole('group', { name: 'Action inbox sources' });
    await sources.getByRole('button', { name: 'Social posts' }).click();
    await expect(sources.getByRole('button', { name: 'Social posts' })).toBeFocused();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Review Social post' }).click();
    await expect(page.locator('[data-post-id="11111111-1111-4111-8111-111111111111"]')).toBeFocused();
    await expect(page.locator('.page-title')).toHaveText('Moderation');
  });


  test('inbox navigation retrieves a report outside 100 linked Social safety reports', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    const hiddenPost = state.socialPosts[0].post.id;
    state.reports = [
      ...Array.from({ length: 130 }, (_, n) => ({
        ...OPEN_REPORT, id: `linked-${n}`, createdAt: n + 1, sourcePostId: hiddenPost,
      })),
      { ...OPEN_REPORT, id: 'last-independent', createdAt: 500, sourcePostId: null },
    ];
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.inbox-item')).toHaveCount(2);
    await page.getByRole('button', { name: 'Review rider report' }).click();
    await expect(page.locator('[data-report-id="last-independent"]')).toBeFocused();
    await expect(page.locator('.inbox-intro')).toContainText('Loaded directly by its identifier');
    await page.getByRole('button', { name: 'Take this report' }).click();
    await expect(page.locator('[data-report-id="last-independent"]')).toBeFocused();
    await expect(page.locator('[data-report-id="last-independent"]')).toContainText('You’re handling this');
    await page.getByRole('button', { name: 'Back to queue' }).click();
    await expect(page.locator('[data-report-id="last-independent"]')).toHaveCount(0,
      'ordinary bounded moderation queue excludes the selected report');
  });

  test('Social post navigation survives a concurrent reorder beyond the first 100', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    const selectedPost = state.socialPosts[0];
    await page.goto('/admin.html#inbox');
    await page.getByRole('group', { name: 'Action inbox sources' }).getByRole('button', { name: 'Social posts' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    state.socialPosts.unshift(...Array.from({ length: 110 }, (_, n) => ({
      post: { ...selectedPost.post, id: `newer-hidden-${n}`, media: [] },
      reports: 9, reasons: ['spam'],
    })));
    await page.getByRole('button', { name: 'Review Social post' }).click();
    await expect(page.locator('[data-post-id="11111111-1111-4111-8111-111111111111"]')).toBeFocused();
    await page.getByRole('button', { name: 'Back to queue' }).click();
    await expect(page.locator('[data-post-id="11111111-1111-4111-8111-111111111111"]')).toHaveCount(0);
  });

  test('inbox shows changed report status instead of claiming a moved queue item', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.inbox-item')).toHaveCount(2);
    state.reports[0].status = 'dismissed';
    state.reports[0].resolvedAt = Date.now();
    state.reports[0].resolvedBy = ADMIN_ID;
    await page.getByRole('button', { name: 'Review rider report' }).click();
    await expect(page.locator('[data-report-id="report-1"]')).toBeFocused();
    await expect(page.locator('.inbox-intro')).toContainText('Report currently dismissed');
    await expect(page.locator('[data-report-id="report-1"] [data-action="dismiss"]')).toHaveCount(0);
  });

  test('inbox does not infer resolution when the selected record disappears', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.inbox-item')).toHaveCount(2);
    state.reports = [];
    await page.getByRole('button', { name: 'Review rider report' }).click();
    const missing = page.locator('[data-selected-unavailable]');
    await expect(missing).toBeFocused();
    await expect(missing).toContainText('No resolution is assumed');
    await page.getByRole('button', { name: 'Back to queue' }).click();
    await expect(page.locator('.empty-title')).toHaveText('No open reports');
  });

  test('inbox filter changes keep controls available and ignore late source responses', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    const hold = await holdApiResponse(
      page,
      (url) => url.pathname === '/admin/action-inbox' && url.searchParams.get('type') === 'rider_report',
      200,
      { generatedAt: Date.now(), filter: 'rider_report', limit: 50, sourceSampleLimit: 100,
        mayHaveMore: false, items: [{ type: 'rider_report', id: 'rider_report:stale',
          reportId: 'stale', riderId: 'rider_reporter', eventAt: Date.now(),
          reason: 'spam', claimedBy: null, reportsAgainstRider: 1 }] },
    );
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.inbox-item')).toHaveCount(2);
    const sources = page.getByRole('group', { name: 'Action inbox sources' });
    await sources.getByRole('button', { name: 'Rider reports' }).click();
    await hold.received;
    await expect(sources.getByRole('button', { name: 'Social posts' })).toBeVisible();
    await sources.getByRole('button', { name: 'Social posts' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    await expect(page.locator('.inbox-item')).toContainText('Rider Social');
    const stale = page.waitForResponse((response) => new URL(response.url()).pathname === '/admin/action-inbox'
      && new URL(response.url()).searchParams.get('type') === 'rider_report');
    hold.release();
    await stale;
    await page.waitForTimeout(100);
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    await expect(page.locator('.inbox-item')).toContainText('Rider Social');
  });

  test('support and analyst accounts cannot access the action inbox', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'support' });
    await page.goto('/admin.html#inbox');
    await expect(page.locator('#nav [data-view="inbox"]')).toBeHidden();
    await expect(page).toHaveURL(/#overview$/);
    await expect(page.locator('.page-title')).toHaveText('Overview');
  });

  test('action inbox shows an honest empty state without fabricated tickets', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#inbox');
    const sources = page.getByRole('group', { name: 'Action inbox sources' });
    await sources.getByRole('button', { name: 'Social posts' }).click();
    await expect(page.locator('.inbox-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Review Social post' }).click();
    const post = page.locator('[data-post-id="11111111-1111-4111-8111-111111111111"]');
    await post.locator('textarea').fill('Removed impersonation scam.');
    await post.getByRole('button', { name: 'Restore post' }).click();
    await openSection(page, 'Action inbox');
    await sources.getByRole('button', { name: 'Social posts' }).click();
    await expect(page.locator('.empty-title')).toHaveText('Nothing waiting in this view');
  });

  test('shows a direct, accessible Staff login when no Rider Comms session exists', async ({ page }) => {
    await mockModerationApi(page);
    await page.goto('/admin.html');
    await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your operations workspace.' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Rider Comms username' })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in to Operations Hub' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the installable Staff app' })).toHaveAttribute('href', './staff/');
    await expect(page.locator('#nav')).toBeHidden();
    await expect(page.locator('#menuToggle')).toBeHidden();
    await expect(page.locator('.workspace-toolbar')).toBeHidden();
  });

  test('blocks a revoked or non-staff legacy rider session and offers only Staff sign in', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { admin: false });
    await page.goto('/admin.html');
    await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('This account does not have staff access.');
    await expect(page.locator('#nav')).toBeHidden();
    await expect(page.locator('#menuToggle')).toBeHidden();
    await expect(page.locator('.page-title')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('rider-comms-staff-session-v1'))).toBeNull();
  });


  test('company areas is a directory: no figures duplicated from Insights, finance marked disconnected', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#company');
    // Counts live in Overview (queues) and Insights (trends), not here.
    await expect(page.getByRole('region', { name: 'Company pulse' })).toHaveCount(0);
    await expect(page.locator('#page')).not.toContainText('1,284');
    const company = page.getByRole('region', { name: 'Company operations' });
    await expect(company).toContainText('Rider Comms');
    await expect(company).toContainText('Rider Social');
    await expect(company).toContainText('Trust & safety');
    await expect(company).toContainText('Customer support');
    await expect(company).toContainText('People & access');
    await expect(company).toContainText('Privacy & compliance');
    await expect(company).toContainText('Platform reliability');
    const billing = company.locator('.company-unit', { hasText: 'Commercial & billing' });
    await expect(billing).toContainText('Not connected');
    await expect(billing).toContainText('No financial totals shown');
    await expect(billing.getByRole('button')).toHaveCount(0);
    await company.getByRole('button', { name: 'Review Social queue' }).click();
    await expect(page).toHaveURL(/#inbox$/);
    await expect(page.locator('.page-title')).toHaveText('Action inbox');
  });

  test('company navigation respects server-provided staff permissions', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'analyst' });
    await page.goto('/admin.html#company');
    const company = page.getByRole('region', { name: 'Company operations' });
    await expect(company.getByRole('button', { name: 'Review Social queue' })).toHaveCount(0);
    await expect(company.getByRole('button', { name: 'Manage staff roles' })).toHaveCount(0);
    await expect(company.getByRole('button', { name: 'Open support cases' })).toHaveCount(0);
    await expect(company.getByRole('button', { name: 'Open privacy cases' })).toHaveCount(0);
    await expect(company.getByRole('button', { name: 'Inspect platform' })).toBeVisible();
    await company.getByRole('button', { name: 'Inspect platform' }).click();
    await expect(page.locator('.page-title')).toHaveText('System');
  });

  test('case activity reports come from a labelled full-history API without hiding the queue', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#cases');
    await expect(page.locator('.case-item')).toHaveCount(4);
    const report = page.locator('.case-activity-report');
    await expect(report).toBeVisible();
    await expect(report).toContainText('last 7 days');
    await expect(report).not.toHaveAttribute('open', '');
    await report.locator('summary').click();
    await expect(report).toContainText('Complete counts from retained internal cases');
    await expect(report).toContainText('not a response-time SLA');
    await page.getByRole('combobox', { name: 'Reporting period' }).selectOption('30');
    await expect(page.locator('.case-activity-report > summary')).toContainText('last 30 days');
    await expect(page.locator('.case-item')).toHaveCount(4);
  });

  test('Social safety reporting is opt-in, source-scoped and leaves content moderation usable', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    await page.getByRole('button', { name: 'Social posts' }).click();
    const report = page.locator('.social-activity-report');
    await expect(report).toBeVisible();
    await expect(report).toContainText('last 7 days');
    await expect(report).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-post-id]')).toHaveCount(1);
    await report.locator('summary').click();
    await expect(report).toContainText('Hidden now');
    await expect(report).toContainText('not a Social audience or engagement report');
    await expect(page.getByRole('button', { name: 'Restore post' })).toBeVisible();
  });

  test('case desk shows real staff-scoped workstreams and a full internal case detail', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#cases');
    await expect(page.locator('.page-title')).toHaveText('Case desk');
    const list = page.getByRole('list', { name: 'Internal work cases' });
    await expect(page.getByRole('region', { name: 'Permitted case workload' })).toContainText('Urgent');
    await expect(list.locator('.case-item')).toHaveCount(4);
    await expect(page.getByRole('group', { name: 'Filter cases' }).getByRole('combobox')).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Workstream' }).selectOption('support');
    await expect(list.locator('.case-item')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Ownership' }).selectOption('unassigned');
    await expect(list.locator('.case-item')).toHaveCount(1);
    await page.getByRole('link', { name: 'Account sign-in assistance' }).click();
    await expect(page).toHaveURL(/#case\/11111111-1111-4111-8111-111111111111$/);
    await expect(page.getByRole('region', { name: 'Case actions' })).toBeVisible();
    await page.getByLabel('Case update reason').fill('Investigation started after verified contact.');
    await page.getByLabel('Case status').selectOption('in_progress');
    await page.getByRole('button', { name: 'Update status' }).click();
    await expect(page.getByRole('list', { name: 'Case activity history' })).toContainText('Investigation started');
  });

  test('staff can create a company case and every action stays on the same audit timeline', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#cases');
    await page.getByRole('button', { name: 'New case' }).click();
    const dialog = page.getByRole('dialog', { name: 'New company case' });
    await dialog.getByLabel('Case category').selectOption('support');
    await dialog.getByLabel('Case title').fill('Rider cannot restore account access');
    await dialog.getByLabel('Internal description').fill('Account recovery investigation only');
    await dialog.getByRole('button', { name: 'Create internal case' }).click();
    await expect(page.locator('.page-title')).toHaveText('Rider cannot restore account access');
    await page.getByLabel('Case update reason').fill('Confirmed account case opened by staff.');
    await page.getByRole('button', { name: 'Add internal note' }).click();
    await expect(page.getByRole('list', { name: 'Case activity history' })).toContainText('Confirmed account case opened');
  });

  test('case titles remain inert text, not executable HTML', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#cases');
    await page.getByRole('button', { name: 'New case' }).click();
    const dialog = page.getByRole('dialog', { name: 'New company case' });
    await dialog.getByLabel('Case title').fill('<img src=x onerror="window.__case_xss=1">');
    await dialog.getByRole('button', { name: 'Create internal case' }).click();
    await expect(page.locator('.page-title')).toContainText('<img src=x onerror=');
    expect(await page.evaluate(() => window.__case_xss)).toBeUndefined();
    await expect(page.locator('#page img')).toHaveCount(0);
  });

  test('moderators can see internal appeal cases but not customer support or privacy records', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'moderator' });
    await page.goto('/admin.html#cases');
    await expect(page.locator('.case-item')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Moderation decision review' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Workstream' }).locator('option', { hasText: 'Customer support' })).toHaveCount(0);
  });

  test('Case Desk marks overdue internal targets without treating resolved cases as overdue', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.companyCases[0].dueAt = new Date(Date.now() - 3_600_000).toISOString();
    state.companyCases[1].dueAt = new Date(Date.now() + 86_400_000).toISOString();
    await page.goto('/admin.html#cases');

    const overdue = page.locator('[data-case-id="11111111-1111-4111-8111-111111111111"]');
    const scheduled = page.locator('[data-case-id="22222222-2222-4222-8222-222222222222"]');
    await expect(overdue).toHaveAttribute('data-follow-up', 'overdue');
    await expect(overdue).toContainText('Internal target overdue');
    await expect(scheduled).toHaveAttribute('data-follow-up', 'normal');
    await expect(scheduled).not.toContainText('Internal target overdue');

    await overdue.getByRole('link', { name: 'Account sign-in assistance' }).click();
    await expect(page.locator('.case-detail-overdue-target')).toContainText('Internal target overdue');
    // An ISO timestamp from the API must populate datetime-local without
    // crashing the entire case view (numeric epoch values also remain valid).
    await expect(page.getByRole('region', { name: 'Case actions' })).toBeVisible();
    await expect(page.getByLabel('Internal follow-up target')).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    state.companyCases[0].status = 'resolved';
    await page.goto('/admin.html#cases');
    await expect(page.locator('[data-case-id="11111111-1111-4111-8111-111111111111"]')).toHaveAttribute('data-follow-up', 'normal');
  });

  test('Case Desk loaded record count updates after another bounded page is fetched', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.route('**/admin/cases?*', async (route) => {
      const nextPage = new URL(route.request().url()).searchParams.has('before');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          items: nextPage ? state.companyCases.slice(2, 4) : state.companyCases.slice(0, 2),
          hasMore: !nextPage,
          nextCursor: nextPage ? null : 'test-second-page',
          generatedAt: Date.now(),
        }),
      });
    });
    await page.goto('/admin.html#cases');
    await expect(page.locator('.case-item')).toHaveCount(2);
    await expect(page.locator('.case-page-note')).toContainText('2 of 2 loaded cases');
    await page.getByRole('button', { name: 'Load older cases' }).click();
    await expect(page.locator('.case-item')).toHaveCount(4);
    await expect(page.locator('.case-page-note')).toContainText('4 of 4 loaded cases');
  });

  test('support sees support cases only, while analysts cannot open the case desk', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'support' });
    await page.goto('/admin.html#cases');
    await expect(page.locator('.page-title')).toHaveText('Case desk');
    await expect(page.locator('.case-item')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: 'Workstream' }).locator('option', { hasText: 'Privacy requests' })).toHaveCount(0);
    await page.goto('/admin.html#case/33333333-3333-4333-8333-333333333333');
    await expect(page).toHaveURL(/#case\/33333333-3333-4333-8333-333333333333$/);
    await expect(page.locator('#page')).toContainText('Case not available');
  });

  test('mobile masthead stays fixed and the navigation drawer has a visible close button', async ({ page }, testInfo) => {
    test.skip(!/phone/.test(testInfo.project.name), 'Phones only');
    await signIn(page);
    await mockModerationApi(page);
    // Insights is long on every phone; the compact Overview may not scroll.
    await page.goto('/admin.html#insights');
    await expect(page.locator('.sidebar')).toHaveCSS('position', 'fixed');
    await expect(page.locator('.chart-card').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1100));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const top = await page.locator('.sidebar').evaluate((node) => node.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThanOrEqual(1);
    await page.locator('#menuToggle').click();
    await expect(page.getByText('Staff operations', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.locator('#menuToggle')).toBeFocused();
    await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'false');
  });

  test('operations home links real work to existing staff sections', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html');
    const operations = page.getByRole('region', { name: 'Operations at a glance' });
    await expect(operations).toContainText('Reports awaiting review');
    await expect(operations).toContainText('Rides in progress');
    await operations.getByRole('button', { name: 'Review reports' }).click();
    await expect(page.locator('.page-title')).toHaveText('Moderation');
    await openSection(page, 'Overview');
    await operations.getByRole('button', { name: 'Open case desk' }).click();
    await expect(page.locator('.page-title')).toHaveText('Case desk');
  });

  test('workspace toolbar tracks navigation and opens command search with restored focus', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#overview');
    const toolbar = page.getByRole('banner', { name: 'Workspace navigation' });
    const current = page.locator('#workspaceCurrentSection');
    const trigger = page.getByRole('button', { name: 'Open command search' });
    await expect(current).toHaveText('Overview');
    await expect(page.locator('.page-eyebrow')).toHaveCount(0);
    await expect(page.locator('.page-title')).toHaveText('Overview');
    if (page.viewportSize().width >= 900) {
      await expect(toolbar).toBeVisible();
      await expect(trigger).toBeVisible();
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Search operations' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    } else {
      await expect(toolbar).toBeHidden();
    }
    await openSection(page, 'Riders');
    await expect(current).toHaveText('Riders');
    await openSection(page, 'Action inbox');
    await expect(current).toHaveText('Action inbox');
    await expect(page.locator('.page-title')).toHaveText('Action inbox');
  });

  test('page headers keep tasks visible and context available without repeated branding', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#inbox');
    await expect(page.locator('.page-title')).toHaveText('Action inbox');
    await expect(page.locator('.page-eyebrow')).toHaveCount(0);
    // No disclosure of definitions above the work; a page shows live context only.
    await expect(page.locator('.page-context')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Action inbox sources' })).toBeVisible();
    const intro = page.locator('details.inbox-intro');
    await expect(intro).not.toHaveAttribute('open', '');
    await intro.locator('summary').click();
    await expect(intro).toContainText('Review and assign work in Moderation');
    await expect(page.locator('.inbox-item')).toHaveCount(2);
  });

  test('each page has its own job: Overview queues, Insights trends, Company areas directory', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#overview');
    const work = page.getByRole('region', { name: 'Operations at a glance' });
    // Reports, three case queues (from the case summary), partner applications and rides on the road.
    await expect(work.locator('.operation-card')).toHaveCount(6);
    await expect(work.locator('.operation-card', { hasText: 'Cases without an owner' }).locator('.operation-value')).toHaveText('4');
    await expect(work.locator('.operation-card', { hasText: 'Urgent cases' }).locator('.operation-value')).toHaveText('1');
    // When the queue figures were taken sits beside the queue heading.
    await expect(work.locator('.operations-updated')).toContainText('Updated');
    await expect(page.locator('.overview-highlight')).toHaveCount(0);
    await expect(page.locator('.kpi')).toHaveCount(0);
    await expect(page.locator('.chart-card')).toHaveCount(0);
    await expect(page.locator('.reporting-range-select')).toHaveCount(0);
    await work.getByRole('button', { name: 'Assign cases' }).click();
    await expect(page).toHaveURL(/#cases$/);
    await expect(page.getByRole('combobox', { name: 'Ownership' })).toHaveValue('unassigned');
    await openSection(page, 'Insights');
    await expect(page.locator('.kpi')).toHaveCount(8);
    await expect(page.locator('.chart-card')).toHaveCount(4);
    // Live and queue figures stay on the Overview.
    await expect(page.locator('.kpi-label', { hasText: /^Live now$/ })).toHaveCount(0);
    await expect(page.locator('.kpi-label', { hasText: /^Open reports$/ })).toHaveCount(0);
    await openSection(page, 'Company areas');
    await expect(page.getByRole('region', { name: 'Company operations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review Social queue' })).toBeVisible();
  });

  test('command search shows permitted pages and opens a rider record without exposing markup', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html');
    // The nav is authorised after /admin/me but intentionally stays in a closed drawer on mobile.
    await expect(page.locator('#nav')).not.toHaveAttribute('hidden', '');
    const trigger = await page.locator('#globalSearchMobile').isVisible()
      ? page.locator('#globalSearchMobile') : page.locator('#globalSearchTrigger');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Search operations' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Moderation/ })).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search pages and riders' }).fill('maya');
    await expect(dialog.locator('#globalSearchRiders .search-result')).toHaveCount(1);
    await expect.poll(() => state.riderQueries).toContain('maya');
    await dialog.getByRole('button', { name: /Maya.*Rider/ }).click();
    await expect(page).toHaveURL(/#rider\/rider_maya$/);
    await expect(page.locator('.rider-header h1')).toHaveText('Maya');
    await expect(dialog).not.toBeVisible();
  });


  for (const entry of ['/admin.html', '/staff/']) {
    test(`command search keyboard navigation works in ${entry}`, async ({ page }) => {
      if (entry === '/staff/') {
        await page.addInitScript((riderId) => {
          localStorage.setItem('rider-comms-staff-session-v1',
            JSON.stringify({ riderId, token: 'admin-token' }));
        }, ADMIN_ID);
      } else {
        await signIn(page);
      }
      await mockModerationApi(page);
      await page.goto(entry);
      await expect(page.locator('#nav')).not.toHaveAttribute('hidden', '');
      await page.keyboard.press('ControlOrMeta+k');
      const dialog = page.getByRole('dialog', { name: 'Search operations' });
      const input = dialog.getByRole('searchbox', { name: 'Search pages and riders' });
      const results = dialog.locator('.search-result');
      await expect(dialog).toBeVisible();
      await expect(input).toBeFocused();
      await expect(dialog.locator('.search-shortcuts')).toContainText('Move');

      await input.press('ArrowDown');
      await expect(results.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(results.nth(1)).toBeFocused();
      await page.keyboard.press('End');
      await expect(results.last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(results.first()).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(input).toBeFocused();

      // Home/End still edit text in the search field rather than stealing focus.
      await input.fill('maya');
      await input.press('Home');
      await expect(input).toBeFocused();
      const rider = dialog.locator('#globalSearchRiders .search-result');
      await expect(rider).toHaveCount(1);
      await input.press('ArrowDown');
      await expect(rider).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(input).toBeFocused();
      await input.press('ArrowUp');
      await expect(rider).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(page).toHaveURL(new RegExp('#rider/rider_maya$'));
      await expect(page.locator('.rider-header h1')).toHaveText('Maya');
      await expect(dialog).not.toBeVisible();
    });
  }

  test('a late search response cannot replace newer results or execute rider markup', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    const hold = await holdApiResponse(page,
      (url) => url.pathname === '/admin/riders' && url.searchParams.get('q') === 'maya',
      200, { riders: [RIDERS[0]] });
    await page.goto('/admin.html');
    // The nav is authorised after /admin/me but intentionally stays in a closed drawer on mobile.
    await expect(page.locator('#nav')).not.toHaveAttribute('hidden', '');
    await page.keyboard.press('/');
    const dialog = page.getByRole('dialog', { name: 'Search operations' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('searchbox', { name: 'Search pages and riders' });
    await input.fill('maya');
    await hold.received;
    await input.fill('rex');
    await expect(dialog.locator('#globalSearchRiders .search-result')).toHaveCount(1);
    await expect(dialog.locator('#globalSearchRiders .search-result')).toContainText('<b>Rex</b>');
    await expect(dialog.locator('#globalSearchRiders .search-result b')).toHaveCount(0);
    const stale = page.waitForResponse((item) => new URL(item.url()).pathname === '/admin/riders'
      && new URL(item.url()).searchParams.get('q') === 'maya');
    hold.release();
    await stale;
    await page.waitForTimeout(100);
    await expect(dialog.locator('#globalSearchRiders .search-result')).toHaveCount(1);
    await expect(dialog.locator('#globalSearchRiders .search-result')).toContainText('<b>Rex</b>');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('command search respects analyst permissions and closes with Escape', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page, { role: 'analyst' });
    await page.goto('/admin.html');
    // The nav is authorised after /admin/me but intentionally stays in a closed drawer on mobile.
    await expect(page.locator('#nav')).not.toHaveAttribute('hidden', '');
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Search operations' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Overview/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /System/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Riders/ })).toHaveCount(0);
    await dialog.getByRole('searchbox', { name: 'Search pages and riders' }).fill('maya');
    await expect(dialog.locator('#globalSearchRiders .search-result')).toHaveCount(0);
    expect(state.riderQueries).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });


  test('global search never replaces an open staff confirmation dialog', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#rider/rider_maya');
    await page.locator('.rider-actions').getByRole('button', { name: 'Suspend' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Suspend Maya?' });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Search operations' })).toBeHidden();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
  });

  test('rider 360 section shortcuts scroll without changing the record route', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#rider/rider_maya');
    const jump = page.getByRole('navigation', { name: 'Rider record sections' });
    await expect(jump.getByRole('button', { name: 'Account details' })).toBeVisible();
    await jump.getByRole('button', { name: 'Sign-in history' }).click();
    await expect(page.locator('#rider-section-sign-in-history')).toBeFocused();
    await expect(page).toHaveURL(/#rider\/rider_maya$/);
  });

  test('reviews a hidden Rider Social post: its photo, a required note, and the audit log', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#moderation');
    await page.getByRole('button', { name: 'Social posts' }).click();
    await expect(page.getByRole('button', { name: 'Social posts' })).toBeFocused();
    // Tabs scroll horizontally on phones without widening the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const card = page.locator('article[data-post-id]');
    await expect(card).toContainText('3 reports');
    await expect(card).toContainText('@rex · rider_badactor');
    await expect(card.locator('.report-details')).toHaveText('<b>Selling</b> cheap parts');
    await expect(card.getByRole('img', { name: 'Photo 1 of 1' })).toBeVisible();
    await card.getByRole('button', { name: 'Remove post' }).click();
    await expect(card.locator('.error-text')).toContainText('Write a note first');
    await card.locator('textarea').fill('Scam listing.');
    await card.getByRole('button', { name: 'Remove post' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Remove this Social post?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Remove post' }).click();
    await expect(page.locator('.empty-title')).toHaveText('No hidden posts');
    expect(state.posts.at(-1)).toEqual({ path: '/moderation/social-posts/11111111-1111-4111-8111-111111111111/remove', body: { note: 'Scam listing.' } });
    await openSection(page, 'Audit log');
    await expect(page.locator('.list-row .person-name')).toHaveText('Removed a Social post: Rex');
  });

  test('staff select several open reports and dismiss them with one note', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    state.reports.push({ ...state.reports[0], id: 'report-2' }, { ...state.reports[0], id: 'report-3' });
    await page.goto('/admin.html#moderation');
    const bar = page.getByRole('group', { name: 'Bulk actions' });
    await expect(bar.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Select report report-1' }).check();
    await page.getByRole('checkbox', { name: 'Select report report-3' }).check();
    await expect(bar).toContainText('2 selected');
    await expect(bar.getByRole('checkbox', { name: 'Select all open reports' })).not.toBeChecked();
    await bar.getByRole('button', { name: 'Dismiss selected' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss 2 reports?' });
    await dialog.getByRole('button', { name: 'Duplicate reports of the same incident.' }).click();
    await dialog.getByRole('button', { name: 'Dismiss reports' }).click();
    await expect(page.locator('.flash')).toHaveText('2 dismissed.');
    await expect(page.locator('.report[data-report-id]')).toHaveCount(1);
    await expect(page.locator('.report[data-report-id="report-2"]')).toBeVisible();
    await expect(bar).toHaveCount(0); // a single report has no bulk bar
    expect(state.posts.at(-1)).toEqual({ path: '/moderation/reports/dismiss-many', body: { reportIds: ['report-1', 'report-3'], note: 'Duplicate reports of the same incident.' } });
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

    await card.getByRole('button', { name: 'Suspend rider' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Suspend this rider?' });
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    expect(state.posts).toHaveLength(0);

    await card.getByRole('button', { name: 'Suspend rider' }).click();
    await confirmation.getByRole('button', { name: 'Suspend rider' }).click();
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
    await page.goto('/admin.html#insights');

    const kpi = (label) => page.locator('.kpi').filter({ has: page.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) });
    await expect(kpi('New riders').locator('.kpi-value')).toHaveText('85');
    await expect(kpi('New riders').locator('.delta')).toHaveText('+25%');
    await expect(kpi('New riders').locator('.delta')).toHaveAttribute('data-tone', 'good');
    await expect(kpi('Messages sent').locator('.delta')).toHaveText('-8.8%');
    await expect(kpi('Messages sent').locator('.delta')).toHaveAttribute('data-tone', 'bad');
    // Fewer reports is good news.
    await expect(kpi('Reports filed').locator('.kpi-value')).toHaveText('5');
    await expect(kpi('Reports filed').locator('.delta')).toHaveText('-50%');
    await expect(kpi('Reports filed').locator('.delta')).toHaveAttribute('data-tone', 'good');
    await expect(kpi('Total riders').locator('.kpi-value')).toHaveText('1,284');
    await expect(kpi('Total riders').locator('.kpi-foot')).toHaveText('86% verified · 3 suspended');
    await expect(kpi('Stickiness').locator('.kpi-value')).toHaveText('27%');
    await expect(kpi('Moderation decisions').locator('.kpi-value')).toHaveText('3');
    await expect(kpi('Reports filed').getByRole('link', { name: 'Review queue' })).toHaveAttribute('href', '#moderation');
    await expect(page.locator('body')).toContainText('Blocked by the content filter this week');

    await page.getByRole('combobox', { name: 'Reporting period' }).selectOption('30');
    await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveValue('30');
    await expect(kpi('New riders').locator('.kpi-value')).toHaveText('310');
    await expect(kpi('New riders').locator('.delta')).toHaveText('0%');
    await expect(page.locator('.chart-card').first().locator('.card-description')).toHaveText('Sign-ups in the last 30 days');
    // The choice is remembered for next time.
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveValue('30');
  });

  test('area charts compare periods, average distinct-rider counts and read out values', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#insights');
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
      // On narrow screens the drawer is deliberately closed, even when staff
      // navigation remains available. Do not require it to be visually open.
      await expect(page.locator('#nav')).not.toHaveAttribute('hidden', '');
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

  test('browser Back and Forward restore sections and their headings', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html');
    await openSection(page, 'Riders');
    await expect(page.getByRole('heading', { name: 'Riders', exact: true })).toBeFocused();
    await openSection(page, 'System');
    await expect(page.locator('.page-title')).toHaveText('System');
    await page.goBack();
    await expect(page).toHaveURL(/#riders$/);
    await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/#system$/);
    await expect(page.locator('.page-title')).toHaveText('System');
  });

  test('a failed section load offers Retry and recovers', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    let first = true;
    await page.route((url) => url.pathname === '/admin/riders', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      if (first) {
        first = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'temporarily_unavailable' }),
        });
      } else {
        await route.fallback();
      }
    });
    await page.goto('/admin.html#riders');
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
  });

  test('refresh retains existing rider content until the new reply arrives', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
    const hold = await holdApiResponse(page, (url) => url.pathname === '/admin/riders', 200, { riders: RIDERS });
    if (await page.locator('#refreshMobile').isVisible()) await page.locator('#refreshMobile').click();
    else await page.locator('.desktop-refresh').click();
    await hold.received;
    await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeVisible();
    await expect(page.locator('.skeleton')).toHaveCount(0);
    hold.release();
    await expect(page.locator('[data-rider-id]:visible')).toHaveCount(2);
  });

  test('a failed refresh keeps previously loaded rider results visible', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    await expect(page.locator('[data-rider-id]:visible')).toHaveCount(2);
    let fail = true;
    await page.route((url) => url.pathname === '/admin/riders', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      if (fail) {
        fail = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'temporarily_unavailable' }),
        });
      } else await route.fallback();
    });
    const refresh = await page.locator('#refreshMobile').isVisible()
      ? page.locator('#refreshMobile')
      : page.locator('.desktop-refresh');
    await refresh.click();
    await expect(page.locator('.flash[data-tone="warning"]')).toContainText('Showing the last loaded data');
    await expect(page.locator('[data-rider-id]:visible')).toHaveCount(2);
    await refresh.click();
    await expect(page.locator('[data-rider-id]:visible')).toHaveCount(2);
    await expect(page.locator('.page-title')).toHaveText('Riders');
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
    await expect(page.getByRole('searchbox', { name: 'Search riders' })).toBeFocused();
    expect(state.riderQueries).toEqual(['', 'nobody']);
  });

  test('rider filters narrow the list and more riders load past the first page', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    for (let index = 0; index < 55; index += 1) {
      state.riders.push({ ...RIDERS[0], riderId: `rider_extra_${index}`, username: `extra${index}`, displayName: `Extra ${index}`, handle: `@extra${index}`, email: `extra${index}@example.com` });
    }
    await page.goto('/admin.html#riders');
    const rows = page.locator('[data-rider-id]:visible');
    await expect(rows).toHaveCount(50);
    await expect(page.locator('.page-subtitle')).toContainText('Newest 50+ riders');
    await page.getByRole('button', { name: 'Load more riders' }).click();
    await expect(rows).toHaveCount(57);
    await expect(page.getByRole('button', { name: 'Load more riders' })).toHaveCount(0);

    await page.getByRole('combobox', { name: 'Show riders' }).selectOption('suspended');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('<b>Rex</b>');
    await expect(page.getByRole('combobox', { name: 'Show riders' })).toBeFocused();
    await page.getByRole('combobox', { name: 'Show riders' }).selectOption('reported');
    await page.getByRole('searchbox', { name: 'Search riders' }).fill('maya');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.empty-title')).toHaveText('No riders found');
    expect(state.riderFilters).toEqual(['all', 'all', 'suspended', 'reported', 'reported']);
  });

  test('staff verify an unverified rider\'s email with a note', async ({ page }) => {
    await signIn(page);
    const state = await mockModerationApi(page);
    await page.goto('/admin.html#riders');
    const rex = page.locator('[data-rider-id="rider_rex"]:visible');
    await expect(rex.getByRole('button', { name: "Mark rex's email verified" })).toBeVisible();
    await expect(page.locator('[data-rider-id="rider_maya"]:visible').getByRole('button', { name: /email verified/ })).toHaveCount(0);

    await rex.getByRole('button', { name: "Mark rex's email verified" }).click();
    const verify = page.getByRole('dialog', { name: /email verified/ });
    await verify.getByRole('textbox', { name: 'Reason for the audit log' }).fill('Known tester');
    await verify.getByRole('button', { name: 'Mark verified' }).click();
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

    await expect(page.locator('.staff-add-details')).not.toHaveAttribute('open', '');
    await page.locator('.staff-add-details > summary').click();
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
    await maya.getByLabel('Role for Maya').selectOption('analyst');
    const change = page.getByRole('dialog', { name: 'Change Maya to Analyst?' });
    await change.getByRole('button', { name: 'Change role' }).click();
    await expect(change.locator('.error-text')).toContainText('Write a reason first');
    await change.getByRole('textbox', { name: 'Reason for the audit log' }).fill('Covers reports now');
    await change.getByRole('button', { name: 'Change role' }).click();
    await expect.poll(() => state.posts.at(-1)).toEqual({ path: '/admin/staff', body: { rider: 'rider_maya', role: 'analyst', note: 'Covers reports now' } });
    const mayaUpdated = page.locator('[data-rider-id="rider_maya"]:visible');
    await mayaUpdated.getByLabel('Role for Maya').selectOption('support');
    await page.getByRole('dialog', { name: 'Change Maya to Support?' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(mayaUpdated.getByLabel('Role for Maya')).toHaveValue('analyst');
    await mayaUpdated.getByRole('button', { name: 'Remove' }).click();
    const remove = page.getByRole('dialog', { name: 'Remove Maya from staff?' });
    await remove.getByRole('textbox', { name: 'Reason for the audit log' }).fill('Left the team');
    await remove.getByRole('button', { name: 'Remove staff' }).click();
    await expect(page.locator('[data-rider-id="rider_maya"]:visible')).toHaveCount(0);
    expect(state.posts.at(-1)).toEqual({ path: '/admin/staff/rider_maya/remove', body: { note: 'Left the team' } });

    // The permissions table is optional context, not an obligatory full-page wall of text.
    await expect(page.locator('.staff-roles-details')).not.toHaveAttribute('open', '');
    await page.locator('.staff-roles-details > summary').click();
    // The Case Desk permission adds an actual row to the staff rights matrix.
    await expect(page.locator('.matrix tbody tr')).toHaveCount(10);
    await expect(page.locator('.matrix tbody tr').filter({ hasText: 'Company case desk' })).toHaveCount(1);
    await expect(page.locator('.matrix tbody tr').filter({ hasText: 'Seller and advertiser applications' })).toHaveCount(1);
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
    await expect(page.getByRole('button', { name: 'Accounts' })).toBeFocused();
    await expect(page.locator('.list-row')).toHaveCount(1);
    await expect(page.locator('.list-row .person-name')).toHaveText('Verified email: Maya');
    await page.getByRole('button', { name: 'All actions' }).click();
    await page.getByLabel('Show actions for one rider').fill('rider_badactor');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('searchbox', { name: 'Show actions for one rider' })).toBeFocused();
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
    await expect(visibleNav).toHaveText(['Overview', 'Insights', 'Company areas', 'System']);
    await expect(page.locator('#sidebarFooter .badge')).toHaveText('Analyst');
    await page.evaluate(() => { location.hash = '#staff'; });
    await expect(page.locator('.page-title')).toHaveText('Overview');
  });

  test('support staff verify email but cannot moderate', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page, { role: 'support' });
    await page.goto('/admin.html#riders');
    await openMenuIfPhone(page);
    // The new case workstream is intentionally visible to support, without
    // exposing moderation or the restricted privacy and incident queues.
    const visibleSections = await page.locator('#nav [data-view]:visible').evaluateAll((buttons) =>
      buttons.map((button) => button.textContent.replace(/\s+/g, ' ').trim()));
    expect(visibleSections).toEqual(['Overview', 'Insights', 'Riders', 'Audit log', 'Company areas', 'Case desk', 'System']);
    await expect(page.locator('#nav [data-view="moderation"]')).toBeHidden();
    await expect(page.locator('[data-rider-id="rider_rex"]:visible').getByRole('button', { name: /email verified/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export .* data/ })).toHaveCount(0);
  });

  test('expired staff access on System is not disguised as missing metrics', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    await page.route(`${API}/admin/system`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      await route.fulfill({ status: 401, headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json', body: JSON.stringify({ error: 'session_expired' }) });
    });
    await page.goto('/admin.html#system');
    await expect(page.locator('.empty-title')).toHaveText('Your session has expired');
    await expect(page.locator('#nav')).toBeHidden();
  });

  test('an unavailable staff access check offers a retry', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    let first = true;
    await page.route(`${API}/admin/me`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      if (first) {
        first = false;
        await route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' },
          contentType: 'application/json', body: JSON.stringify({ error: 'temporarily_unavailable' }) });
      } else await route.fallback();
    });
    await page.goto('/admin.html');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.page-title')).toHaveText('Overview');
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
    await maya.getByRole('button', { name: "Export maya's data" }).click();
    const dialog = page.getByRole('dialog', { name: /Export maya’s account data/ });
    await dialog.getByRole('textbox', { name: 'Reason for the audit log' }).fill('Access request, ticket 42');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
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

    await card.getByRole('combobox', { name: /Start the note from a reason/ }).selectOption('Harassment of other riders.');
    await expect(card.locator('textarea')).toHaveValue('Harassment of other riders.');
    await card.getByLabel('Suspension length for report report-1').selectOption('');
    await card.getByRole('button', { name: 'Suspend rider' }).click();
    await page.getByRole('dialog', { name: 'Suspend this rider?' }).getByRole('button', { name: 'Suspend rider' }).click();
    await expect.poll(() => state.posts.at(-1)).toEqual({ path: '/moderation/reports/report-1/resolve', body: { resolution: 'suspend', note: 'Harassment of other riders.' } });
  });

  test('system view labels unavailable details and can retry just that view', async ({ page }) => {
    await signIn(page);
    await mockModerationApi(page);
    let first = true;
    await page.route(`${API}/admin/system`, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      if (first) {
        first = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'temporarily_unavailable' }),
        });
      } else {
        await route.fallback();
      }
    });
    await page.goto('/admin.html#system');
    await expect(page.locator('.system-warning')).toContainText('Service setup could not be loaded');
    await expect(page.locator('.traffic-kpis')).toBeVisible();
    await page.getByRole('button', { name: 'Retry details' }).click();
    await expect(page.locator('.system-warning')).toHaveCount(0);
    await expect(page.locator('.status-row', { hasText: 'Email delivery' })).toBeVisible();
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
    await page.locator('#nav [data-view="system"]').focus();
    await page.keyboard.press('Tab');
    const installLink = page.getByRole('link', { name: 'Open installable Staff app' });
    await expect(installLink).toBeFocused();
    await expect(installLink).toHaveAttribute('href', './staff/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Account security' })).toBeFocused();
    await page.keyboard.press('Tab');
    const signOut = page.getByRole('button', { name: 'Sign out of Staff' });
    await expect(signOut).toBeFocused();
    await page.keyboard.press('Tab');
    const drawerClose = page.getByRole('button', { name: 'Close navigation' });
    await expect(drawerClose).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(signOut).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drawerClose).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();

    await toggle.click();
    await page.getByRole('button', { name: 'Close navigation' }).click();
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

test('Insights retains the activation funnel with step conversion and a tracking note', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page);
  await page.goto('/admin.html#insights');
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
  for (const view of ['overview', 'insights', 'company', 'moderation', 'riders', 'audit', 'staff', 'system', 'rider/rider_maya']) {
    await page.goto(`/admin.html#${view}`);
    await expect(page.locator('main')).toBeVisible();
    await expectNoAxeViolations(page, view);
  }
});



test('Staff Hub premium console preserves responsive shell and navigation focus', async ({ page }, testInfo) => {
  test.skip(!['phone-modern', 'iphone-17-pro-max-webkit', 'viewport-desktop-chromium'].includes(testInfo.project.name),
    'Check each principal visual target only');
  await signIn(page);
  await mockModerationApi(page);
  for (const view of ['overview', 'company', 'cases', 'insights']) {
    await page.goto('/admin.html#' + view);
    await expect(page.locator('.page-header .page-title')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('#nav [aria-current="page"]')).toHaveCount(1);
    const metrics = await page.evaluate(() => {
      const rail = document.querySelector('.sidebar');
      const background = getComputedStyle(rail).backgroundColor;
      const title = document.querySelector('.page-title');
      const main = document.querySelector('.main');
      return {
        railBackground: background,
        headingSize: parseFloat(getComputedStyle(title).fontSize),
        viewport: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        mainWidth: main.getBoundingClientRect().width,
      };
    });
    expect(metrics.railBackground).toBe('rgb(16, 33, 43)');
    expect(metrics.headingSize).toBeGreaterThanOrEqual(26);
    expect(metrics.mainWidth).toBeGreaterThan(0);
    expect(metrics.pageWidth - metrics.viewport).toBeLessThanOrEqual(1);
  }
  await page.goto('/admin.html#overview');
  // Overview carries no explanatory disclosure; the queue shows when it was taken.
  await expect(page.locator('.page-context')).toHaveCount(0);
  await expect(page.locator('.operations-updated')).toContainText('Updated');
  await expect(page.locator('.operation-card')).toHaveCount(6);
  if (testInfo.project.name !== 'viewport-desktop-chromium') {
    // Capture the actual navigation drawer, not just the fixed mobile header.
    const toggle = page.locator('#menuToggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#drawerClose')).toBeVisible();
    await expect(page.locator('.app')).toHaveClass(/menu-open/);
    await page.screenshot({
      path: testInfo.outputPath('staff-premium-' + testInfo.project.name + '-navigation-drawer.png'),
      fullPage: false,
    });
    await page.locator('#drawerClose').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
});

// CI visual baselines are screenshots of the real rendered Staff PWA shell
// against deterministic, non-production API fixtures. Do not mistake fixture
// counts, names or mocked health checks for screenshots of live customer data.
for (const [deviceProject, label] of [
  ['phone-modern', 'mobile'],
  ['iphone-17-pro-max-webkit', 'ios-dark'],
  ['viewport-desktop-chromium', 'desktop'],
]) {
  test(`staff Operations Hub screenshot evidence on ${label}${deviceProject.includes('viewport') ? ' @viewport' : ''}`,
    async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== deviceProject, 'Capture once for each target');
      await page.addInitScript((riderId) => {
        localStorage.setItem('rider-comms-staff-session-v1', JSON.stringify({ riderId, token: 'admin-token' }));
      }, ADMIN_ID);
      await mockModerationApi(page);
      const sections = [
        ['overview', 'overview'], ['insights', 'insights'], ['company', 'company-areas'],
        ['inbox', 'action-inbox'], ['riders', 'riders'],
        ['moderation', 'moderation'], ['cases', 'case-desk'],
        ['audit', 'audit-log'], ['staff', 'staff'], ['system', 'system'],
        ['rider/rider_maya', 'rider-detail'],
        ['case/11111111-1111-4111-8111-111111111111', 'case-detail'],
      ];
      for (const [route, name] of sections) {
        await page.goto(`/staff/#${route}`);
        await expect(page.locator('main .page-title')).toBeVisible();
        await expect(page.locator('#page')).toHaveAttribute('aria-busy', 'false');
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const filename = `staff-${label}-${name}.png`;
        const filePath = testInfo.outputPath(filename);
        await page.screenshot({ path: filePath, fullPage: true, animations: 'disabled' });
        await testInfo.attach(filename, { path: filePath, contentType: 'image/png' });
      }
    });
}

// Capture a real overdue state, not only the default empty-target screenshots.
// These attachments let reviewers inspect badge wrapping on three form factors.
for (const [deviceProject, label] of [
  ['phone-modern', 'mobile'],
  ['iphone-17-pro-max-webkit', 'ios-dark'],
  ['viewport-desktop-chromium', 'desktop'],
]) {
  test(`staff Case Desk overdue follow-up screenshot on ${label}${deviceProject.includes('viewport') ? ' @viewport' : ''}`,
    async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== deviceProject, 'Capture one per target');
      // The installable Staff PWA uses a distinct staff-session key;
      // the ordinary Rider Comms login fixture is intentionally insufficient.
      await page.addInitScript((riderId) => {
        localStorage.setItem('rider-comms-staff-session-v1', JSON.stringify({ riderId, token: 'admin-token' }));
      }, ADMIN_ID);
      const state = await mockModerationApi(page);
      state.companyCases[0].dueAt = new Date(Date.now() - 86_400_000).toISOString();
      await page.goto('/staff/#cases');
      await expect(page.locator('[data-case-id="11111111-1111-4111-8111-111111111111"]')).toHaveAttribute('data-follow-up', 'overdue');
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const filename = `staff-${label}-case-overdue.png`;
      const filePath = testInfo.outputPath(filename);
      await page.screenshot({ path: filePath, fullPage: true, animations: 'disabled' });
      await testInfo.attach(filename, { path: filePath, contentType: 'image/png' });
    });
}

test('date controls appear only where reporting changes, not on operational queues', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page);
  await page.goto('/admin.html#cases');
  const range = page.getByRole('combobox', { name: 'Reporting period' });
  await expect(range).toHaveValue('7');
  await expect(page.locator('.reporting-range-caption')).toHaveText('Period');
  await range.selectOption('30');
  await expect(page.getByText(/loaded cases updated in the last 30 days/)).toBeVisible();
  await expect(page.locator('.case-item')).toHaveCount(4);
  for (const name of ['Action inbox', 'Riders', 'Moderation', 'Overview']) {
    await openSection(page, name);
    await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveCount(0);
  }
  await openSection(page, 'Riders');
  await expect(page.getByText(/loaded rider accounts joined in the last 7 days/)).toBeVisible();
  await openSection(page, 'Audit log');
  await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveValue('30');
  await expect(page.getByText(/latest 200 returned actions/)).toBeVisible();
  await openSection(page, 'Staff');
  await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Staff sign-in period' })).toHaveValue('30');
  await openSection(page, 'Overview');
  await expect(page.locator('.operation-card').first()).toBeVisible();
  await expect(page.locator('.chart-card')).toHaveCount(0);
  await openSection(page, 'Insights');
  await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveValue('30');
  await expect(page.locator('.kpi').first().locator('.kpi-value')).toHaveText('310');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Reporting period' })).toHaveValue('30');
});


test('partners: an application is reviewed with notes, checklist and a final approval', async ({ page }) => {
  await signIn(page);
  const state = await mockModerationApi(page);
  await page.goto('/admin.html#overview');
  const work = page.getByRole('region', { name: 'Operations at a glance' });
  await expect(work.locator('.operation-card', { hasText: 'Partner applications' }).locator('.operation-value')).toHaveText('2');
  await work.getByRole('button', { name: 'Review applications' }).click();
  await expect(page).toHaveURL(/#partners$/);
  await expect(page.locator('#nav [aria-current="page"]')).toHaveText('Partners');
  const list = page.getByRole('list', { name: 'Partner applications' });
  await expect(list.locator('.case-item')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Type' }).selectOption('advertiser');
  await expect(list.locator('.case-item')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Type' }).selectOption('all');
  await list.getByRole('link', { name: 'Twisties Moto Gear' }).click();
  await expect(page).toHaveURL(/#partner\/55555555/);
  await expect(page.locator('.page-title')).toHaveText('Twisties Moto Gear');
  await expect(page.locator('#nav [aria-current="page"]')).toHaveText('Partners');
  // The website is a link that cannot reach back into the dashboard.
  await expect(page.getByRole('link', { name: 'https://twisties.example/' })).toHaveAttribute('rel', /noopener/);

  // A change without a note is refused in the page, before any request.
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Write a note' })).toBeVisible();
  expect(state.partnerCalls).toHaveLength(0);

  const note = page.getByRole('textbox', { name: 'Decision note' });
  await note.fill('Approving now');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Tick every checklist item' })).toBeVisible();

  await note.fill('Policies accepted by email');
  await page.getByRole('checkbox', { name: 'Agrees to the seller and advertising policies' }).check();
  await expect.poll(() => state.partnerCalls.at(-1)?.body).toEqual({ check: 'policies', done: true, note: 'Policies accepted by email', expectedVersion: 3 });
  // The page re-renders with the new version and an empty note.
  await expect(page.getByRole('textbox', { name: 'Decision note' })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Agrees to the seller and advertising policies' })).toBeChecked();
  await page.getByRole('textbox', { name: 'Decision note' }).fill('All checks passed');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => state.partners[0].status).toBe('approved');
  await expect(page.locator('.case-detail-meta')).toContainText('Approved');
  await expect(page.getByText('Approved. This decision is final.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
});

test('partners: the partnerships role sees applications but not riders or moderation', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page, { role: 'partnerships' });
  await page.goto('/admin.html#overview');
  await openMenuIfPhone(page);
  const nav = page.locator('#nav');
  await expect(nav.getByRole('button', { name: 'Partners' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Riders' })).toBeHidden();
  await expect(nav.getByRole('button', { name: 'Moderation' })).toBeHidden();
  await expect(nav.getByRole('button', { name: 'Case desk' })).toBeHidden();
  await page.goto('/admin.html#riders');
  await expect(page.locator('.page-title')).not.toHaveText('Riders');
});

test('partners: the public form sends a clean application and shows the reference', async ({ page }) => {
  const sent = [];
  await page.route(`${API}/partners/apply`, async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (body.description.length < 20) {
      return route.fulfill({ status: 400, headers, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_description' }) });
    }
    return route.fulfill({ status: 201, headers, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'RC-ABCDEF' }) });
  });
  await page.goto('/partners/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sell or advertise to riders');
  await page.getByRole('radio', { name: /Advertise/ }).check();
  await page.getByRole('textbox', { name: 'Business name' }).fill('Coastline Café');
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ava Stone');
  await page.getByRole('textbox', { name: 'Work email' }).fill('ava@example.com');
  await page.getByRole('textbox', { name: 'What you sell or promote' }).fill('Biker café');
  await page.getByRole('textbox', { name: 'About your business' }).fill('Too short');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('alert')).toContainText('Agree to the Terms');
  expect(sent).toHaveLength(0);
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 20 characters');
  await page.getByRole('textbox', { name: 'About your business' }).fill('Café on a popular coastal route that wants to reach weekend riders.');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('heading', { name: 'Application sent' })).toBeVisible();
  await expect(page.locator('#partnerReference')).toHaveText('RC-ABCDEF');
  expect(sent.at(-1)).toMatchObject({ kind: 'advertiser', businessName: 'Coastline Café', country: 'GB', acceptTerms: true, company: '' });
});

test('overview welcomes the staff member by name with their local time', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T09:15:00'));
  await signIn(page);
  await mockModerationApi(page);
  await page.goto('/admin.html#overview');
  const welcome = page.getByRole('region', { name: 'Welcome' });
  await expect(welcome).toContainText('Good morning, ');
  await expect(welcome.locator('time')).toHaveText(/09:15|9:15/);
  await expect(welcome).toContainText('Monday');
  // It sits above the work queue.
  const order = await page.evaluate(() => {
    const banner = document.querySelector('.welcome-banner');
    const work = document.querySelector('.operations-summary');
    return Boolean(banner.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

test('two-step sign-in: staff sign-in asks for the code after the password', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page, { mfa: true });
  await page.goto('/staff/');
  await page.getByRole('textbox', { name: 'Rider Comms username' }).fill('ali');
  await page.getByLabel('Password', { exact: true }).fill('right-password');
  await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
  const code = page.getByRole('textbox', { name: 'Authenticator or recovery code' });
  await expect(code).toBeVisible();
  await code.fill('000000');
  await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
  await expect(page.getByRole('alert')).toContainText('isn’t right');
  await code.fill('123456');
  await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
  await expect(page.locator('.page-title')).toHaveText('Overview');
});

test('two-step sign-in: the dashboard asks for a code when a session has not passed one', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page, { mfa: true });
  await page.goto('/admin.html#overview');
  const dialog = page.getByRole('dialog', { name: 'Two-step sign-in' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Authenticator or recovery code' }).fill('123456');
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('.page-title')).toHaveText('Overview');
  await expect(page.getByRole('dialog', { name: 'Two-step sign-in' })).toHaveCount(0);
});

test('two-step sign-in: staff set it up from Account security and see recovery codes once', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page);
  await page.goto('/admin.html#overview');
  await expect(page.locator('.page-title')).toHaveText('Overview');
  await openMenuIfPhone(page);
  await page.getByRole('button', { name: 'Account security' }).click();
  const dialog = page.getByRole('dialog', { name: 'Account security' });
  await dialog.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  await expect(dialog.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute('href', /^otpauth:\/\/totp\//);
  await expect(dialog.locator('.setup-key code')).toHaveText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  await dialog.getByRole('textbox', { name: 'Code from the app' }).fill('123456');
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(dialog.getByRole('list', { name: 'Recovery codes' }).locator('li')).toHaveCount(10);
});

test('email alerts: staff turn on their own morning summary and urgent-case emails', async ({ page }) => {
  await signIn(page);
  const state = await mockModerationApi(page);
  await page.goto('/admin.html#overview');
  await expect(page.locator('.page-title')).toHaveText('Overview');
  await openMenuIfPhone(page);
  await page.getByRole('button', { name: 'Account security' }).click();
  const alerts = page.getByRole('dialog', { name: 'Account security' }).getByRole('group', { name: 'Email alerts' });
  const digest = alerts.getByRole('checkbox', { name: /Morning summary/ });
  await expect(digest).toBeEnabled();
  await expect(digest).not.toBeChecked();
  await digest.check();
  await expect(alerts.getByRole('status')).toHaveText('Saved.');
  await alerts.getByRole('checkbox', { name: /Urgent cases/ }).check();
  await expect.poll(() => state.alertPrefs).toEqual({ dailyDigest: true, urgentAlerts: true });
});

test('the installed Staff app opens on Overview, and a reload keeps the current page', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page);
  // Launched from the Home Screen icon (iOS sets navigator.standalone).
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  // iOS keeps the address a Home Screen app was added from, such as #inbox.
  await page.goto('/staff/#inbox');
  await page.getByRole('textbox', { name: 'Rider Comms username' }).fill('ali');
  await page.getByLabel('Password', { exact: true }).fill('right-password');
  await page.getByRole('button', { name: 'Sign in to Operations Hub' }).click();
  await expect(page.locator('.page-title')).toHaveText('Overview');
  expect(new URL(page.url()).hash).not.toBe('#inbox');
  await page.evaluate(() => { location.hash = 'riders'; });
  await expect(page.locator('.page-title')).toHaveText('Riders');
  await page.reload();
  await expect(page.locator('.page-title')).toHaveText('Riders');
});

test('a Home Screen icon saved from the dashboard at #inbox opens on Overview', async ({ page }) => {
  await signIn(page);
  await mockModerationApi(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/admin.html#inbox');
  await expect(page.locator('.page-title')).toHaveText('Overview');
  await page.evaluate(() => { location.hash = 'riders'; });
  await expect(page.locator('.page-title')).toHaveText('Riders');
  await page.reload();
  await expect(page.locator('.page-title')).toHaveText('Riders');
});
