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

describe('MediaControls now playing', () => {
  it('reads nothing from an older module without now-playing support', async () => {
    const { native } = fakeNative(true);
    const controls = new MediaControls(native, true);
    assert.equal(controls.canShowNowPlaying, false);
    assert.equal(controls.nowPlayingAccess(), 'denied');
    assert.equal(await controls.nowPlaying(), null);
  });

  it('cleans up the track the native module reports', async () => {
    const controls = new MediaControls({
      isOtherAudioPlaying: () => true,
      sendMediaKey: () => true,
      nowPlayingAccess: () => 'granted',
      getNowPlaying: async () => ({
        title: '  Song  ', artist: ' Band ', playing: true, source: 'com.spotify.music', appName: 'Spotify',
        artworkUri: 'javascript:alert(1)',
      }),
    }, true);
    assert.equal(controls.canShowNowPlaying, true);
    assert.deepEqual(await controls.nowPlaying(), {
      title: 'Song', artist: 'Band', playing: true, source: 'com.spotify.music', appName: 'Spotify', artworkUri: undefined,
    });
  });

  it('treats an empty title or a native error as nothing playing', async () => {
    const empty = new MediaControls({ isOtherAudioPlaying: () => false, sendMediaKey: () => true, getNowPlaying: async () => ({ title: ' ', artist: '', playing: false, source: '', appName: '' }) }, true);
    assert.equal(await empty.nowPlaying(), null);
    const failing = new MediaControls({ isOtherAudioPlaying: () => false, sendMediaKey: () => true, getNowPlaying: async () => { throw new Error('boom'); } }, true);
    assert.equal(await failing.nowPlaying(), null);
  });

  it('controls the shown track, falling back to media keys', async () => {
    const calls: string[] = [];
    const withControl = new MediaControls({
      isOtherAudioPlaying: () => true,
      sendMediaKey: () => { calls.push('key'); return true; },
      controlNowPlaying: async (key) => { calls.push(`control:${key}`); return true; },
    }, false);
    assert.equal(await withControl.control('next'), true);
    const { native, sent } = fakeNative(true);
    assert.equal(await new MediaControls(native, true).control('playPause'), true);
    assert.deepEqual(calls, ['control:next']);
    assert.deepEqual(sent, ['playPause']);
  });
});

describe('MediaControls when the native module fails', () => {
  it('reports no access and falls back safely', async () => {
    const throwing = {
      isOtherAudioPlaying: () => false,
      sendMediaKey: () => true,
      nowPlayingAccess: () => { throw new Error('native crash'); },
      requestNowPlayingAccess: async () => { throw new Error('native crash'); },
      controlNowPlaying: async () => { throw new Error('native crash'); },
    };
    const controls = new MediaControls(throwing, true);
    assert.equal(controls.nowPlayingAccess(), 'denied');
    assert.equal(await controls.requestNowPlayingAccess(), 'denied');
    assert.equal(await controls.control('next'), false);
  });

  it('passes through a granted request', async () => {
    const controls = new MediaControls({
      isOtherAudioPlaying: () => false,
      sendMediaKey: () => true,
      requestNowPlayingAccess: async () => 'granted',
    }, true);
    assert.equal(await controls.requestNowPlayingAccess(), 'granted');
    assert.equal(await new MediaControls(null, true).requestNowPlayingAccess(), 'denied');
  });
});
