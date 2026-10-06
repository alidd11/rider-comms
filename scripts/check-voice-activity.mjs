import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  VOICE_PLAYBACK_BOOST,
  VoiceActivityGate,
} from '../shared/src/voiceActivity.ts';

await import('../docs/voice-activity.js');

const browser = globalThis.RiderVoiceActivity;
assert.ok(browser, 'PWA voice activity must expose RiderVoiceActivity');
assert.deepEqual({ ...browser.DEFAULT_VOICE_ACTIVITY_CONFIG }, DEFAULT_VOICE_ACTIVITY_CONFIG, 'PWA/native VOX config drift');
assert.equal(browser.VOICE_PLAYBACK_BOOST, VOICE_PLAYBACK_BOOST, 'PWA/native voice boost drift');

// Deterministic mic-level sequences: quiet, speech, pauses, steady noise,
// gusts, shouting, NaN, irregular sample spacing.
let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const sequences = [
  [[0.004, 1000], [0.06, 300], [0.003, 600], [0.07, 400], [0.002, 1500]],
  [[0.045, 6000], [0.16, 300], [0.04, 2000]],
  [[0.004, 2000], [0.05, 20000], [0.004, 1500], [0.05, 300]],
  [[0.4, 20000], [0.5, 300], [Number.NaN, 200]],
];
for (const [index, sequence] of sequences.entries()) {
  const native = new VoiceActivityGate();
  const pwa = new browser.VoiceActivityGate();
  let now = 1_000_000;
  for (const [level, duration] of sequence) {
    const end = now + duration;
    while (now < end) {
      const jitter = level * (0.85 + random() * 0.3);
      assert.equal(pwa.update(jitter, now), native.update(jitter, now), `VOX drift in sequence ${index} at ${now}`);
      now += 10 + Math.floor(random() * 40);
    }
  }
  assert.deepEqual(pwa.state, native.state, `VOX state drift after sequence ${index}`);
  native.reset();
  pwa.reset();
  assert.deepEqual(pwa.state, native.state, `VOX reset drift after sequence ${index}`);
}

console.log('Voice activity PWA/native parity valid');
