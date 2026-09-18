import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// Friends, messages, blocks, and reports are now Postgres-backed (see
// db.ts) — these tests need DATABASE_URL to point at a reachable Postgres
// instance and are skipped otherwise, rather than failing every run in a
// sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

before({ skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social tests' }, async () => {
  await getPool().query('SELECT 1');
  await ensureMigrated();
  await getPool().query('TRUNCATE direct_message_reads, friend_requests, friendships, direct_messages, rider_blocks, safety_reports');
});

after({ skip: !hasDatabase }, async () => {
  await resetDbForTests();
});

describe('profiles, social links, friends, and messages', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social tests' }, () => {
  let ctx: TestServer; before(async () => { ctx = startTestServer(); await ctx.ready; }); after(() => ctx.close());
  it('isolates profiles and validates social usernames and visibility', async () => { assert.equal((await authenticatedFetch(ctx, 'mallory', '/riders/alice/profile')).status, 403); const updated = await authenticatedFetch(ctx, 'alice', '/riders/alice/profile', { method: 'PUT', body: JSON.stringify({ instagramUsername: 'ali.rides', instagramVisibility: 'public', tiktokUsername: 'ali_rides', tiktokVisibility: 'friends' }) }); assert.equal(updated.status, 200); const profile = await updated.json() as { instagramUsername: string; tiktokVisibility: string }; assert.equal(profile.instagramUsername, 'ali.rides'); assert.equal(profile.tiktokVisibility, 'friends'); assert.equal((await authenticatedFetch(ctx, 'alice', '/riders/alice/profile', { method: 'PUT', body: JSON.stringify({ instagramVisibility: 'everyone' }) })).status, 400); });
  it('enforces social visibility when another rider views a profile', async () => { ctx.authStore.createTestSession('alice'); ctx.authStore.createTestSession('viewer'); await ctx.profileStore.update('alice', { instagramUsername: 'ali.rides', instagramVisibility: 'public', tiktokUsername: 'secret', tiktokVisibility: 'private' }); const res = await authenticatedFetch(ctx, 'viewer', '/profiles/alice'); const profile = await res.json() as { instagramUsername: string; tiktokUsername: string }; assert.equal(profile.instagramUsername, 'ali.rides'); assert.equal(profile.tiktokUsername, ''); });
  it('derives request and message senders from authentication', async () => { ctx.authStore.createTestSession('bob'); const made = await postJson(ctx, 'alice', '/friends/requests', { toRiderId: 'bob', fromRiderId: 'mallory' }); const request = await made.json() as { id: string; fromRiderId: string }; assert.equal(request.fromRiderId, 'alice'); assert.equal((await postJson(ctx, 'bob', `/friends/requests/${request.id}/accept`, {})).status, 200); const sent = await postJson(ctx, 'alice', '/messages', { toRiderId: 'bob', text: ' hello ' }); const message = await sent.json() as { fromRiderId: string; text: string }; assert.deepEqual(message, { ...message, fromRiderId: 'alice', text: 'hello' }); });
  it('paginates message history with an opaque cursor and rejects malformed cursors', async () => {
    ctx.authStore.createTestSession('page-bob');
    const made = await postJson(ctx, 'page-alice', '/friends/requests', { toRiderId: 'page-bob' });
    const request = await made.json() as { id: string };
    await postJson(ctx, 'page-bob', `/friends/requests/${request.id}/accept`, {});
    for (const text of ['one', 'two', 'three']) await postJson(ctx, 'page-alice', '/messages', { toRiderId: 'page-bob', text });

    const latestResponse = await authenticatedFetch(ctx, 'page-alice', '/messages?withRiderId=page-bob&limit=2');
    const latest = await latestResponse.json() as { messages: Array<{ text: string }>; nextCursor: string | null };
    assert.deepEqual(latest.messages.map((message) => message.text), ['two', 'three']);
    assert.ok(latest.nextCursor);
    const olderResponse = await authenticatedFetch(ctx, 'page-alice', `/messages?withRiderId=page-bob&limit=2&before=${encodeURIComponent(latest.nextCursor ?? '')}`);
    const older = await olderResponse.json() as { messages: Array<{ text: string }>; nextCursor: string | null };
    assert.deepEqual(older.messages.map((message) => message.text), ['one']);
    assert.equal(older.nextCursor, null);
    assert.equal((await authenticatedFetch(ctx, 'page-alice', '/messages?withRiderId=page-bob&before=not-a-sequence')).status, 400);
  });
  it('limits message history to current friends', async () => {
    ctx.authStore.createTestSession('history-bob');
    const made = await postJson(ctx, 'history-alice', '/friends/requests', { toRiderId: 'history-bob' });
    const request = await made.json() as { id: string };
    await postJson(ctx, 'history-bob', `/friends/requests/${request.id}/accept`, {});
    await postJson(ctx, 'history-alice', '/messages', { toRiderId: 'history-bob', text: 'private history' });

    assert.equal((await authenticatedFetch(ctx, 'history-alice', '/messages?withRiderId=history-bob')).status, 200);
    assert.equal((await authenticatedFetch(ctx, 'history-alice', '/riders/history-alice/friends/history-bob', { method: 'DELETE' })).status, 200);

    const formerFriend = await authenticatedFetch(ctx, 'history-alice', '/messages?withRiderId=history-bob');
    assert.equal(formerFriend.status, 403);
    assert.deepEqual(await formerFriend.json(), { error: 'not_friends' });
    assert.equal((await authenticatedFetch(ctx, 'history-bob', '/messages?withRiderId=history-alice')).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'history-alice', '/messages?withRiderId=history-stranger')).status, 403);
  });
  it('lets only the sender cancel a pending friend request', async () => {
    ctx.authStore.createTestSession('cancel-target');
    const made = await postJson(ctx, 'cancel-sender', '/friends/requests', { toRiderId: 'cancel-target' });
    assert.equal(made.status, 201);
    const request = await made.json() as { id: string };

    assert.equal((await authenticatedFetch(ctx, 'cancel-target', `/friends/requests/${request.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, 'cancel-sender', `/friends/requests/${request.id}`, { method: 'DELETE' })).status, 200);

    const senderRequests = await authenticatedFetch(ctx, 'cancel-sender', '/riders/cancel-sender/friend-requests');
    const targetRequests = await authenticatedFetch(ctx, 'cancel-target', '/riders/cancel-target/friend-requests');
    assert.deepEqual(await senderRequests.json(), { incoming: [], outgoing: [], profiles: {}, nextCursor: null });
    assert.deepEqual(await targetRequests.json(), { incoming: [], outgoing: [], profiles: {}, nextCursor: null });
  });

  it('serves current-friend conversation summaries with unread and read state', async () => {
    ctx.authStore.createTestSession('conv-bob');
    ctx.authStore.createTestSession('conv-charlie');
    await ctx.profileStore.update('conv-bob', { displayName: 'Bob Rider', handle: '@conv_bob' });
    await ctx.profileStore.update('conv-charlie', { displayName: 'Charlie Rider', handle: '@conv_charlie' });

    const bobRequest = await postJson(ctx, 'conv-alice', '/friends/requests', { toRiderId: 'conv-bob' });
    const bobRequestBody = await bobRequest.json() as { id: string };
    await postJson(ctx, 'conv-bob', `/friends/requests/${bobRequestBody.id}/accept`, {});

    const charlieRequest = await postJson(ctx, 'conv-alice', '/friends/requests', { toRiderId: 'conv-charlie' });
    const charlieRequestBody = await charlieRequest.json() as { id: string };
    await postJson(ctx, 'conv-charlie', `/friends/requests/${charlieRequestBody.id}/accept`, {});

    await postJson(ctx, 'conv-bob', '/messages', { toRiderId: 'conv-alice', text: 'Bob incoming' });
    await postJson(ctx, 'conv-alice', '/messages', { toRiderId: 'conv-bob', text: 'Alice reply' });
    await postJson(ctx, 'conv-charlie', '/messages', { toRiderId: 'conv-alice', text: 'Charlie incoming' });

    const firstPageResponse = await authenticatedFetch(ctx, 'conv-alice', '/conversations?limit=1');
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json() as {
      conversations: Array<{ friend: { riderId: string; displayName: string }; lastMessage: { text: string }; unreadCount: number }>;
      nextCursor: string | null;
    };
    assert.equal(firstPage.conversations.length, 1);
    assert.equal(firstPage.conversations[0].friend.riderId, 'conv-charlie');
    assert.equal(firstPage.conversations[0].friend.displayName, 'Charlie Rider');
    assert.equal(firstPage.conversations[0].lastMessage.text, 'Charlie incoming');
    assert.equal(firstPage.conversations[0].unreadCount, 1);
    assert.ok(firstPage.nextCursor);

    const secondPageResponse = await authenticatedFetch(
      ctx,
      'conv-alice',
      `/conversations?limit=1&before=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
    );
    const secondPage = await secondPageResponse.json() as {
      conversations: Array<{ friend: { riderId: string }; unreadCount: number }>;
      nextCursor: string | null;
    };
    assert.equal(secondPage.conversations[0].friend.riderId, 'conv-bob');
    assert.equal(secondPage.conversations[0].unreadCount, 1);
    assert.equal(secondPage.nextCursor, null);

    const unreadBefore = await authenticatedFetch(ctx, 'conv-alice', '/messages/unread-count');
    assert.deepEqual(await unreadBefore.json(), { unreadCount: 2 });

    const marked = await postJson(ctx, 'conv-alice', '/messages/read', { withRiderId: 'conv-charlie' });
    assert.equal(marked.status, 200);
    const markedBody = await marked.json() as { readThroughSeq: number };
    assert.ok(markedBody.readThroughSeq > 0);

    const unreadAfter = await authenticatedFetch(ctx, 'conv-alice', '/messages/unread-count');
    assert.deepEqual(await unreadAfter.json(), { unreadCount: 1 });

    const refreshed = await authenticatedFetch(ctx, 'conv-alice', '/conversations');
    const refreshedBody = await refreshed.json() as {
      conversations: Array<{ friend: { riderId: string }; unreadCount: number }>;
    };
    assert.equal(refreshedBody.conversations.find(({ friend }) => friend.riderId === 'conv-charlie')?.unreadCount, 0);

    assert.equal((await authenticatedFetch(ctx, 'conv-alice', '/conversations?before=not-a-sequence')).status, 400);
    assert.equal((await authenticatedFetch(ctx, 'conv-alice', '/riders/conv-alice/friends/conv-bob', { method: 'DELETE' })).status, 200);

    const afterRemoval = await authenticatedFetch(ctx, 'conv-alice', '/conversations');
    const afterRemovalBody = await afterRemoval.json() as { conversations: Array<{ friend: { riderId: string } }> };
    assert.equal(afterRemovalBody.conversations.some(({ friend }) => friend.riderId === 'conv-bob'), false);
    assert.equal((await postJson(ctx, 'conv-alice', '/messages/read', { withRiderId: 'conv-bob' })).status, 403);
  });

  it('resolves a friend request sent by handle to the matching riderId', async () => {
    ctx.authStore.createTestSession('carol');
    await ctx.profileStore.update('carol', { handle: '@carol_rides' });
    const made = await postJson(ctx, 'dave', '/friends/requests', { toRiderId: '@Carol_Rides' });
    assert.equal(made.status, 201);
    const request = await made.json() as { toRiderId: string };
    assert.equal(request.toRiderId, 'carol');
  });
  it('404s a friend request by an unknown handle', async () => {
    assert.equal((await postJson(ctx, 'erin', '/friends/requests', { toRiderId: '@nobody_by_this_handle' })).status, 404);
  });
  it('rejects friending yourself by your own handle', async () => {
    ctx.authStore.createTestSession('frank');
    await ctx.profileStore.update('frank', { handle: '@frank_handle' });
    const res = await postJson(ctx, 'frank', '/friends/requests', { toRiderId: '@frank_handle' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'cannot_friend_yourself' });
  });
});

describe('reporting and blocking', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social tests' }, () => {
  let ctx: TestServer; before(async () => { ctx = startTestServer(); await ctx.ready; }); after(() => ctx.close());
  async function makeFriends(a: string, b: string) { ctx.authStore.createTestSession(b); const request = await postJson(ctx, a, '/friends/requests', { toRiderId: b }); const { id } = await request.json() as { id: string }; await postJson(ctx, b, `/friends/requests/${id}/accept`, {}); }
  it('records reports and blocks all further contact', async () => { await makeFriends('reporter', 'reported'); const report = await postJson(ctx, 'reporter', '/reports', { riderId: 'reported', reason: 'harassment', details: 'Repeated abuse' }); assert.equal(report.status, 201); assert.deepEqual(await report.json(), { received: true }); assert.equal((await postJson(ctx, 'reporter', '/blocks', { riderId: 'reported' })).status, 200); assert.equal((await postJson(ctx, 'reported', '/messages', { toRiderId: 'reporter', text: 'hello' })).status, 403); assert.equal((await postJson(ctx, 'reported', '/friends/requests', { toRiderId: 'reporter' })).status, 403); const blocks = await authenticatedFetch(ctx, 'reporter', '/blocks'); assert.deepEqual(await blocks.json(), { blockedRiderIds: ['reported'] }); });
  it('clears pending friend requests when either rider blocks the other', async () => {
    ctx.authStore.createTestSession('pending-target');
    const made = await postJson(ctx, 'pending-requester', '/friends/requests', { toRiderId: 'pending-target' });
    const request = await made.json() as { id: string };

    assert.equal((await postJson(ctx, 'pending-target', '/blocks', { riderId: 'pending-requester' })).status, 200);
    const requests = await authenticatedFetch(ctx, 'pending-target', '/riders/pending-target/friend-requests');
    assert.deepEqual(await requests.json(), { incoming: [], outgoing: [], profiles: {}, nextCursor: null });
    assert.equal((await postJson(ctx, 'pending-target', `/friends/requests/${request.id}/accept`, {})).status, 404);
  });
  it('makes blocking a durable relationship teardown without restoring access on unblock', async () => {
    await makeFriends('block-owner', 'block-peer');

    const hideoutResponse = await postJson(ctx, 'block-owner', '/hideouts', {
      name: 'Private meetup',
      lat: 51.5074,
      lon: -0.1278,
      participantIds: ['block-peer'],
    });
    assert.equal(hideoutResponse.status, 201);
    const hideout = await hideoutResponse.json() as { id: string };

    assert.equal((await postJson(ctx, 'block-owner', '/blocks', { riderId: 'block-peer' })).status, 200);

    const ownerFriends = await authenticatedFetch(ctx, 'block-owner', '/riders/block-owner/friends');
    const peerFriends = await authenticatedFetch(ctx, 'block-peer', '/riders/block-peer/friends');
    assert.deepEqual((await ownerFriends.json() as { friends: unknown[] }).friends, []);
    assert.deepEqual((await peerFriends.json() as { friends: unknown[] }).friends, []);

    const peerHideouts = await authenticatedFetch(ctx, 'block-peer', '/riders/block-peer/hideouts');
    assert.equal((await peerHideouts.json() as { hideouts: Array<{ id: string }> }).hideouts.some(({ id }) => id === hideout.id), false);

    const ownerHideouts = await authenticatedFetch(ctx, 'block-owner', '/riders/block-owner/hideouts');
    const ownerHideout = (await ownerHideouts.json() as { hideouts: Array<{ id: string; participantIds: string[] }> })
      .hideouts.find(({ id }) => id === hideout.id);
    assert.deepEqual(ownerHideout?.participantIds, []);

    assert.equal((await authenticatedFetch(ctx, 'block-owner', '/blocks/block-peer', { method: 'DELETE' })).status, 200);
    assert.equal((await postJson(ctx, 'block-owner', '/messages', { toRiderId: 'block-peer', text: 'still connected?' })).status, 403);

    const reconnect = await postJson(ctx, 'block-owner', '/friends/requests', { toRiderId: 'block-peer' });
    assert.equal(reconnect.status, 201);
  });

  it('hides blocked riders even if stale friendship and request rows exist', async () => {
    ctx.authStore.createTestSession('stale-block-a');
    ctx.authStore.createTestSession('stale-block-b');
    assert.equal((await postJson(ctx, 'stale-block-a', '/blocks', { riderId: 'stale-block-b' })).status, 200);

    const now = Date.now();
    await getPool().query(
      `INSERT INTO friendships (rider_id, friend_id, created_at)
       VALUES ($1, $2, $3), ($2, $1, $3)
       ON CONFLICT (rider_id, friend_id) DO NOTHING`,
      ['stale-block-a', 'stale-block-b', now],
    );
    await getPool().query(
      `INSERT INTO friend_requests (id, from_rider_id, to_rider_id, status, created_at)
       VALUES ($1, $2, $3, 'pending', $4)`,
      ['stale-block-request', 'stale-block-b', 'stale-block-a', now],
    );

    assert.equal(await ctx.friendStore.isFriendOf('stale-block-a', 'stale-block-b'), false);
    assert.deepEqual(await ctx.friendStore.createRequest('stale-block-a', 'stale-block-b'), { ok: false, error: 'blocked' });

    const friends = await authenticatedFetch(ctx, 'stale-block-a', '/riders/stale-block-a/friends');
    const requests = await authenticatedFetch(ctx, 'stale-block-a', '/riders/stale-block-a/friend-requests');
    assert.deepEqual((await friends.json() as { friends: unknown[] }).friends, []);
    assert.deepEqual(await requests.json(), { incoming: [], outgoing: [], profiles: {}, nextCursor: null });
  });

  it('filters blocked participants from third-party group hideouts', async () => {
    await makeFriends('hideout-host', 'hideout-a');
    await makeFriends('hideout-host', 'hideout-b');

    const created = await postJson(ctx, 'hideout-host', '/hideouts', {
      name: 'Group meeting point',
      lat: 51.51,
      lon: -0.12,
      participantIds: ['hideout-a', 'hideout-b'],
    });
    assert.equal(created.status, 201);
    const hideout = await created.json() as { id: string };

    assert.equal((await postJson(ctx, 'hideout-a', '/blocks', { riderId: 'hideout-b' })).status, 200);
    const response = await authenticatedFetch(ctx, 'hideout-a', '/riders/hideout-a/hideouts');
    const visible = (await response.json() as { hideouts: Array<{ id: string; participantIds: string[] }> })
      .hideouts.find(({ id }) => id === hideout.id);
    assert.ok(visible);
    assert.equal(visible?.participantIds.includes('hideout-a'), true);
    assert.equal(visible?.participantIds.includes('hideout-b'), false);
  });

  it('does not surface blocked nearby riders through presence responses', async () => {
    ctx.authStore.createTestSession('presence-block-a');
    ctx.authStore.createTestSession('presence-block-b');
    await ctx.profileStore.update('presence-block-a', { shareLocation: true });
    await ctx.profileStore.update('presence-block-b', { shareLocation: true });

    const recordedAt = Date.now();
    const location = { lat: 51.5074, lon: -0.1278, accuracyMeters: 5 };
    assert.equal((await postJson(ctx, 'presence-block-b', '/presence', { ...location, recordedAt })).status, 200);

    const beforeBlock = await postJson(ctx, 'presence-block-a', '/presence', { ...location, recordedAt: recordedAt + 1 });
    assert.equal(beforeBlock.status, 200);
    assert.equal((await beforeBlock.json() as { inZoneWith: string[] }).inZoneWith.includes('presence-block-b'), true);

    assert.equal((await postJson(ctx, 'presence-block-a', '/blocks', { riderId: 'presence-block-b' })).status, 200);

    const afterBlock = await postJson(ctx, 'presence-block-a', '/presence', { ...location, recordedAt: recordedAt + 2 });
    assert.equal(afterBlock.status, 200);
    const body = await afterBlock.json() as {
      inZoneWith: string[];
      transitions: Array<{ a: string; b: string }>;
    };
    assert.equal(body.inZoneWith.includes('presence-block-b'), false);
    assert.equal(body.transitions.some(({ a, b }) => a === 'presence-block-b' || b === 'presence-block-b'), false);
  });

  it('rejects an unknown report reason', async () => { ctx.authStore.createTestSession('target'); assert.equal((await postJson(ctx, 'reporter', '/reports', { riderId: 'target', reason: 'anything' })).status, 400); });
});
