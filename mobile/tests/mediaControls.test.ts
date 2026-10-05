import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MediaControls, type MediaKey } from '../src/audio/mediaControls.ts';

function fakeNative(playing = false) {
  const sent: MediaKey[] = [];
  return {
    sent,
    native: {
      isOtherAudioPlaying: () => playing,
      sendMediaKey: (key: MediaKey) => { sent.push(key); return true; },
    },
  };
}

describe('MediaControls', () => {
  it('offers nothing without the native module', () => {
    const controls = new MediaControls(null, true);
    assert.deepEqual(controls.capabilities, { buttons: false, playbackState: false });
    assert.equal(controls.isMusicPlaying(), null);
    assert.equal(controls.send('playPause'), false);
  });

  it('sends buttons where the platform allows it (Android)', () => {
    const { native, sent } = fakeNative(true);
    const controls = new MediaControls(native, true);
    assert.deepEqual(controls.capabilities, { buttons: true, playbackState: true });
    assert.equal(controls.isMusicPlaying(), true);
    assert.equal(controls.send('next'), true);
    assert.deepEqual(sent, ['next']);
  });

  it('reads playback state but sends nothing where the platform forbids it (iOS)', () => {
    const { native, sent } = fakeNative(false);
    const controls = new MediaControls(native, false);
    assert.deepEqual(controls.capabilities, { buttons: false, playbackState: true });
    assert.equal(controls.isMusicPlaying(), false);
    assert.equal(controls.send('playPause'), false);
    assert.deepEqual(sent, []);
  });

  it('treats native errors as unknown or refused instead of throwing', () => {
    const controls = new MediaControls({
      isOtherAudioPlaying: () => { throw new Error('audio session unavailable'); },
      sendMediaKey: () => { throw new Error('no audio manager'); },
    }, true);
    assert.equal(controls.isMusicPlaying(), null);
    assert.equal(controls.send('playPause'), false);
  });
});
