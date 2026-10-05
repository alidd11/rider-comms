import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { musicAppsFor } from '../src/musicApps.ts';

describe('musicAppsFor', () => {
  it('offers Apple Music only on iOS', () => {
    assert.deepEqual(musicAppsFor('ios', null).map((app) => app.id), ['spotify', 'apple-music', 'youtube-music']);
    assert.deepEqual(musicAppsFor('android', null).map((app) => app.id), ['spotify', 'youtube-music']);
  });

  it('puts the last-used app first', () => {
    assert.deepEqual(musicAppsFor('ios', 'youtube-music').map((app) => app.id), ['youtube-music', 'spotify', 'apple-music']);
    // An app not offered on this platform changes nothing.
    assert.deepEqual(musicAppsFor('android', 'apple-music').map((app) => app.id), ['spotify', 'youtube-music']);
  });

  it('opens each app by its URL scheme', () => {
    assert.deepEqual(Object.fromEntries(musicAppsFor('ios', null).map((app) => [app.id, app.url])), {
      spotify: 'spotify:',
      'apple-music': 'music://',
      'youtube-music': 'youtubemusic://',
    });
  });
});
