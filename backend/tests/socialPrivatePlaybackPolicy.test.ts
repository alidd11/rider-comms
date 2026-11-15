import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeSocialPrivatePlayback,
  type SocialPlaybackContext,
} from '../src/socialPrivatePlaybackPolicy.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const viewer = '22222222-2222-4222-8222-222222222222';
function valid(): SocialPlaybackContext {
  return {
    viewerId: viewer, ownerId: owner, mediaState: 'ready',
    ownerState: 'active', viewerState: 'active', audience: 'public',
    ownerAllowsViewer: true, viewerAllowsOwner: true,
    viewerFollowsOwner: false, viewerEmailVerified: true,
    viewerTermsCurrent: true, ownerAgeEligible: true,
    viewerAgeEligible: true, ownerModerationClear: true,
    mediaModerationClear: true, postDeleted: false, postExpired: false,
  };
}
const allowed = { allowed: true };
const forbidden = { allowed: false, reason: 'forbidden' };
describe('private Social playback policy', () => {
  it('requires a logged-in viewer', () => {
    assert.deepEqual(authorizeSocialPrivatePlayback({ ...valid(), viewerId: null }),
      { allowed: false, reason: 'unauthenticated' });
    assert.deepEqual(authorizeSocialPrivatePlayback({ ...valid(), viewerId: '' }),
      { allowed: false, reason: 'unauthenticated' });
    assert.deepEqual(authorizeSocialPrivatePlayback(null as unknown as SocialPlaybackContext),
      { allowed: false, reason: 'unauthenticated' });
  });
  it('permits only ready public content when all gates are satisfied', () => {
    assert.deepEqual(authorizeSocialPrivatePlayback(valid()), allowed);
  });
  it('enforces followers and private audience on the server', () => {
    assert.deepEqual(authorizeSocialPrivatePlayback({ ...valid(), audience: 'followers' }), forbidden);
    assert.deepEqual(authorizeSocialPrivatePlayback({
      ...valid(), audience: 'followers', viewerFollowsOwner: true,
    }), allowed);
    assert.deepEqual(authorizeSocialPrivatePlayback({
      ...valid(), audience: 'private', viewerFollowsOwner: true,
    }), forbidden);
    assert.deepEqual(authorizeSocialPrivatePlayback({
      ...valid(), audience: 'private', viewerId: owner,
    }), allowed);
  });
  it('does not exempt owners from safety or moderation checks', () => {
    for (const field of ['mediaState', 'ownerState', 'viewerState',
      'viewerEmailVerified', 'viewerTermsCurrent', 'ownerAgeEligible',
      'viewerAgeEligible', 'ownerModerationClear', 'mediaModerationClear',
      'postDeleted', 'postExpired', 'ownerAllowsViewer',
      'viewerAllowsOwner'] as const) {
      const base = { ...valid(), viewerId: owner };
      const invalid = field === 'mediaState' ? 'quarantined'
        : field === 'ownerState' || field === 'viewerState' ? 'suspended'
        : field === 'postDeleted' || field === 'postExpired' ? true : false;
      assert.deepEqual(authorizeSocialPrivatePlayback({ ...base, [field]: invalid }),
        forbidden, field);
    }
  });
  it('rejects every unready media state and every nonactive account state', () => {
    for (const mediaState of ['pending', 'quarantined', 'rejected', 'deleted'] as const) {
      assert.deepEqual(authorizeSocialPrivatePlayback({ ...valid(), mediaState }), forbidden);
    }
    for (const state of ['suspended', 'deleted'] as const) {
      assert.deepEqual(authorizeSocialPrivatePlayback({ ...valid(), ownerState: state }), forbidden);
      assert.deepEqual(authorizeSocialPrivatePlayback({ ...valid(), viewerState: state }), forbidden);
    }
  });
  it('fails closed on missing or invalid authoritative fields', () => {
    const base = valid();
    for (const field of Object.keys(base) as Array<keyof SocialPlaybackContext>) {
      assert.deepEqual(authorizeSocialPrivatePlayback({
        ...base, [field]: undefined,
      }), field === 'viewerId' ? { allowed: false, reason: 'unauthenticated' } : forbidden, field);
    }
    assert.deepEqual(authorizeSocialPrivatePlayback({ ...base, ownerId: '' }), forbidden);
    assert.deepEqual(authorizeSocialPrivatePlayback({
      ...base, audience: 'friends' as SocialPlaybackContext['audience'],
    }), forbidden);
  });
});
