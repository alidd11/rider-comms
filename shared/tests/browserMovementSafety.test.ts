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
  it('unlocks after stationary confirmation and warns without locking on GPS loss', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    for (let index = 0; index <= 7; index += 1) {
      tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 0 });
    }
    assert.equal(browserSafety.isLockedForSafety('stationary'), false);
    assert.equal(tracker.stateAt(start + 28_000), 'unknown');
    assert.equal(browserSafety.isLockedForSafety('unknown'), false);
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

  it('stays unlocked below 8 mph and locks at 8 mph', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    let state = 'unknown';
    for (let index = 0; index <= 7; index += 1) {
      state = tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 3.3 });
    }
    assert.equal(state, 'stationary');
    assert.equal(browserSafety.isLockedForSafety(state), false);
    for (let index = 8; index <= 11; index += 1) {
      state = tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 3.57632 });
    }
    assert.equal(state, 'moving');
  });

  it('keeps controls locked through a GPS gap while riding, like the native tracker', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    let state = 'unknown';
    for (let index = 0; index <= 5; index += 1) {
      state = tracker.addFix({ lat: 51.5 + index * 0.0002, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 12 });
    }
    assert.equal(state, 'moving');
    assert.equal(tracker.stateAt(start + 95_000), 'moving');
    assert.equal(tracker.addFix({ lat: 51.52, lon: -0.12, timestampMs: start + 100_000, accuracyMeters: 5, speedMps: 12 }), 'moving');
    assert.equal(tracker.stateAt(start + 100_000 + 301_000), 'unknown');
  });

  it('estimates speed from displacement when the fix has none', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    let state = 'unknown';
    // ~20 m north each second, no speedMps: well above 8 mph after noise.
    for (let index = 0; index <= 3; index += 1) {
      state = tracker.addFix({ lat: 51.5 + index * 0.00018, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5 });
    }
    assert.equal(state, 'moving');
  });

  it('holds a moving lock through a GPS gap, then gives it up after a very long one', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    for (let index = 0; index <= 3; index += 1) {
      tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 10 });
    }
    // A fix after a 60 s tunnel keeps the lock; the next evidence decides.
    assert.equal(tracker.addFix({ lat: 51.6, lon: -0.12, timestampMs: start + 63_000, accuracyMeters: 5, speedMps: 10 }), 'moving');
    assert.equal(tracker.stateAt(start + 63_000 + 400_000), 'unknown');
  });

  it('holds its state in the hysteresis band and resets after a long gap while stationary', () => {
    const tracker = new browserSafety.MovementStateTracker();
    const start = 1_800_000_000_000;
    for (let index = 0; index <= 7; index += 1) {
      tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 0 });
    }
    assert.equal(tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + 8000, accuracyMeters: 5, speedMps: 3.45 }), 'stationary');
    assert.equal(tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + 60_000, accuracyMeters: 5, speedMps: 0 }), 'unknown');
  });

  it('reports unknown without a fix or a valid clock, but keeps a moving lock', () => {
    const tracker = new browserSafety.MovementStateTracker();
    assert.equal(tracker.stateAt(Number.NaN), 'unknown');
    const start = 1_800_000_000_000;
    for (let index = 0; index <= 3; index += 1) {
      tracker.addFix({ lat: 51.5, lon: -0.12, timestampMs: start + index * 1000, accuracyMeters: 5, speedMps: 10 });
    }
    assert.equal(tracker.stateAt(Number.NaN), 'moving');
  });
});

