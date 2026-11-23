import { readJsonBody, sendJson } from '../serverHttp.ts';
import { refuseWithoutRecentReauth } from './context.ts';
import type { RouteContext } from './context.ts';
import {
  PartnerStore, PARTNER_CHECKS, PARTNER_KINDS, PARTNER_STATUSES, MAX_PARTNER_LIMIT, MAX_PARTNER_NOTE_LENGTH,
  isPartnerCheck, isPartnerKind, isPartnerStatus,
} from '../partnerStore.ts';
import { roleCan } from '../staffRoles.ts';
import type { StaffRole } from '../staffRoles.ts';
import type { PartnerStatus } from '../partnerStore.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const riderIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
export const partnerStore = new PartnerStore();

/** Staff review of seller and advertiser applications. Every request needs
 * `review_partners`; every change needs a recent password check, the
 * application's current version and a note. */
export async function handlePartnerRoutes(ctx: RouteContext, role: StaffRole): Promise<unknown> {
  const { req, res, url, s, actorId } = ctx;
  if (!roleCan(role, 'review_partners')) {
    return sendJson(res, 403, { error: 'permission_required', permission: 'review_partners' });
  }
  if (url.pathname === '/admin/partners/summary' && req.method === 'GET') {
    return sendJson(res, 200, await partnerStore.summary());
  }
  if (url.pathname === '/admin/partners' && req.method === 'GET') {
    const statusRaw = url.searchParams.get('status');
    const kindRaw = url.searchParams.get('kind');
    const status = statusRaw === null || statusRaw === 'all' ? undefined : statusRaw;
    const kind = kindRaw === null || kindRaw === 'all' ? undefined : kindRaw;
    if (status !== undefined && status !== 'open' && !isPartnerStatus(status)) {
      return sendJson(res, 400, { error: 'invalid_status', values: ['open', ...PARTNER_STATUSES] });
    }
    if (kind !== undefined && !isPartnerKind(kind)) return sendJson(res, 400, { error: 'invalid_kind', values: PARTNER_KINDS });
    const limit = Number(url.searchParams.get('limit') ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PARTNER_LIMIT) {
      return sendJson(res, 400, { error: 'invalid_limit', max: MAX_PARTNER_LIMIT });
    }
    return sendJson(res, 200, { items: await partnerStore.list({ status: status as PartnerStatus | 'open' | undefined, kind, limit }) });
  }
  if (s.length < 3 || s.length > 4 || typeof s[2] !== 'string' || !uuid.test(s[2])) {
    return sendJson(res, 404, { error: 'not_found' });
  }
  const id = s[2];
  if (req.method === 'GET' && s.length === 3) {
    const detail = await partnerStore.detail(id);
    return detail ? sendJson(res, 200, detail) : sendJson(res, 404, { error: 'not_found' });
  }
  const action = s[3];
  if (req.method !== 'POST' || s.length !== 4 || !['status', 'notes', 'checklist', 'assign'].includes(action!)) {
    return sendJson(res, 404, { error: 'not_found' });
  }
  if (await refuseWithoutRecentReauth(ctx)) return;
  const body = await readJsonBody(req);
  const expectedVersion = body.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return sendJson(res, 400, { error: 'expected_version_required' });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note || note.length > MAX_PARTNER_NOTE_LENGTH) return sendJson(res, 400, { error: 'note_required' });
  let changed;
  if (action === 'status') {
    if (!isPartnerStatus(body.status)) return sendJson(res, 400, { error: 'invalid_status', values: PARTNER_STATUSES });
    changed = await partnerStore.mutate({ id, actorId, actorRole: role, expectedVersion, action: 'status', note, status: body.status });
  } else if (action === 'checklist') {
    if (!isPartnerCheck(body.check) || typeof body.done !== 'boolean') {
      return sendJson(res, 400, { error: 'invalid_check', values: PARTNER_CHECKS });
    }
    changed = await partnerStore.mutate({ id, actorId, actorRole: role, expectedVersion, action: 'checklist', note, check: body.check, done: body.done });
  } else if (action === 'assign') {
    const candidate = body.assigneeId;
    if (candidate !== undefined && candidate !== null && (typeof candidate !== 'string' || !riderIdPattern.test(candidate))) {
      return sendJson(res, 400, { error: 'invalid_assignee' });
    }
    changed = await partnerStore.mutate({ id, actorId, actorRole: role, expectedVersion, action: 'assign', note,
      assigneeId: candidate === undefined ? undefined : (candidate as string | null) });
  } else {
    changed = await partnerStore.mutate({ id, actorId, actorRole: role, expectedVersion, action: 'note', note });
  }
  if (!changed.ok) {
    const code = changed.error;
    return sendJson(res, code === 'not_found' ? 404 : code === 'invalid_assignee' ? 400 : 409, { error: code });
  }
  return sendJson(res, 200, changed);
}
