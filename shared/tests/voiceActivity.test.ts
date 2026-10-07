import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceActivityGate } from '../src/voiceActivity.ts';

/** Feeds `level` every 20 ms for `ms`, returning the final state and when speech first opened. */
function feed(gate: VoiceActivityGate, level: number, ms: number, start: number) {
  let openedAt: number | null = null;
  let now = start;
  for (; now < start + ms; now += 20) {
    if (gate.update(level, now) && openedAt === null) openedAt = now;
  }
  return { now, openedAt };
}

describe('VoiceActivityGate', () => {
  it('opens for normal speech in a quiet place within about 40 ms', () => {
    const gate = new VoiceActivityGate();
    const t = feed(gate, 0.005, 2000, 0).now;
    const speech = feed(gate, 0.06, 200, t);
    assert.ok(speech.openedAt !== null && speech.openedAt - t <= 60, `opened at ${speech.openedAt}`);
  });

  it('ignores a single bump shorter than the attack hold', () => {
    const gate = new VoiceActivityGate();
    const t = feed(gate, 0.005, 1000, 0).now;
    assert.equal(gate.update(0.2, t), false);
    assert.equal(gate.update(0.005, t + 20), false);
    assert.equal(gate.state.speaking, false);
  });

  it('learns steady wind or engine noise and stays closed through it', () => {
    const gate = new VoiceActivityGate();
    // 0.045 opened the old fixed 0.035 threshold permanently.
    const noisy = feed(gate, 0.045, 6000, 0);
    assert.equal(noisy.openedAt, null, 'steady noise must not open the mic');
    assert.ok(gate.state.noiseFloor > 0.035, `floor ${gate.state.noiseFloor}`);
    // Speech well above the noise still opens it.
    const speech = feed(gate, 0.16, 200, noisy.now);
    assert.notEqual(speech.openedAt, null);
  });

  it('keeps transmitting through short pauses and closes after the hangtime', () => {
    const gate = new VoiceActivityGate();
    let t = feed(gate, 0.005, 1000, 0).now;
    t = feed(gate, 0.06, 200, t).now;
    assert.equal(gate.state.speaking, true);
    t = feed(gate, 0.004, 600, t).now;
    assert.equal(gate.state.speaking, true, 'a 0.6 s pause keeps the mic open');
    t = feed(gate, 0.06, 100, t).now;
    feed(gate, 0.004, 1000, t);
    assert.equal(gate.state.speaking, false, 'closes once quiet for longer than the hangtime');
  });

  it('caps the noise floor so speech close to the mic can still open it', () => {
    const gate = new VoiceActivityGate();
    const t = feed(gate, 0.5, 20_000, 0).now;
    assert.ok(gate.state.noiseFloor <= 0.3 + 1e-9);
    assert.ok(gate.state.attackLevel <= 0.3 * 2.2 + 1e-9);
    assert.notEqual(feed(gate, 0.8, 200, t).openedAt, null);
  });

  it('closes again even when steady wind is louder than normal speech', () => {
    const gate = new VoiceActivityGate();
    let t = feed(gate, 0.004, 2000, 0).now;
    // Highway wind on the helmet mic, far louder than the old 0.12 release ceiling.
    const wind = feed(gate, 0.2, 30_000, t);
    assert.notEqual(wind.openedAt, null, 'a sudden blast can open the mic');
    assert.equal(gate.state.speaking, false, 'but it closes once the wind is learnt');
    t = wind.now;
    assert.equal(feed(gate, 0.2, 5000, t).openedAt, null, 'and stays closed');
  });

  it('forgets loud noise quickly once it gets quiet again', () => {
    const gate = new VoiceActivityGate();
    let t = feed(gate, 0.05, 6000, 0).now;
    t = feed(gate, 0.004, 1500, t).now;
    assert.ok(gate.state.noiseFloor < 0.01, `floor ${gate.state.noiseFloor}`);
    assert.notEqual(feed(gate, 0.05, 200, t).openedAt, null, 'normal speech opens again at the lights');
  });

  it('closes again within seconds when a sudden steady noise opened it', () => {
    const gate = new VoiceActivityGate();
    let t = feed(gate, 0.004, 2000, 0).now;
    const gust = feed(gate, 0.05, 20_000, t);
    assert.notEqual(gust.openedAt, null, 'a sudden loud noise can open the mic');
    assert.equal(gate.state.speaking, false, 'but steady noise closes it again');
    t = gust.now;
    assert.equal(feed(gate, 0.05, 5000, t).openedAt, null, 'and it stays closed');
  });

  it('keeps long speech with natural gaps open', () => {
    const gate = new VoiceActivityGate();
    let t = feed(gate, 0.004, 1000, 0).now;
    let closedDuringSpeech = false;
    for (let word = 0; word < 60; word += 1) {
      t = feed(gate, 0.07, 300, t).now;
      t = feed(gate, 0.006, 120, t).now;
      if (word > 0 && !gate.state.speaking) closedDuringSpeech = true;
    }
    assert.equal(closedDuringSpeech, false, '25 s of continuous talking stays open');
  });

  it('listens without opening for the first moments', () => {
    const gate = new VoiceActivityGate();
    assert.equal(feed(gate, 0.3, 500, 0).openedAt, null);
  });

  it('reset closes the mic but keeps the learnt floor', () => {
    const gate = new VoiceActivityGate();
    const t = feed(gate, 0.2, 200, feed(gate, 0.03, 4000, 0).now).now;
    assert.equal(gate.state.speaking, true);
    const floor = gate.state.noiseFloor;
    gate.reset();
    assert.equal(gate.state.speaking, false);
    assert.equal(gate.state.noiseFloor, floor);
    assert.equal(gate.update(Number.NaN, t + 300), false);
  });
});
