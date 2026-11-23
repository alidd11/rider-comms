import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { digestLines, runStaffAlerts, setStaffAlertPrefs } from '../src/staffAlerts.ts';
import type { WorkSnapshot } from '../src/staffAlerts.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_alertadmin';
const PARTNERS = 'rider_alertpartner';
const UNVERIFIED = 'rider_alertunver';
const FORMER = 'rider_alertformer';
const SEEDED = [ADMIN, PARTNERS, UNVERIFIED, FORMER];

describe('staff digest lines', () => {
  const work: WorkSnapshot = { openReports: 3, reportsWaitingOverDay: 1, activeCases: 2, unownedCases: 1, urgentCases: 0, partnerApplications: 1 };
  it('lists only what the role may see', () => {
    assert.deepEqual(digestLines('admin', work), [
      '3 open rider reports (1 waiting over a day)', '2 active cases, 1 without an owner, 0 urgent', '1 partner application awaiting review',
    ]);
    assert.deepEqual(digestLines('partnerships', work), ['1 partner application awaiting review']);
    assert.deepEqual(digestLines('analyst', work), []);
    assert.deepEqual(digestLines('moderator', { ...work, openReports: 1, reportsWaitingOverDay: 0, activeCases: 0 }), ['1 open rider report']);
  });
});

describe('staff email alerts', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const sent: { to: string; subject: string; text: string }[] = [];
  const send = async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return true; };
  const at = (iso: string) => Date.parse(iso);
  const cleanup = async () => {
    await getPool().query('DELETE FROM company_cases WHERE created_by = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM partner_applications WHERE contact_email = $1', ['alerts@example.org']);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    sent.length = 0;
    await cleanup();
    // Other tests' rows must not decide what these emails say.
    await getPool().query('UPDATE staff_alert_prefs SET daily_digest = false, urgent_alerts = false');
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin)
       VALUES ($1,'alert_admin','aadmin@example.org','x',now(),true),
        ($2,'alert_partner','apartner@example.org','x',now(),false),
        ($3,'alert_unver','aunver@example.org','x',NULL,true),
        ($4,'alert_former','aformer@example.org','x',now(),false)`, SEEDED,
    );
    await pool.query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'partnerships', $2, 0)`, [PARTNERS, ADMIN]);
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const addUrgentCase = (createdAt: number) => getPool().query(
    `INSERT INTO company_cases (id, kind, title, description, priority, created_by, created_at, updated_at)
     VALUES (gen_random_uuid(), 'incident', 'Urgent test case', '', 'urgent', $1, $2, $2)`, [ADMIN, createdAt]);

  it('each staff member reads and sets only their own choices', async () => {
    assert.deepEqual(await (await authenticatedFetch(ctx, ADMIN, '/admin/alerts')).json(), { dailyDigest: false, urgentAlerts: false });
    const post = (body: unknown) => authenticatedFetch(ctx, ADMIN, '/admin/alerts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ dailyDigest: 'yes', urgentAlerts: false })).status, 400);
    assert.equal((await post({ dailyDigest: true, urgentAlerts: true })).status, 200);
    assert.deepEqual(await (await authenticatedFetch(ctx, ADMIN, '/admin/alerts')).json(), { dailyDigest: true, urgentAlerts: true });
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/alerts', { method: 'DELETE' })).status, 405);
    assert.equal((await authenticatedFetch(ctx, FORMER, '/admin/alerts')).status, 403);
  });

  it('sends one morning summary a day, by role, only to verified current staff', async () => {
    await getPool().query(
      `INSERT INTO partner_applications (id, reference, kind, business_name, contact_name, contact_email, country, category, description, status, created_at, updated_at)
       VALUES (gen_random_uuid(), 'RC-ALERT1', 'seller', 'Alert Parts', 'Sam', 'alerts@example.org', 'GB', 'parts', 'Motorcycle parts and riding kit.', 'submitted', 0, 0)`,
    );
    for (const id of SEEDED) await setStaffAlertPrefs(id, { dailyDigest: true, urgentAlerts: false });
    assert.equal(await runStaffAlerts(at('2026-11-23T07:30:00Z'), send), 0); // before 08:00 UTC
    await runStaffAlerts(at('2026-11-23T08:05:00Z'), send);
    const recipients = sent.map((mail) => mail.to).sort();
    assert.deepEqual(recipients, ['aadmin@example.org', 'apartner@example.org']);
    const partnerMail = sent.find((mail) => mail.to === 'apartner@example.org')!;
    assert.doesNotMatch(partnerMail.text, /report|case/);
    for (const mail of sent) assert.match(mail.text, /admin\.html/);
    const count = sent.length;
    await runStaffAlerts(at('2026-11-23T12:00:00Z'), send);
    assert.equal(sent.length, count, 'no second summary the same day');
  });

  it('emails new urgent cases once, never a backlog from before opting in', async () => {
    const start = at('2026-11-23T10:00:00Z');
    await addUrgentCase(start - 60_000);
    await setStaffAlertPrefs(ADMIN, { dailyDigest: false, urgentAlerts: true }, start);
    await setStaffAlertPrefs(PARTNERS, { dailyDigest: false, urgentAlerts: true }, start); // cannot see cases
    assert.equal(await runStaffAlerts(start + 1000, send), 0);
    await addUrgentCase(start + 2000);
    await addUrgentCase(start + 3000);
    assert.equal(await runStaffAlerts(start + 900_000, send), 1);
    assert.equal(sent[0]!.to, 'aadmin@example.org');
    assert.equal(sent[0]!.subject, 'Rider Comms Staff Hub: 2 new urgent cases');
    assert.equal(await runStaffAlerts(start + 1_800_000, send), 0);
    // Saving again while on keeps the marker, so nothing is skipped or repeated.
    await setStaffAlertPrefs(ADMIN, { dailyDigest: true, urgentAlerts: true }, start + 1_900_000);
    await addUrgentCase(start + 1_850_000);
    await runStaffAlerts(start + 1_950_000, send);
    assert.ok(sent.some((mail) => mail.subject === 'Rider Comms Staff Hub: 1 new urgent case'));
  });
});
