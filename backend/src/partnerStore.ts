import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ensureMigrated, getPool, withTransaction } from './db.ts';
import { roleCan } from './staffRoles.ts';
import type { StaffRole } from './staffRoles.ts';

/**
 * Seller and advertiser onboarding. A business applies through a public form
 * (no Rider Comms account needed); staff with `review_partners` review it,
 * tick off the verification checklist and decide, always with a note. There
 * is deliberately no money here: no payments, payouts or ad spend.
 */
export const PARTNER_KINDS = ['seller', 'advertiser'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_STATUSES = ['submitted', 'in_review', 'info_requested', 'approved', 'rejected'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
/** What staff confirm before approving. Kept small and checkable by hand. */
export const PARTNER_CHECKS = ['identity', 'business', 'website', 'policies'] as const;
export type PartnerCheck = (typeof PARTNER_CHECKS)[number];
export const MAX_PARTNER_NOTE_LENGTH = 2000;
export const MAX_PARTNER_LIMIT = 50;

export const isPartnerKind = (v: unknown): v is PartnerKind =>
  typeof v === 'string' && (PARTNER_KINDS as readonly string[]).includes(v);
export const isPartnerStatus = (v: unknown): v is PartnerStatus =>
  typeof v === 'string' && (PARTNER_STATUSES as readonly string[]).includes(v);
export const isPartnerCheck = (v: unknown): v is PartnerCheck =>
  typeof v === 'string' && (PARTNER_CHECKS as readonly string[]).includes(v);

/** Which decisions are allowed from each state. Approval and rejection are
 * final, except that a rejection can be reopened for review. */
const NEXT_STATUS: Record<PartnerStatus, readonly PartnerStatus[]> = {
  submitted: ['in_review', 'info_requested', 'rejected'],
  in_review: ['info_requested', 'approved', 'rejected'],
  info_requested: ['in_review', 'rejected'],
  approved: [],
  rejected: ['in_review'],
};

export interface PartnerApplicationInput {
  kind: PartnerKind; businessName: string; contactName: string; contactEmail: string;
  website: string | null; country: string; category: string; description: string;
}

/** Validates a public submission. Returns the cleaned input or an error code. */
export function parsePartnerApplication(body: Record<string, unknown>): PartnerApplicationInput | { error: string } {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  if (!isPartnerKind(body.kind)) return { error: 'invalid_kind' };
  const businessName = text(body.businessName);
  const contactName = text(body.contactName);
  const contactEmail = text(body.contactEmail).toLowerCase();
  const websiteRaw = text(body.website);
  const country = text(body.country).toUpperCase();
  const category = text(body.category);
  const description = text(body.description);
  if (businessName.length < 2 || businessName.length > 120) return { error: 'invalid_business_name' };
  if (contactName.length < 2 || contactName.length > 80) return { error: 'invalid_contact_name' };
  if (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) return { error: 'invalid_email' };
  let website: string | null = null;
  if (websiteRaw) {
    try {
      const url = new URL(/^https?:\/\//i.test(websiteRaw) ? websiteRaw : 'https://' + websiteRaw);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error('bad');
      website = url.toString().slice(0, 200);
    } catch {
      return { error: 'invalid_website' };
    }
  }
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'invalid_country' };
  if (category.length < 2 || category.length > 60) return { error: 'invalid_category' };
  if (description.length < 20 || description.length > 2000) return { error: 'invalid_description' };
  return { kind: body.kind, businessName, contactName, contactEmail, website, country, category, description };
}

type Row = {
  id: string; reference: string; kind: PartnerKind; business_name: string; contact_name: string;
  contact_email: string; website: string | null; country: string; category: string; description: string;
  status: PartnerStatus; checklist: Partial<Record<PartnerCheck, boolean>>; assigned_to: string | null;
  created_at: string; updated_at: string; version: number;
};
export interface PartnerApplication {
  id: string; reference: string; kind: PartnerKind; businessName: string; contactName: string;
  contactEmail: string; website: string | null; country: string; category: string; description: string;
  status: PartnerStatus; checklist: Record<PartnerCheck, boolean>; assignedTo: string | null;
  createdAt: number; updatedAt: number; version: number;
}
export interface PartnerEvent {
  id: string; actorId: string | null; event: string; note: string;
  fromValue: string | null; toValue: string | null; createdAt: number;
}
const toApplication = (row: Row): PartnerApplication => ({
  id: row.id, reference: row.reference, kind: row.kind, businessName: row.business_name,
  contactName: row.contact_name, contactEmail: row.contact_email, website: row.website,
  country: row.country, category: row.category, description: row.description, status: row.status,
  checklist: Object.fromEntries(PARTNER_CHECKS.map((check) => [check, row.checklist?.[check] === true])) as Record<PartnerCheck, boolean>,
  assignedTo: row.assigned_to, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), version: row.version,
});

async function appendEvent(client: PoolClient, applicationId: string, actorId: string | null, event: string,
  note: string, fromValue: string | null, toValue: string | null, now: number) {
  await client.query(
    `INSERT INTO partner_application_events (id, application_id, actor_id, event, note, from_value, to_value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), applicationId, actorId, event, note, fromValue, toValue, now],
  );
}

/** A short reference the business can quote, e.g. "RC-7K3QX9". */
function newReference(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  return 'RC-' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export type PartnerMutation =
  | { ok: true; item: PartnerApplication }
  | { ok: false; error: 'not_found' | 'stale_application' | 'invalid_transition' | 'unchanged'
    | 'checklist_incomplete' | 'assigned_to_other' | 'invalid_assignee' };

export class PartnerStore {
  async submit(input: PartnerApplicationInput, now = Date.now()): Promise<{ reference: string }> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const id = randomUUID();
      const reference = newReference();
      await client.query(
        `INSERT INTO partner_applications (id, reference, kind, business_name, contact_name, contact_email,
           website, country, category, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [id, reference, input.kind, input.businessName, input.contactName, input.contactEmail,
          input.website, input.country, input.category, input.description, now],
      );
      await appendEvent(client, id, null, 'submitted', 'Application submitted through the public form', null, 'submitted', now);
      return { reference };
    });
  }

  async summary() {
    await ensureMigrated();
    const { rows } = await getPool().query<{ status: PartnerStatus; kind: PartnerKind; count: string }>(
      'SELECT status, kind, COUNT(*) AS count FROM partner_applications GROUP BY status, kind',
    );
    const count = (filter: (row: { status: PartnerStatus; kind: PartnerKind }) => boolean) =>
      rows.filter(filter).reduce((total, row) => total + Number(row.count), 0);
    return {
      awaitingReview: count((row) => row.status === 'submitted' || row.status === 'in_review'),
      infoRequested: count((row) => row.status === 'info_requested'),
      approvedSellers: count((row) => row.status === 'approved' && row.kind === 'seller'),
      approvedAdvertisers: count((row) => row.status === 'approved' && row.kind === 'advertiser'),
    };
  }

  /** `open` means anything still waiting on a decision. */
  async list(options: { status?: PartnerStatus | 'open'; kind?: PartnerKind; limit: number }): Promise<PartnerApplication[]> {
    await ensureMigrated();
    const statuses = options.status === 'open' ? ['submitted', 'in_review', 'info_requested']
      : options.status ? [options.status] : null;
    const { rows } = await getPool().query<Row>(
      `SELECT * FROM partner_applications
       WHERE ($1::text[] IS NULL OR status = ANY($1::text[])) AND ($2::text IS NULL OR kind = $2)
       ORDER BY updated_at DESC, id DESC LIMIT $3`,
      [statuses, options.kind ?? null, options.limit],
    );
    return rows.map(toApplication);
  }

  async detail(id: string): Promise<{ item: PartnerApplication; events: PartnerEvent[] } | null> {
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<Row>('SELECT * FROM partner_applications WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const events = await pool.query<{ id: string; actor_id: string | null; event: string; note: string;
      from_value: string | null; to_value: string | null; created_at: string }>(
      `SELECT id, actor_id, event, note, from_value, to_value, created_at
       FROM partner_application_events WHERE application_id = $1 ORDER BY seq DESC LIMIT 200`, [id]);
    return {
      item: toApplication(rows[0]),
      events: events.rows.map((e) => ({ id: e.id, actorId: e.actor_id, event: e.event, note: e.note,
        fromValue: e.from_value, toValue: e.to_value, createdAt: Number(e.created_at) })),
    };
  }

  /** Every change locks the row, checks the version and records the note. */
  async mutate(input: { id: string; actorId: string; actorRole: StaffRole; expectedVersion: number;
    action: 'status' | 'note' | 'checklist' | 'assign'; note: string;
    status?: PartnerStatus; check?: PartnerCheck; done?: boolean; assigneeId?: string | null }): Promise<PartnerMutation> {
    await ensureMigrated();
    return withTransaction<PartnerMutation>(async (client) => {
      const { rows } = await client.query<Row>('SELECT * FROM partner_applications WHERE id = $1 FOR UPDATE', [input.id]);
      const row = rows[0];
      if (!row) return { ok: false, error: 'not_found' };
      if (row.version !== input.expectedVersion) return { ok: false, error: 'stale_application' };
      const isAdmin = input.actorRole === 'admin';
      if (!isAdmin && row.assigned_to && row.assigned_to !== input.actorId && input.action !== 'note') {
        return { ok: false, error: 'assigned_to_other' };
      }
      const now = Date.now();
      let set = '';
      let params: unknown[] = [];
      let event: string = input.action;
      let fromValue: string | null = null;
      let toValue: string | null = null;
      if (input.action === 'status') {
        const next = input.status!;
        if (row.status === next) return { ok: false, error: 'unchanged' };
        if (!NEXT_STATUS[row.status].includes(next)) return { ok: false, error: 'invalid_transition' };
        if (next === 'approved' && !PARTNER_CHECKS.every((check) => row.checklist?.[check] === true)) {
          return { ok: false, error: 'checklist_incomplete' };
        }
        set = 'status = $2'; params = [next]; fromValue = row.status; toValue = next;
      } else if (input.action === 'checklist') {
        const check = input.check!;
        const done = input.done === true;
        if ((row.checklist?.[check] === true) === done) return { ok: false, error: 'unchanged' };
        if (row.status === 'approved' || row.status === 'rejected') return { ok: false, error: 'invalid_transition' };
        set = `checklist = checklist || jsonb_build_object($2::text, $3::boolean)`; params = [check, done];
        fromValue = check; toValue = done ? 'done' : 'not_done';
      } else if (input.action === 'assign') {
        const next = input.assigneeId === undefined ? input.actorId : input.assigneeId;
        if (next === row.assigned_to) return { ok: false, error: 'unchanged' };
        if (!isAdmin && next !== null && next !== input.actorId) return { ok: false, error: 'assigned_to_other' };
        if (next !== null) {
          const staff = await client.query<{ is_admin: boolean; role: StaffRole | null }>(
            `SELECT u.is_admin, s.role FROM users u LEFT JOIN staff_roles s ON s.rider_id = u.id
             WHERE u.id = $1 AND u.suspended_at IS NULL`, [next]);
          const entry = staff.rows[0];
          const role: StaffRole | null = entry ? (entry.is_admin ? 'admin' : entry.role) : null;
          if (!roleCan(role, 'review_partners')) return { ok: false, error: 'invalid_assignee' };
        }
        set = 'assigned_to = $2'; params = [next]; event = next ? 'assigned' : 'released';
        fromValue = row.assigned_to; toValue = next;
      }
      const updated = await client.query<Row>(
        `UPDATE partner_applications SET ${set ? set + ', ' : ''}updated_at = $${params.length + 2},
           version = version + 1 WHERE id = $1 RETURNING *`,
        [input.id, ...params, now],
      );
      await appendEvent(client, input.id, input.actorId, event, input.note, fromValue, toValue, now);
      return { ok: true, item: toApplication(updated.rows[0]!) };
    });
  }
}
