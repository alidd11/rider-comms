import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NowPlayingBridge } from '../src/audio/nowPlayingBridge.ts';

describe('NowPlayingBridge', () => {
  it('feature-detects unsupported controls and never throws', () => {
    const bridge = new NowPlayingBridge();
    assert.deepEqual(bridge.capabilities, { play: false, pause: false, skipNext: false });
    assert.equal(bridge.play(), false);
    assert.equal(bridge.pause(), false);
    assert.equal(bridge.skipNext(), false);
  });

  it('delegates only controls supplied by the native binding', () => {
    let plays = 0;
    const bridge = new NowPlayingBridge({ play: () => { plays += 1; } });
    assert.deepEqual(bridge.capabilities, { play: true, pause: false, skipNext: false });
    assert.equal(bridge.play(), true);
    assert.equal(plays, 1);
    assert.equal(bridge.pause(), false);
  });
});
