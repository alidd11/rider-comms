import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AudioEngine } from '../src/audio/audioEngine.ts';

describe('native AudioEngine chat-source aggregation', () => {
  it('keeps chat active while any LiveKit room still has a remote speaker', () => {
    const engine = new AudioEngine();

    engine.setChatSourceActive('proximity:a', true);
    assert.equal(engine.getGains().chat, 1);

    engine.setChatSourceActive('proximity:b', true);
    engine.setChatSourceActive('proximity:a', false);
    assert.equal(engine.getGains().chat, 1);

    engine.clearChatSource('proximity:b');
    assert.equal(engine.getGains().chat, 0);
  });

  it('provides full incoming chat volume normally and ducks it under a nav prompt', () => {
    const engine = new AudioEngine();

    assert.equal(engine.getIncomingChatPlaybackGain(), 1);
    engine.setNavPromptActive(true);
    assert.equal(engine.getIncomingChatPlaybackGain(), 0.3);
    engine.setNavPromptActive(false);
    assert.equal(engine.getIncomingChatPlaybackGain(), 1);
  });

  it('keeps the legacy chat setter isolated from named room sources', () => {
    const engine = new AudioEngine();

    engine.setChatActive(true);
    engine.setChatSourceActive('ride:abc', true);
    engine.setChatActive(false);
    assert.equal(engine.getGains().chat, 1);

    engine.clearChatSource('ride:abc');
    assert.equal(engine.getGains().chat, 0);
  });

  it('ignores blank source ids and duplicate source updates', () => {
    const engine = new AudioEngine();
    let changes = 0;
    const unsubscribe = engine.onGainsChanged(() => { changes += 1; });

    engine.setChatSourceActive('   ', true);
    engine.setChatSourceActive('ride:abc', true);
    engine.setChatSourceActive('ride:abc', true);
    engine.setChatSourceActive('ride:abc', false);
    engine.setChatSourceActive('ride:abc', false);

    unsubscribe();
    assert.equal(changes, 2);
  });
});
