import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import type { VoiceRoomAdmin } from '../src/liveKitToken.ts';

const FAKE_CREDS = {
  apiKey: 'fake-key',
  apiSecret: 'fake-secret-at-least-32-bytes-long!!',
  url: 'wss://example.livekit.cloud',
};

const hasDatabase = Boolean(process.env.DATABASE_URL);
const needsDb = { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed test' };

interface AdminCall {
  type: 'remove' | 'delete';
  roomName: string;
  identity?: string;
}

function recordingAdmin(failType?: AdminCall['type']): { admin: VoiceRoomAdmin; calls: AdminCall[] } {
  const calls: AdminCall[] = [];
  return {
    calls,
    admin: {
      async removeParticipant(roomName, identity) {
        calls.push({ type: 'remove', roomName, identity });
        if (failType === 'remove') throw new Error('injected LiveKit remove failure');
      },
      async deleteRoom(roomName) {
        calls.push({ type: 'delete', roomName });
        if (failType === 'delete') throw new Error('injected LiveKit delete failure');
      },
    },
  };
}

const servers: TestServer[] = [];
async function serverWithAdmin(failType?: AdminCall['type']) {
  const recorder = recordingAdmin(failType);
  const ctx = startTestServer({ liveKitCredentials: FAKE_CREDS, voiceRoomAdmin: recorder.admin });
  servers.push(ctx);
  await ctx.ready;
  return { ctx, ...recorder };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((ctx) => ctx.close()));
});

describe('private ride media enforcement', () => {
  it('revokes a removed rider before exclusion and rotates the host invite code', needsDb, async () => {
    const { ctx, calls } = await serverWithAdmin();
    const created = await (await postJson(ctx, 'host-remove', '/rides', {})).json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'removed-member', '/rides/join', { code: created.code })).status, 200);

    const removed = await authenticatedFetch(
      ctx,
      'host-remove',
      `/rides/${created.rideId}/members/removed-member`,
      { method: 'DELETE' },
    );
    assert.equal(removed.status, 200);
    const body = await removed.json() as { memberIds: string[]; code: string };
    assert.deepEqual(body.memberIds, ['host-remove']);
    assert.notEqual(body.code, created.code);
    assert.deepEqual(calls, [
      { type: 'remove', roomName: `ride:${created.rideId}`, identity: 'removed-member' },
    ]);

    const oldCode = await postJson(ctx, 'other-rider', '/rides/join', { code: created.code });
    assert.equal(oldCode.status, 404);
    assert.deepEqual(await oldCode.json(), { error: 'invalid_or_expired' });

    const excluded = await postJson(ctx, 'removed-member', '/rides/join', { code: body.code });
    assert.equal(excluded.status, 403);
    assert.deepEqual(await excluded.json(), { error: 'excluded' });

    assert.equal((await postJson(ctx, 'other-rider', '/rides/join', { code: body.code })).status, 200);
    assert.equal((await postJson(ctx, 'removed-member', '/voice/token', { target: 'ride', rideId: created.rideId })).status, 403);
  });

  it('fails closed when host-removal media revocation fails', needsDb, async () => {
    const { ctx, calls } = await serverWithAdmin('remove');
    const created = await (await postJson(ctx, 'host-fail-remove', '/rides', {})).json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'member-fail-remove', '/rides/join', { code: created.code })).status, 200);

    const failed = await authenticatedFetch(
      ctx,
      'host-fail-remove',
      `/rides/${created.rideId}/members/member-fail-remove`,
      { method: 'DELETE' },
    );
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'voice_cleanup_failed' });
    assert.equal(calls.length, 1);

    assert.equal((await authenticatedFetch(ctx, 'member-fail-remove', `/rides/${created.rideId}`)).status, 200);
    const hostView = await authenticatedFetch(ctx, 'host-fail-remove', `/rides/${created.rideId}`);
    const hostBody = await hostView.json() as { code: string; memberIds: string[] };
    assert.equal(hostBody.code, created.code);
    assert.ok(hostBody.memberIds.includes('member-fail-remove'));
  });

  it('revokes a voluntary leaver before membership deletion', needsDb, async () => {
    const { ctx, calls } = await serverWithAdmin();
    const created = await (await postJson(ctx, 'host-leave', '/rides', {})).json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'member-leave', '/rides/join', { code: created.code })).status, 200);

    const left = await postJson(ctx, 'member-leave', `/rides/${created.rideId}/leave`, {});
    assert.equal(left.status, 200);
    assert.deepEqual(calls, [
      { type: 'remove', roomName: `ride:${created.rideId}`, identity: 'member-leave' },
    ]);
    assert.equal((await authenticatedFetch(ctx, 'member-leave', `/rides/${created.rideId}`)).status, 403);
  });

  it('keeps voluntary membership intact if media revocation fails', needsDb, async () => {
    const { ctx } = await serverWithAdmin('remove');
    const created = await (await postJson(ctx, 'host-leave-fail', '/rides', {})).json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'member-leave-fail', '/rides/join', { code: created.code })).status, 200);

    const failed = await postJson(ctx, 'member-leave-fail', `/rides/${created.rideId}/leave`, {});
    assert.equal(failed.status, 503);
    assert.equal((await authenticatedFetch(ctx, 'member-leave-fail', `/rides/${created.rideId}`)).status, 200);
  });

  it('deletes the media room before ending a hosted ride', needsDb, async () => {
    const { ctx, calls } = await serverWithAdmin();
    const created = await (await postJson(ctx, 'host-end', '/rides', {})).json() as { rideId: string };

    assert.equal((await authenticatedFetch(ctx, 'host-end', `/rides/${created.rideId}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [{ type: 'delete', roomName: `ride:${created.rideId}` }]);
    assert.equal((await authenticatedFetch(ctx, 'host-end', `/rides/${created.rideId}`)).status, 404);
  });

  it('keeps a hosted ride intact when room deletion fails', needsDb, async () => {
    const { ctx } = await serverWithAdmin('delete');
    const created = await (await postJson(ctx, 'host-end-fail', '/rides', {})).json() as { rideId: string };

    const failed = await authenticatedFetch(ctx, 'host-end-fail', `/rides/${created.rideId}`, { method: 'DELETE' });
    assert.equal(failed.status, 503);
    assert.equal((await authenticatedFetch(ctx, 'host-end-fail', `/rides/${created.rideId}`)).status, 200);
  });

  it('fails account deletion closed when owned ride media cleanup fails', needsDb, async () => {
    const { ctx, calls } = await serverWithAdmin('delete');
    const session = ctx.authStore.createTestSession('delete-host');
    const headers = { Authorization: `Bearer ${session.token}` };
    const created = await (await postJson(ctx, 'delete-host', '/rides', {})).json() as { rideId: string };

    const failed = await fetch(`${ctx.baseUrl()}/auth/me`, { method: 'DELETE', headers });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'voice_cleanup_failed' });
    assert.deepEqual(calls, [{ type: 'delete', roomName: `ride:${created.rideId}` }]);
    assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers })).status, 200);
    assert.equal((await authenticatedFetch(ctx, 'delete-host', `/rides/${created.rideId}`)).status, 200);
  });

  it('cleans hosted rooms and member identities before successful account deletion', needsDb, async () => {
    const { ctx, calls } = await serverWithAdmin();
    const hosted = await (await postJson(ctx, 'delete-rider', '/rides', {})).json() as { rideId: string };
    const other = await (await postJson(ctx, 'other-host', '/rides', {})).json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'delete-rider', '/rides/join', { code: other.code })).status, 200);

    const session = ctx.authStore.createTestSession('delete-rider');
    const response = await fetch(`${ctx.baseUrl()}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { type: 'delete', roomName: `ride:${hosted.rideId}` },
      { type: 'remove', roomName: `ride:${other.rideId}`, identity: 'delete-rider' },
    ]);
  });
});
