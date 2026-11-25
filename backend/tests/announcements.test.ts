import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { ANNOUNCEMENT_CACHE_MS, ANNOUNCEMENT_MAX_DURATION_MS, announcementStore, parseAnnouncement } from '../src/announcements.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_annadmin';
const MOD = 'rider_annmod';
const RIDER = 'rider_annrider';
const SEEDED = [ADMIN, MOD, RIDER];
const HOUR = 60 * 60 * 1000;

describe('announcement input', () => {
  const now = 1_000_000;
  it('tidies the text and starts now by default', () => {
    assert.deepEqual(parseAnnouncement({ title: '  Winter  riding ', body: 'Roads\nare icy.', endsAt: now + HOUR }, now),
      { title: 'Winter riding', body: 'Roads are icy.', tone: 'info', startsAt: now, endsAt: now + HOUR });
  });
  it('refuses what it cannot show', () => {
    const ok = { title: 'T', body: 'B', endsAt: now + HOUR };
    assert.ok('error' in parseAnnouncement({ ...ok, title: '' }, now));
    assert.ok('error' in parseAnnouncement({ ...ok, title: 'x'.repeat(61) }, now));
    assert.ok('error' in parseAnnouncement({ ...ok, body: 'x'.repeat(241) }, now));
    assert.ok('error' in parseAnnouncement({ ...ok, tone: 'shout' }, now));
    assert.ok('error' in parseAnnouncement({ ...ok, endsAt: undefined }, now));
    assert.ok('error' in parseAnnouncement({ ...ok, startsAt: 'soon' }, now));
    assert.ok('error' in parseAnnouncement({ ...ok, endsAt: now - 1 }, now), 'already over');
    assert.ok('error' in parseAnnouncement({ ...ok, startsAt: now + 2 * HOUR }, now), 'ends before it starts');
    assert.ok('error' in parseAnnouncement({ ...ok, endsAt: now + ANNOUNCEMENT_MAX_DURATION_MS + 1 }, now), 'too long');
    assert.equal((parseAnnouncement({ ...ok, tone: 'warning', startsAt: now + HOUR, endsAt: now + 2 * HOUR }, now) as { tone: string }).tone, 'warning');
  });
});

describe('announcements without a database', { skip: hasDatabase && 'DATABASE_URL set' }, () => {
  it('shows nothing', async () => {
    assert.equal(await announcementStore.current(), null);
  });
});

describe('staff announcements', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    await getPool().query('DELETE FROM announcements');
    await getPool().query('DELETE FROM moderation_actions WHERE moderator_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
    announcementStore.clearCache();
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    await getPool().query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, terms_version)
       VALUES ($1,'ann_admin','annadmin@example.org','x',now(),true,'2026-10-01'), ($2,'ann_mod','annmod@example.org','x',now(),false,'2026-10-01'),
        ($3,'ann_rider','annrider@example.org','x',now(),false,'2026-10-01')`, SEEDED);
    await getPool().query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'moderator', $2, 0)`, [MOD, ADMIN]);
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const current = async () => (await (await authenticatedFetch(ctx, RIDER, '/announcements/current')).json() as { announcement: Record<string, unknown> | null }).announcement;

  it('admins publish with a note; riders see it without who wrote it; the audit log has it', async () => {
    assert.equal(await current(), null);
    const draft = { title: 'Winter riding', body: 'Roads are icy this week.', tone: 'warning', endsAt: Date.now() + HOUR };
    assert.equal((await postJson(ctx, MOD, '/admin/announcements', { ...draft, note: 'x' })).status, 403);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/announcements')).status, 403);
    assert.equal((await postJson(ctx, ADMIN, '/admin/announcements', draft)).status, 400, 'no note');
    assert.equal((await postJson(ctx, ADMIN, '/admin/announcements', { ...draft, title: '', note: 'x' })).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/announcements', { method: 'PUT', body: '{}' })).status, 405);
    assert.equal((await postJson(ctx, ADMIN, '/admin/announcements/x/y', { note: 'x' })).status, 404);

    const published = await postJson(ctx, ADMIN, '/admin/announcements', { ...draft, note: 'Cold snap' });
    assert.equal(published.status, 201);
    const { announcement } = await published.json() as { announcement: { id: string; createdBy: string } };
    assert.equal(announcement.createdBy, ADMIN);
    assert.deepEqual(Object.keys((await current())!).sort(), ['body', 'endsAt', 'id', 'title', 'tone']);
    assert.equal((await current())!.id, announcement.id);

    const list = await (await authenticatedFetch(ctx, ADMIN, '/admin/announcements')).json() as { items: { id: string; note: string }[] };
    assert.deepEqual(list.items.map((item) => [item.id, item.note]), [[announcement.id, 'Cold snap']]);
    const audit = await (await authenticatedFetch(ctx, ADMIN, '/moderation/actions')).json() as { actions: { action: string; detail?: string }[] };
    assert.ok(audit.actions.some((row) => row.action === 'announcement_publish' && row.detail === 'Winter riding'));
  });

  it('ending one takes it down for riders, once', async () => {
    const made = await announcementStore.publish({ title: 'T', body: 'B', tone: 'info', startsAt: Date.now() - 1, endsAt: Date.now() + HOUR }, ADMIN, 'n');
    assert.equal((await current())!.id, made.id);
    assert.equal((await postJson(ctx, ADMIN, `/admin/announcements/${made.id}/end`, {})).status, 400, 'no note');
    const ended = await postJson(ctx, ADMIN, `/admin/announcements/${made.id}/end`, { note: 'Thaw' });
    assert.equal(ended.status, 200);
    assert.equal(((await ended.json()) as { announcement: { endedBy: string } }).announcement.endedBy, ADMIN);
    assert.equal(await current(), null);
    assert.equal((await postJson(ctx, ADMIN, `/admin/announcements/${made.id}/end`, { note: 'again' })).status, 404);
    assert.equal((await postJson(ctx, ADMIN, '/admin/announcements/missing/end', { note: 'x' })).status, 404);
    const audit = await (await authenticatedFetch(ctx, ADMIN, '/moderation/actions')).json() as { actions: { action: string }[] };
    assert.ok(audit.actions.some((row) => row.action === 'announcement_end'));
  });

  it('shows the newest that has started; a scheduled one waits its turn', async () => {
    const now = Date.now();
    await announcementStore.publish({ title: 'Old', body: 'B', tone: 'info', startsAt: now - 2 * HOUR, endsAt: now + HOUR }, ADMIN, 'n', now - 2 * HOUR);
    await announcementStore.publish({ title: 'Later', body: 'B', tone: 'info', startsAt: now + HOUR, endsAt: now + 2 * HOUR }, ADMIN, 'n', now);
    await announcementStore.publish({ title: 'New', body: 'B', tone: 'info', startsAt: now - HOUR, endsAt: now + HOUR }, ADMIN, 'n', now);
    announcementStore.clearCache();
    assert.equal((await announcementStore.current(now))!.title, 'New');
    announcementStore.clearCache();
    assert.equal((await announcementStore.current(now + HOUR + 1))!.title, 'Later');
    announcementStore.clearCache();
    assert.equal(await announcementStore.current(now + 3 * HOUR), null);
  });

  it('a replica re-reads after its short cache, and never shows a cached one past its end', async () => {
    const now = Date.now();
    assert.equal(await announcementStore.current(now), null);
    await getPool().query(
      `INSERT INTO announcements (id, title, body, tone, starts_at, ends_at, created_by, created_at, note)
       VALUES ('elsewhere', 'T', 'B', 'info', $1, $2, $3, $1, 'n')`, [now - 1, now + 5000, ADMIN]);
    assert.equal(await announcementStore.current(now + 1), null, 'still cached');
    assert.equal((await announcementStore.current(now + ANNOUNCEMENT_CACHE_MS))?.id, undefined, 'it ended before the cache ran out');
    announcementStore.clearCache();
    assert.equal((await announcementStore.current(now + 1))!.id, 'elsewhere');
    assert.equal(await announcementStore.current(now + 5000), null, 'cached, but over');
  });
});
