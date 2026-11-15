import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROFILE_BIO_LENGTH } from '@rider-comms/shared';
import { validateProfileUpdate } from '../src/profileStore.ts';
import { authenticatedFetch, clearSharedTestState, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('profile bio validation', () => {
  it('accepts a short bio and refuses a long, non-text or offensive one', () => {
    assert.equal(validateProfileUpdate({ bio: 'Sunday rides, Surrey Hills.' }), null);
    assert.equal(validateProfileUpdate({ bio: '' }), null);
    assert.equal(validateProfileUpdate({ bio: ` ${'x'.repeat(MAX_PROFILE_BIO_LENGTH)} ` }), null);
    assert.match(String(validateProfileUpdate({ bio: 'x'.repeat(MAX_PROFILE_BIO_LENGTH + 1) })), /at most 160/);
    assert.match(String(validateProfileUpdate({ bio: 42 })), /at most 160/);
    assert.equal(validateProfileUpdate({ bio: 'Heil Hitler' }), 'objectionable_content');
  });
});

describe('profile bio, shared by both apps', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  before(async () => {
    await clearSharedTestState();
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  it('saves to the account and shows on the public profile', async () => {
    const own = await authenticatedFetch(ctx, 'bio_rider', '/riders/bio_rider/profile');
    assert.equal((await own.json() as { bio: string }).bio, '');
    const saved = await authenticatedFetch(ctx, 'bio_rider', '/riders/bio_rider/profile', { method: 'PUT', body: JSON.stringify({ bio: 'Box Hill most weekends.' }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json() as { bio: string }).bio, 'Box Hill most weekends.');
    const seen = await authenticatedFetch(ctx, 'bio_viewer', '/profiles/bio_rider');
    assert.equal((await seen.json() as { bio: string }).bio, 'Box Hill most weekends.');
    const refused = await authenticatedFetch(ctx, 'bio_rider', '/riders/bio_rider/profile', { method: 'PUT', body: JSON.stringify({ bio: 'x'.repeat(161) }) });
    assert.equal(refused.status, 400);
  });
});
