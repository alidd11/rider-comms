import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, withTransaction } from './db.ts';
import { roleCan } from './staffRoles.ts';
import type { StaffRole } from './staffRoles.ts';

/** Manually created internal work items. No customer messages, finance
 * accounting, legal deadline calculations or automatic rider contact. */
export const CASE_KINDS = ['support', 'appeal', 'privacy', 'incident'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
export const CASE_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export const MAX_CASE_LIMIT = 50;
export const MAX_CASE_TITLE_LENGTH = 120;
export const MAX_CASE_BODY_LENGTH = 2000;

export const isCaseKind = (v: unknown): v is CaseKind =>
  typeof v === 'string' && (CASE_KINDS as readonly string[]).includes(v);
export const isCaseStatus = (v: unknown): v is CaseStatus =>
  typeof v === 'string' && (CASE_STATUSES as readonly string[]).includes(v);
export const isCasePriority = (v: unknown): v is CasePriority =>
  typeof v === 'string' && (CASE_PRIORITIES as readonly string[]).includes(v);

/** No cross-team read leaks. Admin can access every case; analysts none. */
export function caseKindsForRole(role: StaffRole | null): CaseKind[] {
  if (role === 'admin') return [...CASE_KINDS];
  if (role === 'moderator') return ['appeal'];
  if (role === 'support') return ['support'];
  return [];
}
export function canAccessCaseKind(role: StaffRole | null, kind: CaseKind): boolean {
  return caseKindsForRole(role).includes(kind);
}
type CaseRow = {
  id: string; kind: CaseKind; title: string; description: string;
  status: CaseStatus; priority: CasePriority; subject_rider_id: string | null;
  created_by: string; assigned_to: string | null; created_at: string; updated_at: string;
  due_at: string | null; version: number;
};
export interface CompanyCase {
  id: string; kind: CaseKind; title: string; description: string;
  status: CaseStatus; priority: CasePriority; subjectRiderId: string | null;
  createdBy: string; assignedTo: string | null; createdAt: number;
  updatedAt: number; dueAt: number | null; version: number;
}
type EventRow = { id: string; case_id: string; actor_id: string; event: string;
  note: string; from_value: string | null; to_value: string | null; created_at: string };
export interface CaseEvent {
  id: string; caseId: string; actorId: string; event: string;
  note: string; fromValue: string | null; toValue: string | null; createdAt: number;
}
const toCase = (row: CaseRow): CompanyCase => ({
  id: row.id, kind: row.kind, title: row.title, description: row.description,
  status: row.status, priority: row.priority, subjectRiderId: row.subject_rider_id,
  createdBy: row.created_by, assignedTo: row.assigned_to,
  createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  dueAt: row.due_at === null ? null : Number(row.due_at), version: row.version,
});
const toEvent = (row: EventRow): CaseEvent => ({
  id: row.id, caseId: row.case_id, actorId: row.actor_id, event: row.event,
  note: row.note, fromValue: row.from_value, toValue: row.to_value,
  createdAt: Number(row.created_at),
});
const appendEvent = (client: PoolClient, id: string, actorId: string, event: string,
  note: string, before: string | null, after: string | null, now: number) =>
  client.query(
    `INSERT INTO company_case_events
      (id, case_id, actor_id, event, note, from_value, to_value, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), id, actorId, event, note, before, after, now],
  );

export type CaseMutation = { ok: true; item: CompanyCase } |
  { ok: false; error: 'not_found' | 'stale_case' | 'unchanged' |
    'assigned_to_other' | 'invalid_assignee' | 'invalid_transition' };
const cursorRe = /^(\d{1,16}):([0-9a-f-]{36})$/i;
export function parseCaseCursor(raw: string | null): { at: number; id: string } | null | undefined {
  if (raw === null) return null;
  const match = cursorRe.exec(raw);
  if (!match) return undefined;
  const at = Number(match[1]);
  return Number.isSafeInteger(at) && at > 0 ? { at, id: match[2]! } : undefined;
}

export class CompanyCaseStore {
  async list(kinds: CaseKind[], options: { kind?: CaseKind; status?: CaseStatus; limit: number;
    before: { at: number; id: string } | null }) {
    const selected = options.kind ? kinds.filter((kind) => kind === options.kind) : kinds;
    if (selected.length === 0) return { items: [] as CompanyCase[], hasMore: false, nextCursor: null as string | null, generatedAt: Date.now() };
    const { rows } = await getPool().query<CaseRow>(
      `SELECT * FROM company_cases
       WHERE kind = ANY($1::text[])
       AND ($2::text IS NULL OR status = $2)
       AND ($3::bigint IS NULL OR (updated_at, id) < ($3::bigint, $4::uuid))
       ORDER BY updated_at DESC, id DESC LIMIT $5`,
      [selected, options.status ?? null, options.before?.at ?? null, options.before?.id ?? null, options.limit + 1],
    );
    const hasMore = rows.length > options.limit;
    const items = rows.slice(0, options.limit).map(toCase);
    const last = items.at(-1);
    return { items, hasMore, nextCursor: hasMore && last ? last.updatedAt + ':' + last.id : null, generatedAt: Date.now() };
  }

  async detail(id: string): Promise<{ item: CompanyCase; events: CaseEvent[] } | null> {
    const { rows } = await getPool().query<CaseRow>('SELECT * FROM company_cases WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const history = await getPool().query<EventRow>(
      'SELECT * FROM company_case_events WHERE case_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200',
      [id],
    );
    return { item: toCase(rows[0]), events: history.rows.reverse().map(toEvent) };
  }

  async create(input: { kind: CaseKind; title: string; description: string;
    priority: CasePriority; subjectRiderId: string | null; actorId: string }): Promise<CompanyCase | null> {
    return withTransaction(async (client) => {
      if (input.subjectRiderId) {
        const rider = await client.query('SELECT 1 FROM users WHERE id = $1', [input.subjectRiderId]);
        if (!rider.rowCount) return null;
      }
      const now = Date.now(), id = randomUUID();
      const { rows } = await client.query<CaseRow>(
        `INSERT INTO company_cases (id, kind, title, description, priority,
         subject_rider_id, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
        [id, input.kind, input.title, input.description, input.priority,
          input.subjectRiderId, input.actorId, now],
      );
      await appendEvent(client, id, input.actorId, 'created', 'Internal case created', null, 'open', now);
      return toCase(rows[0]!);
    });
  }

  /** Row locking + version checks make competing ownership/state edits safe. */
  async mutate(input: { id: string; actorId: string; actorRole: StaffRole;
    expectedVersion: number; action: 'note' | 'status' | 'priority' | 'assign';
    note: string; value?: string | null }): Promise<CaseMutation> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<CaseRow>('SELECT * FROM company_cases WHERE id = $1 FOR UPDATE', [input.id]);
      const row = rows[0];
      if (!row || !canAccessCaseKind(input.actorRole, row.kind)) return { ok: false, error: 'not_found' };
      if (row.version !== input.expectedVersion) return { ok: false, error: 'stale_case' };
      if (input.action === 'note') {
        const now = Date.now();
        const updated = await client.query<CaseRow>(
          'UPDATE company_cases SET updated_at = $2, version = version + 1 WHERE id = $1 RETURNING *',
          [input.id, now],
        );
        await appendEvent(client, input.id, input.actorId, 'note', input.note, null, null, now);
        return { ok: true, item: toCase(updated.rows[0]!) };
      }
      let column: 'status' | 'priority' | 'assigned_to';
      let next: string | null;
      let event: string;
      if (input.action === 'status') {
        const value = input.value;
        if (!isCaseStatus(value)) return { ok: false, error: 'invalid_transition' };
        const nextByStatus: Record<CaseStatus, readonly CaseStatus[]> = {
          open: ['in_progress', 'waiting', 'resolved'],
          in_progress: ['waiting', 'resolved', 'closed'],
          waiting: ['in_progress', 'resolved', 'closed'],
          resolved: ['in_progress', 'closed'],
          closed: ['in_progress'],
        };
        if (row.status === value) return { ok: false, error: 'unchanged' };
        if (!nextByStatus[row.status].includes(value)) return { ok: false, error: 'invalid_transition' };
        column = 'status'; next = value; event = 'status';
      } else if (input.action === 'priority') {
        if (!isCasePriority(input.value)) return { ok: false, error: 'invalid_transition' };
        if (row.priority === input.value) return { ok: false, error: 'unchanged' };
        column = 'priority'; next = input.value; event = 'priority';
      } else {
        column = 'assigned_to'; next = input.value ?? null; event = next ? 'assigned' : 'released';
        if (next === row.assigned_to) return { ok: false, error: 'unchanged' };
        if (input.actorRole !== 'admin' &&
          (next !== null && next !== input.actorId ||
           row.assigned_to !== null && row.assigned_to !== input.actorId)) {
          return { ok: false, error: 'assigned_to_other' };
        }
        if (next !== null) {
          const staff = await client.query<{ is_admin: boolean; role: StaffRole | null }>(
            `SELECT u.is_admin, s.role FROM users u
             LEFT JOIN staff_roles s ON s.rider_id = u.id WHERE u.id = $1`, [next]);
          const entry = staff.rows[0];
          const role: StaffRole | null = entry ? entry.is_admin ? 'admin' : entry.role : null;
          if (!roleCan(role, 'view_cases') || !canAccessCaseKind(role, row.kind)) {
            return { ok: false, error: 'invalid_assignee' };
          }
        }
      }
      const before = column === 'assigned_to' ? row.assigned_to :
        column === 'status' ? row.status : row.priority;
      const now = Date.now();
      const updated = await client.query<CaseRow>(
        `UPDATE company_cases SET ${column} = $2, updated_at = $3, version = version + 1
         WHERE id = $1 RETURNING *`, [input.id, next, now]);
      await appendEvent(client, input.id, input.actorId, event,
        input.note, before, next, now);
      return { ok: true, item: toCase(updated.rows[0]!) };
    });
  }
}
