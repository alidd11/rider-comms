import { exportRiderData } from '../accountExport.ts';
import { MAX_RIDER_SEARCH_RESULTS } from '../adminStatsStore.ts';
import { getPool } from '../db.ts';
import { emailDeliveryStatus } from '../email.ts';
import { MAX_MODERATION_NOTE_LENGTH } from '../moderationStore.ts';
import { readJsonBody, sendJson } from '../serverHttp.ts';
import { GRANTABLE_STAFF_ROLES, isGrantableStaffRole, permissionsFor, roleCan } from '../staffRoles.ts';
import type { StaffPermission } from '../staffRoles.ts';
import { NOT_HANDLED, refuseWithoutRecentReauth } from './context.ts';
import type { RouteContext } from './context.ts';

/** Staff dashboard. The caller's role is re-read from Postgres on every request. */
export async function handleAdminRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, authStore, adminStatsStore, moderationStore, profileStore } = ctx;
  if (s[0] !== 'admin') return NOT_HANDLED;
  const role = await authStore.staffRole(actorId);
  if (!role) return sendJson(res, 403, { error: 'admin_required' });
  const lacks = (permission: StaffPermission) => !roleCan(role, permission);
  const refuse = (permission: StaffPermission) => sendJson(res, 403, { error: 'permission_required', permission });

  if (req.method === 'GET' && url.pathname === '/admin/me') {
    return sendJson(res, 200, { riderId: actorId, role, permissions: permissionsFor(role) });
  }
  if (req.method === 'GET' && url.pathname === '/admin/overview') {
    if (lacks('view_overview')) return refuse('view_overview');
    return sendJson(res, 200, await adminStatsStore.overview());
  }
  // What the running backend is set up to do, for the dashboard's System page.
  if (req.method === 'GET' && url.pathname === '/admin/system') {
    if (lacks('view_system')) return refuse('view_system');
    return sendJson(res, 200, {
      socialMediaStorage: ctx.socialMedia !== null,
      socialPosting: ctx.socialPostingEnabled,
      email: emailDeliveryStatus(),
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
    return sendJson(res, 200, { riders: await adminStatsStore.searchRiders(query, limit) });
  }

  // Sign-ins, failed passwords, resets and revoked devices; staff only, or one rider.
  if (req.method === 'GET' && url.pathname === '/admin/security-events') {
    if (lacks('manage_staff')) return refuse('manage_staff');
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 200' });
    const riderId = url.searchParams.get('riderId')?.trim() || undefined;
    return sendJson(res, 200, { events: await authStore.listSecurityEvents({ riderId, staffOnly: url.searchParams.get('staff') === '1', limit }) });
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
    if (req.method === 'GET' && s.length === 2) return sendJson(res, 200, { staff: await moderationStore.listStaff() });
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
    if (s.length === 4 && s[3] === 'remove') {
      const result = await moderationStore.removeStaffRole(decodeURIComponent(s[2]!), actorId, note);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
      return sendJson(res, 200, result);
    }
  }
  return sendJson(res, 404, { error: 'not_found' });
}
