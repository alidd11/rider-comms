import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS,
  DEFAULT_PROXIMITY_VOICE_REFRESH_MS,
  proximityVoiceStatus,
  prunePeerSet,
  resolveProximityVoiceTiming,
} from '../src/voice/proximityVoiceState.ts';

describe('proximity voice state', () => {
  it('uses the server cadence and lease when valid', () => {
    assert.deepEqual(resolveProximityVoiceTiming(20_000, 60_000), {
      refreshAfterMs: 20_000,
      authorizationLeaseMs: 60_000,
    });
  });

  it('falls back safely and refreshes earlier instead of extending a short server lease', () => {
    assert.deepEqual(resolveProximityVoiceTiming(undefined, undefined), {
      refreshAfterMs: DEFAULT_PROXIMITY_VOICE_REFRESH_MS,
      authorizationLeaseMs: DEFAULT_PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS,
    });
    assert.deepEqual(resolveProximityVoiceTiming(30_000, 10_000), {
      refreshAfterMs: 5_000,
      authorizationLeaseMs: 10_000,
    });
  });

  it('prunes connected/speaking state to the latest authorised roster', () => {
    assert.deepEqual(
      [...prunePeerSet(new Set(['a', 'b', 'c']), new Set(['b', 'd']))],
      ['b'],
    );
  });

  it('prioritises local transmit state and reports lease expiry as reconnecting', () => {
    assert.equal(proximityVoiceStatus({
      error: false,
      authorizationExpired: false,
      localSpeaking: true,
      remoteSpeakingNames: ['Maya'],
      connectedCount: 2,
      pendingCount: 2,
    }), 'Nearby Voice · You speaking');

    assert.equal(proximityVoiceStatus({
      error: false,
      authorizationExpired: true,
      localSpeaking: false,
      remoteSpeakingNames: [],
      connectedCount: 0,
      pendingCount: 0,
    }), 'Nearby Voice · reconnecting');
  });

  it('summarises remote speakers and idle states', () => {
    assert.equal(proximityVoiceStatus({
      error: false,
      authorizationExpired: false,
      localSpeaking: false,
      remoteSpeakingNames: ['Maya', 'Sam'],
      connectedCount: 2,
      pendingCount: 2,
    }), 'Nearby Voice · Maya + 1 speaking');

    assert.equal(proximityVoiceStatus({
      error: false,
      authorizationExpired: false,
      localSpeaking: false,
      remoteSpeakingNames: [],
      connectedCount: 0,
      pendingCount: 0,
    }), 'Nearby Voice · waiting for riders');
  });
});
