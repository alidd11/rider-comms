(() => {
  'use strict';

  // Hand port of shared/src/positionInterpolation.ts -- this is a plain
  // browser script, not a bundled build, so it can't import the TS module
  // directly (same reason docs/movement-safety.js exists as its own port of
  // shared/src/movementState.ts). Keep this behaviourally identical; there's
  // no automated parity check for this one since the logic is a handful of
  // pure arithmetic lines with its own direct unit test coverage on the
  // shared side -- a drift here would be caught by eye, not worth a whole
  // parity-script for something this small.

  function lerpCoordinate(from, to, t) {
    const clamped = Math.max(0, Math.min(1, t));
    return {
      lat: from.lat + (to.lat - from.lat) * clamped,
      lon: from.lon + (to.lon - from.lon) * clamped,
    };
  }

  class PositionAnimator {
    constructor(initial) {
      this.from = initial;
      this.to = initial;
      this.startedAtMs = 0;
      this.durationMs = 0;
    }

    moveTo(target, durationMs, nowMs) {
      this.from = this.positionAt(nowMs);
      this.to = target;
      this.startedAtMs = nowMs;
      this.durationMs = Math.max(0, durationMs);
    }

    reset(position) {
      this.from = position;
      this.to = position;
      this.startedAtMs = 0;
      this.durationMs = 0;
    }

    positionAt(nowMs) {
      if (this.durationMs <= 0) return this.to;
      const elapsed = nowMs - this.startedAtMs;
      return lerpCoordinate(this.from, this.to, elapsed / this.durationMs);
    }

    isSettled(nowMs) {
      return nowMs - this.startedAtMs >= this.durationMs;
    }
  }

  globalThis.RiderPositionInterpolation = Object.freeze({
    lerpCoordinate,
    PositionAnimator,
  });
})();
