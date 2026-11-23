import { emailDeliveryStatus } from '../email.ts';
import { MAX_MODERATION_NOTE_LENGTH, MAX_SUSPENSION_DAYS, REPORT_RESOLUTIONS, REPORT_STATUSES } from '../moderationStore.ts';
import type { ReportResolution, ReportStatus } from '../moderationStore.ts';
import { readJsonBody, sendJson } from '../serverHttp.ts';
import { roleCan } from '../staffRoles.ts';
import { NOT_HANDLED, ejectFromVoice, refuseWithoutRecentReauth, refuseWithoutStaffCode, voiceMembershipsOf } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleModerationRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, authStore, moderationStore } = ctx;
  if (s[0] === 'moderation') {
    // Staff moderation queue. The caller's role is re-read from Postgres on
    // every request (users.is_admin and staff_roles), never trusted from the
    // client; each action checks the permission it needs (staffRoles.ts).
    const role = await authStore.staffRole(actorId);
    if (!role) return sendJson(res, 403, { error: 'admin_required' });
    const permission = req.method === 'GET' && url.pathname === '/moderation/actions' ? 'view_audit'
      : req.method === 'POST' && s[1] === 'riders' && s[3] === 'verify-email' ? 'verify_email'
      : req.method === 'POST' && s[1] === 'riders' && (s[3] === 'sign-out' || s[3] === 'password-reset') ? 'account_help'
      : 'moderate';
    if (!roleCan(role, permission)) return sendJson(res, 403, { error: 'permission_required', permission });
    if (await refuseWithoutStaffCode(ctx)) return;
    // Claiming a report changes nothing about a rider, so it skips the password re-check.
    const isClaim = s[1] === 'reports' && s[3] === 'claim';
    if (req.method === 'POST' && !isClaim && (await refuseWithoutRecentReauth(ctx))) return;
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
    if (req.method === 'GET' && s[1] === 'reports' && s.length === 3 && s[2]) {
      const report = await moderationStore.reportById(decodeURIComponent(s[2]));
      return report ? sendJson(res, 200, { report }) : sendJson(res, 404, { error: 'not_found' });
    }
    if (req.method === 'GET' && s[1] === 'reports' && s.length === 4 && s[3] === 'assignment-history' && s[2]) {
      const events = await moderationStore.assignmentHistory(decodeURIComponent(s[2]), limit ?? 50);
      return events === null ? sendJson(res, 404, { error: 'not_found' }) : sendJson(res, 200, { events });
    }
    if (req.method === 'GET' && url.pathname === '/moderation/actions') {
      const riderId = url.searchParams.get('riderId') ?? undefined;
      return sendJson(res, 200, { actions: await moderationStore.listActions(riderId, limit) });
    }
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    if (req.method === 'POST' && isClaim && s[2] && s.length === 4) {
      const result = await moderationStore.claimReport(decodeURIComponent(s[2]), actorId, body.release === true);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error, ...(result.claimedBy ? { claimedBy: result.claimedBy } : {}) });
      return sendJson(res, 200, result);
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (req.method === 'POST' && (!note || note.length > MAX_MODERATION_NOTE_LENGTH)) {
      return sendJson(res, 400, { error: `a note of 1-${MAX_MODERATION_NOTE_LENGTH} characters is required` });
    }
    if (req.method === 'POST' && s[1] === 'reports' && s[2] && s[3] === 'assign' && s.length === 4) {
      // Omitted target means assign to self; explicit null means release.
      const requested = Object.hasOwn(body, 'assigneeId') ? body.assigneeId : actorId;
      if (requested !== null && (typeof requested !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(requested))) {
        return sendJson(res, 400, { error: 'invalid_assignee' });
      }
      const result = await moderationStore.assignReport(
        decodeURIComponent(s[2]), actorId, requested as string | null, note, roleCan(role, 'manage_staff'),
      );
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 :
        result.error === 'invalid_assignee' || result.error === 'permission_required' ? 403 : 409, { error: result.error });
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && s[1] === 'reports' && s[2] && s[3] === 'resolve' && s.length === 4) {
      if (typeof body.resolution !== 'string' || !REPORT_RESOLUTIONS.includes(body.resolution as ReportResolution)) {
        return sendJson(res, 400, { error: 'resolution must be dismiss or suspend' });
      }
      const until = suspensionEnd(body.days);
      if (until === undefined) return sendJson(res, 400, { error: `days must be a whole number from 1 to ${MAX_SUSPENSION_DAYS}, or left out for no end` });
      const result = await moderationStore.resolveReport(decodeURIComponent(s[2]), actorId, body.resolution as ReportResolution, note, Date.now(), until);
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
    if (req.method === 'POST' && s[1] === 'riders' && s[2] && s[3] === 'suspend' && s.length === 4) {
      const until = suspensionEnd(body.days);
      if (until === undefined) return sendJson(res, 400, { error: `days must be a whole number from 1 to ${MAX_SUSPENSION_DAYS}, or left out for no end` });
      const riderId = decodeURIComponent(s[2]);
      const result = await moderationStore.suspendRider(riderId, actorId, note, until);
      if (!result.ok) return sendJson(res, result.error === 'not_found' ? 404 : result.error === 'already_suspended' ? 409 : 403, { error: result.error });
      authStore.forgetRider(riderId);
      await ejectFromVoice(ctx, riderId, await voiceMembershipsOf(ctx, riderId));
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && s[1] === 'riders' && s[2] && s[3] === 'sign-out' && s.length === 4) {
      const riderId = decodeURIComponent(s[2]);
      const result = await moderationStore.signOutEverywhere(riderId, actorId, note);
      if (!result.ok) return sendJson(res, 404, { error: result.error });
      authStore.forgetRider(riderId);
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && s[1] === 'riders' && s[2] && s[3] === 'password-reset' && s.length === 4) {
      const riderId = decodeURIComponent(s[2]);
      if (!(await authStore.sendPasswordResetFor(riderId))) return sendJson(res, 404, { error: 'not_found' });
      const action = await moderationStore.recordPasswordResetSent(riderId, actorId, note);
      return sendJson(res, 200, { ok: true, action, emailDelivery: emailDeliveryStatus() });
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

/** When a suspension of `days` ends: null for no end, undefined when invalid. */
export function suspensionEnd(days: unknown, now = Date.now()): number | null | undefined {
  if (days === undefined || days === null) return null;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_SUSPENSION_DAYS) return undefined;
  return now + days * 24 * 60 * 60 * 1000;
}
