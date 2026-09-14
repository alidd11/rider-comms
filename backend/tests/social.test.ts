import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createApp } from '../src/server.ts';
import { RideStore } from '../src/rideStore.ts';
import { PresenceStore } from '../src/presenceStore.ts';
import { ProfileStore } from '../src/profileStore.ts';
import { FriendStore } from '../src/friendStore.ts';
import { MessageStore } from '../src/messageStore.ts';
import { HideoutStore } from '../src/hideoutStore.ts';

interface TestServer {
  baseUrl: () => string;
  close: () => Promise<void>;
  server: http.Server;
  ready: Promise<void>;
}

/** Spins up a fresh server with fresh stores on an ephemeral port, mirroring
 * server.test.ts's isolation approach — no shared state leaking between
 * describe blocks. */
function startTestServer(): TestServer {
  const profileStore = new ProfileStore();
  const server = createApp(
    new RideStore(),
    new PresenceStore(),
    profileStore,
    new FriendStore(profileStore),
    new MessageStore(),
    new HideoutStore()
  );
  let base = '';
  const ready = new Promise<void>((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      base = `http://localhost:${port}`;
      resolve();
    });
  });
  return {
    baseUrl: () => base,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    server,
    ready,
  };
}

function postJson(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putJson(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Profile endpoints', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  it('GET lazily creates a default profile for an unseen riderId', async () => {
    const res = await fetch(`${ctx.baseUrl()}/riders/rider-1/profile`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.riderId, 'rider-1');
    assert.equal(body.displayName, 'Rider');
    assert.equal(body.handle, '@rider');
    assert.equal(body.avatarId, 'ember');
    assert.equal(body.zoneTier, 'free');
    assert.equal(body.unitSystem, 'mi');
    assert.equal(body.notifyNearby, true);
    assert.equal(body.notifyInvites, true);
    assert.equal(body.notifyChat, true);
    assert.equal(body.shareLocation, true);
    assert.ok(body.updatedAt > 0);
  });

  it('PUT merges an update and returns the full profile', async () => {
    await fetch(`${ctx.baseUrl()}/riders/rider-2/profile`); // establish default
    const res = await putJson(ctx.baseUrl(), '/riders/rider-2/profile', {
      displayName: 'Casey',
      zoneTier: 'premium',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.displayName, 'Casey');
    assert.equal(body.zoneTier, 'premium');
    assert.equal(body.handle, '@rider'); // untouched field kept

    const getRes = await fetch(`${ctx.baseUrl()}/riders/rider-2/profile`);
    const persisted = await getRes.json();
    assert.equal(persisted.displayName, 'Casey');
  });

  it('PUT on an unseen riderId creates defaults first, then applies the update', async () => {
    const res = await putJson(ctx.baseUrl(), '/riders/rider-3/profile', { unitSystem: 'km' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unitSystem, 'km');
    assert.equal(body.displayName, 'Rider');
  });

  it('PUT rejects an invalid zoneTier with 400 and does not apply anything', async () => {
    await fetch(`${ctx.baseUrl()}/riders/rider-4/profile`);
    const res = await putJson(ctx.baseUrl(), '/riders/rider-4/profile', {
      zoneTier: 'ultra',
      displayName: 'ShouldNotStick',
    });
    assert.equal(res.status, 400);
    const getRes = await fetch(`${ctx.baseUrl()}/riders/rider-4/profile`);
    const body = await getRes.json();
    assert.equal(body.displayName, 'Rider');
  });

  it('PUT rejects a non-boolean notify field with 400', async () => {
    const res = await putJson(ctx.baseUrl(), '/riders/rider-5/profile', {
      notifyChat: 'nope',
    });
    assert.equal(res.status, 400);
  });

  it('PUT rejects an empty displayName with 400', async () => {
    const res = await putJson(ctx.baseUrl(), '/riders/rider-6/profile', {
      displayName: '',
    });
    assert.equal(res.status, 400);
  });
});

describe('Friend request + friends endpoints', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  it('creates a friend request', async () => {
    const res = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'alice',
      toRiderId: 'bob',
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.fromRiderId, 'alice');
    assert.equal(body.toRiderId, 'bob');
    assert.equal(body.status, 'pending');
    assert.ok(body.id);
  });

  it('400s when fields are missing', async () => {
    const res = await postJson(ctx.baseUrl(), '/friends/requests', { fromRiderId: 'alice' });
    assert.equal(res.status, 400);
  });

  it('400s on self-friending', async () => {
    const res = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'alice',
      toRiderId: 'alice',
    });
    assert.equal(res.status, 400);
  });

  it('409s on a duplicate pending request', async () => {
    await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'carol',
      toRiderId: 'dave',
    });
    const res = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'dave',
      toRiderId: 'carol',
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'request_exists');
  });

  it('lists incoming/outgoing pending requests for a rider', async () => {
    const res = await fetch(`${ctx.baseUrl()}/riders/carol/friend-requests`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.outgoing.length, 1);
    assert.equal(body.outgoing[0].toRiderId, 'dave');

    const daveRes = await fetch(`${ctx.baseUrl()}/riders/dave/friend-requests`);
    const daveBody = await daveRes.json();
    assert.equal(daveBody.incoming.length, 1);
    assert.equal(daveBody.incoming[0].fromRiderId, 'carol');
  });

  it('accepting creates a mutual friendship and returns the requester summary', async () => {
    await putJson(ctx.baseUrl(), '/riders/erin/profile', {
      displayName: 'Erin',
      handle: '@erin',
      avatarId: 'wolf',
    });
    const reqRes = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'erin',
      toRiderId: 'frank',
    });
    const { id } = await reqRes.json();

    const acceptRes = await fetch(`${ctx.baseUrl()}/friends/requests/${id}/accept`, {
      method: 'POST',
    });
    assert.equal(acceptRes.status, 200);
    const acceptBody = await acceptRes.json();
    assert.deepEqual(acceptBody.friend, {
      riderId: 'erin',
      displayName: 'Erin',
      handle: '@erin',
      avatarId: 'wolf',
    });

    const franksFriends = await (await fetch(`${ctx.baseUrl()}/riders/frank/friends`)).json();
    assert.equal(franksFriends.friends.length, 1);
    assert.equal(franksFriends.friends[0].riderId, 'erin');

    const erinsFriends = await (await fetch(`${ctx.baseUrl()}/riders/erin/friends`)).json();
    assert.equal(erinsFriends.friends.length, 1);
    assert.equal(erinsFriends.friends[0].riderId, 'frank');
  });

  it('409s when requesting friendship with an existing friend', async () => {
    const res = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'erin',
      toRiderId: 'frank',
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'already_friends');
  });

  it('accept 404s on an unknown request id', async () => {
    const res = await fetch(`${ctx.baseUrl()}/friends/requests/does-not-exist/accept`, {
      method: 'POST',
    });
    assert.equal(res.status, 404);
  });

  it('decline marks the request declined without creating a friendship', async () => {
    const reqRes = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: 'gina',
      toRiderId: 'hank',
    });
    const { id } = await reqRes.json();
    const declineRes = await fetch(`${ctx.baseUrl()}/friends/requests/${id}/decline`, {
      method: 'POST',
    });
    assert.equal(declineRes.status, 200);
    assert.deepEqual(await declineRes.json(), {});

    const ginasFriends = await (await fetch(`${ctx.baseUrl()}/riders/gina/friends`)).json();
    assert.equal(ginasFriends.friends.length, 0);
  });

  it('DELETE friends removes the friendship in both directions and is idempotent', async () => {
    const delRes = await fetch(`${ctx.baseUrl()}/riders/erin/friends/frank`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    assert.deepEqual(await delRes.json(), {});

    const erinsFriends = await (await fetch(`${ctx.baseUrl()}/riders/erin/friends`)).json();
    assert.equal(erinsFriends.friends.length, 0);

    // idempotent: deleting again still 200s
    const delAgain = await fetch(`${ctx.baseUrl()}/riders/erin/friends/frank`, {
      method: 'DELETE',
    });
    assert.equal(delAgain.status, 200);
  });
});

describe('Direct message endpoints', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  async function makeFriends(a: string, b: string) {
    const reqRes = await postJson(ctx.baseUrl(), '/friends/requests', {
      fromRiderId: a,
      toRiderId: b,
    });
    const { id } = await reqRes.json();
    await fetch(`${ctx.baseUrl()}/friends/requests/${id}/accept`, { method: 'POST' });
  }

  it('403s when sending a message between non-friends', async () => {
    const res = await postJson(ctx.baseUrl(), '/messages', {
      fromRiderId: 'stranger-a',
      toRiderId: 'stranger-b',
      text: 'hi',
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'not_friends');
  });

  it('sends and retrieves messages between friends', async () => {
    await makeFriends('m-alice', 'm-bob');

    const sendRes = await postJson(ctx.baseUrl(), '/messages', {
      fromRiderId: 'm-alice',
      toRiderId: 'm-bob',
      text: 'hey bob',
    });
    assert.equal(sendRes.status, 201);
    const sent = await sendRes.json();
    assert.equal(sent.text, 'hey bob');
    assert.ok(sent.id);
    assert.ok(sent.createdAt > 0);

    await postJson(ctx.baseUrl(), '/messages', {
      fromRiderId: 'm-bob',
      toRiderId: 'm-alice',
      text: 'hey alice',
    });

    const listRes = await fetch(
      `${ctx.baseUrl()}/messages?riderId=m-alice&withRiderId=m-bob`
    );
    assert.equal(listRes.status, 200);
    const body = await listRes.json();
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].text, 'hey bob');
    assert.equal(body.messages[1].text, 'hey alice');
    assert.ok(body.messages[0].createdAt <= body.messages[1].createdAt);
  });

  it('400s on an empty or whitespace-only message', async () => {
    await makeFriends('m-carol', 'm-dave');
    const res = await postJson(ctx.baseUrl(), '/messages', {
      fromRiderId: 'm-carol',
      toRiderId: 'm-dave',
      text: '   ',
    });
    assert.equal(res.status, 400);
  });

  it('400s on a message over 1000 characters', async () => {
    await makeFriends('m-erin', 'm-frank');
    const res = await postJson(ctx.baseUrl(), '/messages', {
      fromRiderId: 'm-erin',
      toRiderId: 'm-frank',
      text: 'x'.repeat(1001),
    });
    assert.equal(res.status, 400);
  });

  it('400s on GET /messages missing query params', async () => {
    const res = await fetch(`${ctx.baseUrl()}/messages?riderId=only-one`);
    assert.equal(res.status, 400);
  });

  it('GET /messages works without a friendship (read-only history is harmless)', async () => {
    const res = await fetch(
      `${ctx.baseUrl()}/messages?riderId=never-friends-a&withRiderId=never-friends-b`
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { messages: [] });
  });
});

describe('Hideout endpoints', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  it('creates a hideout', async () => {
    const res = await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'Trailhead',
      lat: 40.1,
      lon: -105.2,
      createdBy: 'h-alice',
      participantIds: ['h-bob'],
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, 'Trailhead');
    assert.ok(body.id);
    assert.ok(body.createdAt > 0);
  });

  it('400s on invalid hideout input', async () => {
    const res = await postJson(ctx.baseUrl(), '/hideouts', {
      name: '',
      lat: 'not-a-number',
      lon: -105.2,
      createdBy: 'h-alice',
      participantIds: ['h-bob'],
    });
    assert.equal(res.status, 400);
  });

  it('400s when participantIds is not an array of strings', async () => {
    const res = await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'Bad',
      lat: 1,
      lon: 1,
      createdBy: 'h-alice',
      participantIds: [1, 2],
    });
    assert.equal(res.status, 400);
  });

  it('lists hideouts for creator and participants', async () => {
    await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'Creator Spot',
      lat: 1,
      lon: 1,
      createdBy: 'h-creator',
      participantIds: [],
    });
    await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'Participant Spot',
      lat: 1,
      lon: 1,
      createdBy: 'someone-else',
      participantIds: ['h-creator'],
    });
    await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'Unrelated',
      lat: 1,
      lon: 1,
      createdBy: 'someone-else',
      participantIds: ['not-h-creator'],
    });

    const res = await fetch(`${ctx.baseUrl()}/riders/h-creator/hideouts`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.hideouts.length, 2);
    const names = body.hideouts.map((h: { name: string }) => h.name).sort();
    assert.deepEqual(names, ['Creator Spot', 'Participant Spot']);
  });

  it('DELETE requires riderId query param (400 if missing)', async () => {
    const createRes = await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'ToDelete',
      lat: 1,
      lon: 1,
      createdBy: 'h-owner',
      participantIds: [],
    });
    const { id } = await createRes.json();
    const res = await fetch(`${ctx.baseUrl()}/hideouts/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  it('DELETE 403s when riderId is not the creator', async () => {
    const createRes = await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'Owned',
      lat: 1,
      lon: 1,
      createdBy: 'h-owner2',
      participantIds: ['h-notowner'],
    });
    const { id } = await createRes.json();
    const res = await fetch(`${ctx.baseUrl()}/hideouts/${id}?riderId=h-notowner`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'forbidden');
  });

  it('DELETE 404s on an unknown hideout', async () => {
    const res = await fetch(`${ctx.baseUrl()}/hideouts/does-not-exist?riderId=x`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 404);
  });

  it('DELETE succeeds for the creator', async () => {
    const createRes = await postJson(ctx.baseUrl(), '/hideouts', {
      name: 'DeleteMe',
      lat: 1,
      lon: 1,
      createdBy: 'h-owner3',
      participantIds: [],
    });
    const { id } = await createRes.json();
    const res = await fetch(`${ctx.baseUrl()}/hideouts/${id}?riderId=h-owner3`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {});

    const listRes = await fetch(`${ctx.baseUrl()}/riders/h-owner3/hideouts`);
    const listBody = await listRes.json();
    assert.equal(listBody.hideouts.length, 0);
  });
});
