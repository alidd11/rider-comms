import { MAX_MODERATION_NOTE_LENGTH, REPORT_RESOLUTIONS, REPORT_STATUSES } from '../moderationStore.ts';
import type { ReportResolution, ReportStatus } from '../moderationStore.ts';
import { readJsonBody, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED, ejectFromVoice, voiceMembershipsOf } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleModerationRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, authStore, moderationStore } = ctx;
  if (s[0] === 'moderation') {
    // Staff moderation queue. Admin status is re-read from Postgres on
    // every request (see ADMIN_RIDER_IDS / users.is_admin), never trusted
    // from the client.
    if (!(await authStore.isAdmin(actorId))) return sendJson(res, 403, { error: 'admin_required' });
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam === null ? undefined : Number(limitParam);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return sendJson(res, 400, { error: 'limit must be an integer from 1 to 200' });
    }
    if (req.method === 'GET' && url.pathname === '/moderation/reports') {
      const status = url.searchParams.get('status') ?? 'open';
      if (!REPORT_STATUSES.includes(status as ReportStatus)) return sendJson(res, 400, { error: 'invalid status filter' });
      return sendJson(res, 200, { reports: await moderationStore.listReports(status as ReportStatus, limit) });
    }
    if (req.method === 'GET' && url.pathname === '/moderation/actions') {
      const riderId = url.searchParams.get('riderId') ?? undefined;
      return sendJson(res, 200, { actions: await moderationStore.listActions(riderId, limit) });
    }
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (req.method === 'POST' && (!note || note.length > MAX_MODERATION_NOTE_LENGTH)) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    if (req.method === 'POST' && s[1] === 'reports' && s[2] && s[3] === 'resolve' && s.length === 4) {
      if (typeof body.resolution !== 'string' || !REPORT_RESOLUTIONS.includes(body.resolution as ReportResolution)) {
        return sendJson(res, 400, { error: 'resolution must be dismiss or suspend' });
      }
      const result = await moderationStore.resolveReport(decodeURIComponent(s[2]), actorId, body.resolution as ReportResolution, note);
      if (!result.ok) {
        return sendJson(res, result.error === 'not_found' ? 404 : result.error === 'already_resolved' ? 409 : 403, { error: result.error });
      }
      if (result.action.action === 'suspend') {
        const suspendedRiderId = result.action.targetRiderId;
        authStore.forgetRider(suspendedRiderId);
        // Sessions are already revoked, but an existing LiveKit connection
        // stays up until ejected: remove them from every ride they belong
        // to (not just the newest) and every Nearby pair room, now.
        await ejectFromVoice(ctx, suspendedRiderId, await voiceMembershipsOf(ctx, suspendedRiderId));
      }
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && s[1] === 'riders' && s[2] && s[3] === 'unsuspend' && s.length === 4) {
      const result = await moderationStore.unsuspend(decodeURIComponent(s[2]), actorId, note);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && s[1] === 'riders' && s[2] && s[3] === 'verify-email' && s.length === 4) {
      const result = await moderationStore.verifyEmail(decodeURIComponent(s[2]), actorId, note);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { error: 'not_found' });
  }
  return NOT_HANDLED;
}
