import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { getPool, resetDbForTests } from '../src/db.ts';

// Friends, messages, blocks, and reports are now Postgres-backed (see
// db.ts) — these tests need DATABASE_URL to point at a reachable Postgres
// instance and are skipped otherwise, rather than failing every run in a
// sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

before({ skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social tests' }, async () => {
  await getPool().query('SELECT 1');
  await getPool().query('TRUNCATE friend_requests, friendships, direct_messages, rider_blocks, safety_reports');
});

after({ skip: !hasDatabase }, async () => {
  await resetDbForTests();
});

describe('profiles, social links, friends, and messages', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social tests' }, () => {
  let ctx: TestServer; before(async () => { ctx = startTestServer(); await ctx.ready; }); after(() => ctx.close());
  it('isolates profiles and validates social usernames and visibility', async () => { assert.equal((await authenticatedFetch(ctx, 'mallory', '/riders/alice/profile')).status, 403); const updated = await authenticatedFetch(ctx, 'alice', '/riders/alice/profile', { method: 'PUT', body: JSON.stringify({ instagramUsername: 'ali.rides', instagramVisibility: 'public', tiktokUsername: 'ali_rides', tiktokVisibility: 'friends' }) }); assert.equal(updated.status, 200); const profile = await updated.json() as { instagramUsername: string; tiktokVisibility: string }; assert.equal(profile.instagramUsername, 'ali.rides'); assert.equal(profile.tiktokVisibility, 'friends'); assert.equal((await authenticatedFetch(ctx, 'alice', '/riders/alice/profile', { method: 'PUT', body: JSON.stringify({ instagramVisibility: 'everyone' }) })).status, 400); });
  it('enforces social visibility when another rider views a profile', async () => { ctx.authStore.createTestSession('alice'); ctx.authStore.createTestSession('viewer'); ctx.profileStore.update('alice', { instagramUsername: 'ali.rides', instagramVisibility: 'public', tiktokUsername: 'secret', tiktokVisibility: 'private' }); const res = await authenticatedFetch(ctx, 'viewer', '/profiles/alice'); const profile = await res.json() as { instagramUsername: string; tiktokUsername: string }; assert.equal(profile.instagramUsername, 'ali.rides'); assert.equal(profile.tiktokUsername, ''); });
  it('derives request and message senders from authentication', async () => { ctx.authStore.createTestSession('bob'); const made = await postJson(ctx, 'alice', '/friends/requests', { toRiderId: 'bob', fromRiderId: 'mallory' }); const request = await made.json() as { id: string; fromRiderId: string }; assert.equal(request.fromRiderId, 'alice'); assert.equal((await postJson(ctx, 'bob', `/friends/requests/${request.id}/accept`, {})).status, 200); const sent = await postJson(ctx, 'alice', '/messages', { toRiderId: 'bob', text: ' hello ' }); const message = await sent.json() as { fromRiderId: string; text: string }; assert.deepEqual(message, { ...message, fromRiderId: 'alice', text: 'hello' }); });
});

describe('reporting and blocking', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social tests' }, () => {
  let ctx: TestServer; before(async () => { ctx = startTestServer(); await ctx.ready; }); after(() => ctx.close());
  async function makeFriends(a: string, b: string) { ctx.authStore.createTestSession(b); const request = await postJson(ctx, a, '/friends/requests', { toRiderId: b }); const { id } = await request.json() as { id: string }; await postJson(ctx, b, `/friends/requests/${id}/accept`, {}); }
  it('records reports and blocks all further contact', async () => { await makeFriends('reporter', 'reported'); const report = await postJson(ctx, 'reporter', '/reports', { riderId: 'reported', reason: 'harassment', details: 'Repeated abuse' }); assert.equal(report.status, 201); assert.deepEqual(await report.json(), { received: true }); assert.equal((await postJson(ctx, 'reporter', '/blocks', { riderId: 'reported' })).status, 200); assert.equal((await postJson(ctx, 'reported', '/messages', { toRiderId: 'reporter', text: 'hello' })).status, 403); assert.equal((await postJson(ctx, 'reported', '/friends/requests', { toRiderId: 'reporter' })).status, 403); const blocks = await authenticatedFetch(ctx, 'reporter', '/blocks'); assert.deepEqual(await blocks.json(), { blockedRiderIds: ['reported'] }); });
  it('rejects an unknown report reason', async () => { ctx.authStore.createTestSession('target'); assert.equal((await postJson(ctx, 'reporter', '/reports', { riderId: 'target', reason: 'anything' })).status, 400); });
});
