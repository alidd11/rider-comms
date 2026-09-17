import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../docs/movement-safety.js';

type BrowserTracker = {
  addFix(fix: { lat: number; lon: number; timestampMs: number; accuracyMeters: number; speedMps?: number }): string;
  stateAt(nowMs: number): string;
  markUnavailable(): string;
};

const browserSafety = (globalThis as typeof globalThis & {
  RiderMovementSafety: { MovementStateTracker: new () => BrowserTracker; isLockedForSafety(state: string): boolean };
}).RiderMovementSafety;

describe('browser movement safety adapter', () => {
  it('unlocks only after stationary confirmation and fails locked on GPS loss', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    for (let index = 0; index <= 7; index += 1) {
      tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 0 });
    }
    assert.equal(browserSafety.isLockedForSafety('stationary'), false);
    assert.equal(tracker.stateAt(start + 28_000), 'unknown');
    assert.equal(browserSafety.isLockedForSafety('unknown'), true);
  });

  it('locks after sustained movement and rejects impossible fixes', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    assert.equal(tracker.addFix({ lat: 91, lon: 0, timestampMs: start, accuracyMeters: 5 }), 'unknown');
    let state = 'unknown';
    for (let index = 0; index <= 3; index += 1) {
      state = tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 8 });
    }
    assert.equal(state, 'moving');
    assert.equal(tracker.markUnavailable(), 'unknown');
  });
});
