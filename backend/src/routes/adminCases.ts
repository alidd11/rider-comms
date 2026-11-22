import { readJsonBody, sendJson } from '../serverHttp.ts';
import { refuseWithoutRecentReauth } from './context.ts';
import type { RouteContext } from './context.ts';
import { CompanyCaseStore, CASE_KINDS, CASE_STATUSES, CASE_PRIORITIES,
  MAX_CASE_LIMIT, MAX_CASE_BODY_LENGTH, MAX_CASE_TITLE_LENGTH,
  canAccessCaseKind, caseKindsForRole, isCaseKind, isCasePriority, isCaseStatus, parseCaseCursor,
} from '../companyCaseStore.ts';
import type { StaffRole, StaffPermission } from '../staffRoles.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const subjectPattern = /^rider_[A-Za-z0-9_-]{1,80}$/;
const store = new CompanyCaseStore();
const validNote = (v: unknown) => typeof v === 'string' && v.trim().length >= 1 &&
  v.trim().length <= MAX_CASE_BODY_LENGTH;

/** Type-scoped access is checked on every request, including exact item
 * lookup and every mutation. Internal cases never message riders. */
export async function handleCompanyCaseRoutes(ctx: RouteContext, role: StaffRole): Promise<unknown> {
  const { req, res, url, s, actorId } = ctx;
  const lacks = (permission: StaffPermission) => sendJson(res, 403, { error: 'permission_required', permission });
  if (!caseKindsForRole(role).length) return lacks('view_cases');

  if (url.pathname === '/admin/cases' && req.method === 'GET') {
    const kindRaw = url.searchParams.get('kind');
    const kind = kindRaw === null || kindRaw === 'all' ? undefined : kindRaw;
    const statusRaw = url.searchParams.get('status');
    const status = statusRaw === null || statusRaw === 'all' ? undefined : statusRaw;
    if (kind !== undefined && !isCaseKind(kind)) {
      return sendJson(res, 400, { error: 'invalid_case_kind', values: CASE_KINDS });
    }
    if (kind !== undefined && !canAccessCaseKind(role, kind)) return lacks('view_cases');
    if (status !== undefined && !isCaseStatus(status)) {
      return sendJson(res, 400, { error: 'invalid_case_status', values: CASE_STATUSES });
    }
    const limit = Number(url.searchParams.get('limit') ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CASE_LIMIT) {
      return sendJson(res, 400, { error: 'invalid_limit', max: MAX_CASE_LIMIT });
    }
    const before = parseCaseCursor(url.searchParams.get('before'));
    if (before === undefined) return sendJson(res, 400, { error: 'invalid_cursor' });
    return sendJson(res, 200, await store.list(caseKindsForRole(role), {
      kind, status, limit, before,
    }));
  }
  if (url.pathname === '/admin/cases' && req.method === 'POST') {
    if (await refuseWithoutRecentReauth(ctx)) return;
    const body = await readJsonBody(req);
    if (!isCaseKind(body.kind)) return sendJson(res, 400, { error: 'invalid_case_kind' });
    if (!canAccessCaseKind(role, body.kind)) return lacks('view_cases');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (title.length < 3 || title.length > MAX_CASE_TITLE_LENGTH ||
      description.length > MAX_CASE_BODY_LENGTH) {
      return sendJson(res, 400, { error: 'invalid_case_content' });
    }
    const priority = body.priority === undefined ? 'normal' : body.priority;
    if (!isCasePriority(priority)) return sendJson(res, 400, {
      error: 'invalid_case_priority', values: CASE_PRIORITIES,
    });
    const subjectRiderId = body.subjectRiderId === null || body.subjectRiderId === undefined ? null : body.subjectRiderId;
    if (subjectRiderId !== null && (typeof subjectRiderId !== 'string' || !subjectPattern.test(subjectRiderId))) {
      return sendJson(res, 400, { error: 'invalid_subject_rider' });
    }
    const item = await store.create({ kind: body.kind, title, description,
      priority, subjectRiderId, actorId });
    if (!item) return sendJson(res, 404, { error: 'subject_not_found' });
    return sendJson(res, 201, { item });
  }

  if (s.length < 3 || s.length > 4 || typeof s[2] !== 'string' || !uuid.test(s[2])) {
    return sendJson(res, 404, { error: 'not_found' });
  }
  const id = s[2];
  if (req.method === 'GET' && s.length === 3) {
    const detail = await store.detail(id);
    if (!detail || !canAccessCaseKind(role, detail.item.kind)) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, detail);
  }
  if (req.method !== 'POST' || s.length !== 4 ||
    !['notes', 'status', 'priority', 'assign'].includes(s[3]!)) {
    return sendJson(res, 404, { error: 'not_found' });
  }
  if (await refuseWithoutRecentReauth(ctx)) return;
  const body = await readJsonBody(req);
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return sendJson(res, 400, { error: 'expected_version_required' });
  }
  if (!validNote(body.note)) return sendJson(res, 400, { error: 'note_required' });
  const action = s[3] === 'notes' ? 'note' : s[3] === 'assign' ? 'assign' : s[3]!;
  let value: string | null | undefined;
  if (action === 'status') {
    if (!isCaseStatus(body.status)) return sendJson(res, 400, { error: 'invalid_case_status' });
    value = body.status;
  } else if (action === 'priority') {
    if (!isCasePriority(body.priority)) return sendJson(res, 400, { error: 'invalid_case_priority' });
    value = body.priority;
  } else if (action === 'assign') {
    value = body.assigneeId === undefined ? actorId : body.assigneeId;
    if (value !== null && (typeof value !== 'string' || !subjectPattern.test(value))) {
      return sendJson(res, 400, { error: 'invalid_assignee' });
    }
  }
  const changed = await store.mutate({
    id, actorId, actorRole: role, expectedVersion,
    action: action as 'note' | 'status' | 'priority' | 'assign',
    note: (body.note as string).trim(), value,
  });
  if (!changed.ok) {
    const code = changed.error;
    const httpStatus = code === 'not_found' ? 404 : code === 'invalid_assignee' ? 400 : 409;
    return sendJson(res, httpStatus, { error: code });
  }
  return sendJson(res, 200, changed);
}
