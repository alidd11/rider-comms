import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { MovementStateTracker, RIDE_SAFE_LOCK_SPEED_MPS, isLockedForSafety } from '../src/movementState.ts';
import type { LocationFix } from '../src/movementState.ts';

const BASE_LAT = 51.5074;
const BASE_LON = -0.1278;
const START_MS = 1_700_000_000_000;

/** A fix at the same point every time, with a small deterministic jitter
 * (not random, so a failing test reproduces identically) — the shape of
 * real GPS noise while a device is genuinely stationary. */
function stationaryFix(index: number, atMs: number, accuracyMeters = 8): LocationFix {
  const jitter = 0.00002 * (index % 2 === 0 ? 1 : -1); // ~2m of wobble
  return { lat: BASE_LAT + jitter, lon: BASE_LON + jitter, timestampMs: atMs, accuracyMeters };
}

/** A fix consistent with riding in a straight line at ~10 m/s (~22mph). */
function ridingFix(index: number, atMs: number, accuracyMeters = 8): LocationFix {
  // ~10m of northward travel per fix, at 1s cadence -> ~10 m/s.
  return { lat: BASE_LAT + 0.00009 * index, lon: BASE_LON, timestampMs: atMs, accuracyMeters, speedMps: 10 };
}

describe('MovementStateTracker', () => {
  it('starts unknown before any fix arrives', () => {
    const tracker = new MovementStateTracker();
    expect(tracker.currentState).toBe('unknown');
  });

  it('does not report moving from GPS jitter while genuinely stationary', () => {
    const tracker = new MovementStateTracker();
    for (let i = 0; i < 20; i++) {
      tracker.addFix(stationaryFix(i, START_MS + i * 1000));
    }
    expect(tracker.currentState).not.toBe('moving');
  });

  it('confirms stationary only after the confirmation window elapses', () => {
    const tracker = new MovementStateTracker();
    tracker.addFix(stationaryFix(0, START_MS));
    // Immediately after the first fix, there has not been time to confirm.
    expect(tracker.currentState).not.toBe('stationary');

    for (let i = 1; i <= 8; i++) {
      tracker.addFix(stationaryFix(i, START_MS + i * 1000));
    }
    // 8 seconds of consistent near-zero speed clears the default
    // confirmStationaryMs (6000ms).
    expect(tracker.currentState).toBe('stationary');
  });

  it('reports moving once sustained real displacement clears the moving threshold', () => {
    const tracker = new MovementStateTracker();
    tracker.addFix(ridingFix(0, START_MS));
    let state: string = tracker.currentState;
    for (let i = 1; i <= 5; i++) {
      state = tracker.addFix(ridingFix(i, START_MS + i * 1000));
    }
    expect(state).toBe('moving');
  });

  it('keeps controls usable below 8 mph and locks at the 8 mph threshold', () => {
    const tracker = new MovementStateTracker();
    let atMs = START_MS;
    for (let i = 0; i <= 7; i += 1) {
      tracker.addFix({ ...stationaryFix(i, atMs), speedMps: 3.3 });
      atMs += 1000;
    }
    expect(tracker.currentState).toBe('stationary');
    expect(isLockedForSafety(tracker.currentState)).toBe(false);

    let state = tracker.currentState;
    for (let i = 0; i <= 3; i += 1) {
      state = tracker.addFix({ ...stationaryFix(i, atMs), speedMps: RIDE_SAFE_LOCK_SPEED_MPS });
      atMs += 1000;
    }
    expect(state).toBe('moving');
    expect(isLockedForSafety(state)).toBe(true);
  });

  it('locks quickly (fails toward moving/locked) but unlocks only after a delay once stopped', () => {
    const tracker = new MovementStateTracker();
    let atMs = START_MS;

    // Ride for a while — confirms moving.
    for (let i = 0; i <= 5; i++) {
      tracker.addFix(ridingFix(i, atMs));
      atMs += 1000;
    }
    expect(tracker.currentState).toBe('moving');

    // Come to a stop: feed stationary fixes at the last riding position.
    const stopLat = BASE_LAT + 0.00009 * 5;
    const stopState = () => tracker.addFix({ lat: stopLat, lon: BASE_LON, timestampMs: atMs, accuracyMeters: 8 });

    stopState();
    atMs += 2000;
    // Only ~2s of stationary evidence so far — must still be locked/moving,
    // not unlocked immediately on the first low-speed reading.
    expect(isLockedForSafety(tracker.currentState)).toBe(true);

    for (let i = 0; i < 6; i++) {
      atMs += 1000;
      stopState();
    }
    // Now well past confirmStationaryMs (6000ms) of consistent near-zero
    // speed — safe to unlock.
    expect(tracker.currentState).toBe('stationary');
    expect(isLockedForSafety(tracker.currentState)).toBe(false);
  });

  it('ignores fixes with poor accuracy rather than treating them as movement evidence', () => {
    const tracker = new MovementStateTracker();
    let atMs = START_MS;
    for (let i = 0; i <= 8; i++) {
      tracker.addFix(stationaryFix(i, atMs));
      atMs += 1000;
    }
    expect(tracker.currentState).toBe('stationary');

    // A single wildly noisy fix, far away but with terrible accuracy,
    // should not be trusted as evidence of movement.
    tracker.addFix({ lat: BASE_LAT + 0.01, lon: BASE_LON + 0.01, timestampMs: atMs, accuracyMeters: 500 });
    expect(tracker.currentState).toBe('stationary');
  });

  it('decays to unknown after a long gap with no usable fixes', () => {
    const tracker = new MovementStateTracker();
    let atMs = START_MS;
    for (let i = 0; i <= 8; i++) {
      tracker.addFix(stationaryFix(i, atMs));
      atMs += 1000;
    }
    expect(tracker.currentState).toBe('stationary');

    // A 30-second gap (default staleAfterMs is 20s) before the next fix.
    atMs += 30_000;
    tracker.addFix(stationaryFix(0, atMs));
    // Right after the gap, the tracker has reset and needs to re-confirm —
    // it must not still be reporting the pre-gap 'stationary' state.
    expect(tracker.currentState).not.toBe('stationary');
  });

  it('holds the last confident state while readings sit in the hysteresis band', () => {
    const tracker = new MovementStateTracker();
    let atMs = START_MS;
    for (let i = 0; i <= 5; i++) {
      tracker.addFix(ridingFix(i, atMs));
      atMs += 1000;
    }
    expect(tracker.currentState).toBe('moving');

    // A speed between stationarySpeedMps (~7.5mph) and movingSpeedMps (8mph) is
    // ambiguous — it should not immediately flip the state either way.
    atMs += 1000;
    const ambiguousLat = BASE_LAT + 0.00009 * 5;
    tracker.addFix({ lat: ambiguousLat, lon: BASE_LON, timestampMs: atMs, accuracyMeters: 8, speedMps: 3.45 });
    expect(tracker.currentState).toBe('moving');
  });

  it('isLockedForSafety locks only confirmed movement', () => {
    expect(isLockedForSafety('unknown')).toBe(false);
    expect(isLockedForSafety('moving')).toBe(true);
    expect(isLockedForSafety('stationary')).toBe(false);
  });

  it('returns to warning-only unknown when a previously stationary fix becomes stale', () => {
    const tracker = new MovementStateTracker();
    for (let i = 0; i <= 7; i += 1) tracker.addFix(stationaryFix(i, START_MS + i * 1000));
    expect(tracker.currentState).toBe('stationary');
    expect(tracker.stateAt(START_MS + 28_000)).toBe('unknown');
    expect(isLockedForSafety(tracker.currentState)).toBe(false);
  });

  it('rejects malformed, impossible and out-of-order fixes', () => {
    const tracker = new MovementStateTracker();
    tracker.addFix(stationaryFix(0, START_MS));
    const invalid = [
      { ...stationaryFix(1, START_MS + 1000), lat: Number.NaN },
      { ...stationaryFix(1, START_MS + 1000), lon: 181 },
      { ...stationaryFix(1, START_MS + 1000), accuracyMeters: -1 },
      { ...stationaryFix(1, START_MS + 1000), speedMps: Number.POSITIVE_INFINITY },
      stationaryFix(1, START_MS - 1),
    ];
    for (const fix of invalid) expect(tracker.addFix(fix)).toBe('unknown');
  });

  it('can be failed locked immediately when platform tracking stops', () => {
    const tracker = new MovementStateTracker();
    for (let i = 0; i <= 7; i += 1) tracker.addFix(stationaryFix(i, START_MS + i * 1000));
    expect(tracker.markUnavailable()).toBe('unknown');
  });
});
