import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import {
  isReservedSocialAppPath, parseSocialPilotRiderIds, SOCIAL_PILOT_CAPABILITIES,
} from '../src/socialPilot.ts';

describe('Rider Social beta admission policy', () => {
  it('fails closed without a complete, valid server allowlist', () => {
    assert.deepEqual([...parseSocialPilotRiderIds(undefined)], []);
    assert.deepEqual([...parseSocialPilotRiderIds('   ')], []);
    assert.deepEqual([...parseSocialPilotRiderIds('rider_good123,invalid')], []);
    assert.deepEqual([...parseSocialPilotRiderIds('rider_good123,')], []);
    assert.deepEqual([...parseSocialPilotRiderIds('rider_good123,,rider_other123')], []);
    assert.deepEqual([...parseSocialPilotRiderIds('rider_good123,rider_good123')], ['rider_good123']);
    assert.deepEqual([...parseSocialPilotRiderIds(' rider_good123 , rider_other123 ')],
      ['rider_good123', 'rider_other123']);
    assert.equal(parseSocialPilotRiderIds('rider_good123').has('rider_other123'), false);
  });

  it('reserves future Social product URLs without breaking legacy Rider Comms API routes', () => {
    assert.equal(isReservedSocialAppPath('/social'), true);
    assert.equal(isReservedSocialAppPath('/social/bootstrap'), true);
    assert.equal(isReservedSocialAppPath('/social/media/uploads'), true);
    assert.equal(isReservedSocialAppPath('/social/posts/mine'), true);
    assert.equal(isReservedSocialAppPath('/social/app/feed'), true);
    assert.equal(isReservedSocialAppPath('/social/events'), false);
    assert.equal(isReservedSocialAppPath('/socialevents'), false);
    assert.equal(isReservedSocialAppPath('/friends/activity'), false);
  });

  it('leaves every unimplemented media and commerce capability disabled', () => {
    assert.equal(Object.values(SOCIAL_PILOT_CAPABILITIES).every(enabled => !enabled), true);
  });
});

describe('Social beta HTTP admission', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer({ socialPilotRiderIds: ['rider_pilot123'] });
    await ctx.ready;
  });
  after(() => ctx.close());

  it('rejects unauthenticated bootstrap before evaluating pilot entitlement', async () => {
    const res = await fetch(ctx.baseUrl() + '/social/bootstrap');
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('rejects non-pilot accounts on bootstrap and future Social API paths', async () => {
    for (const [path, method] of [
      ['/social/bootstrap', 'GET'],
      ['/social/posts/mine', 'GET'],
      ['/social/media/uploads', 'POST'],
      ['/social/app/feed', 'GET'],
    ] as const) {
      const res = await authenticatedFetch(ctx, 'rider_stranger123', path, { method });
      assert.equal(res.status, 403, path);
      assert.deepEqual(await res.json(), { error: 'social_beta_not_enabled' });
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  });

  it('allows only the authorised rider to read a non-publishing bootstrap', async () => {
    const res = await authenticatedFetch(ctx, 'rider_pilot123', '/social/bootstrap');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      entitlement: 'pilot',
      policyVersion: 'social-pilot-v1',
      capabilities: SOCIAL_PILOT_CAPABILITIES,
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = JSON.stringify(await (await authenticatedFetch(ctx, 'rider_pilot123', '/social/bootstrap')).json());
    assert.equal(text.includes('rider_pilot123'), false);
  });

  it('does not accidentally activate unavailable upload/post routes for the pilot', async () => {
    assert.equal((await authenticatedFetch(ctx, 'rider_pilot123', '/social/posts/mine')).status, 404);
    assert.equal((await authenticatedFetch(ctx, 'rider_pilot123', '/social/media/uploads', { method: 'POST' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, 'rider_pilot123', '/social/bootstrap', { method: 'POST' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, 'rider_pilot123', '/health')).status, 200);
  });
});

describe('Social admission defaults', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer({ socialPilotRiderIds: [] });
    await ctx.ready;
  });
  after(() => ctx.close());

  it('fails closed with no invited riders without impacting existing routes', async () => {
    const denied = await authenticatedFetch(ctx, 'rider_pilot123', '/social/bootstrap');
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'social_beta_not_enabled' });
    assert.equal((await authenticatedFetch(ctx, 'rider_pilot123', '/auth/me')).status, 200);
    assert.equal((await fetch(ctx.baseUrl() + '/health')).status, 200);
  });
});
