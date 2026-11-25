import { providerHealthSnapshot } from '../providerHealth.ts';
import { buildActionInbox, INBOX_FILTERS, INBOX_SAMPLE_SIZE, MAX_INBOX_PAGE_SIZE } from '../actionInbox.ts';
import type { InboxFilter } from '../actionInbox.ts';
import { exportRiderData } from '../accountExport.ts';
import { MAX_RIDER_OFFSET, MAX_RIDER_SEARCH_RESULTS, RIDER_FILTERS } from '../adminStatsStore.ts';
import type { RiderFilter } from '../adminStatsStore.ts';
import { getPool } from '../db.ts';
import { emailDeliveryStatus } from '../email.ts';
import { MAX_MODERATION_NOTE_LENGTH } from '../moderationStore.ts';
import { bearerToken, consumeRateLimit, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import { GRANTABLE_STAFF_ROLES, isGrantableStaffRole, permissionsFor, roleCan } from '../staffRoles.ts';
import type { StaffPermission } from '../staffRoles.ts';
import { NOT_HANDLED, refuseWithoutRecentReauth, refuseWithoutStaffCode } from './context.ts';
import { staffMfa } from '../staffMfa.ts';
import { getStaffAlertPrefs, setStaffAlertPrefs } from '../staffAlerts.ts';
import { BROADCAST_COOLDOWN_MS, broadcastStore, parseBroadcast } from '../staffBroadcasts.ts';
import { CONTENT_KINDS, staffContentStore } from '../staffContentStore.ts';
import { appSwitches, isAppSwitch } from '../appSwitches.ts';
import { announcementStore, parseAnnouncement } from '../announcements.ts';
import type { ContentKind } from '../staffContentStore.ts';
import { handleCompanyCaseRoutes } from './adminCases.ts';
import { handlePartnerRoutes } from './adminPartners.ts';
import { parseOperationsWindow, socialSafetyActivityReport } from '../operationsReports.ts';
import type { RouteContext } from './context.ts';

/** Staff dashboard. The caller's role is re-read from Postgres on every request. */
export async function handleAdminRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, authStore, adminStatsStore, moderationStore, profileStore } = ctx;
  if (s[0] !== 'admin') return NOT_HANDLED;
  const role = await authStore.staffRole(actorId);
  if (!role) return sendJson(res, 403, { error: 'admin_required' });
  const lacks = (permission: StaffPermission) => !roleCan(role, permission);
  const refuse = (permission: StaffPermission) => sendJson(res, 403, { error: 'permission_required', permission });

  // Two-step sign-in: setting it up and passing a code are the only staff
  // requests a session that still needs a code may make.
  if (s[1] === 'mfa') {
    const token = bearerToken(req);
    if (req.method === 'GET' && s.length === 2) return sendJson(res, 200, await staffMfa.status(actorId));
    if (req.method !== 'POST' || s.length !== 3) return sendJson(res, 404, { error: 'not_found' });
    if (!(await consumeRateLimit(res, ctx.rateLimitStore, rateLimitSubject('rider', actorId), 'auth'))) return;
    const body = await readJsonBody(req);
    if (s[2] === 'verify') {
      // Code guesses share the per-account sign-in limit (10 per 15 minutes).
      if (!(await consumeRateLimit(res, ctx.rateLimitStore, rateLimitSubject('account', 'mfa:' + actorId), 'auth_account'))) return;
      if (!(await staffMfa.verify(actorId, body.code))) return sendJson(res, 401, { error: 'invalid_code' });
      await staffMfa.markSessionVerified(token);
      return sendJson(res, 200, { verified: true });
    }
    if (s[2] === 'setup') {
      if (await refuseWithoutRecentReauth(ctx)) return;
      const result = await staffMfa.beginSetup(actorId, actorId);
      return 'error' in result ? sendJson(res, 409, result) : sendJson(res, 200, result);
    }
    if (s[2] === 'confirm') {
      if (await refuseWithoutRecentReauth(ctx)) return;
      const result = await staffMfa.confirmSetup(actorId, token, typeof body.code === 'string' ? body.code.trim() : '');
      if ('error' in result) return sendJson(res, result.error === 'invalid_code' ? 401 : 409, result);
      return sendJson(res, 200, result);
    }
    if (s[2] === 'disable') {
      if (await refuseWithoutRecentReauth(ctx)) return;
      if (!(await staffMfa.verify(actorId, body.code))) return sendJson(res, 401, { error: 'invalid_code' });
      await staffMfa.disable(actorId);
      return sendJson(res, 200, { enabled: false });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }
  if (await refuseWithoutStaffCode(ctx)) return;

  if (s[1] === 'cases') return handleCompanyCaseRoutes(ctx, role);
  if (s[1] === 'partners') return handlePartnerRoutes(ctx, role);

  if (req.method === 'GET' && url.pathname === '/admin/me') {
    return sendJson(res, 200, { riderId: actorId, role, permissions: permissionsFor(role) });
  }
  // Map content riders post for everyone (hazards, scenic routes). Moderators
  // can list it and remove an item with a note, recorded in the audit log.
  if (s[1] === 'content') {
    if (lacks('moderate')) return refuse('moderate');
    if (req.method === 'GET' && s.length === 2) {
      const kind = url.searchParams.get('kind') ?? 'hazards';
      if (!(CONTENT_KINDS as readonly string[]).includes(kind)) return sendJson(res, 400, { error: 'invalid_kind', values: CONTENT_KINDS });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > MAX_RIDER_OFFSET) return sendJson(res, 400, { error: 'invalid_offset' });
      const page = kind === 'hazards'
        ? await staffContentStore.hazards({ includeExpired: url.searchParams.get('include') === 'expired', offset })
        : await staffContentStore.routes({ q: (url.searchParams.get('q') ?? '').slice(0, 100), offset });
      return sendJson(res, 200, page);
    }
    if (req.method === 'POST' && s.length === 5 && s[4] === 'remove' && (CONTENT_KINDS as readonly string[]).includes(s[2] ?? '')) {
      const body = await readJsonBody(req);
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note || note.length > MAX_MODERATION_NOTE_LENGTH) {
        return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
      }
      if (await refuseWithoutRecentReauth(ctx)) return;
      const result = await staffContentStore.remove(s[2] as ContentKind, decodeURIComponent(s[3]!), actorId, note);
      return result.ok ? sendJson(res, 200, result) : sendJson(res, 404, { error: result.error });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  // Switches that pause sign-ups, Social posting or Nearby Voice for every
  // rider (admins only). A change needs a note and a recent password check.
  if (s[1] === 'switches') {
    if (lacks('manage_switches')) return refuse('manage_switches');
    if (req.method === 'GET' && s.length === 2) return sendJson(res, 200, { switches: await appSwitches.list() });
    if (req.method !== 'POST' || s.length !== 3) return sendJson(res, s.length === 2 ? 405 : 404, { error: s.length === 2 ? 'method_not_allowed' : 'not_found' });
    if (!isAppSwitch(s[2])) return sendJson(res, 404, { error: 'not_found' });
    const body = await readJsonBody(req);
    if (typeof body.on !== 'boolean') return sendJson(res, 400, { error: 'on must be true or false' });
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note || note.length > MAX_MODERATION_NOTE_LENGTH) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    if (await refuseWithoutRecentReauth(ctx)) return;
    return sendJson(res, 200, { switch: await appSwitches.set(s[2], body.on, actorId, note) });
  }

  // In-app announcements riders see on the map (admins only). Publishing or
  // ending one needs a note and a recent password check.
  if (s[1] === 'announcements') {
    if (lacks('send_notifications')) return refuse('send_notifications');
    if (req.method === 'GET' && s.length === 2) return sendJson(res, 200, { items: await announcementStore.list() });
    const ending = s.length === 4 && s[3] === 'end';
    if (req.method !== 'POST' || !(s.length === 2 || ending)) {
      return sendJson(res, s.length === 2 ? 405 : 404, { error: s.length === 2 ? 'method_not_allowed' : 'not_found' });
    }
    const body = await readJsonBody(req);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note || note.length > MAX_MODERATION_NOTE_LENGTH) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    if (ending) {
      if (await refuseWithoutRecentReauth(ctx)) return;
      const ended = await announcementStore.end(decodeURIComponent(s[2]!), actorId, note);
      return ended ? sendJson(res, 200, { announcement: ended }) : sendJson(res, 404, { error: 'not_found' });
    }
    const input = parseAnnouncement(body);
    if ('error' in input) return sendJson(res, 400, input);
    if (await refuseWithoutRecentReauth(ctx)) return;
    return sendJson(res, 201, { announcement: await announcementStore.publish(input, actorId, note) });
  }

  // Push notifications to riders (admins only). A test goes to the sender's
  // own devices; a send to everyone needs a note, a recent password check and
  // waits out a cooldown, and is recorded in the audit log.
  if (s[1] === 'broadcasts' && s.length === 2) {
    if (lacks('send_notifications')) return refuse('send_notifications');
    if (req.method === 'GET') {
      const [audience, items] = await Promise.all([broadcastStore.audience(), broadcastStore.list()]);
      return sendJson(res, 200, { audience, items, cooldownMs: BROADCAST_COOLDOWN_MS });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
    const body = await readJsonBody(req);
    const input = parseBroadcast(body);
    if ('error' in input) return sendJson(res, 400, input);
    const test = body.test === true;
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!test && (!note || note.length > MAX_MODERATION_NOTE_LENGTH)) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    if (!test && (await refuseWithoutRecentReauth(ctx))) return;
    if (!test) {
      const last = await broadcastStore.lastFullSendAt();
      if (last !== null && Date.now() - last < BROADCAST_COOLDOWN_MS) {
        return sendJson(res, 429, { error: 'broadcast_cooldown', retryAfterMs: BROADCAST_COOLDOWN_MS - (Date.now() - last) });
      }
    }
    const broadcaster = ctx.pushNotifier.broadcast;
    if (!broadcaster) return sendJson(res, 503, { error: 'push_unavailable' });
    const record = await broadcastStore.start(input, actorId, test ? 'Test send' : note, test);
    if (!test) await moderationStore.recordPushBroadcast(actorId, note);
    // Sending can take a while for many devices; the page polls the list.
    void broadcaster.call(ctx.pushNotifier, { ...input, tag: 'broadcast:' + record.id }, test ? actorId : undefined)
      .then((result) => broadcastStore.finish(record.id, result), () => broadcastStore.finish(record.id, null));
    return sendJson(res, 202, { broadcast: record });
  }

  // Each staff member's own email alert choices; no other staff member can change them.
  if (url.pathname === '/admin/alerts') {
    if (req.method === 'GET') return sendJson(res, 200, await getStaffAlertPrefs(actorId));
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
    const body = await readJsonBody(req);
    if (typeof body.dailyDigest !== 'boolean' || typeof body.urgentAlerts !== 'boolean') {
      return sendJson(res, 400, { error: 'dailyDigest and urgentAlerts must be true or false' });
    }
    return sendJson(res, 200, await setStaffAlertPrefs(actorId, { dailyDigest: body.dailyDigest, urgentAlerts: body.urgentAlerts }));
  }
  if (req.method === 'GET' && url.pathname === '/admin/overview') {
    if (lacks('view_overview')) return refuse('view_overview');
    return sendJson(res, 200, await adminStatsStore.overview());
  }
  // Phase 2: one view of real work waiting for a moderator. Source workflows
  // retain their own claim, reauthentication and audit rules.
  if (req.method === 'GET' && url.pathname === '/admin/action-inbox') {
    if (lacks('moderate')) return refuse('moderate');
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 25 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INBOX_PAGE_SIZE) {
      return sendJson(res, 400, { error: `limit must be an integer from 1 to ${MAX_INBOX_PAGE_SIZE}` });
    }
    const filter = url.searchParams.get('type') ?? 'all';
    if (!(INBOX_FILTERS as readonly string[]).includes(filter)) {
      return sendJson(res, 400, { error: 'type must be all, rider_report or social_post' });
    }
    const type = filter as InboxFilter;
    const [reports, socialPosts] = await Promise.all([
      type === 'social_post' ? Promise.resolve([]) : moderationStore.listReports('open', INBOX_SAMPLE_SIZE, { excludeHiddenSocial: true }),
      type === 'rider_report' ? Promise.resolve([]) : ctx.socialPostStore.listHidden(INBOX_SAMPLE_SIZE),
    ]);
    return sendJson(res, 200, buildActionInbox(reports, socialPosts, {
      limit, filter: type, sampleLimit: INBOX_SAMPLE_SIZE,
    }));
  }
  // Complete retained-database aggregate of Rider Social posts/reports,
  // only to staff permitted to moderate. No rider identifiers are returned.
  if (req.method === 'GET' && url.pathname === '/admin/social/activity') {
    if (lacks('moderate')) return refuse('moderate');
    const days = parseOperationsWindow(url.searchParams.get('days'));
    if (days === null) return sendJson(res, 400, { error: 'invalid_report_window', values: [7, 30] });
    return sendJson(res, 200, await socialSafetyActivityReport(days));
  }

  // What the running backend is set up to do, for the dashboard's System page.
  if (req.method === 'GET' && url.pathname === '/admin/system') {
    if (lacks('view_system')) return refuse('view_system');
    return sendJson(res, 200, {
      socialMediaStorage: ctx.socialMedia !== null,
      socialMediaScanning: Boolean(ctx.socialMedia?.scan),
      socialPosting: ctx.socialPostingEnabled && await appSwitches.isOn('social_posting'),
      email: emailDeliveryStatus(),
      ...providerHealthSnapshot(),
    });
  }
  // Request rates, errors and response times on the replica that answers.
  if (req.method === 'GET' && url.pathname === '/admin/metrics') {
    if (lacks('view_system')) return refuse('view_system');
    return sendJson(res, 200, ctx.requestMetrics.snapshot(process.env.DATABASE_URL ? getPool() : null));
  }
  if (req.method === 'GET' && url.pathname === '/admin/riders') {
    if (lacks('view_riders')) return refuse('view_riders');
    const query = url.searchParams.get('q') ?? '';
    if (query.length > 100) return sendJson(res, 400, { error: 'q must be at most 100 characters' });
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam === null ? 20 : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RIDER_SEARCH_RESULTS) {
      return sendJson(res, 400, { error: `limit must be an integer from 1 to ${MAX_RIDER_SEARCH_RESULTS}` });
    }
    const filter = url.searchParams.get('filter') ?? 'all';
    if (!(RIDER_FILTERS as readonly string[]).includes(filter)) return sendJson(res, 400, { error: 'invalid_filter', values: RIDER_FILTERS });
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_RIDER_OFFSET) {
      return sendJson(res, 400, { error: `offset must be an integer from 0 to ${MAX_RIDER_OFFSET}` });
    }
    const riders = await adminStatsStore.searchRiders(query, limit, { filter: filter as RiderFilter, offset });
    return sendJson(res, 200, { riders, nextOffset: riders.length === limit ? offset + limit : null });
  }

  // Sign-ins, failed passwords, resets and revoked devices; staff only, or one rider.
  if (req.method === 'GET' && url.pathname === '/admin/security-events') {
    if (lacks('manage_staff')) return refuse('manage_staff');
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 200' });
    const riderId = url.searchParams.get('riderId')?.trim() || undefined;
    return sendJson(res, 200, { events: await authStore.listSecurityEvents({ riderId, staffOnly: url.searchParams.get('staff') === '1', limit }) });
  }
  // One rider, everything staff may see about them: what each role sees
  // depends on its permissions (reports for moderators, devices and sign-ins
  // for account help, notes for those who can read the audit log).
  if (req.method === 'GET' && s[1] === 'riders' && s[2] && s.length === 3) {
    if (lacks('view_riders')) return refuse('view_riders');
    const riderId = decodeURIComponent(s[2]);
    const rider = await adminStatsStore.riderSummary(riderId);
    if (!rider) return sendJson(res, 404, { error: 'not_found' });
    const [reports, actions, devices, securityEvents] = await Promise.all([
      roleCan(role, 'moderate') ? moderationStore.reportsForRider(riderId) : null,
      roleCan(role, 'view_audit') ? moderationStore.listActions(riderId, 50) : null,
      roleCan(role, 'account_help') ? authStore.listSessions(riderId, '') : null,
      roleCan(role, 'account_help') ? authStore.listSecurityEvents({ riderId, limit: 50 }) : null,
    ]);
    return sendJson(res, 200, {
      rider,
      reportsAgainst: reports?.against ?? null,
      reportsFiled: reports?.filed ?? null,
      actions,
      devices: devices?.map(({ current: _current, ...device }) => device) ?? null,
      securityEvents,
    });
  }
  // A data access request answered by staff: needs a reason and is recorded.
  if (req.method === 'POST' && s[1] === 'riders' && s[2] && s[3] === 'export' && s.length === 4) {
    if (lacks('manage_staff')) return refuse('manage_staff');
    if (await refuseWithoutRecentReauth(ctx)) return;
    const body = await readJsonBody(req);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note || note.length > MAX_MODERATION_NOTE_LENGTH) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    const riderId = decodeURIComponent(s[2]);
    const data = await exportRiderData(riderId);
    if (!data) return sendJson(res, 404, { error: 'not_found' });
    await moderationStore.recordDataExport(riderId, actorId, note);
    return sendJson(res, 200, data);
  }
  if (s[1] === 'staff') {
    if (lacks('manage_staff')) return refuse('manage_staff');
    if (req.method === 'GET' && s.length === 2) {
      const staff = await moderationStore.listStaff();
      const enrolled = await staffMfa.enabledFor(staff.map((member) => member.riderId));
      return sendJson(res, 200, { staff: staff.map((member) => ({ ...member, twoStep: enrolled.has(member.riderId) })) });
    }
    if (req.method !== 'POST') return sendJson(res, 404, { error: 'not_found' });
    if (await refuseWithoutRecentReauth(ctx)) return;
    const body = await readJsonBody(req);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note || note.length > MAX_MODERATION_NOTE_LENGTH) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    if (s.length === 2) {
      if (!isGrantableStaffRole(body.role)) return sendJson(res, 400, { error: `role must be one of ${GRANTABLE_STAFF_ROLES.join(', ')}` });
      const rider = typeof body.rider === 'string' ? body.rider.trim() : '';
      if (!rider || rider.length > 100) return sendJson(res, 400, { error: 'rider must be a rider ID or handle' });
      const riderId = rider.startsWith('rider_') ? rider : await profileStore.findRiderIdByHandle(`@${rider.replace(/^@/, '')}`) ?? rider;
      if (riderId === actorId) return sendJson(res, 409, { error: 'is_admin' });
      const result = await moderationStore.setStaffRole(riderId, body.role, actorId, note);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
      return sendJson(res, 200, result);
    }
    // An admin can switch off a colleague's two-step sign-in (lost phone and
    // recovery codes). The colleague then signs in with a password and can
    // set it up again. Recorded in the audit log with the reason.
    if (s.length === 4 && s[3] === 'mfa-reset') {
      const riderId = decodeURIComponent(s[2]!);
      if (riderId === actorId) return sendJson(res, 409, { error: 'use_own_settings' });
      if (!(await staffMfa.disable(riderId, 'mfa_reset'))) return sendJson(res, 404, { error: 'not_enrolled' });
      const action = await moderationStore.recordStaffMfaReset(riderId, actorId, note);
      return sendJson(res, 200, { ok: true, action });
    }
    if (s.length === 4 && s[3] === 'remove') {
      const result = await moderationStore.removeStaffRole(decodeURIComponent(s[2]!), actorId, note);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
      return sendJson(res, 200, result);
    }
  }
  return sendJson(res, 404, { error: 'not_found' });
}
